import { observer } from "mobx-react-lite";
import { useState, useRef, useEffect } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Card,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { IconSend, IconRobot, IconUser, IconTrash } from "@tabler/icons-react";
import { useChat, useConnection } from "../stores";

/**
 * Chat IA temps réel — préfigure la vue agentic Nodefony (P12).
 *
 * Pour le POC, le `ChatStore` mock le streaming token-by-token. Quand P12
 * sera là, ChatStore.send() utilisera `RealtimeClient.stream("chat:send", ...)`.
 */
export const Chat = observer(() => {
  const chat = useChat();
  const conn = useConnection();
  const [input, setInput] = useState("");
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages.length, chat.currentResponse]);

  const submit = () => {
    if (!input.trim() || chat.isStreaming) return;
    void chat.send(input);
    setInput("");
  };

  return (
    <Stack gap="md" h="calc(100vh - 96px)">
      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Title order={2}>Chat IA</Title>
          <Text c="dimmed" size="sm">
            Pipeline cible : @nodefony/agent + LLM provider + streaming via le Core isomorphe `nodefony` (RealtimeClient, P12).
          </Text>
        </Stack>
        <Group gap="xs">
          <Badge color={conn.isConnected ? "teal" : "yellow"} variant="light">
            {conn.isConnected ? "RT online" : "mock local"}
          </Badge>
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label="Clear chat"
            onClick={() => chat.clear()}
            disabled={chat.messages.length === 0}
          >
            <IconTrash size={18} />
          </ActionIcon>
        </Group>
      </Group>

      <Card withBorder radius="md" p={0} style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <ScrollArea viewportRef={viewport} style={{ flex: 1 }} p="md">
          <Stack gap="md">
            {chat.messages.length === 0 && !chat.isStreaming && (
              <Alert color="blue" variant="light" icon={<IconRobot size={18} />}>
                Aucun message. Tape ci-dessous pour interroger l'agent (mock).
              </Alert>
            )}
            {chat.messages.map((m) => (
              <ChatBubble key={m.id} role={m.role} content={m.content} />
            ))}
            {chat.isStreaming && chat.currentResponse && (
              <ChatBubble role="assistant" content={chat.currentResponse} streaming />
            )}
            {chat.error && (
              <Alert color="red" variant="light">
                {chat.error}
              </Alert>
            )}
          </Stack>
        </ScrollArea>

        <Group gap="xs" p="sm" align="flex-end" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
          <Textarea
            placeholder="Pose une question à l'agent…"
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
          <ActionIcon
            size="lg"
            variant="filled"
            color="brand"
            onClick={submit}
            disabled={!input.trim() || chat.isStreaming}
            aria-label="Send"
          >
            <IconSend size={18} />
          </ActionIcon>
        </Group>
      </Card>
    </Stack>
  );
});

function ChatBubble({
  role,
  content,
  streaming,
}: {
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
}) {
  const isUser = role === "user";
  return (
    <Group align="flex-start" wrap="nowrap" justify={isUser ? "flex-end" : "flex-start"}>
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
        style={{ maxWidth: "70%", whiteSpace: "pre-wrap" }}
      >
        <Text size="sm">{content}{streaming && <Text span c="dimmed">▍</Text>}</Text>
      </Paper>
      {isUser && (
        <Paper radius="xl" p={6} bg="orange.7">
          <IconUser size={18} />
        </Paper>
      )}
    </Group>
  );
}
