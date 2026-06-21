import { observer } from "mobx-react-lite";
import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconArrowLeft, IconDatabase, IconKey } from "@tabler/icons-react";
import { useStore } from "../stores";
import { useResource } from "../hooks";
import { PageLayout, DataState, DocHint } from "../components/ui";

/** Version de la doc des fiches d'aide (`DocHint`) du détail d'entité ORM. */
const ORM_DOC = "v1.0";

// ── Types miroir du data plane /nodefony/orm/api/entity/{name} ──────────────
interface ColumnInfo {
  name: string;
  type: string;
  primaryKey: boolean;
  nullable: boolean;
  unique: boolean;
}
interface RelationInfo {
  type: string;
  target: string;
  field: string;
  foreignKey?: string;
}
interface EntityNode {
  name: string;
  orm: string;
  module: string;
  domain: string;
  columns: ColumnInfo[];
  relations: RelationInfo[];
}

/**
 * Page **détail d'une entité** (table) — atteinte par clic depuis l'ERD
 * (`/nodefony/orm-entity?name=…&orm=…`). Affiche colonnes (PK/unique/null typés)
 * et relations cliquables (navigation de proche en proche dans le modèle).
 * Réutilise le data plane existant `/nodefony/orm/api/entity/{name}`.
 */
export const OrmEntity = observer(() => {
  const store = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const name = params.get("name") ?? "";
  const orm = params.get("orm") ?? "";

  const fetcher = useCallback(
    () =>
      store.api.getAbsolute<EntityNode>(
        `/nodefony/orm/api/entity/${encodeURIComponent(name)}${orm ? `?orm=${encodeURIComponent(orm)}` : ""}`,
      ),
    [store, name, orm],
  );
  const { data, loading, error, reload } = useResource(fetcher);

  const goEntity = (target: string) =>
    navigate(
      `/nodefony/orm-entity?name=${encodeURIComponent(target)}&orm=${encodeURIComponent(data?.orm ?? orm)}`,
    );

  // FK portées côté entité courante (pour marquer les colonnes).
  const fkCols = new Set(
    (data?.relations ?? [])
      .filter((r) => r.type === "many-to-one" || r.type === "one-to-one")
      .map((r) => r.foreignKey ?? r.field),
  );

  return (
    <PageLayout
      title={name || "Entité"}
      subtitle={
        data
          ? `domaine : ${data.domain || "—"} · module : ${data.module || "—"} · ORM : ${data.orm}`
          : orm
      }
      icon={<IconDatabase size={22} />}
      actions={
        <Button
          variant="light"
          leftSection={<IconArrowLeft size={16} />}
          onClick={() => navigate("/nodefony/databases")}
        >
          Retour à l'ERD
        </Button>
      }
    >
      <DataState
        loading={loading}
        error={error}
        empty={!data}
        onRetry={reload}
        emptyMessage={`Entité « ${name} » introuvable.`}
      >
        {data && (
          <Stack gap="lg">
            <Card withBorder radius="md" p="md">
              <Group justify="space-between" mb="sm">
                <Group gap={6}>
                  <Text fw={600}>Colonnes</Text>
                  <DocHint
                    title="Colonnes"
                    version={ORM_DOC}
                    summary={`${data.columns.length} colonne(s) de la table.`}
                    sections={[
                      {
                        label: "Légende",
                        body: "🔑 = clé primaire, FK = clé étrangère (relation), ◦ = unique, « ? » sur le type = nullable.",
                      },
                    ]}
                  />
                </Group>
                <Badge variant="light">{data.columns.length}</Badge>
              </Group>
              {data.columns.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Colonnes non introspectées (ORM non connecté ?).
                </Text>
              ) : (
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Colonne</Table.Th>
                      <Table.Th>Type</Table.Th>
                      <Table.Th>Clé</Table.Th>
                      <Table.Th>Nullable</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.columns.map((c) => (
                      <Table.Tr key={c.name}>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            {c.primaryKey ? (
                              <IconKey
                                size={13}
                                color="var(--mantine-color-yellow-6)"
                              />
                            ) : fkCols.has(c.name) ? (
                              <Text size="xs" fw={700} c="blue">
                                FK
                              </Text>
                            ) : (
                              <span style={{ width: 13 }} />
                            )}
                            <Text size="sm">
                              {c.name}
                              {c.unique && !c.primaryKey ? " ◦" : ""}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text c="dimmed" size="sm">
                            {c.type}
                            {c.nullable ? "?" : ""}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {c.primaryKey ? (
                            <Badge size="xs" color="yellow">
                              PK
                            </Badge>
                          ) : c.unique ? (
                            <Badge size="xs" variant="outline">
                              unique
                            </Badge>
                          ) : (
                            ""
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {c.nullable ? "oui" : "non"}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Card>

            <Card withBorder radius="md" p="md">
              <Group justify="space-between" mb="sm">
                <Group gap={6}>
                  <Text fw={600}>Relations</Text>
                  <DocHint
                    title="Relations"
                    version={ORM_DOC}
                    summary={`${data.relations.length} relation(s) déclarée(s).`}
                    sections={[
                      {
                        label: "Navigation",
                        body: "Clique une cible pour ouvrir cette table (navigation de proche en proche dans le modèle).",
                      },
                    ]}
                  />
                </Group>
                <Badge variant="light">{data.relations.length}</Badge>
              </Group>
              {data.relations.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Aucune relation déclarée.
                </Text>
              ) : (
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Champ (FK)</Table.Th>
                      <Table.Th>Cardinalité</Table.Th>
                      <Table.Th>Table cible</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.relations.map((r) => (
                      <Table.Tr key={`${r.field}>${r.target}`}>
                        <Table.Td>
                          <Text size="sm">{r.foreignKey ?? r.field}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="light">
                            {r.type}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Anchor
                            component="button"
                            type="button"
                            size="sm"
                            onClick={() => goEntity(r.target)}
                          >
                            {r.target}
                          </Anchor>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Card>
          </Stack>
        )}
      </DataState>
    </PageLayout>
  );
});
