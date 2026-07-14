/**
 * CreateTerminal — le terminal live d'un job de génération, et son abonnement au canal.
 *
 * Ce que l'écran doit rendre honnête : une génération suivie d'un `npm install` dure des
 * dizaines de secondes. Une barre de progression mentirait ; les lignes que le serveur
 * produit, elles, ne mentent pas. On les affiche telles quelles, colorées par leur NATURE
 * (`stream`), au fil de l'eau.
 *
 * Sécurité : une ligne est du **TEXTE** (`<span>{line.text}</span>`) — jamais du HTML
 * injecté. Elle vient de la sortie de `npm` : la traiter comme du balisage serait offrir
 * une injection à tout paquet installé.
 */
import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconPlayerStopFilled,
} from "@tabler/icons-react";
import { useNodefonyChannel } from "nodefony/react";
import { DocHint } from "../../components/ui";
import {
  MAX_TERMINAL_LINES,
  STREAM_COLORS,
  type IScaffoldEvent,
  type IScaffoldJobMeta,
  type IScaffoldLine,
} from "./createModel";

/**
 * Abonnement au flux d'un job — composant **monté seulement quand un job existe**.
 *
 * L'abonnement est ref-compté côté client : le démontage rend le canal, et le serveur
 * arrête d'y publier. C'est le patron « 0 flux quand il n'y a rien à regarder ».
 *
 * Le canal porte les lignes **et** l'état (statut, fichiers écrits, notes) : rien n'est
 * à aller rechercher par requête. Le serveur **rejoue le backlog** à l'abonnement, puis
 * envoie l'état courant — arriver en retard, ou recharger la page en plein
 * `npm install`, ne perd donc ni une ligne ni l'issue du job. Le dédoublonnage se fait
 * sur `seq` côté appelant.
 */
export function JobStream({
  jobId,
  onEvent,
}: {
  jobId: string;
  onEvent: (event: IScaffoldEvent) => void;
}) {
  useNodefonyChannel(`scaffold:job@${jobId}`, (payload) => {
    onEvent(payload as IScaffoldEvent);
  });
  return null;
}

/** Horodatage court d'une ligne (hh:mm:ss) — repère de durée, pas une date. */
function clock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface CreateTerminalProps {
  job: IScaffoldJobMeta;
  lines: IScaffoldLine[];
  /** Interrompt le job (bouton « arrêter ») — actif tant que le job tourne. */
  onCancel: () => void;
  cancelling: boolean;
}

export function CreateTerminal({
  job,
  lines,
  onCancel,
  cancelling,
}: CreateTerminalProps) {
  const viewRef = useRef<HTMLDivElement | null>(null);
  // Suivi automatique du bas — abandonné dès que l'utilisateur remonte lire quelque
  // chose (une console qui reprend le contrôle du scroll pendant qu'on lit est
  // insupportable), repris dès qu'il redescend au bas.
  const [stickToBottom, setStickToBottom] = useState(true);
  const [copied, setCopied] = useState(false);
  const running = job.status === "running";

  useEffect(() => {
    if (!stickToBottom) return;
    const el = viewRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, stickToBottom]);

  const onScroll = (): void => {
    const el = viewRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setStickToBottom(atBottom);
  };

  const copy = (): void => {
    const text = lines.map((l) => l.text).join("\n");
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Text fw={600}>Terminal</Text>
          {running && <Loader size="xs" />}
          <Badge
            color={
              job.status === "done"
                ? "teal"
                : job.status === "failed"
                  ? "red"
                  : "blue"
            }
            variant="light"
          >
            {job.status === "done"
              ? "terminé"
              : job.status === "failed"
                ? "échec"
                : "en cours"}
          </Badge>
          <Code>{job.type}</Code>
          <DocHint
            title="Ce que vous voyez"
            summary="La sortie RÉELLE du serveur, ligne à ligne : ce que le moteur écrit, puis la sortie de npm. Rien n'est résumé ni deviné."
            sections={[
              {
                label: "Couleurs",
                body: "gris = information · normal = sortie standard · orange = sortie d'erreur (npm y écrit aussi ses avertissements) · vert = succès · rouge = échec.",
              },
              {
                label: "Si la page est rechargée",
                body: "Le job continue côté serveur. En revenant sur son lien, le terminal se reconstitue depuis le début (le serveur garde les 4000 dernières lignes ; 500 au plus sont rendues ici).",
              },
            ]}
          />
        </Group>
        <Group gap="xs">
          <Tooltip label={copied ? "Copié" : "Copier tout le terminal"}>
            <ActionIcon
              variant="default"
              aria-label="Copier le contenu du terminal"
              onClick={copy}
            >
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            </ActionIcon>
          </Tooltip>
          {running && (
            <Button
              color="red"
              variant="light"
              size="compact-sm"
              loading={cancelling}
              leftSection={<IconPlayerStopFilled size={14} />}
              aria-label="Arrêter la génération en cours"
              onClick={onCancel}
            >
              Arrêter
            </Button>
          )}
        </Group>
      </Group>

      {/* Zone live : un lecteur d'écran annonce les nouvelles lignes sans voler le focus. */}
      <Box
        ref={viewRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="Sortie de la génération"
        aria-busy={running}
        style={{
          // Un terminal reste un terminal, thème clair ou sombre : le fond sombre est
          // ce qui rend la coloration par nature lisible.
          background: "#0b0d10",
          border: "1px solid var(--mantine-color-dark-4)",
          borderRadius: "var(--mantine-radius-sm)",
          padding: "var(--mantine-spacing-sm)",
          height: 360,
          overflowY: "auto",
          fontFamily: "var(--mantine-font-family-monospace)",
          fontSize: 12,
          lineHeight: 1.5,
          fontVariantNumeric: "tabular-nums",
          // Le terminal se repeint souvent : on confine son travail de rendu.
          contain: "content",
        }}
      >
        {lines.length === 0 ? (
          <span style={{ color: STREAM_COLORS.info }}>
            En attente des premières lignes…
          </span>
        ) : (
          lines.map((line) => (
            <div
              key={line.seq}
              style={{
                color: STREAM_COLORS[line.stream],
                whiteSpace: "pre-wrap",
              }}
            >
              <span style={{ color: "var(--mantine-color-dark-2)" }}>
                {clock(line.ts)}{" "}
              </span>
              {line.text}
            </div>
          ))
        )}
      </Box>

      {lines.length >= MAX_TERMINAL_LINES && (
        <Text size="xs" c="dimmed">
          Fenêtre limitée aux {MAX_TERMINAL_LINES} dernières lignes (les plus
          anciennes restent côté serveur).
        </Text>
      )}

      {!stickToBottom && running && (
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() => setStickToBottom(true)}
        >
          Reprendre le suivi automatique
        </Button>
      )}

      {job.status === "failed" && (
        <Alert
          color="red"
          variant="light"
          icon={<IconAlertTriangle size={16} />}
          title="La génération a échoué"
        >
          <Text size="sm">
            Les fichiers déjà écrits (ci-dessous, s'il y en a) ne sont PAS
            retirés — le moteur ne revient pas en arrière. Lire la dernière
            ligne rouge : elle porte la cause.
          </Text>
        </Alert>
      )}

      {job.files.length > 0 && (
        <Paper withBorder p="sm">
          <Text fw={600} size="sm" mb="xs">
            {job.files.length} fichier(s) écrit(s)
          </Text>
          <Stack gap={2}>
            {job.files.map((f) => (
              <Code key={f} style={{ fontSize: 11 }}>
                {f}
              </Code>
            ))}
          </Stack>
        </Paper>
      )}

      {job.notes.length > 0 && (
        <Alert color="blue" variant="light" title="À savoir">
          <Stack gap={4}>
            {job.notes.map((n) => (
              <Text key={n} size="sm">
                {n}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
