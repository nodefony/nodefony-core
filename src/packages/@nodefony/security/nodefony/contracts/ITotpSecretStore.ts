import type { ITotpSecret } from "./ITotpSecret";

/** Champs mutables d'un secret TOTP (patch partiel). */
export interface TotpSecretUpdate {
  /** Confirmation de l'enrôlement (epoch ms) — passe le secret en « actif ». */
  confirmedAt?: number | null;
  /** Stock résiduel de codes de récupération hachés (après consommation). */
  recoveryCodes?: string[];
  /** Dernière tranche `T` validée (anti-rejeu RFC 6238 §5.2). */
  lastUsedStep?: number;
  /** Horodatage du dernier usage réussi (epoch ms). */
  lastUsedAt?: number;
}

/**
 * Store **pluggable** du secret TOTP par utilisateur — découple le cœur du backend
 * de persistance (mémoire / fichier / ORM / Redis). Convention-frère
 * d'`IWebAuthnCredentialStore` / `ITokenStore` : le builtin `memory` est sans
 * dépendance, les adapters lourds s'enregistrent depuis leur propre module.
 *
 * Modèle **1 secret / utilisateur** (clé = `userId`) — `save` est un **upsert**.
 */
export interface ITotpSecretStore {
  /** Secret TOTP de l'utilisateur, ou `null` si non enrôlé. */
  findByUser(userId: string): Promise<ITotpSecret | null>;
  /** Crée ou remplace le secret de l'utilisateur (upsert — ré-enrôlement). */
  save(secret: ITotpSecret): Promise<void>;
  /** Applique un patch partiel (confirmation, anti-rejeu, consommation de codes). */
  update(userId: string, patch: TotpSecretUpdate): Promise<void>;
  /** Supprime le secret de l'utilisateur (désactivation du 2FA). */
  delete(userId: string): Promise<void>;
}

export default ITotpSecretStore;
