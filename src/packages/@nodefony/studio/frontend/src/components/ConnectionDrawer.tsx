import { observer } from "mobx-react-lite";
import {
  Drawer,
  Stack,
  Text,
  Badge,
  Group,
  Divider,
  Alert,
  Code,
  ScrollArea,
} from "@mantine/core";
import {
  IconPlugConnected,
  IconPlugX,
  IconAlertCircle,
} from "@tabler/icons-react";
import { useConnection } from "../stores";

interface Props {
  opened: boolean;
  onClose: () => void;
}

/**
 * ConnectionDrawer — hub temps réel ouvert depuis le chip topbar.
 *
 * Affiche :
 *  - état du WebSocket (state + latencyMs + dernière erreur)
 *  - liste des subscriptions actives sur la page courante avec stats live
 *
 * Pattern attendu : chaque page subscribe via `conn.subscribe(channel, fn)`
 * et dispose au unmount → l'utilisateur voit en direct ce qui pompe la WS.
 */
export const ConnectionDrawer = observer(({ opened, onClose }: Props) => {
  const conn = useConnection();
  const subs = Array.from(conn.activeSubscriptions.values()).sort((a, b) =>
    a.channel.localeCompare(b.channel),
  );
  const now = Date.now();

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Text fw={600}>Realtime</Text>
          <Badge size="xs" variant="light" color="brand">
            P14.11
          </Badge>
        </Group>
      }
      position="right"
      size="md"
    >
      <Stack gap="md">
        <Group gap="xs">
          <Badge
            size="lg"
            leftSection={
              conn.isConnected ? (
                <IconPlugConnected size={14} />
              ) : (
                <IconPlugX size={14} />
              )
            }
            color={
              conn.isConnected
                ? "teal"
                : conn.state === "connecting" || conn.state === "reconnecting"
                  ? "yellow"
                  : conn.state === "error"
                    ? "red"
                    : "gray"
            }
            variant="filled"
          >
            {conn.state}
          </Badge>
          {conn.latencyMs != null && (
            <Text size="sm" c="dimmed">
              {conn.latencyMs} ms
            </Text>
          )}
        </Group>

        {conn.lastError && (
          <Alert
            color="orange"
            icon={<IconAlertCircle size={16} />}
            title="Dernière erreur"
            variant="light"
          >
            <Text size="xs">{conn.lastError}</Text>
          </Alert>
        )}

        <Divider
          label={`Subscriptions actives (${subs.length})`}
          labelPosition="left"
        />

        <ScrollArea h={300} type="auto">
          {subs.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">
              Aucune subscription sur la page courante.
              <br />
              <Text size="xs" c="dimmed" component="span">
                Utiliser <Code>conn.subscribe(channel, fn)</Code> dans un{" "}
                <Code>useEffect</Code> pour s&apos;abonner.
              </Text>
            </Text>
          ) : (
            <Stack gap={6}>
              {subs.map((s) => {
                const ageMs = s.lastMessage ? now - s.lastMessage : null;
                return (
                  <Group
                    key={s.channel}
                    justify="space-between"
                    gap="xs"
                    wrap="nowrap"
                  >
                    <Code style={{ flex: 1, minWidth: 0 }}>{s.channel}</Code>
                    <Group gap={4} wrap="nowrap">
                      <Badge size="xs" variant="dot">
                        {s.msgCount} msg
                      </Badge>
                      {ageMs != null && (
                        <Text size="xs" c="dimmed">
                          {ageMs < 1000
                            ? `${ageMs}ms`
                            : `${Math.round(ageMs / 1000)}s`}
                        </Text>
                      )}
                    </Group>
                  </Group>
                );
              })}
            </Stack>
          )}
        </ScrollArea>

        <Divider />
        <Text size="xs" c="dimmed">
          Vision P14.11 — le Core Nodefony est isomorphe. Le{" "}
          <Code>RealtimeClient</Code> est importé depuis{" "}
          <Code>nodefony</Code> via <Code>exports.browser</Code>. Backend WS
          opérationnel en P13.4.
        </Text>
      </Stack>
    </Drawer>
  );
});
