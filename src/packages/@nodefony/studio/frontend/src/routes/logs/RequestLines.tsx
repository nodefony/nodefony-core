/**
 * **RequestLines** — le détail déplié sous une ligne de requête dans l'onglet
 * Journaux : toutes les lignes du même `requestId`, dans l'ordre où elles ont
 * été écrites, tous niveaux confondus.
 *
 * Chargé seulement quand la ligne est dépliée (`DataGrid.renderRowDetail`), par
 * la même lecture que le Suivi de requête (`scope=trace` : la source qui garde
 * le plus longtemps).
 */
import { useCallback } from "react";
import { Badge, Box, Button, Code, Group, Table, Text } from "@mantine/core";
import { IconRoute2 } from "@tabler/icons-react";
import { Link } from "react-router";
import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import { DataState } from "../../components/ui";
import { ansiToReact } from "../../utils/ansiToReact";
import type { LogQueryResult, LogRecord } from "./logsTypes";
import { fmtClock, fmtMillis, recordMessage } from "./logFormat";
import { describeFlow } from "./eventFlow";
import { SeverityBadge } from "./LogVisuals";

export interface RequestLinesProps {
  requestId: string;
  /** Clic sur une ligne → détail (drawer). */
  onSelect: (rec: LogRecord) => void;
}

export function RequestLines({ requestId, onSelect }: RequestLinesProps) {
  const store = useStore();
  const fetcher = useCallback(
    () =>
      store.api.getAbsolute<LogQueryResult>(
        `/nodefony/syslog/api/logs/search?requestId=${encodeURIComponent(requestId)}&order=timeStamp:ASC&limit=300&scope=trace`,
      ),
    [store, requestId],
  );
  const { data, loading, error, reload } = useResource(fetcher);
  const rows = data?.rows ?? [];

  return (
    <Box
      p="xs"
      pl={40}
      bg="var(--mantine-color-default-hover)"
      style={{ borderLeft: "3px solid var(--mantine-color-grape-6)" }}
    >
      <Group justify="space-between" mb={4} wrap="nowrap">
        <Text size="xs" c="dimmed">
          {loading
            ? "Lecture des lignes de cette requête…"
            : `${rows.length} ligne${rows.length > 1 ? "s" : ""} pour cette requête, dans l'ordre d'écriture, tous niveaux compris`}
        </Text>
        <Button
          component={Link}
          to={`/nodefony/logs/trace/${encodeURIComponent(requestId)}`}
          size="compact-xs"
          variant="light"
          color="grape"
          leftSection={<IconRoute2 size={14} />}
        >
          Suivi complet
        </Button>
      </Group>
      <DataState
        loading={loading && data === null}
        error={error}
        onRetry={reload}
        empty={!loading && rows.length === 0}
        emptyMessage="Aucune autre ligne gardée pour cette requête."
        minHeight={60}
      >
        <Table withRowBorders={false} verticalSpacing={2} fz="xs">
          <Table.Tbody>
            {rows.map((r) => {
              const flow = describeFlow(r);
              return (
                <Table.Tr
                  key={`${r.uid}-${r.timeStamp}`}
                  onClick={() => onSelect(r)}
                  style={{ cursor: "pointer" }}
                >
                  <Table.Td
                    w={110}
                    c="dimmed"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {fmtClock(r.timeStamp)}.{fmtMillis(r.timeStamp)}
                  </Table.Td>
                  <Table.Td w={110}>
                    <SeverityBadge severity={r.severityName} />
                  </Table.Td>
                  <Table.Td w={140}>
                    {flow ? (
                      <Badge size="xs" variant="light" color={flow.color}>
                        {flow.label}
                      </Badge>
                    ) : r.msgid ? (
                      <Code style={{ fontSize: 11 }}>{r.msgid}</Code>
                    ) : null}
                  </Table.Td>
                  <Table.Td
                    style={{
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 0,
                    }}
                  >
                    {ansiToReact(recordMessage(r))}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </DataState>
    </Box>
  );
}
