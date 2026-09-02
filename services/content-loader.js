/**
 * content-loader.js — manifeste, chargement paresseux, validation (README §7).
 *
 * Règles tenues ici :
 *  - au boot on charge le manifeste, puis les paliers DÉBLOQUÉS seulement.
 *    Jamais 2800 mots si l'utilisateur est au palier 2 (README §6) ;
 *  - un fichier invalide ne casse jamais l'application : il est écarté et
 *    l'erreur est collectée dans une liste consultable dans Réglages ;
 *  - une partie dont `verifie` n'est pas `true` n'est jamais servie (§5.3).
 */

/** Dossier racine du contenu, relatif à la page. */
export const BASE = "content/";

/** Nombre de mots par partie (README §3.3 et §17.8). */
export const MOTS_PAR_PARTIE = 5;

/** Filières optionnelles : déclarées au manifeste, pas encore produites (§7). */
export const FILIERES_OPTIONNELLES = ["verbes", "phrasal", "expressions"];

/* -------------------------------------------------------------------------- */
/* Collecte des erreurs                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Une anomalie de contenu. `bloquant` dit si l'élément a été écarté ou
 * seulement signalé.
 * @typedef {{fichier:string, message:string, bloquant:boolean}} Anomalie
 */

function signaler(erreurs, fichier, message, bloquant = true) {
  erreurs.push({ fichier, message, bloquant });
  return false;
}

/* -------------------------------------------------------------------------- */
/* Lecture                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Lit un JSON. Ne lève jamais : renvoie toujours un verdict.
 * @param {string} chemin
 * @param {Function} recuperer  implémentation de fetch, injectable
 * @returns {Promise<{ok:boolean, donnees:?object, absent:boolean, erreur:?string}>}
 */
export async function lireJSON(chemin, recuperer = globalThis.fetch) {
  let reponse;
  try {
    reponse = await recuperer(chemin, { cache: "no-cache" });
  } catch (e) {
    return { ok: false, donnees: null, absent: false, erreur: `Réseau indisponible (${e.message}).` };
  }

  if (reponse.status === 404) {
    return { ok: false, donnees: null, absent: true, erreur: "Fichier absent." };
  }
  if (!reponse.ok) {
    return { ok: false, donnees: null, absent: false, erreur: `Réponse ${reponse.status}.` };
  }

  try {
    return { ok: true, donnees: await reponse.json(), absent: false, erreur: null };
  } catch {
    return { ok: false, donnees: null, absent: false, erreur: "JSON illisible." };
  }
}

/* -------------------------------------------------------------------------- */
/* Validation — manifeste                                                      */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} manifeste
 * @param {Anomalie[]} erreurs
 * @returns {boolean}
 */
export function validerManifeste(manifeste, erreurs) {
  const fichier = "manifest.json";

  if (!manifeste || typeof manifeste !== "object") {
    return signaler(erreurs, fichier, "Manifeste illisible.");
  }
  if (!Array.isArray(manifeste.paliers)) {
    return signaler(erreurs, fichier, "Champ « paliers » absent ou mal formé.");
  }

  let valide = true;
  manifeste.paliers.forEach((entree, rang) => {
    for (const champ of ["id", "fichier", "titre"]) {
      if (entree?.[champ] === undefined) {
        valide = signaler(erreurs, fichier,
          `Palier n°${rang + 1} : champ « ${champ} » absent.`);
      }
    }
  });

  return valide;
}

/* -------------------------------------------------------------------------- */
/* Validation — palier                                                         */
/* -------------------------------------------------------------------------- */

/** Recalcule `eligible_grille` selon la formule de la §5.1. */
export function calculerEligibleGrille(en) {
  return /^[A-Za-z]{3,8}$/.test(String(en ?? ""));
}

/**
 * Valide un fichier de palier et renvoie ses mots valides.
 * @param {object} donnees
 * @param {string} fichier
 * @param {Anomalie[]} erreurs
 * @returns {object[]} mots retenus
 */
export function validerPalier(donnees, fichier, erreurs) {
  if (!donnees || typeof donnees !== "object") {
    signaler(erreurs, fichier, "Fichier illisible.");
    return [];
  }
  if (!Array.isArray(donnees.mots)) {
    signaler(erreurs, fichier, "Champ « mots » absent ou mal formé.");
    return [];
  }

  const retenus = [];
  const vus = new Set();

  donnees.mots.forEach((mot, rang) => {
    const manquant = ["id", "en", "fr"].find((champ) => !mot?.[champ]);
    if (manquant) {
      signaler(erreurs, fichier, `Mot n°${rang + 1} : champ « ${manquant} » absent.`);
      return;
    }
    if (vus.has(mot.id)) {
      signaler(erreurs, fichier, `Identifiant en double : ${mot.id}.`);
      return;
    }
    vus.add(mot.id);

    const attendu = calculerEligibleGrille(mot.en);
    if (mot.eligible_grille !== undefined && mot.eligible_grille !== attendu) {
      signaler(erreurs, fichier,
        `${mot.id} (${mot.en}) : « eligible_grille » vaut ${mot.eligible_grille}, ` +
        `la formule de la §5.1 donne ${attendu}.`, false);
    }

    retenus.push(mot);
  });

  return retenus;
}

/* -------------------------------------------------------------------------- */
/* Validation — partie                                                         */
/* -------------------------------------------------------------------------- */

/** Lettres distinctes d'une chaîne, en majuscules. */
function lettresDe(texte) {
  return new Set(String(texte ?? "").toUpperCase().replace(/[^A-Z]/g, ""));
}

/**
 * Valide une partie. Renvoie true si elle peut être servie.
 *
 * Contrôles bloquants (README §7) : champs obligatoires, `verifie === true`,
 * mots présents au catalogue, alphabet cohérent avec `phrase_en` ET les mots,
 * un indice par mot. Le reste est signalé sans écarter la partie.
 *
 * @param {object} partie
 * @param {Map<string,object>} catalogue  mots du palier et des paliers antérieurs
 * @param {string} fichier
 * @param {Anomalie[]} erreurs
 * @returns {boolean}
 */
export function validerPartie(partie, catalogue, fichier, erreurs) {
  const id = partie?.id ?? "partie sans id";

  for (const champ of ["id", "type", "phrase_en", "mots", "mot_amorce", "alphabet", "indices"]) {
    if (partie?.[champ] === undefined) {
      return signaler(erreurs, fichier, `${id} : champ « ${champ} » absent.`);
    }
  }

  // Une partie non vérifiée n'est jamais servie (README §5.3).
  if (partie.verifie !== true) {
    return signaler(erreurs, fichier, `${id} : « verifie » n'est pas true, partie écartée.`);
  }

  if (!Array.isArray(partie.mots) || partie.mots.length !== MOTS_PAR_PARTIE) {
    return signaler(erreurs, fichier,
      `${id} : ${Array.isArray(partie.mots) ? partie.mots.length : 0} mots au lieu de ${MOTS_PAR_PARTIE}.`);
  }

  const inconnus = partie.mots.filter((ref) => !catalogue.has(ref));
  if (inconnus.length) {
    return signaler(erreurs, fichier,
      `${id} : mots absents du palier ou des paliers antérieurs — ${inconnus.join(", ")}.`);
  }

  if (!partie.mots.includes(partie.mot_amorce)) {
    return signaler(erreurs, fichier, `${id} : « mot_amorce » ne fait pas partie des mots.`);
  }

  // Alphabet : une lettre par numéro, et il couvre la phrase comme les mots.
  const valeurs = Object.values(partie.alphabet ?? {});
  if (!valeurs.length) {
    return signaler(erreurs, fichier, `${id} : alphabet vide.`);
  }
  if (new Set(valeurs).size !== valeurs.length) {
    return signaler(erreurs, fichier, `${id} : deux numéros pointent la même lettre.`);
  }

  const connues = new Set(valeurs.map((l) => String(l).toUpperCase()));

  for (const lettre of lettresDe(partie.phrase_en)) {
    if (!connues.has(lettre)) {
      return signaler(erreurs, fichier,
        `${id} : la lettre « ${lettre} » de la phrase cachée n'est pas dans l'alphabet.`);
    }
  }

  for (const ref of partie.mots) {
    const mot = catalogue.get(ref);
    for (const lettre of lettresDe(mot.en)) {
      if (!connues.has(lettre)) {
        return signaler(erreurs, fichier,
          `${id} : la lettre « ${lettre} » de ${mot.en.toUpperCase()} n'est pas dans l'alphabet.`);
      }
    }
  }

  for (const ref of partie.mots) {
    if (!partie.indices?.[ref]) {
      return signaler(erreurs, fichier, `${id} : aucun indice pour ${ref}.`);
    }
  }

  /* --- signalements non bloquants ---------------------------------------- */

  const amorce = catalogue.get(partie.mot_amorce);
  const offertes = [...new Set((partie.lettres_offertes ?? []).map((l) => String(l).toUpperCase()))].sort();
  const attendues = [...lettresDe(amorce.en)].sort();
  if (offertes.join("") !== attendues.join("")) {
    signaler(erreurs, fichier,
      `${id} : « lettres_offertes » (${offertes.join(",") || "aucune"}) ne correspond pas ` +
      `aux lettres de ${amorce.en.toUpperCase()} (${attendues.join(",")}).`, false);
  }

  for (const [ref, indice] of Object.entries(partie.indices)) {
    if (!partie.mots.includes(ref)) {
      signaler(erreurs, fichier, `${id} : indice orphelin pour ${ref}.`, false);
    }
    for (const segment of indice?.segments ?? []) {
      if (segment.ref && !catalogue.has(segment.ref)) {
        signaler(erreurs, fichier,
          `${id} : le segment « ${segment.txt} » renvoie à ${segment.ref}, absent du catalogue.`, false);
      }
    }
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* Validation — verbes irréguliers (README §2.2, §5.1)                         */
/* -------------------------------------------------------------------------- */

/**
 * Valide un fichier de verbes irréguliers.
 *
 * Le fichier n'ayant pas de schéma dédié dans le README, on accepte les deux
 * formes évidentes : `{ verbes: [...] }` ou un tableau nu. Chaque entrée suit
 * le schéma `word` de la §5.1, avec `preterit`, `participe` et `groupe_verbe`.
 *
 * @param {object|Array} donnees
 * @param {string} fichier
 * @param {Anomalie[]} erreurs
 * @returns {object[]} verbes retenus
 */
export function validerVerbes(donnees, fichier, erreurs) {
  const liste = Array.isArray(donnees) ? donnees : donnees?.verbes;

  if (!Array.isArray(liste)) {
    signaler(erreurs, fichier, "Champ « verbes » absent ou mal formé.");
    return [];
  }

  const retenus = [];
  const vus = new Set();

  liste.forEach((verbe, rang) => {
    const manquant = ["id", "en", "fr", "preterit", "participe"]
      .find((champ) => !verbe?.[champ]);
    if (manquant) {
      signaler(erreurs, fichier, `Verbe n°${rang + 1} : champ « ${manquant} » absent.`);
      return;
    }
    if (vus.has(verbe.id)) {
      signaler(erreurs, fichier, `Identifiant en double : ${verbe.id}.`);
      return;
    }
    vus.add(verbe.id);

    const groupe = Number(verbe.groupe_verbe);
    if (!Number.isInteger(groupe) || groupe < 1 || groupe > 4) {
      // L'apprentissage se fait par groupe de pattern (§2.2) : sans groupe
      // valide, le verbe ne serait jamais servi. On l'écarte en le disant.
      signaler(erreurs, fichier,
        `${verbe.id} (${verbe.en}) : « groupe_verbe » doit valoir 1 à 4, reçu ${verbe.groupe_verbe}.`);
      return;
    }

    retenus.push(verbe);
  });

  return retenus;
}

/**
 * Charge la filière verbes, à la demande — jamais au démarrage.
 *
 * @param {object} options
 * @param {object} options.manifeste
 * @param {string} options.base
 * @param {Function} options.recuperer
 * @returns {Promise<{verbes:object[], erreurs:Anomalie[], absente:boolean}>}
 */
export async function chargerVerbes({ manifeste, base = BASE,
                                      recuperer = globalThis.fetch } = {}) {
  const erreurs = [];
  const fichier = manifeste?.verbes;

  if (!fichier) return { verbes: [], erreurs, absente: true };

  const lu = await lireJSON(`${base}${fichier}`, recuperer);
  if (!lu.ok) {
    // Filière déclarée mais pas encore livrée : ce n'est pas une erreur (§7).
    if (lu.absent) return { verbes: [], erreurs, absente: true };
    signaler(erreurs, fichier, lu.erreur);
    return { verbes: [], erreurs, absente: false };
  }

  return { verbes: validerVerbes(lu.donnees, fichier, erreurs), erreurs, absente: false };
}

/* -------------------------------------------------------------------------- */
/* Chargement                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Une filière optionnelle est-elle réellement livrée ?
 *
 * On sonde le fichier sans le charger : la §7 veut qu'une filière déclarée au
 * manifeste mais absente soit simplement masquée, pas signalée en erreur. Son
 * contenu, lui, ne sera lu que par l'écran qui en a besoin.
 *
 * @param {string} chemin
 * @param {Function} recuperer
 * @returns {Promise<boolean>}
 */
export async function filiereDisponible(chemin, recuperer = globalThis.fetch) {
  try {
    const reponse = await recuperer(chemin, { method: "HEAD", cache: "no-cache" });
    return reponse.ok;
  } catch {
    return false;
  }
}

/**
 * Paliers à charger : ceux dont l'id est atteint ou déjà validé.
 * @param {object} manifeste
 * @param {object} state
 * @returns {object[]} entrées du manifeste
 */
export function paliersDebloques(manifeste, state) {
  const courant = Number(state?.progression?.palier_actuel ?? 1);
  const valides = new Set(state?.progression?.paliers_valides ?? []);
  return (manifeste?.paliers ?? [])
    .filter((entree) => Number(entree.id) <= courant || valides.has(entree.id))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * Charge le contenu utile à l'état courant.
 *
 * @param {object}   options
 * @param {object}   options.state
 * @param {string}   options.base
 * @param {Function} options.recuperer  implémentation de fetch, injectable
 * @returns {Promise<{
 *   manifeste:?object, paliers:object[], mots:Map<string,object>,
 *   parties:object[], filieres:Object<string,boolean>, erreurs:Anomalie[]
 * }>}
 */
export async function chargerContenu({ state, base = BASE,
                                       recuperer = globalThis.fetch } = {}) {
  const erreurs = [];
  const mots = new Map();
  const parties = [];
  const paliers = [];

  const lu = await lireJSON(`${base}manifest.json`, recuperer);
  if (!lu.ok) {
    signaler(erreurs, "manifest.json", lu.erreur);
    return { manifeste: null, paliers, mots, parties, filieres: {}, erreurs };
  }

  const manifeste = lu.donnees;
  if (!validerManifeste(manifeste, erreurs)) {
    return { manifeste, paliers, mots, parties, filieres: {}, erreurs };
  }

  // Une filière déclarée mais absente n'est pas une erreur : elle n'est pas
  // encore produite, elle sera simplement masquée (README §7). On sonde le
  // fichier — être déclaré au manifeste ne prouve pas qu'il ait été livré.
  const filieres = {};
  for (const nom of FILIERES_OPTIONNELLES) {
    filieres[nom] = manifeste[nom]
      ? await filiereDisponible(`${base}${manifeste[nom]}`, recuperer)
      : false;
  }

  for (const entree of paliersDebloques(manifeste, state)) {
    const fichierPalier = entree.fichier;
    const luPalier = await lireJSON(`${base}${fichierPalier}`, recuperer);

    if (!luPalier.ok) {
      signaler(erreurs, fichierPalier,
        luPalier.absent ? "Palier déclaré au manifeste mais introuvable." : luPalier.erreur);
      continue;
    }

    for (const mot of validerPalier(luPalier.donnees, fichierPalier, erreurs)) {
      mots.set(mot.id, mot);
    }
    paliers.push({ ...entree, titre: luPalier.donnees.titre ?? entree.titre });

    if (!entree.parties) continue;

    const luParties = await lireJSON(`${base}${entree.parties}`, recuperer);
    if (!luParties.ok) {
      signaler(erreurs, entree.parties,
        luParties.absent ? "Parties déclarées au manifeste mais introuvables." : luParties.erreur);
      continue;
    }

    const liste = luParties.donnees?.parties;
    if (!Array.isArray(liste)) {
      signaler(erreurs, entree.parties, "Champ « parties » absent ou mal formé.");
      continue;
    }

    for (const partie of liste) {
      if (validerPartie(partie, mots, entree.parties, erreurs)) parties.push(partie);
    }
  }

  return { manifeste, paliers, mots, parties, filieres, erreurs };
}
