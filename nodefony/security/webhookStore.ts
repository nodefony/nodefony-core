import { ormRegistry } from "@nodefony/orm-core";
import {
  DrizzleWebhookStore,
  registerWebhookEndpointEntity,
} from "@nodefony/drizzle";
import type { DrizzleOrm } from "@nodefony/drizzle";
import { registerWebhookStore } from "@nodefony/security";
import { env } from "../../env";

/**
 * Câblage du registre d'endpoints webhook **durable sur Drizzle** (P6.13 Slice C),
 * activé par `NF_WEBHOOK_STORE=drizzle` (défaut `memory` = perdu au redémarrage).
 *
 * **Approche B** (comme le token / idempotency store) : l'application câble
 * l'entité ET la fabrique ; le module `@nodefony/drizzle` n'auto-enregistre rien.
 * Importé **au top-level** depuis `index.ts` → l'entité est dans le
 * `entityRegistry` AVANT le connect du `DrizzleService` (table créée au boot), et
 * la fabrique est dans le registre `@nodefony/security` avant que `WebhookService`
 * la résolve.
 *
 * **Ordre de boot (sûr ici)** : `@nodefony/drizzle` précède `@nodefony/security`
 * dans le manifeste de modules → son `onBoot` (connexion SQLite **synchrone**)
 * s'exécute AVANT celui de `WebhookService` (qui résout le store). À ce moment
 * l'ORM `"default"` est connecté → `DrizzleWebhookStore.from(orm)` (via
 * `getRepository`) est valide. Si l'invariant tombe (ORM absent / non connecté /
 * mauvais dialecte), la fabrique **échoue FRANC** (jamais un store silencieusement
 * cassé — principe « pas de dégradation silencieuse »).
 *
 * **Dialecte** : borné à SQLite (connecteur `"default"`). Le multi-pod RÉEL =
 * Postgres (chantier multi-dialecte) ; ce câblage échoue franc sur un autre
 * dialecte (jamais une table sqlite sur un ORM postgres).
 */
const ORM = "default";
const APP_DIALECT = "sqlite";

if (env.NF_WEBHOOK_STORE === "drizzle") {
  // 1) Entité (avant connect) — table `webhook_endpoint` matérialisée au boot.
  registerWebhookEndpointEntity(ORM);

  // 2) Fabrique (registre security) — résout l'ORM connecté au montage du store.
  registerWebhookStore("drizzle", () => {
    let orm: DrizzleOrm | undefined;
    try {
      orm = ormRegistry.get(ORM) as DrizzleOrm;
    } catch {
      throw new Error(
        `webhooks.store=drizzle : ORM "${ORM}" introuvable — @nodefony/drizzle chargé avant @nodefony/security ?`,
      );
    }
    if (!orm.isConnected()) {
      throw new Error(
        `webhooks.store=drizzle : ORM "${ORM}" non connecté au montage du store webhook (ordre de boot).`,
      );
    }
    if (orm.dialect !== APP_DIALECT) {
      throw new Error(
        `webhooks.store=drizzle : ORM "${ORM}" en "${orm.dialect}", attendu "${APP_DIALECT}" ` +
          `(alignement dialecte = chantier multi-dialecte).`,
      );
    }
    return DrizzleWebhookStore.from(orm);
  });
}
