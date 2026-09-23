/**
 * Panneau « Types de champ » de l'écran « Créer » — type `entity` seulement.
 *
 * Il montre ce que le générateur ÉCRIRA pour chaque type, sur le moteur de
 * l'application : la table vient du serveur (`context.columnTypes`, dérivée du
 * générateur lui-même), rien n'est recopié ici. Seules la syntaxe à taper et les
 * limites de chaque moteur sont rédigées — elles décrivent la grammaire, pas un état.
 */
import { useState } from "react";
import {
  Badge,
  Code,
  Group,
  List,
  Paper,
  Stack,
  Switch,
  Table,
  Text,
} from "@mantine/core";
import { DocHint } from "../../components/ui";
import {
  ENGINES,
  ENGINE_NOTES,
  fieldSyntax,
  type IScaffoldProjectContext,
} from "./createModel";

interface EntityFieldTypesProps {
  context: IScaffoldProjectContext;
  /** Moteur de l'entité à générer (celui du connecteur choisi). */
  engine: string | null;
  /** Entités que `ref:` peut viser depuis la cible choisie. */
  referenceable: string[];
}

/** Libellé lisible d'un moteur (`postgres` → `PostgreSQL`). */
const engineLabel = (key: string | null): string =>
  ENGINES.find((e) => e.key === key)?.label ?? key ?? "inconnu";

export function EntityFieldTypes({
  context,
  engine,
  referenceable,
}: EntityFieldTypesProps) {
  // Divulgation progressive : le moteur de l'application d'abord ; les trois
  // autres sur demande — c'est l'information qu'on cherche en changeant de base.
  const [compare, setCompare] = useState(false);
  const shown = compare
    ? ENGINES
    : ENGINES.filter((e) => e.key === engine).concat(
        engine && ENGINES.some((e) => e.key === engine) ? [] : ENGINES,
      );
  const note = engine ? ENGINE_NOTES[engine] : undefined;

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="xs">
            <Text fw={600}>Types de champ</Text>
            <Badge variant="light" color="brand">
              moteur : {engineLabel(engine)}
            </Badge>
            <DocHint
              title="Ce que le générateur écrit"
              summary={`${context.columnTypes.length} types, rendus tels que CETTE version du générateur les écrit sur ${ENGINES.length} moteurs. Le moteur affiché suit le connecteur choisi dans les réglages.`}
              sections={[
                {
                  label: "Grammaire",
                  body: "nom:type — non nul par défaut. « ? » rend facultatif, « =valeur » fixe un défaut littéral, « :index » pose un index, « :unique » l'unicité. Le « ! » est refusé : un champ est déjà obligatoire.",
                },
                {
                  label: "Casse",
                  body: "Entité et cible d'une relation en PascalCase (Post, ref:User), champ en camelCase (publishedAt). Une faute de casse ou un type d'un autre outil (boolean, integer) est refusé avec la forme juste.",
                },
              ]}
            />
          </Group>
          <Switch
            label="Comparer les moteurs"
            checked={compare}
            onChange={(e) => setCompare(e.currentTarget.checked)}
          />
        </Group>

        {note && (
          <Text size="sm" c="dimmed">
            <Text span fw={600} c="yellow.8">
              À savoir sur {engineLabel(engine)} :
            </Text>{" "}
            {note}
          </Text>
        )}

        <Table.ScrollContainer minWidth={compare ? 760 : 420}>
          <Table striped withTableBorder verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">Type</Table.Th>
                <Table.Th scope="col">Syntaxe</Table.Th>
                {shown.map((e) => (
                  <Table.Th key={e.key} scope="col">
                    {e.label}
                    {e.key === engine && compare ? " (ici)" : ""}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {context.columnTypes.map((t) => (
                <Table.Tr key={t.type}>
                  <Table.Td>
                    <Code>{t.type}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Code>{fieldSyntax(t.type)}</Code>
                  </Table.Td>
                  {shown.map((e) => (
                    <Table.Td key={e.key}>
                      {/* Rendu en TEXTE : c'est du code généré, jamais du HTML. */}
                      <Text
                        size="xs"
                        ff="monospace"
                        fw={e.key === engine ? 600 : 400}
                      >
                        {t.byDialect[e.key] ?? "—"}
                      </Text>
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

        <Stack gap={4}>
          <Text size="sm" fw={600}>
            Entités qu'une relation peut viser
          </Text>
          {referenceable.length > 0 ? (
            <List size="sm" spacing={2}>
              {referenceable.map((name) => (
                <List.Item key={name}>
                  <Code>{`champ:ref:${name}`}</Code>
                </List.Item>
              ))}
            </List>
          ) : (
            <Text size="sm" c="dimmed">
              Aucune entité dans cette cible : une relation vers une entité
              absente est refusée. Crée d'abord la cible, puis la relation.
            </Text>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
