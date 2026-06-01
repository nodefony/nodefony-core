import path from "node:path";
import { FileTransport } from "../transports/FileTransport";
import { LokiTransport } from "../transports/LokiTransport";
import { OpenSearchTransport } from "../transports/OpenSearchTransport";
import { createMemoryLogDriver } from "./MemoryLogDriver";
import {
  createFileLogDriver,
  type FileLogDriverOptions,
} from "./FileLogDriver";
import {
  createClusterFileLogDriver,
  type ClusterFileLogDriverOptions,
} from "./ClusterFileLogDriver";
import { createLokiLogDriver } from "./LokiLogDriver";
import { createOpenSearchLogDriver } from "./OpenSearchLogDriver";
import {
  registerLogDriverFactory,
  type ILogDriverContext,
} from "./logDriverRegistry";

/** Chemin du JSONL queryable de CE worker (write↔read pour file/cluster-file). */
function jsonlPath(ctx: ILogDriverContext): string {
  return (
    ctx.logCfg?.queryFile?.path ??
    path.join(ctx.logDir, `nodefony-${ctx.pid}.jsonl`)
  );
}

let registered = false;

/**
 * Enregistre les fabriques des drivers NATIFS du Log Backplane dans le
 * {@link registerLogDriverFactory registre de fabriques}. Idempotent (appelé à chaque
 * `initializeLog`, court-circuité après la 1ʳᵉ fois). C'est ICI — pas dans le Kernel —
 * que vit la connaissance « nom → comment construire ce driver ». Le Kernel ne fait que
 * résoudre + brancher, sans aucun `if (name === …)`.
 *
 * - `memory` : relit le ring buffer (aucun transport — alimenté par `Syslog`).
 * - `file` / `cluster-file` : relisent un/des JSONL ; écrivent via un `FileTransport`
 *   partagé (même `writeKey` = chemin → branché 1× même si les deux sont montés).
 * - `loki` / `opensearch` : push HTTP batché (transport) + relecture via leur API
 *   (driver) ; `null` si l'URL n'est pas configurée (→ fallback `memory` côté Kernel).
 */
export function registerBuiltinLogDrivers(): void {
  if (registered) return;
  registered = true;

  registerLogDriverFactory("memory", (ctx) => ({
    driver: createMemoryLogDriver(ctx.getRingStack),
  }));

  registerLogDriverFactory("file", (ctx) => {
    const p = jsonlPath(ctx);
    const opts: FileLogDriverOptions = { path: p };
    const scan = ctx.logCfg?.queryFile?.maxScanBytes;
    if (scan !== undefined) opts.maxScanBytes = scan;
    return {
      driver: createFileLogDriver(opts),
      transport: new FileTransport({ path: p, format: "json" }),
      writeKey: p,
    };
  });

  registerLogDriverFactory("cluster-file", (ctx) => {
    const p = jsonlPath(ctx);
    const opts: ClusterFileLogDriverOptions = { dir: path.dirname(p) };
    const scan = ctx.logCfg?.queryFile?.maxScanBytes;
    if (scan !== undefined) opts.maxScanBytes = scan;
    return {
      driver: createClusterFileLogDriver(opts),
      transport: new FileTransport({ path: p, format: "json" }),
      writeKey: p, // même JSONL que `file` → transport dédupliqué
    };
  });

  registerLogDriverFactory("loki", (ctx) => {
    const lk = ctx.logCfg?.loki;
    if (!lk?.url) return null;
    return {
      driver: createLokiLogDriver(lk),
      transport: new LokiTransport(lk),
      writeKey: `loki:${lk.url}`,
    };
  });

  registerLogDriverFactory("opensearch", (ctx) => {
    const os = ctx.logCfg?.opensearch;
    if (!os?.url) return null;
    return {
      driver: createOpenSearchLogDriver(os),
      transport: new OpenSearchTransport(os),
      writeKey: `opensearch:${os.url}`,
    };
  });
}
