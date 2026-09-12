/**
 * VideoPlayer — lecteur d'une conférence, piloté phrase par phrase (§10).
 *
 * Une balise `<video>` native sur le fichier de TED, et non un iframe YouTube :
 * le saut y est exact à la seconde (mesuré : 20,60 s demandés, 20,60 s
 * obtenus), il n'y a pas de script externe à charger, et les horodatages de la
 * transcription collent au fichier sans décalage — ce qui n'est pas vrai de la
 * version YouTube, qui ajoute son habillage.
 *
 * **Deux sources possibles.** Environ une conférence sur trois a son mp4
 * verrouillé chez TED (403 AccessDenied) et n'est lisible qu'en HLS. On prend
 * donc le mp4 quand il est servi, le flux HLS sinon.
 *
 * **Pourquoi essayer le natif avant de charger hls.js.** Safari et iOS lisent
 * le HLS sans aucune bibliothèque : sur l'iPhone, la tentative native réussit
 * et les 345 Ko de hls.js ne sont jamais téléchargés. Ailleurs elle échoue en
 * une fraction de seconde et on bascule. `canPlayType` ne peut pas servir à
 * trancher : mesuré, Chromium répond « maybe » pour le HLS puis échoue avec
 * MEDIA_ERR_SRC_NOT_SUPPORTED.
 *
 * Le composant ne décide rien : il reçoit des adresses et rend des commandes.
 *
 * **Pourquoi `onPret` plutôt qu'une prop `segment`.** Re-créer le lecteur à
 * chaque phrase rechargerait la vidéo. Le composant remet donc ses commandes à
 * l'écran une fois pour toutes, et reste monté d'une phrase à l'autre. C'est la
 * seule entorse au « props en entrée, onXxx en sortie », et elle est ici
 * imposée par le média.
 *
 * @param {?string}  source     fichier mp4, quand TED le sert
 * @param {?string}  hls        flux HLS, source de repli
 * @param {?string}  titre
 * @param {Function} onPret     reçoit { jouer, arreter, detruire, enLecture }
 * @param {Function} onFin      appelé quand un segment se termine
 * @param {Function} onErreur   reçoit un message lisible
 * @returns {HTMLElement}
 */

/** Build « light » : ni sous-titres, ni pistes audio alternatives, ni DRM. */
const HLS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.6.15/hls.light.min.js";

/** Délai au-delà duquel la lecture native est considérée comme refusée. */
const DELAI_SONDAGE_MS = 4000;

/** Une seule injection du script par page, partagée par tous les lecteurs. */
let chargementHls = null;

function chargerHls() {
  if (globalThis.Hls) return Promise.resolve(globalThis.Hls);
  if (chargementHls) return chargementHls;

  chargementHls = new Promise((resoudre, rejeter) => {
    const balise = document.createElement("script");
    balise.src = HLS_CDN;
    balise.async = true;
    balise.onload = () => resoudre(globalThis.Hls ?? null);
    balise.onerror = () => {
      chargementHls = null; // un échec réseau ne doit pas condamner les essais suivants
      rejeter(new Error("hls.js injoignable"));
    };
    document.head.append(balise);
  });
  return chargementHls;
}

export function VideoPlayer({ source = null, hls = null, titre = null,
                              onPret, onFin, onErreur } = {}) {
  const el = document.createElement("section");
  el.className = "lecteur";

  const media = document.createElement("video");
  media.className = "lecteur__video";
  media.preload = "metadata";
  media.controls = true;
  media.playsInline = true;
  if (titre) media.setAttribute("aria-label", titre);
  el.append(media);

  /** Fin du segment en cours. Null quand la lecture est libre. */
  let borne = null;
  /** Segment demandé avant que les métadonnées soient là. */
  let enAttente = null;
  /** Instance hls.js, à détruire en quittant. */
  let moteur = null;
  /** Pendant le sondage natif, une erreur est une réponse, pas une panne. */
  let sondage = false;
  /** Un seul repli du mp4 vers le flux, sinon on boucle sur l'erreur. */
  let bascule = false;

  media.addEventListener("error", () => {
    if (sondage) return;
    // Le mp4 s'est dérobé — TED en verrouille certains après coup, et une
    // conférence enregistrée avant ce repli n'a que cette adresse-là. Tant
    // qu'un flux existe, on bascule au lieu d'afficher une erreur.
    if (hls && !bascule) { bascule = true; brancherHls(); return; }
    onErreur?.("La vidéo n'a pas pu être chargée. TED a peut-être changé son adresse.");
  });

  media.addEventListener("loadedmetadata", () => {
    if (!enAttente) return;
    const { debut, fin } = enAttente;
    enAttente = null;
    jouer(debut, fin);
  });

  // On surveille la position plutôt que de poser un minuteur : un minuteur
  // dérive dès que la lecture bégaie ou que l'utilisateur met en pause.
  media.addEventListener("timeupdate", () => {
    if (borne === null || media.currentTime < borne) return;
    borne = null;
    media.pause();
    onFin?.();
  });

  /* ----------------------------------------------------------- La source */

  if (source) media.src = source;
  else if (hls) brancherHls();
  else onErreur?.("Cette conférence n'a aucune vidéo lisible.");

  /** Tente la lecture native du flux, sans rien télécharger. */
  function essaiNatif(url) {
    return new Promise((resoudre) => {
      sondage = true;
      const finir = (ok) => {
        clearTimeout(minuteur);
        media.removeEventListener("loadedmetadata", surSucces);
        media.removeEventListener("error", surEchec);
        sondage = false;
        resoudre(ok);
      };
      const surSucces = () => finir(true);
      const surEchec = () => finir(false);
      const minuteur = setTimeout(() => finir(false), DELAI_SONDAGE_MS);

      media.addEventListener("loadedmetadata", surSucces, { once: true });
      media.addEventListener("error", surEchec, { once: true });
      media.src = url;
    });
  }

  async function brancherHls() {
    if (await essaiNatif(hls)) return; // Safari, iPhone, iPad

    try {
      const Hls = await chargerHls();
      if (!Hls?.isSupported()) {
        onErreur?.("Ce navigateur ne sait pas lire le flux vidéo de cette conférence.");
        return;
      }
      moteur = new Hls({ enableWorker: true });
      moteur.on(Hls.Events.ERROR, (_, donnees) => {
        if (donnees?.fatal) onErreur?.("Le flux vidéo de TED s'est interrompu.");
      });
      moteur.loadSource(hls);
      moteur.attachMedia(media);
    } catch {
      onErreur?.("La bibliothèque de lecture n'a pas pu être chargée. Vérifie ta connexion.");
    }
  }

  /* --------------------------------------------------------- Les commandes */

  /**
   * Joue exactement un segment, puis s'arrête.
   * @param {number} debut
   * @param {number} fin
   */
  function jouer(debut, fin) {
    if (!Number.isFinite(debut)) return;
    if (media.readyState < 1) { enAttente = { debut, fin }; return; }

    borne = Number.isFinite(fin) && fin > debut ? fin : null;
    media.currentTime = debut;
    media.play().catch(() => {
      // Un navigateur peut refuser la lecture tant que l'utilisateur n'a rien
      // touché. Les contrôles natifs restent là pour démarrer à la main.
      onErreur?.("Touche le lecteur pour autoriser la lecture.");
    });
  }

  function arreter() {
    borne = null;
    media.pause();
  }

  /** Libère le flux : sans ça, hls.js continue de télécharger en fond. */
  function detruire() {
    arreter();
    enAttente = null;
    if (moteur) { moteur.destroy(); moteur = null; }
  }

  onPret?.({ jouer, arreter, detruire, enLecture: () => !media.paused });
  return el;
}
