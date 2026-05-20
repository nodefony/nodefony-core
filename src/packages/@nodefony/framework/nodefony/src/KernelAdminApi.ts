import type { IKernel, IAdminApi, IAdminEndpoint, IAdminDescriptor } from "nodefony";

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
      summary: "Loaded modules with their versions",
      handler: () => {
        const modules = kernel.getModules();
        return Object.keys(modules).map((name) => {
          const mod = modules[name];
          return {
            key: name,
            name: mod.getModuleName?.() ?? name,
            version: mod.getModuleVersion?.() ?? null,
            isApp: mod.isApp ?? false,
            path: mod.path ?? null,
          };
        });
      },
    },
    {
      // Endpoint PARAMÉTRÉ — exerce la regexp de routage `{name}` + l'extraction
      // de params (`request.params.name`). `{name}` = mono-segment → utiliser la
      // clé courte du module (`http`, `framework`), pas `@nodefony/http` (slash).
      path: "module/{name}",
      summary: "Detail of one loaded module by key (e.g. http, framework)",
      handler: (request) => {
        const key = request.params.name;
        const mod = kernel.getModules()[key];
        if (!mod) {
          // Enveloppe IAdminResponse : `status` présent → reconnue par le broker.
          return { status: 404, body: { error: "Module not found", key } };
        }
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
