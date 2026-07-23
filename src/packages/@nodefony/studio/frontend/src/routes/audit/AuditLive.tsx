/**
 * Abonnement live au canal `nodefony:audit` — composant INVISIBLE monté
 * conditionnellement (`{live && <AuditLive/>}`). Tant qu'il n'est pas monté, aucun
 * abonnement (ref-compté → 0 ticker serveur quand le switch est OFF). À chaque
 * batch coalescé reçu, remonte au parent qui fusionne en tête de liste.
 *
 * Le canal (`auditModel` `SECURITY_AUDIT_CHANNEL`) est servi par
 * `createAuditBridge` côté security, sous réserve du rôle `ROLE_NODEFONY_ADMIN` :
 * un porteur non admin ne reçoit rien, sans erreur.
 */
import { useNodefonyChannel } from "nodefony/react";
import { SECURITY_AUDIT_CHANNEL, type AuditBatch } from "./auditModel";

export interface AuditLiveProps {
  /** Appelé à chaque batch reçu (events + nb omis sous surcharge). */
  onBatch: (batch: AuditBatch) => void;
}

export function AuditLive({ onBatch }: AuditLiveProps) {
  useNodefonyChannel(SECURITY_AUDIT_CHANNEL, (payload) => {
    const batch = payload as AuditBatch | null;
    if (batch && Array.isArray(batch.events)) {
      onBatch(batch);
    }
  });
  return null;
}
