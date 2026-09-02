import { Tile } from "../atoms/tile.js";
import { TileGroup } from "../molecules/tile-group.js";
import { ClueText } from "../molecules/clue-text.js";
import { ClueRow } from "../molecules/clue-row.js";
import { TranslationPopover } from "../molecules/translation-popover.js";
import { Keyboard } from "../molecules/keyboard.js";

/** Durées de la §17.7, en millisecondes. */
const DUREE_ERREUR = 600;
const DUREE_FIN = 800;

/** Plafond d'ajouts organiques par partie (README §3.5). */
const AJOUTS_MAX = 3;

/**
 * CodewordBoard — la grille complète : phrase cachée et liste d'indices
 * (README §10.3, §17.1 à §17.3, §17.7).
 *
 * Le composant tient l'état de jeu et le rend lui-même : re-rendre la grille
 * entière à chaque frappe détruirait la case active. Il notifie l'écran par
 * `onLetterInput`, qui reste maître de la persistance.
 *
 * Aucun système d'indices (§17.3) : ni ampoule, ni compteur, ni révélation.
 * Le seul secours est le tap-to-translate, gratuit et illimité (§3.5).
 *
 * `partie` est enrichie par l'écran : `motsResolus` (les entités `word` des
 * cinq mots) et, sur chaque segment d'indice, `connu` (le mot est déjà au
 * catalogue). Le composant ne consulte jamais le store.
 *
 * @param {object}   partie
 * @param {Object<string,string>} alphabetState  numéro → lettre déjà posée
 * @param {Function} onLetterInput  ({ numero, lettre, alphabetState })
 * @param {Function} onComplete     la grille est entièrement résolue
 * @param {Function} onAddWord      un segment part en file de découverte
 * @returns {HTMLElement}
 */
export function CodewordBoard({ partie, alphabetState = {}, onLetterInput,
                                onComplete, onAddWord } = {}) {
  const el = document.createElement("section");
  el.className = "codeword";

  /* ---------------------------------------------------------------- Données */

  // L'alphabet du contenu est numéro → lettre : c'est la SOLUTION. On l'inverse
  // pour numéroter les cases.
  const numeroDe = new Map();
  for (const [numero, lettre] of Object.entries(partie.alphabet ?? {})) {
    numeroDe.set(String(lettre).toUpperCase(), Number(numero));
  }

  const offertes = new Set((partie.lettres_offertes ?? []).map((l) => String(l).toUpperCase()));
  const numerosOfferts = new Set(
    [...offertes].map((lettre) => numeroDe.get(lettre)).filter(Boolean));

  /** État de jeu : numéro → lettre posée. Les cases offertes sont pré-remplies. */
  const pose = { ...alphabetState };
  for (const numero of numerosOfferts) {
    pose[numero] = [...numeroDe.entries()].find(([, n]) => n === numero)?.[0] ?? pose[numero];
  }

  /** Découpe un texte en groupes de cases ; les non-lettres deviennent des blancs. */
  const enCases = (texte) => String(texte ?? "").toUpperCase().split(/\s+/)
    .filter(Boolean)
    .map((mot) => [...mot]
      .filter((c) => /[A-Z]/.test(c))
      .map((lettre) => ({ lettre, numero: numeroDe.get(lettre) ?? null })));

  const groupePhrase = enCases(partie.phrase_en);

  const motsResolus = partie.motsResolus ?? [];
  const groupesMots = motsResolus.map((mot) => ({
    mot,
    cases: enCases(mot.en)[0] ?? [],
    resolu: false,
  }));

  const phrase = { cases: groupePhrase.flat(), resolu: false };

  /** Numéros verrouillés : offerts, ou appartenant à un mot déjà validé. */
  const verrouilles = () => {
    const set = new Set(numerosOfferts);
    for (const groupe of groupesMots) {
      if (!groupe.resolu) continue;
      for (const c of groupe.cases) set.add(c.numero);
    }
    if (phrase.resolu) for (const c of phrase.cases) set.add(c.numero);
    return set;
  };

  /* ------------------------------------------------------------------ État UI */

  /** Case active : { groupe, index }. `groupe` est un objet de groupesMots ou phrase. */
  let actif = null;
  let enErreur = new Set();
  let ajouts = 0;
  let termine = false;

  const premiereVide = (groupe) =>
    groupe.cases.findIndex((c) => !pose[c.numero]);

  const premierGroupeNonResolu = () =>
    groupesMots.find((g) => !g.resolu && premiereVide(g) !== -1)
    ?? (!phrase.resolu && premiereVide(phrase) !== -1 ? phrase : null);

  const placerCurseurInitial = () => {
    const groupe = premierGroupeNonResolu();
    actif = groupe ? { groupe, index: Math.max(premiereVide(groupe), 0) } : null;
  };

  /* -------------------------------------------------------------------- Rendu */

  const zoneJeu = document.createElement("div");
  zoneJeu.className = "codeword__play";
  el.append(zoneJeu);

  const zonePopover = document.createElement("div");
  zonePopover.className = "codeword__popover";
  el.append(zonePopover);

  const zoneClavier = document.createElement("div");
  zoneClavier.className = "codeword__keyboard";
  // Le clavier ne se démonte jamais pendant la phase 3 (§17.1, §17.6).
  zoneClavier.append(Keyboard({
    disabledKeys: [],           // « L'app n'empêche rien » (§17.1)
    onKey: saisir,
    onBackspace: effacer,
  }));
  el.append(zoneClavier);

  /** État visuel d'une case, dans l'ordre de priorité de la §17.1. */
  const etatCase = (c, groupe, index) => {
    if (enErreur.has(c.numero)) return "error";
    if (groupe.resolu) return "revealed";
    if (numerosOfferts.has(c.numero)) return "offered";
    if (actif && actif.groupe === groupe && actif.index === index) return "active";
    return pose[c.numero] ? "filled" : "empty";
  };

  const rendreGroupe = (groupe, cases = groupe.cases) => TileGroup({
    tiles: cases.map((c, i) => ({
      letter: pose[c.numero] ?? "",
      number: c.numero,
      state: etatCase(c, groupe, groupe.cases.indexOf(c)),
    })),
    onTileClick: (i) => {
      const c = cases[i];
      if (numerosOfferts.has(c.numero) || groupe.resolu) return;   // verrouillé
      actif = { groupe, index: groupe.cases.indexOf(c) };
      rendre();
    },
  });

  function rendre() {
    zoneJeu.replaceChildren();

    /* Phrase cachée */
    const blocPhrase = document.createElement("div");
    blocPhrase.className = `codeword__phrase${phrase.resolu ? " codeword__phrase--solved" : ""}`;
    let curseur = 0;
    for (const motDeLaPhrase of groupePhrase) {
      const cases = phrase.cases.slice(curseur, curseur + motDeLaPhrase.length);
      curseur += motDeLaPhrase.length;
      blocPhrase.append(rendreGroupe(phrase, cases));
    }
    zoneJeu.append(blocPhrase);

    /* Les cinq indices */
    const liste = document.createElement("div");
    liste.className = "codeword__clues";
    for (const groupe of groupesMots) {
      const indice = partie.indices?.[groupe.mot.id];
      liste.append(ClueRow({
        clue: ClueText({
          segments: indice?.segments ?? [],
          onWordTap: (segment, _i, element) => ouvrirTraduction(segment, element),
        }),
        tiles: rendreGroupe(groupe),
        solved: groupe.resolu,
      }));
    }
    zoneJeu.append(liste);
  }

  /* ------------------------------------------------------------------- Saisie */

  function saisir(lettre) {
    if (termine || !actif) return;
    const c = actif.groupe.cases[actif.index];
    if (!c || numerosOfferts.has(c.numero)) return;

    // Propagation immédiate : la lettre vaut pour toutes les cases du même
    // numéro, phrase cachée comprise (§17.1).
    pose[c.numero] = lettre;
    onLetterInput?.({ numero: c.numero, lettre, alphabetState: { ...pose } });

    avancerCurseur();
    rendre();
    verifierGroupes();
  }

  function effacer() {
    if (termine || !actif) return;
    const c = actif.groupe.cases[actif.index];
    if (!c || verrouilles().has(c.numero)) return;

    delete pose[c.numero];
    onLetterInput?.({ numero: c.numero, lettre: null, alphabetState: { ...pose } });
    rendre();
  }

  /** §17.1 — case vide suivante du même mot, sinon premier mot non résolu. */
  function avancerCurseur() {
    const { groupe } = actif;
    const suite = groupe.cases.findIndex((c, i) => i > actif.index && !pose[c.numero]);
    if (suite !== -1) {
      actif = { groupe, index: suite };
      return;
    }
    const prochain = premierGroupeNonResolu();
    actif = prochain ? { groupe: prochain, index: Math.max(premiereVide(prochain), 0) } : null;
  }

  /* --------------------------------------------------------------- Validation */

  /** §17.2 — on ne valide qu'un groupe entièrement rempli. */
  function verifierGroupes() {
    for (const groupe of groupesMots) {
      if (groupe.resolu) continue;
      if (groupe.cases.some((c) => !pose[c.numero])) continue;
      trancher(groupe, groupe.mot.en.toUpperCase());
    }

    if (!phrase.resolu && phrase.cases.every((c) => pose[c.numero])) {
      trancher(phrase, phrase.cases.map((c) => c.lettre).join(""));
    }
  }

  function trancher(groupe, attendu) {
    const propose = groupe.cases.map((c) => pose[c.numero]).join("");

    if (propose === attendu) {
      groupe.resolu = true;
      if (actif?.groupe === groupe) {
        const prochain = premierGroupeNonResolu();
        actif = prochain ? { groupe: prochain, index: Math.max(premiereVide(prochain), 0) } : null;
      }
      rendre();
      verifierFin();
      return;
    }

    // §17.7 — rouge 600 ms, secousse, vibration.
    const fautives = groupe.cases.map((c) => c.numero);
    enErreur = new Set(fautives);
    navigator.vibrate?.(30);
    rendre();
    el.querySelectorAll(".tile--error").forEach((t) => t.classList.add("tile--shake"));

    setTimeout(() => {
      enErreur = new Set();
      // §17.2 — on n'efface que ce que l'utilisateur a saisi. Les lettres
      // offertes et celles venant d'un mot déjà validé restent.
      const garder = verrouilles();
      for (const numero of fautives) {
        if (!garder.has(numero)) delete pose[numero];
      }
      onLetterInput?.({ numero: null, lettre: null, alphabetState: { ...pose } });
      if (!actif) placerCurseurInitial();
      rendre();
    }, DUREE_ERREUR);
  }

  function verifierFin() {
    if (termine) return;
    if (!groupesMots.every((g) => g.resolu) || !phrase.resolu) return;
    termine = true;
    setTimeout(() => onComplete?.(), DUREE_FIN);
  }

  /* ------------------------------------------------- Tap-to-translate (§3.5) */

  function ouvrirTraduction(segment, element) {
    zonePopover.replaceChildren(TranslationPopover({
      word: segment.txt,
      translation: segment.trad,
      alreadyKnown: Boolean(segment.connu),
      canAdd: !segment.connu && ajouts < AJOUTS_MAX,
      onAdd: () => {
        // Consulter est gratuit ; ajouter est délibéré, et plafonné (§3.5).
        if (ajouts >= AJOUTS_MAX) return;
        ajouts += 1;
        onAddWord?.(segment);
        zonePopover.replaceChildren();
      },
      onClose: () => zonePopover.replaceChildren(),
    }));
    element?.scrollIntoView?.({ block: "nearest" });
  }

  placerCurseurInitial();
  rendre();
  return el;
}
