import type {
  IAdminApi,
  IAdminDescriptor,
  IAdminEndpoint,
  IAdminRegistry,
  IAdminRequest,
  IAdminResponse,
} from "nodefony";
import { performance } from "node:perf_hooks";
import type {
  IConnectionHealth,
  IEntityGraphNode,
  IOrmGraph,
  IOrmSummary,
} from "../interfaces/IOrmGraph";
import type { IOrmFlowReport } from "../interfaces/IOrmFlow";
import { ormRegistry } from "./OrmRegistry";
import { entityRegistry } from "./EntityRegistry";
import { connectionMonitor } from "./ConnectionMonitor";
import { queryFlowMonitor } from "./QueryFlowMonitor";

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
 * `DrizzleOrm`/`Drizzle` → `drizzle`…). Dette : remplacer par un
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
    let connection: IOrmSummary["connection"];
    try {
      const orm = ormRegistry.get(name);
      connected = orm.isConnected();
      vendor = vendorOf(orm);
      connection = orm.describeConnection?.();
    } catch {
      connected = false;
    }
    return {
      name,
      vendor,
      default: name === "default",
      connected,
      entityCount: entities.filter((e) => e.orm === name).length,
      connection,
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
    module: entity.module ?? "",
    domain: entity.domain ?? "",
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

/**
 * Construit le **diagnostic complet des connexions** (per-instance) : ping live
 * (latence enregistrée dans la fenêtre glissante), sonde profonde driver
 * ({@link IOrm.probe} — stockage/pool), et compteurs de cycle de vie du
 * {@link connectionMonitor}. Réutilisé par l'endpoint `connection/health` ET par
 * le ticker hub realtime de Studio (« contrôle total des ORM »).
 *
 * @param filter - nom de connecteur (optionnel) pour ne sonder que celui-ci.
 * @returns un {@link IConnectionHealth} par connecteur.
 */
export async function buildConnectionHealth(
  filter?: string,
): Promise<IConnectionHealth[]> {
  const instanceId = String(process.pid);
  const names = ormRegistry.list().filter((n) => !filter || n === filter);
  const out: IConnectionHealth[] = [];
  for (const name of names) {
    let connected = false;
    let vendor = "";
    let driver = "";
    let target: string | undefined;
    let version: string | undefined;
    let ormVersion: string | undefined;
    let pingMs: number | null = null;
    let pingOk = false;
    let pingError: string | null = null;
    let storage: IConnectionHealth["storage"];
    let pool: IConnectionHealth["pool"];
    let extra: IConnectionHealth["extra"];
    try {
      const inst = ormRegistry.get(name);
      connected = inst.isConnected();
      vendor = vendorOf(inst);
      const c = inst.describeConnection?.();
      if (c) {
        driver = c.driver;
        target = c.target;
        version = c.version;
        ormVersion = c.ormVersion;
      }
      if (connected) {
        const t0 = performance.now();
        try {
          // Ping portable : méthode dédiée de l'adapter (Drizzle `SELECT 1`,
          // Mongoose `admin().ping`) ; sinon round-trip transactionnel.
          if (typeof inst.ping === "function") {
            await inst.ping();
          } else {
            await inst.transaction(async () => undefined);
          }
          pingMs = Math.round((performance.now() - t0) * 100) / 100;
          pingOk = true;
          connectionMonitor.recordPing(name, pingMs);
        } catch (e) {
          pingError = e instanceof Error ? e.message : "ping failed";
          connectionMonitor.recordError(name, pingError);
        }
        // Sonde profonde driver-spécifique (best-effort, ne casse jamais le tick).
        try {
          const probe = await inst.probe?.();
          if (probe) {
            storage = probe.storage;
            pool = probe.pool;
            extra = probe.extra;
          }
        } catch {
          /* sonde best-effort */
        }
      }
    } catch (e) {
      pingError = e instanceof Error ? e.message : String(e);
    }
    const core = connectionMonitor.snapshot(name);
    out.push({
      instanceId,
      name,
      vendor,
      driver,
      target,
      version,
      ormVersion,
      connected,
      connectedSince: core.connectedSince,
      uptimeMs: core.uptimeMs,
      connectCount: core.connectCount,
      reconnectCount: core.reconnectCount,
      errorCount: core.errorCount,
      lastError: core.lastError,
      recentErrors: core.recentErrors,
      lastConnectMs: core.lastConnectMs,
      pingMs,
      pingOk,
      pingError,
      latency: core.latency,
      storage,
      pool,
      extra,
    });
  }
  return out;
}

/**
 * Construit le rapport de **flux ORM** (per-instance) : débit (via `total`),
 * latence (moyenne + EWMA), pire latence et requêtes lentes récentes, par
 * connecteur enregistré. Lecture pure du {@link queryFlowMonitor} (aucune
 * requête émise — contrairement à `buildConnectionHealth` qui ping) → bon marché.
 * Réutilisé par l'endpoint `flow` ET le ticker hub realtime de Studio.
 *
 * @param filter - nom de connecteur (optionnel) pour ne rapporter que celui-ci.
 * @returns le rapport (`enabled=false` en prod → connecteurs à 0).
 */
export function buildOrmFlow(filter?: string): IOrmFlowReport {
  const names = ormRegistry.list().filter((n) => !filter || n === filter);
  const connectors = names.map((name) => {
    let vendor = "";
    try {
      vendor = vendorOf(ormRegistry.get(name));
    } catch {
      vendor = "";
    }
    return queryFlowMonitor.snapshot(name, vendor);
  });
  return {
    enabled: queryFlowMonitor.enabled,
    ts: Date.now(),
    instanceId: String(process.pid),
    slowMs: queryFlowMonitor.slowMs,
    connectors,
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
      const camel = (n: string) =>
        `${n.charAt(0).toLowerCase()}${n.slice(1)}Id`;
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
            return {
              status: 404,
              body: { error: `entity "${name}" not found` },
            };
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
      path: "counts",
      summary:
        "Nombre de lignes par entité (COUNT(*)) — ?orm= pour filtrer. Lazy : 1 COUNT par table.",
      handler: async (request): Promise<Record<string, number>> => {
        const orm = oneParam(request, "orm");
        const counts: Record<string, number> = {};
        const entities = entityRegistry
          .list()
          .filter((e) => !orm || e.orm === orm);
        for (const e of entities) {
          try {
            const inst = ormRegistry.get(e.orm);
            // -1 = non comptable (ORM déconnecté / pas de repository) → l'UI affiche « — ».
            counts[e.name] = inst.isConnected()
              ? await inst.getRepository(e.name).count()
              : -1;
          } catch {
            counts[e.name] = -1;
          }
        }
        return counts;
      },
    },
    {
      path: "connection/health",
      summary:
        "Diagnostic des connexions (per-instance) — état, ping/latence (fenêtre), erreurs, reconnexions, sondes (stockage/pool). ?orm= pour filtrer.",
      handler: (request) => buildConnectionHealth(oneParam(request, "orm")),
    },
    {
      path: "flow",
      summary:
        "Flux des requêtes (per-instance) — débit (via total), latence moy/EWMA, pire latence, requêtes lentes. ?orm= pour filtrer. enabled=false en prod.",
      handler: (request) => buildOrmFlow(oneParam(request, "orm")),
    },
    {
      path: "export/{format}",
      summary:
        "Export du modèle — format: dbml | jsonschema (?orm= pour filtrer)",
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
