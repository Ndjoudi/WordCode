import { SessionHeader } from "../components/molecules/session-header.js";
import { ProgressDots } from "../components/atoms/progress-dots.js";
import { Button } from "../components/atoms/button.js";
import { DiscoveryDeck } from "../components/organisms/discovery-deck.js";
import { AnchorDeck } from "../components/organisms/anchor-deck.js";
import { RecallDeck } from "../components/organisms/recall-deck.js";
import { EndCard } from "../components/organisms/end-card.js";
import { QueueSummary } from "../components/organisms/queue-summary.js";
import { CodewordBoard } from "../components/organisms/codeword-board.js";
import { composerSession, construireQCM, construireRappel,
         cloturerSession, retirerDeLaFile, marquerPartieJouee,
         motDepuisSegment, prochainIdPerso, ajouterMotsPerso,
         AJOUTS_MAX_PAR_PARTIE } from "../services/session-builder.js";
import { appliquerResultat, ficheInitiale, aujourdhui } from "../services/leitner.js";
import { taire } from "../services/audio.js";

/** Les quatre phases de la §3, plus le bilan et le récapitulatif des ajouts. */
const PHASES = ["decouverte", "ancrage", "grille", "bilan", "rappel", "file"];
const TITRES = {
  decouverte: "Découverte",
  ancrage: "Ancrage",
  grille: "Grille",
  bilan: "Bilan",
  rappel: "Rappel actif",
  file: "À demain",
};

/**
 * Session — orchestrateur des phases (README §11).
 * Aucune logique métier ici : il compose, il enchaîne, il enregistre.
 *
 * @param {{state:object, contenu:object, aller:Function, enregistrer:Function}} contexte
 * @returns {HTMLElement}
 */
export function Session({ state, contenu, aller, enregistrer }) {
  const el = document.createElement("main");
  el.className = "ecran session";

  const today = aujourdhui();
  const session = composerSession({
    state, catalogue: contenu.mots, parties: contenu.parties, today,
  });

  if (session.vide) {
    return ecranVide(el, aller);
  }

  // Sans partie disponible, pas de grille : les autres phases restent.
  // Sans mot nouveau, les phases 1 et 2 sont sautées (README §11).
  const phases = PHASES.filter((phase) => {
    if (phase === "grille") return Boolean(session.partie);
    if (phase === "decouverte" || phase === "ancrage") return session.nouveaux.length > 0;
    return true;
  });

  let rang = 0;
  const resultats = new Map();

  /* --- Grille : état de l'alphabet et ajouts organiques ------------------- */

  let alphabetPose = {};
  const ajoutes = [];

  /**
   * Un mot tapé dans un indice part en file de découverte et ne rejoint
   * JAMAIS la session en cours : il attend la suivante (README §3.5).
   */
  const ajouterSegment = (segment) => {
    if (ajoutes.length >= AJOUTS_MAX_PAR_PARTIE) return;
    ajoutes.push(motDepuisSegment({
      segment,
      id: prochainIdPerso([...(state.perso ?? []), ...ajoutes]),
      origine_partie: session.partie?.id ?? null,
      date: today,
    }));
  };

  /** La partie enrichie de ce que le composant ne peut pas savoir seul. */
  const partieEnrichie = () => {
    if (!session.partie) return null;
    const connus = new Set([...Object.keys(state.words ?? {}),
                            ...(state.perso ?? []).map((m) => m.id)]);
    const indices = {};
    for (const [id, indice] of Object.entries(session.partie.indices ?? {})) {
      indices[id] = {
        ...indice,
        segments: (indice.segments ?? []).map((segment) => ({
          ...segment,
          connu: Boolean(segment.ref && connus.has(segment.ref))
                 || ajoutes.some((m) => m.en === segment.txt),
        })),
      };
    }
    return { ...session.partie, indices, motsResolus: session.mots };
  };

  const corps = document.createElement("div");
  corps.className = "session__body";

  const entete = () => SessionHeader({
    title: TITRES[phases[rang]],
    onHome: () => { taire(); aller("/"); },
    progress: ProgressDots({ total: phases.length, current: rang + 1 }),
  });

  const avancer = () => {
    rang += 1;
    if (rang >= phases.length) return terminer();
    rendre();
  };

  /** Enregistre les verdicts du rappel actif dans l'état, via le Leitner. */
  const enregistrerRappel = (verdicts) => {
    for (const { id, correct } of verdicts) resultats.set(id, correct);
  };

  const terminer = () => {
    taire();
    let suivant = { ...state, words: { ...state.words } };

    if (session.partie) suivant = marquerPartieJouee(suivant, session.partie.id);
    if (ajoutes.length) {
      suivant = ajouterMotsPerso(suivant, ajoutes);
      suivant = {
        ...suivant,
        progression: {
          ...suivant.progression,
          ajouts_aujourdhui: Number(suivant.progression.ajouts_aujourdhui ?? 0) + ajoutes.length,
        },
      };
    }

    for (const mot of session.mots) {
      const fiche = suivant.words[mot.id] ?? ficheInitiale(today);
      const correct = resultats.get(mot.id);
      suivant.words[mot.id] = correct === undefined
        // Mot découvert mais non testé : il entre dans le circuit sans verdict.
        ? { ...fiche, st: "actif", r: fiche.r ?? today }
        : appliquerResultat(fiche, { succes: correct, date: today });
    }

    suivant = retirerDeLaFile(suivant, session.nouveaux.map((m) => m.id));
    suivant = cloturerSession(suivant, today);
    enregistrer(suivant);
    aller("/");
  };

  const rendre = () => {
    el.replaceChildren();
    // La grille prend toute la hauteur : le clavier reste ancré en bas (§17.1).
    el.classList.toggle("session--grille", phases[rang] === "grille");
    el.append(entete());
    corps.replaceChildren();
    el.append(corps);

    switch (phases[rang]) {
      case "decouverte":
        corps.append(DiscoveryDeck({ words: session.nouveaux, onComplete: avancer }));
        break;

      case "ancrage": {
        const candidats = [...contenu.mots.values()];
        const questions = session.nouveaux.map((mot) => ({
          ...mot, ...construireQCM(mot, candidats),
        }));
        corps.append(AnchorDeck({ words: questions, onComplete: avancer }));
        break;
      }

      case "grille":
        corps.append(CodewordBoard({
          partie: partieEnrichie(),
          alphabetState: alphabetPose,
          onLetterInput: ({ alphabetState }) => { alphabetPose = alphabetState; },
          onComplete: avancer,
          onAddWord: ajouterSegment,
        }));
        break;

      case "bilan":
        corps.append(EndCard({
          partie: session.partie, words: session.mots, onContinue: avancer,
        }));
        break;

      case "rappel":
        corps.append(RecallDeck({
          items: session.mots.map(construireRappel),
          onComplete: (verdicts) => { enregistrerRappel(verdicts); avancer(); },
        }));
        break;

      case "file": {
        if (!ajoutes.length) return terminer();
        corps.append(QueueSummary({ words: ajoutes, onClose: terminer }));
        break;
      }
    }
  };

  rendre();
  return el;
}

/** État vide : message et action alternative, jamais un cul-de-sac (§11). */
function ecranVide(el, aller) {
  const vide = document.createElement("div");
  vide.className = "ecran__empty";

  const message = document.createElement("p");
  message.className = "ecran__empty-text";
  message.textContent = "Rien à travailler aujourd'hui.";
  vide.append(message);

  vide.append(Button({ label: "Retour à l'accueil", fullWidth: true,
                       onClick: () => aller("/") }));
  el.append(vide);
  return el;
}
