import type { IPage, IPageQuery } from "nodefony";
import type { ITotpSecret } from "./ITotpSecret";

/**
 * Vue d'un enrôlement 2FA pour l'INTROSPECTION admin (« qui a activé le 2FA,
 * qui est resté en attente de confirmation »).
 *
 * **Sans secret, par construction du contrat** — ni `secretEnc` (le secret
 * partagé, réversible : il permettrait de générer les codes de la victime), ni
 * `recoveryCodes` (leurs condensats, matière à attaque hors ligne). La garantie
 * porte sur ce qui SORT du store : quel que soit le backend, ces champs ne
 * peuvent pas remonter par ce chemin, même si un appelant les demandait. Le
 * NOMBRE de codes restants, lui, est exposé — c'est l'information
 * d'exploitation (qui se verrouillera au prochain changement d'appareil).
 */
export interface ITotpEnrollmentSummary {
  /** Utilisateur propriétaire. */
  readonly userId: string;
  /** Fonction HMAC du code (RFC 6238 §1.2). */
  readonly algorithm: string;
  /** Nombre de chiffres du code. */
  readonly digits: number;
  /** Période d'un code en secondes. */
  readonly period: number;
  /** Confirmation de l'enrôlement (epoch ms), ou `null` = en attente. */
  readonly confirmedAt: number | null;
  /** Création de l'enrôlement (epoch ms). */
  readonly createdAt: number;
  /** Dernier usage réussi (epoch ms), ou `null` = jamais servi. */
  readonly lastUsedAt: number | null;
  /** Nombre de codes de récupération NON consommés (jamais les condensats). */
  readonly recoveryCodesLeft: number;
}

/**
 * Requête de listing des enrôlements 2FA — {@link IPageQuery} + les filtres qui
 * ont un sens ici. `q` (hérité) = **préfixe** d'`userId` (retrouver un id
 * partiel collé depuis la console).
 */
export interface ITotpListQuery extends IPageQuery {
  /**
   * `true` = enrôlements confirmés seulement, `false` = en attente seulement
   * (comptes à relancer : un secret jamais confirmé ne protège personne),
   * omis = les deux.
   */
  confirmed?: boolean;
}

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
  /**
   * Page d'enrôlements 2FA pour le data plane admin — ne matérialise jamais
   * plus d'une page, filtres appliqués au store, **secrets exclus** (cf
   * {@link ITotpEnrollmentSummary}).
   *
   * Ordre contractuel : `createdAt` DESC, départagé par `userId` ASC.
   */
  listPage(query: ITotpListQuery): Promise<IPage<ITotpEnrollmentSummary>>;
  /**
   * Nombre d'enrôlements correspondant aux filtres (`COUNT` natif) — le KPI
   * « couverture 2FA » sans énumérer.
   */
  countEnrollments(query: ITotpListQuery): Promise<number>;
}

export default ITotpSecretStore;
