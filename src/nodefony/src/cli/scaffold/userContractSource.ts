import { createRequire } from "node:module";
import path from "node:path";
import type { IEntityField, TEntityFieldType } from "./entityFields";

/**
 * Une colonne du contrat utilisateur, telle que `@nodefony/user` la publie.
 *
 * Le type est redéclaré ici — et c'est délibéré, ce n'est pas une copie du
 * contrat. Le cœur ne dépend pas de `@nodefony/user` (c'est l'inverse : le
 * module d'identité dépend du cœur), donc il ne peut pas en importer le type.
 * Ce qui est décrit ici est la FORME LUE, pas la liste des colonnes — celle-là
 * n'est jamais recopiée, elle est lue à l'exécution dans l'application cible.
 */
export interface IUserContractColumn {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly unique?: boolean;
  readonly origin: "identity" | "column" | "audit";
  readonly makeDefault?: () => unknown;
  readonly refreshedOnWrite?: boolean;
  readonly readers: readonly string[];
  readonly description: string;
}

/**
 * Lit le contrat de colonnes de l'utilisateur DANS l'application cible.
 *
 * La liste ne peut pas vivre dans le générateur : elle appartient à
 * `@nodefony/user`, et une seconde copie ici divergerait — exactement ce que la
 * source unique a supprimé. Elle est donc résolue depuis l'application, ce qui a
 * un second mérite : c'est la version que CETTE application a installée qui est
 * écrite dans son entité, jamais celle du dépôt qui a produit le générateur.
 *
 * @param appRoot - racine de l'application où l'entité sera écrite.
 * @returns les colonnes du contrat, dans l'ordre où le module les publie.
 * @throws Error si le module d'identité n'est pas installé — sans lui, il n'y a
 *   pas d'utilisateur à générer, et deviner les colonnes serait le pire choix.
 */
export function readUserContract(
  appRoot: string,
): readonly IUserContractColumn[] {
  // `require` et non `import()` : le scaffold est SYNCHRONE de bout en bout, et
  // le rendre asynchrone pour cette seule lecture propagerait l'attente jusqu'à
  // ses appelants — la ligne de commande, la console d'administration, les
  // bancs. Node charge un module ESM par `require` depuis la 22.12, et ce dépôt
  // exige 24 : la contrainte est tenue par `engines`, pas par la chance.
  const requireFromApp = createRequire(path.join(appRoot, "package.json"));
  let module: { USER_COLUMNS?: readonly IUserContractColumn[] };
  try {
    // Résolution depuis le `package.json` de l'APP : c'est son arbre de
    // dépendances qui fait foi, pas celui du processus qui exécute la commande.
    module = requireFromApp("@nodefony/user") as typeof module;
  } catch {
    throw new Error(
      "create entity User : le module d'identité « @nodefony/user » n'est pas " +
        "installé dans cette application — sans lui il n'y a pas d'utilisateur à " +
        "générer.\n  → l'ajouter : npm install @nodefony/user",
    );
  }
  const columns = module.USER_COLUMNS;
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error(
      "create entity User : « @nodefony/user » n'expose pas son contrat de " +
        "colonnes (`USER_COLUMNS`) — version trop ancienne pour que l'entité " +
        "puisse être écrite sans deviner.\n  → mettre le module à jour",
    );
  }
  return columns;
}

/**
 * Traduction d'un type LOGIQUE du contrat vers le vocabulaire de champ du
 * générateur — le seul endroit qui connaisse les deux.
 */
const FIELD_TYPE_BY_CONTRACT: Record<string, TEntityFieldType> = {
  uuid: "uuid",
  string: "string",
  "string[]": "json",
  boolean: "bool",
  object: "json",
  "object[]": "json",
  date: "date",
};

/**
 * Convertit les colonnes du contrat en champs du générateur.
 *
 * La clé primaire est écartée : le générateur la produit lui-même, et le contrat
 * n'en dit que le type. Les horodatages passent par `defaultNow` — « maintenant »
 * n'est pas une valeur littérale que la grammaire sache écrire.
 *
 * Les valeurs par défaut sont OBTENUES du contrat, pas devinées : la fabrique est
 * appelée, et son résultat sérialisé. C'est ce qui garantit qu'un défaut ajouté
 * au contrat apparaît dans les entités générées ensuite, sans toucher ici.
 *
 * @param columns - le contrat, tel que l'application l'a installé.
 * @returns les champs, dans l'ordre du contrat.
 */
export function userContractFields(
  columns: readonly IUserContractColumn[],
): IEntityField[] {
  const fields: IEntityField[] = [];
  for (const column of columns) {
    if (column.origin === "identity") continue;
    const type = FIELD_TYPE_BY_CONTRACT[column.type];
    if (!type) {
      throw new Error(
        `create entity User : le contrat déclare la colonne « ${column.name} » ` +
          `avec un type inconnu du générateur (« ${column.type} ») — ` +
          `« @nodefony/user » est plus récent que cette version de la ligne de commande.`,
      );
    }
    const field: IEntityField = {
      name: column.name,
      type,
      nullable: column.nullable,
      unique: column.unique === true,
      indexed: false,
    };
    if (column.origin === "audit") {
      field.defaultNow = true;
      if (column.refreshedOnWrite) field.refreshedOnWrite = true;
    } else if (column.makeDefault) {
      const value = column.makeDefault();
      field.defaultValue =
        typeof value === "string" ? value : JSON.stringify(value);
    }
    fields.push(field);
  }
  return fields;
}

/**
 * Refuse un champ métier obligatoire qui n'aurait aucune valeur par défaut.
 *
 * Le framework CRÉE des utilisateurs sans connaître ces champs — au semis d'un
 * administrateur, à la première connexion par un fournisseur externe. Un champ
 * obligatoire qu'il ne peut pas renseigner fait échouer ces chemins, et le
 * prototype a montré comment : le semis échoue avec un **code de sortie 0**,
 * l'application démarre, et il n'y a simplement aucun administrateur.
 *
 * Le même champ pose un second problème, plus tard : ajouté à une table déjà
 * peuplée, un `ADD COLUMN … NOT NULL` sans défaut est refusé par le serveur.
 * Une seule règle ferme les deux.
 *
 * @param fields - les champs demandés par l'utilisateur (hors contrat).
 * @throws Error en nommant le champ et les deux façons de le rendre acceptable.
 */
export function assertUserFieldsAreFillable(fields: IEntityField[]): void {
  const orphans = fields.filter(
    (f) => !f.nullable && f.defaultValue === undefined && !f.defaultNow,
  );
  if (orphans.length === 0) return;
  const names = orphans.map((f) => f.name).join(", ");
  throw new Error(
    `create entity User : le(s) champ(s) « ${names} » sont obligatoires et sans ` +
      `valeur par défaut. Le framework crée des utilisateurs sans les connaître ` +
      `(semis d'un administrateur, première connexion par un fournisseur externe) : ` +
      `ces créations échoueraient, et le semis échoue SANS code d'erreur — ` +
      `l'application démarre alors sans administrateur.\n` +
      `  → les rendre facultatifs : ${orphans.map((f) => `${f.name}:${f.type}?`).join(" ")}\n` +
      `  → ou leur donner un défaut : ${orphans.map((f) => `${f.name}:${f.type}=<valeur>`).join(" ")}`,
  );
}
