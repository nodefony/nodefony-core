import { BatchingHttpTransport } from "./BatchingHttpTransport";
import type { BatchTransportOptions } from "./BatchingHttpTransport";
import { pduToRecord, stringifyLogRecord } from "../drivers/ILogDriver";
import { DEFAULT_LOKI_APP_LABEL } from "../drivers/LokiLogDriver";
import { resolveFetch, fetchWithTimeout } from "../httpFetch";
import type { FetchLike } from "../httpFetch";
import { resolveEndpoint } from "../drivers/endpoint";
import type Pdu from "../Pdu";

export interface LokiTransportOptions extends BatchTransportOptions {
  /** Base URL de Loki, ex. `http://127.0.0.1:3100` (sans le chemin d'API). */
  url: string;
  /**
   * Labels de STREAM constants (basse cardinalité). Défaut `{ app: "nodefony" }`.
   * ⚠️ Loki indexe les labels → garder PEU de labels et de faible cardinalité. Les
   * labels dynamiques `severity`/`module`/`pid` sont ajoutés automatiquement (bornés).
   * On n'y met JAMAIS `requestId` (haute cardinalité = explosion d'index) : il voyage
   * dans la LIGNE JSON et se filtre côté query.
   */
  labels?: Record<string, string>;
  /** Tenant multi-tenancy → header `X-Scope-OrgID`. Omis si absent. */
  tenantId?: string;
  /** Utilisateur de l'authentification basique (Grafana Cloud : l'identifiant de l'instance). Peut aussi venir de l'URL. */
  username?: string;
  /** Mot de passe de l'authentification basique (Grafana Cloud : un jeton d'accès). Peut aussi venir de l'URL. */
  password?: string;
  /** Headers HTTP additionnels (auth proxy, etc.). */
  headers?: Record<string, string>;
  /** Timeout du push (ms). Défaut 5000. */
  timeoutMs?: number;
  /** Implémentation `fetch` (tests / proxy). Défaut : `fetch` global. */
  fetchImpl?: FetchLike;
}

/** Une valeur de stream Loki : `[ "<unix_epoch_ns>", "<ligne>" ]`. */
type LokiValue = [string, string];

/**
 * Transport de logs vers **Grafana Loki** (LB.4) — push HTTP **batché** sur
 * `POST /loki/api/v1/push`. Étend {@link BatchingHttpTransport} : la queue/flush/
 * drop/cleanup sont mutualisés ; ici on ne fait que **formater le lot** au schéma
 * Loki (streams + values) et l'envoyer.
 *
 * Modèle : 1 requête HTTP par lot (jamais par log). Les Pdu sont regroupés par jeu
 * de labels (`{...base, severity, module, pid}`), les valeurs triées par timestamp
 * croissant (exigence Loki), chaque ligne = le record wire `stringifyLogRecord(pduToRecord)`
 * (timestamp en **nanosecondes** = `ms·10⁶`). Le `requestId` reste DANS la ligne JSON
 * (pas un label) → corrélation full-stack via `| json` côté LogQL, sans alourdir l'index.
 *
 * Node-only (destination prod). Couplé au driver {@link createLokiLogDriver} (write↔read
 * cohérents : on pousse ici, on relit là).
 */
export class LokiTransport extends BatchingHttpTransport {
  readonly name = "loki";
  readonly #pushUrl: string;
  readonly #baseLabels: Record<string, string>;
  readonly #headers: Record<string, string>;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(options: LokiTransportOptions) {
    super(options);
    const { base, auth } = resolveEndpoint(
      options.url,
      options.username,
      options.password,
    );
    this.#pushUrl = base + "/loki/api/v1/push";
    this.#baseLabels = options.labels ?? { app: DEFAULT_LOKI_APP_LABEL };
    this.#headers = {
      "content-type": "application/json",
      ...(options.tenantId ? { "X-Scope-OrgID": options.tenantId } : {}),
      ...auth,
      ...options.headers,
    };
    this.#timeoutMs = options.timeoutMs ?? 5000;
    this.#fetch = resolveFetch(options.fetchImpl);
  }

  protected async flushBatch(batch: Pdu[]): Promise<void> {
    // Regroupe par jeu de labels dynamiques (severity/module/pid) — chaque groupe
    // devient un stream Loki. Les valeurs d'un stream DOIVENT être triées par ts asc.
    const groups = new Map<
      string,
      { stream: Record<string, string>; pdus: Pdu[] }
    >();
    for (const pdu of batch) {
      const sev = pdu.severityName;
      const mod = pdu.moduleName;
      const pid = String(pdu.pid);
      const key = `${sev}\0${mod}\0${pid}`;
      let g = groups.get(key);
      if (g === undefined) {
        g = {
          stream: { ...this.#baseLabels, severity: sev, module: mod, pid },
          pdus: [],
        };
        groups.set(key, g);
      }
      g.pdus.push(pdu);
    }

    const streams: { stream: Record<string, string>; values: LokiValue[] }[] =
      [];
    for (const g of groups.values()) {
      g.pdus.sort((a, b) => a.timeStamp - b.timeStamp || a.uid - b.uid);
      const values: LokiValue[] = g.pdus.map((p) => [
        // ms → ns : on suffixe "000000" (pas de ×1e6 qui dépasserait MAX_SAFE_INTEGER).
        `${p.timeStamp}000000`,
        stringifyLogRecord(pduToRecord(p)),
      ]);
      streams.push({ stream: g.stream, values });
    }

    const res = await fetchWithTimeout(
      this.#fetch,
      this.#pushUrl,
      {
        method: "POST",
        headers: this.#headers,
        body: JSON.stringify({ streams }),
      },
      this.#timeoutMs,
    );
    if (!res.ok) {
      // 204 = succès Loki ; tout statut d'erreur → la base compte le lot en échec.
      throw new Error(`LokiTransport: push HTTP ${res.status}`);
    }
  }
}
