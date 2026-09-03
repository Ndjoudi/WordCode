import { SessionHeader } from "../components/molecules/session-header.js";
import { Button } from "../components/atoms/button.js";
import { RecallDeck } from "../components/organisms/recall-deck.js";
import { construireRappel } from "../services/session-builder.js";
import { fileDeRevisionMots, appliquerResultat, aujourdhui } from "../services/leitner.js";

/**
 * Review — révision Leitner seule, hors session (README §11).
 * @param {{state:object, contenu:object, aller:Function, enregistrer:Function}} contexte
 * @returns {HTMLElement}
 */
export function Review({ state, contenu, aller, enregistrer }) {
  const el = document.createElement("main");
  el.className = "ecran review";

  const today = aujourdhui();
  const perso = new Map((state.perso ?? []).map((m) => [m.id, m]));
  const mots = fileDeRevisionMots(state, today)
    .map((entree) => contenu.mots.get(entree.id) ?? perso.get(entree.id))
    .filter(Boolean);

  el.append(SessionHeader({ title: "Révision", onHome: () => aller("/") }));

  if (!mots.length) {
    const vide = document.createElement("div");
    vide.className = "ecran__empty";

    const message = document.createElement("p");
    message.className = "ecran__empty-text";
    message.textContent = "Rien à réviser aujourd'hui.";
    vide.append(message);

    vide.append(Button({ label: "Retour à l'accueil", fullWidth: true,
                         onClick: () => aller("/") }));
    el.append(vide);
    return el;
  }

  const corps = document.createElement("div");
  corps.className = "session__body";
  corps.append(RecallDeck({
    items: mots.map(construireRappel),
    onComplete: (verdicts) => {
      const suivant = { ...state, words: { ...state.words } };
      for (const { id, correct } of verdicts) {
        suivant.words[id] = appliquerResultat(suivant.words[id],
                                              { succes: correct, date: today });
      }
      enregistrer(suivant);
      aller("/");
    },
  }));
  el.append(corps);

  return el;
}
