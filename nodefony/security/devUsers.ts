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
 * Comptes pour le dépôt **in-memory** (`NF_USER_STORE=memory`) : hashs **Argon2id**
 * (m=19456, t=3, p=1 = défauts de l'encodeur) **pré-calculés** de `secret` → zéro
 * hachage au boot (essentiel sous charge) et `needsRehash` faux (aucun re-hash
 * parasite pendant les suites, coûts ≥ ceux du runtime).
 *
 * **Argon2id et pas bcrypt** : bcrypt exige un encodeur legacy déclaré, qui ne vit
 * que dans le module test (`policy:"dev"`) → en **production** ce module est absent,
 * donc un hash bcrypt n'était pas vérifiable et le login `admin/secret` échouait en
 * prod + `NF_STORE=memory` (banc de charge authentifié impossible). Argon2id EST
 * l'encodeur par défaut (toujours présent, dev ET prod) → les fixtures s'authentifient
 * partout. Le dépôt Drizzle, lui, reste seedé en clair par `provisionUsers`.
 */
export const DEV_USERS_INMEMORY: IBaseUserOptions[] = [
  {
    id: "00000000-0000-4000-8000-00000000ad01",
    identifier: ADMIN_IDENTIFIER,
    roles: ADMIN_DEV_ROLES,
    password:
      "$argon2id$v=19$m=19456,t=3,p=1$Y4FuXRa3p4ilDrYLHq6pLw$xg8CN+QS+I0dV0FB4DCVkW3FbgMVwd52kyTm5dbn/bY",
  },
  {
    id: "00000000-0000-4000-8000-0000000005e1",
    identifier: USER_IDENTIFIER,
    roles: USER_ROLES,
    password:
      "$argon2id$v=19$m=19456,t=3,p=1$/nK+Rhq5BdmWJJhL5zYcLg$Jr5J8Cp7Trxrnr70xH4Elt/P/Ipyr4Fq/NE6vSwDdSc",
  },
];
