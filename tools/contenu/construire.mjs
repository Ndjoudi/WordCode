/**
 * Construit content/paliers/palier-XX.json (schéma v3, §6.1) à partir des
 * fichiers source rédigés à la main dans ./source/.
 *
 * Une ligne source = un mot :
 *   en | fr | type | phonetique | exemple_en | exemple_fr | indice
 *
 * L'indice porte un balisage minimal : ce qui est entre crochets devient un
 * segment tappable, le reste est découpé en mots-outils (trad: null).
 *   « You drink it when you are [thirsty=assoiffé] »
 *   → segments: You/null, drink/null, it/null, when/null, you/null, are/null,
 *               thirsty/assoiffé
 * Un segment peut couvrir plusieurs mots : « [don't give up=n'abandonne pas] ».
 *
 * Usage : node construire.mjs [--palier N] [--verify]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = "/Users/djoudinehlil/Desktop/sites/WordCode";
const TYPES = new Set(["n", "v", "adj", "adv", "prep", "conj", "pron", "det"]);

const num = (n) => String(n).padStart(2, "0");

/** §6.1 : longueur 3-8, [A-Z] uniquement, sans espace ni tiret. */
export function eligibleGrille(en) {
  return /^[a-z]{3,8}$/.test(en);
}

/** Découpe un indice balisé en segments §6.1. */
export function decouper(indice) {
  const segments = [];
  const pousserTexte = (texte) => {
    for (const mot of texte.split(/\s+/)) {
      if (mot) segments.push({ txt: mot, trad: null });
    }
  };
  let reste = indice;
  let i;
  while ((i = reste.indexOf("[")) !== -1) {
    const j = reste.indexOf("]", i);
    if (j === -1) throw new Error(`crochet non fermé : ${indice}`);
    pousserTexte(reste.slice(0, i));
    const brut = reste.slice(i + 1, j);
    const sep = brut.indexOf("=");
    if (sep === -1) throw new Error(`segment sans traduction : [${brut}]`);
    segments.push({
      txt: brut.slice(0, sep).trim(),
      trad: brut.slice(sep + 1).trim(),
      ref: null,
    });
    reste = reste.slice(j + 1);
  }
  pousserTexte(reste);
  return segments;
}

/** Texte lisible de l'indice, balises retirées. */
export function texteIndice(indice) {
  return indice.replace(/\[([^\]=]+)=[^\]]*\]/g, "$1").replace(/\s+/g, " ").trim();
}

function lireSource(fichier) {
  const lignes = readFileSync(fichier, "utf8").split("\n");
  const mots = [];
  lignes.forEach((ligne, n) => {
    const t = ligne.trim();
    if (!t || t.startsWith("#")) return;
    const champs = t.split("|").map((c) => c.trim());
    if (champs.length !== 7) {
      throw new Error(`${fichier}:${n + 1} — ${champs.length} champs au lieu de 7`);
    }
    const [en, fr, type, phonetique, exempleEn, exempleFr, indice] = champs;
    if (!TYPES.has(type)) throw new Error(`${fichier}:${n + 1} — type inconnu « ${type} »`);
    mots.push({ en, fr, type, phonetique, exempleEn, exempleFr, indice, ligne: n + 1 });
  });
  return mots;
}

/** Construit un palier complet. `rangs` donne le rang de fréquence de chaque mot. */
export function construirePalier(brut, palierId, titre, rangs, type = "frequence") {
  return {
    palier: palierId,
    titre,
    version: 3,
    type,
    mots: brut.map((m, i) => {
      const rang = rangs.get(m.en) ?? null;
      const segments = decouper(m.indice);
      const aIndice = segments.some((s) => s.trad);
      return {
        id: `w_${num(palierId)}${String(i + 1).padStart(3, "0")}`,
        en: m.en,
        fr: m.fr,
        type: m.type,
        source: "palier",
        phonetique: m.phonetique === "null" ? null : m.phonetique,
        famille: m.en,
        sens_index: 1,
        rang_freq: rang,
        palier: palierId,
        themes: [],
        exemple_en: m.exempleEn,
        exemple_fr: m.exempleFr,
        indice: { en: texteIndice(m.indice), segments },
        phrase_en: null,
        phrase_fr: null,
        date_capture: null,
        origine_partie: null,
        preterit: null,
        participe: null,
        groupe_verbe: null,
        verbe_base: null,
        particule: null,
        litteral: null,
        eligible_grille: eligibleGrille(m.en),
        eligible_croises: eligibleGrille(m.en) && aIndice,
      };
    }),
  };
}

/**
 * Réordonne les mots d'un palier pour le générateur (§9).
 *
 * Le générateur découpe le palier en blocs de 5 mots CONSÉCUTIFS. L'ordre du
 * fichier décide donc directement de ce qu'il peut produire :
 *  - un mot hors gabarit 3-8 dans un bloc fait échouer le bloc entier ;
 *  - la phrase cachée doit être ENTIÈREMENT LISIBLE une fois la grille remplie
 *    (README §9, v4), donc chacune de ses lettres doit apparaître dans un des
 *    5 mots. Un bloc pauvre en lettres distinctes ne couvre aucune phrase.
 * On groupe donc les mots pour MAXIMISER les lettres distinctes du bloc, en
 * glouton, et on rejette les mots hors gabarit à la fin du fichier.
 *
 * @param {object[]} mots
 * @returns {object[]} les mêmes mots, réordonnés
 */
export function ordonnerPourGrille(mots) {
  const eligibles = mots.filter((m) => m.eligible_grille);
  const reste = mots.filter((m) => !m.eligible_grille);
  const lettres = new Map(eligibles.map((m) => [m.id, new Set(m.en.toUpperCase())]));
  const dispo = [...eligibles];
  const groupes = [];

  while (dispo.length >= 5) {
    // Amorce : le mot qui reste avec le PLUS de lettres distinctes.
    dispo.sort((a, b) => lettres.get(b.id).size - lettres.get(a.id).size);
    const groupe = [dispo.shift()];
    const union = new Set(lettres.get(groupe[0].id));
    while (groupe.length < 5) {
      // On prend le mot qui apporte le plus de lettres nouvelles.
      let meilleur = 0;
      let gain = -1;
      dispo.forEach((m, i) => {
        let n = 0;
        for (const l of lettres.get(m.id)) if (!union.has(l)) n += 1;
        if (n > gain) { gain = n; meilleur = i; }
      });
      const [pris] = dispo.splice(meilleur, 1);
      for (const l of lettres.get(pris.id)) union.add(l);
      groupe.push(pris);
    }
    groupes.push(groupe);
  }
  return [...groupes.flat(), ...dispo, ...reste];
}

/** Résout segments[].ref une fois tous les paliers construits (§6.1). */
export function resoudreRefs(paliers) {
  // Les paliers se chargent paresseusement : seuls ceux qui sont débloqués sont
  // en mémoire. Une ref vers un palier ultérieur serait donc toujours morte au
  // moment où le joueur lit l'indice. On ne lie que vers l'arrière.
  const parEn = new Map();
  for (const p of paliers) {
    for (const m of p.mots) {
      if (!parEn.has(m.en)) parEn.set(m.en, { id: m.id, palier: p.palier });
    }
  }
  let resolus = 0;
  for (const p of paliers) {
    for (const m of p.mots) {
      for (const s of m.indice.segments) {
        if (!s.trad) continue;
        const cle = s.txt.toLowerCase().replace(/[^a-z' ]/g, "");
        const cible = parEn.get(cle);
        if (!cible || cible.id === m.id || cible.palier > p.palier) continue;
        s.ref = cible.id;
        resolus += 1;
      }
    }
  }
  return resolus;
}

/** Contrôles §6.1 et §16 sur un palier construit. */
export function verifier(palier, erreurs) {
  const vus = new Set();
  for (const m of palier.mots) {
    const ou = `palier ${palier.palier} / ${m.en}`;
    if (vus.has(m.en)) erreurs.push(`${ou} : doublon`);
    vus.add(m.en);
    if (!/^[a-z][a-z' -]*$/.test(m.en)) erreurs.push(`${ou} : forme invalide`);
    if (!m.fr) erreurs.push(`${ou} : traduction manquante`);
    if (!m.exemple_en.includes(" ")) erreurs.push(`${ou} : exemple_en trop court`);
    if (!m.exemple_fr) erreurs.push(`${ou} : exemple_fr manquant`);
    const mots = m.indice.en.split(/\s+/);
    if (mots.length < 4) erreurs.push(`${ou} : indice trop court (${mots.length} mots) — §16 exige une périphrase`);
    if (m.indice.en.toLowerCase().split(/\W+/).includes(m.en)) {
      erreurs.push(`${ou} : l'indice contient le mot à deviner`);
    }
    if (!m.indice.segments.some((s) => s.trad)) erreurs.push(`${ou} : aucun segment tappable`);
    if (m.eligible_croises && !m.eligible_grille) erreurs.push(`${ou} : croises sans grille`);
  }
  return erreurs;
}

function principal() {
  const args = process.argv.slice(2);
  const seul = args.includes("--palier") ? Number(args[args.indexOf("--palier") + 1]) : null;
  const liste = JSON.parse(readFileSync(join(ICI, "liste-1000.json"), "utf8"));
  const rangs = new Map(liste.map((m, i) => [m, i + 1]));
  const titres = JSON.parse(readFileSync(join(ICI, "titres.json"), "utf8"));

  const paliers = [];
  const erreurs = [];
  for (let n = 1; n <= 20; n += 1) {
    const f = join(ICI, "source", `palier-${num(n)}.txt`);
    if (!existsSync(f)) continue;
    if (seul && n !== seul) continue;
    const brut = lireSource(f);
    if (brut.length !== 50) erreurs.push(`palier ${n} : ${brut.length} mots au lieu de 50`);
    paliers.push(construirePalier(brut, n, titres[String(n)] ?? `Palier ${n}`, rangs));
  }
  for (const p of paliers) p.mots = ordonnerPourGrille(p.mots);
  const resolus = resoudreRefs(paliers);
  for (const p of paliers) verifier(p, erreurs);

  console.log(`=== contenu v3 : ${paliers.length} palier(s), ${paliers.reduce((s, p) => s + p.mots.length, 0)} mots ===`);
  console.log(`  refs d'indice résolues vers le catalogue : ${resolus}`);
  if (erreurs.length) {
    console.log(`  ${erreurs.length} erreur(s) :`);
    for (const e of erreurs.slice(0, 40)) console.log(`    - ${e}`);
    process.exitCode = 1;
    if (!args.includes("--force")) return;
  } else {
    console.log("  aucune erreur");
  }
  if (args.includes("--verify")) return;
  for (const p of paliers) {
    const f = join(RACINE, "content", "paliers", `palier-${num(p.palier)}.json`);
    writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
    console.log(`  écrit ${f.replace(RACINE + "/", "")} — ${p.mots.length} mots`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) principal();
