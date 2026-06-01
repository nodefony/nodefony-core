import { BatchingHttpTransport } from "./BatchingHttpTransport";
import type { BatchTransportOptions } from "./BatchingHttpTransport";
import { pduToRecord } from "../drivers/ILogDriver";
import { resolveFetch, fetchWithTimeout } from "../httpFetch";
import type { FetchLike } from "../httpFetch";
import {
  basicAuthHeader,
  DEFAULT_OPENSEARCH_INDEX,
} from "../drivers/opensearchShared";
import type Pdu from "../Pdu";

export interface OpenSearchTransportOptions extends BatchTransportOptions {
  /** Base URL d'OpenSearch, ex. `http://127.0.0.1:9200` (sans chemin d'API). */
  url: string;
  /** Index cible (défaut `nodefony-logs`). Doit matcher celui du driver query. */
  index?: string;
  /** Utilisateur (auth basic) — prod avec plugin sécurité activé. */
  username?: string;
  /** Mot de passe (auth basic). */
  password?: string;
  /** Headers HTTP additionnels. */
  headers?: Record<string, string>;
  /** Timeout du bulk (ms). Défaut 5000. */
  timeoutMs?: number;
  /** Implémentation `fetch` (tests / proxy). Défaut : `fetch` global. */
  fetchImpl?: FetchLike;
}

/**
 * Transport de logs vers **OpenSearch** (LB.4) — indexation **batchée** via l'API
 * `POST /_bulk` (NDJSON). Étend {@link BatchingHttpTransport} (queue/flush/drop
 * mutualisés) ; ici on formate le lot au protocole bulk et on l'envoie.
 *
 * Protocole bulk : paires de lignes `{"index":{"_index":"…"}}\n` + `<document>\n`,
 * le corps DOIT se terminer par un newline (OpenSearch parse par `\n`). Le document
 * = record wire (`pduToRecord`) → mapping dynamique OpenSearch ; `requestId`/
 * `moduleName`/`severityName` deviennent des champs `text` + sous-champ `.keyword`
 * requêtables (cf {@link createOpenSearchLogDriver}). `timeStamp` (epoch ms) =
 * champ numérique → range/sort efficaces.
 *
 * Node-only (destination prod). Couplé au driver {@link createOpenSearchLogDriver}.
 */
export class OpenSearchTransport extends BatchingHttpTransport {
  readonly name = "opensearch";
  readonly #bulkUrl: string;
  readonly #index: string;
  readonly #headers: Record<string, string>;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(options: OpenSearchTransportOptions) {
    super(options);
    this.#bulkUrl = options.url.replace(/\/+$/, "") + "/_bulk";
    this.#index = options.index ?? DEFAULT_OPENSEARCH_INDEX;
    this.#headers = {
      "content-type": "application/x-ndjson",
      ...basicAuthHeader(options.username, options.password),
      ...options.headers,
    };
    this.#timeoutMs = options.timeoutMs ?? 5000;
    this.#fetch = resolveFetch(options.fetchImpl);
  }

  protected async flushBatch(batch: Pdu[]): Promise<void> {
    // NDJSON : action line + source line par document, terminé par un newline.
    const action = `{"index":{"_index":"${this.#index}"}}`;
    let body = "";
    for (const pdu of batch) {
      body += action + "\n" + JSON.stringify(pduToRecord(pdu)) + "\n";
    }

    const res = await fetchWithTimeout(
      this.#fetch,
      this.#bulkUrl,
      { method: "POST", headers: this.#headers, body },
      this.#timeoutMs,
    );
    if (!res.ok) {
      throw new Error(`OpenSearchTransport: bulk HTTP ${res.status}`);
    }
    // OpenSearch renvoie 200 même si CERTAINS items échouent (`errors:true`). On ne
    // bloque pas le pipeline pour autant : best-effort, l'index est secondaire.
  }
}
