import type { Container } from "nodefony";
import type { IAuditEventDraft } from "../../contracts/IAuditEvent";

/**
 * Helpers d'audit PARTAGÉS par les producteurs admin du module sécurité
 * (`SecurityAdminApi`, `WebhookAdminApi`…). Extraits dans leur propre fichier
 * pour être consommés par plusieurs producteurs SANS créer de cycle d'import
 * (un producteur composé ne ré-importe pas le producteur qui le compose).
 */

/**
 * Identité de l'admin appelant (label d'audit) — duck-typing prudent sur
 * l'`IUser` projeté dans `IAdminRequest.user` (ALS du firewall). Repli
 * `"admin"` (libellé d'audit, jamais une décision d'autorisation).
 *
 * @param user - `request.user` du broker admin.
 * @returns un libellé d'identité stable, jamais un secret.
 */
export function adminActor(user: unknown): string {
  if (user && typeof user === "object") {
    const u = user as { username?: unknown; identifier?: unknown };
    if (typeof u.username === "string" && u.username) return u.username;
    if (typeof u.identifier === "string" && u.identifier) return u.identifier;
  }
  return "admin";
}

/**
 * Émet un événement d'audit pour une mutation admin (best-effort,
 * fire-and-forget) — l'audit ne doit jamais bloquer ni faire échouer l'action.
 * No-op si le service `auditService` est absent. Couplage structurel : `record`
 * lu défensivement (jamais d'import de la classe concrète).
 *
 * @param container - container du kernel.
 * @param draft - événement (sans `id`/`ts`, posés par le service).
 */
export function auditAdmin(
  container: Container,
  draft: IAuditEventDraft,
): void {
  const sink = container.get("auditService") as
    { record?: (event: IAuditEventDraft) => void } | undefined;
  sink?.record?.(draft);
}
