/**
 * Construit content/toeic/toeic-XX.json à partir de tools/contenu/toeic-XX.txt.
 *
 * Le vocabulaire TOEIC est la **priorité d'apprentissage** (README §3.6) : il
 * est servi avant les paliers de fréquence, parce que l'objectif est l'anglais
 * professionnel. Sur les 1056 mots de la liste, 158 figuraient déjà au
 * catalogue ; ce sont les 898 autres qui sont écrits ici, à la main.
 *
 * **Espace d'identifiants séparé** (`t_XXXXX`). Ceux du catalogue sont
 * positionnels (`w_<palier><rang>`) : y insérer des mots décalerait tous les
 * suivants, et la progression de l'utilisateur, indexée par identifiant,
 * désignerait alors d'autres mots. Les entrées TOEIC sont donc fusionnées au
 * chargement, comme les verbes irréguliers.
 *
 * La liste du PDF est alphabétique. Un découpage par tranches de 50 donnerait
 * un premier palier entièrement en « a » ; `toeic-source.txt` est donc réparti
 * en quinconce, chaque palier brassant l'alphabet.
 *
 * Usage : node tools/contenu/construire-toeic.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..");
const num = (n) => String(n).padStart(2, "0");

/** Les paliers de fréquence déjà livrés : le TOEIC commence juste après. */
const PALIERS_FREQUENCE = 20;

/** Types admis, alignés sur le catalogue (§6.1). */
const TYPES = new Set(["n", "v", "adj", "adv", "prep", "conj", "pron", "det", "expr"]);

/** Un mot n'entre en grille que s'il tient en 3 à 8 lettres, sans espace. */
const jouable = (en) => /^[A-Za-z]{3,8}$/.test(en);

/** Un segment par mot : les renvois vers le catalogue sont résolus à l'écran. */
const segmenter = (texte) =>
  texte.trim().split(/\s+/).filter(Boolean).map((txt) => ({ txt, trad: null, ref: null }));

function lirePalier(fichier) {
  const lignes = readFileSync(fichier, "utf8").split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  return lignes.map((ligne, rang) => {
    const champs = ligne.split("|").map((c) => c.trim());
    if (champs.length !== 6) {
      throw new Error(`${fichier} ligne ${rang + 1} : 6 champs attendus, ${champs.length} trouvés\n  ${ligne}`);
    }
    const [en, fr, type, phonetique, def, exemple] = champs;
    if (!TYPES.has(type)) throw new Error(`${fichier} : type inconnu « ${type} » pour ${en}`);
    if (!def) throw new Error(`${fichier} : ${en} sans définition — le quizz le sauterait`);
    return { en, fr, type, phonetique, def, exemple };
  });
}

function construire(entrees, palier, depart) {
  return entrees.map((e, i) => ({
    id: `t_${String(depart + i).padStart(5, "0")}`,
    en: e.en,
    fr: e.fr,
    type: e.type,
    source: "toeic",
    phonetique: e.phonetique || null,
    famille: e.en,
    sens_index: 1,
    rang_freq: null,
    // Les paliers TOEIC prolongent l'échelle existante : 21, 22… Ils ne
    // partagent donc aucun numéro avec les 20 paliers de fréquence, et le
    // déblocage continue de se calculer sur cinquante mots par palier.
    palier,
    themes: ["toeic"],
    exemple_en: e.exemple || null,
    exemple_fr: null,
    indice: { en: e.def, segments: segmenter(e.def) },
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
    eligible_grille: jouable(e.en),
    eligible_croises: jouable(e.en),
  }));
}

function principal() {
  const sources = readdirSync(ICI)
    .filter((f) => /^toeic-\d\d\.txt$/.test(f))
    .sort();

  if (!sources.length) {
    console.log("aucun fichier toeic-XX.txt à construire");
    return;
  }

  mkdirSync(join(RACINE, "content", "toeic"), { recursive: true });
  let depart = 1;
  let total = 0;
  const vus = new Set();

  for (const source of sources) {
    // toeic-01.txt devient le palier 21 : le TOEIC se range APRÈS les vingt
    // paliers de fréquence, sans en renuméroter aucun.
    const palier = PALIERS_FREQUENCE + Number(source.match(/toeic-(\d\d)\.txt/)[1]);
    const entrees = lirePalier(join(ICI, source));
    verifierRepartition(palier, entrees);

    for (const e of entrees) {
      if (vus.has(e.en)) throw new Error(`doublon : « ${e.en} » apparaît deux fois`);
      vus.add(e.en);
    }

    const mots = construire(entrees, palier, depart);
    depart += mots.length;
    total += mots.length;

    const sortie = join(RACINE, "content", "toeic", `toeic-${num(palier)}.json`);
    writeFileSync(sortie, JSON.stringify(
      { version: 1, type: "toeic", palier, titre: `TOEIC ${num(palier)}`, mots },
      null, 2) + "\n");

    const enGrille = mots.filter((m) => m.eligible_grille).length;
    console.log(`  palier ${num(palier)} : ${mots.length} mots, ${enGrille} jouables en grille`);
  }

  synchroniserManifeste();

  // Ce qui reste à écrire, pour savoir où on en est.
  const prevu = existsSync(join(ICI, "toeic-repartition.json"))
    ? Object.values(JSON.parse(readFileSync(join(ICI, "toeic-repartition.json"), "utf8")))
        .reduce((n, liste) => n + liste.length, 0)
    : 0;
  console.log(`\n${total} mots TOEIC rédigés ; ${prevu} prévus dans les paliers 22 et suivants`);
}

/**
 * Compare un paquet rédigé à la répartition figée.
 *
 * Sur dix-sept paquets écrits à la main, l'erreur probable n'est pas une faute
 * de frappe : c'est un mot oublié, ou rangé dans le mauvais paquet. On le
 * signale plutôt que de le découvrir à l'écran.
 */
function verifierRepartition(palier, entrees) {
  const fichier = join(ICI, "toeic-repartition.json");
  if (!existsSync(fichier)) return;
  const prevus = JSON.parse(readFileSync(fichier, "utf8"))[String(palier)];
  if (!prevus) return;   // palier 21 : rédigé avant la répartition
  const ecrits = new Set(entrees.map((e) => e.en.toLowerCase()));
  const attendus = new Set(prevus.map((m) => m.toLowerCase()));
  const manquants = [...attendus].filter((m) => !ecrits.has(m));
  const intrus = [...ecrits].filter((m) => !attendus.has(m));
  if (manquants.length || intrus.length) {
    throw new Error(`palier ${palier} non conforme à la répartition\n`
      + `  manquants : ${manquants.join(", ") || "—"}\n`
      + `  en trop   : ${intrus.join(", ") || "—"}`);
  }
}

/** Déclare chaque palier TOEIC écrit dans le manifeste, une seule fois. */
function synchroniserManifeste() {
  const chemin = join(RACINE, "content", "manifest.json");
  const manifeste = JSON.parse(readFileSync(chemin, "utf8"));
  const connus = new Set(manifeste.paliers.map((p) => Number(p.id)));
  const dossier = join(RACINE, "content", "toeic");
  let ajoutes = 0;

  for (const nom of readdirSync(dossier).filter((f) => /^toeic-\d\d\.json$/.test(f)).sort()) {
    const d = JSON.parse(readFileSync(join(dossier, nom), "utf8"));
    if (connus.has(Number(d.palier))) continue;
    manifeste.paliers.push({
      id: d.palier,
      fichier: `toeic/${nom}`,
      titre: `Anglais professionnel ${d.palier - PALIERS_FREQUENCE}`,
      nb_mots: d.mots.length,
      type: "theme",
    });
    ajoutes += 1;
  }
  manifeste.paliers.sort((a, b) => Number(a.id) - Number(b.id));
  writeFileSync(chemin, JSON.stringify(manifeste, null, 2) + "\n");
  if (ajoutes) console.log(`  manifeste : ${ajoutes} palier(s) déclaré(s)`);
}

principal();
