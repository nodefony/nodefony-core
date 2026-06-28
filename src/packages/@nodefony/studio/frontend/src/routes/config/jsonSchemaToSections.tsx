/**
 * Mappeur **générique** de configuration de module → `ConfigSection[]` pour
 * `ConfigLayout`. Remplace les panneaux recopiés à la main (anti-pattern « liste
 * dupliquée »).
 *
 * **Piloté par la config EFFECTIVE, enrichi par le JSON Schema.** La structure
 * réelle de ce qui tourne (`module/{name}.config`, valeurs résolues) est la
 * **colonne vertébrale** → on montre TOUT (y compris les clés dynamiques d'un
 * `z.record`, ex. les `connectors` ORM, et les extras d'un `looseObject`). Le
 * JSON Schema (`module/{name}.configSchema`) **ajoute la doc** quand il la connaît
 * (type, défaut, valeurs possibles, description, flags Nodefony) ; les réglages
 * documentés mais absents de la config effective sont ajoutés à la fin.
 *
 * - **Sections** = clé de 1ᵉʳ niveau : un objet devient une section ; les réglages
 *   scalaires racine vont dans « Général ».
 * - **Champs** = feuilles (récursion), clé = chemin pointé
 *   (`connectors.default.filename`, `securityHeaders.frameOptions`).
 * - **Flags Nodefony** (`reserved` / `runtimeMutable` / `kernelDerived` / `secret`)
 *   recopiés dans le JSON Schema par `meta()` côté serveur → mutabilité + badges.
 * - **Secrets** masqués (flag schéma OU nom de clé sensible) — la redaction réelle
 *   est faite côté serveur (le payload ne porte jamais le secret).
 */
import type { ReactNode } from "react";
import { Code } from "@mantine/core";
import { JsonPeek } from "../../components/ui";
import type {
  ConfigField,
  ConfigSection,
  ConfigEditControl,
} from "../../components/ui";

/** Nœud JSON Schema (forme partielle, tolérante aux variations). */
interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  additionalProperties?: JsonSchemaNode | boolean;
  anyOf?: JsonSchemaNode[];
  enum?: unknown[];
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  items?: JsonSchemaNode;
  // Flags Nodefony recopiés par `meta()` → `z.toJSONSchema()`.
  reserved?: boolean;
  runtimeMutable?: boolean;
  kernelDerived?: boolean;
  secret?: boolean;
}

const MASK = "•••••";
/** Clés dont la VALEUR est sensible (masquée à l'affichage ; redaction serveur). */
const SECRET_KEY =
  /secret|password|passwd|passphrase|privatekey|keysetjson|clientsecret|credential/i;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Branche « objet » d'un nœud schéma : le nœud lui-même s'il a des `properties`
 * (ou un `additionalProperties` = record), sinon la branche objet d'un `anyOf`
 * nullable. `null` = nœud feuille.
 */
function objectBranch(node: JsonSchemaNode): JsonSchemaNode | null {
  if (node.properties || isObj(node.additionalProperties)) return node;
  if (Array.isArray(node.anyOf)) {
    const obj = node.anyOf.find(
      (b) => b.properties || isObj(b.additionalProperties),
    );
    if (obj) return obj;
  }
  return null;
}

/** Résout le nœud schéma à un chemin pointé (via `properties` ET records). */
function schemaAt(root: unknown, path: string): JsonSchemaNode | null {
  if (!isObj(root)) return null;
  let node: JsonSchemaNode | null = root as JsonSchemaNode;
  for (const seg of path.split(".")) {
    const obj: JsonSchemaNode | null = node ? objectBranch(node) : null;
    if (!obj) return null;
    if (obj.properties && seg in obj.properties) {
      node = obj.properties[seg];
    } else if (isObj(obj.additionalProperties)) {
      // record (`z.record`) : toute clé suit le schéma `additionalProperties`.
      node = obj.additionalProperties as JsonSchemaNode;
    } else {
      return null;
    }
  }
  return node;
}

/** Type lisible d'une feuille schéma (`string | null`, `boolean | string`, …). */
function readType(node: JsonSchemaNode): string {
  if (Array.isArray(node.enum)) return "enum";
  if (Array.isArray(node.anyOf)) {
    const parts = node.anyOf.map((b) =>
      b.type === "null"
        ? "null"
        : b.type === "array"
          ? "array"
          : typeof b.type === "string"
            ? b.type
            : "object",
    );
    return Array.from(new Set(parts)).join(" | ");
  }
  if (node.type === "array") return "array";
  return typeof node.type === "string" ? node.type : "object";
}

/** Type inféré d'une valeur effective (quand le schéma ne la documente pas). */
function inferType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Types scalaires d'un nœud (top-level `type` + branches `anyOf`). */
function scalarTypes(node: JsonSchemaNode): string[] {
  const out = new Set<string>();
  const add = (t: string | string[] | undefined) => {
    if (Array.isArray(t)) t.forEach((x) => out.add(x));
    else if (t) out.add(t);
  };
  add(node.type);
  if (Array.isArray(node.anyOf)) node.anyOf.forEach((b) => add(b.type));
  return [...out];
}

/**
 * Dérive le contrôle d'édition d'une feuille `runtimeMutable` non secrète :
 * `enum`→select · `boolean`→switch · `number/integer`→number (bornes) ·
 * `string`→text. Une feuille objet/array ou une union complexe → `undefined`
 * (pas d'édition inline : recette d'override pour le reste).
 */
function deriveEditControl(
  node: JsonSchemaNode | null,
): ConfigEditControl | undefined {
  if (!node || node.runtimeMutable !== true || node.secret === true) {
    return undefined;
  }
  if (Array.isArray(node.enum)) {
    const options = node.enum.filter((e): e is string => typeof e === "string");
    if (!options.length) return undefined;
    return { kind: "select", options, nullable: node.enum.includes(null) };
  }
  const types = scalarTypes(node);
  if (types.includes("array") || types.includes("object")) return undefined;
  const nullable = types.includes("null");
  if (types.includes("boolean")) return { kind: "switch" };
  if (types.includes("integer") || types.includes("number")) {
    return {
      kind: "number",
      min: node.minimum,
      max: node.maximum,
      integer: types.includes("integer") && !types.includes("number"),
      nullable,
    };
  }
  if (types.includes("string")) return { kind: "text", nullable };
  return undefined;
}

/** Contrainte lisible : valeurs d'enum ou bornes min/max. */
function readConstraint(node: JsonSchemaNode): string | undefined {
  if (Array.isArray(node.enum)) {
    return node.enum.map((e) => (e === null ? "null" : String(e))).join(" · ");
  }
  const bounds: string[] = [];
  if (typeof node.minimum === "number") bounds.push(`≥ ${node.minimum}`);
  if (typeof node.maximum === "number") bounds.push(`≤ ${node.maximum}`);
  return bounds.length ? bounds.join(" · ") : undefined;
}

/**
 * Rend une valeur (défaut ou effective). Scalaire → monospace inline ; **tableau
 * / objet / map → carte JSON au survol** (`JsonPeek` : aperçu compact + détail
 * complet repliable au pointage, lazy). `title` = contexte de la carte.
 */
function renderValue(
  v: unknown,
  kernelDerived?: boolean,
  title?: string,
): ReactNode {
  if (v === undefined) return undefined;
  const emptyArr = Array.isArray(v) && v.length === 0;
  const emptyObj = isObj(v) && Object.keys(v).length === 0;
  if ((v === "" || emptyArr || emptyObj) && kernelDerived) {
    return <Code style={{ fontSize: 12 }}>auto</Code>;
  }
  if (v === null) return <Code style={{ fontSize: 12 }}>null</Code>;
  if (emptyArr) return <Code style={{ fontSize: 12 }}>(aucun)</Code>;
  if (emptyObj) return <Code style={{ fontSize: 12 }}>{"{}"}</Code>;
  if (Array.isArray(v) || isObj(v)) {
    return <JsonPeek value={v} title={title} />;
  }
  if (typeof v === "string") {
    return (
      <Code style={{ fontSize: 12 }}>
        {v === "" ? '""' : JSON.stringify(v)}
      </Code>
    );
  }
  return <Code style={{ fontSize: 12 }}>{String(v)}</Code>;
}

/** Construit un `ConfigField` (schéma optionnel) + sa valeur effective. */
function buildField(
  path: string,
  node: JsonSchemaNode | null,
  value: unknown,
  source?: ConfigField["source"],
): ConfigField {
  const last = path.slice(path.lastIndexOf(".") + 1);
  const secret = node?.secret === true || SECRET_KEY.test(last);
  // Édition inline : seulement sur une feuille « à chaud » non secrète.
  const editControl = secret ? undefined : deriveEditControl(node);
  return {
    key: path,
    type: node ? readType(node) : inferType(value),
    constraint: node ? readConstraint(node) : undefined,
    defaultValue: node
      ? renderValue(node.default, node.kernelDerived, `${path} (défaut)`)
      : undefined,
    description: node?.description,
    mutability: node?.runtimeMutable ? "live" : "boot",
    reserved: node?.reserved === true,
    kernelDerived: node?.kernelDerived === true,
    secret,
    source,
    editControl,
    editValue: editControl ? value : undefined,
    effective: secret ? (
      <Code style={{ fontSize: 12 }}>{MASK}</Code>
    ) : (
      renderValue(value, node?.kernelDerived, path)
    ),
  };
}

/** Le nœud schéma décrit-il un OBJET à propriétés fixes (→ à explorer) ? */
function objHasProps(node: JsonSchemaNode | null): boolean {
  const o = node ? objectBranch(node) : null;
  return !!(o?.properties && Object.keys(o.properties).length > 0);
}

/** Une feuille de config résolue : son chemin, son nœud schéma, sa valeur. */
interface Leaf {
  path: string;
  node: JsonSchemaNode | null;
  value: unknown;
}

/**
 * Walk **union(schéma × effectif)** : à chaque niveau, on visite l'UNION des clés
 * documentées par le schéma (`properties`) ET présentes dans la config effective
 * (y compris les clés dynamiques d'un `record`). Une clé « objet » (côté schéma OU
 * côté valeur) est explorée récursivement ; sinon c'est une feuille. Ainsi un
 * connecteur effectif VIDE (`{}`) expose quand même ses réglages DOCUMENTÉS (ex.
 * `filename`, valeur « — / résolu au boot »).
 */
function walkConfig(
  effective: unknown,
  schema: JsonSchemaNode | null,
  prefix: string,
  out: Leaf[],
): void {
  if (prefix.split(".").length > 8) return; // garde-fou profondeur
  const sObj = schema ? objectBranch(schema) : null;
  const keys = new Set<string>();
  if (sObj?.properties)
    for (const k of Object.keys(sObj.properties)) keys.add(k);
  if (isObj(effective)) for (const k of Object.keys(effective)) keys.add(k);

  for (const k of keys) {
    const path = prefix ? `${prefix}.${k}` : k;
    const value = isObj(effective) ? effective[k] : undefined;
    const childSchema: JsonSchemaNode | null =
      sObj?.properties?.[k] ??
      (isObj(sObj?.additionalProperties)
        ? (sObj.additionalProperties as JsonSchemaNode)
        : null);
    const childIsObj =
      objHasProps(childSchema) ||
      (isObj(value) && Object.keys(value).length > 0);
    if (childIsObj) walkConfig(value, childSchema, path, out);
    else out.push({ path, node: childSchema, value });
  }
}

/**
 * Convertit une config (effective + JSON Schema) en sections prêtes pour
 * `ConfigLayout` (mode effectif). Tolérant : renvoie `[]` si tout est vide.
 *
 * @param jsonSchema - JSON Schema du module (`module/{name}.configSchema`), ou `null`.
 * @param effective - config effective résolue (`module/{name}.config`).
 * @returns sections groupées (« Général » + une par sous-objet de 1ᵉʳ niveau).
 */
export function jsonSchemaToSections(
  jsonSchema: unknown,
  effective: unknown,
  provenance?: Record<string, string> | null,
): ConfigSection[] {
  const root = isObj(jsonSchema) ? (jsonSchema as JsonSchemaNode) : null;
  const leaves: Leaf[] = [];
  walkConfig(effective, root, "", leaves);

  // Grouper par clé de 1ᵉʳ niveau (objet = section ; scalaire = « Général »).
  const general: ConfigField[] = [];
  const bySection = new Map<string, ConfigField[]>();
  for (const { path, node, value } of leaves) {
    const field = buildField(
      path,
      node,
      value,
      provenance?.[path] as ConfigField["source"] | undefined,
    );
    const dot = path.indexOf(".");
    if (dot === -1) {
      general.push(field);
    } else {
      const title = path.slice(0, dot);
      const bucket = bySection.get(title);
      if (bucket) bucket.push(field);
      else bySection.set(title, [field]);
    }
  }

  const sections: ConfigSection[] = [];
  if (general.length) sections.push({ title: "Général", fields: general });
  for (const [title, fields] of bySection) {
    const node = schemaAt(jsonSchema, title);
    sections.push({ title, description: node?.description, fields });
  }
  return sections;
}
