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
  idempotencyKeyTable,
} from "./entity/idempotencyEntity";
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
 * `SESSION_ORM` : `"default"` pour Drizzle, `"nodefony"` pour Mongoose).
 */
export const FRAMEWORK_ORM = "default";

/** Portage par entité (chantier multi-dialecte — Ph.2.1 allume les cases). */
const SQLITE_ONLY: readonly SqlDialect[] = ["sqlite"];
const IDEMPOTENCY_PORTED: readonly SqlDialect[] = ["sqlite", "postgres"];

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
 * Résout l'ORM `default` CONNECTÉ pour une fabrique de store — échec FRANC avec
 * la cause exacte (module absent / ordre de boot / dialecte) : principe « pas de
 * dégradation silencieuse ».
 */
function resolveConnectedOrm(store: string, dialect: SqlDialect): DrizzleOrm {
  let orm: unknown;
  try {
    orm = ormRegistry.get(FRAMEWORK_ORM);
  } catch {
    throw new Error(
      `${store} : ORM "${FRAMEWORK_ORM}" introuvable — charger @nodefony/drizzle ` +
        `AVANT @nodefony/security dans le manifeste "modules".`,
    );
  }
  if (!(orm instanceof DrizzleOrm)) {
    throw new Error(
      `${store} : l'ORM "${FRAMEWORK_ORM}" n'est pas un DrizzleOrm (connecteur homonyme d'un autre driver ?).`,
    );
  }
  if (!orm.isConnected()) {
    throw new Error(
      `${store} : ORM "${FRAMEWORK_ORM}" non connecté au montage du store (ordre de boot).`,
    );
  }
  if (orm.dialect !== dialect) {
    throw new Error(
      `${store} : ORM "${FRAMEWORK_ORM}" en "${orm.dialect}" mais le schéma framework a été ` +
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
    if (entityRegistry.has(entityName, FRAMEWORK_ORM)) {
      report.appOwned.push(entityName);
    } else {
      registerEntity();
      report.registered.push(entityName);
    }
    registerFactory();
  };

  // ── Tokens (PAT + denylist JWT) — registre @nodefony/security ──────────────
  wire(
    TOKEN_ENTITY_NAMES.records,
    SQLITE_ONLY,
    () => registerTokenEntities(FRAMEWORK_ORM),
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
    SQLITE_ONLY,
    () => registerAuditEntities(FRAMEWORK_ORM),
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
    SQLITE_ONLY,
    () => registerWebAuthnCredentialEntity(FRAMEWORK_ORM),
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
    SQLITE_ONLY,
    () => registerTotpSecretEntity(FRAMEWORK_ORM),
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
    SQLITE_ONLY,
    () => registerWebhookEndpointEntity(FRAMEWORK_ORM),
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
    () => {
      const idemDialect: "sqlite" | "postgres" =
        dialect === "postgres" ? "postgres" : "sqlite";
      registerIdempotencyEntities(FRAMEWORK_ORM, idemDialect);
    },
    () => {
      if (getIdempotencyStoreFactory("drizzle")) {
        return;
      }
      const idemDialect: "sqlite" | "postgres" =
        dialect === "postgres" ? "postgres" : "sqlite";
      registerIdempotencyStore("drizzle", () => {
        const resolveDb = (): DrizzleDb | null => {
          let orm: unknown;
          try {
            orm = ormRegistry.get(FRAMEWORK_ORM);
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
          // Variante de table du dialecte configuré (sqlite|postgres) — même
          // source que le connecteur `default`, cohérente par construction.
          createIdempotencyTable(idemDialect) as typeof idempotencyKeyTable,
          // Emplacement physique LAZY (Studio) : l'ORM n'existe pas encore ici
          // (fabrique AVANT connect) → lu au 1ᵉʳ accès (onReady), même résolution
          // que `resolveDb`. Base SQLite du connecteur `default`, sinon undefined.
          () => {
            try {
              const orm = ormRegistry.get(FRAMEWORK_ORM);
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
