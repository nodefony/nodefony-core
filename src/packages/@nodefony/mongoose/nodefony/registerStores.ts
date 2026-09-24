import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { Connection, Model } from "mongoose";
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
import {
  registerAuditEntities,
  AUDIT_ENTITY_NAMES,
} from "./entity/auditEventEntity";
import {
  registerTotpSecretEntity,
  TOTP_SECRET_ENTITY,
} from "./entity/totpSecretEntity";
import {
  registerIdempotencyEntities,
  IDEMPOTENCY_ENTITY_NAME,
} from "./entity/idempotencyEntity";
import { registerUserEntity } from "./entity/userEntity";
import { MongooseTokenStore } from "./src/MongooseTokenStore";
import { MongooseWebAuthnCredentialStore } from "./src/MongooseWebAuthnCredentialStore";
import { MongooseWebhookStore } from "./src/MongooseWebhookStore";
import { MongooseAuditStore } from "./src/MongooseAuditStore";
import { MongooseTotpSecretStore } from "./src/MongooseTotpSecretStore";
import { MongooseIdempotencyStore } from "./src/MongooseIdempotencyStore";

/**
 * AUTO-ENREGISTREMENT des backends framework portés par Mongoose — « charger le
 * module = ses backends deviennent sélectionnables par simple nom » (convention-
 * frère : `registerDrizzleFrameworkStores` de `@nodefony/drizzle`).
 *
 * Appelé par `Mongoose.onKernelRegister` (AVANT le connect de `onBoot` — les
 * modèles sont compilés à la connexion). Pas de dialecte (NoSQL) : les schémas
 * sont portables par construction.
 *
 * Couverture : session (auto via `@entity`), utilisateurs, tokens, webauthn,
 * webhooks, audit, TOTP et idempotence — soit **la totalité des briques
 * durables**. C'est la propriété que Mongo doit tenir : une application doit
 * pouvoir tourner SANS aucun backend SQL, et un backend durable est un chemin
 * complet ou n'en est pas un. Une brique qui manquerait se sélectionnerait en
 * échec franc (« store inconnu »), jamais en silence.
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
      `${store} : ORM "${FRAMEWORK_CONNECTOR}" enregistré mais NON CONNECTÉ. Deux causes ` +
        `constatables : soit ce run n'a pas déclaré \`externalServices\` (une commande ` +
        `qui lit ou écrit des données le déclare via CONSOLE_DATA_RUN_PROFILE), soit ` +
        `le store a été demandé avant la connexion (ordre de boot). Un store "auto" ` +
        `n'atteint jamais ce point : seule une demande EXPLICITE le fait.`,
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

  // ── Utilisateurs (annuaire) — entité `User`, brique de 1ʳᵉ classe ──────────
  // Le BACKEND "mongoose" est déclaré par `registerUserStore` (index.ts, registre
  // @nodefony/user) et la SÉLECTION appartient à l'application (`provisionUsers`,
  // piloté par `NF_USER_STORE`) → seule l'ENTITÉ se déclare ici, comme chez le
  // jumeau Drizzle.
  //
  // 🔴 Elle y manquait, et rien ne pouvait le montrer : les bancs appellent
  // `registerUserEntity` eux-mêmes, donc ils passaient. Seul un noyau qui BOOTE
  // réellement sur Mongo l'a révélé — « Schema hasn't been registered for model
  // "User" », au premier seed d'utilisateurs, en fail-soft.
  wire(
    "User",
    () => registerUserEntity(FRAMEWORK_CONNECTOR),
    () => {
      /* backend déclaré via registerUserStore (userStoreRegistry) — pas de
         fabrique par brique : la résolution user appartient à provisionUsers. */
    },
  );

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

  // ── Journal d'audit — registre @nodefony/security ───────────────────────────
  wire(
    AUDIT_ENTITY_NAMES.events,
    () => registerAuditEntities(FRAMEWORK_CONNECTOR),
    () => {
      if (getAuditStoreFactory("mongoose")) {
        return;
      }
      registerAuditStore("mongoose", (ctx) => {
        const orm = resolveConnectedOrm(`audit.store "mongoose"`);
        const days = ctx?.config?.audit?.retentionDays;
        return MongooseAuditStore.from(
          orm,
          undefined,
          typeof days === "number" ? days * 86_400_000 : undefined,
        );
      });
    },
  );

  // ── Secrets TOTP (2FA) — registre @nodefony/security ────────────────────────
  wire(
    TOTP_SECRET_ENTITY,
    () => registerTotpSecretEntity(FRAMEWORK_CONNECTOR),
    () => {
      if (getTotpStoreFactory("mongoose")) {
        return;
      }
      registerTotpStore("mongoose", () =>
        MongooseTotpSecretStore.from(
          resolveConnectedOrm(`totp.store "mongoose"`),
        ),
      );
    },
  );

  // ── Idempotence des mutations — registre @nodefony/framework ────────────────
  // ⚠️ Fabriquée à `onKernelBoot` (framework), AVANT le connect Mongoose
  // (`onBoot`) → la résolution de l'ORM est STRICTEMENT lazy, par usage, et ne
  // passe PAS par `resolveConnectedOrm` : celui-ci LÈVE quand l'ORM n'est pas
  // connecté, ce qui est le comportement juste pour une demande explicite, et
  // exactement le mauvais ici — la fabrique s'exécute forcément trop tôt.
  wire(
    IDEMPOTENCY_ENTITY_NAME,
    () => registerIdempotencyEntities(FRAMEWORK_CONNECTOR),
    () => {
      if (getIdempotencyStoreFactory("mongoose")) {
        return;
      }
      registerIdempotencyStore(
        "mongoose",
        () =>
          new MongooseIdempotencyStore(
            () => {
              let orm: unknown;
              try {
                orm = ormRegistry.get(FRAMEWORK_CONNECTOR);
              } catch {
                return null; // ORM pas encore enregistré (boot) ou retiré (shutdown).
              }
              if (!(orm instanceof MongooseOrm) || !orm.isConnected()) {
                return null;
              }
              return orm
                .getNativeConnection<Connection>()
                .model<Record<string, unknown>>(
                  IDEMPOTENCY_ENTITY_NAME,
                ) as unknown as Model<Record<string, unknown>>;
            },
            undefined,
            undefined,
            undefined,
            FRAMEWORK_CONNECTOR,
          ),
      );
    },
  );

  return report;
}
