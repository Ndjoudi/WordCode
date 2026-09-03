/**
 * leitner.js — moteur de répétition espacée (README §4).
 *
 * Aucun accès au stockage, aucun accès au DOM : que du calcul sur des fiches.
 * Un seul format de date dans tout le projet : ISO `YYYY-MM-DD` (README §15.8).
 */

/** Délai en jours pour chaque boîte, index = boîte − 1 (README §4). */
export const DELAIS = [1, 3, 7, 21, 365];

export const BOITE_MIN = 1;
export const BOITE_MAX = DELAIS.length;

/** Les deux formes d'un verbe irrégulier, suivies séparément (README §4). */
export const FORMES_VERBE = ["preterit", "participe"];

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Date du jour au format ISO, en heure locale.
 * @param {Date} date
 * @returns {string} "YYYY-MM-DD"
 */
export function aujourdhui(date = new Date()) {
  const annee = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${annee}-${mois}-${jour}`;
}

/**
 * Décale une date ISO d'un nombre de jours. Le calcul se fait à midi pour
 * qu'un changement d'heure ne fasse jamais basculer d'un jour.
 * @param {string} iso
 * @param {number} jours
 * @returns {string}
 */
export function ajouterJours(iso, jours) {
  const [annee, mois, jour] = String(iso).split("-").map(Number);
  const date = new Date(annee, mois - 1, jour, 12);
  date.setDate(date.getDate() + jours);
  return aujourdhui(date);
}

/* -------------------------------------------------------------------------- */
/* Fiches                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Fiche neuve, telle que décrite en §5.4.
 * @param {string} date  date d'entrée dans le système
 * @returns {{b:number, r:string, s:number, e:number, d:?string, st:string}}
 */
export function ficheInitiale(date = aujourdhui()) {
  return { b: BOITE_MIN, r: date, s: 0, e: 0, d: null, st: "nouveau" };
}

/** Fiche d'une forme de verbe : pas de statut, il vit au niveau du verbe. */
export function ficheVerbeInitiale(date = aujourdhui()) {
  return { b: BOITE_MIN, r: date, s: 0, e: 0 };
}

/**
 * Borne une boîte dans [1, 5].
 * @param {number} boite
 * @returns {number}
 */
export function bornerBoite(boite) {
  return Math.min(Math.max(Math.round(boite), BOITE_MIN), BOITE_MAX);
}

/**
 * Délai en jours associé à une boîte.
 * @param {number} boite
 * @returns {number}
 */
export function delaiPourBoite(boite) {
  return DELAIS[bornerBoite(boite) - 1];
}

/**
 * Date de la prochaine révision pour une boîte donnée.
 * @param {number} boite
 * @param {string} depuis
 * @returns {string}
 */
export function prochaineRevision(boite, depuis = aujourdhui()) {
  return ajouterJours(depuis, delaiPourBoite(boite));
}

/**
 * Applique le résultat d'une révision à une fiche. Fonction pure : la fiche
 * reçue n'est pas modifiée, une nouvelle est renvoyée.
 *
 *   succès → boite++, prochaine_revision = today + DELAIS[boite]
 *   échec  → boite = 1, prochaine_revision = today + 1
 *
 * `traductionConsultee` : si l'utilisateur a eu besoin de la traduction FR pour
 * résoudre le mot, il ne monte PAS d'une boîte (README §4, signal de maîtrise).
 * La réussite est comptée, le délai est recalculé sur la boîte inchangée.
 *
 * @param {object}  fiche
 * @param {{succes:boolean, traductionConsultee?:boolean, date?:string}} resultat
 * @returns {object} nouvelle fiche
 */
export function appliquerResultat(fiche, { succes, traductionConsultee = false,
                                           date = aujourdhui() } = {}) {
  const courante = { ...ficheInitiale(date), ...fiche };

  if (!succes) {
    return {
      ...courante,
      b: BOITE_MIN,
      r: ajouterJours(date, DELAIS[0]),
      e: (courante.e ?? 0) + 1,
      d: date,
      st: "actif",
    };
  }

  const boite = traductionConsultee
    ? bornerBoite(courante.b)
    : bornerBoite((courante.b ?? BOITE_MIN) + 1);

  return {
    ...courante,
    b: boite,
    r: prochaineRevision(boite, date),
    s: (courante.s ?? 0) + 1,
    d: date,
    st: "actif",
  };
}

/**
 * Applique un résultat à UNE forme de verbe. Même mécanique que pour un mot,
 * mais la fiche d'une forme n'a ni statut ni date de dernière réponse : le
 * statut vit au niveau du verbe (README §5.4).
 *
 * @param {object} fiche
 * @param {{succes:boolean, date?:string}} resultat
 * @returns {{b:number, r:string, s:number, e:number}}
 */
export function appliquerResultatVerbe(fiche, { succes, date = aujourdhui() } = {}) {
  const complet = appliquerResultat(fiche ?? ficheVerbeInitiale(date), { succes, date });
  return { b: complet.b, r: complet.r, s: complet.s, e: complet.e };
}

/* -------------------------------------------------------------------------- */
/* File de révision                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Une fiche est-elle due ? Les dates ISO se comparent comme des chaînes.
 * @param {object} fiche
 * @param {string} today
 * @returns {boolean}
 */
export function estDue(fiche, today = aujourdhui()) {
  return Boolean(fiche) && String(fiche.r ?? "") <= today;
}

/**
 * File de révision — la requête unique du README §4, commune aux six filières.
 *
 *   words.filter(w => w.statut === "actif" && w.prochaine_revision <= today)
 *        .sort((a, b) => a.prochaine_revision - b.prochaine_revision)
 *
 * Les verbes n'ont pas de statut : chaque forme est due sur sa seule date, et
 * un même verbe peut donc apparaître deux fois dans la file (README §4).
 *
 * @param {object} state  état complet (§5.4)
 * @param {string} today
 * @returns {Array<{type:string, id:string, forme:?string, fiche:object}>}
 */
export function fileDeRevision(state = {}, today = aujourdhui()) {
  const file = [];

  for (const [id, fiche] of Object.entries(state.words ?? {})) {
    if (fiche?.st === "actif" && estDue(fiche, today)) {
      file.push({ type: "word", id, forme: null, fiche });
    }
  }

  for (const [id, formes] of Object.entries(state.verbes ?? {})) {
    for (const forme of FORMES_VERBE) {
      const fiche = formes?.[forme];
      if (estDue(fiche, today)) {
        file.push({ type: "verbe", id, forme, fiche });
      }
    }
  }

  return file.sort((a, b) => String(a.fiche.r).localeCompare(String(b.fiche.r)));
}

/**
 * File de révision restreinte au vocabulaire.
 *
 * Les verbes ont leur propre écran et ne se mélangent pas aux sessions de
 * vocabulaire : quatre appelants avaient besoin de ce filtre, il vit ici.
 *
 * @param {object} state
 * @param {string} today
 * @returns {Array<{type:string, id:string, forme:?string, fiche:object}>}
 */
export function fileDeRevisionMots(state = {}, today = aujourdhui()) {
  return fileDeRevision(state, today).filter((entree) => entree.type === "word");
}

/**
 * Un verbe est acquis quand ses DEUX formes sont en boîte 5 (README §4).
 * @param {object} formes  { preterit, participe }
 * @returns {boolean}
 */
export function verbeAcquis(formes = {}) {
  return FORMES_VERBE.every((forme) => formes?.[forme]?.b === BOITE_MAX);
}

/**
 * Répartition par boîte, pour l'écran de progression.
 * @param {object} fiches  dictionnaire id → fiche
 * @returns {number[]} 5 entrées, index = boîte − 1
 */
export function repartitionParBoite(fiches = {}) {
  const compte = new Array(BOITE_MAX).fill(0);
  for (const fiche of Object.values(fiches)) {
    const boite = bornerBoite(fiche?.b ?? BOITE_MIN);
    compte[boite - 1] += 1;
  }
  return compte;
}
