import { observer } from "mobx-react-lite";
import { useState, useRef, useEffect } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Collapse,
  Group,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconPlayerStop,
  IconRobot,
  IconSend,
  IconTool,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import { useChat, useConnection } from "../stores";
import type { ChatMessage } from "../stores/ChatStore";
import {
  AGENTS,
  type IChatCitation,
  type IChatStep,
} from "./ai/aiPreviewModel";
import { PageHeader, PAGE_CONTENT_HEIGHT } from "../components/ui";
import { BreakerBadge, PreviewBanner, ZoneBadge } from "./ai/aiPreviewParts";

/** Questions d'amorce : chacune touche une partie différente du corpus simulé. */
const SUGGESTIONS = [
  "Quel est le délai de rétractation ?",
  "Comment annuler une commande en cours de livraison ?",
  "Que devient la mémoire d'un client qui demande l'effacement ?",
  "Quel est le chiffre d'affaires 2025 ?",
];

const STEP_ICON: Record<IChatStep["kind"], typeof IconBrain> = {
  thinking: IconBrain,
  tool_call: IconTool,
  tool_result: IconCheck,
};

/**
 * Chat IA temps réel — la vue agentique : l'agent réfléchit, appelle ses
 * outils, cite ses sources et peut être interrompu.
 *
 * La réponse est SIMULÉE (`ChatStore`), mais dans la forme du flux visé : le
 * même écran lira demain les événements d'un vrai agent sur un canal abonné.
 * L'invite de la console de développement (`--ui --mouse`) en est la prémisse
 * côté terminal.
 */
export const Chat = observer(() => {
  const chat = useChat();
  const conn = useConnection();
  const [input, setInput] = useState("");
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    viewport.current?.scrollTo({
      top: viewport.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat.messages.length, chat.currentResponse, chat.currentSteps.length]);

  const submit = (text = input) => {
    if (!text.trim() || chat.isStreaming) return;
    void chat.send(text);
    setInput("");
  };

  return (
    <Stack gap="md" h={PAGE_CONTENT_HEIGHT}>
      <PageHeader
        sticky
        title="Chat IA"
        subtitle="Un agent qui cherche avant de répondre, cite ce qu'il a trouvé, et s'arrête quand on le lui demande."
        icon={<IconRobot size={22} />}
        actions={
          <Group gap="xs">
            <Badge color={conn.isConnected ? "teal" : "yellow"} variant="light">
              {conn.isConnected ? "temps réel connecté" : "hors ligne"}
            </Badge>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label="Effacer la conversation"
              onClick={() => chat.clear()}
              disabled={chat.messages.length === 0 || chat.isStreaming}
            >
              <IconTrash size={18} />
            </ActionIcon>
          </Group>
        }
      />

      <PreviewBanner module="@nodefony/agent" contract="IAgent.stream()" />

      <AgentPicker />

      <Card
        withBorder
        radius="md"
        p={0}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <ScrollArea viewportRef={viewport} style={{ flex: 1 }} p="md">
          <Stack gap="md" aria-live="polite">
            {chat.messages.length === 0 && !chat.isStreaming && (
              <Stack gap="sm">
                <Text size="sm" c="dimmed">
                  Posez une question, ou partez d'un exemple :
                </Text>
                <Group gap="xs">
                  {SUGGESTIONS.map((s) => (
                    <Button
                      key={s}
                      variant="light"
                      size="xs"
                      radius="xl"
                      onClick={() => submit(s)}
                    >
                      {s}
                    </Button>
                  ))}
                </Group>
              </Stack>
            )}
            {chat.messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
            {chat.isStreaming && (
              <ChatBubble
                message={{
                  id: "streaming",
                  role: "assistant",
                  content: chat.currentResponse,
                  ts: 0,
                  steps: chat.currentSteps,
                  streaming: true,
                  agent: chat.agent.name,
                }}
              />
            )}
            {chat.error && (
              <Alert color="red" variant="light">
                {chat.error}
              </Alert>
            )}
          </Stack>
        </ScrollArea>

        <Group
          gap="xs"
          p="sm"
          align="flex-end"
          style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
        >
          <Textarea
            placeholder="Posez une question à l'agent…"
            aria-label="Question à l'agent"
            autosize
            minRows={1}
            maxRows={6}
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={chat.isStreaming}
            style={{ flex: 1 }}
          />
          {chat.isStreaming ? (
            <ActionIcon
              size="lg"
              variant="light"
              color="red"
              onClick={() => chat.abort()}
              aria-label="Interrompre la réponse"
            >
              <IconPlayerStop size={18} />
            </ActionIcon>
          ) : (
            <ActionIcon
              size="lg"
              variant="filled"
              color="brand"
              onClick={() => submit()}
              disabled={!input.trim()}
              aria-label="Envoyer"
            >
              <IconSend size={18} />
            </ActionIcon>
          )}
        </Group>
      </Card>
    </Stack>
  );
});

/** Le choix de l'agent, et ce qu'il emporte avec lui : modèle, connaissances, outils, zone. */
const AgentPicker = observer(() => {
  const chat = useChat();
  const a = chat.agent;
  return (
    <Card withBorder radius="md" padding="sm">
      <Group gap="md" align="flex-end" wrap="wrap">
        <Select
          label="Agent"
          data={AGENTS.map((x) => ({ value: x.name, label: x.name }))}
          value={chat.agentName}
          onChange={(v) => v && chat.setAgent(v)}
          disabled={chat.isStreaming}
          allowDeselect={false}
          w={220}
        />
        <Stack gap={4} style={{ flex: 1, minWidth: 260 }}>
          <Text size="xs" c="dimmed">
            {a.description}
          </Text>
          <Group gap={6}>
            <Badge variant="light" size="sm" tt="none">
              {a.model}
            </Badge>
            <ZoneBadge zone={a.zone} />
            <BreakerBadge state={a.breaker} />
            {a.collections.length > 0 ? (
              a.collections.map((c) => (
                <Badge
                  key={c}
                  variant="outline"
                  color="teal"
                  size="sm"
                  tt="none"
                >
                  RAG · {c}
                </Badge>
              ))
            ) : (
              <Badge variant="outline" color="gray" size="sm" tt="none">
                sans base documentaire
              </Badge>
            )}
            {a.tools.map((t) => (
              <Badge key={t} variant="default" size="xs" tt="none">
                {t}
              </Badge>
            ))}
          </Group>
        </Stack>
      </Group>
    </Card>
  );
});

/** Le déroulé de l'agent : replié une fois la réponse arrivée, ouvert pendant. */
function StepsPanel({ steps, live }: { steps: IChatStep[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const expanded = live || open;
  return (
    <Stack gap={4}>
      <UnstyledButton
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expanded}
        disabled={live}
      >
        <Group gap={4}>
          {expanded ? (
            <IconChevronDown size={14} />
          ) : (
            <IconChevronRight size={14} />
          )}
          <Text size="xs" c="dimmed">
            {live
              ? "L'agent travaille…"
              : `Raisonnement et outils (${steps.length} étapes)`}
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse expanded={expanded}>
        <Stack gap={6} pl="md">
          {steps.map((s) => {
            const Icon = STEP_ICON[s.kind];
            return (
              <Group
                key={`${s.kind}-${s.label}`}
                gap={6}
                align="flex-start"
                wrap="nowrap"
              >
                <Icon size={14} style={{ marginTop: 3, flexShrink: 0 }} />
                <Stack gap={2} style={{ minWidth: 0 }}>
                  {s.kind === "tool_call" ? (
                    <Code>{s.label}</Code>
                  ) : (
                    <Text size="xs" fw={600}>
                      {s.label}
                    </Text>
                  )}
                  {s.detail && (
                    <Text
                      size="xs"
                      c="dimmed"
                      ff="monospace"
                      style={{ whiteSpace: "pre-wrap" }}
                    >
                      {s.detail}
                    </Text>
                  )}
                </Stack>
              </Group>
            );
          })}
        </Stack>
      </Collapse>
    </Stack>
  );
}

function Citations({ citations }: { citations: IChatCitation[] }) {
  return (
    <Group gap={6}>
      {citations.map((c) => (
        <Badge key={c.index} variant="outline" size="sm" tt="none">
          [{c.index}] {c.source}
          {c.page ? ` p.${c.page}` : ""} · {c.score.toFixed(2)}
        </Badge>
      ))}
    </Group>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const steps = message.steps ?? [];
  return (
    <Group
      align="flex-start"
      wrap="nowrap"
      justify={isUser ? "flex-end" : "flex-start"}
    >
      {!isUser && (
        <Paper radius="xl" p={6} bg="dark.6">
          <IconRobot size={18} />
        </Paper>
      )}
      <Paper
        radius="md"
        p="sm"
        withBorder
        bg={isUser ? "orange.9" : undefined}
        style={{ maxWidth: "75%" }}
      >
        <Stack gap="xs">
          {!isUser && message.agent && (
            <Text size="xs" c="dimmed" ff="monospace">
              {message.agent}
            </Text>
          )}
          {!isUser && steps.length > 0 && (
            <StepsPanel
              steps={steps}
              live={Boolean(message.streaming) && !message.content}
            />
          )}
          {(message.content || !message.streaming) && (
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {message.content}
              {message.streaming && (
                <Text span c="dimmed">
                  ▍
                </Text>
              )}
            </Text>
          )}
          {message.aborted && (
            <Text size="xs" c="orange">
              Réponse interrompue.
            </Text>
          )}
          {message.citations && message.citations.length > 0 && (
            <Citations citations={message.citations} />
          )}
          {message.usage && (
            <Text
              size="xs"
              c="dimmed"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {message.usage.model} · {message.usage.inputTokens} jetons en
              entrée · {message.usage.outputTokens} en sortie ·{" "}
              {message.usage.costEur.toFixed(4)} €
            </Text>
          )}
        </Stack>
      </Paper>
      {isUser && (
        <Paper radius="xl" p={6} bg="orange.7">
          <IconUser size={18} />
        </Paper>
      )}
    </Group>
  );
}
