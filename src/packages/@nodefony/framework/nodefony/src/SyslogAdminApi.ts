import fsp from "node:fs/promises";
import path from "node:path";
import {
  redactSecrets,
  Syslog,
  getActiveLogDriver,
  setActiveLogDriver,
  listLogDrivers,
} from "nodefony";
import type {
  ISyslog,
  IAdminApi,
  IAdminEndpoint,
  IAdminDescriptor,
  IAdminRequest,
  IAdminResponse,
  ILogQueryCriteria,
} from "nodefony";

/** Options du producteur syslog — viewer de fichiers (DEV only). */
export interface SyslogAdminApiOptions {
  /**
   * Répertoire des fichiers de log (`kernel.tmpDir`). Sans lui, l'endpoint
   * `files` répond « désactivé » (cas prod cloud-native : logs → stdout).
   */
  logDir?: string;
  /**
   * `true` en dev/staging uniquement. La rotation/rétention des logs n'est PAS
   * le rôle de Nodefony (cf cloud-native, PM2 déprécié) : en prod les logs vont
   * sur stdout/stderr → collecteur. Le viewer fichiers est un confort DEV qui
   * remplace `tail -f` localement.
   */
  enableFiles?: boolean;
  /**
   * Environnement du kernel (`"development"` | `"production"` | …). Garde la
   * **switch du driver de relecture** (`POST backplane/driver`) en **dev-only**
   * (403 hors `development`) — action de contrôle runtime, jamais en prod.
   */
  environment?: string;
}

/** Plafond d'octets lus en queue de fichier (tail / fenêtre incrémentale). */
const MAX_TAIL_BYTES = 256 * 1024;
/** Nom de fichier de log autorisé : basename simple terminant par `.log`. */
const LOG_NAME = /^[A-Za-z0-9._-]+\.log$/;

/** Métadonnée d'un fichier de log listé. */
interface LogFileMeta {
  name: string;
  size: number;
  mtime: number;
}

/** Réponse d'un tail incrémental de fichier. */
interface LogTailResult {
  name: string;
  /** Taille actuelle du fichier (octets). */
  size: number;
  /** Offset de début de la fenêtre lue. */
  from: number;
  /** Offset (frontière de ligne `\n`) à renvoyer comme `from` au prochain poll. */
  to: number;
  /** `true` si rotation/troncature externe détectée → la fenêtre repart de la fin. */
  reset: boolean;
  /** `true` si les secrets ont été masqués (défaut). */
  redacted: boolean;
  /** Lignes complètes (sans `\n`), prêtes à l'affichage. */
  lines: string[];
}

/**
 * Producteur `IAdminApi` du **syslog** (core) — exposé sous
 * `/nodefony/syslog/api/*`. 4ᵉ et dernier producteur de P10.3.
 *
 * Le syslog vit dans `@nodefony/core` et ne peut pas importer framework →
 * framework le wrappe (comme le kernel) via `createSyslogAdminApi(syslog)`.
 * Lecture seule du ring buffer (`ISyslog.ringStack`, FIFO O(1)).
 *
 * Endpoints :
 *  - `GET /nodefony/syslog/api/logs` → Pdu récents (`?severity=ERROR&limit=N`)
 *  - `GET /nodefony/syslog/api/info` → compteurs (valid/invalid/missed/buffer)
 *
 * @param syslog - instance Syslog du kernel (`kernel.syslog`).
 * @param options - viewer de fichiers (DEV) : `logDir` + `enableFiles`.
 */
export function createSyslogAdminApi(
  syslog: ISyslog,
  options: SyslogAdminApiOptions = {},
): IAdminApi {
  const logDir =
    options.enableFiles && options.logDir
      ? path.resolve(options.logDir)
      : undefined;
  /** Lit un entier de query (`?limit=50`), borné, avec défaut. */
  const intParam = (
    req: IAdminRequest,
    key: string,
    def: number,
    max: number,
  ): number => {
    const raw = req.query[key];
    const v = Array.isArray(raw) ? raw[0] : raw;
    const n = v !== undefined ? Number.parseInt(v, 10) : NaN;
    if (Number.isNaN(n) || n <= 0) return def;
    return Math.min(n, max);
  };

  /** Première valeur d'un param de query (`?raw=1`). */
  const oneParam = (req: IAdminRequest, key: string): string | undefined => {
    const raw = req.query[key];
    return Array.isArray(raw) ? raw[0] : raw;
  };

  /** Param entier positif optionnel (epoch ms, offset…) — `undefined` si absent/invalide. */
  const intOpt = (req: IAdminRequest, key: string): number | undefined => {
    const v = oneParam(req, key);
    if (v === undefined || !/^\d+$/.test(v)) return undefined;
    return Number(v);
  };

  /**
   * Construit un {@link ILogQueryCriteria} depuis la query string — la traduction
   * HTTP→backplane partagée par `logs` (array, rétrocompat) et `logs/search`
   * (paginé). `severity` accepte multi-valeurs (`?severity=ERROR&severity=CRITIC`).
   * `text` alias `q`. Bornes `from`/`to` = epoch ms.
   */
  const buildCriteria = (req: IAdminRequest): ILogQueryCriteria => {
    const criteria: ILogQueryCriteria = {
      limit: intParam(req, "limit", 200, 1000),
    };
    const sev = req.query.severity;
    if (sev !== undefined) criteria.severity = sev as string | string[];
    const requestId = oneParam(req, "requestId");
    if (requestId) criteria.requestId = requestId;
    const module = oneParam(req, "module");
    if (module) criteria.module = module;
    const msgid = oneParam(req, "msgid");
    if (msgid) criteria.msgid = msgid;
    const text = oneParam(req, "text") ?? oneParam(req, "q");
    if (text) criteria.text = text;
    const from = intOpt(req, "from");
    if (from !== undefined) criteria.from = from;
    const to = intOpt(req, "to");
    if (to !== undefined) criteria.to = to;
    const offset = intOpt(req, "offset");
    if (offset !== undefined) criteria.offset = offset;
    const order = oneParam(req, "order");
    if (order === "asc" || order === "desc") criteria.order = order;
    return criteria;
  };

  /**
   * Résout un nom de fichier de log en chemin absolu **sûr** dans `logDir`.
   * Rejette tout nom hors `^[A-Za-z0-9._-]+\.log$` et tout chemin qui
   * s'échapperait du répertoire (anti path-traversal). `null` = invalide.
   */
  const resolveLogFile = (name: string): string | null => {
    if (!logDir || !LOG_NAME.test(name) || name.includes("..")) return null;
    const resolved = path.resolve(logDir, name);
    // Garde-fou : le parent résolu DOIT être exactement logDir.
    if (path.dirname(resolved) !== logDir) return null;
    return resolved;
  };

  /**
   * Lit la queue d'un fichier (octets `[start, size)`), ne renvoie que des
   * **lignes complètes** (jusqu'au dernier `\n`) pour éviter les lignes coupées
   * entre deux polls. `to` pointe sur la frontière de ligne → prochain `from`.
   */
  const readTail = async (
    file: string,
    start: number,
    size: number,
  ): Promise<{ text: string; to: number }> => {
    if (start >= size) return { text: "", to: size };
    const len = size - start;
    const buf = Buffer.alloc(len);
    const fh = await fsp.open(file, "r");
    try {
      await fh.read(buf, 0, len, start);
    } finally {
      await fh.close();
    }
    const chunk = buf.toString("utf8");
    const lastNl = chunk.lastIndexOf("\n");
    if (lastNl === -1) return { text: "", to: start };
    const complete = chunk.slice(0, lastNl); // sans le \n final
    const to = start + Buffer.byteLength(chunk.slice(0, lastNl + 1), "utf8");
    return { text: complete, to };
  };

  const descriptor: IAdminDescriptor = {
    label: "Logs",
    icon: "file-text",
    order: 3,
  };

  const endpoints: IAdminEndpoint[] = [
    {
      path: "logs",
      summary:
        "Logs récents via le driver backplane actif — ?severity=&module=&requestId=&text=&limit=N (renvoie un ARRAY, rétrocompat).",
      handler: async (request) => {
        // Délègue au driver de relecture ACTIF (memory par défaut). Renvoie un
        // tableau (récents d'abord) — forme rétrocompatible attendue par le front.
        // Driver non-queryable (ex. console) → tableau vide.
        const driver = getActiveLogDriver();
        if (!driver?.query) return [];
        const res = await driver.query(buildCriteria(request));
        return res.rows;
      },
    },
    {
      path: "logs/search",
      summary:
        "Query paginée du backplane → { rows, total, truncated } (DataGrid Studio). Mêmes critères que logs + offset.",
      handler: async (
        request,
      ): Promise<
        unknown | IAdminResponse<{ queryable: false; driver: string | null }>
      > => {
        const driver = getActiveLogDriver();
        if (!driver?.query) {
          return {
            status: 409,
            body: { queryable: false, driver: driver?.name ?? null },
          };
        }
        return await driver.query(buildCriteria(request));
      },
    },
    {
      path: "backplane",
      summary:
        "Méta du Log Backplane — driver de relecture actif, drivers dispo, sink write (LB.W), compteurs syslog.",
      handler: () => {
        const driver = getActiveLogDriver();
        return {
          // Axe DESTINATION queryable (où l'on RELIT).
          activeDriver: driver
            ? { name: driver.name, capabilities: driver.capabilities }
            : null,
          drivers: listLogDrivers(),
          // Axe WRITE (LB.W — où la ligne texte est écrite). Orthogonal.
          write: { sink: Syslog.logSinkName },
          // Santé du flux (cumuls monotones → débit dérivé côté lecteur).
          counters: {
            valid: syslog.valid,
            invalid: syslog.invalid,
            missed: syslog.missed,
            errorTotal: syslog.errorTotal,
            criticTotal: syslog.criticTotal,
            buffered: syslog.ringStack.length,
          },
          environment: options.environment ?? null,
        };
      },
    },
    {
      path: "backplane/driver",
      method: "POST",
      summary:
        "Switch du driver de relecture (DEV-only) — body { name }. Action de contrôle runtime.",
      handler: (request): IAdminResponse<{ error: string }> | unknown => {
        // 🔒 Action de contrôle runtime → DEV-only STRICT. En prod, le driver est
        // figé par config/env (12-factor). Le RBAC (ROLE_NODEFONY_ADMIN) est
        // appliqué en plus par le broker via `role`.
        if (options.environment !== "development") {
          return {
            status: 403,
            body: { error: "log driver switch is development-only" },
          };
        }
        const body = (request.body ?? {}) as { name?: unknown };
        const name = typeof body.name === "string" ? body.name : "";
        if (!name) {
          return { status: 400, body: { error: "missing driver name" } };
        }
        try {
          const d = setActiveLogDriver(name);
          return { active: d.name, capabilities: d.capabilities };
        } catch {
          return {
            status: 404,
            body: { error: `unknown log driver "${name}"` },
          };
        }
      },
    },
    {
      path: "info",
      summary: "Syslog counters — valid, invalid, missed, buffered",
      handler: () => ({
        valid: syslog.valid,
        invalid: syslog.invalid,
        missed: syslog.missed,
        buffered: syslog.ringStack.length,
      }),
    },
    {
      path: "files",
      summary:
        "Fichiers de log du tmpDir (DEV) — name, size, mtime. Désactivé en prod.",
      handler: async (): Promise<{
        enabled: boolean;
        reason?: string;
        files: LogFileMeta[];
      }> => {
        // Cloud-native : en prod, les logs vont sur stdout/stderr → collecteur.
        // Pas de fichiers à lister (rotation/rétention = rôle de la plateforme).
        if (!logDir) {
          return {
            enabled: false,
            reason:
              "Production : logs → stdout/stderr → collecteur (pas de fichiers).",
            files: [],
          };
        }
        let names: string[];
        try {
          names = await fsp.readdir(logDir);
        } catch {
          return { enabled: true, files: [] };
        }
        const files: LogFileMeta[] = [];
        for (const name of names) {
          if (!LOG_NAME.test(name)) continue;
          try {
            const st = await fsp.stat(path.join(logDir, name));
            if (st.isFile()) {
              files.push({ name, size: st.size, mtime: st.mtimeMs });
            }
          } catch {
            /* fichier disparu entre readdir et stat — ignoré */
          }
        }
        files.sort((a, b) => b.mtime - a.mtime); // plus récent d'abord
        return { enabled: true, files };
      },
    },
    {
      path: "files/{name}",
      summary:
        "Tail d'un fichier de log (DEV) — ?from=<offset>&lines=N&raw=1. " +
        "Sans from = N dernières lignes ; avec from = octets ajoutés (follow).",
      handler: async (
        request,
      ): Promise<LogTailResult | IAdminResponse<{ error: string }>> => {
        const name = request.params.name ?? "";
        const file = resolveLogFile(name);
        if (!file) {
          return { status: 400, body: { error: "invalid log file name" } };
        }
        let size: number;
        try {
          const st = await fsp.stat(file);
          if (!st.isFile()) {
            return { status: 400, body: { error: "not a file" } };
          }
          size = st.size;
        } catch {
          return { status: 404, body: { error: "log file not found" } };
        }

        const fromStr = oneParam(request, "from");
        const fromNum =
          fromStr !== undefined ? Number.parseInt(fromStr, 10) : NaN;
        const incremental =
          !Number.isNaN(fromNum) && fromNum >= 0 && fromNum <= size;
        // from > size → rotation/troncature externe : on repart de la fin.
        const reset = !Number.isNaN(fromNum) && fromNum > size;
        const lines = intParam(request, "lines", 500, 5000);

        const start = incremental
          ? fromNum
          : Math.max(0, size - MAX_TAIL_BYTES);
        const { text, to } = await readTail(file, start, size);

        let out = text === "" ? [] : text.split("\n");
        if (!incremental && start > 0 && out.length > 0) {
          out.shift(); // 1ʳᵉ ligne partielle (fenêtre démarrée en milieu de fichier)
        }
        if (!incremental) {
          out = out.slice(-lines); // tail initial : N dernières lignes complètes
        }

        const raw = oneParam(request, "raw") === "1";
        if (!raw) out = out.map(redactSecrets);

        return {
          name,
          size,
          from: start,
          to,
          reset,
          redacted: !raw,
          lines: out,
        };
      },
    },
  ];

  return {
    adminNamespace: "syslog",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}
