/**
 * video-builder.js — section §10 « Vidéo » (README §2, §14).
 *
 * La vidéo joue UNE phrase, puis s'arrête. Deux jeux sur cette phrase :
 *
 *   ordre    — remettre les mots mélangés dans le bon ordre (`WordOrder`)
 *   ecriture — écrire la phrase entière (`InputAnswer`)
 *
 * Aucun micro : l'utilisateur ne parle pas, il reconstruit.
 *
 * Ce service ne joue rien et n'appelle rien : il découpe, il choisit, il suit
 * l'avancement. La lecture est au composant, la récupération est à l'API.
 *
 * Fonctions pures.
 */

import { aujourdhui } from "./leitner.js";

/** Les deux jeux, tels qu'ils apparaissent dans l'écran. */
export const MODES = ["ordre", "ecriture"];

/**
 * Marge ajoutée à la fin d'un segment, en secondes.
 *
 * Les horodatages de TED marquent le DÉBUT de chaque ligne de sous-titre. Sans
 * marge, la lecture coupe la dernière syllabe de la phrase — exactement le mot
 * qu'il faut entendre pour le réécrire.
 */
export const MARGE_FIN_S = 0.35;

/**
 * Met une conférence reçue de l'API en forme pour l'application.
 *
 * @param {object} reponse  ce que rend le contrat `transcription`
 * @returns {?object} conférence, ou null si elle est inexploitable
 */
export function normaliserVideo(reponse) {
  const phrases = (reponse?.phrases ?? []).filter((p) => p?.texte?.trim());
  if (!reponse?.slug || !reponse?.video || !phrases.length) return null;

  return {
    slug: reponse.slug,
    titre: reponse.titre ?? reponse.slug,
    video: reponse.video,
    duree: Number(reponse.duree) || null,
    source: reponse.source ?? null,
    licence: reponse.licence ?? null,
    phrases: phrases.map((p, i) => ({
      i,
      debut: Number(p.debut) || 0,
      fin: Number(p.fin) || Number(p.debut) || 0,
      texte: String(p.texte).replace(/\s+/g, " ").trim(),
    })),
  };
}

/**
 * Indices des phrases déjà réussies sur une conférence.
 *
 * @param {object} state
 * @param {string} slug
 * @returns {number[]}
 */
export function phrasesFaites(state, slug) {
  const suivi = state?.progression?.phrases_video ?? {};
  return Array.isArray(suivi[slug]) ? suivi[slug] : [];
}

/**
 * Première phrase non encore réussie, ou la première si tout est fait.
 *
 * On ne saute pas les phrases ratées : une phrase n'est marquée que lorsqu'elle
 * est juste, donc elle revient tant qu'elle résiste.
 *
 * @param {object} video
 * @param {object} state
 * @returns {number}
 */
export function phraseCourante(video, state) {
  const faites = new Set(phrasesFaites(state, video?.slug));
  const suivante = (video?.phrases ?? []).find((p) => !faites.has(p.i));
  return suivante ? suivante.i : 0;
}

/**
 * Avancement sur une conférence, pour la barre segmentée de l'écran.
 *
 * @param {object} video
 * @param {object} state
 * @returns {{faites:number[], total:number, part:number, termine:boolean}}
 */
export function avancement(video, state) {
  const total = (video?.phrases ?? []).length;
  const faites = phrasesFaites(state, video?.slug).filter((i) => i < total);
  return {
    faites,
    total,
    part: total ? faites.length / total : 0,
    termine: total > 0 && faites.length >= total,
  };
}

/**
 * Jetons mélangés d'une phrase, pour la remise en ordre.
 *
 * La ponctuation reste collée à son mot : « stress? » est un jeton. C'est ce
 * que fait le jeu dont l'utilisateur est parti, et `estCorrect` normalise la
 * ponctuation de toute façon.
 *
 * Un mélange qui rendrait l'ordre d'origine est rejoué : proposer la phrase
 * déjà dans l'ordre supprime l'exercice.
 *
 * @param {string} texte
 * @param {Function} melanger  injectable pour les tests
 * @returns {string[]}
 */
export function jetonsMelanges(texte, melanger = melangerParDefaut) {
  const jetons = String(texte ?? "").trim().split(/\s+/).filter(Boolean);
  if (jetons.length < 3) return jetons;

  for (let essai = 0; essai < 8; essai += 1) {
    const propose = melanger(jetons);
    if (propose.join(" ") !== jetons.join(" ")) return propose;
  }
  // Mélange impossible à distinguer (mots identiques) : on rend tel quel.
  return jetons;
}

/**
 * Compose l'exercice de la phrase courante.
 *
 * @param {object} options
 * @param {object} options.video
 * @param {object} options.state
 * @param {string} options.mode      "ordre" ou "ecriture"
 * @param {Function} options.melanger
 * @returns {{verrouille:boolean, raison:?string, exercice:?object}}
 */
export function composerPhrase({ video, state, mode = "ordre",
                                 melanger = melangerParDefaut } = {}) {
  if (!video?.phrases?.length) {
    return { verrouille: true, raison: "Aucune conférence chargée.", exercice: null };
  }

  const rang = phraseCourante(video, state);
  const phrase = video.phrases[rang];

  return {
    verrouille: false,
    raison: null,
    exercice: {
      mode,
      rang,
      phrase,
      debut: phrase.debut,
      // La marge évite de couper la dernière syllabe (voir MARGE_FIN_S).
      fin: phrase.fin + MARGE_FIN_S,
      attendu: phrase.texte,
      tokens: mode === "ordre" ? jetonsMelanges(phrase.texte, melanger) : [],
    },
  };
}

/**
 * Enregistre le résultat d'une phrase.
 *
 * Seule une réussite marque la phrase : un échec la laisse à refaire, sans
 * aucune pénalité. Rien ici ne touche au Leitner — les mots d'une conférence
 * TED sortent largement des 1000 du catalogue, les compter fausserait les
 * boîtes.
 *
 * @param {object} options
 * @param {object} options.state
 * @param {string} options.slug
 * @param {number} options.rang
 * @param {boolean} options.correct
 * @param {string} options.today
 * @returns {object} nouvel état
 */
export function appliquerPhrase({ state, slug, rang, correct,
                                  today = aujourdhui() } = {}) {
  if (!slug || !Number.isInteger(rang)) return state;

  const suivi = state?.progression?.phrases_video ?? {};
  const faites = Array.isArray(suivi[slug]) ? suivi[slug] : [];
  const ajout = correct && !faites.includes(rang) ? [...faites, rang].sort((a, b) => a - b) : faites;

  return {
    ...state,
    progression: {
      ...state.progression,
      phrases_video: { ...suivi, [slug]: ajout },
      derniere_session: today,
    },
  };
}

function melangerParDefaut(liste) {
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}
