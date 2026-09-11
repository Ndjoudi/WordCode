/**
 * Construit content/blocs/bloc-XX.json à partir des sources de ./blocs/.
 *
 * Un bloc est un groupe de mots appris D'UN SEUL TENANT, parce que le traduire
 * mot à mot ne marche pas. Il réutilise le schéma `word` (§6.1) : seuls
 * `source`, `type`, `litteral` et `tokens` le distinguent.
 *
 * Une ligne source :
 *   en | fr | litteral | indice | exemple_en | exemple_fr
 *
 * `litteral` vaut « null » quand le mot à mot ne piège pas. L'indice porte le
 * même balisage que les paliers de mots : [mot=traduction] pour les segments
 * tappables du quizz.
 *
 * Usage : node tools/contenu/construire-blocs.mjs [--verify]
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decouper, texteIndice } from "./construire.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..");
const num = (n) => String(n).padStart(2, "0");

/** Nombre de blocs par palier, comme pour les mots. */
export const BLOCS_PAR_PALIER = 50;

/**
 * Découpe un bloc en jetons, pour l'exercice de remise en ordre (§04).
 *
 * L'apostrophe ne coupe pas : « don't » est un seul jeton. La ponctuation
 * finale est retirée : laisser « it? » sur le dernier mot désigne la fin de la
 * phrase et donne la réponse sans réfléchir.
 *
 * @param {string} en
 * @returns {string[]}
 */
export function jetons(en) {
  return String(en).trim().split(/\s+/)
    .map((jeton) => jeton.replace(/[?!.,;:]+$/, ""))
    .filter(Boolean);
}

function lireSource(fichier) {
  const blocs = [];
  readFileSync(fichier, "utf8").split("\n").forEach((ligne, n) => {
    const t = ligne.trim();
    if (!t || t.startsWith("#")) return;
    const champs = t.split("|").map((c) => c.trim());
    if (champs.length !== 6) {
      throw new Error(`${fichier}:${n + 1} — ${champs.length} champs au lieu de 6`);
    }
    const [en, fr, litteral, indice, exempleEn, exempleFr] = champs;
    blocs.push({ en, fr, litteral, indice, exempleEn, exempleFr, ligne: n + 1 });
  });
  return blocs;
}

/**
 * Construit un palier de blocs.
 * @param {object[]} brut
 * @param {number} palierId
 * @param {string} titre
 * @returns {object}
 */
export function construirePalierBlocs(brut, palierId, titre) {
  return {
    palier: palierId,
    titre,
    version: 4,
    type: "bloc",
    mots: brut.map((b, i) => ({
      id: `x_${num(palierId)}${String(i + 1).padStart(3, "0")}`,
      en: b.en,
      fr: b.fr,
      type: "expr",
      source: "bloc",
      phonetique: null,
      famille: b.en,
      sens_index: 1,
      rang_freq: (palierId - 1) * BLOCS_PAR_PALIER + i + 1,
      palier: palierId,
      themes: [],
      exemple_en: b.exempleEn,
      exemple_fr: b.exempleFr,
      indice: { en: texteIndice(b.indice), segments: decouper(b.indice) },
      phrase_en: null,
      phrase_fr: null,
      date_capture: null,
      origine_partie: null,
      preterit: null,
      participe: null,
      groupe_verbe: null,
      verbe_base: null,
      particule: null,
      // Le mot à mot trompeur, montré en découverte. null quand il n'y a
      // pas de piège : inventer un faux piège brouillerait le signal.
      litteral: b.litteral === "null" ? null : b.litteral,
      // Jetons de l'exercice de remise en ordre (§04).
      tokens: jetons(b.en),
      // Un bloc a des espaces : il n'entre dans aucune grille (§05, §06).
      eligible_grille: false,
      eligible_croises: false,
    })),
  };
}

/**
 * Relie les segments d'indice au catalogue des mots (§6.1).
 *
 * Sans ces `ref`, le popover du quizz ne peut pas savoir si l'utilisateur
 * connaît déjà le mot tapé, et lui propose de rajouter à sa file quelque chose
 * qu'il a appris la semaine dernière.
 *
 * @param {object[]} paliers
 * @returns {number} refs résolues
 */
export function resoudreRefsBlocs(paliers) {
  const parEn = new Map();
  for (let n = 1; n <= 20; n += 1) {
    const f = join(RACINE, "content", "paliers", `palier-${num(n)}.json`);
    if (!existsSync(f)) continue;
    for (const mot of JSON.parse(readFileSync(f, "utf8")).mots) {
      if (!parEn.has(mot.en)) parEn.set(mot.en, mot.id);
    }
  }

  let resolus = 0;
  for (const p of paliers) {
    for (const b of p.mots) {
      for (const s of b.indice.segments) {
        if (!s.trad) continue;
        const id = parEn.get(String(s.txt).toLowerCase().replace(/[^a-z' ]/g, ""));
        if (id) { s.ref = id; resolus += 1; }
      }
    }
  }
  return resolus;
}

/** Contrôles propres aux blocs. */
export function verifierBlocs(palier, erreurs) {
  const vus = new Set();
  for (const b of palier.mots) {
    const ou = `bloc ${b.en}`;
    if (vus.has(b.en)) erreurs.push(`${ou} : doublon`);
    vus.add(b.en);
    if (!b.en.includes(" ")) erreurs.push(`${ou} : un seul mot — ce n'est pas un bloc`);
    if (!b.fr) erreurs.push(`${ou} : traduction manquante`);
    if (!b.exemple_en || !b.exemple_fr) erreurs.push(`${ou} : exemple incomplet`);
    if (b.indice.en.split(/\s+/).length < 5) erreurs.push(`${ou} : indice trop court`);
    if (!b.indice.segments.some((s) => s.trad)) erreurs.push(`${ou} : aucun segment tappable`);
    // L'indice ne doit pas contenir le bloc lui-même, ni son mot le plus rare.
    if (b.indice.en.toLowerCase().includes(b.en.toLowerCase())) {
      erreurs.push(`${ou} : l'indice contient le bloc à deviner`);
    }
    if (b.eligible_grille || b.eligible_croises) erreurs.push(`${ou} : marqué éligible à une grille`);
  }
  return erreurs;
}

function principal() {
  const dossier = join(ICI, "blocs");
  if (!existsSync(dossier)) { console.log("aucune source de blocs"); return; }

  const fichiers = readdirSync(dossier).filter((f) => f.endsWith(".txt")).sort();
  const paliers = [];
  const erreurs = [];

  fichiers.forEach((f, i) => {
    const brut = lireSource(join(dossier, f));
    if (brut.length !== BLOCS_PAR_PALIER) {
      erreurs.push(`${f} : ${brut.length} blocs au lieu de ${BLOCS_PAR_PALIER}`);
    }
    paliers.push(construirePalierBlocs(brut, i + 1, `Blocs — palier ${i + 1}`));
  });
  const refs = resoudreRefsBlocs(paliers);
  for (const p of paliers) verifierBlocs(p, erreurs);

  console.log(`=== blocs : ${paliers.length} palier(s), ${paliers.reduce((s, p) => s + p.mots.length, 0)} blocs ===`);
  const pieges = paliers.flatMap((p) => p.mots).filter((b) => b.litteral).length;
  console.log(`  pièges de traduction mot à mot signalés : ${pieges}`);
  console.log(`  segments d'indice reliés au catalogue    : ${refs}`);
  if (erreurs.length) {
    console.log(`  ${erreurs.length} erreur(s) :`);
    for (const e of erreurs.slice(0, 20)) console.log(`    - ${e}`);
    process.exitCode = 1;
    return;
  }
  console.log("  aucune erreur");

  if (process.argv.includes("--verify")) return;
  mkdirSync(join(RACINE, "content", "blocs"), { recursive: true });
  for (const p of paliers) {
    const f = join(RACINE, "content", "blocs", `bloc-${num(p.palier)}.json`);
    writeFileSync(f, JSON.stringify(p, null, 2) + "\n");
    console.log(`  écrit content/blocs/bloc-${num(p.palier)}.json — ${p.mots.length} blocs`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) principal();
