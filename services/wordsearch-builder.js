/**
 * wordsearch-builder.js — section §10 « Mots mêlés » (README §2, §14).
 *
 * Les mots anglais sont cachés dans la grille, mais la liste à trouver est en
 * français — ou en définition anglaise, au choix. On ne cherche donc pas des
 * formes de lettres : il faut d'abord se rappeler le mot, puis son orthographe.
 * Les lettres qui restent, lues dans l'ordre, forment une expression.
 *
 * Comme pour la grille et les mots croisés, ce service **sélectionne** des
 * grilles produites hors ligne (README §17, règle 9) ; il ne génère rien.
 *
 * Fonctions pures. `controlerGrille` sert aussi au générateur, sous Node.
 */

import { aujourdhui, appliquerResultat, motsConnus } from "./leitner.js";

/** Les deux façons de présenter la liste à trouver. */
export const MODES_INDICE = ["fr", "def"];

/** Mots validés au quizz nécessaires avant d'ouvrir la section. */
export const MOTS_CONNUS_MIN = 5;

/** Sens de lecture des grilles livrées : droite, bas, diagonale descendante. */
export const SENS = [[1, 0], [0, 1], [1, 1]];

const lettresDe = (texte) => String(texte ?? "").toUpperCase().replace(/[^A-Z]/g, "");
const cle = ([x, y]) => `${x},${y}`;

/* -------------------------------------------------------------------------- */
/* Géométrie                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Cases d'un mot placé.
 *
 * @param {{x:number, y:number, dx:number, dy:number}} placement
 * @param {object} mot  entité word
 * @returns {Array<[number, number]>}
 */
export function cellulesDuMot(placement, mot) {
  const longueur = lettresDe(mot?.en).length;
  return Array.from({ length: longueur },
    (_, i) => [placement.x + placement.dx * i, placement.y + placement.dy * i]);
}

/**
 * Cases d'une ligne droite entre deux cases : horizontale, verticale ou
 * diagonale, dans n'importe quel sens. Null si les deux cases ne sont pas
 * alignées.
 *
 * @param {[number, number]} debut
 * @param {[number, number]} fin
 * @returns {?Array<[number, number]>}
 */
export function cheminEntre(debut, fin) {
  const dx = fin[0] - debut[0];
  const dy = fin[1] - debut[1];
  if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return null;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  return Array.from({ length: n + 1 },
    (_, i) => [debut[0] + Math.sign(dx) * i, debut[1] + Math.sign(dy) * i]);
}

/**
 * Le mot que désigne un chemin, s'il en recouvre exactement un.
 *
 * On compare des cases, pas des lettres : un mot n'existe qu'une fois dans la
 * grille (le générateur le garantit), et c'est sa place qui compte. Le chemin
 * peut être tracé dans les deux sens.
 *
 * @param {object} grille
 * @param {?Array<[number, number]>} chemin
 * @param {Map<string,object>} mots
 * @param {Set<string>} trouves
 * @returns {?string} id du mot
 */
export function motSurChemin(grille, chemin, mots, trouves = new Set()) {
  if (!chemin || chemin.length < 2) return null;
  const trace = chemin.map(cle).join("|");
  const envers = [...chemin].reverse().map(cle).join("|");

  for (const placement of grille?.mots ?? []) {
    if (trouves.has(placement.id)) continue;
    const cases = cellulesDuMot(placement, mots.get(placement.id)).map(cle).join("|");
    if (cases === trace || cases === envers) return placement.id;
  }
  return null;
}

/**
 * Cases qui n'appartiennent à aucun mot, dans l'ordre de lecture : ce sont
 * elles qui forment l'expression mystère.
 *
 * @param {object} grille
 * @param {Map<string,object>} mots
 * @returns {Array<[number, number]>}
 */
export function casesMystere(grille, mots) {
  const couvertes = new Set(
    (grille?.mots ?? []).flatMap((p) => cellulesDuMot(p, mots.get(p.id)).map(cle)));
  const taille = grille?.lignes?.length ?? 0;
  const restes = [];
  for (let y = 0; y < taille; y += 1) {
    for (let x = 0; x < taille; x += 1) if (!couvertes.has(cle([x, y]))) restes.push([x, y]);
  }
  return restes;
}

/**
 * Contrôle complet d'une grille : chaque mot est à sa place et n'apparaît
 * qu'une fois, et les lettres restantes forment exactement l'expression.
 *
 * @param {object} grille
 * @param {Map<string,object>} mots
 * @returns {string[]} problèmes, vide si la grille est bonne
 */
export function controlerGrille(grille, mots) {
  const id = grille?.id ?? "grille sans id";
  const lignes = grille?.lignes ?? [];
  const taille = lignes.length;
  if (!taille || lignes.some((l) => l.length !== taille || !/^[A-Z]+$/.test(l))) {
    return [`${id} : grille mal formée`];
  }

  const problemes = [];
  for (const p of grille.mots ?? []) {
    const mot = mots.get(p.id);
    if (!mot) { problemes.push(`${id} : mot ${p.id} absent du catalogue`); continue; }
    const en = lettresDe(mot.en);
    const lu = cellulesDuMot(p, mot).map(([x, y]) => lignes[y]?.[x] ?? "").join("");
    if (lu !== en) problemes.push(`${id} : ${en} n'est pas à sa place`);
    // Une deuxième occurrence laisserait trouver le mot au mauvais endroit.
    else if (occurrences(lignes, en) !== 1) problemes.push(`${id} : ${en} apparaît plusieurs fois`);
  }

  const reste = casesMystere(grille, mots).map(([x, y]) => lignes[y][x]).join("");
  if (reste !== lettresDe(grille.phrase_en)) {
    problemes.push(`${id} : les lettres restantes ne forment pas « ${grille.phrase_en} »`);
  }
  return problemes;
}

function occurrences(lignes, mot) {
  const taille = lignes.length;
  let n = 0;
  for (const [dx, dy] of SENS) {
    for (let y = 0; y < taille; y += 1) {
      for (let x = 0; x < taille; x += 1) {
        let i = 0;
        while (i < mot.length && lignes[y + dy * i]?.[x + dx * i] === mot[i]) i += 1;
        if (i === mot.length) n += 1;
      }
    }
  }
  return n;
}

/* -------------------------------------------------------------------------- */
/* Sélection                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Grilles dont TOUS les mots sont connus : les jeux révisent, ils n'enseignent
 * pas (§1).
 *
 * @param {object[]} grilles
 * @param {Set<string>} connus
 * @returns {object[]}
 */
export function grillesJouables(grilles = [], connus = new Set()) {
  return grilles.filter((g) => g?.verifie === true
    && (g.mots ?? []).length > 0
    && g.mots.every((p) => connus.has(p.id)));
}

/**
 * Choisit une grille jouable, jamais servie si possible. Quand tout a été
 * servi, le cycle recommence plutôt que de laisser la section vide.
 *
 * @param {object} options
 * @param {object} options.state
 * @param {object[]} options.grilles
 * @param {Function} options.tirer  injectable pour les tests
 * @returns {{verrouille:boolean, raison:?string, grille:?object, state:object,
 *            reinitialise:boolean, disponibles:number}}
 */
export function choisirGrille({ state, grilles = [], tirer = tirerAuHasard } = {}) {
  const connus = new Set(motsConnus(state));
  if (connus.size < MOTS_CONNUS_MIN) {
    return { verrouille: true, grille: null, state, reinitialise: false, disponibles: 0,
             raison: `Il faut au moins ${MOTS_CONNUS_MIN} mots validés au quizz pour jouer.` };
  }

  const jouables = grillesJouables(grilles, connus);
  if (!jouables.length) {
    return { verrouille: true, grille: null, state, reinitialise: false, disponibles: 0,
             raison: "Aucune grille ne tient encore avec les mots que tu connais." };
  }

  const servies = new Set(state?.progression?.mots_meles_servis ?? []);
  let candidates = jouables.filter((g) => !servies.has(g.id));
  let courant = state;
  let reinitialise = false;
  if (!candidates.length) {
    courant = { ...state, progression: { ...state.progression, mots_meles_servis: [] } };
    candidates = jouables;
    reinitialise = true;
  }

  return { verrouille: false, raison: null, grille: tirer(candidates),
           state: courant, reinitialise, disponibles: candidates.length };
}

/**
 * Nombre de grilles encore disponibles, sans rien tirer. Sert à la carte de
 * l'accueil.
 *
 * @param {object} state
 * @param {object[]} grilles
 * @returns {number}
 */
export function grillesDisponibles(state, grilles = []) {
  const connus = new Set(motsConnus(state));
  if (connus.size < MOTS_CONNUS_MIN) return 0;
  const jouables = grillesJouables(grilles, connus);
  const servies = new Set(state?.progression?.mots_meles_servis ?? []);
  const restantes = jouables.filter((g) => !servies.has(g.id));
  return restantes.length || jouables.length;
}

/* -------------------------------------------------------------------------- */
/* Partie                                                                      */
/* -------------------------------------------------------------------------- */

/** Façon de présenter la liste à trouver : « fr » par défaut. */
export function modeIndice(state) {
  const mode = state?.progression?.indice_mots_meles;
  return MODES_INDICE.includes(mode) ? mode : "fr";
}

/**
 * Enregistre la façon de présenter la liste.
 *
 * @param {object} state
 * @param {string} mode
 * @returns {object} nouvel état
 */
export function choisirModeIndice(state, mode) {
  if (!MODES_INDICE.includes(mode) || modeIndice(state) === mode) return state;
  return { ...state, progression: { ...state.progression, indice_mots_meles: mode } };
}

/**
 * Ce qui s'affiche dans la liste à la place du mot anglais.
 *
 * @param {object} mot
 * @param {string} mode  « fr » ou « def »
 * @returns {string}
 */
export function texteIndice(mot, mode = "fr") {
  if (mode === "def" && mot?.indice?.en) return mot.indice.en;
  return mot?.fr ?? "";
}

/**
 * Indice : la première case d'un mot pas encore trouvé. Le mot aidé ne
 * montera pas de boîte, comme dans la grille (§5).
 *
 * @param {object} grille
 * @param {Set<string>} trouves
 * @param {Function} tirer
 * @returns {?{id:string, x:number, y:number}}
 */
export function indiceGrille(grille, trouves = new Set(), tirer = tirerAuHasard) {
  const restants = (grille?.mots ?? []).filter((p) => !trouves.has(p.id));
  if (!restants.length) return null;
  const p = tirer(restants);
  return { id: p.id, x: p.x, y: p.y };
}

/**
 * Applique le résultat d'une grille terminée : chaque mot monte d'une boîte,
 * sauf ceux pour lesquels un indice a été demandé.
 *
 * @param {object} options
 * @param {object} options.state
 * @param {object} options.grille
 * @param {string[]} options.aides
 * @param {string} options.today
 * @returns {object} nouvel état
 */
export function appliquerGrille({ state, grille, aides = [], today = aujourdhui() } = {}) {
  if (!grille) return state;
  const aidees = new Set(aides);
  const words = { ...state.words };
  for (const { id } of grille.mots ?? []) {
    words[id] = appliquerResultat(words[id], {
      succes: true, traductionConsultee: aidees.has(id), date: today,
    });
  }

  const servies = state?.progression?.mots_meles_servis ?? [];
  return {
    ...state,
    words,
    progression: {
      ...state.progression,
      mots_meles_servis: servies.includes(grille.id) ? servies : [...servies, grille.id],
      derniere_session: today,
    },
  };
}

function tirerAuHasard(liste) {
  return liste[Math.floor(Math.random() * liste.length)];
}
