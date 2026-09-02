/**
 * store.js — lecture/écriture de l'état, migration, export/import (README §5.4, §6).
 *
 * L'état vit en mémoire sous la forme unique décrite en §5.4, `perso` compris.
 * Il est PERSISTÉ sur deux clés, comme l'exige la §6 :
 *   wordcode_state  → v, words, verbes, progression
 *   wordcode_perso  → le tableau perso
 *
 * Le stockage est injectable : les tests travaillent sur une mémoire jetable
 * et ne touchent jamais à la progression réelle.
 */

import { aujourdhui } from "./leitner.js";

export const CLE_STATE = "wordcode_state";
export const CLE_PERSO = "wordcode_perso";

/** Version du schéma. Toute évolution incrémente ce nombre et ajoute une étape. */
export const VERSION = 1;

/** Nombre de jours entre deux rappels de sauvegarde (README §6). */
export const RAPPEL_SAUVEGARDE_JOURS = 30;

/* -------------------------------------------------------------------------- */
/* État                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * État vierge, conforme au schéma §5.4.
 * @returns {object}
 */
export function etatInitial() {
  return {
    v: VERSION,
    words: {},
    verbes: {},
    progression: {
      palier_actuel: 1,
      paliers_valides: [],
      groupe_verbe_actuel: 1,
      parties_jouees: [],
      file_decouverte: [],
      ajouts_aujourdhui: 0,
      streak: 0,
      derniere_session: null,
      derniere_sauvegarde: null,
      objectif_quotidien: 5,
    },
    perso: [],
  };
}

/**
 * Complète un état partiel avec les valeurs par défaut, sans écraser
 * l'existant. Protège contre un fichier tronqué ou un schéma plus ancien.
 * @param {object} state
 * @returns {object}
 */
function completer(state) {
  const base = etatInitial();
  return {
    ...base,
    ...state,
    words: state?.words ?? base.words,
    verbes: state?.verbes ?? base.verbes,
    progression: { ...base.progression, ...(state?.progression ?? {}) },
    perso: Array.isArray(state?.perso) ? state.perso : base.perso,
  };
}

/* -------------------------------------------------------------------------- */
/* Migration                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Migrations successives, pilotées par le champ `v`. Chaque entrée fait passer
 * de la version `n` à `n + 1`. Aucune n'existe encore : le schéma est en v1.
 * @type {Object<number, function(object): object>}
 */
const MIGRATIONS = {};

/**
 * Amène un état à la version courante.
 * @param {object} state
 * @returns {object}
 */
export function migrer(state) {
  let courant = completer(state);
  let version = Number(courant.v) || 0;

  while (version < VERSION) {
    const etape = MIGRATIONS[version];
    if (!etape) break;
    courant = etape(courant);
    version += 1;
  }

  return { ...courant, v: VERSION };
}

/* -------------------------------------------------------------------------- */
/* Persistance                                                                 */
/* -------------------------------------------------------------------------- */

function lireJSON(storage, cle) {
  try {
    const brut = storage.getItem(cle);
    return brut ? JSON.parse(brut) : null;
  } catch {
    return null;
  }
}

/**
 * Charge l'état depuis le stockage, en le migrant si nécessaire.
 * Un stockage illisible ou corrompu ne casse pas l'application : on repart
 * d'un état vierge.
 * @param {{storage?:Storage}} options
 * @returns {object}
 */
export function charger({ storage = localStorage } = {}) {
  const noyau = lireJSON(storage, CLE_STATE);
  const perso = lireJSON(storage, CLE_PERSO);

  return migrer({
    ...(noyau ?? {}),
    perso: Array.isArray(perso) ? perso : (noyau?.perso ?? []),
  });
}

/**
 * Écrit l'état sur les deux clés de la §6.
 * @param {object} state
 * @param {{storage?:Storage}} options
 * @returns {boolean} false si le stockage a refusé (quota, mode privé)
 */
export function sauvegarder(state, { storage = localStorage } = {}) {
  const complet = migrer(state);
  const { perso, ...noyau } = complet;

  try {
    storage.setItem(CLE_STATE, JSON.stringify(noyau));
    storage.setItem(CLE_PERSO, JSON.stringify(perso));
    return true;
  } catch {
    return false;
  }
}

/**
 * Efface la progression stockée. Utilisé par la restauration.
 * @param {{storage?:Storage}} options
 */
export function effacer({ storage = localStorage } = {}) {
  try {
    storage.removeItem(CLE_STATE);
    storage.removeItem(CLE_PERSO);
  } catch { /* rien à faire : le stockage est déjà inaccessible */ }
}

/* -------------------------------------------------------------------------- */
/* Export / import (README §6) — fonctions pures                               */
/* -------------------------------------------------------------------------- */

/**
 * Objet de sauvegarde complet, prêt à être sérialisé. Ne télécharge rien :
 * c'est l'écran Réglages qui déclenchera le téléchargement.
 * @param {object} state
 * @param {string} date
 * @returns {object}
 */
export function exporter(state, date = aujourdhui()) {
  const complet = migrer(state);
  return {
    ...complet,
    progression: { ...complet.progression, derniere_sauvegarde: date },
  };
}

/**
 * Nom de fichier imposé par la §6.
 * @param {string} date
 * @returns {string}
 */
export function nomFichierSauvegarde(date = aujourdhui()) {
  return `backup-${date}.json`;
}

/**
 * Relit une sauvegarde. Valide le champ `v` avant tout, comme l'exige la §6.
 * Ne remplace rien elle-même : renvoie l'état reconstruit, à charge de
 * l'appelant de le sauvegarder.
 *
 * @param {string|object} donnees  JSON brut ou objet déjà parsé
 * @returns {{ok:boolean, state:?object, erreur:?string}}
 */
export function importer(donnees) {
  let objet = donnees;

  if (typeof donnees === "string") {
    try {
      objet = JSON.parse(donnees);
    } catch {
      return { ok: false, state: null, erreur: "Fichier illisible : ce n'est pas du JSON." };
    }
  }

  if (!objet || typeof objet !== "object" || Array.isArray(objet)) {
    return { ok: false, state: null, erreur: "Fichier invalide : objet attendu." };
  }

  const version = Number(objet.v);
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, state: null, erreur: "Fichier invalide : champ « v » absent ou illisible." };
  }
  if (version > VERSION) {
    return {
      ok: false,
      state: null,
      erreur: `Sauvegarde en version ${version}, l'application lit jusqu'à la version ${VERSION}.`,
    };
  }

  if (objet.words && typeof objet.words !== "object") {
    return { ok: false, state: null, erreur: "Fichier invalide : « words » corrompu." };
  }

  return { ok: true, state: migrer(objet), erreur: null };
}

/**
 * Faut-il rappeler à l'utilisateur de sauvegarder ? (README §6, tous les 30 jours)
 * Jamais sauvegardé et rien à perdre → non.
 * @param {object} state
 * @param {string} today
 * @returns {boolean}
 */
export function sauvegardeARappeler(state, today = aujourdhui()) {
  const complet = completer(state);
  const rien = Object.keys(complet.words).length === 0
    && Object.keys(complet.verbes).length === 0
    && complet.perso.length === 0;
  if (rien) return false;

  const derniere = complet.progression.derniere_sauvegarde;
  if (!derniere) return true;

  const echeance = new Date(`${derniere}T12:00:00`);
  echeance.setDate(echeance.getDate() + RAPPEL_SAUVEGARDE_JOURS);
  return aujourdhui(echeance) <= today;
}
