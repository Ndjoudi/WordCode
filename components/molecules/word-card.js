import { Button } from "../atoms/button.js";
import { IconButton } from "../atoms/icon-button.js";
import { Chip } from "../atoms/chip.js";

/**
 * WordCard — carte de découverte, phase 1 (README §10.2, §3.1).
 *
 * **La phrase d'abord, le mot coloré dedans.** Un mot présenté seul puis
 * illustré se mémorise comme une étiquette ; vu d'emblée dans une phrase, il
 * se mémorise avec son emploi. Les 1000 mots du catalogue ont tous une phrase
 * d'exemple, le format tient donc partout — à défaut, on retombe sur le mot
 * seul (mots importés, ajouts manuels sans exemple).
 *
 * Sous la phrase : la prononciation, la traduction du mot, celle de la phrase.
 * Le mot n'y est pas répété — il est déjà lisible, coloré, dans la phrase.
 *
 * `otherSense` affiche « autre sens déjà connu : … » pour consolider au lieu
 * de créer de la confusion (README §5.2).
 *
 * @param {object}   word        entité word du contenu
 * @param {boolean}  showAudio
 * @param {?string}  otherSense  traduction d'un autre sens déjà connu
 * @param {Function} onAudio     lecture de `word.en` — la synthèse vocale est
 *                               un service, le composant ne fait que la demander
 * @param {Function} onNext
 * @returns {HTMLElement}
 */
export function WordCard({ word = {}, showAudio = true, otherSense = null,
                           onAudio, onNext } = {}) {
  const el = document.createElement("article");
  el.className = "word-card";

  /* --- La phrase, ou le mot seul à défaut -------------------------------- */

  if (word.exemple_en) {
    el.append(phraseAvecCible(word.exemple_en, word));
  } else {
    const en = document.createElement("h2");
    en.className = "word-card__en";
    en.textContent = word.en ?? "";
    el.append(en);
  }

  /* --- Prononciation et écoute ------------------------------------------- */

  const entete = document.createElement("div");
  entete.className = "word-card__head";

  const titre = document.createElement("div");
  titre.className = "word-card__titles";

  if (word.phonetique) {
    const phon = document.createElement("p");
    phon.className = "word-card__phon";
    phon.textContent = word.phonetique;
    titre.append(phon);
  }

  entete.append(titre);
  if (showAudio) {
    entete.append(IconButton({
      icon: "audio",
      label: `Écouter ${word.en ?? ""}`,
      variant: "secondary",
      onClick: onAudio,
    }));
  }
  el.append(entete);

  /* --- Les deux traductions ---------------------------------------------- */

  const fr = document.createElement("p");
  fr.className = "word-card__fr";
  fr.textContent = word.fr ?? "";
  el.append(fr);

  if (word.exemple_fr) {
    const p = document.createElement("p");
    p.className = "word-card__example-fr";
    p.textContent = word.exemple_fr;
    el.append(p);
  }

  if (Array.isArray(word.themes) && word.themes.length) {
    const themes = document.createElement("div");
    themes.className = "word-card__themes";
    for (const theme of word.themes) themes.append(Chip({ label: theme, variant: "theme" }));
    el.append(themes);
  }

  if (otherSense) {
    const autre = document.createElement("p");
    autre.className = "word-card__other";
    autre.textContent = `autre sens déjà connu : ${otherSense}`;
    el.append(autre);
  }

  if (onNext) {
    el.append(Button({ label: "Suivant", fullWidth: true, onClick: onNext }));
  }

  return el;
}

/** Formes régulières à essayer avant de renoncer. */
const FLEXIONS = ["s", "es", "d", "ed", "ing", "ies"];

const echapper = (texte) => String(texte).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Où le mot se trouve-t-il dans sa phrase ?
 *
 * Mesuré sur le catalogue : 992 mots sur 1000 apparaissent tels quels ou à une
 * forme régulière. Les huit autres sont des verbes forts — `get → got`,
 * `win → won` — qu'aucune règle ne rattrape. Pour ceux-là on rend `null` et la
 * phrase s'affiche sans couleur : mieux vaut pas de couleur qu'une couleur sur
 * le mauvais mot.
 *
 * @returns {?{index:number, longueur:number}}
 */
function trouverCible(phrase, word) {
  const base = String(word.en ?? "").trim();
  if (!base) return null;

  const formes = [base, ...FLEXIONS.map((suffixe) => base + suffixe),
                  word.preterit, word.participe].filter(Boolean);

  for (const forme of formes) {
    const trouve = phrase.match(new RegExp(`\\b${echapper(forme)}\\b`, "i"));
    if (trouve) return { index: trouve.index, longueur: trouve[0].length };
  }

  // Radical : rattrape « carry → carries », « century → centuries ». On exige
  // quatre lettres pour ne pas accrocher n'importe quel mot de la phrase.
  const radical = base.slice(0, Math.max(4, base.length - 2));
  if (radical.length >= 4 && !radical.includes(" ")) {
    const trouve = phrase.match(new RegExp(`\\b${echapper(radical)}\\w*`, "i"));
    if (trouve) return { index: trouve.index, longueur: trouve[0].length };
  }
  return null;
}

/** La phrase, le mot cible entouré d'un `<mark>` — jamais par innerHTML. */
function phraseAvecCible(phrase, word) {
  const el = document.createElement("p");
  el.className = "word-card__phrase";
  el.lang = "en";

  const cible = trouverCible(phrase, word);
  if (!cible) {
    el.textContent = phrase;
    return el;
  }

  const fin = cible.index + cible.longueur;
  el.append(document.createTextNode(phrase.slice(0, cible.index)));

  const marque = document.createElement("mark");
  marque.className = "word-card__cible";
  marque.textContent = phrase.slice(cible.index, fin);
  el.append(marque);

  el.append(document.createTextNode(phrase.slice(fin)));
  return el;
}
