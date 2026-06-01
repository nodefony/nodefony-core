/**
 * **PduDetailDrawer** — tiroir de détail d'UN enregistrement de log, partagé par
 * les onglets Live et Explorer (clic sur une ligne). Affiche tous les champs du
 * Pdu, le payload complet (objet → `JsonViewer`, texte → `Code` avec ANSI rendu),
 * et — si le log porte un `requestId` — la **chronologie complète de la requête /
 * connexion** (tous les logs corrélés, dans l'ordre). Pour une connexion
 * **WebSocket**, cette chronologie montre chaque message reçu (`onMessage`,
 * subscribe…) au fil de la vie de la socket.
 *
 * Rendu 100 % TEXTE (aucun HTML injecté).
 */
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Code,
  CopyButton,
  Drawer,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  Button,
} from "@mantine/core";
import {
  IconCheck,
  IconCopy,
  IconInfoCircle,
  IconRefresh,
  IconRoute2,
} from "@tabler/icons-react";
import { DefinitionList, KeyValue, JsonViewer } from "../../components/ui";
import { useStore } from "../../stores";
import { ansiToReact } from "../../utils/ansiToReact";
import type { LogRecord, LogQueryResult } from "./logsTypes";
import { fmtClock, fmtDateTime, fmtMillis, recordMessage } from "./logFormat";
import { SeverityBadge } from "./LogVisuals";
import { describeFlow } from "./eventFlow";

export interface PduDetailDrawerProps {
  /** Enregistrement à détailler ; `null` = tiroir fermé. */
  record: LogRecord | null;
  onClose: () => void;
  /**
   * Demande de trace full-stack d'une requête (clic « Ouvrir dans l'Explorer »).
   * L'orchestrateur bascule alors sur l'Explorer filtré par ce `requestId`.
   */
  onTrace?: (requestId: string) => void;
  /**
   * Source **LOCALE** de la chronologie (cas Rejeu fichier) : si fournie, le
   * drawer dérive la timeline en filtrant ce tableau par `requestId` — au lieu
   * d'interroger le backplane mémoire (qui ne contient pas les vieux logs d'un
   * fichier rejoué). Live/Explorer ne la passent pas → fallback backplane.
   */
  localRecords?: LogRecord[];
}

/** Une ligne compacte de la mini-chronologie du drawer. */
function TimelineRow({
  row,
  current,
}: {
  row: LogRecord;
  current: boolean;
}) {
  const flow = describeFlow(row);
  return (
    <Group
      gap={6}
      wrap="nowrap"
      align="flex-start"
      style={{
        padding: "1px 4px",
        borderRadius: 4,
        background: current ? "var(--mantine-color-brand-light)" : undefined,
      }}
    >
      <Text
        size="xs"
        c="dimmed"
        ff="monospace"
        style={{ flexShrink: 0, opacity: 0.6, minWidth: 46 }}
      >
        #{row.uid}
      </Text>
      <Text
        size="xs"
        c="dimmed"
        style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
      >
        {fmtClock(row.timeStamp)}.{fmtMillis(row.timeStamp)}
      </Text>
      <SeverityBadge severity={row.severityName} size="xs" />
      {flow && (
        <Badge size="xs" variant="light" color={flow.color} style={{ flexShrink: 0 }}>
          {flow.label}
        </Badge>
      )}
      <Text size="xs" style={{ wordBreak: "break-word" }}>
        {ansiToReact(recordMessage(row))}
      </Text>
    </Group>
  );
}

export const PduDetailDrawer = observer(
  ({ record, onClose, onTrace, localRecords }: PduDetailDrawerProps) => {
    const store = useStore();
    const open = record !== null;
    const message = record ? recordMessage(record) : "";
    // Payload objet (≠ string) → dump JSON ; payload string → texte ANSI rendu.
    const payloadIsObject =
      record !== null &&
      record.payload !== null &&
      typeof record.payload === "object";

    const requestId = record?.requestId ?? null;

    // ── Chronologie de la requête / connexion (logs corrélés par requestId) ──
    const [timeline, setTimeline] = useState<LogRecord[]>([]);
    const [tlLoading, setTlLoading] = useState(false);

    const loadTimeline = useCallback(() => {
      if (!requestId) {
        setTimeline([]);
        return;
      }
      // Cas Rejeu : la chronologie vient du FICHIER (source locale), pas du ring.
      if (localRecords) {
        setTimeline(localRecords.filter((r) => r.requestId === requestId));
        return;
      }
      // Cas Live/Explorer : on interroge le backplane mémoire.
      setTlLoading(true);
      store.api
        .getAbsolute<LogQueryResult>(
          `/nodefony/syslog/api/logs/search?requestId=${encodeURIComponent(
            requestId,
          )}&order=asc&limit=300`,
        )
        .then((res) => setTimeline(res.rows ?? []))
        .catch(() => setTimeline([]))
        .finally(() => setTlLoading(false));
    }, [requestId, store, localRecords]);

    useEffect(() => loadTimeline(), [loadTimeline]);

    // Connexion WS ? (au moins un log de contexte WebSocket dans la trace).
    const isWebsocket = timeline.some(
      (r) => /WEBSOCKET/i.test(r.msgid) || /WEBSOCKET/i.test(r.moduleName),
    );
    // Nb de messages reçus (phase 2 d'une socket WS).
    const messageCount = timeline.filter((r) =>
      /onMessage/i.test(recordMessage(r)),
    ).length;

    return (
      <Drawer
        opened={open}
        onClose={onClose}
        position="right"
        size="lg"
        // Inspecteur NON-MODAL (façon DevTools) : pas d'overlay grisé, le reste de
        // la page reste lisible ET cliquable → cliquer une autre ligne met à jour
        // le détail sans fermer le tiroir. Fermeture explicite (✕ / Échap).
        withOverlay={false}
        closeOnClickOutside={false}
        trapFocus={false}
        lockScroll={false}
        shadow="xl"
        title={
          record ? (
            <Group gap="xs" wrap="nowrap">
              <SeverityBadge severity={record.severityName} fullWidth={false} />
              <Text fw={700} truncate>
                {record.moduleName}
                {record.msgid ? ` · ${record.msgid}` : ""}
              </Text>
            </Group>
          ) : (
            "Détail du log"
          )
        }
      >
        {record && (
          <Stack gap="md">
            {/* Champs structurés du Pdu (RFC 5424). */}
            <DefinitionList>
              <KeyValue k="Horodatage" v={fmtDateTime(record.timeStamp)} mono />
              <KeyValue k="Séquence (#)" v={`#${record.uid}`} mono />
              <KeyValue
                k="Sévérité"
                v={
                  <Group gap={6} wrap="nowrap">
                    <SeverityBadge
                      severity={record.severityName}
                      fullWidth={false}
                    />
                    <Text size="sm" c="dimmed">
                      (niveau {record.severity})
                    </Text>
                  </Group>
                }
              />
              <KeyValue k="Module" v={record.moduleName} mono />
              <KeyValue k="msgid" v={record.msgid || "—"} mono />
              <KeyValue k="PID (worker)" v={String(record.pid)} mono />
              <KeyValue
                k="requestId"
                v={
                  record.requestId ? (
                    <Code>{record.requestId}</Code>
                  ) : (
                    <Text size="sm" c="dimmed">
                      aucun (log hors cycle requête)
                    </Text>
                  )
                }
              />
            </DefinitionList>

            {/* Message / payload du log courant. */}
            <Stack gap={6}>
              <Group justify="space-between">
                <Text size="sm" fw={600}>
                  Payload
                </Text>
                <CopyButton value={message} timeout={1200}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? "Copié" : "Copier le message"}>
                      <ActionIcon
                        variant="subtle"
                        color={copied ? "teal" : "gray"}
                        onClick={copy}
                        aria-label="copier le message"
                      >
                        {copied ? (
                          <IconCheck size={16} />
                        ) : (
                          <IconCopy size={16} />
                        )}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              </Group>
              {payloadIsObject ? (
                <JsonViewer value={record.payload} maxHeight={300} />
              ) : (
                <ScrollArea.Autosize mah={300}>
                  <Code
                    block
                    style={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontSize: 12,
                    }}
                  >
                    {ansiToReact(message)}
                  </Code>
                </ScrollArea.Autosize>
              )}
            </Stack>

            {/* Chronologie de la requête / connexion (logs corrélés). */}
            {requestId && (
              <Stack gap={6}>
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" fw={600}>
                      {isWebsocket
                        ? "Chronologie de la connexion"
                        : "Chronologie de la requête"}
                    </Text>
                    <Badge size="sm" variant="light" color="brand">
                      {timeline.length} évén.
                    </Badge>
                    {isWebsocket && messageCount > 0 && (
                      <Badge size="sm" variant="light" color="cyan">
                        {messageCount} message{messageCount > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </Group>
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label="Rafraîchir la chronologie">
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        onClick={loadTimeline}
                        loading={tlLoading}
                        aria-label="rafraîchir la chronologie"
                      >
                        <IconRefresh size={15} />
                      </ActionIcon>
                    </Tooltip>
                    <Button
                      component={Link}
                      to={`/nodefony/logs/trace/${encodeURIComponent(requestId)}`}
                      size="compact-xs"
                      variant="light"
                      color="brand"
                      leftSection={<IconRoute2 size={14} />}
                    >
                      Suivi (pleine page)
                    </Button>
                    {onTrace && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="gray"
                        onClick={() => onTrace(requestId)}
                      >
                        Explorer
                      </Button>
                    )}
                  </Group>
                </Group>

                {isWebsocket && (
                  <Alert
                    color="cyan"
                    variant="light"
                    icon={<IconInfoCircle size={15} />}
                    p="xs"
                  >
                    <Text size="xs">
                      Connexion <b>WebSocket</b> : la ligne « Handshake terminé »
                      marque la fin de l'ouverture, puis chaque « Message reçu »
                      arrive au fil de l'eau sous le même requestId. Le{" "}
                      <b>contenu</b> des frames échangées (JSON-RPC) se consulte
                      dans la console <b>Realtime Hub</b> (log protocole) — les
                      logs serveur ne tracent que l'arrivée d'un message.
                    </Text>
                  </Alert>
                )}

                <Box
                  style={{
                    border: "1px solid var(--mantine-color-default-border)",
                    borderRadius: 6,
                  }}
                >
                  {tlLoading && timeline.length === 0 ? (
                    <Group justify="center" py="md">
                      <Loader size="sm" />
                    </Group>
                  ) : timeline.length === 0 ? (
                    <Text size="xs" c="dimmed" ta="center" py="md">
                      Logs de cette requête expirés du buffer mémoire.
                    </Text>
                  ) : (
                    <ScrollArea.Autosize
                      mah={360}
                      styles={{
                        viewport: {
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, monospace",
                        },
                      }}
                    >
                      <Stack gap={0} p={6}>
                        {timeline.map((row) => (
                          <TimelineRow
                            key={`${row.uid}-${row.timeStamp}`}
                            row={row}
                            current={row.uid === record.uid}
                          />
                        ))}
                      </Stack>
                    </ScrollArea.Autosize>
                  )}
                </Box>
              </Stack>
            )}
          </Stack>
        )}
      </Drawer>
    );
  },
);
