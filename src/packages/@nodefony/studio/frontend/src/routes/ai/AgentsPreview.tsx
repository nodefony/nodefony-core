import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Grid,
  Group,
  Stack,
  Text,
  Timeline,
} from "@mantine/core";
import {
  IconBolt,
  IconBrain,
  IconCheck,
  IconHandStop,
  IconMessage,
  IconPlayerPlay,
  IconPlayerStop,
  IconRobot,
  IconTool,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DataGrid,
  DocHint,
  JsonViewer,
  PageLayout,
  StatCard,
  type DataGridColumn,
} from "../../components/ui";
import {
  AGENTS,
  AGENT_RUN,
  type AgentEventType,
  type IPreviewAgent,
  type IPreviewAgentEvent,
} from "./aiPreviewModel";
import { BreakerBadge, PreviewBanner, ZoneBadge, fmt } from "./aiPreviewParts";

const COLUMNS: DataGridColumn<IPreviewAgent>[] = [
  {
    key: "name",
    header: "Agent",
    value: (a) => a.name,
    render: (a) => (
      <Stack gap={0}>
        <Text size="sm" fw={600} ff="monospace">
          {a.name}
        </Text>
        <Text size="xs" c="dimmed">
          {a.description}
        </Text>
      </Stack>
    ),
  },
  { key: "model", header: "Modèle", value: (a) => a.model },
  {
    key: "tools",
    header: "Outils",
    value: (a) => a.tools.join(" "),
    render: (a) => (
      <Group gap={4}>
        {a.tools.map((t) => (
          <Badge key={t} variant="default" size="xs" tt="none">
            {t}
          </Badge>
        ))}
      </Group>
    ),
  },
  {
    key: "zone",
    header: "Zone",
    value: (a) => a.zone,
    render: (a) => <ZoneBadge zone={a.zone} />,
  },
  {
    key: "runs24h",
    header: "Exécutions 24 h",
    align: "right",
    value: (a) => a.runs24h,
    render: (a) => fmt(a.runs24h),
  },
  {
    key: "successRate",
    header: "Succès",
    align: "right",
    value: (a) => a.successRate,
    render: (a) => `${fmt(a.successRate, 1)} %`,
  },
  {
    key: "breaker",
    header: "Disjoncteur",
    value: (a) => a.breaker,
    render: (a) => <BreakerBadge state={a.breaker} />,
  },
];

const EVENT_META: Record<
  AgentEventType,
  { icon: ReactNode; label: string; color: string }
> = {
  started: {
    icon: <IconPlayerPlay size={12} />,
    label: "Démarrage",
    color: "blue",
  },
  thinking: {
    icon: <IconBrain size={12} />,
    label: "Réflexion",
    color: "grape",
  },
  tool_call: {
    icon: <IconTool size={12} />,
    label: "Appel d'outil",
    color: "brand",
  },
  tool_result: {
    icon: <IconCheck size={12} />,
    label: "Résultat",
    color: "teal",
  },
  approval: {
    icon: <IconHandStop size={12} />,
    label: "Approbation",
    color: "orange",
  },
  token: { icon: <IconMessage size={12} />, label: "Réponse", color: "blue" },
  completed: { icon: <IconBolt size={12} />, label: "Terminé", color: "teal" },
};

/** Délai d'affichage d'un mot quand la réponse arrive jeton par jeton. */
const WORD_MS = 45;

function EventBody({
  event,
  text,
}: {
  event: IPreviewAgentEvent;
  text?: string;
}) {
  if (event.type === "token") {
    return <Text size="sm">{text ?? event.content}</Text>;
  }
  return (
    <Stack gap={4}>
      {event.content && <Text size="sm">{event.content}</Text>}
      {event.tool && <Code>{event.tool}</Code>}
      {event.data !== undefined && (
        <JsonViewer value={event.data} maxHeight={140} />
      )}
    </Stack>
  );
}

/**
 * Agents — l'inventaire (`IAgent`), l'état de leurs disjoncteurs, et le rejeu
 * d'une exécution telle que le flux `stream()` la livrera.
 */
export function AgentsPreview() {
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [words, setWords] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tokenEvent = AGENT_RUN.find((e) => e.type === "token");
  const tokenWords = (tokenEvent?.content ?? "").split(" ");

  // Le rejeu : un événement après l'autre, au rythme qu'il aurait en vrai.
  // Un seul minuteur vivant à la fois, toujours libéré au démontage.
  useEffect(() => {
    if (!playing) return;
    const current = AGENT_RUN[shown - 1];
    const streamingTokens =
      current?.type === "token" && words < tokenWords.length;
    if (streamingTokens) {
      timer.current = setTimeout(() => setWords((w) => w + 1), WORD_MS);
    } else if (shown < AGENT_RUN.length) {
      const next = AGENT_RUN[shown] as IPreviewAgentEvent;
      timer.current = setTimeout(() => setShown((n) => n + 1), next.afterMs);
    } else {
      timer.current = setTimeout(() => setPlaying(false), 0);
    }
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [playing, shown, words, tokenWords.length]);

  const start = () => {
    setShown(0);
    setWords(0);
    setPlaying(true);
  };

  const runs = AGENTS.reduce((n, a) => n + a.runs24h, 0);
  const cost = AGENTS.reduce((n, a) => n + a.runs24h * a.avgCostEur, 0);
  const tripped = AGENTS.filter((a) => a.breaker !== "closed");

  return (
    <PageLayout
      title="Agents"
      subtitle="Des services du conteneur, avec des outils typés, une zone de confiance et un disjoncteur."
      icon={<IconRobot size={22} />}
    >
      <PreviewBanner module="@nodefony/agent" contract="IAgent / ITool" />

      <Grid>
        <StatCard label="Agents" hint="déclarés comme services injectables">
          {AGENTS.length}
        </StatCard>
        <StatCard label="Exécutions 24 h" hint="toutes zones confondues">
          {fmt(runs)}
        </StatCard>
        <StatCard label="Coût 24 h" hint="somme des usages modèle facturés">
          {fmt(cost, 2)} €
        </StatCard>
        <StatCard
          label="Disjoncteurs déclenchés"
          hint="un agent qui dérive (boucle, coût, erreurs) est coupé automatiquement"
        >
          {tripped.length}
        </StatCard>
      </Grid>

      {tripped.map((a) => (
        <Alert
          key={a.name}
          color={a.breaker === "open" ? "red" : "yellow"}
          variant="light"
          title={`${a.name} — disjoncteur ${a.breaker === "open" ? "ouvert" : "semi-ouvert"}`}
        >
          {a.breakerReason}
        </Alert>
      ))}

      <DataGrid
        mode="client"
        data={AGENTS}
        columns={COLUMNS}
        getRowId={(a) => a.name}
        searchable={false}
        height={330}
      />

      <Card withBorder radius="md" padding="md">
        <Group justify="space-between" mb="sm">
          <Group gap={6}>
            <Text fw={600}>Rejouer une exécution</Text>
            <Text size="sm" c="dimmed" ff="monospace">
              assistant-support · s-7f3a21
            </Text>
            <DocHint
              title="Ce que le flux d'un agent transporte"
              summary="Chaque étape est un événement poussé sur le canal temps réel de la session : réflexion, appel d'outil, résultat, approbation, jetons, fin."
              sections={[
                {
                  label: "Approbation",
                  body: "L'outil create_ticket engage un remboursement : l'agent s'arrête et attend qu'un humain valide. C'est la validation humaine que l'AI Act exige pour une action à fort impact.",
                },
                {
                  label: "Corrélation",
                  body: "Le requestId de la requête suit chaque appel de modèle et d'outil jusqu'au journal d'audit.",
                },
              ]}
            />
          </Group>
          {playing ? (
            <Button
              variant="light"
              color="red"
              leftSection={<IconPlayerStop size={16} />}
              onClick={() => setPlaying(false)}
            >
              Interrompre
            </Button>
          ) : (
            <Button leftSection={<IconPlayerPlay size={16} />} onClick={start}>
              {shown === 0 ? "Lancer" : "Rejouer"}
            </Button>
          )}
        </Group>

        {shown === 0 ? (
          <Text size="sm" c="dimmed">
            Lancez le rejeu pour voir l'exécution arriver événement par
            événement.
          </Text>
        ) : (
          <Timeline
            active={shown - 1}
            bulletSize={22}
            lineWidth={2}
            aria-live="polite"
          >
            {AGENT_RUN.slice(0, shown).map((e) => {
              const meta = EVENT_META[e.type];
              return (
                <Timeline.Item
                  key={`${e.type}:${e.tool ?? ""}:${e.afterMs}`}
                  bullet={meta.icon}
                  color={meta.color}
                  title={
                    <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                      {meta.label}
                    </Text>
                  }
                >
                  <EventBody
                    event={e}
                    {...(e.type === "token"
                      ? { text: tokenWords.slice(0, words).join(" ") }
                      : {})}
                  />
                </Timeline.Item>
              );
            })}
          </Timeline>
        )}
      </Card>

      <Card withBorder radius="md" padding="md">
        <Group gap={6} mb="sm">
          <Text fw={600}>Déclarer un agent</Text>
          <Badge variant="light" color="violet" size="sm">
            API envisagée
          </Badge>
        </Group>
        <Code
          block
        >{`@Agent({ name: "assistant-support", zone: "internal", model: "mistral" })
export class SupportAgent {
  constructor(@Inject() private readonly orders: OrderService) {}

  @Tool({ description: "Statut d'une commande", input: z.object({ orderId: z.string() }) })
  getOrderStatus({ orderId }: { orderId: string }) {
    return this.orders.status(orderId);
  }

  @Tool({ description: "Ouvre un ticket", approval: "required" })
  createTicket(input: TicketInput) { /* … */ }
}`}</Code>
      </Card>
    </PageLayout>
  );
}
