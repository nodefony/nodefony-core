import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
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
  withGit: boolean,
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
    // Git par doc = 1 spawn → coûteux × N. Skippé dans la LISTE (gitUpdated réel
    // calculé à l'ouverture par `readModuleDoc`). Cf perf endpoint module detail.
    gitUpdated: withGit ? await gitLastUpdated(full) : null,
    order:
      typeof data.order === "number" ? data.order : slug === "index" ? 0 : 100,
  };
}

/**
 * Sommaire des docs d'un module : lit les `*.md` de `<modulePath>/docs/`
 * (un niveau, non récursif), parse le frontmatter, trie par `order` puis slug.
 *
 * @param modulePath - chemin disque du module (`Module.path`).
 * @returns liste triée (vide si le dossier `docs/` est absent).
 */
export async function listModuleDocs(
  modulePath: string,
  withGit = false,
): Promise<DocSummary[]> {
  const docsDir = join(modulePath, "docs");
  let entries: string[];
  try {
    entries = await readdir(docsDir);
  } catch {
    return [];
  }
  const mdFiles = entries.filter((f) => f.toLowerCase().endsWith(".md"));
  const summaries = await Promise.all(
    mdFiles.map((f) => summarize(docsDir, f, withGit)),
  );
  return summaries.sort(
    (a, b) => a.order - b.order || a.slug.localeCompare(b.slug),
  );
}

/**
 * Comptage rapide des docs (`*.md`) d'un module — readdir seul, sans lire/parser
 * ni `git`. Pour les KPI/overview (`docsCount`) où seul le nombre importe.
 *
 * @param modulePath - chemin disque du module (`Module.path`).
 * @returns nombre de fichiers `.md` dans `<modulePath>/docs/` (0 si absent).
 */
export async function countModuleDocs(modulePath: string): Promise<number> {
  try {
    const entries = await readdir(join(modulePath, "docs"));
    return entries.filter((f) => f.toLowerCase().endsWith(".md")).length;
  } catch {
    return 0;
  }
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

/** Dépendance d'un module : range déclarée + version installée. */
export interface DepInfo {
  name: string;
  kind: "nodefony" | "external";
  range: string | null;
  installed: string | null;
}

/** Statut "outdated" d'une dep externe (registry npm). */
export interface OutdatedInfo {
  name: string;
  installed: string | null;
  latest: string | null;
  outdated: boolean;
}

/**
 * Dépendances d'un module : depuis son `package.json` (dependencies +
 * peerDependencies) avec la version RÉELLEMENT installée (lue dans
 * `node_modules/<dep>/package.json`, local puis hoisté à la racine).
 */
export async function readDependencies(modulePath: string): Promise<DepInfo[]> {
  let pkg: {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  } = {};
  try {
    pkg = JSON.parse(await readFile(join(modulePath, "package.json"), "utf8"));
  } catch {
    /* pas de package.json */
  }
  const ranges: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.peerDependencies,
  };
  const root = process.cwd();
  const out: DepInfo[] = [];
  for (const name of Object.keys(ranges).sort()) {
    const kind: DepInfo["kind"] =
      name === "nodefony" || name.startsWith("@nodefony/")
        ? "nodefony"
        : "external";
    let installed: string | null = null;
    for (const base of [modulePath, root]) {
      try {
        const dp = JSON.parse(
          await readFile(
            join(base, "node_modules", name, "package.json"),
            "utf8",
          ),
        );
        if (typeof dp.version === "string") {
          installed = dp.version;
          break;
        }
      } catch {
        /* dep absente à cet emplacement */
      }
    }
    out.push({ name, kind, range: ranges[name] ?? null, installed });
  }
  return out;
}

/** Compare deux versions semver (a > b ?) — major.minor.patch numérique. */
function semverGt(a: string, b: string): boolean {
  const p = (s: string) =>
    s
      .replace(/^[^\d]*/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const pa = p(a);
  const pb = p(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

/**
 * Vérifie les MAJ des deps EXTERNES via le registry npm (`/<pkg>/latest`).
 * Les deps Nodefony (workspaces locaux) sont ignorées. Réseau → on-demand.
 */
export async function checkOutdated(deps: DepInfo[]): Promise<OutdatedInfo[]> {
  const external = deps.filter((d) => d.kind === "external");
  return Promise.all(
    external.map(async (d) => {
      let latest: string | null = null;
      try {
        const url = `https://registry.npmjs.org/${d.name.replace("/", "%2F")}/latest`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const j = (await r.json()) as { version?: unknown };
          if (typeof j.version === "string") latest = j.version;
        }
      } catch {
        /* registry indispo / timeout */
      }
      return {
        name: d.name,
        installed: d.installed,
        latest,
        outdated: Boolean(
          latest && d.installed && semverGt(latest, d.installed),
        ),
      };
    }),
  );
}

/** Résultat d'un lancement de tests (un fichier ou toute la suite). */
export interface TestRunResult {
  ok: boolean;
  code: number | null;
  passed: number;
  failed: number;
  durationMs: number;
  output: string;
  mode: string;
}

/** Walk `*.test.ts` (hors node_modules/dist/.coverage) → chemins relatifs triés. */
async function collectTestFiles(modulePath: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name === ".coverage"
      )
        continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith(".test.ts"))
        out.push(rel(full, modulePath));
    }
  };
  await walk(modulePath, 0);
  out.sort();
  return out;
}

/** Est-ce un test unit ? (seul lançable par `vitest run <file>` sans serveur). */
function isUnitTest(relPath: string): boolean {
  return relPath.includes("/unit/") || relPath.includes("tests/unit/");
}

/** Catégorie d'un fichier de test, dérivée de son chemin/nom (dossier de suite). */
function testCategory(relPath: string): string {
  if (isUnitTest(relPath)) return "unit";
  if (relPath.includes("/integration/")) return "integration";
  if (relPath.includes("/e2e/") || relPath.endsWith(".e2e.test.ts"))
    return "e2e";
  if (relPath.includes("/load/")) return "load";
  if (relPath.includes("/websockets/")) return "websockets";
  if (relPath.includes("/routing/")) return "routing";
  if (relPath.endsWith("memory.test.ts")) return "memory";
  return "autre";
}

/**
 * Liste les fichiers de test **unit** d'un module (lançables par `vitest run`).
 * Si aucune suite unit, repli sur tous les fichiers. Chemins relatifs au module.
 */
export async function listTestFiles(modulePath: string): Promise<string[]> {
  const all = await collectTestFiles(modulePath);
  const unit = all.filter(isUnitTest);
  return unit.length ? unit : all;
}

/** Un groupe de suites de tests (pour l'onglet Tests de Studio). */
export interface TestGroup {
  /** Catégorie (`unit`/`integration`/`e2e`/`load`/`websockets`/`routing`/`memory`/`autre`). */
  category: string;
  files: string[];
  /** Lançable depuis Studio ? (unit seulement — les autres tapent un serveur/DB). */
  runnable: boolean;
}

const TEST_CATEGORY_ORDER = [
  "unit",
  "integration",
  "e2e",
  "websockets",
  "routing",
  "load",
  "memory",
  "autre",
];

/**
 * Groupe TOUS les fichiers de test d'un module par catégorie (lecture seule pour
 * l'onglet Tests — les non-unit ne sont pas lançables depuis Studio : ils exigent
 * un serveur live / une base, donc `runnable:false`). Donne une vue complète des
 * suites (intégration/e2e/charge/mémoire) qui étaient invisibles auparavant.
 */
export async function listTestGroups(modulePath: string): Promise<TestGroup[]> {
  const all = await collectTestFiles(modulePath);
  const byCat = new Map<string, string[]>();
  for (const f of all) {
    const c = testCategory(f);
    let arr = byCat.get(c);
    if (arr === undefined) {
      arr = [];
      byCat.set(c, arr);
    }
    arr.push(f);
  }
  return [...byCat.entries()]
    .sort(
      ([a], [b]) =>
        TEST_CATEGORY_ORDER.indexOf(a) - TEST_CATEGORY_ORDER.indexOf(b),
    )
    .map(([category, files]) => ({
      category,
      files,
      runnable: category === "unit",
    }));
}

/**
 * Lance les tests d'un module et renvoie un résumé (pass/fail/durée + tail).
 *
 * - 1 fichier (module vitest) → `npx vitest run <file>` (rapide, pass/fail).
 * - sinon → `npm run coverage` (suite complète + refresh coverage ; marche
 *   pour vitest comme pour monocart/core).
 *
 * ⚠️ EXÉCUTE un process — appelé UNIQUEMENT derrière le garde dev-only de
 * l'endpoint (cf KernelAdminApi). spawn sans shell + args en tableau (pas
 * d'injection shell). `file` validé en amont (suffixe .test.ts, pas de `..`).
 */
export function runModuleTests(
  modulePath: string,
  file?: string,
): Promise<TestRunResult> {
  const hasVitest = existsSync(join(modulePath, "vitest.config.ts"));
  let cmd: string;
  let args: string[];
  let mode: string;
  if (file && hasVitest) {
    cmd = "npx";
    // `--` : tout ce qui suit est un chemin positionnel, JAMAIS interprété comme
    // un flag vitest (defense-in-depth anti injection d'argument — l'appelant
    // valide déjà `file`, cf KernelAdminApi : pas de `..`, pas de `-`, `.test.ts`).
    args = ["vitest", "run", "--", file];
    mode = `vitest run ${file}`;
  } else if (hasVitest) {
    // Run-all d'un module vitest : on FORCE les reporters fichiers + le répertoire
    // .coverage en CLI → l'onglet Coverage de Studio apparaît quelle que soit la
    // config coverage du module (anti-dérive : la liste `reporter` était dupliquée
    // par module et divergeait en silence, certains n'émettant que du `text`).
    cmd = "npx";
    args = [
      "vitest",
      "run",
      "--coverage",
      "--coverage.reporter=text-summary",
      "--coverage.reporter=json-summary",
      "--coverage.reporter=lcov",
      "--coverage.reportsDirectory=.coverage",
    ];
    mode = "vitest run --coverage (reporters forcés)";
  } else {
    // Core (monocart, pas de vitest.config.ts) : son script `coverage` émet lcov.
    cmd = "npm";
    args = ["run", "coverage"];
    mode = "npm run coverage (suite complète)";
  }
  const start = Date.now();
  return new Promise<TestRunResult>((resolve) => {
    let out = "";
    const cap = (d: Buffer) => {
      out += d.toString();
      if (out.length > 200_000) out = out.slice(-200_000);
    };
    let child;
    try {
      child = spawn(cmd, args, { cwd: modulePath, env: process.env });
    } catch (e) {
      return resolve({
        ok: false,
        code: null,
        passed: 0,
        failed: 0,
        durationMs: 0,
        output: String(e),
        mode,
      });
    }
    child.stdout?.on("data", cap);
    child.stderr?.on("data", cap);
    const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
    // Un spawn qui échoue émet `error` PUIS `close` : sans garde, le second
    // verdict écraserait le premier (silencieusement — une Promise ignore la
    // seconde résolution) et laisserait les listeners attachés.
    let settled = false;
    const settle = (result: TestRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.off("data", cap);
      child.stderr?.off("data", cap);
      // oxlint-disable-next-line no-multiple-resolved -- c'est ICI la garde `settled` décrite juste au-dessus : la règle signale sa propre correction, elle ne suit pas le drapeau
      resolve(result);
    };
    child.on("error", (e) => {
      settle({
        ok: false,
        code: null,
        passed: 0,
        failed: 0,
        durationMs: Date.now() - start,
        output: String(e),
        mode,
      });
    });
    child.on("close", (code) => {
      const clean = out.replace(/\x1b\[[0-9;]*m/g, "");
      const passed = Number(
        clean.match(/Tests\s+(\d+)\s+passed/)?.[1] ??
          clean.match(/(\d+)\s+passing/)?.[1] ??
          0,
      );
      const failed = Number(
        clean.match(/(\d+)\s+failed/)?.[1] ??
          clean.match(/(\d+)\s+failing/)?.[1] ??
          0,
      );
      settle({
        ok: code === 0,
        code,
        passed,
        failed,
        durationMs: Date.now() - start,
        output: clean.slice(-6000),
        mode,
      });
    });
  });
}

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
  total?: {
    lines: number;
    statements: number;
    functions: number;
    branches: number;
  };
  files?: CoverageFile[];
}

const rel = (abs: string, modulePath: string) =>
  abs.startsWith(modulePath)
    ? abs.slice(modulePath.length).replace(/^\/+/, "")
    : abs;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Parse un `coverage-summary.json` (istanbul/vitest : total + par fichier). */
function parseSummary(
  json: Record<string, unknown>,
  modulePath: string,
): CoverageReport | null {
  const total = json.total as Record<string, { pct?: number }> | undefined;
  if (!total) return null;
  const pct = (m: { pct?: number } | undefined) =>
    typeof m?.pct === "number" ? m.pct : 0;
  const files: CoverageFile[] = [];
  for (const [abs, v] of Object.entries(json)) {
    if (abs === "total") continue;
    const m = v as Record<string, { pct?: number }>;
    files.push({
      file: rel(abs, modulePath),
      lines: pct(m.lines),
      statements: pct(m.statements),
      functions: pct(m.functions),
      branches: pct(m.branches),
    });
  }
  return {
    available: true,
    total: {
      lines: pct(total.lines),
      statements: pct(total.statements),
      functions: pct(total.functions),
      branches: pct(total.branches),
    },
    files,
  };
}

/** Parse un `lcov.info` (produit par monocart ET vitest) en {total, files}. */
function parseLcov(text: string, modulePath: string): CoverageReport | null {
  const files: CoverageFile[] = [];
  const tot = { lf: 0, lh: 0, fnf: 0, fnh: 0, brf: 0, brh: 0 };
  let cur: {
    p: string;
    lf: number;
    lh: number;
    fnf: number;
    fnh: number;
    brf: number;
    brh: number;
  } | null = null;
  const num = (s: string, i: number) => Number(s.slice(i)) || 0;
  const pctOf = (h: number, f: number) => (f > 0 ? round2((h / f) * 100) : 100);
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:"))
      cur = {
        p: line.slice(3).trim(),
        lf: 0,
        lh: 0,
        fnf: 0,
        fnh: 0,
        brf: 0,
        brh: 0,
      };
    else if (!cur) continue;
    else if (line.startsWith("LF:")) cur.lf = num(line, 3);
    else if (line.startsWith("LH:")) cur.lh = num(line, 3);
    else if (line.startsWith("FNF:")) cur.fnf = num(line, 4);
    else if (line.startsWith("FNH:")) cur.fnh = num(line, 4);
    else if (line.startsWith("BRF:")) cur.brf = num(line, 4);
    else if (line.startsWith("BRH:")) cur.brh = num(line, 4);
    else if (line.startsWith("end_of_record")) {
      const ln = pctOf(cur.lh, cur.lf);
      files.push({
        file: rel(cur.p, modulePath),
        lines: ln,
        statements: ln,
        functions: pctOf(cur.fnh, cur.fnf),
        branches: pctOf(cur.brh, cur.brf),
      });
      tot.lf += cur.lf;
      tot.lh += cur.lh;
      tot.fnf += cur.fnf;
      tot.fnh += cur.fnh;
      tot.brf += cur.brf;
      tot.brh += cur.brh;
      cur = null;
    }
  }
  if (!files.length) return null;
  const ln = pctOf(tot.lh, tot.lf);
  return {
    available: true,
    total: {
      lines: ln,
      statements: ln,
      functions: pctOf(tot.fnh, tot.fnf),
      branches: pctOf(tot.brh, tot.brf),
    },
    files,
  };
}

/**
 * Lit le dernier rapport de couverture d'un module dans `<module>/.coverage/`.
 * Préfère `coverage-summary.json` (vitest, a les statements) ; sinon parse
 * `lcov.info` (produit par monocart côté core ET par vitest). Studio AFFICHE ce
 * rapport — il ne lance pas les tests. `available:false` si rien de généré.
 */
export async function readCoverage(
  modulePath: string,
): Promise<CoverageReport> {
  const dir = join(modulePath, ".coverage");
  let report: CoverageReport | null = null;
  let usedFile: string | null = null;
  const summaryPath = join(dir, "coverage-summary.json");
  try {
    report = parseSummary(
      JSON.parse(await readFile(summaryPath, "utf8")),
      modulePath,
    );
    if (report) usedFile = summaryPath;
  } catch {
    /* pas de summary → tenter lcov */
  }
  if (!report) {
    const lcovPath = join(dir, "lcov.info");
    try {
      report = parseLcov(await readFile(lcovPath, "utf8"), modulePath);
      if (report) usedFile = lcovPath;
    } catch {
      /* pas de lcov non plus */
    }
  }
  if (!report) return { available: false };
  report.files!.sort((a, b) => a.file.localeCompare(b.file));
  try {
    report.generated = usedFile
      ? (await stat(usedFile)).mtime.toISOString()
      : null;
  } catch {
    report.generated = null;
  }
  return report;
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
