// api/translate.js — fonction serverless Vercel
// Unique point d'appel réseau de WordCode.
// Variable d'environnement requise : GEMINI_API_KEY

const MODEL = "gemini-2.0-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT = `Tu es un lexicographe anglais-français. Tu analyses une phrase ou un mot anglais fourni par un apprenant francophone.

RÈGLES ABSOLUES
1. Tu réponds UNIQUEMENT par un objet JSON valide. Aucun texte avant, aucun texte après, aucun bloc markdown, aucune backtick.
2. Tu traduis chaque mot DANS SON CONTEXTE, jamais son sens de dictionnaire le plus courant. "He ran a company" -> "run" = "diriger", pas "courir".
3. Tu ignores les mots-outils : articles, prépositions, pronoms, auxiliaires, conjonctions. Ils ne doivent PAS apparaître dans "mots".
4. Si un verbe est suivi d'une particule et forme un phrasal verb ("give up", "look for"), tu traites l'ENSEMBLE comme une seule entrée et tu mets "phrasal": true.
5. Tu n'inventes jamais une phonétique. Si tu n'es pas sûr, tu mets null.
6. "confiance" est ton estimation honnête entre 0 et 1. En dessous de 0.8, tu mets "ambigu": true.
7. "ambigu" est true si le mot a plusieurs sens fréquents et que le contexte ne tranche pas clairement.
8. "rang_freq" est une estimation du rang de fréquence du mot en anglais courant (1 = le plus fréquent, jusqu'à ~20000). Si tu ne sais pas, mets null.

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
      "def_en": "<définition anglaise très simple, max 8 mots>",
      "rang_freq": <entier ou null>,
      "phrasal": <true|false>,
      "ambigu": <true|false>,
      "confiance": <nombre entre 0 et 1>
    }
  ]
}

EXEMPLE D'ENTRÉE
She was reluctant to give up her seat.

EXEMPLE DE SORTIE
{"phrase_en":"She was reluctant to give up her seat.","phrase_fr":"Elle était réticente à céder sa place.","mots":[{"en":"reluctant","fr":"réticent","type":"adj","phonetique":"/rɪˈlʌk.tənt/","def_en":"not willing to do something","rang_freq":2847,"phrasal":false,"ambigu":false,"confiance":0.96},{"en":"give up","fr":"céder","type":"phrasal","phonetique":null,"def_en":"to stop keeping something","rang_freq":900,"phrasal":true,"ambigu":true,"confiance":0.74},{"en":"seat","fr":"place","type":"n","phonetique":"/siːt/","def_en":"a place where you sit","rang_freq":1450,"phrasal":false,"ambigu":false,"confiance":0.93}]}`;

const RETRO_PROMPT = `Tu es traducteur français-anglais. On te donne une liste de traductions françaises. Pour chacune, donne le mot ou groupe anglais le plus probable, hors contexte.

Réponds UNIQUEMENT par un tableau JSON de chaînes, dans le même ordre, sans texte autour.

Entrée : ["réticent","céder","place"]
Sortie : ["reluctant","to give up","place"]`;

async function gemini(system, user) {
  const res = await fetch(`${ENDPOINT}?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return JSON.parse(txt.replace(/```json|```/g, "").trim());
}

function normaliser(s) {
  return String(s).trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/^to /, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const texte = (req.body?.texte ?? "").toString().trim();
  if (!texte) return res.status(400).json({ error: "texte manquant" });
  if (texte.length > 400) return res.status(400).json({ error: "texte trop long" });

  try {
    const out = await gemini(SYSTEM_PROMPT, texte);

    // Garde-fou : rétro-traduction FR -> EN
    if (Array.isArray(out.mots) && out.mots.length) {
      try {
        const retro = await gemini(
          RETRO_PROMPT,
          JSON.stringify(out.mots.map((m) => m.fr))
        );
        out.mots.forEach((m, i) => {
          const attendu = normaliser(m.en);
          const obtenu = normaliser(retro[i] ?? "");
          m.retro = retro[i] ?? null;
          if (obtenu !== attendu) {
            m.ambigu = true;
            m.confiance = Math.min(m.confiance ?? 1, 0.6);
          }
        });
      } catch {
        /* la rétro-traduction est un bonus : son échec n'invalide rien */
      }
    }

    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "traduction indisponible" });
  }
}
