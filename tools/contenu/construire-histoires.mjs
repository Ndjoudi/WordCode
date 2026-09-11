/**
 * Construit content/histoires/index.json (schéma §6.5) à partir des textes
 * rédigés dans ./histoires/.
 *
 * Format d'un fichier source :
 *   # arc: <id> | ordre: <n> | titre_en: <…> | titre_fr: <…>
 *   --- EN
 *   <texte anglais>
 *   --- FR
 *   <traduction française>
 *
 * Le script calcule `lexique` (ids du catalogue employés), `hors_lexique`
 * (mots de contenu absents du catalogue) et `nb_mots`. Les mots-outils sont
 * ignorés des deux listes : ils ne se traduisent pas isolément (§3.1).
 *
 * Usage : node tools/contenu/construire-histoires.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..");

/** Mots-outils : hors lexique et hors « hors_lexique » (§3.1). */
const OUTILS = new Set(`a an the this that these those there here
i you he she it we they me him her us them my your his its our their mine yours
am is are was were be been being do does did done have has had having
will would shall should can could may might must
and or but so if then than as because while when where why how what which who whom
of to in on at by for with from into onto out up down over under about after before
not no nor none nothing very too also just only even still yet again once more most
some any all both each every other another such same own
i'm it's don't doesn't didn't can't won't isn't aren't wasn't weren't
he's she's they're we're you're i've there's that's what's let's
mr mrs miss o'clock`.split(/\s+/).filter(Boolean));

function lireSource(chemin) {
  const brut = readFileSync(chemin, "utf8");
  const enTete = brut.match(/^#\s*(.+)$/m)?.[1] ?? "";
  const meta = {};
  for (const part of enTete.split("|")) {
    const [cle, ...reste] = part.split(":");
    if (reste.length) meta[cle.trim()] = reste.join(":").trim();
  }
  const en = brut.split(/^--- EN\s*$/m)[1]?.split(/^--- FR\s*$/m)[0]?.trim() ?? "";
  const fr = brut.split(/^--- FR\s*$/m)[1]?.trim() ?? "";
  return { meta, en, fr };
}

/**
 * Formes irrégulières courantes qu'aucune règle ne rattrape.
 * Sans elles, « went » serait compté comme un mot inconnu alors que le lecteur
 * connaît « go » — et la couverture mesurée serait fausse.
 */
const IRREGULIERS = new Map(Object.entries({
  went: "go", gone: "go", said: "say", got: "get", made: "make", saw: "see",
  seen: "see", came: "come", took: "take", taken: "take", knew: "know",
  known: "know", gave: "give", given: "give", found: "find", told: "tell",
  left: "leave", felt: "feel", kept: "keep", stood: "stand", understood: "understand",
  ran: "run", read: "read", sat: "sit", won: "win", lost: "lose", sold: "sell",
  paid: "pay", met: "meet", sent: "send", spent: "spend", built: "build",
  heard: "hear", held: "hold", brought: "bring", bought: "buy", caught: "catch",
  taught: "teach", thought: "think", fought: "fight", broke: "break",
  broken: "break", spoke: "speak", spoken: "speak", wrote: "write",
  written: "write", drank: "drink", ate: "eat", eaten: "eat", fell: "fall",
  grew: "grow", began: "begin", chose: "choose", drove: "drive", forgot: "forget",
  wore: "wear", woke: "wake", threw: "throw", slept: "sleep", swam: "swim",
  children: "child", men: "man", women: "woman", feet: "foot", teeth: "tooth",
  lives: "life", wives: "wife", knives: "knife", better: "good", best: "good",
  worse: "bad", worst: "bad", more: "much", most: "much",
}));

/**
 * Bases plausibles d'une forme fléchie, de la plus probable à la moins.
 * @param {string} mot
 * @returns {string[]}
 */
function basesDe(mot) {
  const b = [];
  if (IRREGULIERS.has(mot)) b.push(IRREGULIERS.get(mot));
  if (mot.endsWith("ies")) b.push(mot.slice(0, -3) + "y");
  if (mot.endsWith("es")) b.push(mot.slice(0, -2));
  if (mot.endsWith("s") && !mot.endsWith("ss")) b.push(mot.slice(0, -1));
  if (mot.endsWith("ied")) b.push(mot.slice(0, -3) + "y");
  if (mot.endsWith("ed")) {
    b.push(mot.slice(0, -1), mot.slice(0, -2));
    if (/(.)\1ed$/.test(mot)) b.push(mot.slice(0, -3));
  }
  if (mot.endsWith("ing")) {
    b.push(mot.slice(0, -3), mot.slice(0, -3) + "e");
    if (/(.)\1ing$/.test(mot)) b.push(mot.slice(0, -4));
  }
  if (mot.endsWith("ly")) b.push(mot.slice(0, -2));
  if (mot.endsWith("er")) b.push(mot.slice(0, -2), mot.slice(0, -1));
  if (mot.endsWith("est")) b.push(mot.slice(0, -3), mot.slice(0, -2));
  return b;
}

/**
 * Identifiant du mot au catalogue, forme fléchie comprise.
 * @param {string} nu
 * @param {Map<string,string>} parEn
 * @returns {?string}
 */
function resoudre(nu, parEn) {
  if (parEn.has(nu)) return parEn.get(nu);
  for (const base of basesDe(nu)) if (parEn.has(base)) return parEn.get(base);
  return null;
}

function analyser(texte, parEn) {
  const lexique = new Set();
  const hors = new Set();
  let nb = 0;

  for (const jeton of texte.split(/\s+/)) {
    const nu = jeton.toLowerCase().replace(/[^a-z']/g, "");
    if (!nu) continue;
    nb += 1;
    if (OUTILS.has(nu)) continue;
    // Une forme fléchie compte pour son lemme : le lecteur qui connaît « go »
    // lit « went » sans effort, et la couverture doit le refléter.
    const id = resoudre(nu, parEn);
    if (id) lexique.add(id);
    else hors.add(nu);
  }
  return { lexique: [...lexique], hors_lexique: [...hors].sort(), nb_mots: nb };
}

function principal() {
  const parEn = new Map();
  for (let n = 1; n <= 20; n += 1) {
    const f = join(RACINE, "content", "paliers", `palier-${String(n).padStart(2, "0")}.json`);
    for (const mot of JSON.parse(readFileSync(f, "utf8")).mots) {
      if (!parEn.has(mot.en)) parEn.set(mot.en, mot.id);
    }
  }

  const fichiers = readdirSync(join(ICI, "histoires")).filter((f) => f.endsWith(".txt")).sort();
  const histoires = [];
  const alertes = [];

  for (const fichier of fichiers) {
    const { meta, en, fr } = lireSource(join(ICI, "histoires", fichier));
    const id = `h_${String(histoires.length + 1).padStart(3, "0")}`;
    const stats = analyser(en, parEn);

    if (stats.nb_mots < 250 || stats.nb_mots > 350) {
      alertes.push(`${fichier} : ${stats.nb_mots} mots, attendu 250-350 (§6.5)`);
    }

    const arc = meta.arc ?? null;
    const precedente = [...histoires].reverse().find((h) => h.arc === arc);

    histoires.push({
      id,
      arc,
      ordre: Number(meta.ordre ?? histoires.length + 1),
      titre_en: meta.titre_en ?? null,
      titre_fr: meta.titre_fr ?? null,
      texte_en: en,
      texte_fr: fr,
      nb_mots: stats.nb_mots,
      lexique: stats.lexique,
      hors_lexique: stats.hors_lexique,
      suite_de: precedente?.id ?? null,
      source: "contenu",
    });
  }

  mkdirSync(join(RACINE, "content", "histoires"), { recursive: true });
  writeFileSync(join(RACINE, "content", "histoires", "index.json"),
                JSON.stringify({ version: 4, histoires }, null, 2) + "\n");

  console.log(`=== histoires : ${histoires.length} ===`);
  for (const h of histoires) {
    console.log(`  ${h.id}  ${String(h.nb_mots).padStart(3)} mots · `
      + `lexique ${String(h.lexique.length).padStart(3)} · hors lexique ${h.hors_lexique.length}`
      + `${h.suite_de ? ` · suite de ${h.suite_de}` : ""}`);
  }
  if (alertes.length) {
    console.log("  alertes :");
    for (const a of alertes) console.log(`    - ${a}`);
  }
}

principal();
