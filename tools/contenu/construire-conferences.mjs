/**
 * Construit content/conferences.json : les conférences TED que la section
 * Vidéo propose d'elle-même (§09), chacune avec son palier conseillé.
 *
 * 1. La liste vient de l'API GraphQL publique de TED : titre, orateur, durée,
 *    nombre de vues. On garde les conférences de 3 à 18 minutes, les plus
 *    regardées d'abord.
 * 2. Chaque nouvelle conférence est lue UNE fois, ici, pour mesurer son
 *    vocabulaire : le palier conseillé est le premier palier à partir duquel
 *    95 % de ses mots sont au catalogue.
 * 3. Seules les métadonnées sont écrites. La transcription n'est jamais
 *    conservée : licence CC BY-NC-ND, usage personnel (§09).
 *
 * L'outil est incrémental : une conférence déjà mesurée, ou déjà écartée
 * (conferences-rejets.json), n'est pas relue.
 *
 * Usage : node tools/contenu/construire-conferences.mjs [--taille 300]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { OUTILS, OUTILS_ORAUX, basesOrales, formeNue, chargerCatalogue } from "./lexique.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, "..", "..");
const SORTIE = join(RACINE, "content", "conferences.json");
const REJETS = join(ICI, "conferences-rejets.json");

/** Part des mots à connaître pour suivre une conférence (Nation : 95 %). */
export const SEUIL = 0.95;

/** Bornes de durée, en secondes : assez pour un quizz, pas plus qu'un TED. */
const DUREE_MIN = 180;
const DUREE_MAX = 1080;

/** Une conférence presque muette (beatbox, musique) ne se mesure pas. */
const MOTS_MIN = 300;

/** Les formats TED retenus ; « Best of Web » renvoie à des vidéos externes. */
const TYPES = new Set(["TED Stage Talk", "TEDx Talk", "TED Institute Talk",
  "TED Salon Talk (partner)", "Original Content", "TED-Ed Original"]);

/** Pause entre deux pages TED : on lit, on ne moissonne pas. */
const PAUSE_MS = 800;

const AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function lire(url, options = {}) {
  const arret = new AbortController();
  const minuteur = setTimeout(() => arret.abort(), 30000);
  try {
    const res = await fetch(url, {
      ...options,
      headers: { "User-Agent": AGENT, "Accept-Language": "en", ...(options.headers ?? {}) },
      signal: arret.signal,
    });
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Toutes les conférences de TED, page par page (50 par page, l'API n'en
 * rend pas plus). L'API ne sait ni trier ni filtrer : on le fait ici.
 */
async function listerConferences() {
  const requete = `query($after: String) { videos(first: 50, after: $after) {
    nodes { slug title duration presenterDisplayName viewedCount publishedAt
            type { name } topics { nodes { name } } }
    pageInfo { endCursor hasNextPage } } }`;
  const toutes = [];
  let apres = null;
  for (;;) {
    const brut = await lire("https://www.ted.com/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: requete, variables: { after: apres } }),
    });
    const donnees = JSON.parse(brut);
    if (donnees.errors) throw new Error(donnees.errors[0]?.message ?? "API TED");
    const page = donnees.data.videos;
    toutes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    apres = page.pageInfo.endCursor;
    await attendre(300);
  }
  return toutes;
}

/**
 * Texte d'une conférence et présence d'une vidéo lisible.
 * Même lecture que le serveur (api/translate.js) : la page de transcription
 * embarque les sous-titres horodatés dans ses données Next.js.
 */
export async function lireTranscription(slug) {
  const html = await lire(`https://www.ted.com/talks/${slug}/transcript?language=en`);
  const m = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { texte: "", video: false };
  const donnees = JSON.parse(m[1]);

  const cues = [];
  (function collecte(o, p = 0) {
    if (p > 12 || !o || typeof o !== "object") return;
    if (Array.isArray(o.cues)) for (const c of o.cues) if (c?.text !== undefined) cues.push(c.text);
    for (const v of Array.isArray(o) ? o : Object.values(o)) collecte(v, p + 1);
  })(donnees);

  const vd = donnees?.props?.pageProps?.videoData ?? {};
  const video = Boolean(vd.hlsUrl ?? vd.videoPlayerData?.resources?.hls?.stream
                        ?? vd.videoPlayerData?.resources?.h264?.[0]?.file);
  return { texte: cues.join(" "), video };
}

const outil = (mot) => OUTILS.has(mot) || OUTILS_ORAUX.has(mot);

/**
 * Palier d'un mot nu : 0 pour un mot-outil, celui de son lemme sinon.
 * Deux niveaux de flexion : « feelings » → « feeling » → « feel ».
 * @returns {number|undefined}
 */
export function palierDe(nu, catalogue) {
  if (outil(nu)) return 0;
  if (catalogue.has(nu)) return catalogue.get(nu).palier;
  const niveau1 = basesOrales(nu).filter((b) => b.length >= 2);
  const niveau2 = niveau1.flatMap((b) => basesOrales(b)).filter((b) => b.length >= 3);
  for (const base of [...niveau1, ...niveau2]) {
    if (outil(base)) return 0;
    if (catalogue.has(base)) return catalogue.get(base).palier;
  }
  return undefined;
}

/**
 * Mesure le vocabulaire d'un texte oral.
 *
 * Chaque mot compte pour le palier de son lemme ; les mots-outils comptent
 * pour connus (palier 0). Les noms propres — une majuscule et rien au
 * catalogue — et les nombres sortent du compte : ils ne s'apprennent pas.
 *
 * @param {string} texte
 * @param {Map<string,{palier:number}>} catalogue
 * @returns {{palier:?number, couverture:number, mots:number}}
 *   palier : premier palier où SEUIL des mots sont connus, null si jamais
 *   couverture : part des mots connus avec tout le catalogue, en %
 */
export function mesurer(texte, catalogue) {
  const propre = String(texte)
    .replace(/\([^)]*\)/g, " ")          // (Laughter), (Applause)
    .replace(/♫[^♫]*♫?/g, " ");         // paroles chantées
  const paliers = [];

  for (const jeton of propre.split(/[\s\-–—/]+/)) {
    if (!jeton || /\d/.test(jeton)) continue;
    const nu = formeNue(jeton);
    if (!nu) continue;
    const palier = palierDe(nu, catalogue);
    if (palier !== undefined) { paliers.push(palier); continue; }
    if (/^[A-Z]/.test(jeton.replace(/^[^A-Za-z]+/, ""))) continue;   // nom propre
    paliers.push(Infinity);
  }

  if (!paliers.length) return { palier: null, couverture: 0, mots: 0 };
  paliers.sort((a, b) => a - b);
  const rang = Math.ceil(SEUIL * paliers.length) - 1;
  const palier = Number.isFinite(paliers[rang]) ? Math.max(1, paliers[rang]) : null;
  const connus = paliers.filter(Number.isFinite).length;
  return { palier, couverture: Math.round((connus / paliers.length) * 1000) / 10, mots: paliers.length };
}

const lireJSON = (chemin, defaut) => existsSync(chemin) ? JSON.parse(readFileSync(chemin, "utf8")) : defaut;

async function principal() {
  const i = process.argv.indexOf("--taille");
  const taille = i > 0 ? Number(process.argv[i + 1]) : 300;

  const catalogue = chargerCatalogue(RACINE);
  const existant = lireJSON(SORTIE, { conferences: [] }).conferences;
  const rejets = lireJSON(REJETS, {});
  const connues = new Map(existant.map((c) => [c.slug, c]));

  console.log("Liste des conférences TED…");
  const candidates = (await listerConferences())
    .filter((c) => TYPES.has(c.type?.name)
                && c.duration >= DUREE_MIN && c.duration <= DUREE_MAX)
    .sort((a, b) => (b.viewedCount ?? 0) - (a.viewedCount ?? 0));
  console.log(`${candidates.length} conférences de 3 à 18 min`);

  let lues = 0;
  for (const c of candidates) {
    if (connues.size >= taille) break;
    if (connues.has(c.slug) || rejets[c.slug]) continue;

    let lu;
    try {
      lu = await lireTranscription(c.slug);
    } catch (e) {
      // Une panne réseau n'est pas un verdict : on retentera la prochaine fois.
      console.log(`  ! ${c.slug} : ${e.message}`);
      await attendre(PAUSE_MS);
      continue;
    }
    lues += 1;
    await attendre(PAUSE_MS);

    const mesure = mesurer(lu.texte, catalogue);
    const raison = !lu.video ? "pas de vidéo"
      : mesure.mots < MOTS_MIN ? `${mesure.mots} mots seulement`
      : mesure.palier === null ? `couverture ${mesure.couverture} % : trop de mots hors catalogue`
      : null;
    if (raison) { rejets[c.slug] = raison; continue; }

    connues.set(c.slug, {
      slug: c.slug,
      titre: c.title,
      orateur: c.presenterDisplayName ?? null,
      duree: c.duration,
      vues: c.viewedCount ?? 0,
      publie: c.publishedAt?.slice(0, 10) ?? null,
      themes: (c.topics?.nodes ?? []).slice(0, 3).map((t) => t.name),
      palier: mesure.palier,
      couverture: mesure.couverture,
    });
    if (lues % 20 === 0) console.log(`  ${connues.size} retenues · ${Object.keys(rejets).length} écartées`);
  }

  const conferences = [...connues.values()]
    .sort((a, b) => a.palier - b.palier || b.vues - a.vues);
  writeFileSync(SORTIE, JSON.stringify({
    version: 1,
    seuil: SEUIL,
    licence: "Métadonnées seulement — conférences TED sous CC BY-NC-ND 4.0",
    conferences,
  }, null, 2) + "\n");
  writeFileSync(REJETS, JSON.stringify(rejets, null, 2) + "\n");

  const manifeste = JSON.parse(readFileSync(join(RACINE, "content", "manifest.json"), "utf8"));
  if (!manifeste.conferences) {
    manifeste.conferences = "conferences.json";
    writeFileSync(join(RACINE, "content", "manifest.json"), JSON.stringify(manifeste, null, 2) + "\n");
  }

  console.log(`\n${conferences.length} conférences au catalogue · ${lues} lues cette fois · `
    + `${Object.keys(rejets).length} écartées en tout`);
  const tranches = [[1, 20], [21, 38], [39, 104], [105, 201]];
  for (const [de, a] of tranches) {
    const n = conferences.filter((c) => c.palier >= de && c.palier <= a).length;
    console.log(`  paliers ${de}–${a} : ${n}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) principal();
