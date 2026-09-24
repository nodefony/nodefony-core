import type { Writable } from "node:stream";
import {
  ENTITY_FIELD_TYPES,
  EntityFieldError,
  TYPES_WITHOUT_DEFAULT,
  formatEntityField,
  parseEntityFields,
  type IEntityField,
  type TEntityFieldType,
} from "./entityFields";
import type { IScaffoldQuestion } from "./spec";

/**
 * Compose les champs d'une entité UN PAR UN, dans le terminal — au lieu de
 * demander la grammaire `nom:type?:unique` à quelqu'un qui découvre.
 *
 * Le dialogue ne décide rien : chaque champ composé est écrit par
 * {@link formatEntityField} puis JUGÉ par {@link parseEntityFields}, le seul
 * analyseur. Un refus (nom déjà pris, défaut hors des valeurs…) s'affiche tel
 * que l'analyseur le formule, et le champ se recompose. La ligne de commande
 * `create entity Post titre:string …` reste intacte : c'est exactement la ligne
 * que le récapitulatif montre, pour qu'on l'apprenne en passant.
 *
 * Module sans terminal : il reçoit la fonction qui pose une question, si bien
 * que le rendu riche et le readline le servent sans copie, et qu'un test le
 * pilote sur des flux simulés.
 */

/** Pose une question de la spec et rend la réponse — rendu riche ou readline. */
export type TAskQuestion = (
  question: IScaffoldQuestion,
) => Promise<string | boolean | string[]>;

/**
 * Ce que chaque type veut dire, en mots — une ENTRÉE par type, imposée par le
 * typage : un type ajouté au vocabulaire sans libellé ne compile pas.
 */
const TYPE_HINTS: Record<TEntityFieldType | "ref", string> = {
  string: "texte court (255 caractères par défaut)",
  text: "texte long, sans limite",
  int: "nombre entier",
  float: "nombre à virgule (approché)",
  bool: "oui / non",
  json: "document JSON libre",
  date: "date et heure",
  uuid: "identifiant UUID",
  enum: "une valeur parmi une liste fixe",
  char: "texte de longueur FIXE (code pays, devise…)",
  decimal: "nombre décimal EXACT (montants)",
  ref: "relation vers une autre entité",
};

const NAME_PATTERN = "^$|^[a-z][a-zA-Z0-9]*$";
const ENTITY_PATTERN = "^[A-Z][A-Za-z0-9]*$";
const POSITIVE_PATTERN = "^[1-9][0-9]*$";

/** Une question ouverte, construite à la volée (le vide prend `def`). */
function text(
  key: string,
  label: string,
  def: string,
  pattern?: string,
  patternHint?: string,
): IScaffoldQuestion {
  return {
    key,
    label,
    type: "string",
    default: def,
    ...(pattern ? { pattern } : {}),
    ...(patternHint ? { patternHint } : {}),
  };
}

/**
 * Compose les champs, et rend la réponse `fields` telle que la ligne de
 * commande l'aurait reçue.
 *
 * @param ask - pose une question (rendu riche ou readline).
 * @param out - le flux où s'écrivent les confirmations et le récapitulatif.
 * @param targets - entités qu'une relation peut viser (vide → saisie libre).
 * @param entity - nom de l'entité en cours, pour le récapitulatif.
 * @returns les déclarations séparées par des espaces, `""` si aucun champ.
 */
export async function composeEntityFields(
  ask: TAskQuestion,
  out: Writable,
  targets: readonly string[],
  entity: string,
): Promise<string> {
  const lines: string[] = [];
  out.write("Champs de l'entité — un à la fois, nom vide pour terminer.\n");
  for (;;) {
    const name = String(
      await ask(
        text(
          "fieldName",
          `Champ n°${lines.length + 1} — nom (vide = terminer)`,
          "",
          NAME_PATTERN,
          "camelCase attendu — ex : title, publishedAt",
        ),
      ),
    );
    if (name === "") break;
    const field = await composeOne(ask, name, targets);
    const line = formatEntityField(field);
    try {
      // L'analyseur juge la liste ENTIÈRE : un nom en double ne se voit
      // qu'avec les champs déjà acceptés.
      parseEntityFields([...lines, line].join(" "));
    } catch (error) {
      if (!(error instanceof EntityFieldError)) throw error;
      out.write(`  → ${error.message}\n`);
      continue;
    }
    lines.push(line);
    out.write(`  ✓ ${line}\n`);
  }
  const fields = lines.join(" ");
  if (fields !== "") {
    out.write(
      `Ligne équivalente : nodefony create entity ${entity || "<Nom>"} ${fields}\n`,
    );
  }
  return fields;
}

/** Les questions d'UN champ, selon son type. */
async function composeOne(
  ask: TAskQuestion,
  name: string,
  targets: readonly string[],
): Promise<IEntityField> {
  const type = String(
    await ask({
      key: "fieldType",
      label: `Type de « ${name} »`,
      type: "choice",
      default: "string",
      choices: [...ENTITY_FIELD_TYPES, "ref" as const].map((t) => ({
        value: t,
        label: t,
        hint: TYPE_HINTS[t],
      })),
    }),
  ) as TEntityFieldType | "ref";
  const field: IEntityField = {
    name,
    type,
    nullable: false,
    unique: false,
    indexed: false,
  };

  if (type === "string") {
    const length = String(
      await ask(
        text(
          "length",
          "Longueur maximale (vide = 255)",
          "",
          `^$|${POSITIVE_PATTERN}`,
          "un entier positif, ou vide",
        ),
      ),
    );
    if (length !== "") field.length = Number(length);
  } else if (type === "char") {
    // Pas de défaut : un `char` sans longueur n'a pas de sens, l'analyseur
    // le refuse — le dialogue ne le devine pas non plus.
    field.length = Number(
      await ask(
        text(
          "length",
          "Longueur exacte",
          "",
          POSITIVE_PATTERN,
          "un entier positif",
        ),
      ),
    );
  } else if (type === "decimal") {
    field.precision = Number(
      await ask(
        text(
          "precision",
          "Chiffres significatifs",
          "12",
          POSITIVE_PATTERN,
          "un entier positif",
        ),
      ),
    );
    field.scale = Number(
      await ask(
        text(
          "scale",
          "Chiffres après la virgule",
          "2",
          "^[0-9]+$",
          "un entier",
        ),
      ),
    );
  } else if (type === "enum") {
    field.values = String(
      await ask(
        text(
          "values",
          "Valeurs admises (séparées par des virgules)",
          "",
          "\\S",
          "au moins une valeur, ex : draft,published",
        ),
      ),
    )
      .split(/[\s,]+/u)
      .filter(Boolean);
  } else if (type === "ref") {
    field.target = String(
      await ask(
        targets.length > 0
          ? {
              key: "target",
              label: "Entité visée",
              type: "choice",
              default: targets[0] ?? "",
              choices: targets.map((t) => ({ value: t, label: t })),
            }
          : text(
              "target",
              "Entité visée (PascalCase, ex : User)",
              "",
              ENTITY_PATTERN,
              "PascalCase attendu — ex : User, BlogPost",
            ),
      ),
    );
  }

  field.nullable =
    (await ask({
      key: "nullable",
      label: "Facultatif (peut rester vide) ?",
      type: "boolean",
      default: false,
    })) === true;

  if (type === "ref") {
    // Une relation est indexée d'office ; seule l'unicité (relation 1-1) se choisit.
    field.unique =
      (await ask({
        key: "unique",
        label: "Unique (relation 1-1) ?",
        type: "boolean",
        default: false,
      })) === true;
    field.indexed = !field.unique;
  } else {
    const constraint = String(
      await ask({
        key: "constraint",
        label: "Contrainte",
        type: "choice",
        default: "none",
        choices: [
          { value: "none", label: "aucune" },
          {
            value: "index",
            label: "indexé",
            hint: "recherches et tris rapides sur ce champ",
          },
          {
            value: "unique",
            label: "unique",
            hint: "deux lignes ne peuvent pas porter la même valeur",
          },
        ],
      }),
    );
    field.unique = constraint === "unique";
    field.indexed = constraint === "index";
  }

  if (!TYPES_WITHOUT_DEFAULT.has(type)) {
    const def = await askDefault(ask, field);
    if (def !== "") field.defaultValue = def;
  }
  return field;
}

/** La valeur par défaut : un choix quand l'ensemble est fermé, sinon du texte. */
async function askDefault(
  ask: TAskQuestion,
  field: IEntityField,
): Promise<string> {
  const closed =
    field.type === "bool"
      ? ["true", "false"]
      : field.type === "enum"
        ? (field.values ?? [])
        : null;
  if (closed) {
    return String(
      await ask({
        key: "defaultValue",
        label: "Valeur par défaut",
        type: "choice",
        default: "",
        choices: [
          { value: "", label: "aucune" },
          ...closed.map((v) => ({ value: v, label: v })),
        ],
      }),
    );
  }
  return String(
    await ask(text("defaultValue", "Valeur par défaut (vide = aucune)", "")),
  );
}
