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
import type {
  IOrmMigrationApplyReply,
  IOrmMigrationPlanReply,
  IOrmMigrationReply,
} from "../interfaces/IOrmMigrations";
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
 *  - `GET /nodefony/orm/api/entities`       → entités (`?connector=` pour filtrer)
 *  - `GET /nodefony/orm/api/entity/{name}`  → une entité (`?connector=`)
 *  - `GET /nodefony/orm/api/graph`          → graphe complet (`?connector=`)
 *  - `GET /nodefony/orm/api/export/{format}`→ export (`dbml`), `?connector=`
 *  - `GET /nodefony/orm/api/migrations`     → état des migrations (`?connector=`)
 */

/** Première valeur d'un param de query (`?connector=default`). */
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

/**
 * Résout un connecteur et lui demande UNE de ses capacités de migration.
 *
 * Les trois points de migration posent la même question dans le même ordre —
 * le connecteur existe-t-il, porte-t-il la capacité, que répond-elle — et
 * trois copies de cette suite auraient fini par répondre trois choses
 * différentes au même cas.
 *
 * @param request - requête admin (`?connector=`, défaut « default »).
 * @param capability - nom de la méthode optionnelle demandée à l'ORM.
 * @param absente - ce qu'on dit quand l'ORM ne la porte pas.
 * @returns la réponse de l'ORM, ou une réponse d'administration explicite.
 */
async function migrationCapability(
  request: IAdminRequest,
  capability: "migrationStatus" | "migrationPlan" | "applyMigrations",
  absente: string,
): Promise<unknown> {
  const connector = oneParam(request, "connector") ?? "default";
  if (!ormRegistry.has(connector)) {
    const connus = ormRegistry.list().join(", ");
    return {
      status: 404,
      body: {
        error: `aucun connecteur « ${connector} » — ceux que cette application déclare : ${connus || "aucun"}`,
      },
    };
  }
  const orm = ormRegistry.get(connector);
  // Signature commune des trois capacités du point de vue de CE relais : une
  // fonction sans argument dont on ne relit pas la forme — c'est le contrat
  // `IOrm` qui la type, pas ce passe-plat, qui la rendrait sinon trois fois.
  const fn = orm[capability] as
    | (() => Promise<
        IOrmMigrationReply | IOrmMigrationPlanReply | IOrmMigrationApplyReply
      >)
    | undefined;
  // 🔴 L'ABSENCE de la capacité EST la réponse, et elle se NOMME.
  //
  // Un ORM qui ne migre pas par fichiers versionnés n'est pas en panne : sa
  // base résorbe l'écart autrement. Répondre une page vide laisserait croire
  // « rien à migrer, tout va bien » — un écran qui ment quand la donnée manque
  // est pire qu'un écran absent.
  if (typeof fn !== "function") {
    return {
      status: 501,
      body: {
        formatVersion: 1,
        connector,
        error: {
          code: "NF_MIGRATE_NO_MIGRATIONS",
          summary: `Le connecteur « ${connector} » est porté par ${vendorOf(orm) || orm.name}, dont la base ne se met pas à jour par des migrations de schéma.`,
          meaning: `${absente} Les migrations par fichiers versionnés sont une mécanique SQL ; les autres bases résorbent l'écart entre le code et le schéma autrement.`,
          nextActions: [],
        },
      },
    };
  }
  // Un empêchement se rend en 200 : c'est une RÉPONSE, pas une panne du plan
  // d'administration — l'écran doit pouvoir l'afficher tel quel, avec son
  // code, sa phrase et ses gestes.
  return fn.call(orm);
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
      entityCount: entities.filter((e) => e.connector === name).length,
      connection,
    } satisfies IOrmSummary;
  });
}

/**
 * Construit un nœud de graphe pour une entité : relations (toujours) + colonnes
 * (via `orm.describeEntity` si l'adapter l'implémente et si l'ORM est connecté).
 */
function buildEntityNode(connector: string, name: string): IEntityGraphNode {
  const entity = entityRegistry.get(name, connector);
  let columns: IEntityGraphNode["columns"] = [];
  try {
    const ormInstance = ormRegistry.get(connector);
    columns = ormInstance.describeEntity?.(name) ?? [];
  } catch {
    columns = [];
  }
  return {
    name: entity.name,
    connector: entity.connector,
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

/** Construit le graphe canonique complet (optionnellement filtré par connecteur). */
export function buildOrmGraph(connectorFilter?: string): IOrmGraph {
  const orms = buildOrmSummaries();
  const entities = entityRegistry
    .list()
    .filter((e) => !connectorFilter || e.connector === connectorFilter)
    .map((e) => buildEntityNode(e.connector, e.name));
  return {
    orms: connectorFilter
      ? orms.filter((o) => o.name === connectorFilter)
      : orms,
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
      summary:
        "Entités du modèle (colonnes + relations) — ?connector= pour filtrer",
      handler: (request) =>
        buildOrmGraph(oneParam(request, "connector")).entities,
    },
    {
      path: "entity/{name}",
      summary: "Une entité (colonnes + relations) — ?connector= si homonymes",
      handler: (
        request,
      ): IEntityGraphNode | IAdminResponse<{ error: string }> => {
        const name = request.params.name ?? "";
        const connector = oneParam(request, "connector");
        try {
          // Sans ?connector, on prend le 1ᵉʳ connecteur qui porte cette entité.
          const found = entityRegistry
            .list()
            .find(
              (e) =>
                e.name === name && (!connector || e.connector === connector),
            );
          if (!found) {
            return {
              status: 404,
              body: { error: `entity "${name}" not found` },
            };
          }
          return buildEntityNode(found.connector, found.name);
        } catch {
          return { status: 404, body: { error: `entity "${name}" not found` } };
        }
      },
    },
    {
      path: "graph",
      summary:
        "Graphe canonique complet (ORMs + entités) — ?connector= pour filtrer",
      handler: (request) => buildOrmGraph(oneParam(request, "connector")),
    },
    {
      path: "counts",
      summary:
        "Nombre de lignes par entité (COUNT(*)) — ?connector= pour filtrer. Lazy : 1 COUNT par table.",
      handler: async (request): Promise<Record<string, number>> => {
        const connector = oneParam(request, "connector");
        const counts: Record<string, number> = {};
        const entities = entityRegistry
          .list()
          .filter((e) => !connector || e.connector === connector);
        for (const e of entities) {
          try {
            const inst = ormRegistry.get(e.connector);
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
      path: "migrations",
      summary:
        "État des migrations d'un connecteur (?connector=, défaut « default ») — MÊME objet que `orm:migrate:status --json`. 501 si l'ORM ne porte pas de migrations, 404 si le connecteur n'existe pas.",
      handler: async (request) =>
        migrationCapability(
          request,
          "migrationStatus",
          "Ce connecteur ne suit pas de migrations.",
        ),
    },
    {
      path: "migrations/plan",
      summary:
        "Ce qui S'APPLIQUERAIT, avec son SQL (?connector=) — lecture seule, sert la confirmation avant application.",
      handler: async (request) =>
        migrationCapability(
          request,
          "migrationPlan",
          "Ce connecteur ne sait pas dire ce qui s'appliquerait.",
        ),
    },
    {
      path: "migrations/apply",
      method: "POST",
      summary:
        "Applique les migrations en attente (?connector=) — DÉVELOPPEMENT seulement : le pilote refuse ailleurs, en le disant. En production, les migrations passent par un travail d'orchestrateur.",
      handler: async (request) =>
        migrationCapability(
          request,
          "applyMigrations",
          "Ce connecteur ne sait pas appliquer de migrations.",
        ),
    },
    {
      path: "connection/health",
      summary:
        "Diagnostic des connexions (per-instance) — état, ping/latence (fenêtre), erreurs, reconnexions, sondes (stockage/pool). ?connector= pour filtrer.",
      handler: (request) =>
        buildConnectionHealth(oneParam(request, "connector")),
    },
    {
      path: "flow",
      summary:
        "Flux des requêtes (per-instance) — débit (via total), latence moy/EWMA, pire latence, requêtes lentes. ?connector= pour filtrer. enabled=false en prod.",
      handler: (request) => buildOrmFlow(oneParam(request, "connector")),
    },
    {
      path: "export/{format}",
      summary:
        "Export du modèle — format: dbml | jsonschema (?connector= pour filtrer)",
      handler: (
        request,
      ):
        | { format: string; content: string }
        | IAdminResponse<{ error: string }> => {
        const format = (request.params.format ?? "").toLowerCase();
        const graph = buildOrmGraph(oneParam(request, "connector"));
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
