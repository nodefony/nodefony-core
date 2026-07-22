/**
 * Briques PARTAGÉES de connecteur ORM (UI + abonnements temps réel + dérivation des
 * taux) — utilisées par le dashboard `OrmOverview` (`/nodefony/orm`) et la page drill
 * `OrmWorker` (`/nodefony/orm/:pid`). Extraites d'`OrmOverview` (2500+ lignes) pour
 * partager le rendu riche sans copie et alléger le coût de relecture (cache).
 *
 * Frontière isomorphe : on consomme uniquement le data plane (`/nodefony/orm/api/*`)
 * et les canaux de la Socket Nodefony — aucun import runtime serveur.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  Group,
  Text,
  Badge,
  ThemeIcon,
  Button,
  SimpleGrid,
  Stack,
  Code,
  Divider,
  ScrollArea,
  Table,
  Tabs,
  Anchor,
  Switch,
  HoverCard,
  SegmentedControl,
  CopyButton,
  Tooltip,
  ActionIcon,
  type MantineColor,
} from "@mantine/core";
import { Link } from "react-router-dom";
import {
  IconDatabase,
  IconPlugConnected,
  IconPlugX,
  IconAffiliate,
  IconTable,
  IconBolt,
  IconChartBar,
  IconCategory,
  IconActivity,
  IconFile,
  IconServer,
  IconHeartRateMonitor,
  IconClockHour4,
  IconReload,
  IconAlertTriangle,
  IconCircleCheck,
  IconCopy,
  IconCheck,
} from "@tabler/icons-react";
import {
  useNodefonyAdaptiveChannel,
  useNodefonyAdaptiveChannelData,
} from "nodefony/react";
import {
  DocHint,
  KeyValue,
  DefinitionList,
  MiniChart,
} from "../../components/ui";
import { DbLogo, hasDbLogo } from "../../components/DbLogo";
import {
  ORM_DOC,
  fmtNum,
  fmtMs,
  fmtDuration,
  fmtClock,
  fmtBytes,
  connectorRole,
} from "../../utils/ormFormat";
import {
  normalize,
  type HealthPayload,
  type NormalizedHealth,
} from "../../utils/realtimeHealth";
import {
  VENDOR_LABEL,
  FLOW_HISTORY,
  type OrmSummary,
  type EntityNode,
  type ConnHealth,
  type ConnFlow,
  type FlowReport,
  type OrmRate,
} from "../../types/orm";
import { PLATFORM_CHANNELS } from "nodefony";

/** Type de stockage déduit (icône + libellé + couleur). */
function storageOf(driver: string, target?: string) {
  if (target === ":memory:")
    return {
      label: "En mémoire (volatile)",
      icon: <IconBolt size={14} />,
      color: "grape" as const,
    };
  if (driver === "sqlite" && target)
    return {
      label: "Fichier local",
      icon: <IconFile size={14} />,
      color: "blue" as const,
    };
  return {
    label: "Serveur",
    icon: <IconServer size={14} />,
    color: "teal" as const,
  };
}

/** Mini-statistique encadrée — icône + label + bulle ⓘ + valeur colorée. */
export function MiniStat({
  icon,
  label,
  value,
  hint,
  info,
  color,
  flashKey,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
  info?: React.ReactNode;
  color?: MantineColor;
  /** Si fourni, la valeur FLASHE quand cette clé change (live = « ce qui bouge »). */
  flashKey?: string | number;
}) {
  return (
    <Card withBorder radius="sm" p="sm">
      <Group gap={6} wrap="nowrap" mb={4} c="dimmed">
        {icon}
        <Text size="xs">{label}</Text>
        {info ??
          (hint ? (
            <DocHint title={label} version={ORM_DOC} summary={hint} />
          ) : null)}
      </Group>
      <Text fw={700} size="lg" c={color}>
        {flashKey !== undefined ? (
          <span key={String(flashKey)} className="nf-flash">
            {value}
          </span>
        ) : (
          value
        )}
      </Text>
    </Card>
  );
}

/**
 * **ConnectorCard** — vue COMPLÈTE d'un connecteur en onglets (place limitée) :
 *  - **Diagnostic** : état live, ping/latence, erreurs, reconnexions, uptime
 *    (data plane `connection/health`, **per-instance** cloud-native).
 *  - **Connexion** : config figée (vendor, driver, versions, emplacement).
 *  - **Modèle** : entités/relations/domaines/lignes de ce connecteur.
 *  - **Entités** : liste triée par volume, vers le détail.
 *
 * Toutes les métriques portent une bulle ⓘ explicative (exigence UX).
 */
export function ConnectorCard({
  orm,
  entities,
  countMap,
  health,
  flow,
}: {
  orm: OrmSummary;
  entities: EntityNode[];
  countMap: Record<string, number>;
  health?: ConnHealth;
  flow?: ConnFlow;
}) {
  const driver = orm.connection?.driver ?? health?.driver ?? "";
  const target = orm.connection?.target ?? health?.target;
  const version = orm.connection?.version ?? health?.version;
  const ormVersion = orm.connection?.ormVersion ?? health?.ormVersion;
  const vendorLabel = VENDOR_LABEL[orm.vendor ?? ""] ?? orm.vendor ?? "—";
  const storage = storageOf(driver, target);
  // Cible réseau (host:port/db) vs fichier local vs :memory: — pilote le libellé.
  const isMemory = target === ":memory:";
  const isNetwork = !!target && !isMemory && driver !== "sqlite";
  // Rôle du connecteur (primaire / dédié) — lève la confusion « quelle est MA base ? »
  // quand plusieurs connecteurs coexistent (default mysql + fixtures :memory:).
  const role = connectorRole(orm);

  // Modèle propre à ce connecteur (dérivé du graphe + counts).
  const own = useMemo(() => {
    const ents = entities.filter((e) => e.connector === orm.name);
    let relations = 0;
    let rows = 0;
    const domains = new Set<string>();
    const rowList = ents
      .map((e) => {
        relations += e.relations?.length ?? 0;
        domains.add(e.domain || "(non classé)");
        const c = countMap[e.name];
        if (typeof c === "number" && c > 0) rows += c;
        return { name: e.name, domain: e.domain || "—", rows: c ?? -1 };
      })
      .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
    return {
      count: ents.length,
      relations,
      rows,
      domainCount: domains.size,
      rowList,
    };
  }, [entities, countMap, orm.name]);

  const errs = health?.recentErrors ?? [];

  return (
    <Card withBorder radius="md" p="lg">
      {/* En-tête : identité + état live */}
      <Group justify="space-between" wrap="nowrap" mb="md">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon size={46} radius="md" variant="default">
            {hasDbLogo(driver) ? (
              <DbLogo name={driver} size={28} title={driver} />
            ) : (
              <IconDatabase size={26} />
            )}
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <Text fw={700} truncate>
                {orm.name}
              </Text>
              <Tooltip label={role.hint} multiline w={280} withArrow>
                <Badge
                  size="xs"
                  variant="light"
                  color={role.color as MantineColor}
                  style={{ textTransform: "none", cursor: "help" }}
                >
                  {role.label}
                </Badge>
              </Tooltip>
            </Group>
            <Group gap={5} wrap="nowrap" style={{ minWidth: 0 }}>
              {hasDbLogo(orm.vendor) && (
                <DbLogo name={orm.vendor} size={13} title={vendorLabel} />
              )}
              <Text size="xs" c="dimmed" truncate>
                {vendorLabel}
                {ormVersion ? ` ${ormVersion}` : ""}
                {driver ? ` · ${driver}` : ""}
              </Text>
            </Group>
            {/* Cible de connexion (endpoint réseau / fichier / mémoire) — visible
                sans ouvrir l'onglet Connexion (« faire mieux » : URL au 1er regard). */}
            {target && (
              <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }} mt={2}>
                <span
                  style={{
                    display: "inline-flex",
                    color: `var(--mantine-color-${storage.color}-6)`,
                    flexShrink: 0,
                  }}
                  aria-hidden
                >
                  {storage.icon}
                </span>
                <Text
                  size="xs"
                  c="dimmed"
                  ff="monospace"
                  truncate
                  title={target}
                >
                  {isMemory ? storage.label : target}
                </Text>
              </Group>
            )}
          </div>
        </Group>
        <Badge
          variant="light"
          color={orm.connected ? "teal" : "gray"}
          leftSection={
            orm.connected ? (
              <IconPlugConnected size={13} />
            ) : (
              <IconPlugX size={13} />
            )
          }
        >
          {orm.connected ? "connecté" : "déconnecté"}
        </Badge>
      </Group>

      <Tabs defaultValue="diagnostic" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab
            value="diagnostic"
            leftSection={<IconHeartRateMonitor size={14} />}
          >
            Diagnostic
          </Tabs.Tab>
          <Tabs.Tab
            value="connexion"
            leftSection={<IconPlugConnected size={14} />}
          >
            Connexion
          </Tabs.Tab>
          <Tabs.Tab value="modele" leftSection={<IconAffiliate size={14} />}>
            Modèle
          </Tabs.Tab>
          <Tabs.Tab value="entites" leftSection={<IconTable size={14} />}>
            Entités
          </Tabs.Tab>
        </Tabs.List>

        {/* ── Diagnostic ── */}
        <Tabs.Panel value="diagnostic">
          <Group gap="xs" wrap="nowrap" mb="sm">
            <Badge
              size="sm"
              variant="light"
              color={
                health
                  ? health.pingOk
                    ? "teal"
                    : "red"
                  : orm.connected
                    ? "gray"
                    : "red"
              }
              leftSection={<IconBolt size={12} />}
            >
              {health ? (
                <span key={String(health.pingMs)} className="nf-flash">
                  {health.pingOk
                    ? `ping ${fmtMs(health.pingMs)}`
                    : "ping échec"}
                </span>
              ) : (
                "ping —"
              )}
            </Badge>
            {health && (
              <Badge
                size="sm"
                variant="default"
                leftSection={<IconServer size={12} />}
              >
                instance {health.instanceId}
              </Badge>
            )}
            <DocHint
              title="Diagnostic per-instance"
              version={ORM_DOC}
              summary="Chaque process/pod a son propre pool de connexions, donc ses propres métriques (cloud-native)."
              sections={[
                {
                  label: "Temps réel",
                  body: "Données poussées en direct par la Socket Nodefony (switch « Temps réel »).",
                },
                {
                  label: "Multi-pod",
                  body: "La vue agrégée relève de l'observabilité externe (Prometheus) ou du fan-out Redis cross-pod (P13).",
                },
              ]}
            />
          </Group>

          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
            <MiniStat
              icon={<IconBolt size={16} />}
              label="Latence ping"
              value={fmtMs(health?.pingMs ?? null)}
              color={health?.pingOk ? "teal" : undefined}
              flashKey={health?.pingMs ?? "—"}
              hint="Round-trip RÉEL vers la base (SQL `SELECT 1` / Mongo `ping`), mesuré à chaque push temps réel et au bouton « Tester »."
            />
            <MiniStat
              icon={<IconClockHour4 size={16} />}
              label="Uptime"
              value={fmtDuration(health?.uptimeMs ?? null)}
              hint="Temps écoulé depuis la dernière connexion réussie de ce process."
            />
            <MiniStat
              icon={<IconPlugConnected size={16} />}
              label="Connexions"
              value={health?.connectCount ?? "—"}
              hint="Nombre de connexions réussies depuis le démarrage du process (1 = boot normal)."
            />
            <MiniStat
              icon={<IconReload size={16} />}
              label="Reconnexions"
              value={health?.reconnectCount ?? "—"}
              color={health && health.reconnectCount > 0 ? "orange" : undefined}
              hint="Connexions au-delà de la première = rétablissements après une coupure. > 0 signale une connexion instable (per-instance)."
            />
            <MiniStat
              icon={<IconAlertTriangle size={16} />}
              label="Erreurs"
              value={health?.errorCount ?? "—"}
              color={health && health.errorCount > 0 ? "red" : undefined}
              hint="Erreurs de connexion + pings en échec cumulés sur ce process. > 0 = la base a refusé/coupé au moins une fois."
            />
            <MiniStat
              icon={<IconClockHour4 size={16} />}
              label="Latence connexion"
              value={fmtMs(health?.lastConnectMs ?? null)}
              hint="Durée d'établissement de la dernière connexion (handshake + pool). Élevée = base lente à répondre au boot."
            />
          </SimpleGrid>

          {flow && (
            <>
              <Divider
                my="sm"
                label={
                  <Group gap={5}>
                    Flux requêtes (live)
                    <DocHint
                      title="Flux SQL du connecteur"
                      version={ORM_DOC}
                      summary="Débit SQL de ce connecteur (requêtes/s) + latence moyenne lissée (EWMA)."
                      sections={[
                        {
                          label: "Technique",
                          body: "Débit dérivé du delta entre 2 mesures ; latence lissée en EWMA. Le petit graphe = historique du débit.",
                        },
                        {
                          label: "Source",
                          body: "Canal nodefony:orm:flow, cadence suivant le réglage temps réel.",
                        },
                      ]}
                    />
                  </Group>
                }
                labelPosition="left"
              />
              <Group
                justify="space-between"
                align="flex-end"
                wrap="nowrap"
                gap="md"
              >
                <Group gap="lg" wrap="nowrap">
                  <div>
                    <Text size="xs" c="dimmed">
                      Débit
                    </Text>
                    <Text
                      fw={700}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {flow.rate.toFixed(flow.rate < 10 ? 1 : 0)}{" "}
                      <Text span size="xs" c="dimmed">
                        req/s
                      </Text>
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed">
                      Latence ⌀ (EWMA)
                    </Text>
                    <Text
                      fw={700}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {fmtMs(flow.ewmaMs)}
                    </Text>
                  </div>
                </Group>
                {flow.hist.length > 1 && (
                  <div style={{ flex: 1, minWidth: 0, maxWidth: 240 }}>
                    <MiniChart
                      series={[
                        {
                          data: flow.hist,
                          color: "var(--mantine-color-grape-5)",
                          label: "req/s",
                        },
                      ]}
                      height={46}
                    />
                  </div>
                )}
              </Group>
            </>
          )}

          {health &&
            (health.latency.samples > 0 || health.storage || health.pool) && (
              <>
                <Divider my="sm" label="Sondes" labelPosition="left" />
                <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
                  {health.latency.samples > 0 && (
                    <MiniStat
                      icon={<IconBolt size={16} />}
                      label="Latence min/⌀/max"
                      value={`${fmtMs(health.latency.min)} / ${fmtMs(
                        health.latency.avg,
                      )} / ${fmtMs(health.latency.max)}`}
                      flashKey={health.latency.last ?? "—"}
                      hint={`Fenêtre glissante sur ${health.latency.samples} ping(s) — révèle les pics, pas qu'un instantané.`}
                    />
                  )}
                  {health.storage && (
                    <>
                      <MiniStat
                        icon={<IconDatabase size={16} />}
                        label="Taille base"
                        value={fmtBytes(health.storage.sizeBytes)}
                        flashKey={health.storage.sizeBytes ?? "—"}
                        hint={`${health.storage.pages ?? "—"} pages × ${
                          health.storage.pageSize ?? "—"
                        } o. Croissance visible en direct.`}
                      />
                      <MiniStat
                        icon={<IconActivity size={16} />}
                        label="Journal"
                        value={health.storage.journalMode ?? "—"}
                        hint="Mode de journalisation SQLite (`wal` = lectures concurrentes pendant l'écriture ; `delete` = défaut)."
                      />
                      <MiniStat
                        icon={<IconAlertTriangle size={16} />}
                        label="Pages libres"
                        value={health.storage.freePages ?? "—"}
                        color={
                          (health.storage.freePages ?? 0) > 1000
                            ? "orange"
                            : undefined
                        }
                        hint="Pages libérées non récupérées (fragmentation). Élevé → un `VACUUM` récupérerait de l'espace."
                      />
                    </>
                  )}
                  {health.pool && (
                    <MiniStat
                      icon={<IconServer size={16} />}
                      label="Pool (actives/dispo)"
                      value={`${health.pool.borrowed ?? "—"} / ${
                        health.pool.available ?? "—"
                      }`}
                      hint="Connexions en cours d'utilisation / disponibles (bases serveur)."
                    />
                  )}
                </SimpleGrid>
              </>
            )}

          <Divider
            my="sm"
            label={`Erreurs récentes${errs.length ? ` (${errs.length})` : ""}`}
            labelPosition="left"
          />
          {errs.length === 0 ? (
            <Group gap={6} c="teal">
              <IconCircleCheck size={16} />
              <Text size="sm">Aucune erreur de connexion enregistrée.</Text>
            </Group>
          ) : (
            <ScrollArea.Autosize mah={150} type="auto">
              <Stack gap={6}>
                {errs.map((e, i) => (
                  <Group
                    key={`${e.ts}-${i}`}
                    gap="xs"
                    wrap="nowrap"
                    align="flex-start"
                  >
                    <Text
                      size="xs"
                      c="dimmed"
                      ff="monospace"
                      style={{ flexShrink: 0 }}
                    >
                      {fmtClock(e.ts)}
                    </Text>
                    <Text size="xs" c="red" style={{ wordBreak: "break-word" }}>
                      {e.message}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          )}
          {health?.pingError && (
            <Text size="xs" c="red" mt="xs">
              Dernier ping : {health.pingError}
            </Text>
          )}
        </Tabs.Panel>

        {/* ── Connexion ── */}
        <Tabs.Panel value="connexion">
          <DefinitionList>
            <KeyValue
              k="Vendor ORM"
              v={`${vendorLabel}${ormVersion ? ` ${ormVersion}` : ""}`}
            />
            <KeyValue k="Base / driver" v={driver || "—"} mono />
            <KeyValue k="Version base" v={version ?? "—"} mono />
            <KeyValue
              k="Connecteur"
              v={`${orm.name}${orm.default ? " (défaut)" : ""}`}
              mono
            />
            <KeyValue k="Rôle" v={role.label} />
          </DefinitionList>
          <Text size="xs" c="dimmed" mt={6}>
            {role.hint}
          </Text>
          <Group gap="xs" mt="sm" align="center">
            <Badge
              variant="light"
              color={storage.color}
              leftSection={storage.icon}
            >
              {storage.label}
            </Badge>
            <DocHint
              title={isNetwork ? "Endpoint réseau" : "Emplacement"}
              version={ORM_DOC}
              summary={
                isNetwork
                  ? "Cible réseau de la connexion (host:port/base), credentials masqués côté serveur."
                  : "Emplacement physique de la base de données."
              }
              sections={[
                {
                  label: "Sécurité",
                  body: "Chemin TOUJOURS relatif à la racine du projet ; URL réseau SANS user/password — jamais d'absolu ni de credential exposé dans le data plane.",
                },
              ]}
            />
          </Group>
          {target && !isMemory ? (
            <Group gap={6} wrap="nowrap" mt="xs" style={{ minWidth: 0 }}>
              <Code
                style={{
                  fontSize: 11,
                  wordBreak: "break-all",
                  flex: 1,
                  minWidth: 0,
                }}
                title={target}
              >
                {target}
              </Code>
              <CopyButton value={target} timeout={1500}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? "Copié" : "Copier"} withArrow>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color={copied ? "teal" : "gray"}
                      onClick={copy}
                      aria-label="Copier la cible de connexion"
                    >
                      {copied ? (
                        <IconCheck size={14} />
                      ) : (
                        <IconCopy size={14} />
                      )}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
          ) : (
            <Text size="xs" c="dimmed" mt="xs">
              {isMemory
                ? "Base volatile en mémoire — aucun fichier, données perdues au redémarrage."
                : "Emplacement indisponible."}
            </Text>
          )}
        </Tabs.Panel>

        {/* ── Modèle ── */}
        <Tabs.Panel value="modele">
          <SimpleGrid cols={2} spacing="sm">
            <MiniStat
              icon={<IconTable size={16} />}
              label="Entités"
              value={own.count}
              hint="Entités mappées sur ce connecteur."
            />
            <MiniStat
              icon={<IconAffiliate size={16} />}
              label="Relations"
              value={own.relations}
              hint="Relations déclarées entre entités de ce connecteur."
            />
            <MiniStat
              icon={<IconCategory size={16} />}
              label="Domaines"
              value={own.domainCount}
              hint="Domaines fonctionnels distincts couverts."
            />
            <MiniStat
              icon={<IconChartBar size={16} />}
              label="Lignes"
              value={fmtNum(own.rows)}
              hint="Total des lignes en base pour ce connecteur (COUNT(*))."
            />
          </SimpleGrid>
          <Button
            component={Link}
            to="/nodefony/databases"
            variant="subtle"
            size="xs"
            mt="md"
            fullWidth
            leftSection={<IconAffiliate size={14} />}
          >
            Voir le schéma ERD
          </Button>
        </Tabs.Panel>

        {/* ── Entités ── */}
        <Tabs.Panel value="entites">
          {own.rowList.length === 0 ? (
            <Text size="sm" c="dimmed">
              Aucune entité sur ce connecteur.
            </Text>
          ) : (
            <ScrollArea h={300} type="auto" offsetScrollbars="y">
              <Table stickyHeader highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Entité</Table.Th>
                    <Table.Th>Domaine</Table.Th>
                    <Table.Th style={{ textAlign: "right" }}>Lignes</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {own.rowList.map((e) => (
                    <Table.Tr key={e.name}>
                      <Table.Td>
                        <Anchor
                          component={Link}
                          to={`/nodefony/orm-entity?name=${encodeURIComponent(
                            e.name,
                          )}&connector=${encodeURIComponent(orm.name)}`}
                          size="xs"
                        >
                          {e.name}
                        </Anchor>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {e.domain}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>
                        <Text size="xs" ff="monospace">
                          {fmtNum(e.rows)}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Tabs.Panel>
      </Tabs>
    </Card>
  );
}

/**
 * Abonné à la SOCKET Nodefony, canal `nodefony:orm:health` — monté UNIQUEMENT quand « Temps
 * réel » est ON (abonnement ref-compté → démonter désabonne → le serveur arrête le
 * ticker, 0 travail quand OFF). Pousse le dernier paquet à `onData`.
 *
 * Cadence : **fixe** (granularité choisie) OU **adaptative (AIMD)** si `adaptive`.
 * `enabled:false` ⇒ simple abonnement à `intervalMs` ; `onRate` remonte la cadence réelle.
 */
export function OrmHealthLive({
  intervalMs,
  adaptive,
  onData,
  onRate,
}: {
  intervalMs: number;
  adaptive: boolean;
  onData: (h: ConnHealth[]) => void;
  /** Remonte la cadence RÉELLE (ms) appliquée par l'AIMD → badge feedback. */
  onRate?: (ms: number) => void;
}) {
  const { data, intervalMs: effectiveMs } = useNodefonyAdaptiveChannelData<
    ConnHealth[]
  >(PLATFORM_CHANNELS.ormHealth, intervalMs, {
    defaultMs: 5000,
    enabled: adaptive,
  });
  useEffect(() => {
    if (Array.isArray(data)) onData(data);
    // onData = setState (stable) → hors deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  useEffect(() => {
    onRate?.(effectiveMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMs]);
  return null;
}

/**
 * Abonné à la SOCKET, canal `nodefony:orm:flow` — **même mécanique adaptative** qu'`OrmHealthLive`
 * (suit le réglage global AIMD). Pousse le rapport brut à `onFlow` (le débit/s est
 * dérivé côté appelant via {@link useOrmFlow}).
 */
export function OrmFlowLive({
  intervalMs,
  adaptive,
  onFlow,
}: {
  intervalMs: number;
  adaptive: boolean;
  onFlow: (payload: unknown) => void;
}) {
  useNodefonyAdaptiveChannel(PLATFORM_CHANNELS.ormFlow, onFlow, intervalMs, {
    defaultMs: 2000,
    enabled: adaptive,
  });
  return null;
}

/**
 * Abonné au canal **drill ORM cluster** `nodefony:orm:rich@<pid>` — diagnostic ORM RICHE
 * (`connection/health` + `flow`) du worker `pid` EXACT, en UN canal combiné. Remplace
 * `OrmHealthLive` + `OrmFlowLive` sur la page drill : en cluster, ces deux canaux nus
 * (`nodefony:orm:health`/`nodefony:orm:flow`) tombent sur un worker round-robin (reusePort) ; `nodefony:orm:rich@<pid>`
 * cible le worker demandé (relais ciblé master→worker, facette "orm"). En mono / worker
 * courant, le serveur sert le diagnostic local exact.
 *
 * Payload : `{ pid, ts, richPending, health?, flow? }`. Tant que l'enrich ORM ne s'est pas
 * propagé cross-process (≤ 1 cycle), `richPending:true` (pas encore de `health`/`flow`) →
 * `onPending(true)` pour un état « préparation du diagnostic ». 1 canal = 1 enrich = pas de
 * ref-count (le hub dédoublonne par nom de canal).
 */
export function OrmRichLive({
  pid,
  intervalMs,
  adaptive,
  onHealth,
  onFlow,
  onPending,
}: {
  pid: string;
  intervalMs: number;
  adaptive: boolean;
  onHealth: (h: ConnHealth[]) => void;
  onFlow: (payload: unknown) => void;
  /** Remonte l'état « warming » (enrich ORM pas encore propagé au worker ciblé). */
  onPending?: (pending: boolean) => void;
}) {
  const handler = useCallback(
    (payload: unknown) => {
      const p = payload as {
        richPending?: boolean;
        health?: ConnHealth[];
        flow?: unknown;
      } | null;
      if (!p) return;
      if (p.richPending) {
        onPending?.(true);
        return;
      }
      onPending?.(false);
      if (Array.isArray(p.health)) onHealth(p.health);
      if (p.flow !== undefined) onFlow(p.flow);
    },
    [onHealth, onFlow, onPending],
  );
  useNodefonyAdaptiveChannel(
    `${PLATFORM_CHANNELS.ormRich}@${pid}`,
    handler,
    intervalMs,
    {
      defaultMs: 3000,
      enabled: adaptive,
    },
  );
  return null;
}

/**
 * Abonné à la SOCKET Nodefony, canal `nodefony:socket` — sonde LEAN pod (cumuls
 * `IOrmLeanHealth` + erreurs) **agrégée par le master en cluster** (donc cohérente,
 * ≠ `/orm/api/*` qui tape 1 worker au hasard). Sert la **détection cluster** + le
 * **verdict Santé ORM** + le breakdown par worker. Monté seulement quand « Temps
 * réel » est ON (ref-compté → 0 ticker serveur OFF) ; suit l'AIMD global.
 */
export function RealtimeHealthLive({
  intervalMs,
  adaptive,
  onData,
  onRate,
}: {
  intervalMs: number;
  adaptive: boolean;
  onData: (h: HealthPayload) => void;
  /** Remonte la cadence RÉELLE (ms) appliquée par l'AIMD → badge feedback. */
  onRate?: (ms: number) => void;
}) {
  const { data, intervalMs: effectiveMs } =
    useNodefonyAdaptiveChannelData<HealthPayload>(
      PLATFORM_CHANNELS.socket,
      intervalMs,
      {
        defaultMs: 5000,
        enabled: adaptive,
      },
    );
  useEffect(() => {
    if (data) onData(data);
    // onData = setState (stable) → hors deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  useEffect(() => {
    onRate?.(effectiveMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMs]);
  return null;
}

/**
 * Dérive le flux par connecteur (débit/s + EWMA + historique sparkline) à partir
 * des rapports bruts du canal `nodefony:orm:flow` (delta de `total` entre 2 frames). Renvoie
 * `{ flowByName, onFlow, reset }` — `onFlow` à passer à {@link OrmFlowLive}.
 */
export function useOrmFlow(): {
  flowByName: Record<string, ConnFlow>;
  onFlow: (payload: unknown) => void;
  reset: () => void;
} {
  const [flowByName, setFlowByName] = useState<Record<string, ConnFlow>>({});
  const prevFlowRef = useRef<{
    ts: number;
    totals: Record<string, number>;
  } | null>(null);
  const onFlow = useCallback((payload: unknown) => {
    const r = payload as FlowReport;
    if (!r || !Array.isArray(r.connectors)) return;
    const prev = prevFlowRef.current;
    const dt = prev ? (r.ts - prev.ts) / 1000 : 0;
    setFlowByName((cur) => {
      const next: Record<string, ConnFlow> = { ...cur };
      for (const c of r.connectors) {
        const p = prev?.totals[c.connector];
        const rate =
          p != null && dt > 0
            ? Math.max(0, (c.total - p) / dt)
            : (next[c.connector]?.rate ?? 0);
        const hist = [...(next[c.connector]?.hist ?? []), rate].slice(
          -FLOW_HISTORY,
        );
        next[c.connector] = { rate, ewmaMs: c.ewmaMs, hist };
      }
      return next;
    });
    const totals: Record<string, number> = {};
    for (const c of r.connectors) totals[c.connector] = c.total;
    prevFlowRef.current = { ts: r.ts, totals };
  }, []);
  const reset = useCallback(() => {
    setFlowByName({});
    prevFlowRef.current = null;
  }, []);
  return { flowByName, onFlow, reset };
}

/**
 * Dérive, par worker (clé pid), les **taux** ORM (erreurs/min, reconnexions/min) et
 * l'**historique du débit requêtes/s** à partir des snapshots cumulés de la sonde lean
 * pod (`nodefony:socket`). 0 backend : delta des cumuls entre 2 frames, côté front.
 * `active=false` (temps réel OFF) → remet à zéro (pas de taux sur un snapshot figé).
 */
export function useOrmRates(
  normRt: NormalizedHealth | null,
  active: boolean,
): {
  ratesByPid: Map<string, OrmRate>;
  qSeriesByPid: Map<string, number[]>;
} {
  const prevOrmRef = useRef<
    Map<string, { ts: number; err: number; recon: number; q: number }>
  >(new Map());
  const [ratesByPid, setRatesByPid] = useState<Map<string, OrmRate>>(new Map());
  const [qSeriesByPid, setQSeriesByPid] = useState<Map<string, number[]>>(
    new Map(),
  );

  useEffect(() => {
    if (!active) {
      prevOrmRef.current = new Map();
      setRatesByPid(new Map());
      setQSeriesByPid(new Map());
    }
  }, [active]);

  useEffect(() => {
    if (!normRt) return;
    const rates = new Map<string, OrmRate>();
    const qRates = new Map<string, number>();
    const seen = new Set<string>();
    for (const inst of normRt.instances) {
      const o = inst.orm;
      if (!o) continue;
      seen.add(inst.instanceId);
      const prev = prevOrmRef.current.get(inst.instanceId);
      const dtMin = prev ? (normRt.ts - prev.ts) / 60000 : 0;
      const dtSec = prev ? (normRt.ts - prev.ts) / 1000 : 0;
      rates.set(
        inst.instanceId,
        prev && dtMin > 0
          ? {
              errPerMin: Math.max(0, (o.errorTotal - prev.err) / dtMin),
              reconPerMin: Math.max(0, (o.reconnectTotal - prev.recon) / dtMin),
            }
          : { errPerMin: null, reconPerMin: null },
      );
      qRates.set(
        inst.instanceId,
        prev && dtSec > 0 ? Math.max(0, (o.queryTotal - prev.q) / dtSec) : 0,
      );
      prevOrmRef.current.set(inst.instanceId, {
        ts: normRt.ts,
        err: o.errorTotal,
        recon: o.reconnectTotal,
        q: o.queryTotal,
      });
    }
    // Purge des pid disparus (respawn → l'ancien tombe).
    for (const id of prevOrmRef.current.keys())
      if (!seen.has(id)) prevOrmRef.current.delete(id);
    setRatesByPid(rates);
    setQSeriesByPid((prev) => {
      const next = new Map(prev);
      for (const [id, r] of qRates) {
        const cur = next.get(id) ?? [];
        const arr =
          cur.length >= FLOW_HISTORY
            ? cur.slice(cur.length - FLOW_HISTORY + 1)
            : cur.slice();
        arr.push(r);
        next.set(id, arr);
      }
      for (const id of next.keys()) if (!seen.has(id)) next.delete(id);
      return next;
    });
  }, [normRt]);

  return { ratesByPid, qSeriesByPid };
}

/**
 * Contrôles « Temps réel » PARTAGÉS des pages ORM (overview + drill) : switch global
 * (UiStore), bulle de granularité du canal, badge cadence AIMD réelle. Évite la triple
 * copie du même bloc d'actions de PageHeader.
 */
export function OrmRealtimeControls({
  live,
  onToggle,
  liveMs,
  setLiveMs,
  auto,
  effectiveMs,
  ariaLabel,
}: {
  live: boolean;
  onToggle: (v: boolean) => void;
  liveMs: number;
  setLiveMs: (ms: number) => void;
  auto: boolean;
  effectiveMs: number;
  ariaLabel: string;
}) {
  return (
    <Group gap="xs">
      {live && <span className="nf-live-dot" aria-hidden />}
      <HoverCard
        width={250}
        shadow="md"
        position="bottom"
        withinPortal
        openDelay={120}
        closeDelay={120}
      >
        <HoverCard.Target>
          <div>
            <Switch
              size="sm"
              checked={live}
              onChange={(e) => onToggle(e.currentTarget.checked)}
              label="Temps réel"
              aria-label={ariaLabel}
            />
          </div>
        </HoverCard.Target>
        <HoverCard.Dropdown>
          <Group gap={6} mb={6}>
            <IconBolt size={14} />
            <Text size="xs" fw={600}>
              {auto ? "Cadence désirée (plancher)" : "Granularité du canal"}
            </Text>
          </Group>
          <SegmentedControl
            fullWidth
            size="xs"
            value={String(liveMs)}
            onChange={(v) => setLiveMs(Number(v))}
            data={[
              { label: "2 s", value: "2000" },
              { label: "5 s", value: "5000" },
              { label: "10 s", value: "10000" },
              { label: "30 s", value: "30000" },
            ]}
          />
          <Text size="xs" c="dimmed" mt={6}>
            {auto
              ? "Cadence auto (AIMD) ACTIVE — réglée globalement dans le Hub. Cette valeur sert de plancher : la socket part de là et l'ajuste seule selon la charge serveur."
              : "Cadence des pushes de la socket (sonde ORM). Plus court = plus réactif, mais plus de sondes par seconde côté serveur. (Cadence auto réglable dans le Hub.)"}
          </Text>
        </HoverCard.Dropdown>
      </HoverCard>
      {auto && live ? (
        <Badge
          size="sm"
          variant="light"
          color="grape"
          title="Cadence auto (AIMD) — cadence réelle appliquée. Recule sous charge serveur, remonte quand c'est fluide. Réglage global dans le Hub."
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          auto ~
          {effectiveMs < 1000 ? `${effectiveMs}ms` : `${effectiveMs / 1000}s`}
        </Badge>
      ) : null}
    </Group>
  );
}

/** Réexport util (un seul point d'import pour les pages ORM). */
export { normalize };
export type { NormalizedHealth, HealthPayload };
