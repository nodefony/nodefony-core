import {
  Badge,
  Button,
  Card,
  Code,
  Grid,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Stepper,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconBooks, IconSearch, IconTool } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import {
  ChartCard,
  DataGrid,
  DocHint,
  MiniChart,
  PageLayout,
  StatCard,
  type DataGridColumn,
} from "../../components/ui";
import {
  INGESTION_STEPS,
  RETRIEVAL_QUALITY,
  SOURCES,
  planChatReply,
  searchCorpus,
  type IPreviewSource,
} from "./aiPreviewModel";
import { PreviewBanner, fmt } from "./aiPreviewParts";
import { SearchHit } from "./VectorStoresPreview";

const STRATEGY: Record<IPreviewSource["strategy"], string> = {
  fixed: "taille fixe",
  sentence: "par phrase",
  paragraph: "par paragraphe",
};

const COLUMNS: DataGridColumn<IPreviewSource>[] = [
  {
    key: "source",
    header: "Source",
    render: (s) => (
      <Group gap={6} wrap="nowrap">
        <Badge variant="default" size="xs">
          {s.kind}
        </Badge>
        <Text size="sm" fw={600}>
          {s.source}
        </Text>
      </Group>
    ),
    value: (s) => s.source,
  },
  { key: "collection", header: "Collection", value: (s) => s.collection },
  {
    key: "strategy",
    header: "Découpage",
    value: (s) => STRATEGY[s.strategy],
    render: (s) => (
      <Text size="sm">
        {STRATEGY[s.strategy]}{" "}
        <Text span size="xs" c="dimmed">
          {s.chunkSize}/{s.chunkOverlap}
        </Text>
      </Text>
    ),
  },
  {
    key: "chunks",
    header: "Passages",
    align: "right",
    value: (s) => s.chunks,
    render: (s) => fmt(s.chunks),
  },
  {
    key: "piiMasked",
    header: "PII masquées",
    align: "right",
    value: (s) => s.piiMasked,
    render: (s) =>
      s.piiMasked > 0 ? (
        <Badge color="grape" variant="light" size="sm">
          {fmt(s.piiMasked)}
        </Badge>
      ) : (
        "0"
      ),
  },
  {
    key: "status",
    header: "État",
    value: (s) => s.status,
    render: (s) =>
      s.status === "indexing" ? (
        <Progress
          value={s.progress ?? 0}
          size="lg"
          w={110}
          aria-label={`indexation ${s.progress ?? 0} %`}
        />
      ) : s.status === "error" ? (
        <Tooltip label={s.error} multiline w={260}>
          <Badge color="red" variant="light" size="sm">
            en erreur
          </Badge>
        </Tooltip>
      ) : (
        <Badge color="teal" variant="light" size="sm">
          indexé · {s.indexed}
        </Badge>
      ),
  },
];

/**
 * Connaissances — les sources, la chaîne d'ingestion, la qualité mesurée, et
 * la recherche vue comme ce qu'elle sera : un OUTIL que l'agent appelle (§4.2).
 */
export function KnowledgePreview() {
  const [question, setQuestion] = useState(
    "Quel est le délai de rétractation ?",
  );
  const [asked, setAsked] = useState(question);
  const plan = useMemo(() => planChatReply(asked), [asked]);
  const hits = useMemo(() => searchCorpus(asked, { limit: 3 }), [asked]);

  const chunks = SOURCES.reduce((n, s) => n + s.chunks, 0);
  const pii = SOURCES.reduce((n, s) => n + s.piiMasked, 0);
  const q = RETRIEVAL_QUALITY;

  return (
    <PageLayout
      title="Connaissances (RAG)"
      subtitle="Ce que les agents savent, d'où ils le tiennent — et la preuve qu'ils le citent."
      icon={<IconBooks size={22} />}
    >
      <PreviewBanner module="@nodefony/rag" contract="IRagService" />

      <Grid>
        <StatCard label="Sources" hint="documents suivis, toutes collections">
          {SOURCES.length}
        </StatCard>
        <StatCard label="Passages" hint="morceaux indexés et vectorisés">
          {fmt(chunks)}
        </StatCard>
        <StatCard
          label="Réponses citées"
          hint="part des réponses d'agent rattachées à au moins une source (AI Act)"
        >
          {fmt(q.citedAnswers * 100)} %
        </StatCard>
        <StatCard
          label="PII masquées"
          hint="données personnelles retirées AVANT la vectorisation — elles n'atteignent aucun modèle"
        >
          {fmt(pii)}
        </StatCard>
      </Grid>

      <Card withBorder radius="md" padding="md">
        <Text fw={600} mb="sm">
          Chaîne d'ingestion
        </Text>
        <Stepper active={INGESTION_STEPS.length} size="sm" iconSize={28}>
          {INGESTION_STEPS.map((s) => (
            <Stepper.Step
              key={s.label}
              label={s.label}
              description={s.detail}
            />
          ))}
        </Stepper>
      </Card>

      <DataGrid
        mode="client"
        data={SOURCES}
        columns={COLUMNS}
        getRowId={(s) => s.source}
        searchable={false}
        height={300}
      />

      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
        <ChartCard
          title="Rappel à 5"
          caption="part des questions de référence dont le bon passage figure dans les 5 premiers"
          badge={<Badge variant="light">{fmt(q.recallAt5, 2)}</Badge>}
        >
          <MiniChart
            series={[
              {
                data: q.recallHistory,
                color: "var(--mantine-color-teal-6)",
                label: "rappel à 5",
              },
            ]}
            max={1}
            format={(v) => v.toFixed(2)}
          />
        </ChartCard>
        <Card withBorder radius="md" padding="md">
          <Text size="sm" c="dimmed">
            Rang réciproque moyen
          </Text>
          <Text fz={28} fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmt(q.mrr, 2)}
          </Text>
          <Text size="xs" c="dimmed">
            1 = le bon passage arrive toujours premier.
          </Text>
        </Card>
        <Card withBorder radius="md" padding="md">
          <Text size="sm" c="dimmed">
            Fidélité
          </Text>
          <Text fz={28} fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmt(q.faithfulness, 2)}
          </Text>
          <Text size="xs" c="dimmed">
            part des affirmations d'une réponse que ses sources soutiennent.
          </Text>
        </Card>
      </SimpleGrid>

      <Card withBorder radius="md" padding="md">
        <Group gap={6} mb="sm">
          <Text fw={600}>Question test</Text>
          <DocHint
            title="La recherche est un outil, pas un tuyau"
            summary="L'agent décide quand chercher, quoi chercher, et s'il relance. Ici, le même appel qu'il ferait, puis la réponse citée qu'il rendrait."
            sections={[
              {
                label: "Sans résultat assez proche",
                body: "L'agent le dit et ne répond pas : une réponse sans source est exactement ce que la traçabilité interdit.",
              },
            ]}
          />
        </Group>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAsked(question);
          }}
        >
          <Group gap="xs" align="flex-end" mb="md">
            <TextInput
              label="Question posée à l'agent"
              value={question}
              onChange={(e) => setQuestion(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button type="submit" leftSection={<IconSearch size={16} />}>
              Interroger
            </Button>
          </Group>
        </form>
        <Stack gap="sm" aria-live="polite">
          <Group gap={8}>
            <IconTool size={16} />
            <Text size="sm">Appel d'outil</Text>
            <Code>
              search_knowledge({JSON.stringify({ query: asked, limit: 3 })})
            </Code>
          </Group>
          {hits.map((h) => (
            <SearchHit key={h.chunk.id} hit={h} />
          ))}
          <Card
            radius="md"
            padding="md"
            bg="var(--mantine-color-default-hover)"
          >
            <Text size="sm" fw={600} mb={4}>
              Réponse de l'agent
            </Text>
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {plan.answer}
            </Text>
            {plan.citations.length > 0 && (
              <Group gap={6} mt="sm">
                {plan.citations.map((c) => (
                  <Badge key={c.index} variant="outline" size="sm">
                    [{c.index}] {c.source}
                    {c.page ? ` p.${c.page}` : ""}
                  </Badge>
                ))}
              </Group>
            )}
          </Card>
        </Stack>
      </Card>
    </PageLayout>
  );
}
