import { BatchingHttpTransport } from "./BatchingHttpTransport";
import type { BatchTransportOptions } from "./BatchingHttpTransport";
import { pduToRecord } from "../drivers/ILogDriver";
import { resolveFetch, fetchWithTimeout } from "../httpFetch";
import type { FetchLike } from "../httpFetch";
import {
  basicAuthHeader,
  buildIndexTemplate,
  DEFAULT_OPENSEARCH_INDEX,
  OPENSEARCH_TEMPLATE_NAME,
  toOpenSearchDocument,
} from "../drivers/opensearchShared";
import { stripTrailingSlashes } from "../../Tools";
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
  readonly #baseUrl: string;
  /**
   * La pose du modèle d'index, tentée UNE fois.
   *
   * `null` tant que rien n'a été tenté — allocation paresseuse, comme tout ce qui
   * ne sert pas à chaque envoi. La promesse est mémorisée plutôt que rejouée :
   * deux lots partis de front poseraient sinon le même modèle deux fois.
   */
  #templatePosed: Promise<void> | null = null;

  constructor(options: OpenSearchTransportOptions) {
    super(options);
    this.#baseUrl = stripTrailingSlashes(options.url);
    this.#bulkUrl = this.#baseUrl + "/_bulk";
    this.#index = options.index ?? DEFAULT_OPENSEARCH_INDEX;
    this.#headers = {
      "content-type": "application/x-ndjson",
      ...basicAuthHeader(options.username, options.password),
      ...options.headers,
    };
    this.#timeoutMs = options.timeoutMs ?? 5000;
    this.#fetch = resolveFetch(options.fetchImpl);
  }

  /**
   * Pose le modèle d'index, au premier envoi et une seule fois.
   *
   * Au PREMIER ENVOI, pas au constructeur : un transport se construit à chaque
   * démarrage, y compris quand rien ne sera jamais journalisé vers OpenSearch, et
   * une requête réseau posée « au cas où » est exactement ce que la règle de
   * coût interdit. Au premier document, en revanche, le serveur est joignable par
   * construction — on est en train de lui écrire.
   *
   * Best-effort, comme le reste de ce transport : un modèle refusé (droits
   * insuffisants, serveur d'une autre famille) ne doit pas faire perdre des
   * journaux. Le document part quand même — il portera `@timestamp`, et c'est le
   * mapping dynamique qui décidera de son type.
   */
  async #ensureIndexTemplate(): Promise<void> {
    this.#templatePosed ??= (async () => {
      try {
        await fetchWithTimeout(
          this.#fetch,
          `${this.#baseUrl}/_index_template/${OPENSEARCH_TEMPLATE_NAME}`,
          {
            method: "PUT",
            headers: {
              ...this.#headers,
              "content-type": "application/json",
            },
            body: JSON.stringify(buildIndexTemplate(this.#index)),
          },
          this.#timeoutMs,
        );
      } catch {
        // Silencieux par nécessité : journaliser l'échec d'un transport de
        // journaux depuis ce transport tournerait en rond.
      }
    })();
    return this.#templatePosed;
  }

  protected async flushBatch(batch: Pdu[]): Promise<void> {
    await this.#ensureIndexTemplate();
    // NDJSON : action line + source line par document, terminé par un newline.
    const action = `{"index":{"_index":"${this.#index}"}}`;
    let body = "";
    for (const pdu of batch) {
      body +=
        action +
        "\n" +
        JSON.stringify(toOpenSearchDocument(pduToRecord(pdu))) +
        "\n";
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
