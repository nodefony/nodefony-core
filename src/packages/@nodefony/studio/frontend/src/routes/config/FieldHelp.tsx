/**
 * **FieldHelp** — bulle « Comment changer ce réglage ? », la même partout : dans
 * la table d'un module, dans l'onglet Noyau et dans les résultats de recherche.
 *
 * Elle répond, pour UN réglage, aux trois questions d'un débutant : quelle valeur
 * s'applique et qui l'a posée, comment la changer (fichier, variable, à chaud),
 * et ce qu'elle accepte. Tout vient des données du réglage : rien n'est écrit en dur.
 */
import { Code, Text } from "@mantine/core";
import { DocHint, type DocSection } from "../../components/ui";
import type { ISearchableField } from "./configSearchEngine";
import { SOURCE_TEXT, configSnippet } from "./configTexts";

export interface FieldHelpProps {
  /** Le réglage (un `ConfigField` s'y passe tel quel). */
  field: ISearchableField;
  /** Nom du paquet du module (`@nodefony/security`) ou de l'application. */
  moduleName: string;
  /** Réglage du noyau (racine de `defineConfig`). */
  isApp: boolean;
}

/** Sections de la fiche d'aide d'un réglage (exportées pour être éprouvées). */
export function fieldHelpSections({
  field,
  moduleName,
  isApp,
}: FieldHelpProps): DocSection[] {
  const variable = field.env ?? field.recipe;
  const sections: DocSection[] = [
    {
      label: "Valeur actuelle",
      body: SOURCE_TEXT[field.source ?? "default"],
    },
    {
      label: "Dans le code",
      body: (
        <>
          Dans <Code>nodefony.config.ts</Code> :{" "}
          <Code block style={{ fontSize: 11, marginTop: 4 }}>
            {configSnippet(moduleName, field.key, isApp)}
          </Code>
        </>
      ),
    },
  ];
  if (variable) {
    sections.push({
      label: "Sans toucher au code",
      body: (
        <>
          Poser <Code>{`${variable}=…`}</Code> dans le fichier <Code>.env</Code>{" "}
          du poste, ou chez l'hébergeur en production. La variable l'emporte sur
          le fichier.
        </>
      ),
    });
  }
  sections.push({
    label: "Quand c'est pris en compte",
    body:
      field.mutability === "live"
        ? "Tout de suite : modifiable directement dans cette console en développement, sans redémarrer."
        : "Au prochain démarrage de l'application.",
  });
  if (field.type || typeof field.constraint === "string") {
    sections.push({
      label: "Valeurs possibles",
      body: (
        <Text size="xs" span>
          {field.type ? <Code>{field.type}</Code> : null}
          {typeof field.constraint === "string" ? ` · ${field.constraint}` : ""}
        </Text>
      ),
    });
  }
  if (field.secret) {
    sections.push({
      label: "Secret",
      body: "Jamais affiché ici ni écrit dans les journaux. En production, la valeur passe de préférence par un fichier (variable suffixée _FILE).",
    });
  }
  if (field.reserved) {
    sections.push({
      label: "Réservé",
      body: "Pas encore lu par le code : le changer n'a aucun effet aujourd'hui.",
    });
  }
  return sections;
}

/** Bulle ⓘ « Comment changer ce réglage ? ». */
export function FieldHelp(props: FieldHelpProps) {
  const { field } = props;
  return (
    <DocHint
      title={`Comment changer ${field.key} ?`}
      summary={
        typeof field.description === "string" && field.description
          ? field.description
          : "Le schéma de ce module ne décrit pas ce réglage."
      }
      sections={fieldHelpSections(props)}
      width={400}
    />
  );
}
