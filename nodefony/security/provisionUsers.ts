import { Module } from "nodefony";
import { ormRegistry } from "@nodefony/orm-core";
import { InMemoryUserRepository, UserService } from "@nodefony/user";
import type { IPasswordEncoder } from "@nodefony/user";
import { DrizzleUserRepository } from "@nodefony/drizzle";
import type { DrizzleOrm } from "@nodefony/drizzle";
import { env } from "../../env";
import {
  ADMIN_DEV_ROLES,
  ADMIN_IDENTIFIER,
  ADMIN_PROD_ROLES,
  DEV_USERS_INMEMORY,
  USER_IDENTIFIER,
  USER_ROLES,
} from "./devUsers";

const LOG_CTX = "USERS";

/**
 * Pose le service applicatif `"users"` (source d'identité du firewall) dans le
 * container, au démarrage de l'app (`App.onKernelReady`).
 *
 * **C'est la responsabilité de l'application, pas du framework** : `@nodefony/security`
 * sait *authentifier*, mais c'est l'app qui décide *qui* sont ses utilisateurs et
 * *où* ils sont stockés. Sans ce service, toute l'auth (mot de passe, JWT, social)
 * échoue — c'était le bug : seul le module test (dev-only) le posait, donc l'auth
 * était morte en production.
 *
 * Dépôt choisi par `NF_USER_STORE` :
 * - `drizzle` (défaut) : persistance SQL réelle (connecteur `"default"`, entité
 *   `User` enregistrée par `nodefony/entity/user.ts`) + seed idempotent ;
 * - `memory` : annuaire volatil (tests de charge sans I/O SQLite, scripts, tests manuels).
 *
 * Idempotent et non destructif : si un annuaire `"users"` est déjà présent
 * (fixture d'un autre module), il n'est pas remplacé.
 *
 * @param module - le module applicatif (la racine `App`) — fournit container, kernel, log.
 */
export async function provisionUsers(module: Module): Promise<void> {
  const container = module.container;
  if (!container || container.has("users")) {
    return;
  }

  // L'encodeur est posé par le firewall (pont config.encoders → défaut Argon2id),
  // en dev ET en prod. Son absence = pont rompu → échec franc (pas de fallback muet).
  const encoder = container.get<IPasswordEncoder>("passwordEncoder");
  if (!encoder) {
    throw new Error(
      `provisionUsers: service "passwordEncoder" absent du container — le firewall ` +
        `n'a pas exécuté le pont config.encoders (module @nodefony/security chargé ?).`,
    );
  }

  if (env.NF_USER_STORE === "memory") {
    // Annuaire volatil : seedé par construction (hashs pré-calculés) → 0 coût au boot.
    container.set(
      "users",
      new UserService(new InMemoryUserRepository(DEV_USERS_INMEMORY), encoder),
    );
    module.log(
      `Service "users" = InMemoryUserRepository (NF_USER_STORE=memory) — ` +
        `comptes de fixture dev, volatils.`,
      "INFO",
      LOG_CTX,
    );
    return;
  }

  // Défaut : persistance Drizzle. Le DrizzleService a connecté l'ORM "default" à
  // onBoot → il est présent au onKernelReady (phases de boot séquentielles).
  const orm = ormRegistry.get("default") as DrizzleOrm;
  const users = new UserService(DrizzleUserRepository.from(orm), encoder);
  container.set("users", users);
  await seedPersistentUsers(users, module);
}

/**
 * Seed idempotent de la base Drizzle. Crée les comptes manquants seulement.
 *
 * - **PROD** : aucun mot de passe par défaut (le hash de `secret` est public dans
 *   le code). Un admin n'est seedé QUE si `NF_ADMIN_PASSWORD` est fourni
 *   (`.env.local` / secret-manager) ; sinon, avertissement et aucun compte créé.
 * - **DEV** : comptes de fixture connus (`admin`/`user`, mot de passe `secret` par
 *   défaut, surchargeable via `.env.local`) → bancs d'intégration out-of-the-box.
 *
 * @param users - service utilisateur déjà branché sur le dépôt Drizzle.
 * @param module - module applicatif (pour les logs + l'environnement).
 */
async function seedPersistentUsers(
  users: UserService,
  module: Module,
): Promise<void> {
  const isProd = module.kernel?.environment === "production";

  if (isProd) {
    if (await users.findByIdentifier(ADMIN_IDENTIFIER)) {
      return;
    }
    const adminPwd = env.NF_ADMIN_PASSWORD;
    if (!adminPwd) {
      module.log(
        `Aucun admin et NF_ADMIN_PASSWORD non défini → aucun compte seedé. Créez-en ` +
          `un (\`nodefony security:user:add\`) ou définissez NF_ADMIN_PASSWORD ` +
          `(.env.local / secret-manager).`,
        "WARNING",
        LOG_CTX,
      );
      return;
    }
    await users.createUser({
      identifier: ADMIN_IDENTIFIER,
      plainPassword: adminPwd,
      roles: ADMIN_PROD_ROLES,
    });
    module.log(
      `Admin de production seedé (mot de passe via NF_ADMIN_PASSWORD).`,
      "INFO",
      LOG_CTX,
    );
    return;
  }

  // DEV — comptes de fixture (idempotents : créés seulement si absents).
  const adminPwd = env.NF_ADMIN_PASSWORD ?? "secret";
  const userPwd = env.NF_USER_PASSWORD ?? "secret";
  if (!(await users.findByIdentifier(ADMIN_IDENTIFIER))) {
    await users.createUser({
      identifier: ADMIN_IDENTIFIER,
      plainPassword: adminPwd,
      roles: ADMIN_DEV_ROLES,
    });
  }
  if (!(await users.findByIdentifier(USER_IDENTIFIER))) {
    await users.createUser({
      identifier: USER_IDENTIFIER,
      plainPassword: userPwd,
      roles: USER_ROLES,
    });
  }
  module.log(
    `Comptes de fixture dev prêts (${ADMIN_IDENTIFIER} + ${USER_IDENTIFIER}) — dépôt Drizzle.`,
    "INFO",
    LOG_CTX,
  );
}
