/**
 * Onglet **Décors** de la page Configuration — les environnements de test du
 * cœur (conteneurs + variables `NF_*`), une boîte par décor.
 *
 * N'existe que sur le dépôt du framework : la page ne l'affiche que si
 * `testbed-capability` répond `supported: true` (constat serveur). Le rapport
 * est calculé à la demande (un process côté serveur, ~2 s), jamais sur minuterie.
 */
import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Grid,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconRefresh,
  IconServer,
} from "@tabler/icons-react";
import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import { DataState, DocHint, StatCard } from "../../components/ui";
import {
  CONTAINER_TEXT,
  STATE_BADGE,
  groupTestbeds,
  playedByText,
  summarize,
  type TestbedBox,
  type TestbedFilter,
  type TestbedResponse,
} from "./testbedModel";

const MONO = { fontSize: 12 } as const;
const WRAP = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;

/**
 * Commande à copier. Elle revient à la ligne plutôt que de défiler : une zone
 * qui défile sans être atteignable au clavier est un défaut WCAG 2.1.1 (axe
 * `scrollable-region-focusable`), et le bouton copie la commande entière.
 */
function CommandLine({ command }: { command: string }) {
  return (
    <Group gap={6} wrap="nowrap" align="flex-start">
      <Code block style={{ ...MONO, ...WRAP, flex: 1, minWidth: 0 }}>
        $ {command}
      </Code>
      <CopyButton value={command} timeout={1500}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? "Copié" : "Copier la commande"} withArrow>
            <ActionIcon
              variant="light"
              color={copied ? "teal" : "gray"}
              aria-label="Copier la commande"
              onClick={copy}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}

/** Étiquette de section dans une boîte. */
function Caption({ children }: { children: string }) {
  return (
    <Text
      size="xs"
      tt="uppercase"
      c="dimmed"
      fw={600}
      style={{ letterSpacing: ".04em" }}
    >
      {children}
    </Text>
  );
}

/** Une boîte de décor. */
function TestbedCard({ box }: { box: TestbedBox }) {
  const badge = STATE_BADGE[box.state];
  const services = box.services
    .map((s) => `nodefony-${s.name} · ${CONTAINER_TEXT[s.state]}`)
    .join(" — ");
  const missing = box.server?.missing ?? [];
  return (
    <Paper
      withBorder
      radius="md"
      p="md"
      h="100%"
      style={{
        contain: "content",
        borderColor:
          box.state === "ready"
            ? undefined
            : "var(--mantine-color-orange-filled)",
      }}
    >
      <Stack gap="sm">
        <Group
          justify="space-between"
          align="flex-start"
          wrap="nowrap"
          gap="sm"
        >
          <div style={{ minWidth: 0 }}>
            <Title order={3} size="h5">
              {box.label}
            </Title>
            <Text size="xs" c="dimmed" ff="monospace">
              {services || "sans conteneur"}
            </Text>
          </div>
          <Badge
            variant="light"
            color={badge.color}
            tt="none"
            style={{ flexShrink: 0 }}
          >
            {badge.label}
          </Badge>
        </Group>

        <Text size="sm">{box.purpose}</Text>

        <Stack gap={4}>
          <Group gap={6}>
            <Caption>Variables du test</Caption>
            <DocHint
              title="Variables du test"
              summary={`Le process de test lit ${box.vars.length === 1 ? "cette variable" : `ces ${box.vars.length} variables`}. Tu n'as rien à poser : npm run test:all les calcule depuis le compose avant de lancer vitest. Lancer vitest à la main sans elles fait sauter les cas — et un saut compte comme vert.`}
            />
          </Group>
          {box.vars.map((v) => (
            <Code key={v.name} block style={{ ...MONO, ...WRAP }}>
              {v.name} = {v.value}
            </Code>
          ))}
          {box.sharedWith.length > 0 && (
            <Text size="xs" c="dimmed">
              Même variable que : {box.sharedWith.join(", ")} — une seule valeur
              à la fois.
            </Text>
          )}
        </Stack>

        {box.server && (
          <Alert
            variant="light"
            color={missing.length ? "orange" : "teal"}
            icon={<IconServer size={16} />}
            p="xs"
            title={
              missing.length
                ? `Côté serveur : ${missing.length} / ${box.server.required.length} manquante(s)`
                : `Côté serveur : ${box.server.required.length} / ${box.server.required.length} posée(s)`
            }
          >
            <Text size="xs">
              {missing.length
                ? `À ajouter au .env du poste, puis redémarrer le serveur : ${missing.join(", ")}. Sans elles, le banc échoue sans dire pourquoi.`
                : "Le serveur porte bien ce que ce décor lui demande."}
            </Text>
          </Alert>
        )}

        <Stack gap={6}>
          <Caption>Débloque</Caption>
          <Group gap={6}>
            {box.suites.length ? (
              box.suites.map((s) => (
                <Tooltip key={s.config} label={s.config} withArrow>
                  <Badge variant="default" tt="none" tabIndex={0}>
                    {s.label}
                    {s.proofs ? ` · ${s.proofs} preuve(s)` : ""}
                  </Badge>
                </Tooltip>
              ))
            ) : (
              <Badge variant="outline" color="gray" tt="none">
                aucune suite ne le déclare
              </Badge>
            )}
          </Group>
          <Text size="xs" c={box.playedBy === "manual" ? "orange" : "dimmed"}>
            {playedByText(box)}
          </Text>
        </Stack>

        {box.upCommand && <CommandLine command={box.upCommand} />}

        {box.note && (
          <Text
            size="xs"
            c="dimmed"
            style={{
              borderTop: "1px dashed var(--mantine-color-default-border)",
              paddingTop: 8,
            }}
          >
            {box.note}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

export const ConfigTestbed = observer(() => {
  const store = useStore();
  const fetcher = useCallback(
    () => store.api.getAbsolute<TestbedResponse>("/nodefony/test/api/testbed"),
    [store],
  );
  const { data, loading, error, reload } = useResource(fetcher);
  const [filter, setFilter] = useState<TestbedFilter>("all");
  // `supported` discrimine le rapport du refus constaté.
  const r = data?.supported === true ? data : null;
  const groups = useMemo(
    () => (r ? groupTestbeds(r.testbeds, filter) : []),
    [r, filter],
  );

  if (!r) {
    return (
      <DataState
        loading={loading}
        error={error ?? (data?.supported === false ? data.reason : null)}
        empty={!loading && !error}
        onRetry={reload}
        emptyMessage="Aucun constat des décors."
      >
        {null}
      </DataState>
    );
  }

  const s = summarize(r);
  const at = new Date(r.generatedAt).toLocaleTimeString("fr-FR");

  return (
    <Stack gap="lg">
      <Text size="sm" c="dimmed" maw={900}>
        Ce que le cœur exige pour que ses tests disent vrai. Sans un décor, des
        suites entières sautent, et un saut compte comme vert. Cet onglet
        n'existe que sur le dépôt du framework.
      </Text>

      <Grid>
        <StatCard
          label="Décors prêts"
          hint={`${s.ready} décor(s) sur ${s.total} ont tous leurs conteneurs démarrés et sains. ${s.todo ? `${s.todo} demande(nt) un geste : conteneur arrêté ou variable manquante côté serveur.` : "Rien à monter."}`}
        >
          <Text fz={28} fw={700} ff="monospace">
            {s.ready} / {s.total}
          </Text>
        </StatCard>
        <StatCard
          label="Interrupteurs ouverts"
          hint={`Les interrupteurs NF_RUN_* ouvrent des bancs coûteux (perf, boots réels, cluster, ruptures). ${s.switchesOpen} sur ${s.switchesTotal} sont ouverts dans l'environnement du serveur — fermés par défaut, à raison.`}
        >
          <Text fz={28} fw={700} ff="monospace">
            {s.switchesOpen} / {s.switchesTotal}
          </Text>
        </StatCard>
        <StatCard
          label="Outils lancés"
          hint={`${s.toolsUp} outil(s) sur ${s.toolsTotal} tournent (tableaux, boîte aux lettres, navigateur…). Aucun test ne les exige : ils servent l'humain.`}
        >
          <Text fz={28} fw={700} ff="monospace">
            {s.toolsUp} / {s.toolsTotal}
          </Text>
        </StatCard>
        <StatCard
          label="Constaté"
          hint={
            r.docker
              ? `Constat pris à ${at} : un seul docker inspect, au rechargement — jamais sur minuterie.`
              : "Docker ne répond pas : l'état des conteneurs est inconnu, pas « arrêté »."
          }
        >
          <Group gap="xs" wrap="nowrap">
            <Text fw={600}>{r.docker ? at : "docker injoignable"}</Text>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconRefresh size={14} />}
              loading={loading}
              onClick={reload}
            >
              Recharger
            </Button>
          </Group>
        </StatCard>
      </Grid>

      {r.blindSpots.length > 0 && (
        <Alert
          variant="light"
          color="orange"
          icon={<IconAlertTriangle size={18} />}
          title={`Angles morts constatés — ${r.blindSpots.length}`}
        >
          <Stack gap={4}>
            {r.blindSpots.map((b) => (
              <Text key={`${b.kind}:${b.subject}`} size="sm">
                <Text span fw={600}>
                  {b.subject}
                </Text>{" "}
                — {b.detail}
              </Text>
            ))}
            <Text size="xs" c="dimmed">
              Calculés à chaque constat par des règles : un trou bouché
              disparaît de lui-même.
            </Text>
          </Stack>
        </Alert>
      )}

      <Group gap="sm">
        <SegmentedControl
          aria-label="Filtrer les décors"
          value={filter}
          onChange={(v) => setFilter(v === "todo" || v === "ready" ? v : "all")}
          data={[
            { value: "all", label: `Tous · ${s.total}` },
            { value: "todo", label: `À monter · ${s.todo}` },
            { value: "ready", label: `Prêts · ${s.total - s.todo}` },
          ]}
        />
      </Group>

      {groups.map((g) => (
        <Stack key={g.family} gap="sm">
          <Title
            order={2}
            size="xs"
            tt="uppercase"
            c="dimmed"
            style={{ letterSpacing: ".06em" }}
          >
            {g.title}
          </Title>
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            {g.boxes.map((b) => (
              <TestbedCard key={b.id} box={b} />
            ))}
          </SimpleGrid>
        </Stack>
      ))}
      {groups.length === 0 && (
        <Text size="sm" c="dimmed">
          Aucun décor dans ce filtre.
        </Text>
      )}

      <Stack gap="sm">
        <Title
          order={2}
          size="xs"
          tt="uppercase"
          c="dimmed"
          style={{ letterSpacing: ".06em" }}
        >
          Interrupteurs de coût
        </Title>
        <Paper withBorder radius="md">
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="xs" horizontalSpacing="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Interrupteur</Table.Th>
                  <Table.Th>Ce qu'il ouvre</Table.Th>
                  <Table.Th>Suites qui le lisent</Table.Th>
                  <Table.Th>État</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {r.switches.map((w) => (
                  <Table.Tr key={w.env}>
                    <Table.Td>
                      <Code style={MONO}>{w.env}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{w.what}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {w.suites.join(" · ") || "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        color={w.open ? "teal" : "gray"}
                        tt="none"
                      >
                        {w.open ? "ouvert" : "fermé"}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      </Stack>

      <Stack gap="sm">
        <Title
          order={2}
          size="xs"
          tt="uppercase"
          c="dimmed"
          style={{ letterSpacing: ".06em" }}
        >
          Outils — aucun test ne les exige
        </Title>
        <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 4 }} spacing="sm">
          {r.tools.map((t) => {
            const up = t.state === "healthy" || t.state === "running";
            return (
              <Paper key={t.service} withBorder radius="md" p="sm">
                <Group gap={8} wrap="nowrap">
                  <Badge
                    size="xs"
                    circle
                    variant={up ? "filled" : "outline"}
                    color={up ? "teal" : "gray"}
                    aria-hidden
                  >
                    {" "}
                  </Badge>
                  <Text fw={600} size="sm" truncate>
                    {t.label}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {t.oneShot && t.state === "stopped"
                    ? "terminé"
                    : CONTAINER_TEXT[t.state]}{" "}
                  · {t.what}
                </Text>
              </Paper>
            );
          })}
        </SimpleGrid>
      </Stack>

      <Text size="xs" c="dimmed">
        Même source que <Code style={MONO}>npm run test:all -- --infra</Code> :{" "}
        <Code style={MONO}>scripts/test/vitest/gates.ts</Code>, attentes
        exportées par chaque <Code style={MONO}>vitest*.config.ts</Code>.
      </Text>
    </Stack>
  );
});
