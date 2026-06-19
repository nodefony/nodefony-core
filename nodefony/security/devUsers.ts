import type { IBaseUserOptions } from "@nodefony/user";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Comptes de FIXTURE — DÉVELOPPEMENT UNIQUEMENT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Source d'identité commode du dev et des bancs d'intégration (zone `test-secure`
 * du module test, bancs `firewall-auth` / `securityGuard` / `session-bff`…).
 *
 * ⚠️ Le mot de passe des deux comptes est **`secret`**, et son hash est **public**
 * (présent dans ce code open source). Ces comptes ne doivent donc JAMAIS exister
 * en production : `provisionUsers` ne les seede qu'en dev. En prod, seul un admin
 * dont le mot de passe vient de `NF_ADMIN_PASSWORD` (`.env.local` / secret-manager)
 * est créé.
 */

/**
 * Rôles de l'admin **de dev** — plats (la projection `/auth/me` pilote les
 * dashboards Studio par rôle ; la hiérarchie serveur n'aplatit pas avant P6.8).
 * `ROLE_ADMIN` reste en tête (asserts des bancs). Inclut les rôles dev/banc.
 */
export const ADMIN_DEV_ROLES = [
  "ROLE_ADMIN",
  "ROLE_NODEFONY_ADMIN",
  "ROLE_DEV",
  "ROLE_SUPERVISOR",
];

/** Socle de rôles de l'admin **de prod** (accès Studio, sans les rôles dev/banc). */
export const ADMIN_PROD_ROLES = ["ROLE_ADMIN", "ROLE_NODEFONY_ADMIN"];

/** Rôles du compte utilisateur standard. */
export const USER_ROLES = ["ROLE_USER"];

/**
 * Identifiants fonctionnels des comptes de fixture (réutilisés par le seed Drizzle
 * et par le dépôt in-memory pour rester cohérents).
 */
export const ADMIN_IDENTIFIER = "admin";
export const USER_IDENTIFIER = "user";

/**
 * Comptes pour le dépôt **in-memory** (`NF_USER_STORE=memory`) : hashs bcrypt coût
 * 12 **pré-calculés** de `secret` → zéro hachage au boot (essentiel sous charge) et
 * `needsRehash` faux (aucun re-hash parasite pendant les suites). Le dépôt Drizzle,
 * lui, est seedé en clair par `provisionUsers` (hash Argon2id de l'encodeur courant).
 */
export const DEV_USERS_INMEMORY: IBaseUserOptions[] = [
  {
    id: "00000000-0000-4000-8000-00000000ad01",
    identifier: ADMIN_IDENTIFIER,
    roles: ADMIN_DEV_ROLES,
    password: "$2y$12$LClrbAwB2rWklN.9mNaLSe8M3VT6g2HcuCSBkpdJAg/bgw8N66ktG",
  },
  {
    id: "00000000-0000-4000-8000-0000000005e1",
    identifier: USER_IDENTIFIER,
    roles: USER_ROLES,
    password: "$2y$12$SUihCkfVHcpC5EdUgTE/fOk0btOqY3RaUJutRyTkKepvUlxLVqO1u",
  },
];
