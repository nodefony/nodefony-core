import { Badge, Box, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import {
  IconBroadcast,
  IconFileText,
  IconPencil,
  IconSearch,
} from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import type { BackplaneMeta } from "../../routes/logs/logsTypes";

/* ════════════════════════════════════════════════════════════════════════
 * Bloc « Log Backplane » — le CONTENU lecture/écriture des tuiles de la page
 * Logs, migré en BLOC réutilisable (page / widget de bureau / dialog).
 *
 * Observation pure (pas les contrôles dev de la page : switch driver, toggles).
 * Source = snapshot `/nodefony/syslog/api/backplane`. Type miroir importé en
 * TYPE-ONLY (0 couplage runtime à la page Logs).
 *   - Lecture (fond de panier) : la destination RELUE + ses capacités.
 *   - Écriture (fan-out)        : les destinations actives (1 log → N sorties).
 * ════════════════════════════════════════════════════════════════════════ */

/** Destinations d'écriture actives (ring mémoire + sink texte + transports montés). */
function activeWrites(meta: BackplaneMeta): string[] {
  const out: string[] = [];
  if (meta.write.ringEnabled !== false) out.push("mémoire (ring)");
  if (meta.write.sinkEnabled !== false) out.push(meta.write.sink);
  for (const t of meta.write.transports ?? []) if (t.enabled) out.push(t.name);
  return out;
}

function BackplaneBody({ source }: WidgetRenderProps<BackplaneMeta>) {
  const meta = source.data;
  if (!meta) return null;
  const active = meta.activeDriver;
  const caps = active?.capabilities;
  const writes = activeWrites(meta);
  const streamEnabled = meta.write.streamEnabled !== false;
  return (
    <Stack gap="sm">
      {/* Lecture — la source consultée (un seul « fond de panier »). */}
      <Box>
        <Group gap={6} mb={4} wrap="nowrap">
          <ThemeIcon variant="light" color="brand" size="sm" radius="md">
            <IconSearch size={14} />
          </ThemeIcon>
          <Text size="xs" tt="uppercase" fw={700} c="dimmed">
            Lecture · source consultée
          </Text>
        </Group>
        <Group gap={6} wrap="wrap">
          <Badge variant="light" color="brand" tt="none">
            {active?.name ?? "—"}
          </Badge>
          {caps?.query ? (
            <Badge size="xs" variant="default" tt="none">
              query
            </Badge>
          ) : null}
          {caps?.stream ? (
            <Badge size="xs" variant="default" tt="none">
              stream
            </Badge>
          ) : null}
          {caps?.write ? (
            <Badge size="xs" variant="default" tt="none">
              persiste
            </Badge>
          ) : null}
        </Group>
      </Box>

      {/* Écriture — fan-out : 1 log copié vers N destinations en même temps. */}
      <Box>
        <Group gap={6} mb={4} wrap="nowrap">
          <ThemeIcon variant="light" color="gray" size="sm" radius="md">
            <IconPencil size={14} />
          </ThemeIcon>
          <Text size="xs" tt="uppercase" fw={700} c="dimmed">
            Écriture · fan-out ({writes.length})
          </Text>
        </Group>
        <Group gap={6} wrap="wrap">
          {writes.length ? (
            writes.map((w) => (
              <Badge key={w} size="sm" variant="light" color="teal" tt="none">
                {w}
              </Badge>
            ))
          ) : (
            <Text size="sm" c="dimmed">
              —
            </Text>
          )}
        </Group>
      </Box>

      {/* Temps réel — diffusion live sur le bus nodefony:syslog (indépendant). */}
      <Box>
        <Group gap={6} mb={4} wrap="nowrap">
          <ThemeIcon variant="light" color="teal" size="sm" radius="md">
            <IconBroadcast size={14} />
          </ThemeIcon>
          <Text size="xs" tt="uppercase" fw={700} c="dimmed">
            Temps réel · diffusion live
          </Text>
        </Group>
        <Badge
          variant={streamEnabled ? "light" : "outline"}
          color={streamEnabled ? "teal" : "gray"}
          tt="none"
        >
          {streamEnabled ? "nodefony:syslog actif" : "diffusion coupée"}
        </Badge>
      </Box>

      {meta.cluster?.isCluster ? (
        <Text size="xs" c="dimmed">
          Cluster · worker {meta.cluster.pid} — vue partielle sauf driver
          agrégateur.
        </Text>
      ) : null}
    </Stack>
  );
}

registerWidget<BackplaneMeta>({
  id: "logs.backplane",
  tags: ["logs", "panneau"],
  title: "Log Backplane",
  description: "Lecture (source consultée) + écriture (fan-out) des logs.",
  category: "logs",
  icon: IconFileText,
  source: { kind: "snapshot", endpoint: "/nodefony/syslog/api/backplane" },
  defaultSpan: 6,
  minSpan: 4,
  render: BackplaneBody,
});
