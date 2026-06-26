import { createHash } from "node:crypto";
import { RequestContext } from "nodefony";
import type { IIdempotencyStore, IdempotentResponse } from "nodefony";

/**
 * Logique **pure et partagée** de la porte d'idempotence des mutations, conforme à
 * `draft-ietf-httpapi-idempotency-key-header-06`. Source unique de la sémantique
 * (statuts normatifs, scope de clé, fingerprint, bornage) consommée par les DEUX
 * call-sites qui mutent :
 *  - le **data plane admin** (`AdminApiController` — réponse `{status,headers,body}`) ;
 *  - les **controllers userland** décorés `@Idempotent` (seam `Resolver`).
 *
 * Le helper ne connaît AUCUN transport ni format de réponse : il rend un
 * {@link IdempotencyVerdict} neutre que chaque call-site traduit dans son monde
 * (court-circuit HTTP, `RpcError` WS, throw `nodefonyError`…). Garantit que la
 * sémantique IETF est décidée à UN seul endroit (cf retex S4 : statuts décidés
 * depuis la spec, pas de mémoire).
 */

/**
 * Méthodes HTTP considérées comme **mutations** (non sûres, RFC 9110 §9.2.1) →
 * éligibles à l'idempotence. Les méthodes sûres (GET/HEAD/OPTIONS/TRACE) et le
 * pseudo-verbe `WEBSOCKET` n'en font pas partie → `@Idempotent` y est un no-op.
 */
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** `true` si la méthode est une mutation éligible à l'idempotence. */
export function isMutationMethod(method: string | null | undefined): boolean {
  return method != null && MUTATION_METHODS.has(method.toUpperCase());
}

/**
 * Borne d'une clé d'idempotence (convention Stripe). Une clé est un identifiant
 * court (UUID) ; au-delà, elle est traitée comme ABSENTE (anti-DoS du cache borné).
 */
export const IDEMPOTENCY_KEY_MAX = 255;

/**
 * Verdict **neutre** rendu par {@link evaluateIdempotency} — décrit QUOI faire
 * sans rien savoir du transport :
 *  - `execute` : pas de clé en mode souple, ou store/identité absents → exécuter
 *    SANS mémoriser (jamais de partage cross-identité).
 *  - `guarded` : clé fraîche réservée *in-flight* → exécuter PUIS `complete(key)`
 *    (succès) ou `abort(key)` (échec), `key` = clé scopée à réutiliser telle quelle.
 *  - `replay` : rejeu d'une mutation déjà complétée → renvoyer `response` SANS
 *    exécuter.
 *  - `reject` : court-circuit d'erreur (400 clé requise / 409 concurrent / 422
 *    clé réutilisée avec un autre payload).
 */
export type IdempotencyVerdict =
  | { kind: "execute" }
  | { kind: "guarded"; key: string }
  | { kind: "replay"; response: IdempotentResponse }
  | {
      kind: "reject";
      status: 400 | 409 | 422;
      message: string;
      detail?: string;
    };

/**
 * Résout la clé d'idempotence d'une requête : posée dans l'ALS par le pont WS
 * (`als.idempotencyKey`) ou lue de l'en-tête HTTP `Idempotency-Key` (clé
 * minuscule côté Node, éventuellement répétée → premier élément). L'ALS prime sur
 * l'en-tête. Une clé > {@link IDEMPOTENCY_KEY_MAX} est traitée comme **absente**
 * (anti-DoS) plutôt que stockée. `undefined` si rien d'exploitable.
 */
export function resolveIdempotencyKey(
  alsKey: unknown,
  header: unknown,
): string | undefined {
  let raw: string | undefined;
  if (typeof alsKey === "string" && alsKey) {
    raw = alsKey;
  } else if (typeof header === "string" && header) {
    raw = header;
  } else if (
    Array.isArray(header) &&
    typeof header[0] === "string" &&
    header[0]
  ) {
    raw = header[0];
  }
  return raw && raw.length <= IDEMPOTENCY_KEY_MAX ? raw : undefined;
}

/**
 * Identité stable pour **scoper** le cache d'idempotence (anti-IDOR : un
 * utilisateur ne doit jamais rejouer la clé d'un autre). Dérivée de l'utilisateur
 * (`username` / `identifier` / `id`, sans coupler le framework au contrat `IUser`),
 * avec fallback sur l'`userId` de l'ALS. `null` = pas d'identité fiable → l'appelant
 * n'utilise PAS le cache (jamais de partage cross-identité).
 *
 * ⚠️ Doit renvoyer la MÊME valeur quel que soit le transport pour un même compte
 * (sinon une mutation tentée en WS puis rejouée en HTTP ne dédoublonnerait pas).
 * D'où la dérivation de `request.user` (posé UNIFORMÉMENT dans l'ALS par les deux
 * transports), et NON de `getUserId()` seul (le firewall HTTP ne le pose pas
 * toujours — vécu S4).
 */
export function resolveIdentity(user: unknown): string | null {
  if (user && typeof user === "object") {
    const o = user as {
      username?: unknown;
      identifier?: unknown;
      id?: unknown;
    };
    for (const v of [o.username, o.identifier, o.id]) {
      if (typeof v === "string" && v) {
        return v;
      }
    }
  }
  const uid = RequestContext.getUserId();
  return typeof uid === "string" && uid ? uid : null;
}

/**
 * Empreinte SHA-256 du **payload** d'une requête (parties sérialisables : nom de
 * route + params + corps). Comparée par le store à l'empreinte mémorisée pour une
 * clé : si elle diffère, la clé est réutilisée pour une AUTRE requête → 422
 * (draft §2.4). Hash → empreinte courte (anti-DoS mémoire) + comparaison O(1).
 */
export function computeFingerprint(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/**
 * Cœur normatif : à partir de la clé client, de l'identité, du fingerprint et du
 * transport, rend le {@link IdempotencyVerdict} à appliquer. La réservation
 * (`store.begin`) est **atomique** (mono-thread JS côté mémoire, `SET … NX` côté
 * Redis) ; le store peut être sync (mémoire) ou async (distribué) → `begin` est
 * `await`é, d'où le retour `Promise<IdempotencyVerdict>`.
 *
 * Le `required` **effectif** = `required || isWs` : une mutation par socket exige
 * TOUJOURS une clé (le WS reconnecte/rejoue → muter sans garde-fou exposerait au
 * double-effet), tandis qu'en HTTP la clé n'est exigée qu'en mode strict
 * (`@Idempotent()` par défaut). Cela unifie les deux call-sites :
 *  - admin : `required=false` → exige la clé seulement en WS (comportement S4) ;
 *  - `@Idempotent()` : `required=true` (strict) → exige la clé même en HTTP ;
 *  - `@Idempotent({required:false})` : souple en HTTP, mais toujours strict en WS.
 */
export async function evaluateIdempotency(opts: {
  /**
   * Store résolu, ou `null`/`undefined` (service absent → dégrade en exécution
   * directe). Accepte les deux : `Controller.get()` renvoie `null`, un
   * `container.get()` peut renvoyer `undefined`.
   */
  store: IIdempotencyStore | null | undefined;
  /** Identité scope (cf {@link resolveIdentity}), ou `null` → pas de cache. */
  identity: string | null;
  /** Clé client résolue (cf {@link resolveIdempotencyKey}), ou `undefined`. */
  clientKey: string | undefined;
  /** Empreinte du payload (cf {@link computeFingerprint}). */
  fingerprint: string;
  /** La requête arrive-t-elle par socket ? (clé alors obligatoire.) */
  isWs: boolean;
  /** Exigence déclarée d'une clé (mode strict). */
  required: boolean;
}): Promise<IdempotencyVerdict> {
  const requiredEffective = opts.required || opts.isWs;
  if (!opts.clientKey) {
    if (requiredEffective) {
      return {
        kind: "reject",
        status: 400,
        message: opts.isWs
          ? "Idempotency-Key required for socket mutations"
          : "Idempotency-Key required",
      };
    }
    // Mutation sans clé en mode souple (HTTP) : comportement direct, pas de dédup.
    return { kind: "execute" };
  }
  // Clé présente mais pas de store ou pas d'identité fiable → exécution directe
  // (jamais de cache partagé cross-identité).
  if (!opts.store || !opts.identity) {
    return { kind: "execute" };
  }
  // Clé du cache = [identité, clé client] encodé JSON (frontières non ambiguës,
  // sans séparateur magique). Une Idempotency-Key identifie l'INTENTION d'un
  // appelant → scope (identité, clé).
  const key = JSON.stringify([opts.identity, opts.clientKey]);
  const outcome = await opts.store.begin(key, opts.fingerprint);
  switch (outcome.state) {
    case "mismatch":
      // draft §2.7 : clé réutilisée avec un autre payload → 422 (RFC 9110 §15.5.21).
      return {
        kind: "reject",
        status: 422,
        message: "Idempotency-Key is already used",
        detail:
          "This Idempotency-Key was used with a different payload; a key must not be reused across different requests.",
      };
    case "in-flight":
      return {
        kind: "reject",
        status: 409,
        message: "Conflict: an identical request is already in progress",
      };
    case "replayed":
      return { kind: "replay", response: outcome.response };
    case "fresh":
    default:
      return { kind: "guarded", key };
  }
}
