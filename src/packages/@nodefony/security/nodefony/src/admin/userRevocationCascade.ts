import type { Container } from "nodefony";
import { USER_REVOKED_EVENT, type IUserRevokedEvent } from "@nodefony/user";
import type { ITokenStore } from "../../contracts/ITokenStore";

/** Vue minimale du service `sessions` (http) — résolu par nom au runtime. */
interface SessionsLike {
  destroyByUser?(identifier: string): Promise<number>;
}

/** Bus d'événements minimal (kernel) capable d'abonner un handler. */
interface KernelListenerLike {
  on(event: string, handler: (...args: unknown[]) => void): unknown;
}

/**
 * Cascade de révocation déclenchée par {@link USER_REVOKED_EVENT} : éjecte
 * **immédiatement** les artefacts d'accès du porteur — ses **sessions** (http,
 * `destroyByUser`) et ses **jetons/PAT** (`tokenStore.revokeAllForSubject`,
 * seuil `invalidBefore`). Best-effort par brique (une indispo n'empêche pas
 * l'autre) — l'accès était DÉJÀ neutralisé par le re-fetch des authenticators,
 * cette cascade est de la **propreté + défense en profondeur**, jamais l'unique
 * rempart. `tenantId` du payload est réservé (scoping non câblé en mono-tenant).
 *
 * @param container - container du kernel (résolution lazy de `sessions`/`tokenStore`).
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
    await tokenStore?.revokeAllForSubject?.(identifier, now);
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
  kernel.on(USER_REVOKED_EVENT, (event: unknown) => {
    void cascadeUserRevocation(container, event as IUserRevokedEvent);
  });
}
