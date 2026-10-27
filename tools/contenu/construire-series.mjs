/**
 * Construit les séries de paliers rédigées à la main après les 1000 mots :
 *
 *   toeic — tools/contenu/toeic-NN.txt → content/toeic/toeic-XX.json  (paliers 21-38)
 *   pro   — tools/contenu/pro-NN.txt   → content/pro/pro-XX.json      (paliers 39-104)
 *   bilingue — tools/contenu/bilingue-NN.txt → content/bilingue/…        (paliers 105-201)
 *   essentiels — tools/contenu/essentiels-NN.txt → content/essentiels/…  (palier 202)
 *
 * Le TOEIC prolonge les vingt paliers de fréquence. Sur les 1056 mots de sa
 * liste, 158 figuraient déjà au catalogue ; les 898 autres sont écrits ici.
 *
 * La série « bilingue » vise 10 000 mots : les 4 850 lemmes les plus fréquents
 * qui manquaient encore, d'après la liste de fréquence étendue du projet NGSL
 * (« NGSL with SFI », 31 000 lemmes) et la NAWL (`bilingue-source.txt`).
 *
 * La série « essentiels » rattrape les mots de la NGSL (2 800 mots essentiels)
 * absents du catalogue sous toute forme. Elle vient en fin d'échelle pour ne
 * renuméroter aucun palier : l'écran Progression permet de l'ouvrir à tout
 * moment (« Travailler ce palier »).
 *
 * La série « pro » complète le vocabulaire jusqu'à 5000 mots, avec les listes
 * du projet NGSL (Browne & Culligan, CC BY-SA 4.0) : NGSL 1.2 pour l'anglais
 * courant, BSL 1.2 pour les affaires, TSL 1.2 pour la vie de bureau. Les mots
 * déjà présents, les mots-outils et le jargon trop étroit en sont retirés ;
 * le reste est classé par fréquence (`pro-source.txt`).
 *
 * **Espaces d'identifiants séparés** (`t_XXXXX`, `m_XXXXX`). Ceux du catalogue
 * sont positionnels (`w_<palier><rang>`) : y insérer des mots décalerait tous
 * les suivants, et la progression de l'utilisateur, indexée par identifiant,
 * désignerait alors d'autres mots.
 *
 * Une ligne source = un mot :
 *   en | fr | type | phonétique | définition anglaise | exemple | traduction de l'exemple
 *
 * Usage : node tools/contenu/construire-series.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..");
const num = (n) => String(n).padStart(2, "0");

/**
 * Les séries, dans l'ordre des paliers. `premier` est le palier du fichier
 * NN = 01 : chaque série se range après la précédente, sans en renuméroter
 * aucune.
 */
const SERIES = [
  { nom: "toeic", prefixe: "t_", premier: 21, titre: "Anglais professionnel",
    titreFichier: (palier) => `TOEIC ${num(palier)}` },
  { nom: "pro", prefixe: "m_", premier: 39, titre: "Monde professionnel",
    titreFichier: (palier) => `Monde professionnel ${num(palier)}` },
  { nom: "bilingue", prefixe: "b_", premier: 105, titre: "Vers le bilingue",
    titreFichier: (palier) => `Vers le bilingue ${num(palier)}` },
  { nom: "essentiels", prefixe: "e_", premier: 202, titre: "Mots essentiels",
    titreFichier: () => "Mots essentiels" },
];

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
    if (champs.length !== 7) {
      throw new Error(`${fichier} ligne ${rang + 1} : 7 champs attendus, ${champs.length} trouvés\n  ${ligne}`);
    }
    const [en, fr, type, phonetique, def, exemple, traduction] = champs;
    if (!TYPES.has(type)) throw new Error(`${fichier} : type inconnu « ${type} » pour ${en}`);
    if (!def) throw new Error(`${fichier} : ${en} sans définition — le quizz le sauterait`);
    // La carte de découverte affiche la phrase puis sa traduction (§02).
    if (!traduction) throw new Error(`${fichier} : ${en} sans traduction de l'exemple`);
    return { en, fr, type, phonetique, def, exemple, traduction };
  });
}

function construire(serie, entrees, palier, depart) {
  return entrees.map((e, i) => ({
    id: `${serie.prefixe}${String(depart + i).padStart(5, "0")}`,
    en: e.en,
    fr: e.fr,
    type: e.type,
    source: serie.nom,
    phonetique: e.phonetique || null,
    famille: e.en,
    sens_index: 1,
    rang_freq: null,
    // Les séries prolongent l'échelle existante : elles ne partagent aucun
    // numéro avec les paliers d'avant, et le déblocage continue de se
    // calculer sur cinquante mots par palier.
    palier,
    themes: [serie.nom],
    exemple_en: e.exemple || null,
    exemple_fr: e.traduction,
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

/**
 * Compare un paquet rédigé à la répartition figée.
 *
 * Sur des dizaines de paquets écrits à la main, l'erreur probable n'est pas une
 * faute de frappe : c'est un mot oublié, ou rangé dans le mauvais paquet. On le
 * signale plutôt que de le découvrir à l'écran.
 */
function verifierRepartition(serie, palier, entrees) {
  const fichier = join(ICI, `${serie.nom}-repartition.json`);
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

/** Mots de la répartition dont le palier n'est pas encore écrit. */
function restants(serie, ecrits) {
  const fichier = join(ICI, `${serie.nom}-repartition.json`);
  if (!existsSync(fichier)) return 0;
  return Object.entries(JSON.parse(readFileSync(fichier, "utf8")))
    .filter(([palier]) => !ecrits.has(Number(palier)))
    .reduce((n, [, liste]) => n + liste.length, 0);
}

/** Déclare chaque palier écrit dans le manifeste, une seule fois. */
function synchroniserManifeste() {
  const chemin = join(RACINE, "content", "manifest.json");
  const manifeste = JSON.parse(readFileSync(chemin, "utf8"));
  const connus = new Set(manifeste.paliers.map((p) => Number(p.id)));
  let ajoutes = 0;

  for (const serie of SERIES) {
    const dossier = join(RACINE, "content", serie.nom);
    if (!existsSync(dossier)) continue;
    const motif = new RegExp(`^${serie.nom}-\\d{2,3}\\.json$`);
    for (const nom of readdirSync(dossier).filter((f) => motif.test(f)).sort()) {
      const d = JSON.parse(readFileSync(join(dossier, nom), "utf8"));
      if (connus.has(Number(d.palier))) continue;
      manifeste.paliers.push({
        id: d.palier,
        fichier: `${serie.nom}/${nom}`,
        titre: `${serie.titre} ${d.palier - serie.premier + 1}`,
        nb_mots: d.mots.length,
        type: "theme",
      });
      ajoutes += 1;
    }
  }
  manifeste.paliers.sort((a, b) => Number(a.id) - Number(b.id));
  writeFileSync(chemin, JSON.stringify(manifeste, null, 2) + "\n");
  if (ajoutes) console.log(`  manifeste : ${ajoutes} palier(s) déclaré(s)`);
}

function principal() {
  const vus = new Set();

  for (const serie of SERIES) {
    const motif = new RegExp(`^${serie.nom}-(\\d\\d)\\.txt$`);
    const sources = readdirSync(ICI).filter((f) => motif.test(f)).sort();
    if (!sources.length) continue;

    mkdirSync(join(RACINE, "content", serie.nom), { recursive: true });
    let depart = 1;
    let total = 0;
    const ecrits = new Set();

    for (const source of sources) {
      const palier = serie.premier - 1 + Number(source.match(motif)[1]);
      ecrits.add(palier);
      const entrees = lirePalier(join(ICI, source));
      verifierRepartition(serie, palier, entrees);

      // Un doublon entre séries ferait apprendre deux fois le même mot.
      for (const e of entrees) {
        const cle = e.en.toLowerCase();
        if (vus.has(cle)) throw new Error(`doublon : « ${e.en} » apparaît deux fois`);
        vus.add(cle);
      }

      const mots = construire(serie, entrees, palier, depart);
      depart += mots.length;
      total += mots.length;

      const sortie = join(RACINE, "content", serie.nom, `${serie.nom}-${num(palier)}.json`);
      writeFileSync(sortie, JSON.stringify(
        { version: 1, type: serie.nom, palier, titre: serie.titreFichier(palier), mots },
        null, 2) + "\n");

      const enGrille = mots.filter((m) => m.eligible_grille).length;
      console.log(`  ${serie.nom} palier ${num(palier)} : ${mots.length} mots, ${enGrille} jouables en grille`);
    }

    console.log(`${serie.nom} : ${total} mots rédigés, ${restants(serie, ecrits)} encore à écrire\n`);
  }

  synchroniserManifeste();
}

principal();
