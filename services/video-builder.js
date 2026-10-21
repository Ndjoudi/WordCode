/**
 * video-builder.js — section §10 « Vidéo » (README §2, §14).
 *
 * La vidéo joue UNE phrase, puis s'arrête. Deux jeux sur cette phrase :
 *
 *   trous    — quelques mots manquent, on les choisit dans une liste (`ClozeChoice`)
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
export const MODES = ["trous", "ecriture"];

/**
 * Nombre de mots retirés d'une phrase, réglable dans les Réglages (§11).
 *
 * Le réglage est le vrai levier de difficulté : on monte quand ça devient
 * facile. Au-delà de six, on retombe sur la phrase à reconstruire entière —
 * c'est ce qu'il fallait éviter.
 */
export const TROUS_MIN = 1;
export const TROUS_MAX = 6;
export const TROUS_DEFAUT = 3;

/**
 * Mots en trop dans la liste. Sans eux, on résout par élimination sans lire
 * la phrase : le dernier trou se remplit tout seul.
 */
export const LEURRES_TROUS = 3;

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
  // Une conférence est jouable si elle a AU MOINS une source : le mp4 quand
  // TED le sert, le flux HLS sinon (environ une conférence sur trois n'a que
  // celui-là, son mp4 rendant 403).
  const source = reponse?.video ?? reponse?.hls ?? null;
  if (!reponse?.slug || !source || !phrases.length) return null;

  return {
    slug: reponse.slug,
    titre: reponse.titre ?? reponse.slug,
    video: reponse.video ?? null,
    hls: reponse.hls ?? null,
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
export function phraseCourante(video, state, ignorer = []) {
  const faites = new Set(phrasesFaites(state, video?.slug));
  const mises = new Set(ignorer);
  const phrases = video?.phrases ?? [];

  // D'abord ce qui reste vraiment à faire.
  const suivante = phrases.find((p) => !faites.has(p.i) && !mises.has(p.i));
  if (suivante) return suivante.i;

  // Puis, si tout le reste a été passé dans la séance, on les redonne plutôt
  // que de bloquer sur un écran vide.
  const passee = phrases.find((p) => !faites.has(p.i));
  return passee ? passee.i : 0;
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
 * Nombre de trous demandé, ramené dans les bornes.
 *
 * @param {object} state
 * @returns {number}
 */
export function nombreDeTrous(state) {
  const brut = Number(state?.progression?.trous_video);
  if (!Number.isFinite(brut)) return TROUS_DEFAUT;
  return Math.min(Math.max(Math.round(brut), TROUS_MIN), TROUS_MAX);
}

/** Sépare la ponctuation collée au mot : « stress? » → « stress » + « ? ». */
function decouperJeton(jeton) {
  const [, avant, mot, apres] = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/.exec(jeton);
  return { avant, mot, apres };
}

/**
 * Compose une phrase à trous.
 *
 * Les trous visent d'abord les mots de contenu : masquer « the » ne teste rien.
 * Une phrase qui en manque complète avec ses autres mots. Il reste toujours au
 * moins un mot visible, sauf pour une phrase d'un seul mot.
 *
 * La ponctuation reste dans la phrase, hors du trou : on choisit « stress »,
 * pas « stress? ».
 *
 * @param {string} texte
 * @param {object} options
 * @param {number} options.trous       nombre de trous voulu
 * @param {string[]} options.reservoir mots pris ailleurs dans la conférence
 * @param {Function} options.melanger
 * @returns {{parties:Array<{texte:string}|{trou:number}>, reponses:string[], choix:string[]}}
 */
export function composerTrous(texte, { trous = TROUS_DEFAUT, reservoir = [],
                                       melanger = melangerParDefaut } = {}) {
  const jetons = String(texte ?? "").trim().split(/\s+/).filter(Boolean)
    .map(decouperJeton);
  const estMot = (j) => /^[A-Za-z][A-Za-z'-]*$/.test(j.mot);

  const mots = jetons.map((j, i) => ({ ...j, i })).filter(estMot);
  const contenu = mots.filter((j) => j.mot.length >= 4 && !MOTS_OUTILS.has(j.mot.toLowerCase()));
  const reste = mots.filter((j) => !contenu.includes(j));

  const voulu = Math.min(trous, Math.max(1, mots.length - 1));
  const choisis = [...melanger(contenu), ...melanger(reste)]
    .slice(0, voulu)
    .map((j) => j.i);
  const masques = new Set(choisis);

  const parties = [];
  const reponses = [];
  let courant = "";
  jetons.forEach((jeton, i) => {
    const espace = i > 0 ? " " : "";
    if (!masques.has(i)) { courant += espace + jeton.avant + jeton.mot + jeton.apres; return; }
    courant += espace + jeton.avant;
    if (courant) parties.push({ texte: courant });
    parties.push({ trou: reponses.length });
    reponses.push(jeton.mot);
    courant = jeton.apres;
  });
  if (courant) parties.push({ texte: courant });

  // Les leurres viennent de la même conférence : un intrus venu d'un autre
  // univers se repère sans réfléchir.
  const presents = new Set(jetons.map((j) => j.mot.toLowerCase()));
  const leurres = melanger([...new Set(reservoir)]
    .filter((m) => !presents.has(m.toLowerCase())))
    .slice(0, LEURRES_TROUS);

  return { parties, reponses, choix: melanger([...reponses, ...leurres]) };
}

/**
 * Compose l'exercice de la phrase courante.
 *
 * @param {object} options
 * @param {object} options.video
 * @param {object} options.state
 * @param {string} options.mode      "trous" ou "ecriture"
 * @param {Function} options.melanger
 * @param {number[]} options.ignorer   phrases passées pendant la séance
 * @returns {{verrouille:boolean, raison:?string, exercice:?object}}
 */
export function composerPhrase({ video, state, mode = "trous",
                                 melanger = melangerParDefaut, ignorer = [] } = {}) {
  if (!video?.phrases?.length) {
    return { verrouille: true, raison: "Aucune conférence chargée.", exercice: null };
  }

  const rang = phraseCourante(video, state, ignorer);
  const phrase = video.phrases[rang];
  const trous = mode === "trous"
    ? composerTrous(phrase.texte, {
        trous: nombreDeTrous(state),
        reservoir: video.phrases.filter((p) => p.i !== rang).flatMap((p) => motsUtiles(p.texte)),
        melanger,
      })
    : null;

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
      parties: trous?.parties ?? [],
      reponses: trous?.reponses ?? [],
      choix: trous?.choix ?? [],
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

/* -------------------------------------------------------------------------- */
/* Quizz de fin de conférence (§10)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Part de la conférence à avoir vue pour que le quizz s'ouvre.
 *
 * Pas 100 % : le générique de fin et les applaudissements ne sont pas du
 * contenu, et exiger la dernière milliseconde bloquerait pour rien.
 */
export const SEUIL_VU = 0.97;

/** Nombre de questions d'un quizz, et minimum de phrases pour en composer un. */
export const QUESTIONS_QUIZ = 8;
export const PHRASES_MIN_QUIZ = 12;

/** Mots trop courts ou trop communs : les masquer n'apprend rien. */
const MOTS_OUTILS = new Set([
  "the", "and", "that", "this", "with", "have", "has", "had", "for", "from",
  "was", "were", "you", "your", "they", "them", "their", "not", "but", "are",
  "our", "out", "who", "what", "when", "how", "all", "can", "will", "would",
  "about", "there", "here", "just", "some", "more", "than", "then", "into",
]);

const motsUtiles = (texte) =>
  String(texte).split(/\s+/)
    .map((m) => m.replace(/[^A-Za-z'-]/g, ""))
    .filter((m) => m.length >= 4 && !MOTS_OUTILS.has(m.toLowerCase()));

/** La conférence a-t-elle été regardée en entier ? */
export function estVue(state, slug) {
  return Boolean((state?.progression?.videos_vues ?? {})[slug]);
}

/**
 * Enregistre qu'une conférence a été vue jusqu'au bout.
 *
 * @param {object} options
 * @param {object} options.state
 * @param {string} options.slug
 * @param {number} options.position  position atteinte, en secondes
 * @param {number} options.duree
 * @param {string} options.today
 * @returns {object} nouvel état — inchangé si le seuil n'est pas atteint
 */
export function marquerVue({ state, slug, position, duree, today = aujourdhui() } = {}) {
  if (!slug || !Number.isFinite(position) || !Number.isFinite(duree) || duree <= 0) return state;
  if (position / duree < SEUIL_VU) return state;
  if (estVue(state, slug)) return state;

  return {
    ...state,
    progression: {
      ...state.progression,
      videos_vues: { ...(state?.progression?.videos_vues ?? {}), [slug]: today },
    },
  };
}

/**
 * Compose le quizz d'une conférence, **sans réseau** : tout vient de la
 * transcription déjà en mémoire.
 *
 * Deux formes, parce qu'elles testent deux choses différentes :
 *
 *   trou   — un mot de contenu est masqué dans une phrase entendue ; c'est du
 *            vocabulaire en contexte.
 *   suite  — quelle phrase suit celle-ci ; c'est le fil du discours.
 *
 * @param {object} options
 * @param {object} options.video
 * @param {object} options.state
 * @param {Function} options.melanger  injectable pour les tests
 * @returns {{verrouille:boolean, raison:?string, questions:object[]}}
 */
export function composerQuizVideo({ video, state, melanger = melangerParDefaut } = {}) {
  const phrases = video?.phrases ?? [];
  if (!estVue(state, video?.slug)) {
    return { verrouille: true, questions: [],
             raison: "Regarde la conférence en entier pour ouvrir le quizz." };
  }
  if (phrases.length < PHRASES_MIN_QUIZ) {
    return { verrouille: true, questions: [],
             raison: "Cette conférence est trop courte pour un quizz." };
  }

  // Réservoir de mots pris ailleurs dans la conférence : les mauvaises réponses
  // doivent venir du même univers, sinon la bonne saute aux yeux.
  const reservoir = [...new Set(phrases.flatMap((p) => motsUtiles(p.texte)))];

  const candidates = phrases.filter((p) => motsUtiles(p.texte).length >= 2);
  const choisies = melanger(candidates).slice(0, QUESTIONS_QUIZ);
  const questions = [];

  for (const [rang, phrase] of choisies.entries()) {
    const suivante = phrases[phrase.i + 1];

    // On alterne pour ne pas enchaîner huit fois le même exercice.
    if (rang % 2 === 1 && suivante) {
      const leurres = melanger(phrases.filter((p) => p.i !== phrase.i && p.i !== suivante.i))
        .slice(0, 3).map((p) => p.texte);
      if (leurres.length < 3) continue;
      questions.push({
        type: "suite",
        invite: phrase.texte,
        attendu: suivante.texte,
        choix: melanger([suivante.texte, ...leurres]),
      });
      continue;
    }

    const mots = motsUtiles(phrase.texte);
    const cible = melanger(mots)[0];
    const leurres = melanger(reservoir.filter((m) => m.toLowerCase() !== cible.toLowerCase()))
      .slice(0, 3);
    if (leurres.length < 3) continue;
    questions.push({
      type: "trou",
      invite: phrase.texte.replace(new RegExp(`\\b${cible}\\b`), "……"),
      attendu: cible,
      choix: melanger([cible, ...leurres]),
    });
  }

  return { verrouille: false, raison: null, questions };
}

function melangerParDefaut(liste) {
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}
