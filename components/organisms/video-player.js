/**
 * VideoPlayer — lecteur d'une conférence, piloté phrase par phrase (§10).
 *
 * Une balise `<video>` native sur le fichier de TED, et non un iframe YouTube :
 * le saut y est exact à la seconde (mesuré : 20,60 s demandés, 20,60 s
 * obtenus), il n'y a pas de script externe à charger, et les horodatages de la
 * transcription collent au fichier sans décalage — ce qui n'est pas vrai de la
 * version YouTube, qui ajoute son habillage.
 *
 * Le composant ne décide rien : il reçoit une adresse et rend des commandes.
 *
 * **Pourquoi `onPret` plutôt qu'une prop `segment`.** Re-créer le lecteur à
 * chaque phrase rechargerait la vidéo. Le composant remet donc ses commandes à
 * l'écran une fois pour toutes, et reste monté d'une phrase à l'autre. C'est la
 * seule entorse au « props en entrée, onXxx en sortie », et elle est ici
 * imposée par le média.
 *
 * @param {string}   source     adresse du fichier vidéo
 * @param {?string}  titre
 * @param {Function} onPret     reçoit { jouer, arreter, enLecture }
 * @param {Function} onFin      appelé quand un segment se termine
 * @param {Function} onErreur   reçoit un message lisible
 * @returns {HTMLElement}
 */
export function VideoPlayer({ source, titre = null, onPret, onFin, onErreur } = {}) {
  const el = document.createElement("section");
  el.className = "lecteur";

  const media = document.createElement("video");
  media.className = "lecteur__video";
  media.src = source ?? "";
  media.preload = "metadata";
  media.controls = true;
  media.playsInline = true;
  if (titre) media.setAttribute("aria-label", titre);
  el.append(media);

  /** Fin du segment en cours. Null quand la lecture est libre. */
  let borne = null;
  /** Segment demandé avant que les métadonnées soient là. */
  let enAttente = null;

  media.addEventListener("error", () => {
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

  onPret?.({ jouer, arreter, enLecture: () => !media.paused });
  return el;
}
