import { Module, resolveAutoStore } from "nodefony";
import { ormRegistry } from "@nodefony/orm-core";
import {
  InMemoryUserRepository,
  UserService,
  listUserStores,
} from "@nodefony/user";
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
 * Enregistre la résolution de la brique « user » dans le registre du kernel — au
 * MÊME titre que les 7 autres briques de persistance (token/session/audit…), pour
 * qu'elle apparaisse dans l'écran Studio « Stores » avec `configured` (la valeur
 * `NF_USER_STORE`, souvent `auto`), la provenance dérivée, les backends disponibles
 * et l'emplacement physique. `provisionUsers` est le SEUL endroit qui connaît à la
 * fois le choix configuré, le backend résolu et l'ORM (donc le fichier `.db`).
 *
 * @param module - module applicatif (porte le kernel).
 * @param configured - valeur brute `NF_USER_STORE` (`auto`/`drizzle`/`mongoose`/`memory`).
 * @param resolved - backend réellement branché.
 * @param reason - explication lisible de la résolution.
 * @param location - emplacement physique (fichier `.db` drizzle), `undefined` sinon.
 */
function registerUserResolution(
  module: Module,
  configured: string,
  resolved: string,
  reason: string,
  location?: string,
): void {
  module.kernel?.registerStoreResolution({
    brick: "user",
    nature: "durable",
    configured,
    resolved,
    available: listUserStores(),
    reason,
    configPath: "NF_USER_STORE",
    location,
  });
}

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
 * - `auto` (défaut) : suit l'infra database déclarée (`NF_DATABASE_URL` SQL →
 *   drizzle, mongo → mongoose), repli `drizzle` (SQL local — les comptes doivent
 *   survivre au restart, jamais de repli memory silencieux) ;
 * - `drizzle` : persistance SQL réelle (connecteur `"default"`, entité `User`
 *   auto-enregistrée par le module @nodefony/drizzle sur la variante du
 *   dialecte configuré — `registerStores.ts`) + seed idempotent ;
 * - `mongoose` : persistance MongoDB (connecteur `"nodefony"` du module
 *   `@nodefony/mongoose` — chargé dans le manifeste, sinon échec franc) ;
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

  // `auto` = suivre l'infra database déclarée ; repli drizzle (persistant — un
  // annuaire memory silencieux perdrait les inscriptions). Valeur explicite gagne.
  const configured = env.NF_USER_STORE;
  let store: string = configured;
  let reason = `NF_USER_STORE="${configured}" (explicite).`;
  if (store === "auto") {
    const resolution = resolveAutoStore(
      "durable",
      module.kernel?.infra ?? { database: null, cache: null, logs: null },
      ["drizzle", "mongoose", "memory"],
      "drizzle",
    );
    store = resolution.store;
    reason = `NF_USER_STORE=auto → "${store}" (${resolution.reason}).`;
    module.log(reason, "INFO", LOG_CTX);
  }

  if (store === "memory") {
    // Prod-guard : annuaire VOLATIL (comptes de fixture dev) — toute inscription
    // est perdue au redémarrage. Choix explicite (NF_USER_STORE), donc WARNING
    // appuyé plutôt que refus : un banc éphémère prod reste légitime.
    if (module.kernel?.environment === "production") {
      module.log(
        `NF_USER_STORE=memory en PRODUCTION — annuaire utilisateurs volatil : comptes ` +
          `perdus au redémarrage, non partagés entre pods. Déclarer une infra durable ` +
          `(NF_DATABASE_URL).`,
        "WARNING",
        LOG_CTX,
      );
    }
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
    // Volatil → aucun emplacement physique (RAM).
    registerUserResolution(module, configured, "memory", reason);
    return;
  }

  if (store === "mongoose") {
    // Import dynamique : ne tire @nodefony/mongoose que si le dépôt mongo est
    // réellement choisi (le module reste opt-in dans le manifeste).
    const { MongooseUserRepository } = await import("@nodefony/mongoose");
    const orm = ormRegistry.get("nodefony");
    if (!orm) {
      throw new Error(
        `provisionUsers: NF_USER_STORE=mongoose mais l'ORM "nodefony" est absent ` +
          `du registre — le module @nodefony/mongoose est-il chargé dans le manifeste ?`,
      );
    }
    const users = new UserService(
      MongooseUserRepository.from(
        orm as Parameters<typeof MongooseUserRepository.from>[0],
      ),
      encoder,
    );
    container.set("users", users);
    // Backend RÉSEAU (MongoDB) → emplacement = l'infra déclarée, surfacée à part.
    registerUserResolution(module, configured, "mongoose", reason);
    await seedPersistentUsers(users, module, "Mongoose");
    return;
  }

  // Drizzle : persistance SQL. Le DrizzleService a connecté l'ORM "default" à
  // onBoot → il est présent au onKernelReady (phases de boot séquentielles).
  const orm = ormRegistry.get("default") as DrizzleOrm;
  const users = new UserService(DrizzleUserRepository.from(orm), encoder);
  container.set("users", users);
  // Emplacement physique = base SQLite du connecteur "default" (var/databases/…).
  registerUserResolution(module, configured, "drizzle", reason, orm.location);
  await seedPersistentUsers(users, module, "Drizzle");
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
 * @param users - service utilisateur déjà branché sur un dépôt persistant.
 * @param module - module applicatif (pour les logs + l'environnement).
 * @param backend - nom du dépôt (affichage log uniquement).
 */
async function seedPersistentUsers(
  users: UserService,
  module: Module,
  backend: string,
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
    `Comptes de fixture dev prêts (${ADMIN_IDENTIFIER} + ${USER_IDENTIFIER}) — dépôt ${backend}.`,
    "INFO",
    LOG_CTX,
  );
}
