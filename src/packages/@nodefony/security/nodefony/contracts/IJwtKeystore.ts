import type { JSONWebKeySet } from "jose";

/**
 * Clé active de signature résolue par le keystore — la clé privée Ed25519 plus
 * son `kid` (à poser dans l'en-tête JWT) et l'algorithme JWA.
 */
export interface IJwtSigningKey {
  /** Clé privée Ed25519 (WebCrypto `CryptoKey`) qui signe les jetons. */
  readonly key: CryptoKey;
  /** Identifiant de clé = thumbprint RFC 7638 → en-tête JWT `kid` (sélection au verify). */
  readonly kid: string;
  /** Algorithme JWA — toujours `"EdDSA"` pour une clé Ed25519 (RFC 8037). */
  readonly alg: "EdDSA";
}

/**
 * Source du matériel cryptographique de signature des JWT.
 *
 * Découple la SIGNATURE de toute persistance concrète : la clé peut venir de
 * l'environnement (prod cloud), d'un fichier (dev/VPS) ou être éphémère en
 * mémoire (dev jetable) — le {@link IJwtSigningKey} et le JWKS public exposés
 * sont identiques. Un keyset porte N clés (rotation) : une seule **signe** (la
 * clé active), **toutes vérifient** (les jetons en vol signés par une clé encore
 * présente restent valides).
 *
 * ⚠️ Le keystore détient des clés privées — jamais loggué, jamais sérialisé hors
 * du backend choisi. Le JWKS exposé ne porte QUE des paramètres publics (RFC 8037 /
 * 7517) : `kty/crv/x/kid/use/alg`, **jamais `d`**.
 */
export interface IJwtKeystore {
  /**
   * Clé active de signature. Résout (charge ou génère) le keyset au PREMIER
   * appel (lazy async, mémoïsé) — le coût de boot est nul si le JWT n'est jamais
   * émis.
   */
  getSigningKey(): Promise<IJwtSigningKey>;

  /**
   * JWKS **public** (toutes les clés du keyset, paramètres publics uniquement) —
   * passé à `createLocalJWKSet` pour résoudre la clé de vérification par `kid`.
   */
  getPublicJWKS(): Promise<JSONWebKeySet>;
}
