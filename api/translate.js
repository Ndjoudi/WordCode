// api/translate.js — fonction serverless Vercel
// Unique point d'appel réseau de WordCode.
// Variable d'environnement requise : GEMINI_API_KEY

const MODEL = "gemini-3.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT = `Tu es un lexicographe anglais-français. Tu analyses une phrase ou un mot anglais fourni par un apprenant francophone.

RÈGLES ABSOLUES
1. Tu réponds UNIQUEMENT par un objet JSON valide. Aucun texte avant, aucun texte après, aucun bloc markdown, aucune backtick.
2. Tu traduis chaque mot DANS SON CONTEXTE, jamais son sens de dictionnaire le plus courant. "He ran a company" -> "run" = "diriger", pas "courir".
3. Tu ignores les mots-outils : articles, prépositions, pronoms, auxiliaires, conjonctions. Ils ne doivent PAS apparaître dans "mots".
4. Si un verbe est suivi d'une particule et forme un phrasal verb ("give up", "look for"), tu traites l'ENSEMBLE comme une seule entrée de type "phrasal".
5. Tu n'inventes jamais une phonétique. Si tu n'es pas sûr, tu mets null.
6. "ambigu" : avant de l'écrire, retraduis mentalement ta traduction française vers l'anglais, HORS CONTEXTE. Si tu ne retombes pas sur le mot d'origine, ou si le mot a plusieurs sens fréquents que le contexte ne tranche pas, tu mets true.
7. "rang_freq" est une estimation du rang de fréquence du mot en anglais courant (1 = le plus fréquent, jusqu'à ~20000). Si tu ne sais pas, mets null.
8. Tu n'ajoutes AUCUN champ en dehors de ceux du format. Chaque champ superflu rallonge la réponse et fait attendre l'utilisateur.

TYPES AUTORISÉS : "n", "v", "adj", "adv", "phrasal", "expr"

FORMAT DE SORTIE
{
  "phrase_en": "<la phrase d'origine, nettoyée>",
  "phrase_fr": "<traduction naturelle de la phrase entière>",
  "mots": [
    {
      "en": "<le mot ou le groupe, en minuscules, forme de base>",
      "fr": "<traduction contextuelle, 1 à 3 mots>",
      "type": "<n|v|adj|adv|phrasal|expr>",
      "phonetique": "<IPA entre slashes, ou null>",
      "rang_freq": <entier ou null>,
      "ambigu": <true|false>
    }
  ]
}

EXEMPLE D'ENTRÉE
She was reluctant to give up her seat.

EXEMPLE DE SORTIE
{"phrase_en":"She was reluctant to give up her seat.","phrase_fr":"Elle était réticente à céder sa place.","mots":[{"en":"reluctant","fr":"réticent","type":"adj","phonetique":"/rɪˈlʌk.tənt/","rang_freq":2847,"ambigu":false},{"en":"give up","fr":"céder","type":"phrasal","phonetique":null,"rang_freq":900,"ambigu":true},{"en":"seat","fr":"place","type":"n","phonetique":"/siːt/","rang_freq":1450,"ambigu":false}]}`;

const HISTOIRE_PROMPT = `Tu écris une histoire courte en anglais pour un francophone qui apprend la langue.

On te donne la liste EXACTE des mots qu'il connaît. C'est la seule contrainte qui compte : une histoire pleine de mots qu'il n'a jamais vus ne lui sert à rien.

RÈGLES ABSOLUES
1. Tu réponds UNIQUEMENT par un objet JSON valide. Aucun texte avant, aucun texte après, aucun bloc markdown, aucune backtick.
2. Tu n'emploies QUE les mots de "mots_connus", leurs formes fléchies (pluriels, prétérits, participes), et les mots-outils : articles, prépositions, pronoms, auxiliaires, conjonctions, nombres.
3. Si un mot hors de cette liste est vraiment indispensable, tu l'utilises et tu l'inscris dans "hors_lexique". Cette liste doit rester la plus courte possible : au-delà de cinq mots, réécris plutôt la phrase.
4. Les prénoms que tu inventes ne comptent pas comme des mots hors lexique et n'y figurent pas.
5. "texte_en" fait entre 250 et 350 mots. En dessous il n'y a pas d'histoire, au-dessus la lecture décourage.
6. Phrases courtes, temps simples, un seul fil narratif. Tu écris pour un débutant, pas pour un jury.
7. C'est une HISTOIRE : quelqu'un veut quelque chose, quelque chose l'en empêche, et ça se termine. Ce n'est ni une description ni une liste.
8. "texte_fr" est la traduction française fidèle de "texte_en", phrase pour phrase, dans un français naturel.
9. Si "suite_de" n'est pas null, tu écris la SUITE de cette histoire, avec les mêmes personnages. Sinon tu en commences une nouvelle.
10. Tu sépares les paragraphes par une ligne vide, dans les deux langues.

FORMAT DE SORTIE
{
  "titre_en": "<titre court en anglais>",
  "titre_fr": "<sa traduction>",
  "texte_en": "<l'histoire, 250 à 350 mots>",
  "texte_fr": "<la traduction française>",
  "hors_lexique": ["<mot employé hors de la liste>"]
}`;

const REDACTION_PROMPT = `Tu corriges la rédaction d'un francophone qui apprend l'anglais.

RÈGLES ABSOLUES
1. Tu réponds UNIQUEMENT par un objet JSON valide. Aucun texte avant ou après, aucun bloc markdown.
2. "corrige" est le texte réécrit en anglais correct. Tu gardes les idées, les phrases et le niveau de l'auteur : tu corriges, tu ne réécris pas mieux.
3. Tu ne remplaces jamais un mot juste par un mot plus rare. L'auteur apprend, il doit se reconnaître dans le texte corrigé.
4. "remarques" liste au plus cinq corrections qui valent une explication. Chacune : ce qui était écrit, ce qu'il faut écrire, et pourquoi, EN FRANÇAIS et en une phrase.
5. Tu ignores la ponctuation et les majuscules sauf si elles changent le sens.
6. "reussi" est ce que l'auteur a fait de bien, en une phrase, en français. Il y a toujours quelque chose.

Format :
{"corrige":"<le texte corrigé>","remarques":[{"ecrit":"<extrait fautif>","correct":"<la forme juste>","pourquoi":"<explication en français, une phrase>"}],"reussi":"<une phrase en français>"}`;

/**
 * Décrit la clé reçue par CE déploiement, sans jamais en révéler la valeur.
 *
 * Une clé absente, entourée de guillemets ou d'espaces, ou qui n'est pas une
 * clé Gemini donne chez Google exactement la même erreur (400 API_KEY_INVALID).
 * Seule la fonction voit ce qu'elle a reçu : c'est à elle de le dire.
 * Rien d'autre que la longueur et le préfixe public « AIza » n'est exposé.
 *
 * @param {string|undefined} cle
 * @returns {string}
 */
function etatCle(cle = process.env.GEMINI_API_KEY) {
  if (cle === undefined) return "absente : aucune variable GEMINI_API_KEY dans ce déploiement";
  if (!cle.trim()) return "présente mais vide";
  const defauts = [];
  if (cle !== cle.trim()) defauts.push("espaces autour");
  const nue = cle.trim();
  if (/^["']|["']$/.test(nue)) defauts.push("guillemets autour");
  if (!nue.replace(/^["']|["']$/g, "").startsWith("AIza")) defauts.push("ne commence pas par AIza");
  return `présente, ${cle.length} caractères${defauts.length ? ` — ${defauts.join(", ")}` : ", format correct"}`;
}

async function gemini(system, user, { temperature = 0.1, maxOutputTokens = 2048,
                                      thinkingLevel = null } = {}) {
  const res = await fetch(`${ENDPOINT}?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature,
        maxOutputTokens,
        responseMimeType: "application/json",
        // Le modèle consomme le budget de sortie pour « réfléchir » AVANT
        // d'écrire : mesuré en production, 7860 jetons de réflexion sur 8192
        // ne laissaient que 316 jetons pour le texte, d'où un JSON coupé net.
        //
        // On borne donc la réflexion par `thinkingLevel`, et non par
        // `thinkingBudget` : la référence de l'API réserve le second aux
        // modèles antérieurs et recommande le premier à partir de Gemini 3,
        // ce qu'est gemini-3.5-flash. Valeurs admises : MINIMAL, LOW, MEDIUM,
        // HIGH — « MINIMAL » signifie « little to no thinking ».
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
      },
    }),
  });
  if (!res.ok) {
    // Google explique toujours son refus (API_KEY_INVALID, PERMISSION_DENIED,
    // RESOURCE_EXHAUSTED…). Le jeter revenait à ne garder que « 400 ».
    let raison = "";
    try {
      const corps = await res.json();
      raison = corps?.error?.details?.find((d) => d?.reason)?.reason
        ?? corps?.error?.status ?? "";
    } catch { /* corps illisible : le code HTTP suffira */ }
    throw new Error(`Gemini ${res.status}${raison ? ` ${raison}` : ""}`);
  }
  const data = await res.json();
  const candidat = data?.candidates?.[0];
  // Les modèles récents peuvent renvoyer plusieurs parts (réflexion puis
  // réponse) : ne lire que la première tronquait le JSON.
  const txt = (candidat?.content?.parts ?? []).map((p) => p?.text ?? "").join("");

  try {
    return JSON.parse(txt.replace(/```json|```/g, "").trim());
  } catch {
    // « Unterminated string » ne dit rien d'exploitable. Ce qui compte, c'est
    // POURQUOI le texte est incomplet : budget de sortie épuisé, filtre de
    // sécurité, ou réponse vide.
    const u = data?.usageMetadata ?? {};
    const fin = candidat?.finishReason ?? "inconnu";
    const reflexion = u.thoughtsTokenCount ? `, dont ${u.thoughtsTokenCount} de réflexion` : "";
    // Sans un morceau du texte reçu, « illisible » ne se diagnostique pas :
    // on ne sait pas si le modèle a renvoyé du JSON malformé, un refus, ou
    // rien du tout. L'extrait est du texte d'histoire, il n'expose aucun secret.
    const extrait = txt.slice(0, 220).replace(/\s+/g, " ").trim() || "(réponse vide)";
    throw new Error(`réponse illisible — finishReason ${fin}, `
      + `${u.candidatesTokenCount ?? "?"} jetons produits${reflexion} sur ${maxOutputTokens} autorisés `
      + `— reçu : ${extrait}`);
  }
}


export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  // Second contrat (README §16) : génération d'une histoire du jour. Il ne
  // partage avec la traduction que le transport et la clé.
  if (req.body?.type === "histoire") return histoire(req, res);
  if (req.body?.type === "redaction") return redaction(req, res);
  if (req.body?.type === "transcription") return transcription(req, res);

  const texte = (req.body?.texte ?? "").toString().trim();
  if (!texte) return res.status(400).json({ error: "texte manquant" });
  if (texte.length > 400) return res.status(400).json({ error: "texte trop long" });

  try {
    // UN SEUL appel. La vérification de sens (ex-rétro-traduction) est
    // demandée dans le même passage : deux appels séquentiels doublaient le
    // temps de réponse pour ne poser qu'un booléen.
    const out = await gemini(SYSTEM_PROMPT, texte, { maxOutputTokens: 1024 });

    return res.status(200).json(out);
  } catch (e) {
    // Le client ne lit que le statut 502 ; `cause` et `cle` servent au
    // diagnostic, sans rien révéler de la clé elle-même.
    return res.status(502).json({ error: "traduction indisponible",
                                  cause: String(e?.message ?? e), cle: etatCle() });
  }
}

/**
 * Génération d'une histoire du jour (README §16, §6.5).
 *
 * Le texte est écrit à partir des seuls mots que le lecteur connaît. On ne
 * fait confiance ni à la longueur ni au lexique annoncés : le client
 * revérifie les deux avant d'afficher quoi que ce soit.
 */
async function histoire(req, res) {
  const mots = Array.isArray(req.body?.mots) ? req.body.mots : [];
  if (mots.length < 40) return res.status(400).json({ error: "lexique trop maigre" });
  if (mots.length > 1500) return res.status(400).json({ error: "lexique trop large" });

  // On demande la longueur voulue, sans compensation : gonfler la cible de 40
  // mots n'a produit aucun décalage mesurable (248/256 en demandant 300, puis
  // 244/267 en demandant 340). Le modèle ne suit pas cette consigne ; c'est le
  // client qui tolère à partir de 220 mots (§16).
  const longueur = Math.min(Math.max(Number(req.body?.longueur) || 300, 250), 350);
  const arc = req.body?.arc ?? null;

  const demande = JSON.stringify({
    mots_connus: mots,
    longueur_cible: longueur,
    suite_de: arc?.resume_en ?? null,
  });

  try {
    // Une histoire demande de l'invention : température plus haute que pour
    // une traduction, et de la place pour deux versions du texte.
    // Deux textes de 300 mots, plus la réflexion éventuelle du modèle :
    // 4096 jetons ne suffisaient pas, la réponse revenait coupée en plein
    // milieu d'une chaîne JSON.
    const out = await gemini(HISTOIRE_PROMPT, demande,
                             { temperature: 0.9, maxOutputTokens: 8192,
                               thinkingLevel: "MINIMAL" });

    if (!out?.texte_en) return res.status(502).json({ error: "réponse sans texte" });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: String(e?.message ?? e) });
  }
}

/**
 * Correction d'une rédaction libre (README §16, §08).
 *
 * On ne renvoie aucune note : une rédaction ne se met pas en boîte. Le service
 * rend le texte corrigé, au plus cinq remarques expliquées en français, et ce
 * qui a été réussi — parce qu'un apprenant qui ne lit que ses fautes arrête.
 */
async function redaction(req, res) {
  const texte = (req.body?.texte ?? "").toString().trim();
  if (!texte) return res.status(400).json({ error: "texte manquant" });
  if (texte.length > 3000) return res.status(400).json({ error: "texte trop long" });

  const demande = JSON.stringify({
    consigne: (req.body?.consigne ?? "").toString().slice(0, 200),
    mots_imposes: Array.isArray(req.body?.mots) ? req.body.mots.slice(0, 10) : [],
    texte,
  });

  try {
    const out = await gemini(REDACTION_PROMPT, demande,
                             { temperature: 0.2, maxOutputTokens: 2048 });
    if (!out?.corrige) return res.status(502).json({ error: "réponse sans correction" });
    return res.status(200).json({
      corrige: out.corrige,
      remarques: Array.isArray(out.remarques) ? out.remarques.slice(0, 5) : [],
      reussi: out.reussi ?? null,
    });
  } catch (e) {
    return res.status(502).json({ error: String(e?.message ?? e) });
  }
}

/* -------------------------------------------------------------------------- */
/* Transcription d'une conférence TED (README §16, §10)                        */
/* -------------------------------------------------------------------------- */

/**
 * Un navigateur sans en-tête d'agent se fait souvent éconduire.
 */
const AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Au-delà, on abandonne : TED répond en deux secondes quand il répond. */
const DELAI_TED_MS = 20000;

/**
 * Bornes d'une phrase reconstituée, en mots.
 *
 * Au-delà du maximum, la remise en ordre devient infaisable et l'écriture
 * décourageante. En dessous du minimum — « Anyone? » — il n'y a rien à
 * remettre dans l'ordre : la phrase est fusionnée avec sa voisine.
 */
const MOTS_MAX_PHRASE = 16;
const MOTS_MIN_PHRASE = 3;

const compterMots = (texte) => String(texte).trim().split(/\s+/).filter(Boolean).length;

async function lirePage(url) {
  const arret = new AbortController();
  const minuteur = setTimeout(() => arret.abort(), DELAI_TED_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": AGENT, "Accept-Language": "en" },
      redirect: "follow",
      signal: arret.signal,
    });
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Retire le générique TED du flux HLS.
 *
 * `hlsUrl` porte `?intro_master_id=…`, qui préfixe 3,5 s de générique au flux
 * (mesuré : kelly 855,18 s avec contre 851,68 s sans ; yat_siu 647,40 contre
 * 643,89 — un segment de plus dans les deux cas).
 *
 * Or les horodatages du transcript sont écrits SANS ce générique : la première
 * phrase commence à 0,84 s, ce qui serait impossible si le flux débutait par
 * 3,5 s d'habillage. Jouer la version « avec » faisait donc courir la vidéo
 * 3,5 s en retard sur la phrase affichée.
 *
 * Ne pas se fier à l'égalité des durées pour juger de l'alignement : le mp4
 * fait 855,2 s comme le flux AVEC générique, et c'est exactement ce qui m'avait
 * fait conclure, à tort, que tout était aligné.
 */
function sansGenerique(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.searchParams.delete("intro_master_id");
    return u.toString().replace(/\?$/, "");
  } catch {
    return url;
  }
}

/**
 * Le fichier répond-il vraiment ?
 *
 * TED publie des adresses mp4 qui rendent 403 (AccessDenied) : le fichier
 * existe dans la page mais n'est pas servi. Une requête HEAD tranche en une
 * fraction de seconde, et évite d'enregistrer une conférence injouable.
 */
async function lisible(url) {
  const arret = new AbortController();
  const minuteur = setTimeout(() => arret.abort(), 6000);
  try {
    const res = await fetch(url, { method: "HEAD", signal: arret.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(minuteur);
  }
}

/** Données Next.js embarquées dans une page TED. */
function donneesNext(html) {
  const m = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("page TED sans données exploitables");
  return JSON.parse(m[1]);
}

/**
 * Trouve le slug TED à partir de ce que l'utilisateur a collé.
 *
 * Trois entrées acceptées : une adresse ted.com, une adresse YouTube d'une
 * conférence TED, ou le slug seul. Pour YouTube on passe par le titre — c'est
 * le seul pont entre les deux sites, et il suffit : la recherche TED rend la
 * bonne conférence en premier résultat.
 */
export async function resoudreSlug(lien) {
  const brut = String(lien ?? "").trim();
  if (!brut) throw new Error("lien manquant");

  const ted = brut.match(/ted\.com\/talks\/([a-z0-9_]+)/i);
  if (ted) return ted[1];

  const yt = brut.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/);
  if (yt) {
    const oembed = await lirePage(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${yt[1]}&format=json`);
    const titre = JSON.parse(oembed).title ?? "";
    // « How to Make Stress Your Friend | Kelly McGonigal | TED » → on ne garde
    // que le titre, les segments après « | » sont l'orateur et la chaîne.
    const requete = titre.split("|")[0].trim();
    if (!requete) throw new Error("titre YouTube illisible");

    const recherche = await lirePage(
      `https://www.ted.com/search?q=${encodeURIComponent(requete)}`);
    const slug = recherche.match(/\/talks\/([a-z0-9_]{8,})/);
    if (!slug) throw new Error("aucune conférence TED ne correspond à cette vidéo");
    return slug[1];
  }

  if (/^[a-z0-9_]{8,}$/.test(brut)) return brut;
  throw new Error("lien non reconnu : attendu une adresse TED ou YouTube");
}

/**
 * Regroupe les blocs de sous-titres en PHRASES.
 *
 * Les cues de TED sont des lignes d'affichage, pas des phrases : « In the past
 * year, » et « I want you to just raise your hand » arrivent séparément. On
 * accumule donc jusqu'à une ponctuation finale, sans dépasser MOTS_MAX_PHRASE —
 * au-delà, la remise en ordre devient infaisable et l'écriture décourageante.
 *
 * @param {Array<{text:string, time:number}>} cues
 * @returns {Array<{debut:number, fin:number, texte:string}>}
 */
export function enPhrases(cues = []) {
  const phrases = [];
  let courant = null;
  const clore = () => { if (courant) { phrases.push(courant); courant = null; } };

  for (const cue of cues) {
    const texte = String(cue.text ?? "").replace(/\s*\n\s*/g, " ").trim();
    if (!texte) continue;
    const debut = Number(cue.time) / 1000;
    const mots = compterMots(texte);

    // On ferme AVANT d'ajouter un bloc qui ferait déborder : tester après
    // l'ajout laissait passer des phrases de 29 mots.
    if (courant && courant.mots + mots > MOTS_MAX_PHRASE) clore();

    if (!courant) courant = { debut, fin: debut, texte, mots };
    else { courant.texte += ` ${texte}`; courant.mots += mots; }

    if (/[.!?…]["')\]]?$/.test(courant.texte)) clore();
  }
  clore();

  // Une phrase trop courte n'offre aucun exercice : on la colle à sa voisine,
  // la suivante de préférence — c'est ainsi qu'on la lirait.
  for (let i = 0; i < phrases.length; i += 1) {
    if (compterMots(phrases[i].texte) >= MOTS_MIN_PHRASE) continue;
    const suiv = phrases[i + 1];
    const prec = phrases[i - 1];
    if (suiv && compterMots(`${phrases[i].texte} ${suiv.texte}`) <= MOTS_MAX_PHRASE) {
      suiv.texte = `${phrases[i].texte} ${suiv.texte}`;
      suiv.debut = phrases[i].debut;
      phrases.splice(i, 1); i -= 1;
    } else if (prec && compterMots(`${prec.texte} ${phrases[i].texte}`) <= MOTS_MAX_PHRASE) {
      prec.texte = `${prec.texte} ${phrases[i].texte}`;
      phrases.splice(i, 1); i -= 1;
    }
  }

  // La fin d'une phrase, c'est le début de la suivante : plus juste que toute
  // estimation, et c'est ce qui permet de lire pile un segment.
  for (let i = 0; i < phrases.length - 1; i += 1) phrases[i].fin = phrases[i + 1].debut;
  const derniere = phrases[phrases.length - 1];
  if (derniere) derniere.fin = derniere.debut + estimerDuree(derniere.texte);

  return phrases.map((p, i) => ({ i, debut: p.debut, fin: p.fin,
                                  texte: p.texte.replace(/\s+/g, " ").trim() }));
}

/** Repli quand aucune phrase ne suit : ~2,5 mots par seconde à l'oral. */
function estimerDuree(texte) {
  return Math.max(1.5, String(texte).split(/\s+/).length / 2.5);
}

/**
 * Récupère une conférence TED : ses phrases horodatées et son fichier vidéo.
 *
 * Aucun appel à Gemini ici — c'est une lecture de page. Le passage par le
 * serveur n'est pas un choix : ted.com n'envoie aucun en-tête CORS, le
 * navigateur ne peut pas le lire lui-même.
 */
async function transcription(req, res) {
  const lien = (req.body?.lien ?? "").toString().trim();
  if (!lien) return res.status(400).json({ error: "lien manquant" });
  if (lien.length > 300) return res.status(400).json({ error: "lien trop long" });

  try {
    const slug = await resoudreSlug(lien);
    const html = await lirePage(`https://www.ted.com/talks/${slug}/transcript?language=en`);
    const donnees = donneesNext(html);
    const brut = JSON.stringify(donnees);

    const cues = [];
    (function collecte(o, p = 0) {
      if (p > 12 || !o || typeof o !== "object") return;
      if (Array.isArray(o.cues)) {
        for (const c of o.cues) if (c && c.text !== undefined && c.time !== undefined) cues.push(c);
      }
      for (const v of Array.isArray(o) ? o : Object.values(o)) collecte(v, p + 1);
    })(donnees);

    if (!cues.length) return res.status(404).json({ error: "cette conférence n'a pas de transcription" });

    // Les adresses vivent à des chemins connus du JSON. Prendre le premier
    // ".mp4" du blob était fragile, et surtout muet sur l'existence du flux HLS.
    const vd = donnees?.props?.pageProps?.videoData ?? {};
    const mp4 = vd?.videoPlayerData?.resources?.h264?.[0]?.file ?? null;
    const hls = sansGenerique(vd?.hlsUrl ?? vd?.videoPlayerData?.resources?.hls?.stream);

    // Environ une conférence sur trois a son mp4 verrouillé chez TED (403
    // AccessDenied) alors que le HLS reste ouvert. Mieux vaut le constater ici
    // que laisser le navigateur échouer une fois la conférence enregistrée.
    const video = mp4 && (await lisible(mp4)) ? mp4 : null;
    const titre = (brut.match(/"title"\s*:\s*"([^"]{4,200})"/) ?? [])[1] ?? slug;
    const phrases = enPhrases(cues);

    return res.status(200).json({
      slug,
      titre,
      video,
      hls,
      // La durée du fichier fait foi : TED publie aussi celle de la version
      // YouTube, plus longue de son habillage, qui décalerait tout.
      duree: phrases.length ? phrases[phrases.length - 1].fin : null,
      phrases,
      source: `https://www.ted.com/talks/${slug}`,
      licence: "CC BY-NC-ND 4.0 — TED",
    });
  } catch (e) {
    // Un lien mal formé est une erreur de saisie, pas une panne de passerelle.
    const message = String(e?.message ?? e);
    const saisie = /lien non reconnu|titre YouTube|aucune conférence/.test(message);
    return res.status(saisie ? 400 : 502).json({ error: message });
  }
}
