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
   */
  findByUser(userId: string): Promise<IWebAuthnCredential[]>;
  /** Persiste un nouveau credential (fin de la cérémonie d'enregistrement). */
  save(credential: IWebAuthnCredential): Promise<void>;
  /** Met à jour l'état post-authentification (compteur, sauvegarde, UV, usage). */
  update(credentialId: string, patch: WebAuthnAuthUpdate): Promise<void>;
  /** Révoque un credential (l'utilisateur retire un appareil). */
  delete(credentialId: string): Promise<void>;
}

export default IWebAuthnCredentialStore;
