/**
 * Rattacher un mot d'un texte anglais au catalogue.
 *
 * Partagé par la construction des histoires (lexique d'un chapitre) et par
 * celle des conférences (part des mots connus à chaque palier). Un mot du texte
 * compte pour son lemme : le lecteur qui connaît « go » lit « went » sans
 * effort, et une couverture qui l'ignorerait serait fausse.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Mots-outils : ils ne se traduisent pas isolément (§3.1) et le catalogue ne
 * les contient pas. Un lecteur de ce niveau les connaît tous.
 */
export const OUTILS = new Set(`a an the this that these those there here
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

/**
 * Mots-outils de l'oral, absents des textes écrits pour l'application mais
 * omniprésents dans une conférence : interjections, pronoms réfléchis,
 * prépositions et conjonctions de second rang.
 */
export const OUTILS_ORAUX = new Set(`yeah yes okay ok oh um uh hmm wow hey ah
gonna wanna gotta
myself yourself himself herself itself ourselves yourselves themselves
whose whatever whoever whenever wherever whichever
since until till though although unless whether
through across against among between during without within along around
behind beyond near off per via toward towards upon
above below beside besides despite however therefore thus whereas throughout etc
cannot ours hers theirs la
non anti pre re co ex
zero one two three four five six seven eight nine ten eleven twelve thirteen
fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty
sixty seventy eighty ninety hundred thousand million billion trillion
third fourth fifth sixth seventh eighth ninth tenth twice`.split(/\s+/).filter(Boolean));

/**
 * Formes irrégulières courantes qu'aucune règle ne rattrape.
 * Sans elles, « went » serait compté comme un mot inconnu alors que le lecteur
 * connaît « go » — et la couverture mesurée serait fausse.
 */
export const IRREGULIERS = new Map(Object.entries({
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
 * Irréguliers de second rang : rares dans les textes simples des histoires,
 * fréquents dans une conférence.
 */
export const IRREGULIERS_ORAUX = new Map(Object.entries({
  became: "become", begun: "begin", bent: "bend", bit: "bite", bitten: "bite",
  blew: "blow", blown: "blow", bled: "bleed", bore: "bear", born: "bear",
  bound: "bind", bred: "breed", burnt: "burn", chosen: "choose", clung: "cling",
  crept: "creep", dealt: "deal", dug: "dig", drew: "draw", drawn: "draw",
  dreamt: "dream", drunk: "drink", driven: "drive", fed: "feed", fled: "flee",
  flew: "fly", flown: "fly", forbade: "forbid", forgave: "forgive",
  forgiven: "forgive", forgotten: "forget", froze: "freeze", frozen: "freeze",
  grown: "grow", hid: "hide", hidden: "hide", hung: "hang", laid: "lay",
  led: "lead", lent: "lend", lain: "lie", lit: "light", meant: "mean",
  mistook: "mistake", mistaken: "mistake", overcame: "overcome", rang: "ring",
  rung: "ring", rode: "ride", ridden: "ride", rose: "rise", risen: "rise",
  sang: "sing", sung: "sing", sank: "sink", sunk: "sink", shook: "shake",
  shaken: "shake", shone: "shine", shot: "shoot", shrank: "shrink",
  slid: "slide", sought: "seek", spun: "spin", spat: "spit", sprang: "spring",
  stole: "steal", stolen: "steal", stuck: "stick", stung: "sting",
  struck: "strike", swept: "sweep", swore: "swear", sworn: "swear",
  swung: "swing", tore: "tear", torn: "tear", thrown: "throw", wept: "weep",
  withdrew: "withdraw", withdrawn: "withdraw", woken: "wake", worn: "wear",
  wound: "wind", undertook: "undertake", undertaken: "undertake",
  mice: "mouse", geese: "goose", phenomena: "phenomenon", criteria: "criterion",
  analyses: "analysis", crises: "crisis", hypotheses: "hypothesis",
  shown: "show", proven: "prove", gotten: "get",
  bigger: "big", biggest: "big", further: "far", furthest: "far",
  farther: "far", less: "little", least: "little",
}));

/**
 * Une tige qui finit par une seule voyelle et une consonne appelle un e muet :
 * « writing » vient de « write », pas de « writ » ; « caring » de « care »,
 * pas de « car ». Les deux existent au catalogue, l'ordre des essais tranche.
 */
const eMuet = (tige) => /[^aeiou][aeiou][b-df-hj-np-tv-z]$/.test(tige);

/**
 * Bases plausibles d'une forme fléchie, de la plus probable à la moins.
 * @param {string} mot
 * @param {Map<string,string>} irreguliers
 * @returns {string[]}
 */
export function basesDe(mot, irreguliers = IRREGULIERS) {
  const b = [];
  if (irreguliers.has(mot)) b.push(irreguliers.get(mot));
  if (mot.endsWith("ies")) b.push(mot.slice(0, -3) + "y");
  if (mot.endsWith("es")) b.push(mot.slice(0, -2));
  if (mot.endsWith("s") && !mot.endsWith("ss")) b.push(mot.slice(0, -1));
  if (mot.endsWith("ied")) b.push(mot.slice(0, -3) + "y");
  if (mot.endsWith("ed")) {
    b.push(mot.slice(0, -1), mot.slice(0, -2));
    if (/(.)\1ed$/.test(mot)) b.push(mot.slice(0, -3));
  }
  if (mot.endsWith("ing")) {
    const tige = mot.slice(0, -3);
    b.push(...(eMuet(tige) ? [tige + "e", tige] : [tige, tige + "e"]));
    if (/(.)\1ing$/.test(mot)) b.push(mot.slice(0, -4));
  }
  if (mot.endsWith("ly")) b.push(mot.slice(0, -2));
  if (mot.endsWith("er")) {
    const tige = mot.slice(0, -2);
    b.push(...(eMuet(tige) ? [tige + "e", tige] : [tige, tige + "e"]));
  }
  if (mot.endsWith("est")) b.push(mot.slice(0, -3), mot.slice(0, -2));
  return b;
}

/**
 * Bases supplémentaires pour l'oral : « happily », « basically », « ves »…
 * Gardées à part pour ne pas changer le lexique des histoires déjà livrées.
 * @param {string} mot
 * @returns {string[]}
 */
export function basesOrales(mot) {
  const b = basesDe(mot, new Map([...IRREGULIERS, ...IRREGULIERS_ORAUX]));
  if (mot.endsWith("ily")) b.push(mot.slice(0, -3) + "y");
  if (mot.endsWith("ically")) b.push(mot.slice(0, -4));
  if (mot.endsWith("bly")) b.push(mot.slice(0, -1) + "e");
  if (mot.endsWith("ier")) b.push(mot.slice(0, -3) + "y");
  if (mot.endsWith("iest")) b.push(mot.slice(0, -4) + "y");
  if (/(.)\1(er|est)$/.test(mot)) b.push(mot.replace(/(.)\1(er|est)$/, "$1"));
  if (mot.endsWith("ves")) b.push(mot.slice(0, -3) + "f", mot.slice(0, -3) + "fe");
  if (mot.endsWith("ying")) b.push(mot.slice(0, -4) + "ie");
  if (mot.endsWith("men")) b.push(mot.slice(0, -3) + "man");
  return b;
}

/**
 * Forme nue d'un mot de l'oral : minuscules, apostrophes droites, contraction
 * ramenée à son mot porteur (« don't » → « do », « we're » → « we »,
 * « people's » → « people »).
 * @param {string} jeton
 * @returns {string}
 */
export function formeNue(jeton) {
  let mot = String(jeton).toLowerCase().replace(/[’‘`]/g, "'")
    .replace(/[^a-z']/g, "").replace(/^'+|'+$/g, "");
  if (mot === "can't") return "can";
  if (mot === "won't") return "will";
  if (mot === "ain't") return "be";
  if (mot === "shan't") return "shall";
  if (mot.endsWith("n't")) return mot.slice(0, -3);
  mot = mot.replace(/'(s|re|ve|ll|d|m)$/, "");
  return mot.replace(/'/g, "");
}

/**
 * Le catalogue entier, indexé par mot anglais en minuscules.
 * @param {string} racine  dossier racine du projet
 * @returns {Map<string,{id:string, palier:number}>}  premier sens, plus petit palier
 */
export function chargerCatalogue(racine) {
  const parEn = new Map();
  const noter = (forme, id, palier) => {
    const cle = String(forme ?? "").toLowerCase();
    if (!cle) return;
    const deja = parEn.get(cle);
    if (!deja || palier < deja.palier) parEn.set(cle, { id, palier });
  };
  const lire = (fichier) => JSON.parse(readFileSync(join(racine, "content", fichier), "utf8"));

  const manifeste = lire("manifest.json");
  for (const entree of manifeste.paliers) {
    for (const mot of lire(entree.fichier).mots) noter(mot.en, mot.id, Number(entree.id));
  }
  // Les verbes irréguliers (§3.2) vivent hors des paliers mais portent le
  // leur ; leurs formes passées comptent comme le verbe.
  if (manifeste.verbes) {
    for (const v of lire(manifeste.verbes).verbes ?? []) {
      const palier = Number(v.palier ?? 1);
      for (const forme of [v.en, v.preterit, v.participe]) noter(forme, v.id, palier);
    }
  }
  return parEn;
}
