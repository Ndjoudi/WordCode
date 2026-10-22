import { Tile } from "../atoms/tile.js";
import { IconButton } from "../atoms/icon-button.js";
import { cheminEntre } from "../../services/wordsearch-builder.js";

/**
 * WordSearchBoard — grille de mots mêlés et liste à trouver (README §10, §12.3).
 *
 * On glisse sur un mot, ou on touche sa première puis sa dernière lettre. Le
 * plateau ne juge rien : il rapporte la ligne tracée, l'écran demande au
 * service quel mot elle désigne.
 *
 * La liste n'affiche jamais le mot anglais avant qu'il soit trouvé : c'est
 * tout l'intérêt du jeu. Une fois trouvé, il apparaît avec sa phonétique et un
 * bouton d'écoute — le son ne part jamais tout seul.
 *
 * @param {string[]} lignes     la grille, une chaîne par ligne
 * @param {Array<[number,number]>} trouvees  cases des mots trouvés
 * @param {?Array<[number,number]>} mystere  cases de l'expression, à la fin
 * @param {?[number,number]} indice  case révélée par un indice
 * @param {Array<{id:string, texte:string, trouve:boolean, en:string, phonetique:?string}>} items
 * @param {Function} onTrace    reçoit { debut, fin }, deux cases [x, y]
 * @param {Function} onEcouter  reçoit l'id d'un mot trouvé
 * @returns {HTMLElement}
 */
export function WordSearchBoard({ lignes = [], trouvees = [], mystere = null, indice = null,
                                  items = [], onTrace, onEcouter } = {}) {
  const el = document.createElement("section");
  el.className = "word-search";

  const grille = document.createElement("div");
  grille.className = "word-search__grid";
  grille.style.setProperty("--word-search-taille", String(lignes.length));
  el.append(grille);

  const cle = ([x, y]) => `${x},${y}`;
  const dejaTrouvees = new Set(trouvees.map(cle));
  const caseMystere = new Set((mystere ?? []).map(cle));
  const caseIndice = indice ? cle(indice) : null;

  const etatDe = (x, y) => {
    const k = cle([x, y]);
    if (caseMystere.has(k)) return "active";
    if (dejaTrouvees.has(k)) return "revealed";
    if (k === caseIndice) return "filled";
    return "empty";
  };

  /** Toutes les cases, indexées par « x,y ». */
  const tuiles = new Map();
  lignes.forEach((ligne, y) => {
    [...ligne].forEach((lettre, x) => {
      const tuile = Tile({ letter: lettre, state: etatDe(x, y) });
      tuile.dataset.x = String(x);
      tuile.dataset.y = String(y);
      tuiles.set(cle([x, y]), tuile);
      grille.append(tuile);
    });
  });

  const termine = Boolean(mystere);
  let debut = null;
  let enAttente = null;
  let glisse = false;

  /** Redonne à chaque case son état, puis marque la ligne en cours de tracé. */
  const surligner = (chemin) => {
    const trace = new Set((chemin ?? []).map(cle));
    for (const [k, tuile] of tuiles) {
      const [x, y] = k.split(",").map(Number);
      tuile.className = `tile tile--${trace.has(k) ? "active" : etatDe(x, y)}`;
    }
  };

  const caseSous = (evenement) => {
    const cible = document.elementFromPoint(evenement.clientX, evenement.clientY)?.closest(".tile");
    if (!cible || !grille.contains(cible)) return null;
    return [Number(cible.dataset.x), Number(cible.dataset.y)];
  };

  const memeCase = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

  const tracer = (a, b) => {
    surligner(null);
    if (onTrace && cheminEntre(a, b)) onTrace({ debut: a, fin: b });
  };

  if (!termine) {
    grille.addEventListener("pointerdown", (e) => {
      const c = caseSous(e);
      if (!c) return;
      e.preventDefault();
      debut = c;
      glisse = true;
      grille.setPointerCapture?.(e.pointerId);
      surligner(enAttente ? cheminEntre(enAttente, c) ?? [c] : [c]);
    });

    grille.addEventListener("pointermove", (e) => {
      if (!glisse) return;
      const c = caseSous(e);
      if (!c) return;
      const chemin = cheminEntre(debut, c);
      if (chemin) surligner(chemin);
    });

    grille.addEventListener("pointerup", (e) => {
      if (!glisse) return;
      glisse = false;
      const c = caseSous(e) ?? debut;

      // Un glissé : la ligne va du point de départ au point d'arrivée.
      if (!memeCase(c, debut)) { enAttente = null; tracer(debut, c); return; }

      // Deux touchers : première lettre, puis dernière.
      if (enAttente && !memeCase(enAttente, c)) {
        const premiere = enAttente;
        enAttente = null;
        tracer(premiere, c);
        return;
      }
      enAttente = c;
      surligner([c]);
    });
  }

  const liste = document.createElement("ul");
  liste.className = "word-search__list";
  for (const item of items) {
    const ligne = document.createElement("li");
    ligne.className = `word-search__item${item.trouve ? " word-search__item--trouve" : ""}`;

    const texte = document.createElement("span");
    texte.className = "word-search__indice";
    texte.textContent = item.texte;
    ligne.append(texte);

    if (item.trouve) {
      const en = document.createElement("span");
      en.className = "word-search__en";
      en.textContent = item.en;
      ligne.append(en);

      if (item.phonetique) {
        const phon = document.createElement("span");
        phon.className = "word-search__phonetique";
        phon.textContent = item.phonetique;
        ligne.append(phon);
      }

      ligne.append(IconButton({ icon: "audio", label: `Écouter ${item.en}`,
                                onClick: () => onEcouter?.(item.id) }));
    }
    liste.append(ligne);
  }
  el.append(liste);

  return el;
}
