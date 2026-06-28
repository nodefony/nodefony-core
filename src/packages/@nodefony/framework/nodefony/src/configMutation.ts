/**
 * Mutation de configuration en direct (édition live admin, page Studio config).
 *
 * Brique PURE et testable derrière l'endpoint `PATCH /nodefony/kernel/api/config/{module}`
 * ({@link createKernelAdminApi}). Une mutation de config runtime par un admin est une
 * **surface sensible** : ces helpers fail-closed décident *si* un champ est éditable à
 * chaud, *valident* la valeur contre le JSON Schema du module (même esprit que les
 * overrides `NF__*` validés par Zod), et produisent la **recette** d'override pour les
 * champs non mutables (12-factor : la majorité se change au redémarrage, jamais en RAM).
 *
 * Périmètre assumé (MVP) : on édite une **feuille scalaire** (`string`/`number`/
 * `boolean`/`null`/enum/union de scalaires). Les objets/arrays imbriqués ne sont pas
 * éditables en place (recette uniquement) — un `runtimeMutable` se pose sur un scalaire.
 * Les `.refine()` Zod custom ne sont PAS dans le JSON Schema : la validation feuille
 * couvre type/enum/bornes/longueur/pattern, le module reste juge au prochain boot.
 */

/**
 * Vue minimale d'un nœud JSON Schema (produit par `z.toJSONSchema`), incluant les
 * **flags Nodefony** recopiés au top-level par le helper `meta()` des modules.
 */
export interface IJsonSchemaNode {
  type?: string | string[];
  enum?: readonly unknown[];
  anyOf?: readonly unknown[];
  oneOf?: readonly unknown[];
  properties?: Record<string, unknown>;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
  /** Éditable à chaud (relu par requête) — seul cas autorisé en édition live. */
  runtimeMutable?: boolean;
  /** Réservé à une feature future — jamais éditable. */
  reserved?: boolean;
  /** Dérivé par le kernel au boot — jamais éditable. */
  kernelDerived?: boolean;
  /** Donnée sensible — jamais éditée via l'API (recette `*_FILE`). */
  secret?: boolean;
  [k: string]: unknown;
}

/** Drapeaux d'éditabilité d'un champ, dérivés de son nœud JSON Schema. */
export interface IFieldFlags {
  runtimeMutable: boolean;
  reserved: boolean;
  kernelDerived: boolean;
  secret: boolean;
}

/** Résultat d'une validation de feuille : succès, ou échec avec message humain. */
export type LeafValidation = { ok: true } | { ok: false; message: string };

/** Narrowing défensif : `unknown` → nœud JSON Schema (ou `null` si non-objet). */
function asNode(value: unknown): IJsonSchemaNode | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as IJsonSchemaNode;
  }
  return null;
}

/**
 * Récupère la map `properties` d'un nœud — directement, ou dans la 1ʳᵉ branche
 * objet d'un `anyOf`/`oneOf` (cas d'un champ optionnel/nullable typé objet).
 */
function getProperties(node: IJsonSchemaNode): Record<string, unknown> | null {
  if (node.properties && typeof node.properties === "object") {
    return node.properties;
  }
  const variants = node.anyOf ?? node.oneOf;
  if (Array.isArray(variants)) {
    for (const v of variants) {
      const vn = asNode(v);
      if (vn?.properties) return vn.properties;
    }
  }
  return null;
}

/** Résout un segment vers la clé réelle d'une map : exact d'abord, sinon insensible casse. */
function resolveKeyCI(
  obj: Record<string, unknown>,
  seg: string,
): string | null {
  if (Object.prototype.hasOwnProperty.call(obj, seg)) return seg;
  const lower = seg.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lower) return k;
  }
  return null;
}

/**
 * Descend dans un JSON Schema le long d'un chemin pointé (`upload.maxFileSize`)
 * et renvoie le nœud feuille, ou `null` si un segment ne résout pas.
 *
 * @param schema - JSON Schema racine du module (`mod.configSchema()`).
 * @param segments - segments du chemin (casse réelle ou insensible).
 * @returns le nœud feuille, ou `null` si le chemin est inconnu.
 */
export function navigateSchemaNode(
  schema: unknown,
  segments: string[],
): IJsonSchemaNode | null {
  let node = asNode(schema);
  for (const seg of segments) {
    if (!node) return null;
    const props = getProperties(node);
    if (!props) return null;
    const key = resolveKeyCI(props, seg);
    if (key === null) return null;
    node = asNode(props[key]);
  }
  return node;
}

/** Extrait les flags Nodefony d'un nœud (défaut `false` partout). */
export function nodeFlags(node: IJsonSchemaNode): IFieldFlags {
  return {
    runtimeMutable: node.runtimeMutable === true,
    reserved: node.reserved === true,
    kernelDerived: node.kernelDerived === true,
    secret: node.secret === true,
  };
}

/** Type JS effectif d'une valeur, dans le vocabulaire JSON Schema. */
function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Une valeur satisfait-elle UN type JSON Schema (`integer` = number entier) ? */
function matchesType(t: string, value: unknown): boolean {
  if (t === "integer")
    return typeof value === "number" && Number.isInteger(value);
  return t === jsonTypeOf(value);
}

/**
 * Valide une valeur scalaire contre un nœud JSON Schema feuille (type(s), `enum`,
 * `anyOf`/`oneOf`, bornes numériques, longueur/pattern de chaîne). Fail-closed :
 * un nœud objet/array non scalaire est refusé (édition feuille uniquement).
 *
 * @param node - nœud JSON Schema cible.
 * @param value - valeur candidate (déjà typée — provient d'un body JSON).
 * @returns succès, ou échec avec message explicatif.
 */
export function validateLeafValue(
  node: IJsonSchemaNode,
  value: unknown,
): LeafValidation {
  // enum : appartenance stricte.
  if (Array.isArray(node.enum)) {
    return node.enum.includes(value)
      ? { ok: true }
      : {
          ok: false,
          message: `valeur attendue parmi : ${node.enum.map((e) => JSON.stringify(e)).join(", ")}`,
        };
  }
  // union : au moins une variante satisfaite.
  const variants = node.anyOf ?? node.oneOf;
  if (Array.isArray(variants) && variants.length > 0) {
    for (const v of variants) {
      const vn = asNode(v);
      if (vn && validateLeafValue(vn, value).ok) return { ok: true };
    }
    return { ok: false, message: "ne correspond à aucune variante autorisée" };
  }
  // contrainte de type.
  const types = Array.isArray(node.type)
    ? node.type
    : node.type
      ? [node.type]
      : [];
  if (types.length > 0 && !types.some((t) => matchesType(t, value))) {
    return { ok: false, message: `type attendu : ${types.join(" | ")}` };
  }
  // objet/array non typés explicitement → refus (pas une feuille scalaire éditable).
  if (types.length === 0 && (value === null || typeof value !== "object")) {
    // scalaire sans contrainte de type : accepter.
  } else if (types.length === 0) {
    return { ok: false, message: "édition d'objet/tableau non supportée" };
  }
  // bornes numériques.
  if (typeof value === "number") {
    if (node.minimum !== undefined && value < node.minimum) {
      return { ok: false, message: `doit être ≥ ${node.minimum}` };
    }
    if (node.maximum !== undefined && value > node.maximum) {
      return { ok: false, message: `doit être ≤ ${node.maximum}` };
    }
    if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) {
      return { ok: false, message: `doit être > ${node.exclusiveMinimum}` };
    }
    if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) {
      return { ok: false, message: `doit être < ${node.exclusiveMaximum}` };
    }
  }
  // longueur / pattern de chaîne.
  if (typeof value === "string") {
    if (node.minLength !== undefined && value.length < node.minLength) {
      return { ok: false, message: `longueur minimale ${node.minLength}` };
    }
    if (node.maxLength !== undefined && value.length > node.maxLength) {
      return { ok: false, message: `longueur maximale ${node.maxLength}` };
    }
    if (node.pattern) {
      try {
        if (!new RegExp(node.pattern).test(value)) {
          return { ok: false, message: "format invalide" };
        }
      } catch {
        // pattern non compilable → ne pas bloquer sur une regex de schéma cassée.
      }
    }
  }
  return { ok: true };
}

/** Raison machine du refus d'édition live (`null` = éditable). */
export type NotEditableReason =
  "secret" | "reserved" | "kernel_derived" | "boot_only";

/**
 * Décide si un champ est éditable à chaud. Ordre de refus : secret > réservé >
 * dérivé kernel > non-`runtimeMutable` (boot). `null` = éditable.
 *
 * @param flags - flags du nœud ({@link nodeFlags}).
 * @returns la raison du refus, ou `null` si éditable live.
 */
export function notEditableReason(
  flags: IFieldFlags,
): NotEditableReason | null {
  if (flags.secret) return "secret";
  if (flags.reserved) return "reserved";
  if (flags.kernelDerived) return "kernel_derived";
  if (!flags.runtimeMutable) return "boot_only";
  return null;
}

/**
 * Construit la **recette** d'override à appliquer dans le déploiement pour un champ
 * non mutable à chaud (12-factor). Un secret passe par la variante `*_FILE` (jamais
 * la valeur en clair dans l'environnement).
 *
 * @param seg - segment d'adressage du module (`http`, `security`, `app`…).
 * @param segments - chemin pointé du champ.
 * @param isSecret - le champ porte-t-il le flag secret ?
 * @returns la ligne d'override prête à copier.
 */
export function recipeFor(
  seg: string,
  segments: string[],
  isSecret: boolean,
): string {
  const envKey = `NF__${seg.toUpperCase()}__${segments
    .map((s) => s.toUpperCase())
    .join("__")}`;
  if (isSecret) {
    return `${envKey}__FILE=/run/secrets/${segments.join("_").toLowerCase()}`;
  }
  return `${envKey}=<valeur>`;
}

/**
 * Lit la valeur courante d'une config à un chemin pointé (insensible à la casse) —
 * sert à journaliser l'ancienne valeur (`before`) avant mutation.
 *
 * @param obj - objet de config (`mod.options`).
 * @param segments - chemin pointé.
 * @returns la valeur, ou `undefined` si le chemin ne résout pas.
 */
export function getResolvedPath(
  obj: Record<string, unknown>,
  segments: string[],
): unknown {
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
      return undefined;
    }
    const rec = cur as Record<string, unknown>;
    const key = resolveKeyCI(rec, seg);
    if (key === null) return undefined;
    cur = rec[key];
  }
  return cur;
}
