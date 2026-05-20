import type { IKernel, IAdminApi, IAdminEndpoint, IAdminDescriptor } from "nodefony";
import {
  listModuleDocs,
  readModuleDoc,
  listModuleSymbols,
  resolveCorePath,
  readCoreInfo,
  CORE_PACKAGE,
} from "./docsReader";

/** Clé du pseudo-module core dans Studio (cf carte "Core" / `resolveCorePath`). */
const CORE_KEY = "core";

/**
 * Sérialisation défensive de config : borne la profondeur, neutralise les
 * fonctions, casse les cycles. Les `options` d'un module peuvent contenir des
 * fonctions/refs circulaires (vers le kernel) → JSON.stringify direct planterait.
 */
function safeConfig(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "function") return "[Function]";
  if (typeof value === "bigint") return value.toString();
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
      out[k] = safeConfig((value as Record<string, unknown>)[k], depth + 1, seen);
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
            path: core.path,
          },
        ];
        for (const name of Object.keys(modules)) {
          const mod = modules[name];
          list.push({
            key: name,
            name: mod.getModuleName?.() ?? name,
            version: mod.getModuleVersion?.() ?? null,
            isApp: mod.isApp ?? false,
            path: mod.path ?? null,
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
            path: core.path,
            dependencies: core.dependencies,
            services: [],
            config: {},
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
        return {
          key,
          name: mod.getModuleName?.() ?? key,
          version: mod.getModuleVersion?.() ?? null,
          isApp: mod.isApp ?? false,
          path: mod.path ?? null,
          dependencies: mod.getDependencies?.() ?? [],
          services,
          config: safeConfig(mod.options ?? {}),
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
  ];

  return {
    adminNamespace: "kernel",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}
