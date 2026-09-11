/**
 * Contrôle un brouillon d'histoire contre un plafond de palier.
 *
 * Sert à la rédaction : il dit quels mots dépassent le niveau visé, avant que
 * le texte n'entre dans le stock. Sans lui, on écrit à l'aveugle et on ne
 * découvre le problème qu'au calcul de couverture.
 *
 * Usage : node tools/contenu/verifier-histoire.mjs histoires/lea-02.txt 2
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..");

const [fichier, plafondBrut] = process.argv.slice(2);
if (!fichier) {
  console.error("usage : node verifier-histoire.mjs <fichier.txt> [palier max]");
  process.exit(1);
}
const plafond = Number(plafondBrut) || 2;

// Le constructeur n'exporte pas ses règles : on les redit ici, en clair.
const outils = new Set(`a an the this that these those there here
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

const irreguliers = new Map(Object.entries({
  went: "go", gone: "go", said: "say", got: "get", made: "make", saw: "see",
  seen: "see", came: "come", took: "take", taken: "take", knew: "know",
  known: "know", gave: "give", given: "give", found: "find", told: "tell",
  left: "leave", felt: "feel", kept: "keep", stood: "stand", ran: "run",
  sat: "sit", won: "win", lost: "lose", paid: "pay", met: "meet", sent: "send",
  heard: "hear", held: "hold", brought: "bring", bought: "buy", caught: "catch",
  thought: "think", broke: "break", spoke: "speak", wrote: "write",
  drank: "drink", ate: "eat", fell: "fall", began: "begin", forgot: "forget",
  children: "child", men: "man", women: "woman", feet: "foot",
  better: "good", best: "good", worse: "bad", more: "much", most: "much",
}));

function bases(mot) {
  const b = [];
  if (irreguliers.has(mot)) b.push(irreguliers.get(mot));
  if (mot.endsWith("ies")) b.push(mot.slice(0, -3) + "y");
  if (mot.endsWith("es")) b.push(mot.slice(0, -2));
  if (mot.endsWith("s") && !mot.endsWith("ss")) b.push(mot.slice(0, -1));
  if (mot.endsWith("ied")) b.push(mot.slice(0, -3) + "y");
  if (mot.endsWith("ed")) { b.push(mot.slice(0, -1), mot.slice(0, -2)); if (/(.)\1ed$/.test(mot)) b.push(mot.slice(0, -3)); }
  if (mot.endsWith("ing")) { b.push(mot.slice(0, -3), mot.slice(0, -3) + "e"); if (/(.)\1ing$/.test(mot)) b.push(mot.slice(0, -4)); }
  if (mot.endsWith("ly")) b.push(mot.slice(0, -2));
  if (mot.endsWith("er")) b.push(mot.slice(0, -2), mot.slice(0, -1));
  return b;
}

const palierDe = new Map();
for (let n = 1; n <= 20; n += 1) {
  const f = join(RACINE, "content", "paliers", `palier-${String(n).padStart(2, "0")}.json`);
  for (const mot of JSON.parse(readFileSync(f, "utf8")).mots) {
    if (!palierDe.has(mot.en)) palierDe.set(mot.en, n);
  }
}

const chemin = isAbsolute(fichier) ? fichier : join(ICI, fichier);
const brut = readFileSync(chemin, "utf8");
const texte = brut.split(/^--- EN\s*$/m)[1]?.split(/^--- FR\s*$/m)[0] ?? "";

const trop = new Map();
const inconnus = new Set();
let total = 0;

for (const jeton of texte.split(/\s+/)) {
  const nu = jeton.toLowerCase().replace(/[^a-z']/g, "");
  if (!nu) continue;
  total += 1;
  if (outils.has(nu)) continue;

  let p = palierDe.get(nu);
  if (p === undefined) for (const b of bases(nu)) if (palierDe.has(b)) { p = palierDe.get(b); break; }

  if (p === undefined) inconnus.add(nu);
  else if (p > plafond) trop.set(nu, p);
}

console.log(`${chemin.split("/").pop()} — ${total} mots (250-350 attendus)`);
console.log(`plafond visé : palier ${plafond}`);
console.log(`  au-dessus du plafond (${trop.size}) : ` +
  [...trop.entries()].sort((a, b) => a[1] - b[1]).map(([m, p]) => `${m}(P${p})`).join(" ") || "  aucun");
console.log(`  hors catalogue (${inconnus.size}) : ${[...inconnus].join(" ")}`);
