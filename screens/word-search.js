import { SessionHeader } from "../components/molecules/session-header.js";
import { Button } from "../components/atoms/button.js";
import { ProgressDots } from "../components/atoms/progress-dots.js";
import { WordSearchBoard } from "../components/organisms/word-search-board.js";
import { EndCard } from "../components/organisms/end-card.js";
import { vide } from "./game.js";
import { choisirGrille, motSurChemin, cheminEntre, cellulesDuMot, casesMystere,
         indiceGrille, appliquerGrille, texteIndice, modeIndice,
         choisirModeIndice } from "../services/wordsearch-builder.js";
import { parler } from "../services/audio.js";
import { aujourdhui } from "../services/leitner.js";

/**
 * WordSearch — section §10 « Mots mêlés » (README §2, §13).
 *
 * La liste est en français, ou en définition anglaise : il faut retrouver le
 * mot anglais de tête avant de le chercher. Quand tous les mots sont trouvés,
 * les lettres restantes forment une expression, révélée avec sa traduction.
 *
 * @param {{state:object, contenu:object, aller:Function, enregistrer:Function}} contexte
 * @returns {HTMLElement}
 */
export function WordSearch({ state, contenu, aller, enregistrer }) {
  const el = document.createElement("main");
  el.className = "ecran session session--meles";

  const today = aujourdhui();
  const tirage = choisirGrille({ state, grilles: contenu.motsMeles ?? [] });

  if (tirage.verrouille) {
    el.append(SessionHeader({ title: "Mots mêlés", onHome: () => aller("/") }));
    return vide(el, aller, tirage.raison);
  }

  // Le cycle a pu être rebouclé : on part de l'état renvoyé par le service.
  let base = tirage.state;
  const grille = tirage.grille;
  const mots = contenu.mots;
  const placements = new Map(grille.mots.map((p) => [p.id, p]));

  let mode = modeIndice(base);
  const trouves = new Set();
  /** Mots pour lesquels un indice a été demandé : ils ne monteront pas de boîte. */
  const aides = new Set();
  let indice = null;

  const corps = document.createElement("div");
  corps.className = "session__body";

  const terminer = () => {
    enregistrer(appliquerGrille({ state: base, grille, aides: [...aides], today }));
    aller("/");
  };

  const changerMode = (suivant) => {
    if (suivant === mode) return;
    mode = suivant;
    base = choisirModeIndice(base, suivant);
    // Silencieux : un re-rendu complet tirerait une autre grille.
    enregistrer(base, { silencieux: true });
    rendre();
  };

  const tracer = ({ debut, fin }) => {
    const id = motSurChemin(grille, cheminEntre(debut, fin), mots, trouves);
    if (!id) { navigator.vibrate?.(30); return; }
    trouves.add(id);
    if (indice?.id === id) indice = null;
    rendre();
  };

  const demanderIndice = () => {
    const suivant = indiceGrille(grille, trouves);
    if (!suivant) return;
    aides.add(suivant.id);
    indice = suivant;
    rendre();
  };

  const rendre = () => {
    const termine = trouves.size === grille.mots.length;

    el.replaceChildren();
    el.append(SessionHeader({
      title: "Mots mêlés",
      onHome: () => aller("/"),
      progress: ProgressDots({ total: grille.mots.length, current: trouves.size }),
    }));
    corps.replaceChildren();
    el.append(corps);

    if (!termine) {
      const outils = document.createElement("div");
      outils.className = "word-search-screen__outils";
      outils.append(
        Button({ label: "En français", variant: mode === "fr" ? "secondary" : "ghost",
                 onClick: () => changerMode("fr") }),
        Button({ label: "Définition anglaise", variant: mode === "def" ? "secondary" : "ghost",
                 onClick: () => changerMode("def") }),
        Button({ label: "Indice", variant: "ghost", onClick: demanderIndice }),
      );
      corps.append(outils);

      const consigne = document.createElement("p");
      consigne.className = "word-search-screen__consigne";
      consigne.textContent = "Glisse sur un mot, ou touche sa première puis sa dernière lettre.";
      corps.append(consigne);
    }

    corps.append(WordSearchBoard({
      lignes: grille.lignes,
      trouvees: [...trouves].flatMap((id) => cellulesDuMot(placements.get(id), mots.get(id))),
      mystere: termine ? casesMystere(grille, mots) : null,
      indice: indice ? [indice.x, indice.y] : null,
      items: grille.mots.map(({ id }) => {
        const mot = mots.get(id);
        return { id, texte: texteIndice(mot, mode), trouve: trouves.has(id),
                 en: mot.en, phonetique: mot.phonetique ?? null };
      }),
      onTrace: tracer,
      // Le son ne part que sur demande, jamais à la découverte du mot.
      onEcouter: (id) => parler(mots.get(id)?.en ?? ""),
    }));

    if (termine) {
      corps.append(EndCard({
        partie: grille,
        words: grille.mots.map(({ id }) => mots.get(id)).filter(Boolean),
        actionLabel: "Terminer",
        onContinue: terminer,
      }));
    }
  };

  rendre();
  return el;
}
