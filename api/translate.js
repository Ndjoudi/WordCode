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

async function gemini(system, user, { temperature = 0.1, maxOutputTokens = 2048 } = {}) {
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
  const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return JSON.parse(txt.replace(/```json|```/g, "").trim());
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
    const out = await gemini(HISTOIRE_PROMPT, demande,
                             { temperature: 0.9, maxOutputTokens: 4096 });

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
