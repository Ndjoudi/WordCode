/**
 * story-builder.js — section §06 « Histoire du jour » (README §2, §6.5, §14).
 *
 * Choisit le texte du jour parmi le stock hors ligne, en fonction de ce que
 * l'utilisateur connaît réellement. La règle des 95% n'est pas décorative :
 * en dessous, la lecture cesse d'être fluide, les mots inconnus ne se devinent
 * plus au contexte et le texte devient un exercice de traduction.
 *
 * Ce service ne fait aucun appel réseau. Quand le stock ne suffit pas, il le
 * DIT — c'est l'écran qui décide de demander une génération à l'API (§16).
 *
 * Fonctions pures.
 */

import { aujourdhui, motsConnus } from "./leitner.js";

/** Couverture minimale pour qu'une histoire soit servie telle quelle (§6.5). */
export const COUVERTURE_MIN = 0.95;

/**
 * Chapitres d'un feuilleton qu'on peut lire le même jour. Un seul, c'est trop
 * frustrant quand l'intrigue accroche ; davantage, et le mois de lecture se
 * réduit à une semaine.
 */
export const CHAPITRES_PAR_JOUR = 2;

/**
 * Prochain chapitre à lire d'un feuilleton : le premier non lu, dans l'ordre.
 * Les feuilletons se suivent par saison (`saison`, 1 par défaut), puis dans
 * l'ordre où le contenu les livre — un nouveau feuilleton ne passe jamais
 * devant celui qu'on est en train de lire.
 *
 * @param {object[]} histoires
 * @param {Set<string>} lues
 * @returns {?{histoire:object, numero:number, total:number}}
 */
export function prochainChapitre(histoires = [], lues = new Set()) {
  const feuilletons = histoires.filter((h) => h.feuilleton);
  const saisonDe = (arc) => Math.min(...feuilletons
    .filter((h) => h.arc === arc).map((h) => Number(h.saison) || 1));
  const arcs = [...new Set(feuilletons.map((h) => h.arc))]
    .map((arc, rang) => ({ arc, rang, saison: saisonDe(arc) }))
    .sort((a, b) => a.saison - b.saison || a.rang - b.rang)
    .map(({ arc }) => arc);
  for (const arc of arcs) {
    const chapitres = histoires
      .filter((h) => h.feuilleton && h.arc === arc)
      .sort((a, b) => Number(a.ordre) - Number(b.ordre));
    const rang = chapitres.findIndex((h) => !lues.has(h.id));
    if (rang !== -1) return { histoire: chapitres[rang], numero: rang + 1, total: chapitres.length };
  }
  return null;
}

/**
 * Histoires lues aujourd'hui.
 *
 * @param {object} state
 * @param {string} today
 * @returns {string[]} ids
 */
export function luesAujourdhui(state, today = aujourdhui()) {
  const jour = state?.progression?.histoires_du_jour;
  return jour?.date === today && Array.isArray(jour.ids) ? jour.ids : [];
}

/**
 * Part du lexique d'une histoire que l'utilisateur connaît déjà.
 * Une histoire sans lexique déclaré est considérée comme non couverte : on ne
 * sert pas un texte dont on ne sait pas mesurer la difficulté.
 *
 * @param {object} histoire
 * @param {Set<string>} connus
 * @returns {number} entre 0 et 1
 */
export function couverture(histoire, connus = new Set()) {
  const lexique = histoire?.lexique ?? [];
  if (!lexique.length) return 0;
  const sus = lexique.filter((id) => connus.has(id)).length;
  return sus / lexique.length;
}

/**
 * Choisit l'histoire du jour (README §14, `storyBuilder`).
 *
 * Un feuilleton en cours passe avant tout : on lit la suite, chapitre après
 * chapitre, jusqu'à deux par jour (§07). Il n'est pas soumis aux 95% : c'est
 * une seule intrigue, on ne saute pas un chapitre parce qu'il contient des
 * mots nouveaux — un tap les traduit.
 *
 * Sans feuilleton en cours, à couverture égale, la continuation d'un arc déjà
 * entamé l'emporte : une histoire suivie tient le lecteur mieux qu'une
 * succession de textes isolés.
 *
 * @param {object} options
 * @param {object} options.state
 * @param {object[]} options.histoires
 * @param {string} options.today
 * @returns {{histoire:?object, couverture:number, suffisante:boolean,
 *            dejaLue:boolean, verrouille:boolean, raison:?string}}
 */
export function choisirHistoire({ state, histoires = [], today = aujourdhui() } = {}) {
  const lues = new Set(state?.progression?.histoires_lues ?? []);

  const chapitre = prochainChapitre(histoires, lues);
  if (chapitre) {
    const duJour = luesAujourdhui(state, today);
    const infos = { numero: chapitre.numero, total: chapitre.total,
                    serie_fr: chapitre.histoire.serie_fr ?? null,
                    serie_en: chapitre.histoire.serie_en ?? null };
    if (duJour.length >= CHAPITRES_PAR_JOUR) {
      return {
        histoire: histoires.find((h) => h.id === duJour.at(-1)) ?? null,
        couverture: 1, suffisante: true, dejaLue: true, verrouille: false, raison: null,
        chapitre: { ...infos, restantsAujourdhui: 0 },
      };
    }
    return {
      histoire: chapitre.histoire,
      couverture: couverture(chapitre.histoire, new Set(motsConnus(state))),
      suffisante: true,
      dejaLue: false,
      verrouille: false,
      raison: null,
      chapitre: { ...infos, restantsAujourdhui: CHAPITRES_PAR_JOUR - duJour.length },
    };
  }

  if (state?.progression?.derniere_histoire === today) {
    const id = [...lues].at(-1);
    return {
      histoire: histoires.find((h) => h.id === id) ?? null,
      couverture: 1,
      suffisante: true,
      dejaLue: true,
      verrouille: false,
      raison: null,
    };
  }

  const connus = new Set(motsConnus(state));
  const candidates = histoires.filter((h) => !lues.has(h.id));

  if (!candidates.length) {
    return {
      histoire: null, couverture: 0, suffisante: false, dejaLue: false,
      verrouille: true,
      raison: histoires.length
        ? "Tu as lu toutes les histoires disponibles."
        : "Aucune histoire n'est encore livrée.",
    };
  }

  const arcsEnCours = new Set(
    histoires.filter((h) => lues.has(h.id) && h.arc).map((h) => h.arc));

  const classees = candidates
    .map((histoire) => ({ histoire, part: couverture(histoire, connus) }))
    .sort((a, b) => {
      if (b.part !== a.part) return b.part - a.part;
      const suiteA = a.histoire.arc && arcsEnCours.has(a.histoire.arc) ? 1 : 0;
      const suiteB = b.histoire.arc && arcsEnCours.has(b.histoire.arc) ? 1 : 0;
      if (suiteA !== suiteB) return suiteB - suiteA;
      return Number(a.histoire.ordre ?? 0) - Number(b.histoire.ordre ?? 0);
    });

  const meilleure = classees[0];
  return {
    histoire: meilleure.histoire,
    couverture: meilleure.part,
    suffisante: meilleure.part >= COUVERTURE_MIN,
    dejaLue: false,
    verrouille: false,
    raison: null,
  };
}

/**
 * Marque l'histoire du jour comme lue et fait monter d'une boîte les mots de
 * son lexique lus sans consulter la traduction (README §4.1).
 *
 * @param {object} options
 * @param {object} options.state
 * @param {object} options.histoire
 * @param {string[]} options.aides  ids dont la traduction a été consultée
 * @param {Function} options.appliquer  injectée pour rester sans dépendance forte
 * @param {string} options.today
 * @returns {object} nouvel état
 */
export function appliquerHistoire({ state, histoire, aides = [], appliquer,
                                    today = aujourdhui() } = {}) {
  if (!histoire) return state;

  const consultes = new Set(aides);
  const words = { ...state.words };
  for (const id of histoire.lexique ?? []) {
    // Un mot que l'utilisateur ne connaît pas encore n'a rien à faire ici :
    // l'histoire révise, elle n'introduit pas (§1).
    if (!words[id]) continue;
    words[id] = appliquer(words[id], {
      succes: true,
      traductionConsultee: consultes.has(id),
      date: today,
    });
  }

  const lues = state?.progression?.histoires_lues ?? [];
  const duJour = luesAujourdhui(state, today);
  return {
    ...state,
    words,
    progression: {
      ...state.progression,
      histoires_lues: lues.includes(histoire.id) ? lues : [...lues, histoire.id],
      derniere_histoire: today,
      // Sert à la limite de chapitres par jour du feuilleton.
      histoires_du_jour: {
        date: today,
        ids: duJour.includes(histoire.id) ? duJour : [...duJour, histoire.id],
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Secours par génération (README §16)                                         */
/* -------------------------------------------------------------------------- */

/**
 * Compose la requête à envoyer à l'API quand le stock ne suffit pas.
 *
 * On n'envoie que des mots RÉELLEMENT connus : c'est la seule garantie que le
 * texte reçu sera lisible. Si un arc est en cours, on joint son résumé pour
 * que la génération enchaîne au lieu de repartir de zéro.
 *
 * @param {object} options
 * @param {object} options.state
 * @param {Map<string,object>} options.catalogue
 * @param {object[]} options.histoires
 * @param {number} options.longueur
 * @returns {{mots:string[], arc:?object, longueur:number}}
 */
export function requeteHistoire({ state, catalogue, histoires = [], longueur = 300 } = {}) {
  const mots = motsConnus(state)
    .map((id) => catalogue?.get(id)?.en)
    .filter(Boolean);

  const lues = new Set(state?.progression?.histoires_lues ?? []);
  const derniere = [...histoires].reverse().find((h) => lues.has(h.id) && h.arc);

  return {
    mots,
    arc: derniere ? { id: derniere.arc, resume_en: derniere.titre_en ?? null } : null,
    longueur,
  };
}

/**
 * Transforme une réponse de l'API en histoire exploitable (§6.5).
 *
 * Le lexique est recalculé à partir du texte reçu, jamais lu dans la réponse :
 * le modèle n'est pas une source fiable pour dire ce qu'il a employé.
 *
 * @param {object} reponse
 * @param {object} options
 * @param {Map<string,object>} options.catalogue
 * @param {string} options.id
 * @param {?string} options.arc
 * @param {?string} options.suiteDe
 * @returns {?object}
 */
export function histoireDepuisApi(reponse, { catalogue, id, arc = null, suiteDe = null } = {}) {
  const texte = String(reponse?.texte_en ?? "").trim();
  if (!texte) return null;

  const parEn = new Map();
  for (const mot of catalogue?.values() ?? []) if (!parEn.has(mot.en)) parEn.set(mot.en, mot.id);

  const lexique = new Set();
  const hors = new Set();
  for (const jeton of texte.split(/\s+/)) {
    const nu = jeton.toLowerCase().replace(/[^a-z']/g, "");
    if (!nu) continue;
    const ref = parEn.get(nu);
    if (ref) lexique.add(ref);
    else hors.add(nu);
  }

  return {
    id,
    arc,
    ordre: null,
    titre_en: reponse.titre_en ?? null,
    titre_fr: reponse.titre_fr ?? null,
    texte_en: texte,
    texte_fr: reponse.texte_fr ?? null,
    nb_mots: texte.split(/\s+/).length,
    lexique: [...lexique],
    hors_lexique: [...hors].sort(),
    suite_de: suiteDe,
    source: "api",
  };
}

/** Identifiant d'une histoire générée : daté, donc unique et lisible. */
export function idHistoireGeneree(today = aujourdhui()) {
  return `h_api_${today}`;
}
