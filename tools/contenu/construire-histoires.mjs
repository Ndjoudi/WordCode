/**
 * Construit content/histoires/index.json (schéma §6.5) à partir des textes
 * rédigés dans ./histoires/.
 *
 * Format d'un fichier source :
 *   # arc: <id> | ordre: <n> | titre_en: <…> | titre_fr: <…>
 *     [| feuilleton: oui | serie_en: <…> | serie_fr: <…> | saison: <n>]
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
import { OUTILS, basesDe } from "./lexique.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..");

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
  // Tout le catalogue, TOEIC et monde professionnel compris : le feuilleton
  // emploie ce vocabulaire, et un mot hors catalogue ne compterait pas comme
  // une révision.
  const parEn = new Map();
  const manifeste = JSON.parse(readFileSync(join(RACINE, "content", "manifest.json"), "utf8"));
  for (const entree of manifeste.paliers) {
    const f = join(RACINE, "content", entree.fichier);
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
      // Un feuilleton se lit dans l'ordre, chapitre après chapitre (§07).
      ...(meta.feuilleton === "oui"
        ? { feuilleton: true, serie_en: meta.serie_en ?? null, serie_fr: meta.serie_fr ?? null,
            saison: Number(meta.saison ?? 1) }
        : {}),
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
