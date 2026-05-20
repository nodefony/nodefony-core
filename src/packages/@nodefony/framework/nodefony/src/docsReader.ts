import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Frontmatter d'un fichier de doc module. Tous les champs sont optionnels —
 * un `.md` sans frontmatter reste lisible (titre dérivé du premier `# H1`).
 *
 * On accepte les alias historiques (`last-updated` ⇄ `updated`, `topic` ⇄
 * `title`) pour ne pas réécrire les docs `architecture/*` déjà frontmattées.
 */
export interface DocFrontmatter {
  title?: string;
  module?: string;
  since?: string;
  updated?: string;
  status?: string;
  order?: number;
  [key: string]: unknown;
}

/** Entrée du sommaire docs d'un module (sans le corps markdown). */
export interface DocSummary {
  /** Identifiant url-safe = nom de fichier sans extension. */
  slug: string;
  /** Titre humain (frontmatter `title`/`topic`, sinon premier H1, sinon slug). */
  title: string;
  /** `draft` | `stable` | `deprecated` | `null`. */
  status: string | null;
  since: string | null;
  /** `updated`/`last-updated` du frontmatter. */
  updated: string | null;
  /** Date ISO du dernier commit git du fichier (dérive doc↔code). `null` hors git. */
  gitUpdated: string | null;
  /** Ordre d'affichage croissant (frontmatter `order`, défaut 100, `index`=0). */
  order: number;
}

/** Doc complète : frontmatter + corps markdown (frontmatter retiré). */
export interface DocContent {
  slug: string;
  frontmatter: DocFrontmatter;
  markdown: string;
  gitUpdated: string | null;
}

/** Symbole TS exporté d'un module, projeté depuis `.ai/symbols.json`. */
export interface ModuleSymbol {
  name: string;
  kind: string;
  file: string;
  description: string | null;
  extends: string | null;
  implements: string[];
  decorators: string[];
}

/** Slug url-safe — borne le path traversal sur `module/{name}/docs/{slug}`. */
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Parse un bloc frontmatter YAML minimaliste (clé: valeur scalaires).
 *
 * Volontairement sans dépendance (`gray-matter` etc.) : on ne gère que des
 * scalaires `key: value` entre deux `---`. Les listes inline (`[a, b]`) sont
 * conservées en string brute. Suffisant pour `title/module/status/since/
 * updated/order`. Renvoie `{ data, body }` ; sans fence → `data` vide.
 */
export function parseFrontmatter(raw: string): {
  data: DocFrontmatter;
  body: string;
} {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  // Fin du bloc : première ligne `---` après l'ouverture.
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const block = raw.slice(3, end);
  const after = raw.slice(end + 4);
  const body = after.startsWith("\n") ? after.slice(1) : after;
  const data: DocFrontmatter = {};
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "order") {
      const n = Number(value);
      data.order = Number.isFinite(n) ? n : undefined;
    } else if (key === "last-updated" && data.updated === undefined) {
      data.updated = value;
    } else {
      data[key] = value;
    }
  }
  return { data, body };
}

/** Premier titre `# H1` du corps markdown, ou `null`. */
function firstHeading(body: string): string | null {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

/**
 * Date ISO du dernier commit git d'un fichier (détecte la dérive doc↔code).
 *
 * Fallback sur le `mtime` fs si le fichier n'est pas suivi par git ou hors
 * dépôt. Endpoint admin (basse fréquence) → coût d'un `spawn` git acceptable.
 */
async function gitLastUpdated(file: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-1", "--format=%cI", "--", file],
      { cwd: process.cwd() },
    );
    const iso = stdout.trim();
    if (iso) return iso;
  } catch {
    /* hors git — fallback mtime */
  }
  try {
    const st = await stat(file);
    return st.mtime.toISOString();
  } catch {
    return null;
  }
}

/** Construit un `DocSummary` à partir du contenu brut d'un `.md`. */
async function summarize(
  docsDir: string,
  fileName: string,
): Promise<DocSummary> {
  const slug = basename(fileName, extname(fileName));
  const full = join(docsDir, fileName);
  const raw = await readFile(full, "utf8");
  const { data, body } = parseFrontmatter(raw);
  return {
    slug,
    title:
      data.title ??
      firstHeading(body) ??
      (typeof data.topic === "string" ? data.topic : null) ??
      slug,
    status: typeof data.status === "string" ? data.status : null,
    since: typeof data.since === "string" ? data.since : null,
    updated: typeof data.updated === "string" ? data.updated : null,
    gitUpdated: await gitLastUpdated(full),
    order:
      typeof data.order === "number"
        ? data.order
        : slug === "index"
          ? 0
          : 100,
  };
}

/**
 * Sommaire des docs d'un module : lit les `*.md` de `<modulePath>/docs/`
 * (un niveau, non récursif), parse le frontmatter, trie par `order` puis slug.
 *
 * @param modulePath - chemin disque du module (`Module.path`).
 * @returns liste triée (vide si le dossier `docs/` est absent).
 */
export async function listModuleDocs(modulePath: string): Promise<DocSummary[]> {
  const docsDir = join(modulePath, "docs");
  let entries: string[];
  try {
    entries = await readdir(docsDir);
  } catch {
    return [];
  }
  const mdFiles = entries.filter((f) => f.toLowerCase().endsWith(".md"));
  const summaries = await Promise.all(
    mdFiles.map((f) => summarize(docsDir, f)),
  );
  return summaries.sort(
    (a, b) => a.order - b.order || a.slug.localeCompare(b.slug),
  );
}

/**
 * Lit une doc module par slug : frontmatter + corps markdown brut.
 *
 * Le slug est borné (`SLUG_RE`) avant toute jointure de chemin → pas de path
 * traversal vers l'extérieur de `<modulePath>/docs/`.
 *
 * @returns `null` si slug invalide ou fichier absent.
 */
export async function readModuleDoc(
  modulePath: string,
  slug: string,
): Promise<DocContent | null> {
  if (!SLUG_RE.test(slug)) return null;
  const full = join(modulePath, "docs", `${slug}.md`);
  let raw: string;
  try {
    raw = await readFile(full, "utf8");
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(raw);
  return {
    slug,
    frontmatter: data,
    markdown: body,
    gitUpdated: await gitLastUpdated(full),
  };
}

/** Forme minimale d'une entrée `.ai/symbols.json` (lecture défensive). */
interface RawSymbol {
  name?: string;
  kind?: string;
  file?: string;
  module?: string;
  exported?: boolean;
  description?: string;
  extends?: string | null;
  implements?: string[];
  decorators?: string[];
}

/**
 * Symboles TS exportés d'un module + descriptions TSDoc, lus depuis
 * `.ai/symbols.json` (à la racine du repo, `process.cwd()`).
 *
 * 100 % auto-généré (jamais de `.d.ts` manuel) → zéro divergence avec le code.
 * Tab API maigre tant que la couverture TSDoc est faible : c'est volontaire,
 * ça pousse à documenter.
 *
 * @param packageName - nom npm du module (`Module.getModuleName()`, ex
 *   `"@nodefony/http"`) — clé `.module` dans le graphe symbolique.
 * @returns symboles exportés triés par kind puis nom (vide si fichier absent).
 */
export async function listModuleSymbols(
  packageName: string,
): Promise<ModuleSymbol[]> {
  const file = join(process.cwd(), ".ai", "symbols.json");
  let parsed: { symbols?: Record<string, RawSymbol> };
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return [];
  }
  const symbols = parsed.symbols ?? {};
  const out: ModuleSymbol[] = [];
  for (const sym of Object.values(symbols)) {
    if (sym.module !== packageName || sym.exported !== true) continue;
    out.push({
      name: sym.name ?? "",
      kind: sym.kind ?? "unknown",
      file: sym.file ?? "",
      description: typeof sym.description === "string" ? sym.description : null,
      extends: sym.extends ?? null,
      implements: Array.isArray(sym.implements) ? sym.implements : [],
      decorators: Array.isArray(sym.decorators) ? sym.decorators : [],
    });
  }
  return out.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
  );
}

/**
 * Identité du package npm du core (`@nodefony/core`) tel qu'indexé dans
 * `.ai/symbols.json` — le core est référencé sous ce nom logique, **pas** sous
 * son nom npm réel (`nodefony`, héritage JS).
 */
export const CORE_PACKAGE = "@nodefony/core";

/**
 * Chemin disque racine du package core (`nodefony`).
 *
 * Le core n'est **pas** un module chargé (`kernel.getModules()` n'a pas de clé
 * `core`) : c'est le socle de tous les autres. On résout donc son emplacement
 * pour lire ses docs colocalisées (`<core>/docs/*.md`).
 *
 * Dev self-hosted : `<cwd>/src/nodefony`. Fallback prod : résolution du package
 * npm `nodefony` (remontée jusqu'à son `package.json`).
 */
export function resolveCorePath(): string {
  const devPath = join(process.cwd(), "src", "nodefony");
  if (existsSync(join(devPath, "package.json"))) return devPath;
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve("nodefony")));
    for (let i = 0; i < 6; i++) {
      if (existsSync(join(dir, "package.json"))) return dir;
      dir = dirname(dir);
    }
  } catch {
    /* import.meta.resolve indispo → fallback dev */
  }
  return devPath;
}

/** Couverture d'un fichier (pourcentages, format json-summary istanbul/v8). */
export interface CoverageFile {
  file: string;
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

/** Rapport de couverture d'un module pour Studio (onglet Coverage). */
export interface CoverageReport {
  available: boolean;
  generated?: string | null;
  total?: { lines: number; statements: number; functions: number; branches: number };
  files?: CoverageFile[];
}

/**
 * Lit le dernier rapport de couverture d'un module —
 * `<modulePath>/.coverage/coverage-summary.json` (généré par
 * `npm run coverage`, vitest + @vitest/coverage-v8, format json-summary).
 *
 * Studio AFFICHE ce rapport (il ne lance pas les tests). `available:false` si
 * aucun rapport n'a été généré.
 */
export async function readCoverage(modulePath: string): Promise<CoverageReport> {
  const file = join(modulePath, ".coverage", "coverage-summary.json");
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return { available: false };
  }
  const total = json.total as Record<string, { pct?: number }> | undefined;
  if (!total) return { available: false };
  const pct = (m: { pct?: number } | undefined) =>
    typeof m?.pct === "number" ? m.pct : 0;
  const files: CoverageFile[] = [];
  for (const [abs, v] of Object.entries(json)) {
    if (abs === "total") continue;
    const m = v as Record<string, { pct?: number }>;
    const rel = abs.startsWith(modulePath)
      ? abs.slice(modulePath.length).replace(/^\/+/, "")
      : abs;
    files.push({
      file: rel,
      lines: pct(m.lines),
      statements: pct(m.statements),
      functions: pct(m.functions),
      branches: pct(m.branches),
    });
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  let generated: string | null = null;
  try {
    generated = (await stat(file)).mtime.toISOString();
  } catch {
    /* mtime indispo */
  }
  return {
    available: true,
    generated,
    total: {
      lines: pct(total.lines),
      statements: pct(total.statements),
      functions: pct(total.functions),
      branches: pct(total.branches),
    },
    files,
  };
}

/** Descripteur du pseudo-module `core` pour la carte/détail Studio. */
export interface CoreInfo {
  path: string;
  name: string;
  version: string | null;
  dependencies: string[];
}

/**
 * Métadonnées du core pour Studio (carte + onglet Vue d'ensemble).
 *
 * `name` est forcé à `@nodefony/core` (cohérent avec `.ai/symbols.json` et le
 * frontmatter `module:`), même si son `package.json` se nomme `nodefony`.
 * `version`/`dependencies` viennent de ce `package.json`.
 */
export async function readCoreInfo(): Promise<CoreInfo> {
  const path = resolveCorePath();
  let version: string | null = null;
  let dependencies: string[] = [];
  try {
    const pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    version = typeof pkg.version === "string" ? pkg.version : null;
    dependencies = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ];
  } catch {
    /* package.json illisible → valeurs par défaut */
  }
  return { path, name: CORE_PACKAGE, version, dependencies };
}
