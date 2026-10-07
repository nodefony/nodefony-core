import {
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Progress,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconSearch, IconVector } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import {
  DataGrid,
  DocHint,
  PageLayout,
  StatCard,
  type DataGridColumn,
} from "../../components/ui";
import {
  COLLECTIONS,
  searchCorpus,
  type IPreviewCollection,
  type IPreviewSearchResult,
} from "./aiPreviewModel";
import { PreviewBanner, fmt } from "./aiPreviewParts";

const COLUMNS: DataGridColumn<IPreviewCollection>[] = [
  {
    key: "collection",
    header: "Collection",
    render: (c) => (
      <Text size="sm" fw={600} ff="monospace">
        {c.collection}
      </Text>
    ),
    value: (c) => c.collection,
  },
  { key: "adapter", header: "Adaptateur", value: (c) => c.adapter },
  {
    key: "embedModel",
    header: "Modèle d'embedding",
    value: (c) => c.embedModel,
    render: (c) => (
      <Text size="sm" ff="monospace">
        {c.embedModel}
      </Text>
    ),
  },
  {
    key: "dimensions",
    header: "Dimensions",
    align: "right",
    value: (c) => c.dimensions,
  },
  { key: "distance", header: "Distance", value: (c) => c.distance },
  { key: "index", header: "Index", value: (c) => c.index },
  {
    key: "vectors",
    header: "Vecteurs",
    align: "right",
    value: (c) => c.vectors,
    render: (c) => fmt(c.vectors),
  },
  {
    key: "sizeMb",
    header: "Taille",
    align: "right",
    value: (c) => c.sizeMb,
    render: (c) => `${fmt(c.sizeMb)} Mo`,
  },
  { key: "lastWrite", header: "Dernière écriture", value: (c) => c.lastWrite },
];

/** Une ligne de résultat : rang, score, passage, et ce qui le rend citable. */
export function SearchHit({ hit }: { hit: IPreviewSearchResult }) {
  const c = hit.chunk;
  return (
    <Card withBorder radius="md" padding="sm">
      <Group justify="space-between" wrap="nowrap" mb={6}>
        <Group gap={8} wrap="nowrap">
          <Badge variant="filled" color="brand" size="sm" circle>
            {hit.rank}
          </Badge>
          <Text size="sm" fw={600}>
            {c.source}
            {c.page ? ` · p. ${c.page}` : ""}
          </Text>
          {c.section && (
            <Text size="xs" c="dimmed">
              {c.section}
            </Text>
          )}
        </Group>
        <Text size="xs" ff="monospace" c="dimmed">
          sha256 {c.hash}…
        </Text>
      </Group>
      <Text size="sm">{c.text}</Text>
      <Group gap="xs" mt={8} wrap="nowrap">
        <Progress
          value={hit.score * 100}
          size="xs"
          style={{ flex: 1 }}
          color={
            hit.score >= 0.75 ? "teal" : hit.score >= 0.6 ? "yellow" : "gray"
          }
          aria-label={`similarité ${hit.score.toFixed(3)}`}
        />
        <Text
          size="xs"
          ff="monospace"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {hit.score.toFixed(3)}
        </Text>
      </Group>
    </Card>
  );
}

/**
 * Bases vectorielles — les collections (`IVectorStore`) et une recherche de
 * similarité qui classe réellement un petit corpus simulé.
 */
export function VectorStoresPreview() {
  const [collection, setCollection] = useState<string | null>(null);
  const [query, setQuery] = useState("délai pour annuler une commande");
  const [submitted, setSubmitted] = useState(query);

  const hits = useMemo(
    () =>
      searchCorpus(submitted, {
        ...(collection ? { collection } : {}),
        limit: 5,
      }),
    [submitted, collection],
  );

  const total = COLLECTIONS.reduce((n, c) => n + c.vectors, 0);
  const size = COLLECTIONS.reduce((n, c) => n + c.sizeMb, 0);

  return (
    <PageLayout
      title="Bases vectorielles"
      subtitle="Les collections d'embeddings, et ce qu'elles rendent pour une question."
      icon={<IconVector size={22} />}
    >
      <PreviewBanner module="@nodefony/vector" contract="IVectorStore" />

      <Grid>
        <StatCard
          label="Collections"
          hint="une collection = un modèle d'embedding, une dimension"
        >
          {COLLECTIONS.length}
        </StatCard>
        <StatCard label="Vecteurs" hint="passages indexés, toutes collections">
          {fmt(total)}
        </StatCard>
        <StatCard label="Volume" hint="index HNSW compris">
          {fmt(size)} Mo
        </StatCard>
        <StatCard
          label="Recherche (p95)"
          hint="top-5, filtre de collection compris"
        >
          38 ms
        </StatCard>
      </Grid>

      <DataGrid
        mode="client"
        data={COLLECTIONS}
        columns={COLUMNS}
        getRowId={(c) => c.collection}
        searchable={false}
        height={240}
      />

      <Card withBorder radius="md" padding="md">
        <Group gap={6} mb="sm">
          <Text fw={600}>Recherche de similarité</Text>
          <DocHint
            title="Ce que fait cette recherche simulée"
            summary="Elle classe vraiment un petit corpus, par proximité de mots. Le vrai index comparera des embeddings ; la forme du résultat sera la même."
            sections={[
              {
                label: "Score",
                body: "Similarité cosinus, de 0 à 1. En dessous de 0,6, un passage n'est pas jugé assez proche pour être cité.",
              },
              {
                label: "Empreinte",
                body: "Chaque passage garde l'empreinte SHA-256 de son texte d'origine : une citation se vérifie, elle ne se croit pas.",
              },
            ]}
          />
        </Group>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(query);
          }}
        >
          <Group gap="xs" align="flex-end" mb="md">
            <TextInput
              label="Question"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Select
              label="Collection"
              placeholder="toutes"
              clearable
              data={COLLECTIONS.map((c) => c.collection)}
              value={collection}
              onChange={setCollection}
              w={220}
            />
            <Button type="submit" leftSection={<IconSearch size={16} />}>
              Chercher
            </Button>
          </Group>
        </form>
        <Stack gap="xs" aria-live="polite">
          {hits.length === 0 ? (
            <Text size="sm" c="dimmed">
              Aucun passage dans cette collection.
            </Text>
          ) : (
            hits.map((h) => <SearchHit key={h.chunk.id} hit={h} />)
          )}
        </Stack>
      </Card>
    </PageLayout>
  );
}
