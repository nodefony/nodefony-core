import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { isIP, type LookupFunction } from "node:net";
import { Buffer } from "node:buffer";

/**
 * Émetteur HTTP d'une livraison webhook — `node:http(s)` natif (0 dép). Trois
 * propriétés de sécurité par rapport à `fetch` :
 *
 * 1. **Pas de suivi de redirection** : `node:http(s)` ne suit JAMAIS les 3xx
 *    (contrairement à `fetch`) → un `302 → 169.254.169.254` ne contourne pas le
 *    contrôle SSRF ; le 3xx est rendu tel quel (échec de config).
 * 2. **Pin de l'IP validée** (anti DNS-rebinding) : `lookup` force la connexion TCP
 *    vers l'IP déjà contrôlée par `assertPublicUrl`, tout en gardant le hostname
 *    pour le SNI/TLS et l'en-tête `Host` → pas de re-résolution entre contrôle et
 *    connexion.
 * 3. **Timeout dur** : la requête est détruite au-delà du délai.
 */

/** Résultat d'une tentative de livraison. */
export interface IDeliveryResult {
  /** Livraison acceptée (2xx) ? */
  readonly ok: boolean;
  /** Code HTTP, ou `null` si l'échec est réseau/timeout (pas de réponse). */
  readonly status: number | null;
  /** Message d'erreur (réseau/timeout/HTTP non-2xx), ou `null` si OK. */
  readonly error: string | null;
}

/** Options de transport d'une livraison. */
export interface IDeliveryOptions {
  /** Délai max de la tentative (ms). */
  readonly timeoutMs: number;
  /** IP validées à **pinner** (la 1ʳᵉ est utilisée) ; vide = résolution normale. */
  readonly addresses?: readonly string[];
  /** Autorise `http:` (dev). Défaut : https only. */
  readonly allowHttp?: boolean;
}

/**
 * POST le corps signé vers l'URL, en pinnant l'IP validée et sans suivre les
 * redirections. Ne lève jamais : tout échec est encodé dans {@link IDeliveryResult}.
 */
export function deliverWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
  opts: IDeliveryOptions,
): Promise<IDeliveryResult> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return Promise.resolve({ ok: false, status: null, error: "URL invalide" });
  }
  const isHttps = u.protocol === "https:";
  if (!isHttps && !(u.protocol === "http:" && opts.allowHttp)) {
    return Promise.resolve({
      ok: false,
      status: null,
      error: `protocole ${u.protocol} non autorisé`,
    });
  }

  const pinned =
    opts.addresses && opts.addresses.length > 0 ? opts.addresses[0]! : null;
  const lookup: LookupFunction | undefined = pinned
    ? (_hostname, options, callback) => {
        const family = isIP(pinned) === 6 ? 6 : 4;
        if ((options as { all?: boolean }).all) {
          callback(null, [{ address: pinned, family }], family);
        } else {
          callback(null, pinned, family);
        }
      }
    : undefined;

  const payload = Buffer.from(body, "utf8");
  const requestFn = isHttps ? httpsRequest : httpRequest;

  return new Promise<IDeliveryResult>((resolve) => {
    let settled = false;
    const done = (r: IDeliveryResult): void => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const req = requestFn(
      url,
      {
        method: "POST",
        headers: { ...headers, "content-length": String(payload.length) },
        lookup,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const ok = status >= 200 && status < 300;
        res.resume(); // drain (jamais de suivi de 3xx : node ne suit pas)
        res.on("end", () =>
          done({ ok, status, error: ok ? null : `HTTP ${status}` }),
        );
        res.on("error", (e) => done({ ok: false, status, error: e.message }));
      },
    );
    req.setTimeout(opts.timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", (e: Error) =>
      done({ ok: false, status: null, error: e.message }),
    );
    req.write(payload);
    req.end();
  });
}
