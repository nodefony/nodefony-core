/**
 * Aplatissement d'un JSON Schema de configuration en CATALOGUE de réglages.
 *
 * ⭐ TL;DR : rend, pour un module, la liste des clés qu'on a le droit d'écrire
 * dans `use("@nodefony/x", { … })` — chemin pointé, type, défaut, description.
 *
 * **Pourquoi ça existe.** Les schémas de configuration du framework portent des
 * centaines de `.describe()` — ce que la clé fait, ce qui arrive si on l'omet,
 * quel RFC elle applique. Ces phrases traversent `z.toJSONSchema()` et vivent
 * donc dans ce que `Module.configSchema()` rend, mais rien ne les montrait :
 * l'inspection de la configuration rendait les valeurs RÉSOLUES, jamais le
 * catalogue de ce qui est disponible. Une capacité qu'on n'atteint pas
 * n'existe pas.
 *
 * **Ce qui est rendu, et ce qui ne l'est pas.** Une ligne par FEUILLE — un
 * nœud sans sous-propriétés, c'est-à-dire ce qui se règle réellement. Les
 * sections intermédiaires (`certificates`, `session`) n'ont pas de ligne : on
 * ne leur assigne pas de valeur, et elles restent lisibles comme préfixe du
 * chemin de leurs feuilles. Un objet LIBRE (`z.looseObject`, transmis tel quel
 * à une bibliothèque tierce) n'a pas de sous-propriétés déclarées : c'est donc
 * une feuille, et c'en est bien une — on lui assigne un objet entier.
 *
 * Le cœur n'importe PAS zod : chaque module publie son schéma en JSON pur
 * (`Module.configSchema()`), et cette lecture n'y navigue que par `properties`,
 * comme {@link declaredTypeAtPath}.
 */

/**
 * Un réglage assignable, tel que le schéma le déclare.
 *
 * Les noms de champs sont ceux d'une surface d'API : ils sortent en JSON et
 * servent d'en-têtes de colonnes.
 */
export interface ISchemaLeaf {
  /** Chemin pointé de la clé, tel qu'on l'écrit dans `use()`. */
  key: string;
  /**
   * Type déclaré. Une énumération est rendue par ses valeurs (`sha256|sha384`)
   * plutôt que par `string` : c'est la contrainte qui informe, pas le type.
   */
  type: string;
  /** Défaut déclaré par le schéma, tel quel — `undefined` si le schéma n'en pose aucun. */
  default?: unknown;
  /** La phrase écrite dans le schéma (`.describe()`), chaîne vide si aucune. */
  description: string;
  /**
   * Ce que les métadonnées Nodefony disent de la clé, en un mot — `réservé`,
   * `secret`, `dérivé du kernel`, `modifiable à chaud`. Vide si aucune.
   *
   * C'est la colonne qui évite de régler un champ INERTE : `reserved` marque
   * une clé acceptée par le schéma dont le code ne fait encore rien.
   */
  note: string;
}

/** Métadonnées Nodefony posées par `.meta()`, et le mot qui les rend. */
const NOTES: readonly [string, string][] = [
  ["reserved", "réservé"],
  ["secret", "secret"],
  ["kernelDerived", "dérivé du kernel"],
  ["runtimeMutable", "modifiable à chaud"],
];

/**
 * Rend le type d'un nœud sous la forme la plus informative disponible.
 *
 * Une énumération est rendue par ses valeurs : `"string"` ne dit pas qu'on ne
 * peut écrire que `sha256`, `sha384` ou `sha512`, alors que c'est exactement ce
 * qu'on a besoin de savoir avant d'écrire la clé.
 *
 * @param node - le nœud de schéma.
 * @returns le type à afficher, `"?"` si le schéma n'en déclare aucun.
 */
function typeOf(node: Record<string, unknown>): string {
  const values = node.enum;
  if (Array.isArray(values) && values.length > 0) {
    return values.map((v) => String(v)).join("|");
  }
  const t = node.type;
  if (typeof t === "string") {
    return t;
  }
  if (Array.isArray(t)) {
    return t.map((v) => String(v)).join("|");
  }
  // `anyOf`/`oneOf` sans type : on le DIT plutôt que d'inventer un type qui
  // serait cru. Le lecteur ouvrira le schéma, ce qui est le bon geste ici.
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    return "union";
  }
  return "?";
}

/**
 * Rend le mot qui décrit les métadonnées Nodefony d'un nœud.
 *
 * @param node - le nœud de schéma.
 * @returns les mots trouvés, séparés par une virgule ; chaîne vide si aucun.
 */
function noteOf(node: Record<string, unknown>): string {
  const found: string[] = [];
  for (const [flag, word] of NOTES) {
    if (node[flag] === true) {
      found.push(word);
    }
  }
  return found.join(", ");
}

/**
 * Aplatit un JSON Schema de module en catalogue de réglages assignables.
 *
 * @param schema - le JSON Schema, tel que `Module.configSchema()` le rend.
 * @returns une entrée par feuille, dans l'ordre de déclaration du schéma ;
 *   un tableau vide si le schéma est absent ou d'une forme non navigable.
 */
export function flattenConfigSchema(schema: unknown): ISchemaLeaf[] {
  const out: ISchemaLeaf[] = [];
  if (schema === null || typeof schema !== "object") {
    return out;
  }
  walk(schema as Record<string, unknown>, [], out);
  return out;
}

/**
 * Descend un nœud et pousse ses feuilles.
 *
 * @param node - le nœud courant.
 * @param path - les segments déjà traversés.
 * @param out - le catalogue en construction, muté en place.
 */
function walk(
  node: Record<string, unknown>,
  path: string[],
  out: ISchemaLeaf[],
): void {
  const props = node.properties;
  if (props !== null && typeof props === "object") {
    const bag = props as Record<string, unknown>;
    const keys = Object.keys(bag);
    if (keys.length > 0) {
      for (const key of keys) {
        const child = bag[key];
        if (child !== null && typeof child === "object") {
          walk(child as Record<string, unknown>, [...path, key], out);
        }
      }
      return;
    }
  }
  // La RACINE d'un schéma sans aucune propriété n'est pas un réglage : elle
  // n'a pas de chemin, donc rien à écrire dans `use()`.
  if (path.length === 0) {
    return;
  }
  const description = node.description;
  out.push({
    key: path.join("."),
    type: typeOf(node),
    ...("default" in node ? { default: node.default } : {}),
    description: typeof description === "string" ? description : "",
    note: noteOf(node),
  });
}

export default flattenConfigSchema;
