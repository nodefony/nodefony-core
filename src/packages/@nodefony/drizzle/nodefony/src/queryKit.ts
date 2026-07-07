import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import type { DrizzleDb } from "./orm-core/DrizzleRepository";

/**
 * queryKit — les requêtes SQL **natives** des entités framework, par dialecte
 * (chantier portabilité multi-dialecte, garde-fou G1 du comparatif ORM
 * `docs/audits/orm-comparatif-froid-2026-07.md`).
 *
 * **Pourquoi** : le repository générique et les stores sont dialect-agnostiques
 * (query builder Drizzle) — mais une poignée de requêtes descendent au SQL brut
 * parce que le builder ne les exprime pas (recherche DANS une colonne JSON).
 * Chaque dialecte a SA syntaxe JSON (`json_each` SQLite, `@>` jsonb PG,
 * `JSON_CONTAINS` MySQL) : sans kit, le dialecte fuirait dans les repositories.
 * Le queryKit inverse le rapport, comme le colKit pour les schémas : **une
 * intention par requête**, le kit émet ET exécute la forme du dialecte demandé.
 *
 * **Règles** (miroir du colKit) :
 * - tout `sql\`…\`` d'entité framework vit ICI et nulle part ailleurs (le
 *   budget G1 : dialecte = colKit + factories d'entités + queryKit) ;
 * - paramètres TOUJOURS bindés (`${x}` drizzle → placeholder), jamais de
 *   concaténation — la valeur ne touche jamais la chaîne SQL ;
 * - l'exécution est routée ici aussi : l'API native diverge (`db.all()`
 *   better-sqlite3 / `db.execute().rows` node-postgres) — un appelant qui
 *   recevrait juste le fragment devrait router lui-même, et le dialecte
 *   fuirait quand même.
 *
 * **Interne au module** (comme le colKit) : pas d'export dans `index.ts`.
 */

/**
 * Vue structurelle de l'exécuteur node-postgres de Drizzle — le handle PG vit
 * derrière `DrizzleDb` (vue d'exécution CANONIQUE typée sqlite, cf sa doc) ;
 * la surface native qui DIVERGE (`execute().rows` vs `all()`) est re-typée ici,
 * au seul endroit qui l'exécute.
 */
interface PgExecutor {
  execute(query: SQL): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * Cherche l'`id` du user dont le tableau JSON `socialProviders` contient un
 * lien `{provider, providerId}` — le finder du pattern **Shadow User** OAuth
 * (`DrizzleUserRepository.findBySocialProvider`).
 *
 * Sémantique IDENTIQUE sur tous les dialectes : « il EXISTE un élément du
 * tableau dont `provider` ET `providerId` valent exactement ces valeurs »
 * (les autres clés de l'élément, ex. `createdAt`, sont ignorées) :
 * - **sqlite** : `EXISTS (SELECT 1 FROM json_each(col) WHERE json_extract…)`
 *   — scan du tableau, valeurs bindées ;
 * - **postgres** : `col @> '[{"provider":…,"providerId":…}]'::jsonb` —
 *   containment jsonb natif (indexable GIN), le motif est UN paramètre bindé
 *   sérialisé JSON ;
 * - **mysql** : `JSON_CONTAINS(col, JSON_OBJECT(…), '$')` — S4 (non porté,
 *   erreur actionnable comme le colKit).
 *
 * @param db - handle Drizzle natif (racine ou transaction) du dialecte.
 * @param dialect - dialecte SQL du connecteur.
 * @param provider - fournisseur d'identité (`"github"`, `"google"`…).
 * @param providerId - identifiant du compte CHEZ le fournisseur.
 * @returns l'`id` du user lié, ou `null` si aucun lien.
 * @throws si le dialecte n'est pas encore porté (`mysql` → S4).
 */
export async function findUserIdBySocialProvider(
  db: DrizzleDb,
  dialect: SqlDialect,
  provider: string,
  providerId: string,
): Promise<string | null> {
  switch (dialect) {
    case "sqlite": {
      const rows = (await db.all(
        sql`SELECT "id" AS id FROM "User"
            WHERE EXISTS (
              SELECT 1 FROM json_each("User"."socialProviders")
              WHERE json_extract(value, '$.provider') = ${provider}
                AND json_extract(value, '$.providerId') = ${providerId}
            ) LIMIT 1`,
      )) as Array<{ id: string }>;
      return rows[0]?.id ?? null;
    }
    case "postgres": {
      // Le motif de containment est UN paramètre (sérialisé JSON côté JS puis
      // casté jsonb par PG) — `provider`/`providerId` ne touchent jamais le SQL.
      const pattern = JSON.stringify([{ provider, providerId }]);
      const result = await (db as unknown as PgExecutor).execute(
        sql`SELECT "id" AS id FROM "User"
            WHERE "socialProviders" @> ${pattern}::jsonb LIMIT 1`,
      );
      const id = result.rows[0]?.id;
      return typeof id === "string" ? id : null;
    }
    default:
      throw new Error(
        `[@nodefony/drizzle] queryKit findUserIdBySocialProvider: dialect ` +
          `"${dialect}" not yet supported (sqlite, postgres available; mysql ` +
          `on the roadmap — JSON_CONTAINS).`,
      );
  }
}
