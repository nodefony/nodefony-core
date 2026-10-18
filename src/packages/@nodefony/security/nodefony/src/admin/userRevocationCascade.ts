import type { Container, IBootNotice } from "nodefony";
import {
  USER_CREATED_EVENT,
  USER_REVOKED_EVENT,
  type IUserCreatedEvent,
  type IUserRevokedEvent,
} from "@nodefony/user";
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

/** Résolution d'un service par nom — tout ce que la purge demande au container. */
interface ServiceLookupLike {
  get(name: string): unknown;
}

/** Vue minimale du kernel pour journaliser — résolu par nom au runtime. */
interface KernelLoggerLike {
  log(pci: string, severity?: string, msgid?: string): unknown;
}

/** Garde : la valeur sait-elle journaliser (`log` est une fonction) ? */
function isKernelLogger(value: unknown): value is KernelLoggerLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "log" in value &&
    typeof value.log === "function"
  );
}

/**
 * Journalise l'échec d'une brique de la cascade. Le geste reste best-effort —
 * une brique en panne n'empêche pas les autres — mais il ne peut plus échouer
 * EN SILENCE : un accès qui survit à sa révocation (session encore ouverte
 * après un changement de mot de passe) doit laisser une trace qui dit laquelle.
 *
 * @param container - container du kernel (service `kernel`).
 * @param brick - brique en échec (`sessions`, `tokenStore`, `totp`, `webauthn`).
 * @param identifier - compte visé par la cascade.
 * @param error - erreur levée par la brique.
 */
function reportCascadeFailure(
  container: ServiceLookupLike,
  brick: string,
  identifier: string,
  error: unknown,
): void {
  try {
    const kernel: unknown = container.get("kernel");
    if (!isKernelLogger(kernel)) return;
    kernel.log(
      `révocation de "${identifier}" incomplète : la brique ${brick} a échoué — ` +
        (error instanceof Error ? error.message : String(error)),
      "ERROR",
      "SECURITY",
    );
  } catch {
    /* le signalement ne doit jamais faire échouer la cascade */
  }
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
  await revokeAccessArtifacts(container, identifier, now);
  if (event.reason === "deleted")
    await removeAccountFactors(container, identifier);
}

/**
 * Éjecte les artefacts d'accès rangés sous un identifiant — ses sessions (http,
 * `destroyByUser`) et ses jetons/PAT/clés d'API (`tokenStore.revokeAllForSubject`,
 * seuil `invalidBefore`). SEULE implémentation du geste, appelée à la révocation
 * d'un compte ET à sa création. Best-effort par brique : l'indisponibilité de
 * l'une n'empêche pas l'autre.
 *
 * @param container - container du kernel (services `sessions`, `tokenStore`).
 * @param identifier - `IUser.identifier` du compte.
 * @param invalidBefore - seuil (epoch ms) : tout jeton émis avant est rejeté.
 */
async function revokeAccessArtifacts(
  container: ServiceLookupLike,
  identifier: string,
  invalidBefore: number,
): Promise<void> {
  // Sessions (http) — déconnexion partout.
  try {
    const sessions = container.get("sessions") as SessionsLike | undefined;
    await sessions?.destroyByUser?.(identifier);
  } catch (error) {
    // Best-effort : l'indispo d'une brique ne bloque pas les autres — mais se DIT.
    reportCascadeFailure(container, "sessions", identifier, error);
  }
  // Tokens / PAT (security) — invalidation en masse par seuil `invalidBefore`.
  try {
    const tokenStore = container.get("tokenStore") as ITokenStore | undefined;
    await tokenStore?.revokeAllForSubject(identifier, invalidBefore);
  } catch (error) {
    reportCascadeFailure(container, "tokenStore", identifier, error);
  }
}

/**
 * Purge, à la NAISSANCE d'un compte, tout ce qu'un ancien titulaire du même
 * identifiant a laissé derrière lui : sessions, jetons et facteurs. Un compte
 * qui vient de naître n'a encore rien émis — tout artefact déjà rangé sous son
 * identifiant appartient donc à quelqu'un d'autre. C'est ce qui ferme le cas
 * d'un compte supprimé HORS du framework (`DELETE` SQL, aucun événement), dont
 * l'accès redeviendrait valide dès qu'un compte renaît sous son nom.
 *
 * Le seuil est tronqué à la SECONDE : l'`iat` d'un JWT l'est aussi (RFC 7519
 * §2, NumericDate), et un seuil à la milliseconde rejetterait le jeton du
 * nouveau titulaire émis dans la même seconde que sa création.
 *
 * @param container - container du kernel.
 * @param identifier - `IUser.identifier` du compte créé.
 * @param now - horloge (epoch ms) injectable pour les tests.
 */
export async function purgeInheritedAccess(
  container: ServiceLookupLike,
  identifier: string,
  now: number = Date.now(),
): Promise<void> {
  await revokeAccessArtifacts(
    container,
    identifier,
    Math.floor(now / 1000) * 1000,
  );
  await removeAccountFactors(container, identifier);
}

/**
 * Retire les facteurs rangés sous un identifiant — secret TOTP (codes de
 * récupération compris) et passkeys. SEULE implémentation du geste, appelée à
 * la suppression d'un compte ET à la création d'un compte sous cet identifiant.
 * Best-effort par brique : un TOTP indisponible n'empêche pas le retrait des
 * passkeys.
 *
 * @param container - container du kernel (services `totp`, `webauthn`).
 * @param identifier - `IUser.identifier` du compte.
 */
export async function removeAccountFactors(
  container: ServiceLookupLike,
  identifier: string,
): Promise<void> {
  // Sans contexte : pas d'audit « désactivé par le titulaire » — c'est le geste
  // sur le COMPTE (suppression, création) qui est l'événement audité.
  try {
    const totp = container.get("totp") as TotpLike | undefined;
    if (totp?.isEnabled?.() !== false) await totp?.disable?.(identifier);
  } catch (error) {
    reportCascadeFailure(container, "totp", identifier, error);
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
  } catch (error) {
    reportCascadeFailure(container, "webauthn", identifier, error);
  }
}

/** Garde : charge utile de {@link USER_CREATED_EVENT} (identifiant non vide). */
function isUserCreatedEvent(value: unknown): value is IUserCreatedEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "identifier" in value &&
    typeof value.identifier === "string" &&
    value.identifier.length > 0
  );
}

/**
 * Abonne la cascade au bus kernel, UNE fois, au `onKernelBoot` de
 * `@nodefony/security` — avant qu'aucun compte ne puisse être créé ou révoqué
 * (les comptes semés au démarrage compris). Deux abonnements :
 *  - {@link USER_REVOKED_EVENT} → {@link cascadeUserRevocation} ;
 *  - {@link USER_CREATED_EVENT} → {@link purgeInheritedAccess} : sessions,
 *    jetons et facteurs HÉRITÉS. Un compte qui vient de naître n'a encore rien
 *    émis ni enrôlé, donc tout artefact déjà rangé sous son identifiant
 *    appartient à un ancien titulaire. Règle exacte, aucune date à comparer.
 *    ⚠️ Un import qui chargerait les facteurs AVANT les comptes les verrait
 *    retirés : importer les comptes d'abord.
 *
 * Les deux sont émis par `UserService` seul, et attendus : chaque handler rend
 * sa promesse. **Extensible** : tout autre module (webhooks…) s'abonne aux
 * MÊMES événements pour ses propres artefacts, sans toucher à ce fichier.
 *
 * @param kernel - bus d'événements (kernel) exposant `on`.
 * @param container - container capturé par les handlers.
 */
export function registerUserRevocationCascade(
  kernel: KernelListenerLike,
  container: Container,
): void {
  kernel.on(USER_REVOKED_EVENT, (event: unknown) =>
    cascadeUserRevocation(container, event as IUserRevokedEvent),
  );
  kernel.on(USER_CREATED_EVENT, (event: unknown) =>
    isUserCreatedEvent(event)
      ? purgeInheritedAccess(container, event.identifier)
      : undefined,
  );
}

/**
 * Avis de démarrage quand le service `users` n'émet pas sur le bus du kernel —
 * construit sans container (`new UserService(repo, encoder)`). Ses événements
 * partent alors sur son propre bus, où personne n'écoute : supprimer un compte
 * laisserait ses sessions, ses jetons et ses facteurs en place, SANS UN MOT.
 *
 * @param container - container du kernel.
 * @param kernel - le kernel attendu comme bus des événements.
 * @returns l'avis à déclarer, ou `null` si `users` est absent ou bien câblé.
 */
export function usersEventBusNotice(
  container: ServiceLookupLike,
  kernel: object,
): IBootNotice | null {
  const users = container.get("users");
  if (typeof users !== "object" || users === null) return null;
  if (!("kernel" in users) || users.kernel === kernel) return null;
  return {
    code: "USERS_SERVICE_WITHOUT_KERNEL",
    level: "warning",
    message:
      "le service « users » n'atteint pas le kernel : supprimer, désactiver un " +
      "compte ou changer son mot de passe ne révoquera ni ses sessions, ni ses " +
      "jetons, ni ses facteurs.",
    fix: "new UserService(repository, encoder, module.container)",
  };
}
