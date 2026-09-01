import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import {
  registerTokenStore,
  getTokenStoreFactory,
  registerAuditStore,
  getAuditStoreFactory,
  registerWebAuthnStore,
  getWebAuthnStoreFactory,
  registerTotpStore,
  getTotpStoreFactory,
  registerWebhookStore,
  getWebhookStoreFactory,
} from "@nodefony/security";
import {
  registerIdempotencyStore,
  getIdempotencyStoreFactory,
} from "@nodefony/framework";
import { DrizzleOrm } from "./src/orm-core/index";
import type { DrizzleDb } from "./src/orm-core/index";
import type { SqlDialect } from "./config/config";
import {
  registerTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "./entity/tokenEntity";
import {
  registerAuditEntities,
  AUDIT_ENTITY_NAMES,
} from "./entity/auditEventEntity";
import {
  registerWebAuthnCredentialEntity,
  WEBAUTHN_CREDENTIAL_ENTITY,
} from "./entity/webAuthnCredentialEntity";
import {
  registerTotpSecretEntity,
  TOTP_SECRET_ENTITY,
} from "./entity/totpSecretEntity";
import {
  registerWebhookEndpointEntity,
  WEBHOOK_ENDPOINT_ENTITY,
} from "./entity/webhookEndpointEntity";
import {
  registerIdempotencyEntities,
  createIdempotencyTable,
  IDEMPOTENCY_ENTITY_NAME,
} from "./entity/idempotencyEntity";
import {
  registerSessionEntity,
  SESSION_ENTITY_NAME,
  SESSION_CONNECTOR,
} from "./entity/sessionEntity";
import { registerUserEntity } from "./entity/userTable";
import { DrizzleTokenStore } from "./src/DrizzleTokenStore";
import { DrizzleAuditStore } from "./src/DrizzleAuditStore";
import { DrizzleWebAuthnCredentialStore } from "./src/DrizzleWebAuthnCredentialStore";
import { DrizzleTotpSecretStore } from "./src/DrizzleTotpSecretStore";
import { DrizzleWebhookStore } from "./src/DrizzleWebhookStore";
import { DrizzleIdempotencyStore } from "./src/DrizzleIdempotencyStore";

/**
 * AUTO-ENREGISTREMENT des backends framework portés par Drizzle — « charger le
 * module = ses backends deviennent sélectionnables par simple nom ».
 *
 * Appelé par `Drizzle.onKernelRegister` (config validée → dialecte du connecteur
 * `default` connu, AVANT le connect de `onBoot` → les tables sont créées au
 * connect). Remplace l'« approche B » historique où chaque application devait
 * câbler `registerXStore(...)` + `registerXEntities(...)` à la main.
 *
 * Deux garde-fous préservent la main de l'application (customisation) :
 * - **entité** : `entityRegistry.has(name, orm)` → une entité déjà enregistrée
 *   par l'app est respectée (jamais de doublon-throw) ;
 * - **fabrique** : `getXStoreFactory("drizzle")` → une fabrique déjà posée par
 *   l'app garde la main (le registre est premier-arrivé-premier-servi ici).
 *
 * Une brique dont l'entité n'est PAS portée sur le dialecte configuré n'est NI
 * déclarée NI fabricable : les registres reflètent le RÉEL (`listXStores()` ne
 * promet jamais un backend qui échouerait), et la sélectionner échoue franc au
 * boot (« store inconnu ») — jamais de table fantôme ni d'erreur SQL différée.
 */

/**
 * Connecteur conventionnel qui héberge le schéma framework (même convention que
 * `SESSION_CONNECTOR` : `"default"` pour Drizzle, `"nodefony"` pour Mongoose).
 */
export const FRAMEWORK_CONNECTOR = "default";

/** Portage par entité (chantier multi-dialecte — Ph.2.1 allume les cases). */
const ALL_DIALECTS: readonly SqlDialect[] = ["sqlite", "postgres", "mysql"];
const IDEMPOTENCY_PORTED: readonly SqlDialect[] = ALL_DIALECTS;
const SESSION_PORTED: readonly SqlDialect[] = ALL_DIALECTS;
const TOKEN_PORTED: readonly SqlDialect[] = ALL_DIALECTS;
const WEBAUTHN_PORTED: readonly SqlDialect[] = ALL_DIALECTS;
const TOTP_PORTED: readonly SqlDialect[] = ALL_DIALECTS;
const USER_PORTED: readonly SqlDialect[] = ALL_DIALECTS;
const AUDIT_PORTED: readonly SqlDialect[] = ALL_DIALECTS;
const WEBHOOK_PORTED: readonly SqlDialect[] = ALL_DIALECTS;

/** Bilan de l'auto-enregistrement (loggé par le module — jamais silencieux). */
export interface IFrameworkStoresReport {
  /** Entités déclarées par l'auto-register (tables créées au connect). */
  registered: string[];
  /** Entités déjà enregistrées par l'app (customisation respectée). */
  appOwned: string[];
  /** Entités non portées sur le dialecte configuré (stores indisponibles). */
  unported: string[];
}

/**
 * Les entités que le REPLI a posées, par connecteur — `<connecteur>:<entité>`.
 *
 * Elle existe pour une question qu'aucun autre objet ne sait trancher : cette
 * entité vient-elle de l'APPLICATION, ou le framework l'a-t-il posée faute de
 * mieux ? Le registre d'entités, lui, ne retient pas qui a écrit. Or la réponse
 * décide d'un refus de démarrage : une entité de repli n'est dans AUCUNE chaîne
 * de migration, donc sa table n'existe nulle part hors développement.
 */
const fallbackEntities = new Set<string>();

/** Clé de {@link fallbackEntities} — une entité vit par connecteur. */
function fallbackKey(entityName: string, connector: string): string {
  return `${connector}:${entityName}`;
}

/**
 * Cette entité a-t-elle été posée par le repli du framework ?
 *
 * @param entityName - nom de l'entité (`"User"`…).
 * @param connector - connecteur porteur.
 * @returns `true` si le framework l'a enregistrée lui-même, faute d'entité d'app.
 */
export function isFrameworkFallbackEntity(
  entityName: string,
  connector: string = FRAMEWORK_CONNECTOR,
): boolean {
  return fallbackEntities.has(fallbackKey(entityName, connector));
}

/**
 * Résout l'ORM `default` CONNECTÉ pour une fabrique de store — échec FRANC avec
 * la cause exacte (module absent / ordre de boot / dialecte) : principe « pas de
 * dégradation silencieuse ».
 */
function resolveConnectedOrm(store: string, dialect: SqlDialect): DrizzleOrm {
  let orm: unknown;
  try {
    orm = ormRegistry.get(FRAMEWORK_CONNECTOR);
  } catch {
    throw new Error(
      `${store} : ORM "${FRAMEWORK_CONNECTOR}" introuvable — charger @nodefony/drizzle ` +
        `AVANT @nodefony/security dans le manifeste "modules".`,
    );
  }
  if (!(orm instanceof DrizzleOrm)) {
    throw new Error(
      `${store} : l'ORM "${FRAMEWORK_CONNECTOR}" n'est pas un DrizzleOrm (connecteur homonyme d'un autre driver ?).`,
    );
  }
  if (!orm.isConnected()) {
    throw new Error(
      `${store} : ORM "${FRAMEWORK_CONNECTOR}" non connecté au montage du store (ordre de boot).`,
    );
  }
  if (orm.dialect !== dialect) {
    throw new Error(
      `${store} : ORM "${FRAMEWORK_CONNECTOR}" en "${orm.dialect}" mais le schéma framework a été ` +
        `déclaré en "${dialect}" (incohérence de config).`,
    );
  }
  return orm;
}

/**
 * Déclare les entités framework portées sur `dialect` (connecteur `default`) et
 * enregistre leurs fabriques de stores dans les registres de `@nodefony/security`
 * et `@nodefony/framework`. Idempotent (guards) — rejouable sans effet.
 *
 * @param dialect - dialecte du connecteur `default` (config validée du module)
 * @returns bilan à logger (registered / appOwned / unported)
 */
export function registerDrizzleFrameworkStores(
  dialect: SqlDialect,
): IFrameworkStoresReport {
  const report: IFrameworkStoresReport = {
    registered: [],
    appOwned: [],
    unported: [],
  };
  // Un nouvel appel REFAIT le constat : une entité que l'app a fini par déclarer
  // ne doit pas rester marquée « de repli » d'un passage précédent (tests,
  // rechargement à chaud) — sans quoi le refus de démarrage viserait à faux.
  fallbackEntities.clear();

  const wire = (
    entityName: string,
    ported: readonly SqlDialect[],
    registerEntity: () => void,
    registerFactory: () => void,
  ): void => {
    if (!ported.includes(dialect)) {
      report.unported.push(entityName);
      return;
    }
    if (entityRegistry.has(entityName, FRAMEWORK_CONNECTOR)) {
      report.appOwned.push(entityName);
    } else {
      registerEntity();
      report.registered.push(entityName);
      fallbackEntities.add(fallbackKey(entityName, FRAMEWORK_CONNECTOR));
    }
    registerFactory();
  };

  // ── Session HTTP — registre de storage @nodefony/http ──────────────────────
  // Le STORAGE (`SessionStorage`) s'enregistre dans `SessionsService` à l'import
  // du module (indépendant du dialecte) → seule l'ENTITÉ suit le dialecte ici.
  // Historiquement enregistrée par un `@entity` figé à l'import (variante sqlite
  // imposée quel que soit le connecteur) — S1 multi-dialecte l'a rendue
  // dynamique. Opt-out `frameworkEntities:false` + `session.store:"drizzle"` :
  // l'entité manque → échec franc au premier `open()` du SessionsService (boot).
  wire(
    SESSION_ENTITY_NAME,
    SESSION_PORTED,
    // `wire` filtre les dialectes non portés AVANT d'appeler la closure → le
    // dialecte passe tel quel (la factory colKit connaît sqlite et postgres).
    () => registerSessionEntity(SESSION_CONNECTOR, dialect),
    () => {
      /* storage déjà enregistré à l'import de SessionStorage (registre http). */
    },
  );

  // ── Utilisateurs (annuaire) — entité `User`, brique de 1ʳᵉ classe ──────────
  // Le BACKEND "drizzle" est déclaré par `registerUserStore` (onKernelRegister,
  // registre @nodefony/user) et la sélection appartient à l'APP (`provisionUsers`
  // piloté par NF_USER_STORE) → seule l'ENTITÉ est déclarée ici, sur la variante
  // du dialecte. Historiquement enregistrée par l'app au top-level (variante
  // sqlite figée) — S2 multi-dialecte l'a rendue dynamique, comme la session.
  wire(
    "User",
    USER_PORTED,
    () => registerUserEntity(FRAMEWORK_CONNECTOR, dialect),
    () => {
      /* backend déclaré via registerUserStore (userStoreRegistry) — pas de
         fabrique par brique : la résolution user appartient à provisionUsers. */
    },
  );

  // ── Tokens (PAT + denylist JWT) — registre @nodefony/security ──────────────
  wire(
    TOKEN_ENTITY_NAMES.records,
    TOKEN_PORTED,
    () => registerTokenEntities(FRAMEWORK_CONNECTOR, dialect),
    () => {
      if (getTokenStoreFactory("drizzle")) {
        return;
      }
      registerTokenStore("drizzle", (ctx) => {
        const orm = resolveConnectedOrm(`tokenStore "drizzle"`, dialect);
        const days = ctx?.config?.tokenStore?.retentionRevokedDays;
        return DrizzleTokenStore.from(
          orm,
          undefined,
          typeof days === "number" ? days * 86_400_000 : undefined,
        );
      });
    },
  );

  // ── Journal d'audit — registre @nodefony/security ───────────────────────────
  wire(
    AUDIT_ENTITY_NAMES.events,
    AUDIT_PORTED,
    () => registerAuditEntities(FRAMEWORK_CONNECTOR, dialect),
    () => {
      if (getAuditStoreFactory("drizzle")) {
        return;
      }
      registerAuditStore("drizzle", (ctx) => {
        const orm = resolveConnectedOrm(`audit.store "drizzle"`, dialect);
        const days = ctx?.config?.audit?.retentionDays;
        return DrizzleAuditStore.from(
          orm,
          undefined,
          typeof days === "number" ? days * 86_400_000 : undefined,
        );
      });
    },
  );

  // ── Credentials WebAuthn (passkeys) — registre @nodefony/security ───────────
  wire(
    WEBAUTHN_CREDENTIAL_ENTITY,
    WEBAUTHN_PORTED,
    () => registerWebAuthnCredentialEntity(FRAMEWORK_CONNECTOR, dialect),
    () => {
      if (getWebAuthnStoreFactory("drizzle")) {
        return;
      }
      registerWebAuthnStore("drizzle", () =>
        DrizzleWebAuthnCredentialStore.from(
          resolveConnectedOrm(`passkeys.store "drizzle"`, dialect),
        ),
      );
    },
  );

  // ── Secrets TOTP (2FA) — registre @nodefony/security ────────────────────────
  wire(
    TOTP_SECRET_ENTITY,
    TOTP_PORTED,
    () => registerTotpSecretEntity(FRAMEWORK_CONNECTOR, dialect),
    () => {
      if (getTotpStoreFactory("drizzle")) {
        return;
      }
      registerTotpStore("drizzle", () =>
        DrizzleTotpSecretStore.from(
          resolveConnectedOrm(`totp.store "drizzle"`, dialect),
        ),
      );
    },
  );

  // ── Endpoints webhook — registre @nodefony/security ─────────────────────────
  wire(
    WEBHOOK_ENDPOINT_ENTITY,
    WEBHOOK_PORTED,
    () => registerWebhookEndpointEntity(FRAMEWORK_CONNECTOR, dialect),
    () => {
      if (getWebhookStoreFactory("drizzle")) {
        return;
      }
      registerWebhookStore("drizzle", () =>
        DrizzleWebhookStore.from(
          resolveConnectedOrm(`webhooks.store "drizzle"`, dialect),
        ),
      );
    },
  );

  // ── Idempotence des mutations — registre @nodefony/framework ────────────────
  // ⚠️ Fabriquée à `onKernelBoot` (framework), AVANT le connect Drizzle (`onBoot`)
  // → résolution du handle STRICTEMENT lazy (par usage), jamais à la construction
  // (invariant hérité du câblage app d'origine, prouvé au boot).
  wire(
    IDEMPOTENCY_ENTITY_NAME,
    IDEMPOTENCY_PORTED,
    () => registerIdempotencyEntities(FRAMEWORK_CONNECTOR, dialect),
    () => {
      if (getIdempotencyStoreFactory("drizzle")) {
        return;
      }
      registerIdempotencyStore("drizzle", () => {
        const resolveDb = (): DrizzleDb | null => {
          let orm: unknown;
          try {
            orm = ormRegistry.get(FRAMEWORK_CONNECTOR);
          } catch {
            return null; // ORM pas encore enregistré (boot) ou retiré (shutdown).
          }
          if (!(orm instanceof DrizzleOrm) || !orm.isConnected()) {
            return null;
          }
          return orm.getNativeConnection<DrizzleDb>();
        };
        return new DrizzleIdempotencyStore(
          resolveDb,
          undefined,
          undefined,
          undefined,
          // Variante de table du dialecte configuré — même source que le
          // connecteur `default`, cohérente par construction.
          createIdempotencyTable(dialect),
          // Emplacement physique LAZY (Studio) : l'ORM n'existe pas encore ici
          // (fabrique AVANT connect) → lu au 1ᵉʳ accès (onReady), même résolution
          // que `resolveDb`. Base SQLite du connecteur `default`, sinon undefined.
          () => {
            try {
              const orm = ormRegistry.get(FRAMEWORK_CONNECTOR);
              return orm instanceof DrizzleOrm ? orm.location : undefined;
            } catch {
              return undefined;
            }
          },
        );
      });
    },
  );

  return report;
}
