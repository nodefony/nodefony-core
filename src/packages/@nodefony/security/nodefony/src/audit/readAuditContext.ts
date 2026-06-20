import type { IAuditEventFlags } from "../../contracts/IAuditEvent";

/**
 * Forme MINIMALE d'un contexte HTTP/WS lue pour l'audit — calque l'extraction de
 * `JsonAuditLogger` (`@nodefony/http`) sans coupler `@nodefony/security` au type
 * concret `HttpContext`. Tous les champs sont optionnels (robustesse).
 */
interface AuditableContext {
  requestId?: string;
  remoteAddress?: string | null;
  getUserAgent?: () => string | undefined;
  request?: {
    headers?: Record<string, string | string[] | undefined>;
  } | null;
}

/** Métadonnées de provenance extraites d'un contexte, prêtes à enrichir un événement. */
export interface AuditContextInfo {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  flags: IAuditEventFlags;
}

/**
 * Extrait IP / User-Agent / requestId + drapeaux de présence (jamais la valeur)
 * d'un contexte de requête — pour enrichir un événement d'audit avec la
 * provenance (« d'où vient cette tentative »). Calque {@link JsonAuditLogger}.
 *
 * @param context - contexte HTTP/WS courant (typé `unknown` à la frontière).
 * @returns provenance normalisée ; champs `null` si l'info est absente.
 */
export function readAuditContext(context: unknown): AuditContextInfo {
  const ctx = (context ?? {}) as AuditableContext;
  const headers = ctx.request?.headers ?? {};
  return {
    ip: ctx.remoteAddress ?? null,
    userAgent: ctx.getUserAgent?.() ?? null,
    requestId: ctx.requestId ?? null,
    flags: {
      hasAuthorization: Boolean(headers["authorization"]),
      hasCookie: Boolean(headers["cookie"]),
    },
  };
}
