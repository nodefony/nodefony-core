/**
 * **SyslogStatusBar** — la barre d'état de la page des journaux, visible sur
 * tous les onglets. Elle dit en une phrase ce qu'on lit (« Vous lisez Grafana
 * Loki — alimenté par un collecteur externe · dernière ligne il y a 6 h »), puis
 * l'état du Direct, l'environnement et les compteurs d'erreurs.
 *
 * Aucune logique de layout ici : `StatusBar` gère le sticky et la mise en forme.
 * Les mots viennent des règles pures `describeSource` / `describeFreshness`.
 */
import { useEffect, useState } from "react";
import { Badge, Box, Group, Text } from "@mantine/core";
import { IconBroadcast, IconStack2 } from "@tabler/icons-react";
import {
  DocHint,
  FlashValue,
  StatusBar,
  ensureLiveStyles,
  type StatusSegment,
  type StatusTone,
} from "../../components/ui";
import type { BackplaneMeta } from "./logsTypes";
import {
  LOGS_DOC,
  STALE_AFTER_MS,
  describeFreshness,
  realtimeStateLabel,
  type ISourceDescription,
} from "./logFormat";

export interface SyslogStatusBarProps {
  meta: BackplaneMeta | null;
  /** Source de lecture décrite pour l'exploitant. */
  source: ISourceDescription;
  /** Horodatage de la ligne la plus récente de la source (`undefined` = pas encore lu, `null` = aucune). */
  latest: number | null | undefined;
  /** État de la connexion temps réel (`useNodefonyState()`). */
  realtimeState: string;
}

/**
 * Âge de la dernière ligne, recalculé toutes les 5 s dans CE composant seul :
 * la page ne se redessine pas pour faire avancer une horloge.
 */
function FreshnessText({
  source,
  latest,
}: {
  source: ISourceDescription;
  latest: number | null | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  const f = describeFreshness(source, latest, now);
  if (!f.text) return null;
  return (
    <Text
      span
      size="sm"
      c={f.stale ? "orange" : "dimmed"}
      fw={f.stale ? 700 : 400}
    >
      {" · "}
      {f.text}
      {f.stale && " — la source ne reçoit plus rien"}
    </Text>
  );
}

/** Compteur compact (santé) qui flashe brièvement au changement. */
function MiniCount({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  if (value <= 0) return null;
  return (
    <Badge variant="light" color={color} tt="none">
      <Group gap={4} wrap="nowrap">
        <Text span fz={11}>
          {label}
        </Text>
        <Text
          span
          fz={11}
          fw={700}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <FlashValue value={value}>{value.toLocaleString("fr-FR")}</FlashValue>
        </Text>
      </Group>
    </Badge>
  );
}

export function SyslogStatusBar({
  meta,
  source,
  latest,
  realtimeState,
}: SyslogStatusBarProps) {
  useEffect(ensureLiveStyles, []);

  if (!meta) {
    // Pré-chargement : barre neutre (le bandeau ne doit jamais « sauter »).
    return (
      <StatusBar
        ariaLabel="Source des journaux"
        segments={[
          {
            id: "loading",
            label: "Vous lisez",
            value: (
              <Text size="sm" c="dimmed">
                Lecture de la source…
              </Text>
            ),
          },
        ]}
      />
    );
  }

  const freshness = describeFreshness(source, latest, Date.now());
  const rt = realtimeStateLabel(realtimeState);
  const liveTone: StatusTone = rt.live
    ? "ok"
    : realtimeState === "error"
      ? "danger"
      : realtimeState === "connecting" || realtimeState === "reconnecting"
        ? "warn"
        : "neutral";

  const segments: StatusSegment[] = [
    {
      id: "source",
      label: "Vous lisez",
      icon: <IconStack2 size={18} />,
      tone: freshness.stale ? "warn" : "active",
      value: (
        <Text size="sm">
          <Text span size="sm" fw={700}>
            {source.label}
          </Text>
          {source.feederText && <> — {source.feederText}</>}
          <FreshnessText source={source} latest={latest} />
        </Text>
      ),
      info: (
        <DocHint
          title="D'où viennent les journaux"
          version={LOGS_DOC}
          summary={`Les onglets Journaux et Source lisent ${source.label}.`}
          sections={[
            {
              label: "Qui les envoie",
              body:
                source.feeder === "collector"
                  ? "Un collecteur externe (Alloy, Promtail, Fluent Bit…) lit la sortie de l'application et l'envoie à cette source. L'application ne fait que relire."
                  : source.feeder === "app"
                    ? "L'application envoie elle-même ses journaux à cette source."
                    : "Ce processus garde lui-même ses dernières lignes, en mémoire ou dans un fichier local.",
            },
            {
              label: "« Ne reçoit plus rien »",
              body: `Une source distante sans ligne neuve depuis ${STALE_AFTER_MS / 60_000} minutes est signalée : elle répond peut-être encore, mais plus personne ne l'alimente. Vérifier le collecteur, ou l'envoi de l'application.`,
            },
          ]}
        />
      ),
    },
    {
      id: "live",
      label: "Direct",
      icon: <IconBroadcast size={18} />,
      tone: liveTone,
      value: (
        <Group gap={6} wrap="nowrap">
          <Box
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: `var(--mantine-color-${rt.color}-6)`,
              flexShrink: 0,
            }}
          />
          <Text size="sm" fw={600}>
            {rt.label}
          </Text>
        </Group>
      ),
      info: (
        <DocHint
          title="Direct — les lignes au fil de l'eau"
          version={LOGS_DOC}
          summary="L'onglet Direct reçoit chaque ligne de CE processus au moment où elle est écrite, sans passer par la source de lecture."
          sections={[
            {
              label: "Ce processus seulement",
              body: "Le Direct montre ce que produit le processus qui sert cette console. Avec plusieurs exemplaires de l'application, les autres se lisent dans l'onglet Journaux, depuis la source partagée.",
            },
            {
              label: "L'état",
              body: "« connecté » = le flux arrive ; « reconnexion » = le navigateur rétablit la WebSocket (le flux reprendra tout seul).",
            },
          ]}
        />
      ),
    },
  ];

  const env = meta.environment;
  const trailing = (
    <>
      {env && (
        <Badge
          variant="light"
          color={env === "development" ? "brand" : "gray"}
          tt="none"
        >
          {env}
        </Badge>
      )}
      <MiniCount
        label="erreurs"
        value={meta.counters.errorTotal}
        color="orange"
      />
      <MiniCount
        label="critiques"
        value={meta.counters.criticTotal}
        color="red"
      />
    </>
  );

  return (
    <StatusBar
      ariaLabel="Source des journaux"
      segments={segments}
      trailing={trailing}
    />
  );
}
