/**
 * Helpers **purs** (0 React) de la famille JSON — partagés par `JsonView`,
 * `JsonCard` et `JsonPeek`. Classification de valeur, couleurs par type
 * (adaptatives dark/light via `light-dark()`), aperçu compact sur une ligne.
 *
 * Tout est en TEXTE : aucune de ces fonctions ne produit du HTML → rendu sûr,
 * aucune injection possible même sur des données serveur non maîtrisées.
 */

/** Catégorie d'une valeur JSON — pilote la couleur et le rendu. */
export type JsonKind =
  "string" | "number" | "boolean" | "null" | "object" | "array";

/** Classe une valeur en {@link JsonKind} (rapide, sans allocation). */
export function jsonKind(v: unknown): JsonKind {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "string") return "string";
  if (t === "number" || t === "bigint") return "number";
  if (t === "boolean") return "boolean";
  return "object";
}

/** `true` si la valeur a des enfants (objet non vide / tableau non vide). */
export function isExpandable(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v).length > 0;
  return false;
}

/**
 * Couleur d'accent par type — **adaptative** dark/light (`light-dark()`, Mantine
 * v8 pose `color-scheme`). Hissée au niveau module (jamais recréée au render).
 */
export const JSON_KIND_COLOR: Record<JsonKind, string> = {
  string:
    "light-dark(var(--mantine-color-teal-8), var(--mantine-color-teal-3))",
  number:
    "light-dark(var(--mantine-color-blue-8), var(--mantine-color-blue-4))",
  boolean:
    "light-dark(var(--mantine-color-grape-8), var(--mantine-color-grape-3))",
  null: "var(--mantine-color-dimmed)",
  object: "var(--mantine-color-dimmed)",
  array: "var(--mantine-color-dimmed)",
};

/** Représentation TEXTE d'une valeur primitive (string entre guillemets). */
export function primitiveText(v: unknown): string {
  const k = jsonKind(v);
  if (k === "null") return v === undefined ? "undefined" : "null";
  if (k === "string") return JSON.stringify(v); // ajoute les guillemets + échappe
  return String(v);
}

/** Nombre d'enfants + libellé FR (« 3 clés » / « 5 éléments »). */
export function countLabel(v: unknown): string {
  if (Array.isArray(v)) return `${v.length} élément${v.length > 1 ? "s" : ""}`;
  const n = v && typeof v === "object" ? Object.keys(v).length : 0;
  return `${n} clé${n > 1 ? "s" : ""}`;
}

/**
 * Aperçu **une ligne** tronqué d'une valeur (le « preview » des nœuds repliés et
 * de {@link JsonPeek}). Objet/tableau → JSON compact tronqué ; primitive → sa
 * représentation. Best-effort : une valeur non sérialisable retombe sur `String`.
 *
 * @param v - valeur à résumer.
 * @param max - longueur max avant troncature (défaut 80).
 */
export function jsonPreview(v: unknown, max = 80): string {
  const k = jsonKind(v);
  if (k !== "object" && k !== "array") return truncate(primitiveText(v), max);
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  return truncate(s ?? String(v), max);
}

/** Tronque une chaîne à `max` caractères avec une ellipse. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** `JSON.stringify` indenté tolérant (cycle / valeur exotique → `String`). */
export function safeStringify(v: unknown, indent = 2): string {
  try {
    return JSON.stringify(v, null, indent);
  } catch {
    return String(v);
  }
}

/**
 * Tente de parser une chaîne en valeur JSON ; renvoie `{ ok, value }`. Sert à
 * décider, côté consommateur (ex. message WebSocket), s'il faut rendre via la
 * vue JSON ou en texte brut. Ne throw jamais.
 */
export function tryParseJson(s: string): { ok: boolean; value: unknown } {
  const t = s.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return { ok: false, value: s };
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    return { ok: false, value: s };
  }
}
