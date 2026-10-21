/**
 * Les règles du contrôle de dérive des corpus figés, sans effet de bord.
 *
 * `check-amont.mjs` orchestre et affiche ; tout ce qui DÉCIDE vit ici, pour
 * qu'un test l'éprouve sans réseau (l'accès GitHub est injecté) et sur un
 * dossier jetable (le système de fichiers est le vrai).
 *
 * Deux formes de manifeste `AMONT.json` coexistent :
 *
 * - **ancrage de dossier** (`repo`, `ref`, `sha`, `fichiers`) : UN dépôt, un
 *   SHA pour tout le dossier, la dérive se lit sur le comparatif GitHub. C'est
 *   la forme des specs vivantes de `nodefony-rfc`.
 * - **ancrage par page** (`sources[].copies`, `untracked`) : chaque copie locale
 *   nomme son fichier source, le blob Git qu'elle reflète et l'empreinte de son
 *   propre contenu. Faite pour un corpus tiré de plusieurs dépôts — et de sites,
 *   dont la page rendue sort d'un fichier de dépôt qu'on suit à sa place.
 *
 * @module
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Nom du manifeste d'amont d'un dossier figé. */
export const MANIFEST = "AMONT.json";

/**
 * Plafond de fichiers du comparatif GitHub : au-delà, la liste est TRONQUÉE
 * sans le dire, et un fichier suivi peut y manquer.
 */
export const COMPARE_FILE_LIMIT = 300;

/**
 * Crée l'accès en lecture à l'API GitHub.
 *
 * @param fetchImpl - le `fetch` à employer (injecté par les tests)
 * @param token - jeton facultatif : desserre le quota anonyme
 * @returns `get(chemin)` → `{ status, body }` pour 200 et 404, `null` quand on
 *   ne SAIT pas (réseau, quota, erreur serveur)
 */
export function createGithubApi(fetchImpl = fetch, token) {
  const headers = { Accept: "application/vnd.github+json" };
  if (typeof token === "string" && token !== "") {
    headers.Authorization = `Bearer ${token}`;
  }
  return async function get(route) {
    try {
      const response = await fetchImpl(`https://api.github.com/${route}`, {
        headers,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 404) return { status: 404, body: null };
      if (!response.ok) return null;
      return { status: 200, body: await response.json() };
    } catch {
      return null;
    }
  };
}

/** Encode un chemin de dépôt segment par segment (les `/` restent). */
function encodeRepoPath(repoPath) {
  return repoPath.split("/").map(encodeURIComponent).join("/");
}

/**
 * Empreinte du contenu d'une copie locale, fins de ligne normalisées.
 *
 * La normalisation n'est pas une commodité : un poste Windows qui extrait le
 * dépôt en CRLF verrait sinon TOUTES les pages « modifiées ».
 *
 * @param file - chemin de la copie
 * @returns l'empreinte SHA-256 en hexadécimal
 */
export function contentFingerprint(file) {
  const text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Lit le manifeste d'un dossier figé.
 *
 * @param dir - le dossier
 * @returns le manifeste brut, ou `null` si le dossier n'en porte pas
 */
export function readManifest(dir) {
  const file = path.join(dir, MANIFEST);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Indique si un manifeste ancre ses pages une par une.
 *
 * @param manifest - manifeste brut
 * @returns `true` pour la forme `sources[].copies`
 */
export function isPerPage(manifest) {
  return Array.isArray(manifest?.sources);
}

/**
 * Les dossiers figés de tous les skills : chaque sous-dossier d'un `references/`.
 *
 * @param skillsRoot - la racine des skills (`.claude/skills`)
 * @returns `{ label, dir }` triés, `label` = `<skill>/<dossier>`
 */
export function findFrozenDirs(skillsRoot) {
  const found = [];
  if (!existsSync(skillsRoot)) return found;
  for (const skill of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!skill.isDirectory()) continue;
    const references = path.join(skillsRoot, skill.name, "references");
    if (!existsSync(references)) continue;
    for (const entry of readdirSync(references, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      found.push({
        label: `${skill.name}/${entry.name}`,
        dir: path.join(references, entry.name),
      });
    }
  }
  return found.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Contrôle HORS LIGNE d'un manifeste par page : chaque fichier du dossier est
 * déclaré, et chaque copie est encore celle qui a été figée.
 *
 * @param dir - le dossier figé
 * @param manifest - son manifeste par page
 * @returns les fautes, `{ file, problem }` — `problem` ∈ `modified` (contenu
 *   changé sans re-figer), `unpinned` (déclarée, jamais figée), `missing`
 *   (déclarée, absente), `undeclared` (présente, ni copie ni hors amont)
 */
export function checkLocalCopies(dir, manifest) {
  const faults = [];
  const declared = new Set(Object.keys(manifest.untracked ?? {}));
  for (const source of manifest.sources) {
    for (const [file, copy] of Object.entries(source.copies ?? {})) {
      declared.add(file);
      const local = path.join(dir, file);
      if (!existsSync(local)) {
        faults.push({ file, problem: "missing" });
      } else if (!copy.blob || !copy.sha256) {
        faults.push({ file, problem: "unpinned" });
      } else if (contentFingerprint(local) !== copy.sha256) {
        faults.push({ file, problem: "modified" });
      }
    }
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === MANIFEST) continue;
    if (!declared.has(entry.name)) {
      faults.push({ file: entry.name, problem: "undeclared" });
    }
  }
  return faults.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Dit si le fichier source d'une copie a changé en amont, par comparaison de
 * blobs : exact, quel que soit le nombre de commits ou de fichiers de l'écart.
 *
 * @param source - `{ repo, ref }`
 * @param copy - `{ path, blob }` tel que figé
 * @param get - accès GitHub (`createGithubApi`)
 * @returns `{ state }` — `fresh`, `drifted` (+ `since`, date du dernier
 *   changement, ou `null`), `removed` (introuvable en amont), `unknown`
 */
export async function copyDrift(source, copy, get) {
  const repoPath = encodeRepoPath(copy.path);
  const ref = encodeURIComponent(source.ref);
  const head = await get(
    `repos/${source.repo}/contents/${repoPath}?ref=${ref}`,
  );
  if (head === null) return { state: "unknown" };
  if (head.status === 404) return { state: "removed" };
  if (head.body?.sha === copy.blob) return { state: "fresh" };
  const last = await get(
    `repos/${source.repo}/commits?path=${repoPath}&sha=${ref}&per_page=1`,
  );
  const since = last?.body?.[0]?.commit?.committer?.date ?? null;
  return { state: "drifted", since };
}

/**
 * Dit si un dossier ancré à un SHA unique a dérivé sur ses fichiers suivis.
 *
 * @param anchor - `{ repo, ref, sha, fichiers }`
 * @param get - accès GitHub (`createGithubApi`)
 * @returns `{ state }` — `fresh` (+ `ahead`), `drifted` (+ `touched`, `url`),
 *   `unknown` — exact même quand le comparatif GitHub est tronqué
 */
export async function anchorDrift(anchor, get) {
  const head = await get(`repos/${anchor.repo}/commits/${anchor.ref}`);
  if (head === null || head.status !== 200) {
    return { state: "unknown", reason: "unreachable" };
  }
  if (head.body.sha === anchor.sha) return { state: "fresh", ahead: 0 };

  const gap = await get(
    `repos/${anchor.repo}/compare/${anchor.sha}...${head.body.sha}`,
  );
  if (gap === null || gap.status !== 200) {
    return { state: "unknown", reason: "compare" };
  }
  const files = gap.body.files ?? [];
  // Un comparatif plein est un comparatif TRONQUÉ : l'absence d'un fichier
  // suivi n'y prouve plus rien, et « à jour » serait un mensonge. On compare
  // alors les blobs des fichiers suivis, un par un, aux deux bouts de l'écart.
  if (files.length >= COMPARE_FILE_LIMIT) {
    return blobDrift(anchor, head.body.sha, gap.body, get);
  }
  const tracked = new Set(anchor.fichiers);
  const touched = files
    .filter((f) => tracked.has(f.filename) || tracked.has(f.previous_filename))
    .map((f) => (tracked.has(f.filename) ? f.filename : f.previous_filename));
  if (touched.length === 0) {
    return { state: "fresh", ahead: gap.body.ahead_by };
  }
  return { state: "drifted", touched, url: gap.body.html_url };
}

/** Blob d'un fichier à un commit : `undefined` s'il n'y existe pas, `null` si on ne sait pas. */
async function blobAt(repo, repoPath, sha, get) {
  const answer = await get(
    `repos/${repo}/contents/${encodeRepoPath(repoPath)}?ref=${sha}`,
  );
  if (answer === null) return null;
  return answer.status === 404 ? undefined : answer.body?.sha;
}

/** Dérive d'un ancrage de dossier, fichier par fichier, quand le comparatif est tronqué. */
async function blobDrift(anchor, headSha, gap, get) {
  const touched = [];
  for (const file of anchor.fichiers) {
    const before = await blobAt(anchor.repo, file, anchor.sha, get);
    const after = await blobAt(anchor.repo, file, headSha, get);
    if (before === null || after === null) {
      return { state: "unknown", reason: "unreachable" };
    }
    if (before !== after) touched.push(file);
  }
  if (touched.length === 0) return { state: "fresh", ahead: gap.ahead_by };
  return { state: "drifted", touched, url: gap.html_url };
}

/**
 * Fige une copie : relève le commit qui a touché son fichier source en dernier
 * (avant `until` s'il est donné), le blob qu'il porte, et l'empreinte locale.
 *
 * À n'employer qu'APRÈS avoir relu la copie : figer, c'est déclarer qu'elle
 * reflète fidèlement ce blob.
 *
 * @param source - `{ repo, ref }`
 * @param copy - `{ path }` au minimum
 * @param file - chemin de la copie locale
 * @param get - accès GitHub (`createGithubApi`)
 * @param until - date ISO facultative : l'état de l'amont à cette date
 * @returns la copie complétée (`commit`, `date`, `blob`, `sha256`)
 * @throws Quand l'amont ne répond pas ou ne connaît pas le fichier
 */
export async function pinCopy(source, copy, file, get, until) {
  const repoPath = encodeRepoPath(copy.path);
  const ref = encodeURIComponent(source.ref);
  const bound = until ? `&until=${encodeURIComponent(until)}` : "";
  const history = await get(
    `repos/${source.repo}/commits?path=${repoPath}&sha=${ref}${bound}&per_page=1`,
  );
  const commit = history?.body?.[0];
  if (!commit) {
    throw new Error(`${source.repo}:${copy.path} — aucun commit trouvé`);
  }
  const content = await get(
    `repos/${source.repo}/contents/${repoPath}?ref=${commit.sha}`,
  );
  if (content?.status !== 200) {
    throw new Error(`${source.repo}:${copy.path} — contenu illisible`);
  }
  return {
    ...copy,
    commit: commit.sha,
    date: commit.commit.committer.date,
    blob: content.body.sha,
    sha256: contentFingerprint(file),
  };
}

/**
 * Réécrit un manifeste, au format que le dépôt formate.
 *
 * @param dir - le dossier figé
 * @param manifest - le manifeste à écrire
 */
export function writeManifest(dir, manifest) {
  writeFileSync(
    path.join(dir, MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
