/**
 * api.js — UNIQUE point d'appel réseau de l'application (README §14, §15.7).
 *
 * Tout le reste est local. La clé Gemini n'est jamais ici : elle vit dans les
 * variables d'environnement Vercel, derrière `api/translate.js`.
 */

/** Chemin de la fonction serverless, même origine que l'application. */
export const ENDPOINT = "/api/translate";

/** Au-delà, on n'appelle pas : la fonction répond 400 (cf. api/translate.js). */
export const LONGUEUR_MAX = 400;

/** Un appel Gemini + sa rétro-traduction prennent quelques secondes. */
export const TIMEOUT_MS = 20000;

/**
 * Motifs d'échec, pour que l'écran choisisse son message sans analyser du texte.
 * @readonly
 */
export const CAUSES = {
  VIDE: "vide",
  TROP_LONG: "trop-long",
  HORS_LIGNE: "hors-ligne",
  TIMEOUT: "timeout",
  INDISPONIBLE: "indisponible",
  RESEAU: "reseau",
  REPONSE: "reponse",
};

const MESSAGES = {
  [CAUSES.VIDE]: "Écris d'abord une phrase ou un mot.",
  [CAUSES.TROP_LONG]: `Phrase trop longue : ${LONGUEUR_MAX} caractères au maximum.`,
  [CAUSES.HORS_LIGNE]: "Hors ligne. La traduction est la seule fonction qui a besoin du réseau.",
  [CAUSES.TIMEOUT]: "La traduction n'a pas répondu à temps. Réessaie.",
  [CAUSES.INDISPONIBLE]: "Le service de traduction est momentanément indisponible.",
  [CAUSES.RESEAU]: "Impossible de joindre le service de traduction.",
  [CAUSES.REPONSE]: "Réponse inattendue du service de traduction.",
};

const echec = (cause) => ({ ok: false, donnees: null, cause, erreur: MESSAGES[cause] });

/**
 * Traduit une phrase entière — jamais un mot isolé : c'est le contexte qui
 * donne le bon sens (README §14, garde-fou n°1).
 *
 * Ne lève jamais : renvoie toujours un verdict exploitable.
 *
 * @param {string} texte
 * @param {object} options
 * @param {string} options.endpoint
 * @param {number} options.timeout
 * @param {Function} options.recuperer  implémentation de fetch, injectable
 * @param {boolean} options.enLigne     état réseau, injectable pour les tests
 * @returns {Promise<{ok:boolean, donnees:?object, cause:?string, erreur:?string}>}
 */
export async function traduire(texte, { endpoint = ENDPOINT, timeout = TIMEOUT_MS,
                                        recuperer = globalThis.fetch,
                                        enLigne = globalThis.navigator?.onLine ?? true } = {}) {
  const propre = String(texte ?? "").trim();
  if (!propre) return echec(CAUSES.VIDE);
  if (propre.length > LONGUEUR_MAX) return echec(CAUSES.TROP_LONG);
  if (!enLigne) return echec(CAUSES.HORS_LIGNE);

  const arret = new AbortController();
  const minuteur = setTimeout(() => arret.abort(), timeout);

  let reponse;
  try {
    reponse = await recuperer(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texte: propre }),
      signal: arret.signal,
    });
  } catch (e) {
    clearTimeout(minuteur);
    return echec(e?.name === "AbortError" ? CAUSES.TIMEOUT : CAUSES.RESEAU);
  }
  clearTimeout(minuteur);

  // 502 : Gemini a échoué côté serveur. 400 : la requête était déjà mauvaise.
  if (reponse.status === 502) return echec(CAUSES.INDISPONIBLE);
  if (!reponse.ok) return echec(CAUSES.REPONSE);

  let donnees;
  try {
    donnees = await reponse.json();
  } catch {
    return echec(CAUSES.REPONSE);
  }

  if (!donnees || typeof donnees !== "object" || !Array.isArray(donnees.mots)) {
    return echec(CAUSES.REPONSE);
  }

  return { ok: true, donnees, cause: null, erreur: null };
}
