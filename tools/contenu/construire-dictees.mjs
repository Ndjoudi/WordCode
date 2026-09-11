/**
 * Construit content/dictees/dictee-XX.json à partir des exports Tatoeba.
 *
 * Les phrases de dictée ne sont PAS écrites à la main : elles viennent d'un
 * corpus de phrases réellement enregistrées par des humains. Une dictée lue
 * par une synthèse vocale n'entraîne pas l'oreille sur ce qui compte —
 * liaisons, rythme, élisions.
 *
 * Chaque phrase retenue :
 *   - a un enregistrement audio,
 *   - a au moins une traduction française,
 *   - n'emploie QUE du vocabulaire du palier visé ou d'un palier antérieur.
 *
 * Le troisième point est la seule raison d'être de ce script : sans lui, la
 * dictée servirait des mots que l'utilisateur n'a jamais vus, et deviendrait
 * un exercice de devinette orthographique.
 *
 * ATTRIBUTION — les enregistrements sont sous CC BY-NC-ND 3.0 pour l'essentiel.
 * Usage non commercial, aucune modification du fichier audio, crédit du lecteur
 * et de Tatoeba obligatoires (§16). Le champ `lecteur` de chaque entrée porte
 * le crédit ; l'écran l'affiche.
 *
 * Entrées : les exports décompressés dans le dossier passé par --exports
 *   eng_sentences.tsv · fra_sentences.tsv · eng-fra_links.tsv · sentences_with_audio.csv
 *
 * Usage :
 *   node tools/contenu/construire-dictees.mjs --exports <dossier> [--palier N] [--sans-audio]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..");
const num = (n) => String(n).padStart(2, "0");

/** Phrases retenues par palier. */
export const DICTEES_PAR_PALIER = 50;

/** Bornes de longueur : trop court n'apprend rien, trop long décourage. */
export const MOTS_MIN = 4;
export const MOTS_MAX = 12;

/** Adresse de téléchargement d'un enregistrement. */
const urlAudio = (audioId) => `https://tatoeba.org/en/audio/download/${audioId}`;

/**
 * Mots-outils : ils n'appartiennent à aucun palier et ne doivent pas faire
 * rejeter une phrase (§3.1).
 */
const OUTILS = new Set(`a an the this that these those there here
i you he she it we they me him her us them my your his its our their mine yours
am is are was were be been being do does did done have has had having
will would shall should can could may might must
and or but so if then than as because while when where why how what which who whom
of to in on at by for with from into onto out up down over under about after before
not no nor none nothing very too also just only even still yet again once more most
some any all both each every other another such same own
don't doesn't didn't can't won't isn't aren't wasn't weren't couldn't shouldn't
i'm it's he's she's they're we're you're i've you've we've there's that's what's
let's i'll you'll he'll she'll we'll they'll i'd you'd he'd she'd we'd they'd
mr mrs miss o'clock`.split(/\s+/).filter(Boolean));

/** Formes irrégulières que les règles de suffixe ne rattrapent pas. */
const IRREGULIERS = new Map(Object.entries({
  went: "go", gone: "go", said: "say", got: "get", made: "make", saw: "see",
  seen: "see", came: "come", took: "take", taken: "take", knew: "know",
  known: "know", gave: "give", given: "give", found: "find", told: "tell",
  left: "leave", felt: "feel", kept: "keep", stood: "stand", ran: "run",
  sat: "sit", won: "win", lost: "lose", paid: "pay", met: "meet", sent: "send",
  heard: "hear", held: "hold", brought: "bring", bought: "buy", caught: "catch",
  taught: "teach", thought: "think", broke: "break", spoke: "speak",
  wrote: "write", drank: "drink", ate: "eat", fell: "fall", began: "begin",
  forgot: "forget", wore: "wear", woke: "wake", threw: "throw", slept: "sleep",
  children: "child", men: "man", women: "woman", feet: "foot",
  better: "good", best: "good", worse: "bad", more: "much", most: "much",
}));

/** Bases plausibles d'une forme fléchie. */
function basesDe(mot) {
  const b = [];
  if (IRREGULIERS.has(mot)) b.push(IRREGULIERS.get(mot));
  if (mot.endsWith("ies")) b.push(`${mot.slice(0, -3)}y`);
  if (mot.endsWith("es")) b.push(mot.slice(0, -2));
  if (mot.endsWith("s") && !mot.endsWith("ss")) b.push(mot.slice(0, -1));
  if (mot.endsWith("ied")) b.push(`${mot.slice(0, -3)}y`);
  if (mot.endsWith("ed")) {
    b.push(mot.slice(0, -1), mot.slice(0, -2));
    if (/(.)\1ed$/.test(mot)) b.push(mot.slice(0, -3));
  }
  if (mot.endsWith("ing")) {
    b.push(mot.slice(0, -3), `${mot.slice(0, -3)}e`);
    if (/(.)\1ing$/.test(mot)) b.push(mot.slice(0, -4));
  }
  if (mot.endsWith("ly")) b.push(mot.slice(0, -2));
  return b;
}

/**
 * Palier le plus haut employé par une phrase.
 * @param {string} texte
 * @param {Map<string,number>} palierDe
 * @returns {?number} null si un mot sort des 1000
 */
export function palierDeLaPhrase(texte, palierDe) {
  let max = 0;
  for (const jeton of texte.split(/\s+/)) {
    const nu = jeton.toLowerCase().replace(/[^a-z']/g, "");
    if (!nu || OUTILS.has(nu)) continue;
    let p = palierDe.get(nu);
    if (p === undefined) for (const base of basesDe(nu)) if (palierDe.has(base)) { p = palierDe.get(base); break; }
    if (p === undefined) return null;
    max = Math.max(max, p);
  }
  return max;
}

/** Index mot → palier, sur les 20 paliers livrés. */
function chargerVocabulaire() {
  const palierDe = new Map();
  for (let n = 1; n <= 20; n += 1) {
    const f = join(RACINE, "content", "paliers", `palier-${num(n)}.json`);
    if (!existsSync(f)) continue;
    for (const mot of JSON.parse(readFileSync(f, "utf8")).mots) {
      if (!palierDe.has(mot.en)) palierDe.set(mot.en, n);
    }
  }
  return palierDe;
}

/** Lit les quatre exports et compose les phrases candidates, par palier. */
export function candidates(dossier, palierDe) {
  const audio = new Map();
  for (const ligne of readFileSync(join(dossier, "sentences_with_audio.csv"), "utf8").split("\n")) {
    const p = ligne.split("\t");
    if (p.length > 2) audio.set(p[0], { audioId: p[1], lecteur: p[2], licence: (p[3] || "").trim() || "CC BY-NC-ND 3.0" });
  }

  const fra = new Map();
  for (const ligne of readFileSync(join(dossier, "fra_sentences.tsv"), "utf8").split("\n")) {
    const p = ligne.split("\t");
    if (p.length > 2) fra.set(p[0], p[2]);
  }

  // Trois index tirés du même fichier de liens :
  //   anglais → français   pour l'énoncé de la traduction,
  //   anglais → id français et français → id anglais, pour retrouver les
  //   AUTRES formulations anglaises du même sens.
  // Sans ces dernières, une traduction correcte mais tournée autrement serait
  // refusée, et l'exercice punirait l'utilisateur d'avoir raison autrement.
  const traductions = new Map();
  const fraDeEng = new Map();
  const engDeFra = new Map();
  for (const ligne of readFileSync(join(dossier, "eng-fra_links.tsv"), "utf8").split("\n")) {
    const p = ligne.split("\t");
    if (p.length < 2) continue;
    const [idEng, idFra] = p;
    const texte = fra.get(idFra);
    if (!texte) continue;

    if (!traductions.has(idEng)) traductions.set(idEng, []);
    traductions.get(idEng).push(texte);

    if (!fraDeEng.has(idEng)) fraDeEng.set(idEng, []);
    fraDeEng.get(idEng).push(idFra);

    if (!engDeFra.has(idFra)) engDeFra.set(idFra, []);
    engDeFra.get(idFra).push(idEng);
  }

  const anglais = new Map();
  for (const ligne of readFileSync(join(dossier, "eng_sentences.tsv"), "utf8").split("\n")) {
    const p = ligne.split("\t");
    if (p.length > 2) anglais.set(p[0], p[2].trim());
  }

  /**
   * Autres phrases anglaises reliées aux mêmes phrases françaises.
   * @param {string} idEng
   * @returns {string[]}
   */
  const alternatives = (idEng) => {
    const textes = new Set();
    for (const idFra of fraDeEng.get(idEng) ?? []) {
      for (const autre of engDeFra.get(idFra) ?? []) {
        if (autre === idEng) continue;
        const texte = anglais.get(autre);
        if (texte) textes.add(texte);
      }
    }
    return [...textes];
  };

  const parPalier = new Map();
  for (const ligne of readFileSync(join(dossier, "eng_sentences.tsv"), "utf8").split("\n")) {
    const p = ligne.split("\t");
    if (p.length < 3) continue;
    const [id, , texte] = p;

    const enregistrement = audio.get(id);
    const fr = traductions.get(id);
    if (!enregistrement || !fr?.length) continue;

    const mots = texte.trim().split(/\s+/).length;
    if (mots < MOTS_MIN || mots > MOTS_MAX) continue;

    const palier = palierDeLaPhrase(texte, palierDe);
    if (palier === null || palier < 1) continue;

    if (!parPalier.has(palier)) parPalier.set(palier, []);
    parPalier.get(palier).push({
      id,
      en: texte.trim(),
      fr: [...new Set(fr)],
      en_alt: alternatives(id),
      mots,
      audio_id: enregistrement.audioId,
      lecteur: enregistrement.lecteur,
      licence: enregistrement.licence,
    });
  }
  return parPalier;
}

/**
 * Squelette d'une phrase : ses mots de contenu, triés.
 *
 * Sert à écarter les quasi-doublons. « Ask her her name » et « Ask him his
 * name » ne sont pas la même phrase, mais les dicter toutes les deux n'apporte
 * rien : l'oreille travaille exactement la même chose.
 *
 * @param {string} en
 * @returns {string}
 */
export function squelette(en) {
  return en.toLowerCase()
    .split(/\s+/)
    .map((j) => j.replace(/[^a-z']/g, ""))
    .filter((j) => j && !OUTILS.has(j))
    .sort()
    .join(" ");
}

/** Empreinte stable d'une chaîne, pour un tirage reproductible. */
function empreinte(texte) {
  let h = 0;
  for (let i = 0; i < texte.length; i += 1) h = (h * 31 + texte.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Retient les phrases d'un palier.
 *
 * Deux écueils, tous deux constatés sur la première sortie :
 *  - prendre les N premières par ordre alphabétique donne cinquante phrases
 *    commençant par A ou B ;
 *  - le corpus contient des variantes très proches d'une même phrase.
 *
 * On dédoublonne donc par squelette, puis on échantillonne de façon étalée et
 * reproductible : le tri est déterministe, deux exécutions donnent le même
 * fichier.
 *
 * @param {object[]} liste
 * @param {number} combien
 * @returns {object[]}
 */
export function retenir(liste = [], combien = DICTEES_PAR_PALIER) {
  const vus = new Set();
  const uniques = [];
  for (const phrase of [...liste].sort((a, b) => a.mots - b.mots || a.en.localeCompare(b.en))) {
    const cle = squelette(phrase.en);
    if (vus.has(cle)) continue;
    vus.add(cle);
    uniques.push(phrase);
  }
  if (uniques.length <= combien) return uniques;

  // Échantillonnage stratifié : une phrase par tranche, choisie par empreinte.
  // On garde ainsi l'éventail des longueurs et des initiales.
  const retenues = [];
  const largeur = uniques.length / combien;
  for (let i = 0; i < combien; i += 1) {
    const debut = Math.floor(i * largeur);
    const fin = Math.max(Math.floor((i + 1) * largeur), debut + 1);
    const tranche = uniques.slice(debut, fin);
    retenues.push(tranche[empreinte(tranche[0].id) % tranche.length]);
  }
  return retenues;
}

/** Télécharge un enregistrement, sans jamais le modifier (licence ND). */
async function telecharger(audioId, cible) {
  if (existsSync(cible) && statSync(cible).size > 1000) return "déjà là";
  const reponse = await fetch(urlAudio(audioId), { redirect: "follow" });
  if (!reponse.ok) return `échec HTTP ${reponse.status}`;
  const octets = Buffer.from(await reponse.arrayBuffer());
  if (octets.length < 1000) return "fichier suspect, ignoré";
  writeFileSync(cible, octets);
  return "téléchargé";
}

async function principal() {
  const args = process.argv.slice(2);
  const dossier = args.includes("--exports") ? args[args.indexOf("--exports") + 1] : null;
  const seul = args.includes("--palier") ? Number(args[args.indexOf("--palier") + 1]) : null;
  const sansAudio = args.includes("--sans-audio");

  if (!dossier || !existsSync(join(dossier, "eng_sentences.tsv"))) {
    console.error("usage : --exports <dossier des exports Tatoeba décompressés>");
    process.exitCode = 1;
    return;
  }

  const palierDe = chargerVocabulaire();
  console.log(`vocabulaire : ${palierDe.size} mots sur 20 paliers`);

  const parPalier = candidates(dossier, palierDe);
  const dossierDictees = join(RACINE, "content", "dictees");
  const dossierAudio = join(RACINE, "content", "audio");
  mkdirSync(dossierDictees, { recursive: true });
  if (!sansAudio) mkdirSync(dossierAudio, { recursive: true });

  for (let n = 1; n <= 20; n += 1) {
    if (seul && n !== seul) continue;
    // Une phrase du palier N n'emploie rien au-delà de N : on prend son propre
    // stock, complété par les paliers antérieurs si besoin.
    const stock = [];
    for (let p = n; p >= 1; p -= 1) stock.push(...(parPalier.get(p) ?? []));
    const retenues = retenir(stock);
    if (!retenues.length) { console.log(`palier ${num(n)} : aucune phrase`); continue; }

    let telecharges = 0;
    if (!sansAudio) {
      for (const phrase of retenues) {
        const etat = await telecharger(phrase.audio_id, join(dossierAudio, `${phrase.audio_id}.mp3`));
        if (etat === "téléchargé") { telecharges += 1; await new Promise((r) => setTimeout(r, 250)); }
        else if (etat !== "déjà là") console.log(`    ${phrase.audio_id} : ${etat}`);
      }
    }

    const sortie = {
      palier: n,
      version: 4,
      source: "Tatoeba (tatoeba.org)",
      licence_texte: "CC BY 2.0 FR",
      licence_audio: "CC BY-NC-ND 3.0 sauf mention contraire",
      phrases: retenues.map((p) => ({
        id: `d_${num(n)}${String(retenues.indexOf(p) + 1).padStart(3, "0")}`,
        tatoeba_id: p.id,
        en: p.en,
        fr: p.fr,
        audio: `audio/${p.audio_id}.mp3`,
        lecteur: p.lecteur,
        licence: p.licence,
      })),
    };
    writeFileSync(join(dossierDictees, `dictee-${num(n)}.json`), `${JSON.stringify(sortie, null, 2)}\n`);
    console.log(`palier ${num(n)} : ${retenues.length} phrases`
      + `${sansAudio ? "" : `, ${telecharges} audio téléchargé(s)`}`
      + ` — stock disponible ${stock.length}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await principal();
