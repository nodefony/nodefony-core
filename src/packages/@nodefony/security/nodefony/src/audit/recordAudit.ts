import type { Container } from "nodefony";
import type { IAuditEventDraft } from "../../contracts/IAuditEvent";
import type { IAuditSink } from "../../contracts/IAuditStore";

/**
 * Émet un événement d'audit **si** le service est présent — no-op sinon. La
 * résolution se fait par le container (`auditService`) sur le **cold-path**
 * (login, refus, révocation) : le coût d'un `Map.get` y est négligeable, et le
 * journal reste **découplé** (module audit absent ou désactivé → aucun effet,
 * jamais d'exception qui remonterait dans le flux métier).
 *
 * @param container - container du service émetteur (`this.container`).
 * @param event - brouillon d'événement (l'`AuditService` pose `id` + `ts`).
 */
export function recordAudit(
  container: Container | null | undefined,
  event: IAuditEventDraft,
): void {
  (container?.get("auditService") as IAuditSink | undefined)?.record(event);
}
