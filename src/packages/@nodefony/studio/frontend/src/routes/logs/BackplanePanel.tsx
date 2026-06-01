/**
 * **BackplanePanel** — onglet « architecture & santé » de la page Log Backplane.
 *
 * Pédagogique d'abord (« comprendre ce qu'on regarde ») : expose les **3 axes
 * orthogonaux** (WRITE / DESTINATION queryable / BUS temps réel), le **registry**
 * des drivers de relecture (capacités + driver actif), la **vision** des drivers
 * à venir (file/elastic/loki — que le registry accueillera sans changer le front),
 * et la **santé** détaillée (compteurs).
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
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
  IconPencil,
  IconStack2,
  IconBroadcast,
  IconPlugConnected,
  IconCircleDot,
  IconActivity,
  IconCheck,
  IconAlertTriangle,
} from "@tabler/icons-react";
import {
  DataState,
  DefinitionList,
  DocHint,
  KeyValue,
} from "../../components/ui";
import { useNotifications, useStore } from "../../stores";
import type { BackplaneMeta } from "./logsTypes";
import {
  LOGS_DOC,
  PLACEHOLDER_DRIVERS,
  driverMeta,
  realtimeStateLabel,
} from "./logFormat";
import {
  CapabilityBadges,
  ClusterScopeNotice,
  DriverIcon,
} from "./LogVisuals";
import { FLOW_LEGEND } from "./eventFlow";

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

/** Carte d'explication d'un des 3 axes (valeur courante + texte). */
function AxisCard({
  icon,
  color,
  title,
  current,
  children,
}: {
  icon: ReactNode;
  color: string;
  title: string;
  current: ReactNode;
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
      <Group mb={8}>{current}</Group>
      <Text size="sm" c="dimmed">
        {children}
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

  const activeName = meta?.activeDriver?.name ?? null;
  const registered = meta?.drivers ?? [];
  const registeredNames = new Set(registered.map((d) => d.name));
  // Drivers connus non montés ici (placeholder : URL absente, ou prod).
  const placeholders = PLACEHOLDER_DRIVERS.filter(
    (n) => !registeredNames.has(n),
  );
  const isDev = meta?.environment === "development";

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

          {/* Les 3 axes. */}
          <Stack gap="xs">
            <Group gap={6}>
              <Title order={4}>Les 3 axes du Log Backplane</Title>
              <DocHint
                title="Pourquoi 3 axes ?"
                version={LOGS_DOC}
                summary="Écrire, relire et diffuser des logs sont 3 préoccupations indépendantes. Les séparer permet d'écrire sur stdout, relire en mémoire et streamer en live — simultanément."
              />
            </Group>
            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
              <AxisCard
                icon={<IconPencil size={20} />}
                color="gray"
                title="WRITE — sink"
                current={
                  <Badge variant="light" color="gray" tt="none">
                    {meta.write.sink}
                  </Badge>
                }
              >
                Où part la <b>ligne texte</b> de chaque log (stdout, fichier,
                null). Couche LB.W, déjà enfichable. Figée par config/env.
              </AxisCard>

              <AxisCard
                icon={<IconStack2 size={20} />}
                color="brand"
                title="DESTINATION — où l'on range & relit"
                current={
                  activeName ? (
                    <Group gap={6}>
                      <Badge variant="light" color="brand" tt="none">
                        {activeName}
                      </Badge>
                      {meta.activeDriver && (
                        <CapabilityBadges
                          capabilities={meta.activeDriver.capabilities}
                          size="xs"
                        />
                      )}
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">
                      aucun
                    </Text>
                  )
                }
              >
                Où les logs <b>structurés</b> sont rangés ET d'où on les relit
                (onglet Explorer). C'est l'axe qu'on « change ». Mémoire
                aujourd'hui ; fichier / Elasticsearch demain.
              </AxisCard>

              <AxisCard
                icon={<IconBroadcast size={20} />}
                color="teal"
                title="BUS — temps réel"
                current={
                  <Group gap={6} wrap="nowrap">
                    <Badge variant="light" color="teal" tt="none">
                      syslog:stream
                    </Badge>
                    {realtimeState && (
                      <Badge
                        variant="dot"
                        color={realtimeStateLabel(realtimeState).color}
                        tt="none"
                      >
                        {realtimeStateLabel(realtimeState).label}
                      </Badge>
                    )}
                  </Group>
                }
              >
                Diffusion <b>live</b> des Pdu (onglet Live, WebSocket).
                Indépendant du driver : marche même si la destination n'est pas
                queryable.
              </AxisCard>
            </SimpleGrid>
          </Stack>

          {/* Contrôle de la LECTURE — destination relue + switch (dev) + sonde. */}
          <Card withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" wrap="wrap" gap="md">
                <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                  <DriverIcon name={activeName ?? "generic"} />
                  <Box style={{ minWidth: 0 }}>
                    <Group gap={6} wrap="nowrap">
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
                      <DocHint
                        title="Destination de lecture (le fond de panier)"
                        version={LOGS_DOC}
                        summary="La source qu'on RELIT et qu'on fouille dans l'Explorer — le « seau » qu'on inspecte. Indépendante de l'écriture : on peut en changer à chaud en développement."
                        sections={[
                          {
                            label: "Effet du changement",
                            body: "Bascule UNIQUEMENT ce que montre l'Explorer (recherche froide). N'affecte ni l'écriture (fan-out) ni le Live.",
                          },
                        ]}
                      />
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
                  <Group gap={6} wrap="nowrap">
                    <Select
                      size="xs"
                      w={240}
                      value={activeName}
                      data={driverOptions}
                      onChange={(v) => v && switchDriver(v)}
                      disabled={switching}
                      allowDeselect={false}
                      comboboxProps={{ withinPortal: true }}
                      aria-label="changer de destination de lecture"
                      leftSection={<IconCircleDot size={14} />}
                    />
                    <DocHint
                      title="Changer de destination (dev uniquement)"
                      version={LOGS_DOC}
                      summary="Bascule la lecture à chaud (vide + ferme l'ancienne, active la nouvelle — atomique). Le défaut reste « mémoire »."
                      sections={[
                        {
                          label: "Pourquoi seulement en dev",
                          body: "En production, la destination est figée par la config / les variables d'env (12-factor) : un serveur qui change de cible en plein vol casserait la traçabilité.",
                        },
                      ]}
                    />
                  </Group>
                )}
              </Group>

              <DestinationPing driverName={activeName} />
            </Stack>
          </Card>

          {/* Registry des drivers. */}
          <Stack gap="xs">
            <Group gap={6}>
              <Title order={4}>Drivers de relecture enregistrés</Title>
              <Badge variant="light" color="brand">
                {registered.length}
              </Badge>
              <DocHint
                title="Registry des drivers"
                version={LOGS_DOC}
                summary="Les destinations queryables connues du kernel. Le driver actif est marqué. En dev, le bandeau permet d'en activer un autre."
              />
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              {registered.map((d) => {
                const dm = driverMeta(d.name);
                const isActive = d.name === activeName;
                return (
                  <Card
                    key={d.name}
                    withBorder
                    radius="md"
                    p="md"
                    style={{
                      borderColor: isActive
                        ? "var(--mantine-color-brand-filled)"
                        : undefined,
                    }}
                  >
                    <Group justify="space-between" wrap="nowrap" mb="xs">
                      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                        <DriverIcon name={d.name} color={isActive ? "brand" : "gray"} />
                        <div style={{ minWidth: 0 }}>
                          <Text fw={700} truncate>
                            {dm.label}
                          </Text>
                          <Text size="xs" c="dimmed" ff="monospace">
                            {d.name}
                          </Text>
                        </div>
                      </Group>
                      {isActive && (
                        <Badge size="xs" color="brand" variant="filled">
                          actif
                        </Badge>
                      )}
                    </Group>
                    <CapabilityBadges capabilities={d.capabilities} />
                    <Text size="xs" c="dimmed" mt="xs">
                      {dm.description}
                    </Text>
                  </Card>
                );
              })}
            </SimpleGrid>
          </Stack>

          {/* Autres destinations connues : activables par config (non montées ici). */}
          {placeholders.length > 0 && (
            <Stack gap="xs">
              <Group gap={6}>
                <Title order={5} c="dimmed">
                  Autres destinations
                </Title>
                <DocHint
                  title="Destinations configurables (non montées ici)"
                  version={LOGS_DOC}
                  summary="Drivers connus mais non enregistrés dans CE process : activables par config (log.queryDriver + URL pour loki/opensearch). Tous implémentés (LB.2/5/4) — en dev ils se montent dès que leur config est présente ; en prod seul le driver configuré est monté. Le registry les accueille SANS changer cet écran ni l'Explorer."
                />
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                {placeholders.map((name) => {
                  const dm = driverMeta(name);
                  const isFuture = dm.upcoming === true;
                  return (
                    <Card
                      key={name}
                      withBorder
                      radius="md"
                      p="md"
                      style={{
                        opacity: isFuture ? 0.6 : 0.85,
                        borderStyle: "dashed",
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap" mb="xs">
                        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                          {isFuture ? (
                            <ThemeIcon variant="light" color="gray" size={32} radius="md">
                              <IconPlugConnected size={18} />
                            </ThemeIcon>
                          ) : (
                            <DriverIcon name={name} color="gray" />
                          )}
                          <div style={{ minWidth: 0 }}>
                            <Text fw={700} truncate>
                              {dm.label}
                            </Text>
                            <Text size="xs" c="dimmed" ff="monospace">
                              {name}
                            </Text>
                          </div>
                        </Group>
                        <Badge
                          size="xs"
                          variant="light"
                          color={isFuture ? "gray" : "teal"}
                        >
                          {isFuture ? "à venir" : "configurable"}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {dm.description}
                      </Text>
                    </Card>
                  );
                })}
              </SimpleGrid>
            </Stack>
          )}

          {/* Légende : event technique → étape logique du flux. */}
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

          {/* Santé détaillée. */}
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
      )}
    </DataState>
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
              probe.ok ? (
                <IconCheck size={12} />
              ) : (
                <IconAlertTriangle size={12} />
              )
            }
            tt="none"
          >
            {probe.ok ? "joignable" : "injoignable"}
          </Badge>
          <Text
            size="xs"
            c="dimmed"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
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
