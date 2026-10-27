import { SessionHeader } from "../components/molecules/session-header.js";
import { Button } from "../components/atoms/button.js";
import { Spinner } from "../components/atoms/spinner.js";
import { Toast } from "../components/atoms/toast.js";
import { Chip } from "../components/atoms/chip.js";
import { MCQ } from "../components/molecules/mcq.js";
import { ClozeChoice } from "../components/molecules/cloze-choice.js";
import { InputAnswer } from "../components/molecules/input-answer.js";
import { VideoPlayer } from "../components/organisms/video-player.js";
import { normaliserVideo, composerPhrase, appliquerPhrase, avancement,
         composerQuizVideo, estVue, marquerVue,
         suggererConferences } from "../services/video-builder.js";
import { chargerConferences } from "../services/content-loader.js";
import { recupererTranscription, traduire } from "../services/api.js";
import { chargerVideos, ajouterVideo } from "../services/store.js";
import { aujourdhui } from "../services/leitner.js";

/** Délai d'affichage du verdict avant la phrase suivante. */
const DUREE_VERDICT = 1400;

/**
 * Video — section §10 (README §2, §13).
 *
 * La conférence se joue **une phrase à la fois**, puis s'arrête. Deux jeux sur
 * cette phrase, au choix : retrouver les mots qui manquent, ou l'écrire en
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
  let mode = "trous";
  /** Traductions déjà demandées pendant la séance : un seul appel par phrase. */
  const traductions = new Map();
  /** Phrases passées pendant CETTE séance — jamais enregistrées : une phrase
   *  ratée doit revenir la prochaine fois. */
  let sautees = new Set();
  /** Commandes du lecteur, remises par l'organism une fois monté. */
  let commandes = null;
  /** Catalogue des conférences proposées, lu à la première ouverture. */
  let catalogue = null;
  /** Page de propositions affichée : « Autres conférences » la fait tourner. */
  let pageProposee = 0;

  const corps = document.createElement("div");
  corps.className = "session__body";

  const signaler = (message, variant = "error") =>
    el.append(Toast({ message, variant, duration: 5000 }));

  /* ------------------------------------------------------- Choix / import */

  const choisir = () => {
    commandes?.detruire?.();
    commandes = null;
    choisie = null;
    sautees = new Set();
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
    } else {
      corps.append(enregistrees());
    }
    corps.append(propositions());
  };

  /** Conférences déjà récupérées, la plus récente en tête. */
  const enregistrees = () => {
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
    return liste;
  };

  /**
   * Récupère une conférence et l'ouvre.
   * @returns {Promise<boolean>} false si elle n'a pas pu l'être : l'appelant
   *   remet son bouton en place.
   */
  const importer = async (lien) => {
    const reponse = await recupererTranscription({ lien });
    if (!reponse.ok) { signaler(reponse.erreur); return false; }

    const video = normaliserVideo(reponse.donnees);
    if (!video) { signaler("Cette conférence n'a pas de transcription exploitable."); return false; }

    videos = ajouterVideo(video);
    choisie = video;
    jouer();
    return true;
  };

  /**
   * Conférences proposées d'après le palier (§09). Le catalogue n'est lu qu'à
   * la première ouverture de l'écran ; sans lui, la zone reste vide.
   */
  const propositions = () => {
    const zone = document.createElement("section");
    zone.className = "video-screen__propositions";

    const ligne = (conference) => {
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.className = "video-screen__item";

      const texte = document.createElement("span");
      texte.className = "video-screen__item-titre";
      const nom = document.createElement("span");
      nom.textContent = conference.titre;
      const detail = document.createElement("span");
      detail.className = "video-screen__item-detail";
      detail.textContent = [conference.orateur, `${Math.max(1, Math.round(conference.duree / 60))} min`]
        .filter(Boolean).join(" · ");
      texte.append(nom, detail);

      const niveau = Chip(conference.aPortee
        ? { label: "à ta portée", variant: "success" }
        : { label: `palier ${conference.palier}`, variant: "theme" });
      bouton.append(texte, niveau);

      bouton.addEventListener("click", async () => {
        if (bouton.disabled) return;
        bouton.disabled = true;
        bouton.replaceChildren(Spinner({ size: "sm" }));
        if (!(await importer(`https://www.ted.com/talks/${conference.slug}`))) {
          bouton.disabled = false;
          bouton.replaceChildren(texte, niveau);
        }
      });
      return bouton;
    };

    const rendre = () => {
      const { conferences, pages } = suggererConferences(catalogue, {
        palier: Number(state.progression?.palier_actuel ?? 1),
        exclus: videos.map((v) => v.slug),
        page: pageProposee,
      });
      zone.replaceChildren();
      if (!conferences.length) return;

      const titre = document.createElement("h2");
      titre.className = "video-screen__titre";
      titre.textContent = "Conférences pour toi";

      const liste = document.createElement("div");
      liste.className = "video-screen__liste";
      for (const conference of conferences) liste.append(ligne(conference));
      zone.append(titre, liste);

      if (pages > 1) {
        zone.append(Button({
          label: "Autres conférences",
          variant: "ghost",
          fullWidth: true,
          onClick: () => { pageProposee += 1; rendre(); },
        }));
      }
    };

    if (catalogue) rendre();
    else {
      chargerConferences({ manifeste: contenu.manifeste }).then(({ conferences }) => {
        catalogue = conferences;
        rendre();
      });
    }
    return zone;
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
      if (!(await importer(lien))) bouton();
    });

    return zone;
  };

  /* --------------------------------------------------------------- Le jeu */

  const jouer = async () => {
    // Une conférence enregistrée peut être périmée de deux façons : soit elle
    // date d'avant le repli HLS et n'a aucun champ `hls`, soit son flux porte
    // encore `intro_master_id`, le générique qui décalait la vidéo de 3,5 s sur
    // la phrase affichée. Dans les deux cas on la recharge une fois,
    // silencieusement, depuis son lien TED d'origine — sans quoi le correctif
    // resterait invisible pour qui a déjà ouvert la conférence.
    const perimee = choisie.hls === undefined
      || (typeof choisie.hls === "string" && choisie.hls.includes("intro_master_id"));
    if (perimee && choisie.source) {
      const reponse = await recupererTranscription({ lien: choisie.source });
      const frais = reponse.ok ? normaliserVideo(reponse.donnees) : null;
      if (frais) { videos = ajouterVideo(frais); choisie = frais; }
    }

    el.replaceChildren();
    el.append(SessionHeader({ title: choisie.titre, onHome: choisir }));
    corps.replaceChildren();
    el.append(corps);

    const zoneQuizz = document.createElement("div");
    zoneQuizz.className = "video-screen__quizz";

    // Le lecteur est monté UNE fois : le remonter à chaque phrase
    // rechargerait la vidéo entière.
    corps.append(VideoPlayer({
      source: choisie.video,
      hls: choisie.hls,
      titre: choisie.titre,
      onPret: (c) => { commandes = c; },
      onErreur: (m) => signaler(m),
      onProgres: ({ position, duree }) => {
        const suivant = marquerVue({ state, slug: choisie.slug, position, duree, today });
        if (suivant === state) return;   // rien n'a changé : pas de réécriture
        state = suivant;
        enregistrer(state, { silencieux: true });
        rendreAccesQuizz(zoneQuizz);
      },
    }));

    const barre = document.createElement("div");
    barre.className = "video-screen__barre";
    corps.append(barre);

    const zoneJeu = document.createElement("div");
    zoneJeu.className = "video-screen__jeu";
    corps.append(zoneJeu);

    corps.append(zoneQuizz);
    rendreAccesQuizz(zoneQuizz);

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
    const { verrouille, raison, exercice } =
      composerPhrase({ video: choisie, state, mode, ignorer: [...sautees] });
    if (verrouille) { zoneJeu.replaceChildren(); signaler(raison); return; }

    rendreBarre(barre, exercice.rang);
    zoneJeu.replaceChildren();
    const zoneTraduction = document.createElement("p");
    zoneTraduction.className = "video-screen__traduction";
    zoneJeu.append(barreDOutils(exercice, barre, zoneJeu, zoneTraduction), zoneTraduction);

    const apres = ({ correct }) => {
      state = appliquerPhrase({ state, slug: choisie.slug, rang: exercice.rang,
                                correct, today });
      enregistrer(state, { silencieux: true });

      // Juste : on enchaîne. Faux : on ne décide pas à sa place — la bonne
      // phrase est déjà affichée par le composant, reste à choisir si on la
      // refait ou si on avance.
      if (correct) {
        setTimeout(() => rendrePhrase(barre, zoneJeu), DUREE_VERDICT);
        return;
      }
      zoneJeu.append(choixApresErreur(exercice, barre, zoneJeu));
    };

    zoneJeu.append(mode === "trous"
      ? ClozeChoice({ parts: exercice.parties, choices: exercice.choix,
                      expected: exercice.reponses, sentence: exercice.attendu,
                      onSubmit: apres })
      // Pas de micro ici : l'exercice est d'écrire ce qu'on entend.
      : InputAnswer({ prompt: null, expected: exercice.attendu, micro: false,
                      onAudio: () => commandes?.jouer(exercice.debut, exercice.fin),
                      onSubmit: apres }));

    commandes?.jouer(exercice.debut, exercice.fin);
  };

  /** Après une erreur : refaire la phrase, ou passer à la suivante. */
  const choixApresErreur = (exercice, barre, zoneJeu) => {
    const zone = document.createElement("div");
    zone.className = "video-screen__reprise";

    zone.append(Button({
      label: "Réessayer",
      fullWidth: true,
      onClick: () => rendrePhrase(barre, zoneJeu),
    }));

    zone.append(Button({
      label: "Passer à la phrase suivante",
      variant: "secondary",
      fullWidth: true,
      onClick: () => { sautees.add(exercice.rang); rendrePhrase(barre, zoneJeu); },
    }));

    return zone;
  };

  /** Réécouter, traduire, et basculer d'un jeu à l'autre. */
  const barreDOutils = (exercice, barre, zoneJeu, zoneTraduction) => {
    const zone = document.createElement("div");
    zone.className = "video-screen__outils";

    zone.append(Button({
      label: "Réécouter", variant: "secondary", icon: "audio",
      onClick: () => commandes?.jouer(exercice.debut, exercice.fin),
    }));

    // La traduction n'est jamais montrée d'office : c'est une aide qu'on
    // demande, pas la réponse posée à côté de l'exercice.
    const traduction = Button({
      label: "Traduire", variant: "secondary",
      onClick: async () => {
        if (zoneTraduction.textContent) { zoneTraduction.textContent = ""; return; }
        const cle = `${choisie.slug}:${exercice.rang}`;
        if (!traductions.has(cle)) {
          traduction.disabled = true;
          const reponse = await traduire(exercice.attendu);
          traduction.disabled = false;
          const fr = reponse.ok ? reponse.donnees?.phrase_fr : null;
          if (!fr) { signaler(reponse.erreur ?? "Traduction indisponible."); return; }
          traductions.set(cle, fr);
        }
        zoneTraduction.textContent = traductions.get(cle);
      },
    });
    zone.append(traduction);

    zone.append(Button({
      label: mode === "trous" ? "Écrire la phrase" : "Phrase à trous",
      variant: "ghost",
      onClick: () => {
        mode = mode === "trous" ? "ecriture" : "trous";
        rendrePhrase(barre, zoneJeu);
      },
    }));

    return zone;
  };

  /* --------------------------------------------------------------- Quizz */

  /**
   * Accès au quizz.
   *
   * La lecture continue est proposée séparément des exercices : ceux-ci
   * s'arrêtent à chaque phrase, on ne peut donc pas « voir la conférence »
   * en les enchaînant.
   */
  const rendreAccesQuizz = (zone) => {
    zone.replaceChildren();

    zone.append(Button({
      label: "Regarder la conférence en entier",
      variant: "secondary",
      fullWidth: true,
      onClick: () => commandes?.jouer(0, null),
    }));

    if (estVue(state, choisie.slug)) {
      zone.append(Button({ label: "Quizz de la conférence", fullWidth: true,
                           onClick: () => quizzer() }));
      return;
    }

    const note = document.createElement("p");
    note.className = "video-screen__note";
    note.textContent = "Le quizz s'ouvre quand tu as regardé la conférence en entier.";
    zone.append(note);
  };

  /** Huit questions tirées de la transcription — aucun réseau. */
  const quizzer = () => {
    const { verrouille, raison, questions } = composerQuizVideo({ video: choisie, state });
    if (verrouille) { signaler(raison); return; }

    commandes?.arreter();
    el.replaceChildren();
    el.append(SessionHeader({ title: "Quizz", onHome: jouer }));
    corps.replaceChildren();
    el.append(corps);

    let rang = 0;
    let justes = 0;

    const suite = () => {
      corps.replaceChildren();

      if (rang >= questions.length) {
        const bilan = document.createElement("p");
        bilan.className = "video-screen__bilan";
        bilan.textContent = `${justes} bonnes réponses sur ${questions.length}.`;
        corps.append(bilan);
        corps.append(Button({ label: "Revenir à la conférence", fullWidth: true,
                              onClick: () => jouer() }));
        return;
      }

      const question = questions[rang];
      const compte = document.createElement("p");
      compte.className = "video-screen__compte";
      compte.textContent = `Question ${rang + 1} sur ${questions.length}`;
      corps.append(compte);

      corps.append(MCQ({
        question: question.type === "trou"
          ? `Quel mot manque ? ${question.invite}`
          : `Quelle phrase suit ? « ${question.invite} »`,
        options: question.choix.map((texte, i) => ({ id: String(i), label: texte })),
        correctId: String(question.choix.indexOf(question.attendu)),
        onAnswer: ({ correct }) => {
          if (correct) justes += 1;
          rang += 1;
          setTimeout(suite, DUREE_VERDICT);
        },
      }));
    };

    suite();
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
