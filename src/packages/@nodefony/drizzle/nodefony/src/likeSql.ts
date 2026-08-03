import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { LIKE_ESCAPE_CHAR } from "@nodefony/orm-core";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";

/**
 * Le littéral SQL portant le caractère d'échappement d'un `LIKE`, par dialecte.
 *
 * MySQL réinterprète l'antislash **à l'intérieur d'un littéral de chaîne** : y
 * écrire `'\'` produit une chaîne inachevée, il faut `'\\'`. SQLite et
 * PostgreSQL prennent le littéral tel quel. Cette divergence d'une ligne était
 * recopiée à chaque site qui émettait une clause `ESCAPE` — et n'existait
 * évidemment pas sur ceux qui l'oubliaient.
 *
 * @param dialect - dialecte du connecteur branché.
 * @returns le littéral prêt à concaténer après `ESCAPE`.
 */
function escapeLiteral(dialect: SqlDialect): SQL {
  const doubled = dialect === "mysql";
  return sql.raw(`'${doubled ? LIKE_ESCAPE_CHAR : ""}${LIKE_ESCAPE_CHAR}'`);
}

/**
 * Compose une condition `LIKE` **avec sa clause `ESCAPE`** — le seul endroit de
 * l'adapter Drizzle qui écrive un `LIKE`.
 *
 * La clause n'est pas un raffinement : sans elle, le contrat `$like` n'a pas une
 * sémantique mais trois. PostgreSQL et MySQL appliquent déjà l'antislash comme
 * échappement par défaut, SQLite n'en a aucun et cherche l'antislash littéral —
 * si bien qu'un motif échappé rendait la bonne ligne en production et rien du
 * tout en développement (mesuré sur les trois moteurs). L'émettre aligne les
 * trois sur le comportement déjà majoritaire, et rend enfin exprimable un `%`
 * littéral.
 *
 * Le motif est **bindé** (paramètre), jamais concaténé : seul le littéral
 * d'échappement est brut, et il ne dépend que du dialecte.
 *
 * @param dialect - dialecte du connecteur branché.
 * @param expr - l'expression de gauche, déjà composée (colonne, `LOWER(col)`…).
 * @param pattern - le motif, dont les fragments littéraux ont été neutralisés
 *   par `escapeLikeTerm` (`@nodefony/orm-core`).
 * @returns la condition complète.
 *
 * @example
 * ```ts
 * likeCond(dialect, sql`LOWER(${col})`, `${escapeLikeTerm(q.toLowerCase())}%`)
 * ```
 */
export function likeCond(dialect: SqlDialect, expr: SQL, pattern: string): SQL {
  return sql`${expr} LIKE ${pattern} ESCAPE ${escapeLiteral(dialect)}`;
}
