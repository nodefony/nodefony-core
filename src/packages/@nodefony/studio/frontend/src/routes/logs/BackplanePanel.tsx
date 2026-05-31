/**
 * **BackplanePanel** — onglet « architecture & santé » de la page Log Backplane.
 *
 * Pédagogique d'abord (« comprendre ce qu'on regarde ») : expose les **3 axes
 * orthogonaux** (WRITE / DESTINATION queryable / BUS temps réel), le **registry**
 * des drivers de relecture (capacités + driver actif), la **vision** des drivers
 * à venir (file/elastic/loki — que le registry accueillera sans changer le front),
 * et la **santé** détaillée (compteurs).
 */
import type { ReactNode } from "react";
import {
  Badge,
  Card,
  Group,
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
} from "@tabler/icons-react";
import {
  DataState,
  DefinitionList,
  DocHint,
  KeyValue,
} from "../../components/ui";
import type { BackplaneMeta } from "./logsTypes";
import { LOGS_DOC, UPCOMING_DRIVERS, driverMeta } from "./logFormat";
import { CapabilityBadges, DriverIcon } from "./LogVisuals";
import { FLOW_LEGEND } from "./eventFlow";

export interface BackplanePanelProps {
  meta: BackplaneMeta | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
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
}: BackplanePanelProps) {
  const activeName = meta?.activeDriver?.name ?? null;
  const registered = meta?.drivers ?? [];
  const registeredNames = new Set(registered.map((d) => d.name));
  // Drivers « vision » non encore enregistrés (placeholder forward-looking).
  const upcoming = UPCOMING_DRIVERS.filter((n) => !registeredNames.has(n));

  return (
    <DataState loading={loading && !meta} error={error} onRetry={reload} minHeight={200}>
      {meta && (
        <Stack gap="lg">
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
                  <Badge variant="light" color="teal" tt="none">
                    syslog:stream
                  </Badge>
                }
              >
                Diffusion <b>live</b> des Pdu (onglet Live, WebSocket).
                Indépendant du driver : marche même si la destination n'est pas
                queryable.
              </AxisCard>
            </SimpleGrid>
          </Stack>

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

          {/* Vision — drivers à venir. */}
          {upcoming.length > 0 && (
            <Stack gap="xs">
              <Group gap={6}>
                <Title order={5} c="dimmed">
                  À venir
                </Title>
                <DocHint
                  title="Drivers à venir"
                  version={LOGS_DOC}
                  summary="Le contrat ILogDriver + le registry accueilleront ces destinations SANS changer cet écran ni l'Explorer (même endpoint, mêmes critères)."
                />
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                {upcoming.map((name) => {
                  const dm = driverMeta(name);
                  return (
                    <Card
                      key={name}
                      withBorder
                      radius="md"
                      p="md"
                      style={{ opacity: 0.6, borderStyle: "dashed" }}
                    >
                      <Group gap="sm" wrap="nowrap" mb="xs">
                        <ThemeIcon variant="light" color="gray" size={32} radius="md">
                          <IconPlugConnected size={18} />
                        </ThemeIcon>
                        <div style={{ minWidth: 0 }}>
                          <Text fw={700} truncate>
                            {dm.label}
                          </Text>
                          <Text size="xs" c="dimmed" ff="monospace">
                            {name}
                          </Text>
                        </div>
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
