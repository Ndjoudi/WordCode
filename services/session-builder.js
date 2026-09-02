/**
 * session-builder.js — composition d'une session (README §3.1, §3.3, §17.8).
 *
 * Toute la logique de sélection vit ici. Les écrans se contentent d'appeler
 * ces fonctions et de passer le résultat aux organisms.
 */

import { aujourdhui, fileDeRevision, estDue, FORMES_VERBE,
         appliquerResultatVerbe } from "./leitner.js";
import { normaliser } from "./normalize.js";

/** Composition standard d'une session, à partir du palier 2 (README §3.3). */
export const NOUVEAUX_PAR_SESSION = 2;
export const REVISION_PAR_SESSION = 3;
export const MOTS_PAR_SESSION = NOUVEAUX_PAR_SESSION + REVISION_PAR_SESSION;

/** Nombre d'options d'un QCM d'ancrage (README §3.2). */
export const OPTIONS_QCM = 4;

/** Plafond d'ajouts organiques par partie (README §3.5). */
export const AJOUTS_MAX_PAR_PARTIE = 3;

/* -------------------------------------------------------------------------- */
/* File de découverte (README §3.1)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Mots à découvrir, dans l'ordre imposé par la §3.1 :
 *   1. mots ajoutés organiquement lors des sessions précédentes
 *   2. mots saisis manuellement
 *   3. mots du palier courant
 *
 * Un mot déjà rencontré — présent dans `state.words` — n'y figure plus.
 *
 * @param {object} state
 * @param {Map<string,object>} catalogue  mots des paliers chargés
 * @returns {object[]}
 */
export function fileDecouverte(state, catalogue) {
  const connus = new Set(Object.keys(state?.words ?? {}));
  const perso = new Map((state?.perso ?? []).map((mot) => [mot.id, mot]));
  const vus = new Set();
  const file = [];

  const ajouter = (mot) => {
    if (!mot || connus.has(mot.id) || vus.has(mot.id)) return;
    vus.add(mot.id);
    file.push(mot);
  };

  // 1 et 2 — la file explicite, dans l'ordre où elle a été remplie.
  // L'organique y entre en premier : c'est un mot sur lequel l'utilisateur a
  // réellement buté pendant une grille, il passe donc en priorité (§3.1).
  const explicite = state?.progression?.file_decouverte ?? [];
  for (const id of explicite) ajouter(perso.get(id) ?? catalogue?.get(id));

  const organiques = [...perso.values()].filter((m) => m.source === "organique");
  const manuels = [...perso.values()].filter((m) => m.source === "perso");
  for (const mot of organiques) ajouter(mot);
  for (const mot of manuels) ajouter(mot);

  // 3 — les mots du palier courant, dans l'ordre de fréquence.
  const palier = Number(state?.progression?.palier_actuel ?? 1);
  const duPalier = [...(catalogue?.values() ?? [])]
    .filter((mot) => Number(mot.palier) === palier)
    .sort((a, b) => Number(a.rang_freq ?? 0) - Number(b.rang_freq ?? 0));
  for (const mot of duPalier) ajouter(mot);

  return file;
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Objectif de composition. Le palier 1 fait exception : rien n'est encore
 * acquis, ses sessions sont donc faites de 5 mots nouveaux (README §17.8).
 * @param {number} palier
 * @returns {{nouveaux:number, revision:number}}
 */
export function objectifComposition(palier) {
  return Number(palier) === 1
    ? { nouveaux: MOTS_PAR_SESSION, revision: 0 }
    : { nouveaux: NOUVEAUX_PAR_SESSION, revision: REVISION_PAR_SESSION };
}

/**
 * Première partie jouable : jamais jouée, vérifiée, et dont les cinq mots sont
 * tous au catalogue chargé.
 *
 * @param {object} state
 * @param {object[]} parties
 * @param {Map<string,object>} catalogue
 * @returns {?object}
 */
export function choisirPartie(state, parties = [], catalogue) {
  const jouees = new Set(state?.progression?.parties_jouees ?? []);
  return parties.find((partie) =>
    !jouees.has(partie.id)
    && partie.verifie === true
    && partie.mots.every((id) => catalogue?.has(id))) ?? null;
}

/**
 * Marque une partie comme jouée.
 * @param {object} state
 * @param {string} id
 * @returns {object} nouvel état
 */
export function marquerPartieJouee(state, id) {
  const jouees = state?.progression?.parties_jouees ?? [];
  if (!id || jouees.includes(id)) return state;
  return {
    ...state,
    progression: { ...state.progression, parties_jouees: [...jouees, id] },
  };
}

/**
 * Compose la session du jour.
 *
 * Quand une partie est disponible, c'est ELLE qui fixe les cinq mots : ses
 * `mots` sont figés à la génération, on ne peut pas lui imposer une sélection
 * calculée. Les mots jamais rencontrés deviennent les nouveaux de la phase 1,
 * les autres sont la révision — c'est mécaniquement la règle « 2 nouveaux /
 * 3 acquis » de la §3.3, et les 5 nouveaux du palier 1 de la §17.8.
 *
 * Sans partie disponible, on retombe sur la sélection par file de découverte
 * et Leitner, sans grille.
 *
 * Si aucun mot nouveau n'est disponible, les phases 1 et 2 sont sautées et la
 * session se remplit de révisions (README §11).
 *
 * @param {object} options
 * @param {object} options.state
 * @param {Map<string,object>} options.catalogue
 * @param {object[]} options.parties
 * @param {string} options.today
 * @returns {{nouveaux:object[], revision:object[], mots:object[],
 *            partie:?object, vide:boolean}}
 */
export function composerSession({ state, catalogue, parties = [],
                                  today = aujourdhui() } = {}) {
  const partie = choisirPartie(state, parties, catalogue);

  if (partie) {
    const connus = new Set(Object.keys(state?.words ?? {}));
    const mots = partie.mots.map((id) => catalogue.get(id));
    return {
      partie,
      nouveaux: mots.filter((mot) => !connus.has(mot.id)),
      revision: mots.filter((mot) => connus.has(mot.id)),
      mots,
      vide: false,
    };
  }

  return { ...composerSessionSansGrille({ state, catalogue, today }), partie: null };
}

/** Sélection de repli, quand plus aucune partie n'est jouable. */
function composerSessionSansGrille({ state, catalogue, today = aujourdhui() } = {}) {
  const objectif = objectifComposition(state?.progression?.palier_actuel ?? 1);

  const nouveaux = fileDecouverte(state, catalogue).slice(0, objectif.nouveaux);

  // La requête unique de la §4, restreinte aux mots : les verbes ont leur
  // propre écran et ne se mélangent pas aux sessions de vocabulaire.
  const dus = fileDeRevision(state, today).filter((entree) => entree.type === "word");
  const perso = new Map((state?.perso ?? []).map((mot) => [mot.id, mot]));

  const revision = dus
    .map((entree) => catalogue?.get(entree.id) ?? perso.get(entree.id))
    .filter(Boolean)
    .slice(0, MOTS_PAR_SESSION - nouveaux.length);

  const mots = [...nouveaux, ...revision];
  return { nouveaux, revision, mots, vide: mots.length === 0 };
}

/* -------------------------------------------------------------------------- */
/* Exercices                                                                   */
/* -------------------------------------------------------------------------- */

/** Lettres communes à deux mots, pour mesurer une proximité graphique. */
function lettresCommunes(a, b) {
  const restantes = [...String(b).toLowerCase()];
  let compte = 0;
  for (const lettre of String(a).toLowerCase()) {
    const rang = restantes.indexOf(lettre);
    if (rang !== -1) {
      restantes.splice(rang, 1);
      compte += 1;
    }
  }
  return compte;
}

/**
 * Proximité graphique entre deux mots anglais. Plus c'est haut, plus le
 * distracteur est trompeur — c'est ce que demande la §3.2 (MENU / MEAL /
 * MEET / MELT), pas des options éliminables d'un coup d'œil.
 */
export function proximite(a, b) {
  const x = String(a ?? "").toLowerCase();
  const y = String(b ?? "").toLowerCase();
  if (!x || !y || x === y) return -1;

  let score = lettresCommunes(x, y) * 2;
  if (x.length === y.length) score += 4;
  else score -= Math.abs(x.length - y.length);
  if (x[0] === y[0]) score += 3;
  if (x.at(-1) === y.at(-1)) score += 1;
  return score;
}

/**
 * QCM d'ancrage : on montre le sens français, on fait reconnaître la forme
 * anglaise parmi des distracteurs graphiquement proches (README §3.2).
 *
 * @param {object} mot
 * @param {Iterable<object>} candidats  mots disponibles pour les distracteurs
 * @param {Function} melanger           injectable, pour des tests reproductibles
 * @returns {{question:string, options:Array<{id:string,label:string}>, correctId:string}}
 */
export function construireQCM(mot, candidats = [], melanger = melangerParDefaut) {
  const distracteurs = [...candidats]
    .filter((c) => c.id !== mot.id && c.en)
    .sort((a, b) => proximite(mot.en, b.en) - proximite(mot.en, a.en))
    .slice(0, OPTIONS_QCM - 1);

  const options = melanger([mot, ...distracteurs]
    .map((c) => ({ id: c.id, label: String(c.en).toUpperCase() })));

  return { question: mot.fr, options, correctId: mot.id };
}

function melangerParDefaut(tableau) {
  const copie = [...tableau];
  for (let i = copie.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

/**
 * Exercice de rappel actif (README §3.4).
 *
 * Pour les mots `perso` et `organique`, on utilise la phrase source à trous
 * plutôt que la traduction isolée : l'ancrage épisodique vaut mieux.
 *
 * @param {object} mot
 * @returns {{type:string, mot:object, prompt?:string, expected:string,
 *            sentence?:string, blankIndex?:number, translation?:string}}
 */
export function construireRappel(mot) {
  const contextuel = (mot.source === "perso" || mot.source === "organique")
    && typeof mot.phrase_en === "string" && mot.phrase_en.trim().length > 0;

  if (contextuel) {
    const mots = mot.phrase_en.trim().split(/\s+/);
    const cible = String(mot.en).toLowerCase();
    const rang = mots.findIndex((m) => m.toLowerCase().replace(/[^a-z']/g, "") === cible);
    return {
      type: "cloze",
      mot,
      sentence: mot.phrase_en.trim(),
      blankIndex: rang === -1 ? 0 : rang,
      expected: mot.en,
      translation: mot.phrase_fr ?? mot.fr,
    };
  }

  return { type: "input", mot, prompt: mot.fr, expected: mot.en };
}

/* -------------------------------------------------------------------------- */
/* Filière verbes irréguliers (README §2.2, §3.6, §4)                          */
/* -------------------------------------------------------------------------- */

/** Les quatre familles de patterns de la §2.2, dans l'ordre d'apprentissage. */
export const GROUPES_VERBE = {
  1: { code: "G1", titre: "Invariables", pattern: "A-A-A" },
  2: { code: "G2", titre: "En -ought / -aught", pattern: "" },
  3: { code: "G3", titre: "Deux formes identiques", pattern: "A-B-B" },
  4: { code: "G4", titre: "Trois formes différentes", pattern: "A-B-C" },
};

/**
 * Seuil de passage au groupe suivant. Le README ne le fixe que pour les
 * paliers (§2.1, 80 % en boîte 3+) ; on applique la même règle aux groupes de
 * verbes, en comptant les DEUX formes séparément.
 */
export const SEUIL_GROUPE = 0.8;

/**
 * Composition d'une session de verbes.
 *
 * L'ordre est celui des patterns, jamais l'alphabet (§2.2) : on reste dans le
 * groupe courant. Les formes dues passent avant les verbes jamais vus, et un
 * verbe n'apparaît qu'une fois dans la file même si ses deux formes sont dues
 * — c'est `VerbTriad` qui les redemande toutes les deux.
 *
 * @param {object} options
 * @param {object} options.state
 * @param {object[]} options.verbes  catalogue complet de la filière
 * @param {string} options.today
 * @returns {{groupe:number, file:object[], nouveaux:object[], dus:object[],
 *            duGroupe:object[], vide:boolean}}
 */
export function composerSessionVerbes({ state, verbes = [], today = aujourdhui() } = {}) {
  const groupe = Number(state?.progression?.groupe_verbe_actuel ?? 1);
  const duGroupe = verbes.filter((v) => Number(v.groupe_verbe) === groupe);
  const fiches = state?.verbes ?? {};

  const dus = duGroupe.filter((verbe) => {
    const formes = fiches[verbe.id];
    if (!formes) return false;
    return FORMES_VERBE.some((forme) => estDue(formes[forme], today));
  });

  const nouveaux = duGroupe.filter((verbe) => !fiches[verbe.id]);

  return {
    groupe,
    duGroupe,
    dus,
    nouveaux,
    file: [...dus, ...nouveaux],
    vide: dus.length === 0 && nouveaux.length === 0,
  };
}

/**
 * Enregistre le résultat d'un `VerbTriad`. Les deux formes montent ou
 * redescendent indépendamment (README §4).
 *
 * @param {object} state
 * @param {string} id
 * @param {{preteritCorrect:boolean, participeCorrect:boolean, date?:string}} verdict
 * @returns {object} nouvel état
 */
export function appliquerVerbe(state, id, { preteritCorrect, participeCorrect,
                                            date = aujourdhui() } = {}) {
  const formes = state?.verbes?.[id] ?? {};
  return {
    ...state,
    verbes: {
      ...state.verbes,
      [id]: {
        preterit: appliquerResultatVerbe(formes.preterit, { succes: preteritCorrect, date }),
        participe: appliquerResultatVerbe(formes.participe, { succes: participeCorrect, date }),
      },
    },
  };
}

/**
 * Avancement du groupe courant : part des formes en boîte 3 ou plus.
 *
 * `depasse` dit qu'on peut passer au groupe suivant : soit le seuil est
 * atteint, soit le groupe ne contient aucun verbe — sans quoi un groupe vide
 * bloquerait définitivement la progression.
 *
 * @param {object} state
 * @param {object[]} duGroupe
 * @returns {{formes:number, acquises:number, part:number,
 *            termine:boolean, depasse:boolean}}
 */
export function avancementGroupe(state, duGroupe = []) {
  const fiches = state?.verbes ?? {};
  const formes = duGroupe.length * FORMES_VERBE.length;
  let acquises = 0;

  for (const verbe of duGroupe) {
    for (const forme of FORMES_VERBE) {
      if (Number(fiches[verbe.id]?.[forme]?.b ?? 0) >= 3) acquises += 1;
    }
  }

  const part = formes ? acquises / formes : 0;
  const termine = formes > 0 && part >= SEUIL_GROUPE;
  return { formes, acquises, part, termine, depasse: termine || formes === 0 };
}

/**
 * Passe au groupe de patterns suivant, s'il en reste un.
 * @param {object} state
 * @returns {object} nouvel état
 */
export function avancerGroupe(state) {
  const courant = Number(state?.progression?.groupe_verbe_actuel ?? 1);
  const suivant = Math.min(courant + 1, Object.keys(GROUPES_VERBE).length);
  if (suivant === courant) return state;
  return {
    ...state,
    progression: { ...state.progression, groupe_verbe_actuel: suivant },
  };
}

/* -------------------------------------------------------------------------- */
/* Capture manuelle (README §2.5, §5.2, §14)                                   */
/* -------------------------------------------------------------------------- */

/** Taille d'un palier de fréquence (README §2.1). */
export const MOTS_PAR_PALIER = 50;

/** NGSL : 2800 mots, soit 56 paliers. */
export const PALIER_MAX = 56;

/**
 * Écart de paliers à partir duquel on prévient l'utilisateur qu'un mot est
 * très au-dessus de son niveau (README §14). Un seul palier d'avance est
 * banal ; deux méritent un mot.
 */
export const ECART_PALIER_ALERTE = 2;

/**
 * Palier de fréquence correspondant à un rang NGSL.
 * @param {?number} rang
 * @returns {?number}
 */
export function palierPourRang(rang) {
  const valeur = Number(rang);
  if (!Number.isFinite(valeur) || valeur < 1) return null;
  return Math.min(Math.ceil(valeur / MOTS_PAR_PALIER), PALIER_MAX);
}

/**
 * Cherche une entrée existante pour un mot anglais, au catalogue comme dans
 * les mots perso. Sert la détection de polysémie de la §5.2.
 *
 * @param {string} en
 * @param {{catalogue?:Map<string,object>, perso?:object[]}} sources
 * @returns {?object}
 */
export function trouverExistant(en, { catalogue, perso = [] } = {}) {
  const cible = normaliser(en);
  if (!cible) return null;

  for (const mot of perso) {
    if (normaliser(mot.en) === cible) return mot;
  }
  for (const mot of catalogue?.values() ?? []) {
    if (normaliser(mot.en) === cible) return mot;
  }
  return null;
}

/**
 * Identifiant perso libre, préfixe `p_` (README §5.1).
 * @param {object[]} perso
 * @returns {string}
 */
export function prochainIdPerso(perso = []) {
  const rangs = perso
    .map((mot) => Number(String(mot.id ?? "").replace(/^p_/, "")))
    .filter(Number.isFinite);
  const suivant = (rangs.length ? Math.max(...rangs) : 0) + 1;
  return `p_${String(suivant).padStart(5, "0")}`;
}

/**
 * Construit une entité `word` complète à partir d'un mot renvoyé par l'API.
 *
 * La phrase capturée est conservée : elle sert d'exercice à trous en rappel
 * actif plutôt que la traduction isolée (README §3.4).
 *
 * Une entrée par sens (§5.2) : si le mot existe déjà, la nouvelle entrée
 * partage sa `famille` et incrémente `sens_index`.
 *
 * @param {object} options
 * @param {object} options.mot       entrée renvoyée par l'API
 * @param {string} options.phrase_en
 * @param {string} options.phrase_fr
 * @param {?object} options.existant
 * @param {string} options.id
 * @param {string} options.date
 * @returns {object}
 */
export function motDepuisTraduction({ mot, phrase_en = null, phrase_fr = null,
                                      existant = null, id, date = aujourdhui() }) {
  const en = String(mot.en ?? "").trim();
  return {
    id,
    en,
    fr: mot.fr ?? "",
    type: mot.type ?? null,
    source: "perso",
    phonetique: mot.phonetique ?? null,

    famille: existant?.famille ?? en,
    sens_index: existant ? Number(existant.sens_index ?? 1) + 1 : 1,

    rang_freq: Number.isFinite(Number(mot.rang_freq)) ? Number(mot.rang_freq) : null,
    palier: null,
    themes: [],
    def_en: mot.def_en ?? null,
    exemple_en: null,
    exemple_fr: null,

    phrase_en,
    phrase_fr,
    date_capture: date,
    origine_partie: null,

    preterit: null,
    participe: null,
    groupe_verbe: null,

    famille_expr: null,
    verbe_base: null,
    particule: null,
    litteral: null,

    eligible_grille: /^[A-Za-z]{3,8}$/.test(en),
    eligible_phrase_cachee: false,
  };
}

/**
 * Construit un mot `organique` à partir d'un segment d'indice tappé (§3.5).
 *
 * @param {object} options
 * @param {{txt:string, trad:string}} options.segment
 * @param {string} options.id
 * @param {?string} options.origine_partie
 * @param {string} options.date
 * @returns {object}
 */
export function motDepuisSegment({ segment, id, origine_partie = null,
                                   date = aujourdhui() }) {
  // Le segment porte la casse de la phrase : « Very » en tête d'indice n'est
  // pas une entrée de vocabulaire valable. On redescend en minuscules.
  const mot = motDepuisTraduction({
    mot: { en: String(segment.txt ?? "").toLowerCase(), fr: segment.trad },
    id,
    date,
  });
  return { ...mot, source: "organique", origine_partie };
}

/**
 * Ajoute des mots perso à l'état et les place en file de découverte.
 * Ils seront découverts à la prochaine session, jamais dans celle en cours.
 *
 * @param {object} state
 * @param {object[]} mots
 * @returns {object} nouvel état
 */
export function ajouterMotsPerso(state, mots = []) {
  if (!mots.length) return state;
  return {
    ...state,
    perso: [...(state.perso ?? []), ...mots],
    progression: {
      ...state.progression,
      file_decouverte: [
        ...(state.progression?.file_decouverte ?? []),
        ...mots.map((mot) => mot.id),
      ],
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Cycle de vie de la progression                                              */
/* -------------------------------------------------------------------------- */

/**
 * Remet à zéro ce qui est journalier. À appeler au démarrage.
 * @param {object} state
 * @param {string} today
 * @returns {object} nouvel état
 */
export function demarrerJournee(state, today = aujourdhui()) {
  if (state?.progression?.derniere_session === today) return state;
  return {
    ...state,
    progression: { ...state.progression, ajouts_aujourdhui: 0 },
  };
}

/**
 * Clôt une session : série et date de dernière session.
 * La série augmente si la session précédente était hier, se maintient si
 * elle était aujourd'hui, repart à 1 sinon.
 *
 * @param {object} state
 * @param {string} today
 * @returns {object} nouvel état
 */
export function cloturerSession(state, today = aujourdhui()) {
  const derniere = state?.progression?.derniere_session ?? null;
  if (derniere === today) return state;

  const hier = (() => {
    const [a, m, j] = today.split("-").map(Number);
    const date = new Date(a, m - 1, j, 12);
    date.setDate(date.getDate() - 1);
    return aujourdhui(date);
  })();

  const streak = derniere === hier ? Number(state.progression.streak ?? 0) + 1 : 1;

  return {
    ...state,
    progression: { ...state.progression, streak, derniere_session: today },
  };
}

/**
 * Retire de la file de découverte les mots qui viennent d'être découverts.
 * @param {object} state
 * @param {string[]} ids
 * @returns {object} nouvel état
 */
export function retirerDeLaFile(state, ids) {
  const retires = new Set(ids);
  return {
    ...state,
    progression: {
      ...state.progression,
      file_decouverte: (state.progression?.file_decouverte ?? [])
        .filter((id) => !retires.has(id)),
    },
  };
}
