import type {
  Container,
  IAdminEndpoint,
  IAdminRequest,
  IAdminResponse,
} from "nodefony";
import type { WebhookEndpointSummary } from "../../contracts/IWebhookEndpoint";
import { adminActor, auditAdmin } from "./adminAudit";

/**
 * Data plane admin des **webhooks sortants** (P6.13 Slice C) — endpoints
 * `/nodefony/security/api/webhooks/*` consommés par Studio (section Sécurité).
 *
 * Fichier dédié (greppable, isole toute la logique webhook) mais **composé**
 * dans le producteur `SecurityAdminApi` (namespace `security`) plutôt qu'exposé
 * via un Controller framework autonome : on hérite ainsi GRATUITEMENT du RBAC
 * `ROLE_NODEFONY_ADMIN` (appliqué par le broker, fail-closed `isAdminGranted`),
 * de l'audit, du duplex HTTP/WS et de la porte d'idempotence sur les mutations —
 * sans dupliquer la garde de rôle dans un controller (où elle a déjà régressé en
 * fail-open par le passé).
 *
 * Modèle d'autorisation = admin **PLATEFORME** (`ROLE_NODEFONY_ADMIN`) : les
 * webhooks sont une mécanique de sécurité système, pas une ressource par-user.
 * Anti-IDOR P6.13 : un admin voit/gère tout ; les slots `tenantId`/`createdBy`
 * sont réservés au scoping multi-tenant (P17). Le secret de signature
 * n'apparaît JAMAIS en lecture (chiffré au repos, `toSummary` l'omet) — seules
 * la création, la rotation et la révélation explicite l'exposent (audité).
 */

/** Driver logique du backend webhook (miroir du badge « où on écrit » Studio). */
type WebhookDriver = "memory" | "orm" | null;

/** Révélation d'un secret (création/rotation) — clair exposé une seule fois. */
interface IWebhookSecretRevealView {
  endpoint: WebhookEndpointSummary;
  secret: string;
}

/** Entrée de création projetée (l'admin ne pilote qu'un sous-ensemble sûr). */
interface IWebhookRegisterAdminInput {
  url: string;
  events: readonly string[];
  description?: string | null;
  enabled?: boolean;
  createdBy?: string | null;
}

/** Patch de mise à jour projeté (champs mutables non sensibles). */
interface IWebhookUpdateAdminPatch {
  url?: string;
  events?: readonly string[];
  enabled?: boolean;
  description?: string | null;
}

/**
 * Vue MINIMALE du service `webhooks` (@nodefony/security) consommée par l'ADMIN.
 * Couplage structurel (par nom de service) — on ne charge jamais la classe
 * concrète `WebhookService`.
 */
interface IWebhookAdmin {
  isReady(): boolean;
  register(
    input: IWebhookRegisterAdminInput,
  ): Promise<IWebhookSecretRevealView>;
  list(): Promise<WebhookEndpointSummary[]>;
  getEndpoint(id: string): Promise<WebhookEndpointSummary | null>;
  update(
    id: string,
    patch: IWebhookUpdateAdminPatch,
  ): Promise<WebhookEndpointSummary | null>;
  rotateSecret(id: string): Promise<IWebhookSecretRevealView | null>;
  revealSecret(id: string): Promise<string | null>;
  delete(id: string): Promise<boolean>;
}

/**
 * Forme minimale d'un store lue défensivement pour l'introspection du driver —
 * on ne veut QUE le nom de classe réel (jamais les méthodes/données).
 */
interface WebhookStoreLike {
  constructor?: { name?: string };
}

/**
 * Déduit le driver logique du store webhook depuis son nom de classe (miroir de
 * `tokenStoreDriver`). Fermé sur les implémentations connues ; `null` pour un
 * store tiers inconnu (honnête — on n'invente pas un driver). **Pas de variante
 * Redis** : un endpoint webhook est une donnée DURABLE (registre), sa place est
 * en SGBD, pas dans un cache volatil (Redis sert la file d'envoi cluster, pas le
 * registre — chantier séparé).
 *
 * @param className - `store.constructor.name` (ex. `DrizzleWebhookStore`).
 */
function webhookStoreDriver(className: string | undefined): WebhookDriver {
  switch (className) {
    case "MemoryWebhookStore":
      return "memory";
    case "DrizzleWebhookStore":
    case "MongooseWebhookStore":
      return "orm";
    default:
      return null;
  }
}

/** String non vide d'un corps de requête, ou `undefined`. */
function bodyString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Array de strings non vides (≥ 1 élément), ou `undefined` si invalide. */
function bodyStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  return v.every((x) => typeof x === "string" && x.length > 0)
    ? (v as string[])
    : undefined;
}

/**
 * Mappe une erreur du service webhook en réponse admin. Seule l'erreur SSRF
 * (`code === 422`, **duck-typée** — pas d'import de la classe `SsrfError`) est
 * « attendue » et traduite en 422 ; tout le reste remonte (le broker rend un 500
 * fail-closed, et logge).
 */
function mapWebhookError(e: unknown): IAdminResponse<{ error: string }> {
  const code = (e as { code?: unknown }).code;
  if (code === 422) {
    const message = (e as { message?: unknown }).message;
    return {
      status: 422,
      body: { error: typeof message === "string" ? message : "invalid url" },
    };
  }
  throw e;
}

const NOT_FOUND: IAdminResponse<{ error: string }> = {
  status: 404,
  body: { error: "not found" },
};
const UNAVAILABLE: IAdminResponse<{ error: string }> = {
  status: 503,
  body: { error: "webhooks unavailable" },
};

/**
 * Construit les endpoints admin webhook, à **spreader** dans les
 * `adminEndpoints()` du producteur `security`. Les handlers résolvent le service
 * `webhooks` **lazy** (à la requête) → un service désactivé/absent rend 503 (ou
 * un état honnête en lecture), jamais une erreur au montage.
 *
 * @param container - container du kernel (capturé par les handlers lazy).
 */
export function webhookAdminEndpoints(container: Container): IAdminEndpoint[] {
  const svc = (): IWebhookAdmin | undefined =>
    container.get("webhooks") as IWebhookAdmin | undefined;
  const ready = (s: IWebhookAdmin | undefined): s is IWebhookAdmin =>
    !!s && s.isReady();
  const pathId = (request: IAdminRequest): string | null => {
    const id = request.params.id;
    return typeof id === "string" && id.length > 0 ? id : null;
  };

  return [
    {
      path: "webhooks",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Endpoints webhook sortants (registre) + backend du store (« où on " +
        "écrit » : memory/orm). Secrets EXCLUS (chiffrés au repos, jamais ici).",
      handler: async (): Promise<{
        enabled: boolean;
        driver: WebhookDriver;
        store: string;
        endpoints: WebhookEndpointSummary[];
      }> => {
        const s = svc();
        const store = container.get("webhookStore") as
          | WebhookStoreLike
          | undefined;
        const className = store?.constructor?.name;
        // Lecture DÉFENSIVE (jamais de 503) : la console affiche toujours un
        // badge honnête + une table, même webhooks désactivés (→ liste vide).
        return {
          enabled: ready(s),
          driver: webhookStoreDriver(className),
          store: className ?? "none",
          endpoints: ready(s) ? await s.list() : [],
        };
      },
    },
    {
      path: "webhooks",
      method: "POST",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Crée un endpoint (URL validée anti-SSRF). Le secret de signature " +
        "n'est renvoyé QU'ICI, une seule fois. Audité (webhook.created).",
      handler: async (
        request: IAdminRequest,
      ): Promise<
        IAdminResponse<IWebhookSecretRevealView | { error: string }>
      > => {
        const s = svc();
        if (!ready(s)) return UNAVAILABLE;
        const body = (request.body ?? {}) as Record<string, unknown>;
        const url = bodyString(body.url);
        if (!url) return { status: 400, body: { error: "url required" } };
        const events = bodyStringArray(body.events);
        if (!events) {
          return {
            status: 400,
            body: { error: "events must be a non-empty string array" },
          };
        }
        if (
          body.description !== undefined &&
          body.description !== null &&
          typeof body.description !== "string"
        ) {
          return {
            status: 400,
            body: { error: "description must be a string" },
          };
        }
        if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
          return { status: 400, body: { error: "enabled must be a boolean" } };
        }
        const actor = adminActor(request.user);
        try {
          const created = await s.register({
            url,
            events,
            description:
              (body.description as string | null | undefined) ?? null,
            enabled: body.enabled as boolean | undefined,
            createdBy: actor,
          });
          auditAdmin(container, {
            category: "webhook",
            action: "webhook.created",
            outcome: "success",
            actor,
            resource: created.endpoint.id,
            metadata: { url },
          });
          return { status: 201, body: created };
        } catch (e) {
          return mapWebhookError(e);
        }
      },
    },
    {
      path: "webhooks/{id}",
      method: "GET",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Un endpoint webhook par id (vue publique, sans secret). 404 sinon.",
      handler: async (
        request: IAdminRequest,
      ): Promise<
        WebhookEndpointSummary | IAdminResponse<{ error: string }>
      > => {
        const s = svc();
        if (!ready(s)) return UNAVAILABLE;
        const id = pathId(request);
        if (!id) return NOT_FOUND;
        const ep = await s.getEndpoint(id);
        return ep ?? NOT_FOUND;
      },
    },
    {
      path: "webhooks/{id}",
      method: "PATCH",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Met à jour un endpoint (url/events/enabled/description). Une nouvelle " +
        "url est re-validée anti-SSRF. Audité (webhook.updated). 404 si absent.",
      handler: async (
        request: IAdminRequest,
      ): Promise<
        WebhookEndpointSummary | IAdminResponse<{ error: string }>
      > => {
        const s = svc();
        if (!ready(s)) return UNAVAILABLE;
        const id = pathId(request);
        if (!id) return NOT_FOUND;
        const body = (request.body ?? {}) as Record<string, unknown>;
        const patch: IWebhookUpdateAdminPatch = {};
        const fields: string[] = [];
        if ("url" in body) {
          const u = bodyString(body.url);
          if (!u) {
            return {
              status: 400,
              body: { error: "url must be a non-empty string" },
            };
          }
          patch.url = u;
          fields.push("url");
        }
        if ("events" in body) {
          const ev = bodyStringArray(body.events);
          if (!ev) {
            return {
              status: 400,
              body: { error: "events must be a non-empty string array" },
            };
          }
          patch.events = ev;
          fields.push("events");
        }
        if ("enabled" in body) {
          if (typeof body.enabled !== "boolean") {
            return {
              status: 400,
              body: { error: "enabled must be a boolean" },
            };
          }
          patch.enabled = body.enabled;
          fields.push("enabled");
        }
        if ("description" in body) {
          const d = body.description;
          if (d !== null && typeof d !== "string") {
            return {
              status: 400,
              body: { error: "description must be a string or null" },
            };
          }
          patch.description = d;
          fields.push("description");
        }
        const actor = adminActor(request.user);
        try {
          const updated = await s.update(id, patch);
          if (!updated) return NOT_FOUND;
          auditAdmin(container, {
            category: "webhook",
            action: "webhook.updated",
            outcome: "success",
            actor,
            resource: id,
            metadata: { fields },
          });
          return updated;
        } catch (e) {
          return mapWebhookError(e);
        }
      },
    },
    {
      path: "webhooks/{id}",
      method: "DELETE",
      role: "ROLE_NODEFONY_ADMIN",
      summary: "Supprime un endpoint. Audité (webhook.deleted). 404 si absent.",
      handler: async (
        request: IAdminRequest,
      ): Promise<{ ok: true } | IAdminResponse<{ error: string }>> => {
        const s = svc();
        if (!ready(s)) return UNAVAILABLE;
        const id = pathId(request);
        if (!id) return NOT_FOUND;
        const ok = await s.delete(id);
        if (!ok) return NOT_FOUND;
        auditAdmin(container, {
          category: "webhook",
          action: "webhook.deleted",
          outcome: "success",
          actor: adminActor(request.user),
          resource: id,
        });
        return { ok: true };
      },
    },
    {
      path: "webhooks/{id}/rotate",
      method: "POST",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Régénère le secret de signature (rotation) — nouveau secret renvoyé " +
        "QU'ICI, une fois. L'ancien cesse d'être valide. Audité. 404 si absent.",
      handler: async (
        request: IAdminRequest,
      ): Promise<
        IWebhookSecretRevealView | IAdminResponse<{ error: string }>
      > => {
        const s = svc();
        if (!ready(s)) return UNAVAILABLE;
        const id = pathId(request);
        if (!id) return NOT_FOUND;
        const rotated = await s.rotateSecret(id);
        if (!rotated) return NOT_FOUND;
        auditAdmin(container, {
          category: "webhook",
          action: "webhook.rotated",
          outcome: "success",
          actor: adminActor(request.user),
          resource: id,
        });
        return rotated;
      },
    },
    {
      path: "webhooks/{id}/reveal",
      method: "POST",
      role: "ROLE_NODEFONY_ADMIN",
      summary:
        "Révèle le secret de signature en clair (réversible — copie console). " +
        "Action SENSIBLE systématiquement audité (webhook.revealed). 404 sinon. " +
        "POST (pas GET) : jamais de secret dans une URL/log d'accès, CSRF requise.",
      handler: async (
        request: IAdminRequest,
      ): Promise<{ secret: string } | IAdminResponse<{ error: string }>> => {
        const s = svc();
        if (!ready(s)) return UNAVAILABLE;
        const id = pathId(request);
        if (!id) return NOT_FOUND;
        const secret = await s.revealSecret(id);
        if (secret === null) return NOT_FOUND;
        auditAdmin(container, {
          category: "webhook",
          action: "webhook.revealed",
          outcome: "success",
          actor: adminActor(request.user),
          resource: id,
        });
        return { secret };
      },
    },
  ];
}
