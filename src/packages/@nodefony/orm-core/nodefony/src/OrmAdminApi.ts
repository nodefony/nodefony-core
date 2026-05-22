import type {
  IAdminApi,
  IAdminDescriptor,
  IAdminEndpoint,
  IAdminRegistry,
  IAdminRequest,
  IAdminResponse,
} from "nodefony";
import type {
  IEntityGraphNode,
  IOrmGraph,
  IOrmSummary,
} from "../interfaces/IOrmGraph";
import { ormRegistry } from "./OrmRegistry";
import { entityRegistry } from "./EntityRegistry";

/**
 * Producteur `IAdminApi` du **modèle de données ORM** — exposé sous
 * `/nodefony/orm/api/*`. Fondation « IA-first » : construit le graphe canonique
 * (ORMs, entités, colonnes, relations) depuis les registres process-wide
 * ({@link ormRegistry} + {@link entityRegistry}), et l'exporte vers des formats
 * que l'écosystème IA comprend (**DBML** d'abord).
 *
 * orm-core est une **lib pure** (pas un Module) → il ne peut pas s'auto-monter ;
 * un module driver l'enregistre via {@link registerOrmAdminApi} à son boot
 * (idempotent). Le graphe lit les registres GLOBAUX → couvre tous les ORM
 * présents, peu importe quel adapter a enregistré l'API.
 *
 * Endpoints :
 *  - `GET /nodefony/orm/api/orms`           → résumé des ORM/connecteurs
 *  - `GET /nodefony/orm/api/entities`       → entités (`?orm=` pour filtrer)
 *  - `GET /nodefony/orm/api/entity/{name}`  → une entité (`?orm=`)
 *  - `GET /nodefony/orm/api/graph`          → graphe complet (`?orm=`)
 *  - `GET /nodefony/orm/api/export/{format}`→ export (`dbml`), `?orm=`
 */

/** Première valeur d'un param de query (`?orm=default`). */
function oneParam(req: IAdminRequest, key: string): string | undefined {
  const raw = req.query[key];
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Vendor de l'adapter dérivé de son nom de classe (`DrizzleOrm` → `drizzle`,
 * `SequelizeOrm`/`Sequelize` → `sequelize`…). Dette : remplacer par un
 * `IOrm.vendor` déclaré par chaque adapter (P7.1). `""` si indéterminé.
 */
function vendorOf(orm: unknown): string {
  const cls = (orm as { constructor?: { name?: string } })?.constructor?.name;
  if (!cls) return "";
  return cls.replace(/Orm$/, "").toLowerCase();
}

/** Résumé des ORM enregistrés (statut connexion + nombre d'entités). */
function buildOrmSummaries(): IOrmSummary[] {
  const entities = entityRegistry.list();
  return ormRegistry.list().map((name) => {
    let connected = false;
    let vendor = "";
    try {
      const orm = ormRegistry.get(name);
      connected = orm.isConnected();
      vendor = vendorOf(orm);
    } catch {
      connected = false;
    }
    return {
      name,
      vendor,
      default: name === "default",
      connected,
      entityCount: entities.filter((e) => e.orm === name).length,
    } satisfies IOrmSummary;
  });
}

/**
 * Construit un nœud de graphe pour une entité : relations (toujours) + colonnes
 * (via `orm.describeEntity` si l'adapter l'implémente et si l'ORM est connecté).
 */
function buildEntityNode(orm: string, name: string): IEntityGraphNode {
  const entity = entityRegistry.get(name, orm);
  let columns: IEntityGraphNode["columns"] = [];
  try {
    const ormInstance = ormRegistry.get(orm);
    columns = ormInstance.describeEntity?.(name) ?? [];
  } catch {
    columns = [];
  }
  return {
    name: entity.name,
    orm: entity.orm,
    columns,
    relations: (entity.relations ?? []).map((r) => ({
      type: r.type,
      target: r.target,
      field: r.field,
      foreignKey: r.foreignKey,
    })),
  };
}

/** Construit le graphe canonique complet (optionnellement filtré par ORM). */
export function buildOrmGraph(ormFilter?: string): IOrmGraph {
  const orms = buildOrmSummaries();
  const entities = entityRegistry
    .list()
    .filter((e) => !ormFilter || e.orm === ormFilter)
    .map((e) => buildEntityNode(e.orm, e.name));
  return {
    orms: ormFilter ? orms.filter((o) => o.name === ormFilter) : orms,
    entities,
  };
}

/** Échappe un identifiant DBML s'il contient autre chose que `[A-Za-z0-9_]`. */
function dbmlId(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name}"`;
}

/**
 * Sérialise un graphe en **DBML** (Database Markup Language) — format pivot lu
 * par dbdiagram.io, les outils IA et convertible en SQL. Les `Ref:` sont dérivés
 * des relations selon la convention FK des adapters (`<source>Id` sur la cible
 * pour 1-N ; `<target>Id` sur la source pour N-1/1-1). Le many-to-many est
 * annoté en commentaire (table de jonction non portable).
 *
 * @param graph - graphe canonique.
 * @returns texte DBML.
 */
export function toDbml(graph: IOrmGraph): string {
  const lines: string[] = [];
  for (const node of graph.entities) {
    lines.push(`Table ${dbmlId(node.name)} {`);
    if (node.columns.length === 0) {
      lines.push("  // colonnes non introspectées par l'adapter");
    }
    for (const col of node.columns) {
      const settings: string[] = [];
      if (col.primaryKey) settings.push("pk");
      if (col.unique && !col.primaryKey) settings.push("unique");
      if (!col.nullable && !col.primaryKey) settings.push("not null");
      const suffix = settings.length ? ` [${settings.join(", ")}]` : "";
      lines.push(`  ${dbmlId(col.name)} ${col.type || "unknown"}${suffix}`);
    }
    lines.push("}");
    lines.push("");
  }
  // Une même FK physique peut être déclarée des deux côtés (1-N côté source +
  // N-1 côté cible) → dédup par ligne `Ref:` pour ne dessiner qu'une arête.
  const refs = new Set<string>();
  for (const node of graph.entities) {
    for (const rel of node.relations) {
      if (rel.type === "many-to-many") {
        refs.add(
          `// many-to-many ${node.name}.${rel.field} <> ${rel.target} (table de jonction)`,
        );
        continue;
      }
      // 1-N : FK sur la cible (nommée d'après la source) → target.fk > source.id
      // N-1 / 1-1 : FK sur la source (nommée d'après la cible) → source.fk > target.id
      const camel = (n: string) => `${n.charAt(0).toLowerCase()}${n.slice(1)}Id`;
      if (rel.type === "one-to-many") {
        const fk = rel.foreignKey ?? camel(node.name);
        refs.add(
          `Ref: ${dbmlId(rel.target)}.${dbmlId(fk)} > ${dbmlId(node.name)}.id`,
        );
      } else {
        const fk = rel.foreignKey ?? camel(rel.target);
        refs.add(
          `Ref: ${dbmlId(node.name)}.${dbmlId(fk)} > ${dbmlId(rel.target)}.id`,
        );
      }
    }
  }
  lines.push(...refs);
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Propriété d'un schéma JSON (scalaire, réf relation, ou tableau de réfs). */
interface IJsonSchemaProperty {
  type?: string;
  format?: string;
  $ref?: string;
  items?: { $ref: string };
}

/** Définition d'objet JSON Schema pour une entité. */
interface IJsonSchemaObject {
  type: "object";
  title: string;
  properties: Record<string, IJsonSchemaProperty>;
  required?: string[];
  additionalProperties: false;
}

/**
 * Mappe un type natif rapporté par l'adapter (`describeEntity`) vers un type
 * JSON Schema. Heuristique tolérante (SQL + Mongoose) : `INTEGER`→integer,
 * `VARCHAR(255)`/`uuid`/`ObjectId`→string, `BOOLEAN`→boolean, `json`→object,
 * `timestamp`→string(date-time). Défaut prudent : `string`.
 */
function jsonSchemaType(nativeType: string): IJsonSchemaProperty {
  const t = nativeType.toLowerCase();
  if (/\b(serial|bigint|smallint|tinyint|mediumint|int|integer)\b/.test(t)) {
    return { type: "integer" };
  }
  if (/(real|float|double|decimal|numeric|number)/.test(t)) {
    return { type: "number" };
  }
  if (/bool/.test(t)) {
    return { type: "boolean" };
  }
  if (/json/.test(t)) {
    return { type: "object" };
  }
  if (/(date|time|timestamp)/.test(t)) {
    return { type: "string", format: "date-time" };
  }
  return { type: "string" }; // text/varchar/char/uuid/objectid/enum/string…
}

/**
 * Sérialise un graphe en **JSON Schema** (draft 2020-12) — un `$defs` par
 * entité. Format « IA-first » : un agent (text-to-SQL, génération de formulaire,
 * validation de payload) consomme directement ce schéma. Les colonnes
 * non-nullables alimentent `required` ; les relations deviennent des `$ref`
 * (N→1/1→1) ou des tableaux de `$ref` (1→N/N→N) vers les autres `$defs`.
 *
 * @param graph - graphe canonique.
 * @returns document JSON Schema ({@link IJsonSchemaObject} par entité).
 */
export function toJsonSchema(graph: IOrmGraph): {
  $schema: string;
  $defs: Record<string, IJsonSchemaObject>;
} {
  const $defs: Record<string, IJsonSchemaObject> = {};
  for (const node of graph.entities) {
    const properties: Record<string, IJsonSchemaProperty> = {};
    const required: string[] = [];
    for (const col of node.columns) {
      properties[col.name] = jsonSchemaType(col.type);
      if (!col.nullable) {
        required.push(col.name);
      }
    }
    for (const rel of node.relations) {
      const ref = `#/$defs/${rel.target}`;
      properties[rel.field] =
        rel.type === "one-to-many" || rel.type === "many-to-many"
          ? { type: "array", items: { $ref: ref } }
          : { $ref: ref };
    }
    $defs[node.name] = {
      type: "object",
      title: node.name,
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  }
  return { $schema: "https://json-schema.org/draft/2020-12/schema", $defs };
}

const descriptor: IAdminDescriptor = {
  label: "ORM",
  icon: "database",
  order: 4,
};

/**
 * Construit le producteur `IAdminApi` du data plane ORM.
 *
 * @returns le `IAdminApi` (namespace `"orm"`).
 */
export function createOrmAdminApi(): IAdminApi {
  const endpoints: IAdminEndpoint[] = [
    {
      path: "orms",
      summary: "ORMs/connecteurs enregistrés (statut + nombre d'entités)",
      handler: () => buildOrmSummaries(),
    },
    {
      path: "entities",
      summary: "Entités du modèle (colonnes + relations) — ?orm= pour filtrer",
      handler: (request) => buildOrmGraph(oneParam(request, "orm")).entities,
    },
    {
      path: "entity/{name}",
      summary: "Une entité (colonnes + relations) — ?orm= si homonymes",
      handler: (
        request,
      ): IEntityGraphNode | IAdminResponse<{ error: string }> => {
        const name = request.params.name ?? "";
        const orm = oneParam(request, "orm");
        try {
          // Sans ?orm, on prend le 1ᵉʳ ORM qui porte cette entité.
          const found = entityRegistry
            .list()
            .find((e) => e.name === name && (!orm || e.orm === orm));
          if (!found) {
            return { status: 404, body: { error: `entity "${name}" not found` } };
          }
          return buildEntityNode(found.orm, found.name);
        } catch {
          return { status: 404, body: { error: `entity "${name}" not found` } };
        }
      },
    },
    {
      path: "graph",
      summary: "Graphe canonique complet (ORMs + entités) — ?orm= pour filtrer",
      handler: (request) => buildOrmGraph(oneParam(request, "orm")),
    },
    {
      path: "export/{format}",
      summary: "Export du modèle — format: dbml | jsonschema (?orm= pour filtrer)",
      handler: (
        request,
      ):
        | { format: string; content: string }
        | IAdminResponse<{ error: string }> => {
        const format = (request.params.format ?? "").toLowerCase();
        const graph = buildOrmGraph(oneParam(request, "orm"));
        if (format === "dbml") {
          return { format: "dbml", content: toDbml(graph) };
        }
        if (format === "jsonschema") {
          return {
            format: "jsonschema",
            content: JSON.stringify(toJsonSchema(graph), null, 2),
          };
        }
        return {
          status: 400,
          body: {
            error: `unsupported export format "${format}" (dbml, jsonschema)`,
          },
        };
      },
    },
  ];

  return {
    adminNamespace: "orm",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}

/**
 * Enregistre l'`OrmAdminApi` sur le broker admin, **idempotent** (no-op si déjà
 * monté). Appelé par un module driver à son `onKernelBoot` (orm-core est une lib
 * pure et ne peut pas s'auto-monter).
 *
 * @param registry - broker admin (`container.get("adminBroker")`).
 */
export function registerOrmAdminApi(registry: IAdminRegistry): void {
  if (registry.has("orm")) return;
  registry.register(createOrmAdminApi());
}
