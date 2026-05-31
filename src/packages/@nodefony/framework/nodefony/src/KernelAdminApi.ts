import { randomUUID } from "node:crypto";
import { GitService, getActiveLogDriver, Syslog } from "nodefony";
import type {
  IKernel,
  IAdminApi,
  IAdminEndpoint,
  IAdminDescriptor,
} from "nodefony";
import type { TestRunResult } from "./docsReader";
import {
  listModuleDocs,
  countModuleDocs,
  readModuleDoc,
  listModuleSymbols,
  readCoverage,
  readDependencies,
  checkOutdated,
  listTestFiles,
  runModuleTests,
  resolveCorePath,
  readCoreInfo,
  CORE_PACKAGE,
} from "./docsReader";

/** Clé du pseudo-module core dans Studio (cf carte "Core" / `resolveCorePath`). */
const CORE_KEY = "core";

/** Racine projet — pour ne PAS exposer de chemin absolu (sécu). */
const REPO_ROOT = process.cwd();
/** Relativise tout chemin absolu présent dans une string de config. */
function stripAbs(s: string): string {
  if (!s.includes(REPO_ROOT)) return s;
  return s.split(`${REPO_ROOT}/`).join("").split(REPO_ROOT).join(".");
}

/**
 * Sérialisation défensive de config : borne la profondeur, neutralise les
 * fonctions, casse les cycles, et **relativise les chemins absolus** (sécu :
 * ne jamais exposer l'arborescence serveur). Les `options` d'un module peuvent
 * contenir des fonctions/refs circulaires (vers le kernel) → JSON.stringify
 * direct planterait.
 */
function safeConfig(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "function") return "[Function]";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return stripAbs(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 5) return "[depth limit]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((v) => safeConfig(v, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).slice(0, 200)) {
    try {
      out[k] = safeConfig(
        (value as Record<string, unknown>)[k],
        depth + 1,
        seen,
      );
    } catch {
      out[k] = "[unreadable]";
    }
  }
  return out;
}

/**
 * Producteur `IAdminApi` du **kernel** — exposé sous `/nodefony/kernel/api/*`.
 *
 * Le kernel ne peut pas s'enregistrer lui-même : il vit dans `@nodefony/core`
 * et ne peut donc pas importer le broker (qui est dans `@nodefony/framework`).
 * C'est framework qui construit cet `IAdminApi` à partir du kernel et
 * l'enregistre auprès du broker (cf `Framework.onKernelReady`). Le kernel reste
 * passif : on ne lit que ses getters publics + `process`.
 *
 * Endpoints (tous `ROLE_NODEFONY_ADMIN` par défaut) :
 *  - `GET /nodefony/kernel/api/health`  → liveness léger (probe k8s-friendly)
 *  - `GET /nodefony/kernel/api/info`    → identité runtime
 *  - `GET /nodefony/kernel/api/modules` → modules chargés + versions
 *
 * @param kernel - kernel courant (`Nodefony.getKernel()`).
 * @returns le contrat admin du kernel, prêt à `broker.register()`.
 */
export function createKernelAdminApi(kernel: IKernel): IAdminApi {
  const descriptor: IAdminDescriptor = {
    label: "Kernel",
    icon: "server",
    order: 0,
  };

  // Résout chemin disque + nom de package d'une cible : module chargé OU le
  // pseudo-module `core` (socle, absent de `getModules()`). `null` = inconnue.
  const resolveTarget = (key: string): { path: string; pkg: string } | null => {
    if (key === CORE_KEY) return { path: resolveCorePath(), pkg: CORE_PACKAGE };
    const mod = kernel.getModules()[key];
    if (!mod) return null;
    return { path: mod.path, pkg: mod.getModuleName?.() ?? key };
  };

  // Jobs de tests ASYNCHRONES : le run (6-30 s) ne tient PAS la connexion HTTP
  // (sinon le navigateur "Failed to fetch" pendant l'écriture du coverage). POST
  // démarre + rend un jobId ; le front poll GET ?jobId. Borné (16 derniers).
  const testJobs = new Map<
    string,
    { status: "running" | "done"; startedAt: number; result?: TestRunResult }
  >();
  const devGuard = () =>
    kernel.environment === "development" || Boolean(kernel.debug);

  // SÉCU : ne JAMAIS exposer de chemin absolu (fuite de l'arborescence serveur).
  // On renvoie les `path` relatifs à la racine projet (`process.cwd()`).
  const repoRoot = process.cwd();
  const relPath = (p: string | null | undefined): string | null =>
    p && p.startsWith(repoRoot)
      ? p.slice(repoRoot.length).replace(/^[/\\]+/, "") || "."
      : (p ?? null);

  const endpoints: IAdminEndpoint[] = [
    {
      path: "health",
      summary: "Liveness probe — process up + boot status",
      handler: () => ({
        status: kernel.booted ? "ok" : "booting",
        booted: kernel.booted,
        uptime: process.uptime(),
        pid: process.pid,
      }),
    },
    {
      path: "info",
      summary: "Runtime identity — version, environment, host",
      handler: () => ({
        version: kernel.version,
        environment: kernel.environment,
        debug: kernel.debug,
        domain: kernel.domain,
        pid: process.pid,
        node: process.version,
        platform: process.platform,
        uptime: process.uptime(),
        modules: Object.keys(kernel.getModules()).length,
        // Topologie process (cloud-native, per-instance). `NODEFONY_CLUSTER=1`
        // posé par le master, hérité au fork → `true` dans chaque worker. Le
        // décompte des workers est agrégé ailleurs (master → realtime:health) :
        // ici on ne rapporte QUE ce process (pas d'agrégation dans le data plane).
        cluster: { isCluster: process.env.NODEFONY_CLUSTER === "1" },
        // Fonds de panier (« backplanes ») — info rapide pour la topbar Studio.
        // LOG Backplane : driver de relecture actif (axe DESTINATION queryable)
        // + sink d'écriture (axe WRITE). Le Realtime Backplane vit dans son
        // module (cycle interdit framework→realtime) → lu côté Studio depuis
        // `/nodefony/realtime/api/health`.
        backplanes: {
          log: {
            driver: getActiveLogDriver()?.name ?? null,
            sink: Syslog.logSinkName,
          },
        },
        // Identité git (branche + commit court) — lecture `.git`, sans spawn.
        git: GitService.read(),
      }),
    },
    {
      path: "modules",
      summary: "Loaded modules with their versions (+ core pseudo-module)",
      handler: async () => {
        const modules = kernel.getModules();
        // Le core (`@nodefony/core`) n'est pas un module chargé : on l'injecte
        // en tête comme pseudo-module pour qu'il ait sa carte dans Studio.
        const core = await readCoreInfo();
        const list: Array<Record<string, unknown>> = [
          {
            key: CORE_KEY,
            name: core.name,
            version: core.version,
            isApp: false,
            path: relPath(core.path),
          },
        ];
        for (const name of Object.keys(modules)) {
          const mod = modules[name];
          list.push({
            key: name,
            name: mod.getModuleName?.() ?? name,
            version: mod.getModuleVersion?.() ?? null,
            isApp: mod.isApp ?? false,
            path: relPath(mod.path),
          });
        }
        return list;
      },
    },
    {
      // Endpoint PARAMÉTRÉ — exerce la regexp de routage `{name}` + l'extraction
      // de params (`request.params.name`). `{name}` = mono-segment → utiliser la
      // clé courte du module (`http`, `framework`), pas `@nodefony/http` (slash).
      path: "module/{name}",
      summary: "Detail of one module by key (http, framework, … or core)",
      handler: async (request) => {
        const key = request.params.name;
        // Pseudo-module core : socle sans services/config/routes propres.
        if (key === CORE_KEY) {
          const core = await readCoreInfo();
          return {
            key: CORE_KEY,
            name: core.name,
            version: core.version,
            isApp: false,
            path: relPath(core.path),
            dependencies: core.dependencies,
            services: [],
            config: {},
            docsCount: await countModuleDocs(core.path),
            symbolsCount: (await listModuleSymbols(CORE_PACKAGE)).length,
            coverageLines: (await readCoverage(core.path)).total?.lines ?? null,
          };
        }
        const mod = kernel.getModules()[key];
        if (!mod) {
          // Enveloppe IAdminResponse : `status` présent → reconnue par le broker.
          return { status: 404, body: { error: "Module not found", key } };
        }
        // Services enregistrés par le module + classe d'implémentation (le nom
        // de registration vient de Module.getServiceNames, la classe du
        // container partagé).
        const services = mod.getServiceNames().map((sname) => ({
          name: sname,
          class:
            (mod.get(sname) as { constructor?: { name?: string } } | null)
              ?.constructor?.name ?? null,
        }));
        // Succès = donnée brute (le broker assume 200). NE PAS wrapper dans
        // `{ body }` sans `status`/`headers` → normalize ne le reconnaît pas
        // comme enveloppe et double-wrappe.
        const pkg = mod.getModuleName?.() ?? key;
        return {
          key,
          name: pkg,
          version: mod.getModuleVersion?.() ?? null,
          isApp: mod.isApp ?? false,
          path: relPath(mod.path),
          dependencies: mod.getDependencies?.() ?? [],
          services,
          config: safeConfig(mod.options ?? {}),
          docsCount: await countModuleDocs(mod.path),
          symbolsCount: (await listModuleSymbols(pkg)).length,
          coverageLines: (await readCoverage(mod.path)).total?.lines ?? null,
        };
      },
    },
    {
      // Dépendances du module + version installée (range déclarée vs installée).
      path: "module/{name}/dependencies",
      summary: "Module dependencies with installed versions",
      handler: async (request) => {
        const target = resolveTarget(request.params.name);
        if (!target) {
          return {
            status: 404,
            body: { error: "Module not found", key: request.params.name },
          };
        }
        return {
          key: request.params.name,
          deps: await readDependencies(target.path),
        };
      },
    },
    {
      // Check MAJ des deps externes (registry npm) — réseau, on-demand.
      path: "module/{name}/dependencies/outdated",
      summary: "Check external dependencies for updates (npm registry)",
      handler: async (request) => {
        const target = resolveTarget(request.params.name);
        if (!target) {
          return {
            status: 404,
            body: { error: "Module not found", key: request.params.name },
          };
        }
        const deps = await readDependencies(target.path);
        return {
          key: request.params.name,
          outdated: await checkOutdated(deps),
        };
      },
    },
    {
      // Sommaire des docs colocalisées au module (`<modulePath>/docs/*.md`).
      // Emplacement HYBRIDE (cf ADR-0001) : la prose vit dans le module ; ce
      // producteur kernel l'expose de façon cross-module pour Studio.
      path: "module/{name}/docs",
      summary: "Documentation index of one module (markdown in <module>/docs)",
      handler: async (request) => {
        const key = request.params.name;
        const target = resolveTarget(key);
        if (!target) {
          return { status: 404, body: { error: "Module not found", key } };
        }
        return { key, docs: await listModuleDocs(target.path) };
      },
    },
    {
      // Markdown brut d'une doc + frontmatter + fraîcheur git (dérive doc↔code).
      path: "module/{name}/docs/{slug}",
      summary: "Raw markdown of one module doc by slug",
      handler: async (request) => {
        const key = request.params.name;
        const target = resolveTarget(key);
        if (!target) {
          return { status: 404, body: { error: "Module not found", key } };
        }
        const doc = await readModuleDoc(target.path, request.params.slug);
        if (!doc) {
          return {
            status: 404,
            body: { error: "Doc not found", key, slug: request.params.slug },
          };
        }
        return doc;
      },
    },
    {
      // Référence API auto depuis `.ai/symbols.json` (jamais de .d.ts manuel).
      path: "module/{name}/symbols",
      summary: "Exported TS symbols + TSDoc descriptions (.ai/symbols.json)",
      handler: async (request) => {
        const key = request.params.name;
        const target = resolveTarget(key);
        if (!target) {
          return { status: 404, body: { error: "Module not found", key } };
        }
        return {
          key,
          package: target.pkg,
          symbols: await listModuleSymbols(target.pkg),
        };
      },
    },
    {
      // Dernier rapport de couverture (vitest+v8, json-summary). Studio AFFICHE,
      // ne lance pas les tests. `available:false` si pas encore généré.
      path: "module/{name}/coverage",
      summary: "Latest test coverage report (vitest json-summary)",
      handler: async (request) => {
        const key = request.params.name;
        const target = resolveTarget(key);
        if (!target) {
          return { status: 404, body: { error: "Module not found", key } };
        }
        return { key, ...(await readCoverage(target.path)) };
      },
    },
    {
      // Liste des fichiers de test du module (onglet Tests Studio).
      path: "module/{name}/tests",
      summary: "List test files of one module",
      handler: async (request) => {
        const key = request.params.name;
        const target = resolveTarget(key);
        if (!target) {
          return { status: 404, body: { error: "Module not found", key } };
        }
        return {
          key,
          devMode:
            kernel.environment === "development" || Boolean(kernel.debug),
          files: await listTestFiles(target.path),
        };
      },
    },
    {
      // DÉMARRE un run de tests en arrière-plan → rend un jobId immédiatement
      // (run async, cf testJobs). ⚠️ EXÉCUTE un process → garde DEV-ONLY strict.
      path: "module/{name}/test/run",
      method: "POST",
      summary: "Start a test run (dev only) — 1 file or whole suite → jobId",
      handler: (request) => {
        if (!devGuard()) {
          return {
            status: 403,
            body: { error: "Test runner disabled outside development" },
          };
        }
        const key = request.params.name;
        const target = resolveTarget(key);
        if (!target) {
          return { status: 404, body: { error: "Module not found", key } };
        }
        const body = (request.body ?? {}) as { file?: unknown };
        let file: string | undefined;
        if (typeof body.file === "string" && body.file) {
          if (body.file.includes("..") || !body.file.endsWith(".test.ts")) {
            return {
              status: 400,
              body: { error: "Invalid test file", file: body.file },
            };
          }
          file = body.file;
        }
        const jobId = randomUUID();
        testJobs.set(jobId, { status: "running", startedAt: Date.now() });
        // borne la map (16 derniers jobs)
        if (testJobs.size > 16) {
          const oldest = [...testJobs.entries()].sort(
            (a, b) => a[1].startedAt - b[1].startedAt,
          )[0];
          if (oldest) testJobs.delete(oldest[0]);
        }
        // fire-and-forget : ne PAS await (le client poll via GET ?jobId)
        runModuleTests(target.path, file).then(
          (result) =>
            testJobs.set(jobId, {
              status: "done",
              startedAt: Date.now(),
              result,
            }),
          (e) =>
            testJobs.set(jobId, {
              status: "done",
              startedAt: Date.now(),
              result: {
                ok: false,
                code: null,
                passed: 0,
                failed: 0,
                durationMs: 0,
                output: String(e),
                mode: "",
              },
            }),
        );
        return { key, jobId, running: true };
      },
    },
    {
      // Statut/résultat d'un run async (poll). `done:false` tant qu'il tourne.
      path: "module/{name}/test/run",
      method: "GET",
      summary: "Poll a test run by ?jobId",
      handler: (request) => {
        const jobId = String(request.query.jobId ?? "");
        const job = jobId ? testJobs.get(jobId) : undefined;
        if (!job)
          return { status: 404, body: { error: "Unknown jobId", jobId } };
        return { jobId, done: job.status === "done", ...(job.result ?? {}) };
      },
    },
  ];

  return {
    adminNamespace: "kernel",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}
