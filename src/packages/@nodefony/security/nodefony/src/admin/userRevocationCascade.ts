import type { Container } from "nodefony";
import { USER_REVOKED_EVENT, type IUserRevokedEvent } from "@nodefony/user";
import type { ITokenStore } from "../../contracts/ITokenStore";

/** Vue minimale du service `sessions` (http) — résolu par nom au runtime. */
interface SessionsLike {
  destroyByUser?(identifier: string): Promise<number>;
}

/** Vue minimale du service `totp` (security) — retrait du second facteur. */
interface TotpLike {
  isEnabled?(): boolean;
  disable?(identifier: string): Promise<void>;
}

/** Vue minimale du service `webauthn` (security) — retrait des passkeys. */
interface WebAuthnLike {
  isEnabled?(): boolean;
  listUserCredentials?(identifier: string): Promise<Array<{ id: string }>>;
  removeUserCredential?(
    identifier: string,
    credentialId: string,
  ): Promise<boolean>;
}

/** Bus d'événements minimal (kernel) capable d'abonner un handler. */
interface KernelListenerLike {
  on(event: string, handler: (...args: unknown[]) => unknown): unknown;
}

/**
 * Cascade de révocation déclenchée par {@link USER_REVOKED_EVENT} : éjecte
 * **immédiatement** les artefacts d'accès du porteur — ses **sessions** (http,
 * `destroyByUser`) et ses **jetons/PAT** (`tokenStore.revokeAllForSubject`,
 * seuil `invalidBefore`, qui couvre aussi les clés d'API). Best-effort par
 * brique (une indispo n'empêche pas l'autre) — l'accès était DÉJÀ neutralisé par
 * le re-fetch des authenticators. `tenantId` du payload est réservé (scoping non
 * câblé en mono-tenant).
 *
 * **Suppression du compte** (`reason: "deleted"`) : retire AUSSI ses facteurs —
 * secret TOTP (codes de récupération compris) et passkeys. Ils sont rangés sous
 * l'`identifier`, qu'un compte recréé peut reprendre : laissés en place, le
 * nouveau titulaire hériterait du second facteur de l'ancien. Un compte
 * seulement désactivé ou verrouillé les GARDE — il les retrouve à sa
 * réactivation.
 *
 * @param container - container du kernel (résolution lazy de `sessions`, `tokenStore`, `totp`, `webauthn`).
 * @param event - charge utile de l'événement (porteur + raison).
 * @param now - horloge (epoch ms) injectable pour les tests.
 */
export async function cascadeUserRevocation(
  container: Container,
  event: IUserRevokedEvent,
  now: number = Date.now(),
): Promise<void> {
  const identifier = event.identifier;
  // Sessions (http) — déconnexion partout.
  try {
    const sessions = container.get("sessions") as SessionsLike | undefined;
    await sessions?.destroyByUser?.(identifier);
  } catch {
    /* best-effort : l'indispo d'une brique ne bloque pas les autres */
  }
  // Tokens / PAT (security) — invalidation en masse par seuil `invalidBefore`.
  try {
    const tokenStore = container.get("tokenStore") as ITokenStore | undefined;
    await tokenStore?.revokeAllForSubject(identifier, now);
  } catch {
    /* best-effort */
  }
  if (event.reason !== "deleted") return;
  // Second facteur TOTP — sans contexte : pas d'audit « désactivé par le
  // titulaire », c'est la suppression du compte qui est l'événement audité.
  try {
    const totp = container.get("totp") as TotpLike | undefined;
    if (totp?.isEnabled?.() !== false) await totp?.disable?.(identifier);
  } catch {
    /* best-effort */
  }
  // Passkeys — une par une, par la porte owner-scopée du service.
  try {
    const webauthn = container.get("webauthn") as WebAuthnLike | undefined;
    if (webauthn?.isEnabled?.() !== false) {
      const creds = (await webauthn?.listUserCredentials?.(identifier)) ?? [];
      for (const cred of creds) {
        await webauthn?.removeUserCredential?.(identifier, cred.id);
      }
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Abonne la cascade au bus kernel. À appeler au `onKernelBoot` d'un module
 * bootable (ici `@nodefony/security`). **Extensible** : tout autre module
 * (webhooks…) peut s'abonner au MÊME `USER_REVOKED_EVENT` pour ses propres
 * artefacts, sans toucher à ce fichier.
 *
 * @param kernel - bus d'événements (kernel) exposant `on`.
 * @param container - container capturé par le handler.
 */
export function registerUserRevocationCascade(
  kernel: KernelListenerLike,
  container: Container,
): void {
  // Rend la promesse : un émetteur qui doit attendre la fin (une commande qui
  // termine son process juste après) passe par `fireAsync`.
  kernel.on(USER_REVOKED_EVENT, (event: unknown) =>
    cascadeUserRevocation(container, event as IUserRevokedEvent),
  );
}
