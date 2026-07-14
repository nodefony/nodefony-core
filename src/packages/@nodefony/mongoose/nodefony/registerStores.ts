import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import {
  registerTokenStore,
  getTokenStoreFactory,
  registerWebAuthnStore,
  getWebAuthnStoreFactory,
  registerWebhookStore,
  getWebhookStoreFactory,
} from "@nodefony/security";
import { MongooseOrm } from "./src/orm-core/index";
import {
  registerTokenEntities,
  TOKEN_ENTITY_NAMES,
} from "./entity/tokenEntity";
import {
  registerWebAuthnCredentialEntity,
  WEBAUTHN_CREDENTIAL_ENTITY,
} from "./entity/webAuthnCredentialEntity";
import {
  registerWebhookEndpointEntity,
  WEBHOOK_ENDPOINT_ENTITY,
} from "./entity/webhookEndpointEntity";
import { MongooseTokenStore } from "./src/MongooseTokenStore";
import { MongooseWebAuthnCredentialStore } from "./src/MongooseWebAuthnCredentialStore";
import { MongooseWebhookStore } from "./src/MongooseWebhookStore";

/**
 * AUTO-ENREGISTREMENT des backends framework portés par Mongoose — « charger le
 * module = ses backends deviennent sélectionnables par simple nom » (convention-
 * frère : `registerDrizzleFrameworkStores` de `@nodefony/drizzle`).
 *
 * Appelé par `Mongoose.onKernelRegister` (AVANT le connect de `onBoot` — les
 * modèles sont compilés à la connexion). Pas de dialecte (NoSQL) : les schémas
 * sont portables par construction.
 *
 * Couverture PARTIELLE assumée : session (auto via `@entity`), tokens, webauthn,
 * webhooks. PAS d'implémentation mongoose pour l'audit ni l'idempotence — les
 * sélectionner sur mongoose échoue franc (« store inconnu »), jamais en silence.
 *
 * Mêmes garde-fous que Drizzle : entité `has`-guarded (l'app garde la main),
 * fabrique `get`-guarded (premier-arrivé-premier-servi).
 */

/**
 * Connecteur conventionnel qui héberge le schéma framework (`"nodefony"` pour
 * Mongoose, ≠ `"default"` de Drizzle — isole les entités homonymes dans le
 * `entityRegistry` process-wide si les deux ORM cohabitent).
 */
export const FRAMEWORK_CONNECTOR = "nodefony";

/** Bilan de l'auto-enregistrement (loggé par le module — jamais silencieux). */
export interface IFrameworkStoresReport {
  /** Entités déclarées par l'auto-register (modèles compilés au connect). */
  registered: string[];
  /** Entités déjà enregistrées par l'app (customisation respectée). */
  appOwned: string[];
}

/**
 * Résout l'ORM `nodefony` CONNECTÉ pour une fabrique de store — échec FRANC avec
 * la cause exacte (module absent / ordre de boot) : principe « pas de dégradation
 * silencieuse ».
 */
function resolveConnectedOrm(store: string): MongooseOrm {
  let orm: unknown;
  try {
    orm = ormRegistry.get(FRAMEWORK_CONNECTOR);
  } catch {
    throw new Error(
      `${store} : ORM "${FRAMEWORK_CONNECTOR}" introuvable — charger @nodefony/mongoose ` +
        `AVANT @nodefony/security dans le manifeste "modules".`,
    );
  }
  if (!(orm instanceof MongooseOrm)) {
    throw new Error(
      `${store} : l'ORM "${FRAMEWORK_CONNECTOR}" n'est pas un MongooseOrm (connecteur homonyme d'un autre driver ?).`,
    );
  }
  if (!orm.isConnected()) {
    throw new Error(
      `${store} : ORM "${FRAMEWORK_CONNECTOR}" non connecté au montage du store (ordre de boot).`,
    );
  }
  return orm;
}

/**
 * Déclare les entités framework Mongoose (connecteur `nodefony`) et enregistre
 * leurs fabriques de stores dans les registres de `@nodefony/security`.
 * Idempotent (guards) — rejouable sans effet.
 *
 * @returns bilan à logger (registered / appOwned)
 */
export function registerMongooseFrameworkStores(): IFrameworkStoresReport {
  const report: IFrameworkStoresReport = { registered: [], appOwned: [] };

  const wire = (
    entityName: string,
    registerEntity: () => void,
    registerFactory: () => void,
  ): void => {
    if (entityRegistry.has(entityName, FRAMEWORK_CONNECTOR)) {
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
    () => registerTokenEntities(FRAMEWORK_CONNECTOR),
    () => {
      if (getTokenStoreFactory("mongoose")) {
        return;
      }
      registerTokenStore("mongoose", (ctx) => {
        const orm = resolveConnectedOrm(`tokenStore "mongoose"`);
        const days = ctx?.config?.tokenStore?.retentionRevokedDays;
        return MongooseTokenStore.from(
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
    () => registerWebAuthnCredentialEntity(FRAMEWORK_CONNECTOR),
    () => {
      if (getWebAuthnStoreFactory("mongoose")) {
        return;
      }
      registerWebAuthnStore("mongoose", () =>
        MongooseWebAuthnCredentialStore.from(
          resolveConnectedOrm(`passkeys.store "mongoose"`),
        ),
      );
    },
  );

  // ── Endpoints webhook — registre @nodefony/security ─────────────────────────
  wire(
    WEBHOOK_ENDPOINT_ENTITY,
    () => registerWebhookEndpointEntity(FRAMEWORK_CONNECTOR),
    () => {
      if (getWebhookStoreFactory("mongoose")) {
        return;
      }
      registerWebhookStore("mongoose", () =>
        MongooseWebhookStore.from(
          resolveConnectedOrm(`webhooks.store "mongoose"`),
        ),
      );
    },
  );

  return report;
}
