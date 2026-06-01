/**
 * **BackplanePanel** — onglet « Vue d'ensemble » de la page Log Backplane.
 *
 * Ergonomie : **un seul axe à la fois** (jamais trop d'info d'un coup). En haut,
 * 3 **tuiles** sélectionnables résument l'état ; on n'affiche que le **détail de
 * l'axe choisi** — **Lecture par défaut** (le « fond de panier » qu'on relit) :
 *
 *  - **Lecture (fond de panier)** : l'Explorer relit UNE destination à la fois.
 *  - **Écriture (fan-out)** : un même log est copié vers PLUSIEURS destinations.
 *  - **Temps réel** : diffusion live sur `syslog:stream` (onglet Live).
 *
 * La pédagogie (les 3 axes en détail, le pourquoi « un seul panier », la légende
 * des étapes) vit dans l'onglet **Doc** ({@link FlowLegendDoc}). Les compteurs
 * détaillés vivent dans l'onglet **Santé** ({@link SyslogHealthPanel}).
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Code,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconActivity,
  IconAlertTriangle,
  IconBroadcast,
  IconCheck,
  IconCircleDot,
  IconPencil,
  IconPlugConnected,
  IconSearch,
} from "@tabler/icons-react";
import { DataState, DefinitionList, DocHint, KeyValue } from "../../components/ui";
import { useNotifications, useStore } from "../../stores";
import type { BackplaneMeta } from "./logsTypes";
import {
  LOGS_DOC,
  PLACEHOLDER_DRIVERS,
  driverMeta,
  realtimeStateLabel,
  writeDestinations,
  type WriteDestination,
} from "./logFormat";
import {
  CapabilityBadges,
  ClusterScopeNotice,
  DriverIcon,
} from "./LogVisuals";
import { FLOW_LEGEND } from "./eventFlow";

/** Axe affiché dans la Vue d'ensemble (un seul détail à la fois). */
type Axis = "read" | "write" | "stream";

export interface BackplanePanelProps {
  meta: BackplaneMeta | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Notifie l'orchestrateur qu'un switch de driver a eu lieu (rafraîchit les onglets). */
  onSwitched?: () => void;
  /** État de la connexion temps réel (pour l'axe BUS). */
  realtimeState?: string;
}

/** Tuile sélecteur d'axe (master) — résumé cliquable ; la sélectionnée est accentuée. */
function AxisTile({
  active,
  onClick,
  icon,
  color,
  title,
  subtitle,
  value,
  action,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  color: string;
  title: string;
  subtitle: string;
  value: ReactNode;
  /** Contrôle optionnel rendu sous la valeur (les clics n'activent pas la tuile). */
  action?: ReactNode;
}) {
  return (
    <Card
      withBorder
      radius="md"
      p="md"
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        cursor: "pointer",
        borderColor: active ? `var(--mantine-color-${color}-filled)` : undefined,
        borderWidth: active ? 2 : 1,
        background: active ? `var(--mantine-color-${color}-light)` : undefined,
        transition: "border-color 120ms ease, background 120ms ease",
      }}
    >
      <Group gap="sm" wrap="nowrap" mb={6}>
        <ThemeIcon
          variant={active ? "filled" : "light"}
          color={color}
          size="lg"
          radius="md"
        >
          {icon}
        </ThemeIcon>
        <Box style={{ minWidth: 0 }}>
          <Text fw={700}>{title}</Text>
          <Text size="xs" c="dimmed">
            {subtitle}
          </Text>
        </Box>
      </Group>
      <Box style={{ minHeight: 22 }}>{value}</Box>
      {action ? <Box mt={8}>{action}</Box> : null}
    </Card>
  );
}

/**
 * Sélecteur du driver de **lecture** (« Changer la source consultée ») — dev-only.
 * `stopPropagation` : posé dans une tuile cliquable, ses clics/touches ne doivent
 * pas (dé)sélectionner l'axe.
 */
function DriverSwitch({
  value,
  options,
  disabled,
  onSwitch,
  label,
  width = 200,
}: {
  value: string | null;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled: boolean;
  onSwitch: (name: string) => void;
  label?: string;
  width?: number;
}) {
  return (
    <Group
      gap={6}
      wrap="nowrap"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {label ? (
        <Text size="xs" fw={600} c="dimmed" style={{ whiteSpace: "nowrap" }}>
          {label}
        </Text>
      ) : null}
      <Select
        size="xs"
        w={width}
        value={value}
        data={options}
        onChange={(v) => v && onSwitch(v)}
        disabled={disabled}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
        aria-label="changer la source consultée (lecture)"
        leftSection={<IconCircleDot size={14} />}
      />
    </Group>
  );
}

/** Carte d'une destination d'**ÉCRITURE** (fan-out) — actif/inactif + détail. */
function WriteCard({ dest }: { dest: WriteDestination }) {
  const color = dest.on ? "teal" : "gray";
  const icon =
    dest.kind === "transport" ? (
      <DriverIcon name={dest.driverName ?? "generic"} color={color} />
    ) : (
      <ThemeIcon variant="light" color={color} size={34} radius="md">
        {dest.kind === "ring" ? (
          <IconCircleDot size={18} />
        ) : (
          <IconPencil size={18} />
        )}
      </ThemeIcon>
    );
  return (
    <Card
      withBorder
      radius="md"
      p="md"
      style={{
        opacity: dest.on ? 1 : 0.6,
        borderStyle: dest.on ? undefined : "dashed",
        borderColor: dest.on
          ? "var(--mantine-color-teal-filled)"
          : undefined,
        background: dest.on ? "var(--mantine-color-teal-light)" : undefined,
      }}
    >
      <Group justify="space-between" wrap="nowrap" mb="xs">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          {icon}
          <Text fw={700} truncate>
            {dest.label}
          </Text>
        </Group>
        <Badge
          size="xs"
          variant={dest.on ? "light" : "outline"}
          color={color}
          tt="none"
        >
          {dest.on ? "actif" : "inactif"}
        </Badge>
      </Group>
      <Text size="xs" c="dimmed">
        {dest.detail}
      </Text>
    </Card>
  );
}

export function BackplanePanel({
  meta,
  loading,
  error,
  reload,
  onSwitched,
  realtimeState,
}: BackplanePanelProps) {
  const store = useStore();
  const notifications = useNotifications();
  const [switching, setSwitching] = useState(false);
  // Axe affiché — Lecture par défaut (jamais tout d'un coup).
  const [axis, setAxis] = useState<Axis>("read");

  const activeName = meta?.activeDriver?.name ?? null;
  const registered = meta?.drivers ?? [];
  const registeredNames = new Set(registered.map((d) => d.name));
  // Drivers connus non montés ici (placeholder : URL absente, ou prod).
  const placeholders = PLACEHOLDER_DRIVERS.filter((n) => !registeredNames.has(n));
  const isDev = meta?.environment === "development";
  const writes = meta ? writeDestinations(meta) : [];
  const writesOn = writes.filter((w) => w.on).length;
  const rt = realtimeState ? realtimeStateLabel(realtimeState) : null;

  // Modes du select : enregistrés = sélectionnables ; connus non montés = grisés.
  const driverOptions = [
    ...registered.map((d) => ({ value: d.name, label: driverMeta(d.name).label })),
    ...placeholders.map((n) => {
      const dm = driverMeta(n);
      return {
        value: n,
        label: `${dm.label} — ${dm.upcoming ? "à venir" : "via config"}`,
        disabled: true,
      };
    }),
  ];

  // Switch du driver de RELECTURE (dev-only, POST backplane/driver atomique).
  const switchDriver = async (name: string) => {
    if (!name || name === activeName) return;
    setSwitching(true);
    try {
      await store.api.postAbsolute("/nodefony/syslog/api/backplane/driver", {
        name,
      });
      notifications.notify("success", `Lecture → « ${name} »`, {
        title: "Log Backplane",
        source: "api",
      });
      reload();
      onSwitched?.();
    } catch (e) {
      notifications.notify(
        "error",
        e instanceof Error ? e.message : "switch refusé",
        { title: "Log Backplane", source: "api" },
      );
    } finally {
      setSwitching(false);
    }
  };

  return (
    <DataState loading={loading && !meta} error={error} onRetry={reload} minHeight={200}>
      {meta && (
        <Stack gap="lg">
          {/* Honnêteté cluster : la relecture est partielle sauf driver agrégateur. */}
          <ClusterScopeNotice
            cluster={meta.cluster}
            driverName={activeName}
            context="query"
          />

          {/* Orientation minimale + sélecteur d'axe (master). */}
          <Group gap={6}>
            <Text size="sm" c="dimmed">
              On <b>écrit</b> vers plusieurs destinations, on en <b>relit une</b>{" "}
              (le « fond de panier »). Choisis un axe :
            </Text>
            <DocHint
              title="L'approche « fond de panier »"
              version={LOGS_DOC}
              summary="Écriture = diffusion vers plusieurs destinations en même temps. Lecture = une seule destination relue (l'Explorer). Temps réel = diffusion live, indépendante. Détail complet dans l'onglet Doc."
            />
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <AxisTile
              active={axis === "read"}
              onClick={() => setAxis("read")}
              icon={<IconSearch size={20} />}
              color="brand"
              title="Lecture"
              subtitle="la source consultée"
              value={
                <Text size="sm" fw={600} truncate>
                  {activeName ? driverMeta(activeName).label : "—"}
                </Text>
              }
              action={
                isDev ? (
                  <DriverSwitch
                    value={activeName}
                    options={driverOptions}
                    disabled={switching}
                    onSwitch={switchDriver}
                    label="Changer"
                    width={170}
                  />
                ) : undefined
              }
            />
            <AxisTile
              active={axis === "write"}
              onClick={() => setAxis("write")}
              icon={<IconPencil size={20} />}
              color="gray"
              title="Écriture"
              subtitle={`diffusion · ${writesOn} active${writesOn > 1 ? "s" : ""}`}
              value={
                <Group gap={4} wrap="wrap">
                  {writes
                    .filter((w) => w.on)
                    .map((w) => (
                      <Badge
                        key={w.id}
                        size="xs"
                        variant="light"
                        color="teal"
                        tt="none"
                      >
                        {w.kind === "ring"
                          ? "mémoire"
                          : w.kind === "sink"
                            ? meta.write.sink
                            : (w.driverName ?? w.label)}
                      </Badge>
                    ))}
                </Group>
              }
            />
            <AxisTile
              active={axis === "stream"}
              onClick={() => setAxis("stream")}
              icon={<IconBroadcast size={20} />}
              color="teal"
              title="Temps réel"
              subtitle="diffusion live"
              value={
                <Text size="sm" fw={600} truncate>
                  {rt ? rt.label : "syslog:stream"}
                </Text>
              }
            />
          </SimpleGrid>

          {/* DÉTAIL — un seul axe affiché. */}
          {axis === "read" && (
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                L'Explorer fouille <b>une</b> destination à la fois — celle-ci.
                {isDev ? " Basculable à chaud (dev)." : ""}
              </Text>
              <Card withBorder radius="md" p="md">
                <Stack gap="sm">
                  <Group justify="space-between" wrap="wrap" gap="md">
                    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                      <DriverIcon name={activeName ?? "generic"} color="brand" />
                      <Box style={{ minWidth: 0 }}>
                        <Group gap={6} wrap="nowrap">
                          <Text
                            fz={10}
                            fw={700}
                            tt="uppercase"
                            c="brand"
                            style={{ letterSpacing: 0.4, lineHeight: 1.2 }}
                          >
                            Source consultée
                          </Text>
                          <Text fz={10} c="dimmed" style={{ lineHeight: 1.2 }}>
                            · relecture
                          </Text>
                        </Group>
                        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                          <Text fw={700} truncate>
                            {activeName
                              ? driverMeta(activeName).label
                              : "Aucune destination"}
                          </Text>
                          {meta.activeDriver && (
                            <Badge size="xs" variant="default" tt="none">
                              {meta.activeDriver.name}
                            </Badge>
                          )}
                        </Group>
                        {meta.activeDriver && (
                          <Group gap="xs" mt={4} wrap="nowrap">
                            <CapabilityBadges
                              capabilities={meta.activeDriver.capabilities}
                            />
                          </Group>
                        )}
                      </Box>
                    </Group>

                    {isDev && (
                      <DriverSwitch
                        value={activeName}
                        options={driverOptions}
                        disabled={switching}
                        onSwitch={switchDriver}
                        label="Changer la source consultée"
                        width={220}
                      />
                    )}
                  </Group>

                  <DestinationPing driverName={activeName} />
                </Stack>
              </Card>

              {/* Paniers disponibles (registry) — factuel, compact. */}
              <Group gap={6} mt={4}>
                <Text
                  fz={10}
                  fw={700}
                  tt="uppercase"
                  c="dimmed"
                  style={{ letterSpacing: 0.4 }}
                >
                  Paniers disponibles
                </Text>
                <Badge size="xs" variant="light" color="brand">
                  {registered.length}
                </Badge>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
                {registered.map((d) => {
                  const isActive = d.name === activeName;
                  return (
                    <Card
                      key={d.name}
                      withBorder
                      radius="md"
                      p="sm"
                      style={{
                        borderColor: isActive
                          ? "var(--mantine-color-brand-filled)"
                          : undefined,
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap" mb={6}>
                        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                          <DriverIcon
                            name={d.name}
                            color={isActive ? "brand" : "gray"}
                          />
                          <Text fw={600} size="sm" truncate>
                            {driverMeta(d.name).label}
                          </Text>
                        </Group>
                        {isActive && (
                          <Badge size="xs" color="brand" variant="filled">
                            relu
                          </Badge>
                        )}
                      </Group>
                      <CapabilityBadges capabilities={d.capabilities} size="xs" />
                    </Card>
                  );
                })}
                {placeholders.map((name) => {
                  const dm = driverMeta(name);
                  const isFuture = dm.upcoming === true;
                  return (
                    <Card
                      key={name}
                      withBorder
                      radius="md"
                      p="sm"
                      style={{ opacity: 0.6, borderStyle: "dashed" }}
                    >
                      <Group justify="space-between" wrap="nowrap" mb={6}>
                        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                          {isFuture ? (
                            <ThemeIcon
                              variant="light"
                              color="gray"
                              size={28}
                              radius="md"
                            >
                              <IconPlugConnected size={16} />
                            </ThemeIcon>
                          ) : (
                            <DriverIcon name={name} color="gray" />
                          )}
                          <Text fw={600} size="sm" truncate>
                            {dm.label}
                          </Text>
                        </Group>
                        <Badge
                          size="xs"
                          variant="light"
                          color={isFuture ? "gray" : "teal"}
                        >
                          {isFuture ? "à venir" : "config"}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed">
                        non monté ici
                      </Text>
                    </Card>
                  );
                })}
              </SimpleGrid>
            </Stack>
          )}

          {axis === "write" && (
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                Un même log est copié, <b>en même temps</b>, vers TOUTES les
                destinations actives.
              </Text>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                {writes.map((w) => (
                  <WriteCard key={w.id} dest={w} />
                ))}
              </SimpleGrid>
            </Stack>
          )}

          {axis === "stream" && (
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                Les logs sont diffusés en direct sur le bus{" "}
                <Code>syslog:stream</Code> (WebSocket) — c'est ce que montre
                l'onglet <b>Live</b>. Indépendant du driver de lecture.
              </Text>
              <Card withBorder radius="md" p="md">
                <Group gap="sm" wrap="wrap">
                  <ThemeIcon variant="light" color="teal" size="lg" radius="md">
                    <IconBroadcast size={20} />
                  </ThemeIcon>
                  <Box>
                    <Text fw={700}>Bus temps réel</Text>
                    <Group gap={6} mt={4}>
                      <Badge variant="light" color="teal" tt="none">
                        syslog:stream
                      </Badge>
                      {rt && (
                        <Badge variant="dot" color={rt.color} tt="none">
                          {rt.label}
                        </Badge>
                      )}
                    </Group>
                  </Box>
                </Group>
              </Card>
            </Stack>
          )}
        </Stack>
      )}
    </DataState>
  );
}

/** Carte conceptuelle d'un axe (Doc) — icône + titre + explication, sans valeur live. */
function ConceptCard({
  icon,
  color,
  title,
  children,
}: {
  icon: ReactNode;
  color: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card withBorder radius="md" p="md" h="100%">
      <Group gap="xs" mb="xs" wrap="nowrap">
        <ThemeIcon variant="light" color={color} size="lg" radius="md">
          {icon}
        </ThemeIcon>
        <Text fw={700}>{title}</Text>
      </Group>
      <Text size="sm" c="dimmed">
        {children}
      </Text>
    </Card>
  );
}

/**
 * **FlowLegendDoc** — onglet « Doc » du Log Backplane : la pédagogie déplacée hors
 * de la Vue d'ensemble (qui reste factuelle). Trois rubriques : les 3 axes, le
 * sens écriture/lecture (« fond de panier »), et la légende event → étape.
 */
export function FlowLegendDoc() {
  return (
    <Stack gap="lg">
      {/* Rubrique 1 — les 3 axes. */}
      <Stack gap="xs">
        <Title order={4}>Les 3 axes du Log Backplane</Title>
        <Text size="sm" c="dimmed">
          Écrire, relire et diffuser des logs sont 3 préoccupations
          <b> indépendantes</b>. Les séparer permet d'écrire sur le disque,
          relire en mémoire et streamer en live — simultanément.
        </Text>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
          <ConceptCard
            icon={<IconPencil size={20} />}
            color="gray"
            title="Écriture (fan-out)"
          >
            La <b>ligne</b> de chaque log est copiée vers PLUSIEURS destinations
            en même temps : ring mémoire, fichier texte/JSONL, Loki, OpenSearch.
            Figée par la config / les variables d'env.
          </ConceptCard>
          <ConceptCard
            icon={<IconSearch size={20} />}
            color="brand"
            title="Lecture (un panier)"
          >
            On RELIT depuis <b>une seule</b> destination — le « fond de panier »
            qu'on fouille dans l'Explorer. C'est l'axe qu'on bascule (à chaud en
            dev).
          </ConceptCard>
          <ConceptCard
            icon={<IconBroadcast size={20} />}
            color="teal"
            title="Bus temps réel"
          >
            Diffusion <b>live</b> des logs (onglet Live, WebSocket). Indépendante
            du driver : marche même si la destination n'est pas interrogeable.
          </ConceptCard>
        </SimpleGrid>
      </Stack>

      {/* Rubrique 2 — pourquoi un seul panier en lecture. */}
      <Stack gap="xs">
        <Title order={4}>Écriture vs lecture — pourquoi « un seul panier » ?</Title>
        <Text size="sm" c="dimmed">
          <b>Écriture = plusieurs.</b> Un même log part en parallèle vers toutes
          les destinations actives (diffusion / fan-out). <b>Lecture = une.</b>{" "}
          On ne peut pas fusionner cohéremment une recherche paginée et triée sur
          des backends <b>hétérogènes</b> (ring mémoire vs fichier JSONL vs Loki
          LogQL vs OpenSearch) : pagination, ordre et sémantique de filtre
          diffèrent. On choisit donc LE panier qu'on inspecte → des résultats
          cohérents.
        </Text>
        <Text size="sm" c="dimmed">
          <b>Image :</b> plusieurs magnétophones enregistrent en parallèle
          (écriture) ; pour réécouter, on met <b>une</b> cassette dans le lecteur
          à la fois (lecture).
        </Text>
      </Stack>

      {/* Rubrique 3 — légende : event technique → étape logique. */}
      <Stack gap="xs">
        <Group gap={6}>
          <Title order={4}>Comprendre les étapes d'une requête</Title>
          <DocHint
            title="Events → étapes logiques"
            version={LOGS_DOC}
            summary="Les logs DEBUG portent des noms d'events internes (onRequest, onSend…). Ce tableau les traduit en étapes claires — c'est la colonne « Étape » de l'Explorer."
            sections={[
              {
                label: "Le piège du nom",
                body: "« onRequestEnd » = corps entrant reçu (tôt, surtout pour un GET), PAS la fin de la requête. Fie-toi à l'ordre logique, pas au nom.",
              },
            ]}
          />
        </Group>
        <Card withBorder radius="md" p={0}>
          <Table striped withRowBorders={false} verticalSpacing="xs" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 220 }}>Event (dans les logs)</Table.Th>
                <Table.Th style={{ width: 180 }}>Étape</Table.Th>
                <Table.Th>Signification</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {FLOW_LEGEND.map((row) => (
                <Table.Tr key={row.event}>
                  <Table.Td>
                    <Text size="xs" ff="monospace" c="dimmed">
                      {row.event}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {row.label === "—" ? (
                      <Text size="xs" c="dimmed">
                        —
                      </Text>
                    ) : (
                      <Badge size="sm" variant="light" color="brand">
                        {row.label}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {row.meaning}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </Stack>
  );
}

/**
 * **SyslogHealthPanel** — onglet « Santé & compteurs » du Log Backplane :
 * compteurs cumulés du syslog (valides/erreurs/critiques/invalides/omis sous
 * charge) + état mémoire (ring) et sink d'écriture. `meta` = réponse `/backplane`.
 */
export function SyslogHealthPanel({ meta }: { meta: BackplaneMeta | null }) {
  if (!meta) return null;
  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Title order={4}>Santé & compteurs</Title>
        <Card withBorder radius="md" p="md">
          <DefinitionList>
            <KeyValue k="Environnement" v={meta.environment ?? "—"} mono />
            <KeyValue k="Sink d'écriture (LB.W)" v={meta.write.sink} mono />
            <KeyValue
              k="Logs valides (cumul)"
              v={meta.counters.valid.toLocaleString("fr-FR")}
              mono
            />
            <KeyValue
              k="Erreurs (cumul)"
              v={meta.counters.errorTotal.toLocaleString("fr-FR")}
              mono
            />
            <KeyValue
              k="Critiques (cumul)"
              v={meta.counters.criticTotal.toLocaleString("fr-FR")}
              mono
            />
            <KeyValue
              k="Invalides (cumul)"
              v={meta.counters.invalid.toLocaleString("fr-FR")}
              mono
            />
            <KeyValue
              k="Omis sous charge (cumul)"
              v={meta.counters.missed.toLocaleString("fr-FR")}
              mono
            />
            <KeyValue
              k="En mémoire (ring)"
              v={meta.counters.buffered.toLocaleString("fr-FR")}
              mono
            />
          </DefinitionList>
        </Card>
      </Stack>
    </Stack>
  );
}

/** Résultat de la sonde `/backplane/ping` (miroir de `ILogDriverProbe` core). */
interface DriverProbe {
  ok: boolean;
  latencyMs: number;
  detail?: string;
  info?: Record<string, string | number>;
}

/**
 * Sonde la DESTINATION de lecture active : « répond-elle, en combien de temps,
 * quelles infos ? ». Auto-sonde au changement de driver + bouton « Tester ».
 * memory/file/cluster-file = local (toujours joignable, latence 0) ; loki/
 * opensearch = vraie requête réseau (`/ready`, `GET /`, `_count`).
 */
function DestinationPing({ driverName }: { driverName: string | null }) {
  const store = useStore();
  const [probe, setProbe] = useState<DriverProbe | null>(null);
  const [loading, setLoading] = useState(false);

  const ping = useCallback(async () => {
    if (!driverName) return;
    setLoading(true);
    try {
      const r = await store.api.getAbsolute<DriverProbe>(
        `/nodefony/syslog/api/backplane/ping?driver=${encodeURIComponent(driverName)}`,
      );
      setProbe(r);
    } catch (e) {
      setProbe({
        ok: false,
        latencyMs: 0,
        detail: e instanceof Error ? e.message : "échec de la sonde",
      });
    } finally {
      setLoading(false);
    }
  }, [store, driverName]);

  // Auto-sonde au montage ET à chaque changement de driver actif.
  useEffect(() => {
    setProbe(null);
    void ping();
  }, [ping]);

  return (
    <Group gap="sm" wrap="wrap">
      <Button
        size="xs"
        variant="light"
        leftSection={<IconActivity size={14} />}
        loading={loading}
        onClick={() => void ping()}
      >
        Tester la destination
      </Button>
      {probe && (
        <>
          <Badge
            color={probe.ok ? "teal" : "red"}
            variant="light"
            leftSection={
              probe.ok ? <IconCheck size={12} /> : <IconAlertTriangle size={12} />
            }
            tt="none"
          >
            {probe.ok ? "joignable" : "injoignable"}
          </Badge>
          <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
            {probe.latencyMs} ms
          </Text>
          {probe.info &&
            Object.entries(probe.info)
              .filter(([k]) => k !== "endpoint")
              .map(([k, v]) => (
                <Badge key={k} size="xs" variant="default" tt="none">
                  {k}: {String(v)}
                </Badge>
              ))}
          {probe.detail && (
            <Text size="xs" c="red" truncate maw={360}>
              {probe.detail}
            </Text>
          )}
        </>
      )}
      <DocHint
        title="Sonde de destination"
        version={LOGS_DOC}
        summary="Vérifie que la destination de lecture répond (ping), mesure la latence et remonte des infos utiles (version, statut, nombre d'entrées)."
        sections={[
          {
            label: "Local vs distant",
            body: "memory/file/cluster-file = local (toujours joignable, 0 ms). loki/opensearch = sonde réseau réelle (/ready pour Loki ; GET / + _count pour OpenSearch).",
          },
        ]}
      />
    </Group>
  );
}
