/**
 * **Panneau WebSocket du Suivi de requête** — reconstitue le cycle d'une connexion
 * WS à partir de ses logs corrélés (`requestId`) : **handshake → messages → close**.
 * Chaque message (RECEIVE / SEND / BROADCAST) est rendu via la vue JSON
 * réutilisable si son payload est du JSON, sinon en texte.
 *
 * Les messages au fil de l'eau ne sont loggés qu'en **dev** (seam `@nodefony/http`,
 * sévérité DEBUG, gaté `environment !== "production"`) → en prod ce panneau montre
 * le handshake et la fermeture, et explique l'absence de messages.
 */
import {
  Alert,
  Badge,
  Box,
  Code,
  Collapse,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconBroadcast,
  IconChevronRight,
  IconInfoCircle,
  IconPlugConnected,
  IconPlugConnectedX,
} from "@tabler/icons-react";
import { type FC, useState } from "react";
import { JsonView, jsonPreview, truncate, tryParseJson } from "../../components/ui";
import type { LogRecord } from "./logsTypes";
import { fmtClock, fmtMillis, recordMessage } from "./logFormat";

/** Sens d'un message WS (du point de vue serveur). */
type WsDir = "RECEIVE" | "SEND" | "BROADCAST";

/** Présentation d'une direction : libellé FR, couleur, icône. */
const DIR_META: Record<
  WsDir,
  { label: string; color: string; icon: FC<{ size?: number }> }
> = {
  RECEIVE: { label: "Reçu", color: "blue", icon: IconArrowDown },
  SEND: { label: "Envoyé", color: "teal", icon: IconArrowUp },
  BROADCAST: { label: "Diffusé", color: "grape", icon: IconBroadcast },
};

/** Retire les codes ANSI d'un payload (les logs TTY peuvent en porter). */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Direction d'un log de message WS, ou `null` si ce n'en est pas un. */
function wsDirection(rec: LogRecord): WsDir | null {
  const id = rec.msgid;
  if (!id.includes("WS ")) return null;
  if (id.includes("RECEIVE")) return "RECEIVE";
  if (id.includes("SEND")) return "SEND";
  if (id.includes("BROADCAST")) return "BROADCAST";
  return null;
}

/** `true` si le log est le bilan de handshake (`req`). */
const isHandshake = (r: LogRecord): boolean => r.msgid === "req";
/** `true` si le log est la fermeture de socket. */
const isClose = (r: LogRecord): boolean => /\bCLOSE\b/.test(r.msgid);

/**
 * Une ligne de message WS — **repliée par défaut** : header (direction + heure +
 * aperçu une ligne) toujours visible, contenu (JSON déplié ou texte) en `Collapse`
 * ouvert au clic. Évite un mur de payloads sur une connexion bavarde.
 */
function WsMessageRow({ rec, baseTs }: { rec: LogRecord; baseTs: number }) {
  const dir = wsDirection(rec)!;
  const meta = DIR_META[dir];
  const Icon = meta.icon;
  const text = stripAnsi(recordMessage(rec));
  const parsed = tryParseJson(text);
  const [open, setOpen] = useState(false);
  const preview = parsed.ok ? jsonPreview(parsed.value, 80) : truncate(text, 80);
  return (
    <Box
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: 6,
      }}
    >
      <Group
        gap={8}
        wrap="nowrap"
        style={{ padding: "6px 8px", cursor: "pointer" }}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${meta.label} — ${open ? "replier" : "déplier"} le message`}
      >
        <IconChevronRight
          size={13}
          style={{
            flexShrink: 0,
            transition: "transform 120ms ease",
            transform: open ? "rotate(90deg)" : "none",
            color: "var(--mantine-color-dimmed)",
          }}
        />
        <Badge
          size="sm"
          variant="light"
          color={meta.color}
          leftSection={<Icon size={12} />}
          style={{ flexShrink: 0 }}
        >
          {meta.label}
        </Badge>
        <Text
          size="xs"
          c="dimmed"
          style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
        >
          {fmtClock(rec.timeStamp)}.{fmtMillis(rec.timeStamp)} · +
          {rec.timeStamp - baseTs}ms
        </Text>
        <Code
          style={{
            flex: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            background: "transparent",
          }}
        >
          {preview}
        </Code>
      </Group>
      <Collapse expanded={open}>
        <Box style={{ padding: "0 8px 8px" }}>
          {parsed.ok ? (
            <JsonView value={parsed.value} defaultExpandedDepth={1} maxHeight={240} />
          ) : (
            <Text
              size="xs"
              ff="monospace"
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {text}
            </Text>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

/** Un jalon de connexion (handshake / close) — ligne sobre. */
function WsMilestone({
  rec,
  baseTs,
  kind,
}: {
  rec: LogRecord;
  baseTs: number;
  kind: "open" | "close";
}) {
  const open = kind === "open";
  return (
    <Group gap={8} wrap="nowrap" style={{ padding: "2px 4px" }}>
      <Badge
        size="sm"
        variant="light"
        color={open ? "teal" : "gray"}
        leftSection={
          open ? (
            <IconPlugConnected size={12} />
          ) : (
            <IconPlugConnectedX size={12} />
          )
        }
        style={{ flexShrink: 0 }}
      >
        {open ? "Ouverture" : "Fermeture"}
      </Badge>
      <Text
        size="xs"
        c="dimmed"
        style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
      >
        {fmtClock(rec.timeStamp)}.{fmtMillis(rec.timeStamp)} · +
        {rec.timeStamp - baseTs}ms
      </Text>
      <Text size="xs" style={{ wordBreak: "break-word" }}>
        {stripAnsi(recordMessage(rec))}
      </Text>
    </Group>
  );
}

/** Panneau WebSocket complet (handshake → messages → close). */
export function WsTracePanel({
  logs,
  baseTs,
}: {
  logs: LogRecord[];
  baseTs: number;
}) {
  const messages = logs.filter((l) => wsDirection(l) !== null);
  const handshake = logs.find(isHandshake);
  const close = logs.find(isClose);
  const counts = { RECEIVE: 0, SEND: 0, BROADCAST: 0 };
  for (const m of messages) counts[wsDirection(m)!] += 1;

  return (
    <Stack gap="sm">
      <Group gap="xs">
        {(Object.keys(DIR_META) as WsDir[]).map((d) => (
          <Badge key={d} variant="light" color={DIR_META[d].color} size="sm">
            {DIR_META[d].label} : {counts[d]}
          </Badge>
        ))}
      </Group>

      {handshake ? (
        <WsMilestone rec={handshake} baseTs={baseTs} kind="open" />
      ) : null}

      {messages.length > 0 ? (
        <Stack gap={6}>
          {messages.map((m) => (
            <WsMessageRow key={`${m.uid}-${m.timeStamp}`} rec={m} baseTs={baseTs} />
          ))}
        </Stack>
      ) : (
        <Alert color="grape" variant="light" icon={<IconInfoCircle size={16} />}>
          <Text size="xs">
            Aucun message WebSocket loggé pour cette connexion. Les messages au fil
            de l'eau ne sont tracés qu'en <b>développement</b> (sévérité DEBUG) ;
            en production seuls le handshake et la fermeture apparaissent.
          </Text>
        </Alert>
      )}

      {close ? <WsMilestone rec={close} baseTs={baseTs} kind="close" /> : null}
    </Stack>
  );
}
