import type { IWebAuthnCredential } from "./IWebAuthnCredential";

/** État mis à jour après une authentification réussie (WebAuthn §7.2). */
export interface WebAuthnAuthUpdate {
  /** Nouveau compteur de signatures (anti-clone). */
  signCount: number;
  /** Nouvel état de sauvegarde (BS flag). */
  backupState: boolean;
  /** UV réalisée durant cette cérémonie. */
  uvInitialized: boolean;
  /** Horodatage de l'usage (epoch ms). */
  lastUsedAt: number;
}

/**
 * Store **pluggable** des credentials WebAuthn — découple le cœur du backend de
 * persistance (mémoire / ORM / Redis). Convention-frère d'`ITokenStore` :
 * le builtin `memory` est sans dépendance, les adapters lourds s'enregistrent
 * depuis leur propre module (inversion de dépendance).
 */
export interface IWebAuthnCredentialStore {
  /** Credential par son id (base64url), ou `null` — résolution à l'authentification. */
  findById(credentialId: string): Promise<IWebAuthnCredential | null>;
  /**
   * Tous les credentials d'un utilisateur — pour `allowCredentials`
   * (authentification ciblée) et l'UX « mes appareils ».
   *
   * **Volontairement NON paginé** : `allowCredentials` doit être COMPLET ou il
   * est faux — un authenticator dont la passkey manque de la liste ne peut pas
   * répondre au défi, et le protocole WebAuthn n'offre aucun « page suivante »
   * (le navigateur reçoit une liste unique et choisit). Ce qui borne cet appel
   * est le plafond d'enrôlement (`passkeys.maxPerUser`), pas une pagination.
   */
  findByUser(userId: string): Promise<IWebAuthnCredential[]>;
  /**
   * Nombre de credentials d'un utilisateur — **natif** par backend (`COUNT`,
   * `countDocuments`, `SCARD`), jamais un `findByUser().length`.
   *
   * Sert le plafond d'enrôlement (`passkeys.maxPerUser`) : le chemin
   * d'enregistrement ne doit pas charger N credentials pour en compter le
   * nombre, et le plafond est ce qui garantit que {@link findByUser} reste borné.
   */
  countByUser(userId: string): Promise<number>;
  /** Persiste un nouveau credential (fin de la cérémonie d'enregistrement). */
  save(credential: IWebAuthnCredential): Promise<void>;
  /** Met à jour l'état post-authentification (compteur, sauvegarde, UV, usage). */
  update(credentialId: string, patch: WebAuthnAuthUpdate): Promise<void>;
  /** Révoque un credential (l'utilisateur retire un appareil). */
  delete(credentialId: string): Promise<void>;
}

export default IWebAuthnCredentialStore;
