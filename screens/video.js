import { SessionHeader } from "../components/molecules/session-header.js";
import { Button } from "../components/atoms/button.js";
import { Spinner } from "../components/atoms/spinner.js";
import { Toast } from "../components/atoms/toast.js";
import { WordOrder } from "../components/molecules/word-order.js";
import { InputAnswer } from "../components/molecules/input-answer.js";
import { VideoPlayer } from "../components/organisms/video-player.js";
import { normaliserVideo, composerPhrase, appliquerPhrase,
         avancement } from "../services/video-builder.js";
import { recupererTranscription } from "../services/api.js";
import { chargerVideos, ajouterVideo } from "../services/store.js";
import { aujourdhui } from "../services/leitner.js";

/** Délai d'affichage du verdict avant la phrase suivante. */
const DUREE_VERDICT = 1400;

/**
 * Video — section §10 (README §2, §13).
 *
 * La conférence se joue **une phrase à la fois**, puis s'arrête. Deux jeux sur
 * cette phrase, au choix : remettre les mots dans l'ordre, ou l'écrire en
 * entier. Jamais de micro — l'utilisateur reconstruit, il ne parle pas.
 *
 * @param {{state:object, contenu:object, aller:Function, enregistrer:Function}} contexte
 * @returns {HTMLElement}
 */
export function Video({ state, contenu, aller, enregistrer }) {
  const el = document.createElement("main");
  el.className = "ecran video-screen";

  const today = aujourdhui();
  let videos = chargerVideos();
  let choisie = null;
  let mode = "ordre";
  /** Commandes du lecteur, remises par l'organism une fois monté. */
  let commandes = null;

  const corps = document.createElement("div");
  corps.className = "session__body";

  const signaler = (message, variant = "error") =>
    el.append(Toast({ message, variant, duration: 5000 }));

  /* ------------------------------------------------------- Choix / import */

  const choisir = () => {
    commandes?.detruire?.();
    commandes = null;
    choisie = null;
    el.replaceChildren();
    el.append(SessionHeader({ title: "Vidéo", onHome: () => aller("/") }));
    corps.replaceChildren();
    el.append(corps);

    corps.append(formulaire());

    if (!videos.length) {
      const vide = document.createElement("p");
      vide.className = "video-screen__vide";
      vide.textContent =
        "Colle le lien d'une conférence TED, ou celui de sa vidéo YouTube. "
        + "L'application récupère la transcription et la découpe en phrases.";
      corps.append(vide);
      return;
    }

    const liste = document.createElement("div");
    liste.className = "video-screen__liste";
    for (const video of [...videos].reverse()) {
      const suivi = avancement(video, state);
      const ligne = document.createElement("button");
      ligne.type = "button";
      ligne.className = "video-screen__item";
      ligne.addEventListener("click", () => { choisie = video; jouer(); });

      const nom = document.createElement("span");
      nom.className = "video-screen__item-titre";
      nom.textContent = video.titre;

      const etat = document.createElement("span");
      etat.className = "video-screen__item-etat";
      etat.textContent = `${suivi.faites.length} / ${suivi.total} phrases`;

      ligne.append(nom, etat);
      liste.append(ligne);
    }
    corps.append(liste);
  };

  /** Formulaire de récupération d'une conférence. */
  const formulaire = () => {
    const zone = document.createElement("form");
    zone.className = "video-screen__form";
    zone.noValidate = true;

    const champ = document.createElement("input");
    champ.type = "url";
    champ.className = "video-screen__field";
    champ.placeholder = "https://www.ted.com/talks/… ou https://youtu.be/…";
    champ.setAttribute("aria-label", "Lien de la conférence");
    zone.append(champ);

    const action = document.createElement("div");
    action.className = "video-screen__action";
    zone.append(action);

    const bouton = () => action.replaceChildren(Button({
      label: "Récupérer la conférence",
      fullWidth: true,
      onClick: () => zone.requestSubmit(),
    }));
    bouton();

    zone.addEventListener("submit", async (evenement) => {
      evenement.preventDefault();
      const lien = champ.value.trim();
      if (!lien) return;

      action.replaceChildren(Spinner({ size: "md" }));
      const reponse = await recupererTranscription({ lien });
      if (!reponse.ok) { signaler(reponse.erreur); bouton(); return; }

      const video = normaliserVideo(reponse.donnees);
      if (!video) { signaler("Cette conférence n'a pas de transcription exploitable."); bouton(); return; }

      videos = ajouterVideo(video);
      choisie = video;
      jouer();
    });

    return zone;
  };

  /* --------------------------------------------------------------- Le jeu */

  const jouer = async () => {
    // Une conférence enregistrée avant le repli HLS n'a pas de champ `hls` : son
    // mp4 peut être verrouillé depuis, et rien ne la répare toute seule. On la
    // recharge une fois, silencieusement, à partir de son lien TED d'origine.
    if (choisie.hls === undefined && choisie.source) {
      const reponse = await recupererTranscription({ lien: choisie.source });
      const frais = reponse.ok ? normaliserVideo(reponse.donnees) : null;
      if (frais) { videos = ajouterVideo(frais); choisie = frais; }
    }

    el.replaceChildren();
    el.append(SessionHeader({ title: choisie.titre, onHome: choisir }));
    corps.replaceChildren();
    el.append(corps);

    // Le lecteur est monté UNE fois : le remonter à chaque phrase
    // rechargerait la vidéo entière.
    corps.append(VideoPlayer({
      source: choisie.video,
      hls: choisie.hls,
      titre: choisie.titre,
      onPret: (c) => { commandes = c; },
      onErreur: (m) => signaler(m),
    }));

    const barre = document.createElement("div");
    barre.className = "video-screen__barre";
    corps.append(barre);

    const zoneJeu = document.createElement("div");
    zoneJeu.className = "video-screen__jeu";
    corps.append(zoneJeu);

    corps.append(credit());
    rendrePhrase(barre, zoneJeu);
  };

  /** Barre segmentée : une case par phrase, comme un chapitrage. */
  const rendreBarre = (barre, rang) => {
    const suivi = avancement(choisie, state);
    const faites = new Set(suivi.faites);
    barre.replaceChildren();

    for (const phrase of choisie.phrases) {
      const segment = document.createElement("span");
      segment.className = "video-screen__segment"
        + (faites.has(phrase.i) ? " video-screen__segment--faite" : "")
        + (phrase.i === rang ? " video-screen__segment--courante" : "");
      barre.append(segment);
    }

    const compte = document.createElement("p");
    compte.className = "video-screen__compte";
    compte.textContent = suivi.termine
      ? "Conférence terminée."
      : `Phrase ${rang + 1} sur ${suivi.total} · ${suivi.faites.length} réussies`;
    barre.append(compte);
  };

  const rendrePhrase = (barre, zoneJeu) => {
    const { verrouille, raison, exercice } = composerPhrase({ video: choisie, state, mode });
    if (verrouille) { zoneJeu.replaceChildren(); signaler(raison); return; }

    rendreBarre(barre, exercice.rang);
    zoneJeu.replaceChildren();
    zoneJeu.append(barreDOutils(exercice, barre, zoneJeu));

    const apres = ({ correct }) => {
      state = appliquerPhrase({ state, slug: choisie.slug, rang: exercice.rang,
                                correct, today });
      enregistrer(state, { silencieux: true });
      setTimeout(() => rendrePhrase(barre, zoneJeu), DUREE_VERDICT);
    };

    zoneJeu.append(mode === "ordre"
      ? WordOrder({ tokens: exercice.tokens, expected: exercice.attendu, onSubmit: apres })
      // Pas de micro ici : l'exercice est d'écrire ce qu'on entend.
      : InputAnswer({ prompt: null, expected: exercice.attendu, micro: false,
                      onAudio: () => commandes?.jouer(exercice.debut, exercice.fin),
                      onSubmit: apres }));

    commandes?.jouer(exercice.debut, exercice.fin);
  };

  /** Réécouter, et basculer d'un jeu à l'autre. */
  const barreDOutils = (exercice, barre, zoneJeu) => {
    const zone = document.createElement("div");
    zone.className = "video-screen__outils";

    zone.append(Button({
      label: "Réécouter", variant: "secondary", icon: "audio",
      onClick: () => commandes?.jouer(exercice.debut, exercice.fin),
    }));

    zone.append(Button({
      label: mode === "ordre" ? "Écrire la phrase" : "Remettre dans l'ordre",
      variant: "ghost",
      onClick: () => {
        mode = mode === "ordre" ? "ecriture" : "ordre";
        rendrePhrase(barre, zoneJeu);
      },
    }));

    return zone;
  };

  /** Crédit : la licence de TED l'impose (§16). */
  const credit = () => {
    const zone = document.createElement("p");
    zone.className = "video-screen__credit";
    zone.textContent = `${choisie.titre} — TED, ${choisie.licence ?? "CC BY-NC-ND 4.0"}. `
      + "Usage personnel, non commercial.";
    return zone;
  };

  choisir();
  return el;
}
