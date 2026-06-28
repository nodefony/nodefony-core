import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  Controller,
  controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
} from "@nodefony/framework";
import { Context } from "@nodefony/http";

/**
 * Récepteur webhook **local** pour tester les livraisons sortantes (P6.13) — le
 * remplaçant non-jetable de webhook.site, à demeure dans le module test.
 *
 * Pointer un endpoint webhook (console Studio) sur ce récepteur permet de :
 *  - **voir** ce qui est livré (en-têtes de signature + corps) via `GET /received` ;
 *  - **vérifier** la signature Standard Webhooks v1 de bout en bout (passer le
 *    secret en query `?secret=whsec_…` → `signatureValid` calculé HMAC-SHA256) ;
 *  - **simuler des erreurs** (`/sink/status/{code}`, `/sink/slow`) pour observer
 *    `lastDeliveryStatus`/`lastDeliveryError`/`failureCount` et l'auto-désactivation.
 *
 * Routes PUBLIQUES (une livraison arrive sans session ni bearer). Dev-only par
 * nature (le module test n'est pas chargé en prod). ⚠️ En dev, la config app pose
 * `webhooks.denyPrivateIps = false` + `allowHttp = true` pour autoriser une cible
 * `http://127.0.0.1:5152/...` (sinon le guard SSRF refuse, 422). Prod = strict.
 */

/** Une livraison reçue (capturée pour inspection). */
export interface SinkEntry {
  receivedAt: number;
  method: string;
  url: string;
  /** En-têtes Standard Webhooks. */
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
  contentType: string | null;
  /** Corps parsé (JSON) ou chaîne brute si non-JSON. */
  body: unknown;
  rawLength: number;
  /** `true`/`false` si un `?secret=` était fourni pour vérifier ; `null` sinon. */
  signatureValid: boolean | null;
  /** Status HTTP renvoyé au dispatcher (pour les routes de simulation). */
  respondedStatus: number;
}

/** Capacité du journal en mémoire (ring borné — perf : pas de fuite). */
const MAX_ENTRIES = 50;

/**
 * Journal des livraisons reçues — **lazy** (`null` tant qu'aucune livraison) puis
 * ring borné. Module-scope (persiste entre requêtes), comme `alsTestState`.
 */
export const webhookSinkState: { entries: SinkEntry[] | null } = {
  entries: null,
};

/** Premier élément d'un header possiblement multi-valué, ou `null`. */
function headerOne(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === "string" ? v : null;
}

/**
 * Vérifie une signature Standard Webhooks v1 (HMAC-SHA256 de `{id}.{ts}.{body}`)
 * en temps constant. Réplique l'algo de `@nodefony/security/webhookSignature`
 * (pas d'import d'interne serveur). `webhook-signature` peut contenir plusieurs
 * signatures séparées par un espace → on accepte si l'une matche.
 */
function verifySignature(
  secret: string,
  id: string | null,
  ts: string | null,
  raw: string,
  sigHeader: string | null,
): boolean {
  if (!id || !ts || !sigHeader) return false;
  const b64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = Buffer.from(b64, "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${ts}.${raw}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);
  return sigHeader.split(" ").some((part) => {
    const comma = part.indexOf(",");
    if (comma === -1) return false;
    if (part.slice(0, comma) !== "v1") return false;
    const got = Buffer.from(part.slice(comma + 1));
    return (
      got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf)
    );
  });
}

@controller("/nodefony/test/webhooks")
class WebhookSinkController extends Controller {
  constructor(context: Context) {
    super("WebhookSinkController", context);
  }

  /**
   * Enregistre une livraison (raw → parse → vérif signature optionnelle) et
   * renvoie `respondedStatus`. Cœur partagé par les routes de réception.
   */
  #record(raw: string, secret: string | undefined, status: number): SinkEntry {
    const context = this.context!;
    const headers = context.request!.headers;
    const id = headerOne(headers["webhook-id"]);
    const ts = headerOne(headers["webhook-timestamp"]);
    const sig = headerOne(headers["webhook-signature"]);
    let body: unknown = raw;
    try {
      body = raw.length > 0 ? JSON.parse(raw) : null;
    } catch {
      /* corps non-JSON → on garde le brut */
    }
    const entry: SinkEntry = {
      receivedAt: Date.now(),
      method: context.method ?? "POST",
      url: String(context.url ?? ""),
      webhookId: id,
      webhookTimestamp: ts,
      webhookSignature: sig,
      contentType: headerOne(headers["content-type"]),
      body,
      rawLength: Buffer.byteLength(raw),
      signatureValid: secret ? verifySignature(secret, id, ts, raw, sig) : null,
      respondedStatus: status,
    };
    // Lazy alloc + ring borné (perf : pas d'array « au cas où », pas de fuite).
    if (webhookSinkState.entries === null) webhookSinkState.entries = [];
    webhookSinkState.entries.unshift(entry);
    if (webhookSinkState.entries.length > MAX_ENTRIES) {
      webhookSinkState.entries.length = MAX_ENTRIES;
    }
    return entry;
  }

  /** Collecte le corps brut (mode stream → octets exacts envoyés, pour le HMAC). */
  async #readRaw(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of stream) {
      chunks.push(
        Buffer.isBuffer(c)
          ? c
          : typeof c === "string"
            ? Buffer.from(c, "utf8")
            : Buffer.from(c),
      );
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  /** Réception NOMINALE — répond 200. Vérifie la signature si `?secret=` fourni. */
  @Post("/sink")
  async sink(
    @Body({ stream: true }) stream: NodeJS.ReadableStream,
    @Query("secret") secret?: string,
  ) {
    const raw = await this.#readRaw(stream);
    const entry = this.#record(raw, secret, 200);
    return this.renderJson({ ok: true, signatureValid: entry.signatureValid });
  }

  /**
   * Réception qui RÉPOND un status au choix (`{code}` 200–599) → simule un
   * récepteur en erreur (4xx/5xx) pour observer les échecs/retries/auto-disable.
   */
  @Post("/sink/status/{code}")
  async sinkStatus(
    @Param("code") code: string,
    @Body({ stream: true }) stream: NodeJS.ReadableStream,
    @Query("secret") secret?: string,
  ) {
    const status = Number(code);
    if (!Number.isInteger(status) || status < 200 || status > 599) {
      return this.renderJson({ error: "code must be 200..599" }, 400);
    }
    const raw = await this.#readRaw(stream);
    this.#record(raw, secret, status);
    return this.renderJson({ ok: status < 400, status }, status);
  }

  /**
   * Réception LENTE — attend `?ms` (défaut 12 000) avant de répondre, pour
   * dépasser le timeout de livraison et observer une erreur réseau côté endpoint.
   */
  @Post("/sink/slow")
  async sinkSlow(
    @Body({ stream: true }) stream: NodeJS.ReadableStream,
    @Query("ms") ms?: string,
  ) {
    const raw = await this.#readRaw(stream);
    const delay = Math.min(Math.max(Number(ms) || 12_000, 0), 60_000);
    await new Promise((r) => setTimeout(r, delay));
    this.#record(raw, undefined, 200);
    return this.renderJson({ ok: true, delayedMs: delay });
  }

  /** Liste les livraisons reçues (plus récentes d'abord) — l'inspecteur. */
  @Get("/received")
  received() {
    const entries = webhookSinkState.entries ?? [];
    return this.renderJson({ count: entries.length, entries });
  }

  /** Vide le journal des livraisons reçues. */
  @Delete("/received")
  clear() {
    const cleared = webhookSinkState.entries?.length ?? 0;
    webhookSinkState.entries = null;
    return this.renderJson({ cleared });
  }
}

export default WebhookSinkController;
