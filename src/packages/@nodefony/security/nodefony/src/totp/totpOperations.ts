import { Buffer } from "node:buffer";
import type { ITotpSecret } from "../../contracts/ITotpSecret";
import type { ITotpSecretStore } from "../../contracts/ITotpSecretStore";
import {
  type TotpAlgorithm,
  base32Encode,
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  matchRecoveryCode,
  verifyTotp,
} from "./totpCrypto";
import { decryptSecret, encryptSecret } from "./totpCipher";

/**
 * Dépendances résolues d'une opération TOTP — **injectées** (store, clé de
 * chiffrement, horloge) pour rendre toute la logique métier testable sans kernel
 * ni serveur. `TotpService` les résout au boot puis délègue ici (même esprit que
 * le verdict neutre d'idempotence).
 */
export interface ITotpDeps {
  store: ITotpSecretStore;
  /** Clé AES-256 de (dé)chiffrement du secret au repos (dérivée par le service). */
  key: Buffer;
  /** Horloge en ms — injectable pour les tests ; runtime = `Date.now`. */
  now: () => number;
  issuer: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  window: number;
  recoveryCodesCount: number;
}

/** Données d'enrôlement présentées **une seule fois** (QR + saisie manuelle). */
export interface ITotpEnrollment {
  /** Secret en base32 (scanné via le QR ou saisi à la main). */
  secretBase32: string;
  /** URI `otpauth://` encodé dans le QR code. */
  otpauthUri: string;
}

/** Résultat de l'activation — codes de récupération **clairs**, affichés 1×. */
export interface ITotpActivation {
  recoveryCodes: string[];
}

/** État 2FA d'un utilisateur (UI self-service / Studio). */
export interface ITotpStatus {
  /** 2FA activé (enrôlement confirmé). */
  enabled: boolean;
  /** Enrôlement commencé, pas encore confirmé. */
  pending: boolean;
  /** Codes de récupération restants (non consommés). */
  recoveryCodesRemaining: number;
}

/** Résultat d'une vérification de second facteur au login. */
export interface ITotpLoginResult {
  ok: boolean;
  /** Méthode ayant validé (utile pour l'audit). */
  method?: "totp" | "recovery";
}

/**
 * Démarre l'enrôlement : génère un secret aléatoire, le **chiffre** au repos et
 * l'enregistre en attente de confirmation (`confirmedAt: null`). Retourne le
 * secret en clair (base32 + URI) — **seul moment** où il est exposé. Idempotent :
 * un nouvel appel écrase un enrôlement non confirmé (re-scan du QR).
 */
export async function beginTotpEnrollment(
  deps: ITotpDeps,
  userId: string,
  account: string,
): Promise<ITotpEnrollment> {
  const secret = generateTotpSecret();
  const secretBase32 = base32Encode(secret);
  const now = deps.now();
  const record: ITotpSecret = {
    userId,
    secretEnc: encryptSecret(secret, deps.key),
    algorithm: deps.algorithm,
    digits: deps.digits,
    period: deps.period,
    recoveryCodes: [],
    confirmedAt: null,
    lastUsedStep: null,
    createdAt: now,
    lastUsedAt: null,
  };
  await deps.store.save(record);
  return {
    secretBase32,
    otpauthUri: buildOtpauthUri({
      issuer: deps.issuer,
      account,
      secretBase32,
      algorithm: deps.algorithm,
      digits: deps.digits,
      period: deps.period,
    }),
  };
}

/**
 * Confirme l'enrôlement : vérifie un 1ᵉʳ code généré par l'app, **active** le 2FA
 * et génère les codes de récupération (retournés clairs 1×, hachés au repos). Le
 * step de confirmation est marqué consommé (anti-rejeu). Lève si aucun enrôlement
 * n'est en cours, s'il est déjà confirmé, ou si le code est invalide (reste pending).
 */
export async function confirmTotpEnrollment(
  deps: ITotpDeps,
  userId: string,
  code: string,
): Promise<ITotpActivation> {
  const record = await deps.store.findByUser(userId);
  if (!record) {
    throw new Error("totp: aucun enrôlement en cours");
  }
  if (record.confirmedAt !== null) {
    throw new Error("totp: 2FA déjà activé");
  }
  const secret = decryptSecret(record.secretEnc, deps.key);
  const res = verifyTotp(code, secret, {
    epochMs: deps.now(),
    step: deps.period,
    digits: deps.digits,
    algorithm: deps.algorithm,
    window: deps.window,
  });
  if (!res.valid) {
    throw new Error("totp: code de confirmation invalide");
  }
  const recoveryCodes = generateRecoveryCodes(deps.recoveryCodesCount);
  const now = deps.now();
  await deps.store.update(userId, {
    confirmedAt: now,
    recoveryCodes: recoveryCodes.map(hashRecoveryCode),
    // `res.step` est défini (res.valid) → marque le step de confirmation consommé
    // (le code de confirmation n'est pas rejouable au 1ᵉʳ login).
    lastUsedStep: res.step,
    lastUsedAt: now,
  });
  return { recoveryCodes };
}

/**
 * Vérifie un second facteur au login : d'abord un code TOTP (fenêtre ±window,
 * **anti-rejeu** via `lastUsedStep`), à défaut un code de récupération (consommé,
 * usage unique). Retourne `ok: false` si le 2FA n'est pas activé ou si rien ne
 * correspond — **jamais d'exception** (chemin d'authentification).
 */
export async function verifyTotpLogin(
  deps: ITotpDeps,
  userId: string,
  code: string,
): Promise<ITotpLoginResult> {
  const record = await deps.store.findByUser(userId);
  if (!record || record.confirmedAt === null) {
    return { ok: false };
  }
  const secret = decryptSecret(record.secretEnc, deps.key);
  const res = verifyTotp(code, secret, {
    epochMs: deps.now(),
    step: deps.period,
    digits: deps.digits,
    algorithm: deps.algorithm,
    window: deps.window,
  });
  if (res.valid && res.step !== undefined) {
    // Anti-rejeu (RFC 6238 §5.2) : un step déjà consommé ne peut pas resservir.
    if (record.lastUsedStep !== null && res.step <= record.lastUsedStep) {
      return { ok: false };
    }
    await deps.store.update(userId, {
      lastUsedStep: res.step,
      lastUsedAt: deps.now(),
    });
    return { ok: true, method: "totp" };
  }
  // Repli code de récupération (usage unique).
  const idx = matchRecoveryCode(code, record.recoveryCodes);
  if (idx >= 0) {
    await deps.store.update(userId, {
      recoveryCodes: record.recoveryCodes.filter((_, i) => i !== idx),
      lastUsedAt: deps.now(),
    });
    return { ok: true, method: "recovery" };
  }
  return { ok: false };
}

/** Désactive le 2FA (retire le secret et les codes de récupération). */
export function disableTotp(deps: ITotpDeps, userId: string): Promise<void> {
  return deps.store.delete(userId);
}

/** État 2FA d'un utilisateur (absent / pending / activé + codes restants). */
export async function totpStatus(
  deps: ITotpDeps,
  userId: string,
): Promise<ITotpStatus> {
  const record = await deps.store.findByUser(userId);
  if (!record) {
    return { enabled: false, pending: false, recoveryCodesRemaining: 0 };
  }
  return {
    enabled: record.confirmedAt !== null,
    pending: record.confirmedAt === null,
    recoveryCodesRemaining: record.recoveryCodes.length,
  };
}
