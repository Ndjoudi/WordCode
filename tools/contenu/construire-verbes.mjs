/**
 * Construit content/verbes.json — les verbes irréguliers ABSENTS des 1000 mots.
 *
 * Sur les 68 verbes irréguliers de `verbes-source.txt`, **53 figurent déjà au
 * catalogue** avec leur palier, leur indice et leur éligibilité aux jeux : ils
 * traversent donc déjà Découverte → Quizz → jeux comme n'importe quel mot, et
 * il n'y a rien à faire pour eux.
 *
 * Les 15 autres manquent — dont `be`, `have`, `do` et `go`, les verbes les plus
 * fréquents de l'anglais. Ce fichier les ajoute, **mis en forme comme des mots
 * ordinaires** : indice, palier, rang de fréquence, éligibilité aux jeux.
 *
 * Pourquoi un fichier à part plutôt que les insérer dans les paliers : les
 * identifiants du catalogue sont POSITIONNELS (`w_<palier><rang>`). Insérer un
 * mot décalerait tous les suivants, et la progression de l'utilisateur, indexée
 * par identifiant, se mettrait à désigner d'autres mots. Ces verbes gardent
 * donc leur propre espace (`v_00xx`) et sont fusionnés au chargement.
 *
 * Usage : node tools/contenu/construire-verbes.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..");

/**
 * Les 15 manquants. `palier` suit le rang de fréquence réel (50 mots par
 * palier) ; `indice` est la définition anglaise que le quizz (§03) présente à
 * la place du mot.
 */
const MANQUANTS = [
  { en: "be",    fr: "être",      pret: "was",    part: "been",      g: 4, rang: 2,
    def: "To exist, or to have a quality",            ex: "I want to be ready." },
  { en: "have",  fr: "avoir",     pret: "had",    part: "had",       g: 3, rang: 8,
    def: "To own something, or to hold it",           ex: "They have a new house." },
  { en: "do",    fr: "faire",     pret: "did",    part: "done",      g: 4, rang: 18,
    def: "To carry out an action",                    ex: "Please do your work." },
  { en: "go",    fr: "aller",     pret: "went",   part: "gone",      g: 4, rang: 27,
    def: "To move from one place to another",         ex: "We go to school." },
  { en: "let",   fr: "laisser",   pret: "let",    part: "let",       g: 1, rang: 118,
    def: "To allow someone to do something",          ex: "Let me help you." },
  { en: "put",   fr: "mettre",    pret: "put",    part: "put",       g: 1, rang: 143,
    def: "To move something into a place",            ex: "Put the book here." },
  { en: "set",   fr: "poser",     pret: "set",    part: "set",       g: 1, rang: 176,
    def: "To place something carefully somewhere",    ex: "She set the cup down." },
  { en: "read",  fr: "lire",      pret: "read",   part: "read",      g: 1, rang: 194,
    def: "To look at words and understand them",      ex: "I read every night." },
  { en: "cut",   fr: "couper",    pret: "cut",    part: "cut",       g: 1, rang: 372,
    def: "To divide something with a knife",          ex: "He cut the bread." },
  { en: "hit",   fr: "frapper",   pret: "hit",    part: "hit",       g: 1, rang: 428,
    def: "To strike something hard",                  ex: "The ball hit the wall." },
  { en: "cost",  fr: "coûter",    pret: "cost",   part: "cost",      g: 1, rang: 481,
    def: "To need a price in money",                  ex: "These shoes cost too much." },
  { en: "seek",  fr: "chercher",  pret: "sought", part: "sought",    g: 2, rang: 668,
    def: "To look for something with effort",         ex: "They seek a better life." },
  { en: "hurt",  fr: "blesser",   pret: "hurt",   part: "hurt",      g: 1, rang: 772,
    def: "To cause pain to someone",                  ex: "My leg hurts today." },
  { en: "quit",  fr: "quitter",   pret: "quit",   part: "quit",      g: 1, rang: 879,
    def: "To stop doing something for good",          ex: "He quit his job." },
  { en: "sting", fr: "piquer",    pret: "stung",  part: "stung",     g: 3, rang: 963,
    def: "To hurt with a sharp point, like a bee",    ex: "Bees sting when afraid." },
];

/** 50 mots par palier : le rang donne le palier. */
const palierDe = (rang) => Math.min(20, Math.floor((rang - 1) / 50) + 1);

/** Découpe la définition en segments. Les refs sont résolues à l'exécution. */
const segmenter = (texte) =>
  texte.split(/\s+/).map((txt) => ({ txt, trad: null, ref: null }));

const verbes = MANQUANTS.map((v, i) => ({
  id: `v_${String(i + 1).padStart(4, "0")}`,
  en: v.en,
  fr: v.fr,
  type: "v",
  source: "verbe",
  preterit: v.pret,
  participe: v.part,
  groupe_verbe: v.g,
  phonetique: null,
  famille: v.en,
  sens_index: 1,
  rang_freq: v.rang,
  palier: palierDe(v.rang),
  themes: [],
  exemple_en: v.ex,
  exemple_fr: null,
  indice: { en: v.def, segments: segmenter(v.def) },
  phrase_en: null,
  phrase_fr: null,
  date_capture: null,
  origine_partie: null,
  verbe_base: null,
  particule: null,
  litteral: null,
  // Ce sont des mots comme les autres : ils doivent pouvoir tomber en grille.
  eligible_grille: true,
  eligible_croises: true,
}));

mkdirSync(join(RACINE, "content"), { recursive: true });
writeFileSync(join(RACINE, "content", "verbes.json"),
              JSON.stringify({ version: 1, type: "verbes", verbes }, null, 2) + "\n");

const parPalier = {};
for (const v of verbes) (parPalier[v.palier] ??= []).push(v.en);
console.log(`${verbes.length} verbes écrits dans content/verbes.json`);
for (const [p, mots] of Object.entries(parPalier).sort((a, b) => a[0] - b[0])) {
  console.log(`  palier ${String(p).padStart(2)} : ${mots.join(", ")}`);
}
