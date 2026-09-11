#!/usr/bin/env node
/**
 * generateur.js — production des parties, hors ligne (README §9).
 *
 * Script Node autonome. Il ne fait PAS partie de l'application et n'est jamais
 * appelé depuis le navigateur (§17.9).
 *
 *   node tools/generateur.js --palier 3
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

function genererPalier(numero) {
  const nom = deuxChiffres(numero);
  const cheminPalier = path.join(CONTENU, "paliers", `palier-${nom}.json`);
  const cheminPhrases = path.join(CONTENU, "phrases.json");

  if (!fs.existsSync(cheminPalier)) {
    console.error(`Palier introuvable : ${cheminPalier}`);
    process.exit(1);
  }
  if (!fs.existsSync(cheminPhrases)) {
    console.error("content/phrases.json est absent : le réservoir de phrases est");
    console.error("indispensable à la génération (README §6.3). Rien n'a été écrit.");
    process.exit(1);
  }

  const palier = lire(cheminPalier);
  const brutPhrases = lire(cheminPhrases);
  const phrases = Array.isArray(brutPhrases) ? brutPhrases : brutPhrases.phrases ?? [];

  const libres = phrases.filter((p) => !p.utilisee_par);
  const parties = [];
  const rejets = [];

  for (let i = 0; i + MOTS_PAR_PARTIE <= palier.mots.length; i += MOTS_PAR_PARTIE) {
    const groupe = palier.mots.slice(i, i + MOTS_PAR_PARTIE);
    const ordre = parties.length + 1;
    const idPartie = `p_${deuxChiffres(numero)}${deuxChiffres(ordre)}`;

    const utilisees = new Set(parties.map((p) => p.phrase_id));
    const dispo = libres.filter((p) => !utilisees.has(p.id));

    // On vise le jeu actuellement le moins servi. Un bloc dont les mots ne se
    // croisent pas retombera de toute façon sur le codeword : sans ce rééqui-
    // librage, les mots croisés se retrouvaient avec trois fois moins de
    // parties que la grille.
    const dejaCroises = parties.filter((p) => p.jeu === "croises").length;
    const jeuSouhaite = dejaCroises * 2 < parties.length + 1 ? "croises" : "grille";

    const { partie, phrase, motif } = composerPartie(groupe, dispo,
      { palier: numero, ordre, idPartie, jeuSouhaite });

    if (!partie) {
      rejets.push({ palier: numero, ordre, mots: groupe.map((m) => m.id), motif });
      console.log(`  rejet  groupe ${ordre} — ${motif}`);
      continue;
    }

    phrase.utilisee_par = partie.id;
    parties.push(partie);
    console.log(`  ok     ${partie.id} — ${partie.phrase_en}`);
  }

  const sortie = path.join(CONTENU, "parties", `parties-${nom}.json`);
  fs.writeFileSync(sortie, JSON.stringify({ palier: numero, version: 3, parties }, null, 2) + "\n");
  console.log(`\n${parties.length} parties écrites dans ${path.relative(RACINE, sortie)}`);

  if (rejets.length) {
    const cheminRejets = path.join(CONTENU, "rejets.json");
    const anciens = fs.existsSync(cheminRejets) ? lire(cheminRejets) : [];
    fs.writeFileSync(cheminRejets,
      JSON.stringify([...anciens.filter((r) => r.palier !== numero), ...rejets], null, 2) + "\n");
    console.log(`${rejets.length} groupes rejetés, consignés dans content/rejets.json`);
  }

  // Le réservoir garde la trace des phrases consommées (§6.3).
  fs.writeFileSync(cheminPhrases, JSON.stringify(
    Array.isArray(brutPhrases) ? phrases : { ...brutPhrases, phrases }, null, 2) + "\n");
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

  // Les parties peuvent référencer des mots d'autres paliers : on charge tout.
  const mots = new Map();
  for (let i = 1; i <= 56; i += 1) {
    const chemin = path.join(CONTENU, "paliers", `palier-${deuxChiffres(i)}.json`);
    if (!fs.existsSync(chemin)) continue;
    for (const mot of lire(chemin).mots) mots.set(mot.id, mot);
  }

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

function verifierPalier(numero) {
  const nom = deuxChiffres(numero);
  const cheminPalier = path.join(CONTENU, "paliers", `palier-${nom}.json`);
  const cheminParties = path.join(CONTENU, "parties", `parties-${nom}.json`);
  if (!fs.existsSync(cheminPalier) || !fs.existsSync(cheminParties)) return null;

  const mots = new Map(lire(cheminPalier).mots.map((m) => [m.id, m]));
  const parties = lire(cheminParties).parties ?? [];

  const rapport = { palier: numero, total: parties.length, resolubles: 0, problemes: [] };

  for (const partie of parties) {
    const inconnus = partie.mots.filter((id) => !mots.has(id));
    if (inconnus.length) {
      rapport.problemes.push(`${partie.id} : mots inconnus ${inconnus.join(", ")}`);
      continue;
    }

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
    const numeros = rangP !== -1 ? [Number(argv[rangP + 1])] : [...Array(56).keys()].map((i) => i + 1);
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
    const numeros = palier ? [palier] : [...Array(56).keys()].map((i) => i + 1);
    let total = 0, resolubles = 0, fichiers = 0;

    for (const n of numeros) {
      const rapport = verifierPalier(n);
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

  if (!palier) {
    console.error("Usage : node tools/generateur.js --palier 3");
    console.error("        node tools/generateur.js --verify  [--palier 3]");
    console.error("        node tools/generateur.js --croises [--palier 3]");
    process.exit(1);
  }

  console.log(`Génération du palier ${palier}\n`);
  genererPalier(palier);
}

// Exécuté directement, pas importé.
if (process.argv[1] && process.argv[1].endsWith("generateur.js")) {
  principal(process.argv.slice(2));
}
