import type { TotpAlgorithm } from "../src/totp/totpCrypto";

/**
 * Secret TOTP d'un utilisateur (2FA) — **un seul par utilisateur** (clé = `userId`).
 *
 * Le secret partagé `K` est **chiffré au repos** ({@link ITotpSecret.secretEnc}) :
 * le serveur doit pouvoir le **relire** pour recalculer le code à chaque login →
 * réversible, donc chiffré (AES-256-GCM), **jamais** haché (≠ mot de passe / clé
 * API). Les codes de récupération, eux, sont **hachés** (verify-only).
 */
export interface ITotpSecret {
  /** Identifiant de l'utilisateur propriétaire (clé naturelle). */
  readonly userId: string;
  /**
   * Secret partagé `K` **chiffré** (blob opaque : `iv.tag.ciphertext` base64url).
   * Produit/lu par le service détenteur de la clé — le store ne voit que des octets.
   */
  readonly secretEnc: string;
  /** Fonction HMAC du code (RFC 6238 §1.2). */
  readonly algorithm: TotpAlgorithm;
  /** Nombre de chiffres du code. */
  readonly digits: number;
  /** Période d'un code en secondes. */
  readonly period: number;
  /** Condensats `sha256` des codes de récupération **non encore consommés**. */
  recoveryCodes: string[];
  /**
   * Horodatage de **confirmation** de l'enrôlement (epoch ms), ou `null` tant que
   * l'utilisateur n'a pas prouvé qu'il lit bien les codes (anti-lock-out).
   */
  confirmedAt: number | null;
  /**
   * Dernière tranche temporelle `T` ayant validé un code (RFC 6238 §5.2) — un code
   * déjà consommé dans sa fenêtre **ne doit pas resservir** (anti-rejeu).
   */
  lastUsedStep: number | null;
  /** Horodatage de création (epoch ms). */
  readonly createdAt: number;
  /** Horodatage du dernier usage réussi (epoch ms), ou `null`. */
  lastUsedAt: number | null;
}

export default ITotpSecret;
