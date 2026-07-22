/**
 * **SyslogStatusBar** — le consommateur **spécifique au syslog** de la brique
 * générique `StatusBar`. Construit les 3 axes du Log Backplane (Écriture / Lecture
 * / Live) en segments + une zone droite (environnement + santé), avec des fiches
 * d'aide pédagogiques (analogies physiques) ouvertes au survol.
 *
 * Aucune logique de layout ici : c'est `StatusBar` qui gère le sticky et la mise
 * en forme. On ne fait QUE projeter la méta backplane en segments. Réutilise les
 * helpers purs `writeDestinations` / `realtimeStateLabel` (testables hors React).
 */
import { useEffect } from "react";
import { Badge, Box, Group, Text } from "@mantine/core";
import { IconPencil, IconStack2, IconBroadcast } from "@tabler/icons-react";
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
  driverMeta,
  realtimeStateLabel,
  writeDestinations,
} from "./logFormat";

export interface SyslogStatusBarProps {
  meta: BackplaneMeta | null;
  /** État de la connexion temps réel (`useNodefonyState()`). */
  realtimeState: string;
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

export function SyslogStatusBar({ meta, realtimeState }: SyslogStatusBarProps) {
  useEffect(ensureLiveStyles, []);

  if (!meta) {
    // Pré-chargement : barre neutre (le bandeau ne doit jamais « sauter »).
    return (
      <StatusBar
        ariaLabel="Mode du Log Backplane"
        segments={[
          {
            id: "loading",
            label: "Log Backplane",
            value: (
              <Text size="sm" c="dimmed">
                chargement…
              </Text>
            ),
          },
        ]}
      />
    );
  }

  const active = meta.activeDriver;
  const dests = writeDestinations(meta).filter((d) => d.on);
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
      id: "write",
      label: "Écriture →",
      icon: <IconPencil size={18} />,
      tone: "neutral",
      value: (
        <Group gap={4} wrap="wrap">
          {dests.map((d) => (
            <Badge key={d.id} size="sm" variant="light" color="gray" tt="none">
              {d.label}
            </Badge>
          ))}
        </Group>
      ),
      info: (
        <DocHint
          title="Écriture — le fan-out"
          version={LOGS_DOC}
          summary="Comme un robinet qui remplit plusieurs seaux à la fois : chaque log est copié vers TOUTES ces destinations en même temps."
          sections={[
            {
              label: "Pourquoi plusieurs ?",
              body: "Pour avoir d'un seul geste le direct (mémoire), une trace lisible (texte) ET une archive cherchable (JSONL, Loki, OpenSearch) — sans choisir.",
            },
            {
              label: "Figé par la config",
              body: "En production on n'écrit que vers UNE destination (12-factor, traçabilité) ; en développement on écrit partout pour pouvoir tester chaque mode de lecture.",
            },
          ]}
        />
      ),
    },
    {
      id: "read",
      label: "Lecture ←",
      icon: <IconStack2 size={18} />,
      tone: "active",
      value: (
        <Group gap={6} wrap="nowrap">
          <Text size="sm" fw={600} truncate>
            {active ? driverMeta(active.name).label : "aucune"}
          </Text>
          {active && (
            <Badge size="xs" variant="default" tt="none">
              {active.name}
            </Badge>
          )}
        </Group>
      ),
      info: (
        <DocHint
          title="Lecture — le fond de panier"
          version={LOGS_DOC}
          summary="Le « fond de panier » (backplane) qu'on RELIT et qu'on fouille. On n'en examine qu'UN à la fois : c'est le seau qu'on inspecte, pas le robinet."
          sections={[
            {
              label: "Indépendant de l'écriture",
              body: "On peut écrire partout mais ne relire que la mémoire. Changer la destination de lecture ne change QUE ce que montre l'onglet Explorer.",
            },
            {
              label: "Pourquoi un seul ?",
              body: "Une recherche interroge une source ; mélanger plusieurs sources fausserait l'ordre chronologique et les totaux.",
            },
          ]}
        />
      ),
    },
    {
      id: "live",
      label: "Live",
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
          title="Live — le bus temps réel"
          version={LOGS_DOC}
          summary="Le haut-parleur des logs : le bus « nodefony:syslog » diffuse chaque log au fil de l'eau, indépendamment de la destination de lecture."
          sections={[
            {
              label: "Toujours disponible",
              body: "Même si la destination de lecture ne sait pas faire de temps réel, le Live fonctionne : il écoute les logs à la source, pas via le driver.",
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
      <MiniCount label="err" value={meta.counters.errorTotal} color="orange" />
      <MiniCount label="crit" value={meta.counters.criticTotal} color="red" />
    </>
  );

  return (
    <StatusBar
      ariaLabel="Mode du Log Backplane"
      segments={segments}
      trailing={trailing}
    />
  );
}
