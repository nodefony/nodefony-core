import fs from "node:fs/promises";
import path from "node:path";
import type { Module } from "nodefony";
import type { IAdminApi, IAdminEndpoint, IAdminDescriptor } from "nodefony";

/** Forme minimale lue sur le service `sessions` (lecture défensive). */
interface SessionsLike {
  sessionStrategy?: string;
  sessionAutoStart?: string | false;
  defaultSessionName?: string;
  options?: { save_path?: string; gc_maxlifetime?: number };
  storage?: { constructor?: { name?: string } } | null;
}

/** Compte récursivement les fichiers de session sous `dir` (0 si absent). */
async function countSessionFiles(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let n = 0;
    for (const e of entries) {
      if (e.isDirectory()) n += await countSessionFiles(path.join(dir, e.name));
      else n++;
    }
    return n;
  } catch {
    return 0; // dossier inexistant = aucune session
  }
}

/**
 * Producteur `IAdminApi` du module **http** — exposé sous `/nodefony/http/api/*`.
 *
 * 2ᵉ producteur du data plane admin (le 1er étant le kernel). Démontre le
 * pattern multi-modules : `@nodefony/http` n'importe QUE le contrat core
 * (`IAdminApi`) — jamais `@nodefony/framework` (dépendance circulaire). Il
 * s'enregistre auprès du broker via `IAdminRegistry` récupéré du container.
 *
 * Endpoints :
 *  - `GET /nodefony/http/api/servers` → liste des serveurs réseau + leur état
 *  - `GET /nodefony/http/api/info`    → résumé (serveurs prêts, ports, schemes)
 *
 * @param module - le module http (accès aux services serveur du container).
 * @returns le contrat admin de http, prêt à `registry.register()`.
 */
export function createHttpAdminApi(module: Module): IAdminApi {
  /** Noms des services serveur enregistrés par le module http. */
  const serverServices = [
    "server-http",
    "server-https",
    "server-websocket",
    "server-websocket-secure",
    "server-static",
  ] as const;

  /** Forme minimale lue sur un service serveur (lecture défensive). */
  interface ServerLike {
    type?: string;
    scheme?: string;
    protocol?: string;
    address?: string;
    port?: number;
    family?: string | null;
    ready?: boolean;
  }

  const readServer = (name: string): (ServerLike & { service: string }) | null => {
    const svc = module.get(name) as ServerLike | undefined;
    if (!svc) return null;
    return {
      service: name,
      type: svc.type,
      scheme: svc.scheme,
      protocol: svc.protocol,
      address: svc.address,
      port: svc.port,
      family: svc.family ?? null,
      ready: svc.ready ?? false,
    };
  };

  const listServers = () =>
    serverServices
      .map((name) => readServer(name))
      .filter((s): s is ServerLike & { service: string } => s !== null);

  const descriptor: IAdminDescriptor = {
    label: "HTTP",
    icon: "network",
    order: 1,
  };

  const endpoints: IAdminEndpoint[] = [
    {
      path: "servers",
      summary: "Network servers (http/https/ws/wss/static) with listening state",
      handler: () => listServers(),
    },
    {
      path: "info",
      summary: "HTTP layer summary — ready servers, ports, schemes",
      handler: () => {
        const servers = listServers();
        const ready = servers.filter((s) => s.ready);
        return {
          serversTotal: servers.length,
          serversReady: ready.length,
          ports: [...new Set(ready.map((s) => s.port).filter(Boolean))],
          schemes: [...new Set(ready.map((s) => s.scheme).filter(Boolean))],
          protocols: [...new Set(ready.map((s) => s.protocol).filter(Boolean))],
        };
      },
    },
    {
      // Sessions = sous-système EN DÉPRÉCIATION (HTTP full stateless JWT, cf
      // décision cloud-native). On expose son état réel + le nb de fichiers
      // actifs (storage fichier par défaut) pour le KPI Studio, avec le flag
      // `deprecated` pour ne pas induire en erreur.
      path: "sessions",
      summary: "Session subsystem status + active count (DEPRECATED — stateless JWT)",
      handler: async () => {
        const svc = module.get("sessions") as SessionsLike | undefined;
        if (!svc) return { enabled: false, deprecated: true, active: 0 };
        const storage = svc.storage?.constructor?.name ?? "none";
        const save = svc.options?.save_path;
        // Compte les fichiers de session si un save_path est configuré (storage
        // fichier = défaut). 0 si le dossier n'existe pas encore (aucune session).
        const active = save
          ? await countSessionFiles(path.resolve(process.cwd(), save))
          : null;
        return {
          enabled: true,
          strategy: svc.sessionStrategy ?? null,
          autoStart: svc.sessionAutoStart ?? false,
          name: svc.defaultSessionName ?? null,
          storage,
          gcMaxlifetime: svc.options?.gc_maxlifetime ?? null,
          savePath: save ?? null,
          active,
          deprecated: true,
        };
      },
    },
  ];

  return {
    adminNamespace: "http",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}
