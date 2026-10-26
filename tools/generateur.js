#!/usr/bin/env node
/**
 * generateur.js — production des parties, hors ligne (README §9).
 *
 * Script Node autonome. Il ne fait PAS partie de l'application et n'est jamais
 * appelé depuis le navigateur (§17.9).
 *
 *   node tools/generateur.js --generer           (tous les paliers d'un coup)
 *   node tools/generateur.js --mots-meles        (grilles de mots mêlés)
 *   node tools/generateur.js --verify            (tous les paliers)
 *   node tools/generateur.js --verify --palier 3
 *
 * Deux règles non négociables :
 *   1. la chaîne de déduction complète est SIMULÉE avant d'accepter une partie ;
 *   2. aucune partie non vérifiée n'est écrite — après 50 essais elle part
 *      dans rejets.json.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { controlerGrille, SENS } from "../services/wordsearch-builder.js";

const RACINE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CONTENU = path.join(RACINE, "content");

/** Nombre de mots par partie (§9). */
const MOTS_PAR_PARTIE = 5;

/** Les deux jeux que le générateur alimente en alternance (§05, §6.4). */
const JEUX = ["grille", "croises"];

/** Longueur admise pour un mot de grille (§9). */
const LONGUEUR_MIN = 3;
const LONGUEUR_MAX = 8;

/** Essais avant d'abandonner un groupe de mots (§9). */
const ESSAIS_MAX = 50;

/** Taille de la grille de mots croisés. */
const GRILLE_MAX = 15;

/** Ordres de placement essayés avant d'abandonner une grille. */
const PERMUTATIONS_MAX = 120;

/** Nœuds explorés par le retour arrière, avant abandon d'un ordre. */
const BUDGET_NOEUDS = 4000;

/* -------------------------------------------------------------------------- */
/* Utilitaires                                                                 */
/* -------------------------------------------------------------------------- */

const lire = (chemin) => JSON.parse(fs.readFileSync(chemin, "utf8"));
const lettresDe = (texte) => String(texte ?? "").toUpperCase().replace(/[^A-Z]/g, "");
const distinctes = (texte) => new Set(lettresDe(texte));

/** Numéro à deux chiffres : 3 → "03". */
const deuxChiffres = (n) => String(n).padStart(2, "0");

/* -------------------------------------------------------------------------- */
/* Étape 2 — alphabet                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Lettres de la phrase puis des mots, dans l'ordre d'apparition, numérotées à
 * partir de 1 (§9, étape 2).
 *
 * @param {string} phrase
 * @param {string[]} mots
 * @returns {?Object<string,string>} numéro → lettre, ou null si > 26 entrées
 */
export function construireAlphabet(phrase, mots) {
  const vues = [];
  const ajouter = (texte) => {
    for (const lettre of lettresDe(texte)) {
      if (!vues.includes(lettre)) vues.push(lettre);
    }
  };

  ajouter(phrase);
  for (const mot of mots) ajouter(mot);

  if (vues.length > 26) return null;
  return Object.fromEntries(vues.map((lettre, i) => [String(i + 1), lettre]));
}

/* -------------------------------------------------------------------------- */
/* Étape 5 — grille de mots croisés (§9)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Place les mots en 2D, en partant du plus long, chaque mot devant croiser au
 * moins un mot déjà placé (§9). Renvoie null si un mot ne trouve pas de place.
 *
 * @param {Array<{id:string, en:string}>} mots
 * @returns {?{grille:Array<Array<?string>>, placements:object[], largeur:number, hauteur:number}}
 */
export function construireCroises(mots) {
  // §9 demande de partir du mot le plus long : c'est la première tentative.
  // Un placement glouton se bloque souvent — TABLE posé sur le T de WATER
  // prive NIGHT de son seul croisement — et l'ordre décide de tout. Comme le
  // script tourne hors ligne, on peut se permettre d'essayer tous les ordres
  // plutôt que de rejeter une partie sur un hasard de parcours.
  const parLongueur = [...mots].sort((a, b) => b.en.length - a.en.length);

  for (const ordre of permutations(parLongueur, PERMUTATIONS_MAX)) {
    const essai = placerCroises(ordre, mots);
    if (essai) return essai;
  }
  return null;
}

/**
 * Ordres à essayer, le premier étant celui de la §9 (plus long d'abord).
 * Plafonné : au-delà, le coût explose sans gain.
 *
 * @param {object[]} liste
 * @param {number} plafond
 * @returns {object[][]}
 */
function permutations(liste, plafond) {
  const sorties = [];

  const explorer = (restants, courant) => {
    if (sorties.length >= plafond) return;
    if (!restants.length) {
      sorties.push(courant);
      return;
    }
    for (let i = 0; i < restants.length; i += 1) {
      explorer([...restants.slice(0, i), ...restants.slice(i + 1)], [...courant, restants[i]]);
      if (sorties.length >= plafond) return;
    }
  };

  explorer(liste, []);
  return sorties;
}

/**
 * Un essai de placement, avec un ordre donné.
 *
 * Recherche avec RETOUR ARRIÈRE : pour chaque mot on énumère tous les
 * croisements licites, pas seulement le premier. Un choix qui condamne un mot
 * suivant est défait. Le budget de nœuds borne l'exploration.
 *
 * @param {object[]} tries  mots dans l'ordre de placement
 * @param {object[]} mots   tous les mots, pour la sortie
 * @returns {?object}
 */
function placerCroises(tries, mots) {
  const cases = new Map();          // "x,y" → { lettre, mot }
  const placements = [];
  let budget = BUDGET_NOEUDS;

  /** Placements licites d'un mot, croisant au moins une case occupée. */
  const candidats = (mot) => {
    const lettres = lettresDe(mot.en);
    const trouves = [];

    for (const [cle, occupee] of cases) {
      const [cx, cy] = cle.split(",").map(Number);
      for (let i = 0; i < lettres.length; i += 1) {
        if (lettres[i] !== occupee.lettre) continue;
        for (const dir of ["V", "H"]) {
          const x = dir === "H" ? cx - i : cx;
          const y = dir === "V" ? cy - i : cy;
          if (licite(mot, x, y, dir)) trouves.push({ x, y, dir });
        }
      }
    }
    return trouves;
  };

  /** Le placement respecte-t-il lettres, voisinage et encombrement ? */
  const licite = (mot, x, y, dir) => {
    const lettres = lettresDe(mot.en);

    const xs = [...cases.keys()].map((c) => Number(c.split(",")[0]));
    const ys = [...cases.keys()].map((c) => Number(c.split(",")[1]));
    const finX = dir === "H" ? x + lettres.length - 1 : x;
    const finY = dir === "V" ? y + lettres.length - 1 : y;
    if (Math.max(...xs, finX) - Math.min(...xs, x) + 1 > GRILLE_MAX) return false;
    if (Math.max(...ys, finY) - Math.min(...ys, y) + 1 > GRILLE_MAX) return false;

    let croisements = 0;
    for (let i = 0; i < lettres.length; i += 1) {
      const cx = dir === "H" ? x + i : x;
      const cy = dir === "V" ? y + i : y;
      const occupee = cases.get(`${cx},${cy}`);

      if (occupee) {
        if (occupee.lettre !== lettres[i]) return false;
        croisements += 1;
        continue;
      }
      // Une case libre ne doit pas jouxter un mot dans le sens perpendiculaire,
      // sinon on fabrique un mot parasite.
      const voisines = dir === "H"
        ? [`${cx},${cy - 1}`, `${cx},${cy + 1}`]
        : [`${cx - 1},${cy}`, `${cx + 1},${cy}`];
      if (voisines.some((cle) => cases.has(cle))) return false;
    }

    const avant = dir === "H" ? `${x - 1},${y}` : `${x},${y - 1}`;
    const apres = dir === "H" ? `${x + lettres.length},${y}` : `${x},${y + lettres.length}`;
    if (cases.has(avant) || cases.has(apres)) return false;

    return croisements >= 1;   // §9 : chaque mot croise au moins un autre
  };

  const poser = (mot, x, y, dir) => {
    const lettres = lettresDe(mot.en);
    const ajoutees = [];
    for (let i = 0; i < lettres.length; i += 1) {
      const cx = dir === "H" ? x + i : x;
      const cy = dir === "V" ? y + i : y;
      const cle = `${cx},${cy}`;
      if (!cases.has(cle)) {
        cases.set(cle, { lettre: lettres[i], mot: mot.id });
        ajoutees.push(cle);
      }
    }
    placements.push({ mot: mot.id, x, y, dir });
    return ajoutees;
  };

  const retirer = (ajoutees) => {
    for (const cle of ajoutees) cases.delete(cle);
    placements.pop();
  };

  const explorer = (rang) => {
    if (rang >= tries.length) return true;
    if (budget-- <= 0) return false;

    for (const { x, y, dir } of candidats(tries[rang])) {
      const ajoutees = poser(tries[rang], x, y, dir);
      if (explorer(rang + 1)) return true;
      retirer(ajoutees);
    }
    return false;
  };

  // Le premier mot fonde la grille. On essaie les deux orientations : elles
  // ne donnent pas les mêmes possibilités pour la suite.
  for (const dirAncre of ["H", "V"]) {
    cases.clear();
    placements.length = 0;
    budget = BUDGET_NOEUDS;

    poser(tries[0], 0, 0, dirAncre);
    if (explorer(1)) return finaliser(placements, mots);
  }
  return null;
}

/** Recadrage à l'origine, numérotation standard, et grille de sortie. */
function finaliser(placements, mots) {
  const parId = new Map(mots.map((m) => [m.id, m]));
  const cases = [];
  for (const p of placements) {
    const lettres = lettresDe(parId.get(p.mot).en);
    for (let i = 0; i < lettres.length; i += 1) {
      cases.push([p.dir === "H" ? p.x + i : p.x, p.dir === "V" ? p.y + i : p.y]);
    }
  }

  const dx = -Math.min(...cases.map((c) => c[0]));
  const dy = -Math.min(...cases.map((c) => c[1]));
  const largeur = Math.max(...cases.map((c) => c[0])) + dx + 1;
  const hauteur = Math.max(...cases.map((c) => c[1])) + dy + 1;

  const recadres = placements.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));

  // Numérotation : balayage haut-gauche → bas-droite, un numéro par départ.
  const departs = new Map();
  for (const p of recadres) {
    const cle = `${p.x},${p.y}`;
    if (!departs.has(cle)) departs.set(cle, []);
    departs.get(cle).push(p);
  }

  let numero = 0;
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const ici = departs.get(`${x},${y}`);
      if (!ici) continue;
      numero += 1;
      for (const p of ici) p.num = numero;
    }
  }

  const grille = Array.from({ length: hauteur }, () => Array(largeur).fill(null));
  for (const p of recadres) {
    const lettres = lettresDe(parId.get(p.mot).en);
    for (let i = 0; i < lettres.length; i += 1) {
      grille[p.dir === "V" ? p.y + i : p.y][p.dir === "H" ? p.x + i : p.x] = p.mot;
    }
  }

  return { grille, placements: recadres, largeur, hauteur };
}

/* -------------------------------------------------------------------------- */
/* Génération d'une partie                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Tente de composer une partie à partir de 5 mots. Renvoie null si aucune
 * combinaison phrase / mot-amorce ne passe la simulation.
 *
 * @param {object[]} mots        les 5 entités word
 * @param {object[]} phrases     réservoir, phrases libres seulement
 * @param {object} contexte      { palier, ordre, idPartie, jeuSouhaite }
 * @returns {{partie:?object, phrase:?object, motif:?string}}
 */
export function composerPartie(mots, phrases,
                               { palier, ordre, idPartie, jeuSouhaite = "grille" }) {
  const enMajuscules = mots.map((m) => lettresDe(m.en));

  const horsGabarit = mots.filter(
    (m) => lettresDe(m.en).length < LONGUEUR_MIN || lettresDe(m.en).length > LONGUEUR_MAX);
  if (horsGabarit.length) {
    return { partie: null, phrase: null,
             motif: `mots hors gabarit ${LONGUEUR_MIN}-${LONGUEUR_MAX} : ${horsGabarit.map((m) => m.en).join(", ")}` };
  }

  const lettresMots = new Set(enMajuscules.flatMap((mot) => [...distinctes(mot)]));

  // Le placement 2D ne dépend QUE des mots : on le calcule une seule fois,
  // hors de la boucle des phrases. Le laisser à l'intérieur faisait rejouer
  // cinquante fois un calcul au résultat identique.
  const croises = construireCroises(mots);

  // Un bloc dont les mots ne se croisent pas reste parfaitement jouable en
  // codeword : il alimente alors la grille, jamais les mots croisés (§05).
  const jeu = croises ? jeuSouhaite : "grille";

  let essais = 0;
  let dernierMotif = "aucune phrase compatible";

  for (const phrase of phrases) {
    const lettresPhrase = distinctes(phrase.en);

    // §9 (v4) : la grille démarre vide, il n'y a plus de déduction à amorcer.
    // Ce qu'il faut garantir, c'est que la phrase cachée devienne LISIBLE une
    // fois la grille remplie — donc que chacune de ses lettres apparaisse dans
    // au moins un des 5 mots. C'est l'inverse exact de la contrainte v3.
    const illisibles = [...lettresPhrase].filter((l) => !lettresMots.has(l));
    if (illisibles.length) {
      dernierMotif = `les mots ne révèlent pas ${illisibles.join(",")} de ${phrase.id}`;
      continue;
    }

    const alphabet = construireAlphabet(phrase.en, enMajuscules);
    if (!alphabet) {
      dernierMotif = `alphabet de plus de 26 entrées avec ${phrase.id}`;
      continue;
    }

    if (essais >= ESSAIS_MAX) {
      return { partie: null, phrase: null,
               motif: `${ESSAIS_MAX} essais sans succès — dernier : ${dernierMotif}` };
    }
    essais += 1;

    return {
      phrase,
      motif: null,
      partie: {
        id: idPartie,
        palier,
        ordre,
        // §05 : une partie n'alimente qu'un seul des deux jeux. L'alternance
        // par rang garantit que les deux sections reçoivent autant de contenu
        // et ne partagent jamais un mot.
        jeu,
        phrase_id: phrase.id,
        phrase_en: phrase.en,
        phrase_fr: phrase.fr,
        contexte_fr: phrase.contexte_fr ?? null,
        mots: mots.map((m) => m.id),
        alphabet,
        croises: croises ?? null,
        verifie: true,
      },
    };
  }

  return { partie: null, phrase: null, motif: dernierMotif };
}

/* -------------------------------------------------------------------------- */
/* Commandes                                                                   */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Paliers déclarés au manifeste, dans l'ordre, avec leurs mots. Les paliers
 * de fréquence et les paliers thématiques (TOEIC) sont traités pareil : un
 * palier n'est qu'un fichier de mots et un rang de déblocage.
 *
 * @returns {{manifeste:object, paliers:Array<{entree:object, mots:object[]}>}}
 */
function chargerCatalogue() {
  const manifeste = lire(path.join(CONTENU, "manifest.json"));
  const paliers = [...manifeste.paliers]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .filter((entree) => fs.existsSync(path.join(CONTENU, entree.fichier)))
    .map((entree) => ({ entree, mots: lire(path.join(CONTENU, entree.fichier)).mots ?? [] }));
  return { manifeste, paliers };
}

/** Numéros de tous les paliers déclarés, dans l'ordre. */
function idsDesPaliers() {
  return chargerCatalogue().paliers.map(({ entree }) => Number(entree.id));
}

/** Tous les mots du catalogue, par id. */
function tousLesMots() {
  const mots = new Map();
  for (const { mots: liste } of chargerCatalogue().paliers) {
    for (const mot of liste) mots.set(mot.id, mot);
  }
  return mots;
}

/* -------------------------------------------------------------------------- */
/* Génération                                                                  */
/* -------------------------------------------------------------------------- */

/** Parties produites, par palier et par jeu. */
const PARTIES_PAR_JEU = 5;

/**
 * Parties garanties à chaque palier, même quand le réservoir de phrases
 * s'épuise : une pour la grille, une pour les mots croisés.
 */
const MIN_PAR_PALIER = 2;

/** Mots du palier courant dans chaque partie ; les autres viennent de l'acquis. */
const MOTS_NOUVEAUX = 2;

/** Graine du tirage : deux exécutions donnent exactement les mêmes parties. */
const GRAINE = 20261021;

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
function aleatoire(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un mot peut-il entrer dans une partie (gabarit et indice) ? */
function jouable(mot) {
  const longueur = lettresDe(mot.en).length;
  return Boolean(mot.eligible_grille)
    && longueur >= LONGUEUR_MIN && longueur <= LONGUEUR_MAX
    && Array.isArray(mot.indice?.segments) && mot.indice.segments.length > 0;
}

/**
 * Range chaque mot jouable dans UN seul des deux jeux : c'est la règle « jamais
 * les mêmes mots » (§06). L'alternance suit l'ordre du palier, pour que chaque
 * jeu reçoive la moitié de chaque palier. Un mot qui ne peut pas se croiser
 * reste dans la grille.
 *
 * @param {object[]} mots
 * @returns {Map<string,string>} id → "grille" | "croises"
 */
function partagerEntreJeux(mots) {
  const jeuDe = new Map();
  let bascule = 0;
  for (const mot of mots) {
    if (!jouable(mot)) continue;
    jeuDe.set(mot.id, mot.eligible_croises === false ? "grille" : JEUX[bascule++ % 2]);
  }
  return jeuDe;
}

/**
 * Compose un groupe de 5 mots : deux du palier courant, les moins servis
 * d'abord, puis trois de l'acquis, choisis pour les lettres qu'ils apportent.
 *
 * Un mot de l'acquis peut revenir d'une partie à l'autre — c'est ce qui permet
 * de mêler les paliers sans retarder le déblocage — mais chaque reprise le
 * pénalise, pour que le réemploi se répartisse au lieu de se concentrer.
 *
 * @param {object[]} nouveaux   mots du palier courant, pour ce jeu
 * @param {object[]} acquis     mots des paliers antérieurs, pour ce jeu
 * @param {Map<string,number>} usages
 * @param {Function} alea
 * @returns {?object[]}
 */
function composerGroupe(nouveaux, acquis, usages, alea) {
  const servi = (mot) => usages.get(mot.id) ?? 0;
  const amorces = nouveaux
    .map((mot) => ({ mot, cle: servi(mot) + alea() }))
    .sort((a, b) => a.cle - b.cle)
    .slice(0, MOTS_NOUVEAUX)
    .map(({ mot }) => mot);

  const groupe = [...amorces];
  const lettres = new Set(groupe.flatMap((mot) => [...distinctes(mot.en)]));
  const vivier = [...acquis, ...nouveaux];

  while (groupe.length < MOTS_PAR_PARTIE) {
    let meilleur = null;
    let score = -Infinity;
    for (const mot of vivier) {
      if (groupe.includes(mot)) continue;
      if (groupe.some((autre) => lettresDe(autre.en) === lettresDe(mot.en))) continue;
      const apport = [...distinctes(mot.en)].filter((l) => !lettres.has(l)).length;
      // Au palier 1 l'acquis est vide : les nouveaux mots complètent le groupe.
      const ancien = acquis.length && acquis.includes(mot) ? 4 : 0;
      const note = apport + ancien - 2 * servi(mot) + 3 * alea();
      if (note > score) { meilleur = mot; score = note; }
    }
    if (!meilleur) return null;
    groupe.push(meilleur);
    for (const l of distinctes(meilleur.en)) lettres.add(l);
  }
  return groupe;
}

/**
 * Régénère TOUTES les parties, palier par palier (§9).
 *
 * La génération est globale et non plus palier par palier : les phrases du
 * réservoir, le partage des mots entre les deux jeux et le compteur de
 * réemploi courent sur tout le catalogue.
 */
function genererTout() {
  const cheminPhrases = path.join(CONTENU, "phrases.json");
  if (!fs.existsSync(cheminPhrases)) {
    console.error("content/phrases.json est absent : le réservoir de phrases est");
    console.error("indispensable à la génération (README §6.3). Rien n'a été écrit.");
    process.exit(1);
  }

  const { manifeste, paliers } = chargerCatalogue();
  const brutPhrases = lire(cheminPhrases);
  const phrases = Array.isArray(brutPhrases) ? brutPhrases : brutPhrases.phrases ?? [];
  for (const phrase of phrases) phrase.utilisee_par = null;

  const alea = aleatoire(GRAINE);
  const jeuDe = partagerEntreJeux(paliers.flatMap(({ mots }) => mots));
  const usages = new Map();
  const acquis = { grille: [], croises: [] };
  const rejets = [];
  let total = 0;

  for (const [rangPalier, { entree, mots }] of paliers.entries()) {
    const numero = Number(entree.id);
    const nom = deuxChiffres(numero);
    const parties = [];
    const nouveaux = {
      grille: mots.filter((mot) => jeuDe.get(mot.id) === "grille"),
      croises: mots.filter((mot) => jeuDe.get(mot.id) === "croises"),
    };

    // Chaque phrase cachée ne sert qu'une fois (§6.3) : le réservoir borne le
    // nombre de parties. Un palier en prend dix tant qu'il en reste assez pour
    // garantir le minimum à tous les paliers suivants.
    const restants = paliers.length - rangPalier - 1;
    const libres = phrases.filter((p) => !p.utilisee_par).length;
    const quota = Math.max(MIN_PAR_PALIER,
      Math.min(PARTIES_PAR_JEU * JEUX.length, libres - restants * MIN_PAR_PALIER));

    for (let rang = 0; rang < quota; rang += 1) {
      {
        const jeu = JEUX[rang % JEUX.length];
        const ordre = parties.length + rejets.filter((r) => r.palier === numero).length + 1;
        const idPartie = `p_${nom}${deuxChiffres(ordre)}`;
        let reussie = null;
        let motif = "aucun groupe composé";

        for (let essai = 0; essai < ESSAIS_MAX && !reussie; essai += 1) {
          const groupe = composerGroupe(nouveaux[jeu], acquis[jeu], usages, alea);
          if (!groupe) break;
          const libres = phrases.filter((p) => !p.utilisee_par);
          const resultat = composerPartie(groupe, libres,
            { palier: numero, ordre, idPartie, jeuSouhaite: jeu });
          if (!resultat.partie) { motif = resultat.motif; continue; }
          // Des mots qui ne se croisent pas tomberaient dans l'autre jeu : on
          // recompose plutôt que de briser le partage.
          if (resultat.partie.jeu !== jeu) { motif = "les cinq mots ne se croisent pas"; continue; }
          reussie = resultat;
        }

        if (!reussie) {
          rejets.push({ palier: numero, ordre, jeu, motif });
          console.log(`  rejet  palier ${nom} ${jeu} — ${motif}`);
          continue;
        }

        reussie.phrase.utilisee_par = reussie.partie.id;
        for (const id of reussie.partie.mots) usages.set(id, (usages.get(id) ?? 0) + 1);
        parties.push(reussie.partie);
      }
    }

    for (const jeu of JEUX) acquis[jeu].push(...nouveaux[jeu]);

    const fichier = `parties/parties-${nom}.json`;
    fs.writeFileSync(path.join(CONTENU, fichier),
      JSON.stringify({ palier: numero, version: 3, parties }, null, 2) + "\n");
    total += parties.length;

    // Les paliers ajoutés après coup (TOEIC) n'avaient pas encore de parties.
    if (!entree.parties) {
      const rang = manifeste.paliers.indexOf(entree);
      const { id, fichier: f, ...reste } = entree;
      manifeste.paliers[rang] = { id, fichier: f, parties: fichier, ...reste };
    }

    const melanges = parties.filter((p) => {
      const origine = new Set(p.mots.map((id) => paliers.find((x) => x.mots.some((m) => m.id === id)).entree.id));
      return origine.size > 1;
    }).length;
    console.log(`palier ${nom} : ${parties.length} parties, ${melanges} mêlant plusieurs paliers`);
  }

  fs.writeFileSync(path.join(CONTENU, "manifest.json"), JSON.stringify(manifeste, null, 2) + "\n");
  fs.writeFileSync(path.join(CONTENU, "rejets.json"), JSON.stringify(rejets, null, 2) + "\n");
  // Le réservoir garde la trace des phrases consommées (§6.3).
  fs.writeFileSync(cheminPhrases, JSON.stringify(
    Array.isArray(brutPhrases) ? phrases : { ...brutPhrases, phrases }, null, 2) + "\n");

  const libres = phrases.filter((p) => !p.utilisee_par).length;
  console.log(`\n${total} parties écrites · ${rejets.length} rejet(s) · ${libres} phrases encore libres`);
}

/* -------------------------------------------------------------------------- */
/* Mots mêlés (§10)                                                            */
/* -------------------------------------------------------------------------- */

/** Grilles produites par palier. */
const MELES_PAR_PALIER = 5;

/** Tailles essayées : la grille s'ajuste à la longueur de l'expression. */
const MELES_TAILLES = [7, 8, 9];

/** Bornes du nombre de mots cachés dans une grille. */
const MELES_MOTS_MIN = 5;
const MELES_MOTS_MAX = 10;

/** Mots du palier courant dans chaque grille ; les autres viennent de l'acquis. */
const MELES_NOUVEAUX = 3;

/** Essais avant d'abandonner une grille. */
const MELES_ESSAIS = 400;

/**
 * Sens de lecture : vers la droite, vers le bas, en diagonale descendante.
 * Jamais à l'envers — c'est la version facile, la seule livrée. Le service
 * de l'application relit les grilles avec les mêmes sens.
 */
const MELES_SENS = SENS;

/**
 * Pose des mots dans une grille vide jusqu'à ce que les cases libres soient
 * exactement aussi nombreuses que les lettres de l'expression.
 *
 * @returns {?{lignes:Array<Array<?string>>, places:object[]}}
 */
function poserMotsMeles(taille, cible, candidats, alea) {
  const g = Array.from({ length: taille }, () => Array(taille).fill(null));
  const places = [];
  let occupees = 0;

  for (const mot of candidats) {
    if (places.length >= MELES_MOTS_MAX || occupees === cible) break;
    const en = lettresDe(mot.en);
    if (en.length > taille) continue;

    const options = [];
    for (const [dx, dy] of MELES_SENS) {
      for (let y = 0; y + dy * (en.length - 1) < taille; y += 1) {
        for (let x = 0; x + dx * (en.length - 1) < taille; x += 1) {
          let nouvelles = 0, ok = true;
          for (let i = 0; i < en.length; i += 1) {
            const v = g[y + dy * i][x + dx * i];
            if (v === null) nouvelles += 1;
            else if (v !== en[i]) { ok = false; break; }
          }
          if (ok && nouvelles > 0 && occupees + nouvelles <= cible) options.push({ x, y, dx, dy, nouvelles });
        }
      }
    }
    if (!options.length) continue;
    const choix = options[Math.floor(alea() * options.length)];
    for (let i = 0; i < en.length; i += 1) g[choix.y + choix.dy * i][choix.x + choix.dx * i] = en[i];
    occupees += choix.nouvelles;
    places.push({ id: mot.id, x: choix.x, y: choix.y, dx: choix.dx, dy: choix.dy });
  }

  if (occupees !== cible || places.length < MELES_MOTS_MIN) return null;
  return { lignes: g, places };
}

/**
 * Régénère toutes les grilles de mots mêlés (§10).
 *
 * Même logique que les parties : des mots du palier courant, complétés par
 * l'acquis. Les lettres restantes, lues dans l'ordre, forment une expression
 * du réservoir. Une expression ne sert qu'une fois parmi les mots mêlés ;
 * elle peut avoir déjà servi au codeword, c'est un autre jeu.
 */
function genererMotsMeles() {
  const { manifeste, paliers } = chargerCatalogue();
  const tous = new Map(paliers.flatMap(({ mots }) => mots.map((m) => [m.id, m])));
  const brutPhrases = lire(path.join(CONTENU, "phrases.json"));
  const phrases = (Array.isArray(brutPhrases) ? brutPhrases : brutPhrases.phrases ?? [])
    .map((p) => ({ ...p, lettres: lettresDe(p.en) }));

  const alea = aleatoire(GRAINE + 1);
  const servies = new Set();
  const usages = new Map();
  const acquis = [];
  const rejets = [];
  let total = 0;

  fs.mkdirSync(path.join(CONTENU, "motsmeles"), { recursive: true });

  for (const { entree, mots } of paliers) {
    const numero = Number(entree.id);
    const nom = deuxChiffres(numero);
    const nouveaux = mots.filter(jouable);
    const grilles = [];

    for (let rang = 0; rang < MELES_PAR_PALIER; rang += 1) {
      let reussie = null;

      for (let essai = 0; essai < MELES_ESSAIS && !reussie; essai += 1) {
        const libres = phrases.filter((p) => !servies.has(p.id));
        if (!libres.length) break;
        const phrase = libres[Math.floor(alea() * libres.length)];
        const taille = MELES_TAILLES.find((t) => t * t - phrase.lettres.length >= 3 * MELES_MOTS_MIN
                                             && t * t - phrase.lettres.length <= 8 * MELES_MOTS_MAX
                                             && alea() < 0.6) ?? MELES_TAILLES[2];
        const cible = taille * taille - phrase.lettres.length;
        if (cible < 3 * MELES_MOTS_MIN) continue;

        // Les nouveaux d'abord, les moins servis devant ; puis l'acquis mélangé.
        const tri = (liste) => liste
          .map((m) => ({ m, cle: (usages.get(m.id) ?? 0) + alea() }))
          .sort((a, b) => a.cle - b.cle).map(({ m }) => m);
        const premiers = tri(nouveaux).slice(0, MELES_NOUVEAUX);
        const suite = tri([...acquis, ...nouveaux].filter((m) => !premiers.includes(m)));
        const vus = new Set();
        const candidats = [...premiers, ...suite].filter((m) => {
          const cle = lettresDe(m.en);
          if (vus.has(cle)) return false;
          vus.add(cle);
          return true;
        });

        const pose = poserMotsMeles(taille, cible, candidats, alea);
        if (!pose) continue;

        let k = 0;
        const lignes = pose.lignes.map((ligne) =>
          ligne.map((v) => v ?? phrase.lettres[k++]).join(""));
        const grille = {
          id: `mm_${nom}${deuxChiffres(grilles.length + 1)}`,
          palier: numero,
          taille,
          lignes,
          mots: pose.places,
          phrase_id: phrase.id,
          phrase_en: phrase.en,
          phrase_fr: phrase.fr,
          contexte_fr: phrase.contexte_fr ?? null,
          verifie: true,
        };
        if (controlerGrille(grille, tous).length) continue;
        reussie = grille;
      }

      if (!reussie) {
        rejets.push({ palier: numero, rang: rang + 1 });
        continue;
      }
      servies.add(reussie.phrase_id);
      for (const p of reussie.mots) usages.set(p.id, (usages.get(p.id) ?? 0) + 1);
      grilles.push(reussie);
    }

    acquis.push(...nouveaux);
    // Réservoir épuisé : pas de fichier vide, le palier attend de nouvelles expressions.
    if (!grilles.length) continue;
    const fichier = `motsmeles/motsmeles-${nom}.json`;
    fs.writeFileSync(path.join(CONTENU, fichier),
      JSON.stringify({ palier: numero, version: 1, grilles }, null, 2) + "\n");
    total += grilles.length;

    if (!entree.mots_meles) {
      const rangManifeste = manifeste.paliers.indexOf(entree);
      manifeste.paliers[rangManifeste] = { ...entree, mots_meles: fichier };
    }
  }

  fs.writeFileSync(path.join(CONTENU, "manifest.json"), JSON.stringify(manifeste, null, 2) + "\n");
  console.log(`${total} grilles de mots mêlés écrites · ${rejets.length} manquante(s)`);
  for (const r of rejets.slice(0, 10)) console.log(`  palier ${deuxChiffres(r.palier)}, grille ${r.rang} : aucune combinaison trouvée`);
}

/** Relit toutes les grilles de mots mêlés et les contrôle. */
function verifierMotsMeles() {
  const mots = tousLesMots();
  let total = 0;
  const problemes = [];
  for (const n of idsDesPaliers()) {
    const chemin = path.join(CONTENU, "motsmeles", `motsmeles-${deuxChiffres(n)}.json`);
    if (!fs.existsSync(chemin)) continue;
    for (const grille of lire(chemin).grilles ?? []) {
      total += 1;
      problemes.push(...controlerGrille(grille, mots));
      if (grille.mots.some((p) => Number(mots.get(p.id)?.palier) > n)) {
        problemes.push(`${grille.id} : mot d'un palier supérieur`);
      }
    }
  }
  return { total, problemes };
}

/**
 * Ajoute le bloc `croises` aux parties existantes d'un palier.
 *
 * Utile quand les parties ont été écrites avant la v3 : elles ont déjà leur
 * phrase, leur alphabet et leurs mots, il ne leur manque que la grille 2D.
 * On ne régénère rien d'autre — et surtout pas dans le navigateur (§17.9).
 *
 * Une partie dont les mots ne se placent pas reste SANS `croises` : la phase 4
 * sera simplement sautée pour elle.
 */
function croiserPalier(numero) {
  const nom = deuxChiffres(numero);
  const cheminParties = path.join(CONTENU, "parties", `parties-${nom}.json`);
  if (!fs.existsSync(cheminParties)) return null;

  // Les parties référencent des mots d'autres paliers : on charge tout.
  const mots = tousLesMots();

  const donnees = lire(cheminParties);
  let ajoutes = 0, echecs = 0;

  for (const partie of donnees.parties ?? []) {
    if (partie.croises) continue;

    const groupe = partie.mots.map((id) => mots.get(id)).filter(Boolean);
    if (groupe.length !== partie.mots.length) {
      echecs += 1;
      console.log(`    ${partie.id} : mots inconnus, laissée sans grille`);
      continue;
    }

    const croises = construireCroises(groupe);
    if (!croises) {
      echecs += 1;
      console.log(`    ${partie.id} : aucun placement possible, laissée sans grille`);
      continue;
    }
    partie.croises = croises;
    ajoutes += 1;
  }

  if (ajoutes) {
    fs.writeFileSync(cheminParties, JSON.stringify(donnees, null, 2) + "\n");
  }
  return { palier: numero, ajoutes, echecs, total: (donnees.parties ?? []).length };
}

function verifierPalier(numero, mots, jeuDe) {
  const nom = deuxChiffres(numero);
  const cheminParties = path.join(CONTENU, "parties", `parties-${nom}.json`);
  if (!fs.existsSync(cheminParties)) return null;

  const parties = lire(cheminParties).parties ?? [];

  const rapport = { palier: numero, total: parties.length, resolubles: 0, problemes: [] };

  for (const partie of parties) {
    const inconnus = partie.mots.filter((id) => !mots.has(id));
    if (inconnus.length) {
      rapport.problemes.push(`${partie.id} : mots inconnus ${inconnus.join(", ")}`);
      continue;
    }

    // L'app ne charge que les paliers débloqués : un mot d'un palier plus
    // haut rendrait la partie invalide au chargement.
    const enAvance = partie.mots.filter((id) => Number(mots.get(id).palier) > numero);
    if (enAvance.length) {
      rapport.problemes.push(`${partie.id} : mots d'un palier supérieur ${enAvance.join(", ")}`);
      continue;
    }

    // §06 — jamais les mêmes mots dans la grille et dans les mots croisés.
    const partages = partie.mots.filter((id) => jeuDe.has(id) && jeuDe.get(id) !== partie.jeu);
    if (partages.length) {
      rapport.problemes.push(`${partie.id} : mots aussi servis par l'autre jeu ${partages.join(", ")}`);
      continue;
    }
    for (const id of partie.mots) jeuDe.set(id, partie.jeu);

    const enMajuscules = partie.mots.map((id) => lettresDe(mots.get(id).en));

    if (!JEUX.includes(partie.jeu)) {
      rapport.problemes.push(`${partie.id} : champ « jeu » absent ou invalide`);
      continue;
    }

    // §9 (v4) : la phrase cachée doit devenir entièrement lisible une fois la
    // grille remplie. C'est la seule contrainte de résolubilité qui reste.
    const lettresMots = new Set(enMajuscules.flatMap((mot) => [...distinctes(mot)]));
    const illisibles = [...distinctes(partie.phrase_en ?? "")].filter((l) => !lettresMots.has(l));
    if (illisibles.length) {
      rapport.problemes.push(`${partie.id} : phrase illisible, ${illisibles.join(",")} n'apparaît dans aucun mot`);
      continue;
    }

    const alphabet = partie.alphabet ?? {};
    const lettresAlphabet = new Set(Object.values(alphabet));
    const absentes = [...lettresMots].filter((l) => !lettresAlphabet.has(l));
    if (absentes.length) {
      rapport.problemes.push(`${partie.id} : alphabet incomplet, ${absentes.join(",")} sans numéro`);
      continue;
    }

    // Le placement 2D n'est exigé que du jeu qui s'en sert (§05, §6.4) : un
    // bloc dont les mots ne se croisent pas reste jouable en codeword.
    if (partie.jeu === "croises" && !partie.croises) {
      rapport.problemes.push(`${partie.id} : partie de mots croisés sans placement 2D`);
      continue;
    }

    rapport.resolubles += 1;
  }

  return rapport;
}

/* -------------------------------------------------------------------------- */
/* Point d'entrée                                                              */
/* -------------------------------------------------------------------------- */

function principal(argv) {
  const verifier = argv.includes("--verify");
  const croiser = argv.includes("--croises");
  const rangPalier = argv.indexOf("--palier");
  const palier = rangPalier !== -1 ? Number(argv[rangPalier + 1]) : null;

  if (croiser) {
    const rangP = argv.indexOf("--palier");
    const numeros = rangP !== -1 ? [Number(argv[rangP + 1])] : idsDesPaliers();
    let ajoutes = 0, echecs = 0;

    for (const n of numeros) {
      const rapport = croiserPalier(n);
      if (!rapport) continue;
      ajoutes += rapport.ajoutes;
      echecs += rapport.echecs;
      console.log(`palier ${deuxChiffres(n)} : ${rapport.ajoutes} grilles ajoutées, ${rapport.echecs} sans placement`);
    }

    console.log(`\n${ajoutes} grilles de mots croisés ajoutées · ${echecs} parties laissées sans grille`);
    return;
  }

  if (verifier) {
    const numeros = palier ? [palier] : idsDesPaliers();
    let total = 0, resolubles = 0, fichiers = 0;
    const mots = tousLesMots();
    const jeuDe = new Map();

    for (const n of numeros) {
      const rapport = verifierPalier(n, mots, jeuDe);
      if (!rapport) continue;
      fichiers += 1;
      total += rapport.total;
      resolubles += rapport.resolubles;

      const etat = rapport.problemes.length ? `${rapport.problemes.length} problème(s)` : "toutes résolubles";
      console.log(`palier ${deuxChiffres(n)} : ${rapport.resolubles}/${rapport.total} — ${etat}`);
      for (const p of rapport.problemes.slice(0, 3)) console.log(`    ${p}`);
      if (rapport.problemes.length > 3) console.log(`    … et ${rapport.problemes.length - 3} autres`);
    }

    console.log(`\n${fichiers} fichiers · ${resolubles}/${total} parties résolubles`);
    process.exit(resolubles === total ? 0 : 1);
  }

  if (argv.includes("--mots-meles")) {
    genererMotsMeles();
    const { total, problemes } = verifierMotsMeles();
    console.log(`contrôle : ${total} grilles, ${problemes.length} problème(s)`);
    for (const p of problemes.slice(0, 5)) console.log(`  ${p}`);
    process.exit(problemes.length ? 1 : 0);
  }

  if (!argv.includes("--generer")) {
    console.error("Usage : node tools/generateur.js --generer");
    console.error("        node tools/generateur.js --mots-meles");
    console.error("        node tools/generateur.js --verify  [--palier 3]");
    console.error("        node tools/generateur.js --croises [--palier 3]");
    process.exit(1);
  }

  genererTout();
}

// Exécuté directement, pas importé.
if (process.argv[1] && process.argv[1].endsWith("generateur.js")) {
  principal(process.argv.slice(2));
}
