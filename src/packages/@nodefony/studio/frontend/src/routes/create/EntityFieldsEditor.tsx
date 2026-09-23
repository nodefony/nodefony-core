/**
 * Éditeur des champs d'une entité — une LIGNE par champ, au lieu d'une grammaire
 * à taper (`titre:string(120)? auteur:ref:User`).
 *
 * Il n'analyse rien : chaque changement réécrit la réponse `fields` dans la
 * grammaire de la commande (`serializeFields`), et l'analyseur du générateur
 * reste l'unique juge — la préview le rejoue avant toute écriture. Les types
 * proposés viennent du serveur (`context.columnTypes`), les cibles d'une relation
 * aussi (entités référençables depuis la cible choisie).
 */
import { useState } from "react";
import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Paper,
  Select,
  Stack,
  TagsInput,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { DocHint } from "../../components/ui";
import {
  NO_DEFAULT_TYPES,
  emptyFieldRow,
  serializeFields,
  type IFieldRow,
} from "./createModel";

interface EntityFieldsEditorProps {
  /** Types de champ du générateur, dans son ordre. */
  types: string[];
  /** Entités qu'une relation peut viser depuis la cible choisie. */
  referenceable: string[];
  error: string | null;
  onChange: (fields: string) => void;
}

export function EntityFieldsEditor({
  types,
  referenceable,
  error,
  onChange,
}: EntityFieldsEditorProps) {
  const [rows, setRows] = useState<IFieldRow[]>([emptyFieldRow(1)]);
  const [nextId, setNextId] = useState(2);

  /** Met les lignes à jour ET la réponse sérialisée — jamais l'une sans l'autre. */
  const commit = (next: IFieldRow[]): void => {
    setRows(next);
    onChange(serializeFields(next));
  };
  const patch = (id: number, change: Partial<IFieldRow>): void =>
    commit(rows.map((r) => (r.id === id ? { ...r, ...change } : r)));

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Text size="sm" fw={500}>
          Champs
        </Text>
        <DocHint
          title="Composer les champs"
          summary={`${rows.length} champ(s) en cours. Chaque ligne est traduite dans la grammaire de la commande, et le générateur la valide à la préview : ce que l'écran accepte est exactement ce que le terminal accepterait.`}
          sections={[
            {
              label: "Obligatoire par défaut",
              body: "Un champ est NON NUL tant que « facultatif » n'est pas coché. « unique » pose une contrainte d'unicité, qui indexe déjà ; « indexé » un index simple.",
            },
            {
              label: "Relation",
              body:
                referenceable.length > 0
                  ? `Le type « ref » vise une entité existante : ${referenceable.join(", ")}.`
                  : "Le type « ref » vise une entité existante — cette cible n'en a encore aucune.",
            },
          ]}
        />
      </Group>

      {rows.map((row, index) => (
        <Paper key={row.id} withBorder p="xs">
          <Group gap="xs" align="flex-end" wrap="wrap">
            <TextInput
              label="Nom"
              placeholder="publishedAt"
              value={row.name}
              onChange={(e) => patch(row.id, { name: e.currentTarget.value })}
              w={180}
              aria-label={`Nom du champ ${index + 1}`}
            />
            <Select
              label="Type"
              data={types}
              value={row.type}
              onChange={(v) => {
                const type = v ?? "string";
                // Un décimal EXIGE sa précision et son échelle : les poser,
                // visibles et modifiables, plutôt que d'envoyer un type refusé.
                patch(row.id, {
                  type,
                  ...(type === "decimal" && !row.precision
                    ? { precision: "10", scale: "2" }
                    : {}),
                });
              }}
              allowDeselect={false}
              w={130}
            />
            {(row.type === "string" || row.type === "char") && (
              <TextInput
                label={row.type === "char" ? "Longueur exacte" : "Longueur max"}
                placeholder={row.type === "char" ? "2" : "255"}
                value={row.length}
                onChange={(e) =>
                  patch(row.id, {
                    length: e.currentTarget.value.replace(/\D/gu, ""),
                  })
                }
                w={120}
              />
            )}
            {row.type === "decimal" && (
              <>
                <TextInput
                  label="Chiffres"
                  placeholder="10"
                  value={row.precision}
                  onChange={(e) =>
                    patch(row.id, {
                      precision: e.currentTarget.value.replace(/\D/gu, ""),
                    })
                  }
                  w={90}
                />
                <TextInput
                  label="Décimales"
                  placeholder="2"
                  value={row.scale}
                  onChange={(e) =>
                    patch(row.id, {
                      scale: e.currentTarget.value.replace(/\D/gu, ""),
                    })
                  }
                  w={90}
                />
              </>
            )}
            {row.type === "enum" && (
              <TagsInput
                label="Valeurs admises"
                placeholder="draft, puis Entrée"
                value={row.values}
                onChange={(values) => patch(row.id, { values })}
                w={240}
              />
            )}
            {row.type === "ref" && (
              <Select
                label="Entité visée"
                data={referenceable}
                value={row.target || null}
                onChange={(v) => patch(row.id, { target: v ?? "" })}
                placeholder={referenceable.length ? "choisir" : "aucune entité"}
                disabled={referenceable.length === 0}
                w={160}
              />
            )}
            {!NO_DEFAULT_TYPES.has(row.type) && (
              <TextInput
                label="Défaut"
                placeholder={row.type === "bool" ? "true" : "—"}
                value={row.defaultValue}
                onChange={(e) =>
                  patch(row.id, { defaultValue: e.currentTarget.value })
                }
                w={110}
              />
            )}
            <Stack gap={4} pb={4}>
              <Checkbox
                label="facultatif"
                checked={row.nullable}
                onChange={(e) =>
                  patch(row.id, { nullable: e.currentTarget.checked })
                }
              />
              <Group gap="sm">
                <Checkbox
                  label="unique"
                  checked={row.unique}
                  onChange={(e) =>
                    patch(row.id, { unique: e.currentTarget.checked })
                  }
                />
                <Checkbox
                  label="indexé"
                  checked={row.indexed || row.unique || row.type === "ref"}
                  disabled={row.unique || row.type === "ref"}
                  onChange={(e) =>
                    patch(row.id, { indexed: e.currentTarget.checked })
                  }
                />
              </Group>
            </Stack>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={`Retirer le champ ${row.name || index + 1}`}
              disabled={rows.length === 1}
              onClick={() => commit(rows.filter((r) => r.id !== row.id))}
              mb={6}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        </Paper>
      ))}

      <Group>
        <Button
          variant="light"
          size="compact-sm"
          leftSection={<IconPlus size={14} />}
          onClick={() => {
            setNextId(nextId + 1);
            commit([...rows, emptyFieldRow(nextId)]);
          }}
        >
          Ajouter un champ
        </Button>
      </Group>
      {error && (
        <Text size="sm" c="red" role="alert">
          {error}
        </Text>
      )}
    </Stack>
  );
}
