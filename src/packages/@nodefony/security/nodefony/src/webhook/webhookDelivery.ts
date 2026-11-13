import { fetchPublic } from "../net/fetchPublic";
import { FetchPublicError } from "../../errors/FetchPublicError";

/**
 * Émetteur HTTP d'une livraison webhook — délègue à {@link fetchPublic}, la
 * primitive unique des requêtes sortantes : pas de suivi de redirection, IP
 * vérifiée épinglée (anti DNS-rebinding), délai total, lecture bornée.
 */

/** Taille max du corps de réponse capturé (observabilité, anti-mémoire). */
const RESPONSE_BODY_CAP = 2048;

/** Résultat d'une tentative de livraison. */
export interface IDeliveryResult {
  /** Livraison acceptée (2xx) ? */
  readonly ok: boolean;
  /** Code HTTP, ou `null` si l'échec est réseau/timeout (pas de réponse). */
  readonly status: number | null;
  /** Message d'erreur (réseau/timeout/HTTP non-2xx), ou `null` si OK. */
  readonly error: string | null;
  /**
   * Début du corps de réponse du destinataire (tronqué à {@link RESPONSE_BODY_CAP}),
   * ou `null` si vide/réseau. Capturé pour l'historique de livraison (debug).
   */
  readonly responseBody?: string | null;
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
 * POST le corps signé vers l'URL, par {@link fetchPublic} : IP vérifiée épinglée,
 * aucune redirection suivie, délai TOTAL (un destinataire qui goutte un octet
 * ne retient pas la livraison) et lecture du corps coupée à
 * {@link RESPONSE_BODY_CAP} (connexion détruite, pas drainée). Ne lève jamais :
 * tout échec est encodé dans {@link IDeliveryResult}.
 */
export async function deliverWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
  opts: IDeliveryOptions,
): Promise<IDeliveryResult> {
  try {
    const vetted = opts.addresses !== undefined && opts.addresses.length > 0;
    const r = await fetchPublic(url, {
      method: "POST",
      headers,
      body,
      maxBytes: RESPONSE_BODY_CAP,
      timeoutMs: opts.timeoutMs,
      allowHttp: opts.allowHttp === true,
      // Sans IP vérifiée, l'appelant a levé la garde (dev) : seul le protocole
      // et les identifiants restent jugés.
      allowPrivate: !vetted,
      ...(vetted ? { vettedAddresses: opts.addresses } : {}),
    });
    const ok = r.status >= 200 && r.status < 300;
    const text = r.body.length > 0 ? new TextDecoder().decode(r.body) : "";
    return {
      ok,
      status: r.status,
      error: ok ? null : `HTTP ${r.status}`,
      responseBody: text.length > 0 ? text : null,
    };
  } catch (e) {
    if (e instanceof FetchPublicError && e.reason === "timeout") {
      return { ok: false, status: null, error: "timeout" };
    }
    return {
      ok: false,
      status: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
