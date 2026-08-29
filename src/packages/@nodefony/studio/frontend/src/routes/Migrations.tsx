import { observer } from "mobx-react-lite";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  CopyButton,
  Divider,
  Group,
  List,
  Loader,
  Modal,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Tooltip,
  type MantineColor,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowsExchange,
  IconCheck,
  IconClock,
  IconCopy,
  IconDatabaseExclamation,
  IconPlayerPlay,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { useNotifications, useStore } from "../stores";
import { useResource } from "../hooks";
import { DataState, DocHint, PageLayout, WarnHint } from "../components/ui";
import {
  isMigrationFailure,
  type MigrationApplyReply,
  type MigrationEntry,
  type MigrationPlan,
  type MigrationPlanReply,
  type MigrationReply,
  type MigrationSource,
  type MigrationStatus,
  type OrmSummary,
} from "../types/orm";

/** Sous-ensemble de `/nodefony/kernel/api/info` (miroir, frontière isomorphe). */
interface KernelInfo {
  environment: string;
}

/**
 * L'état des migrations de chaque base — ce qu'on cherche quand un déploiement
 * se passe mal.
 *
 * **Cette page ne calcule RIEN.** Elle affiche le verdict que le plan
 * d'administration lui rend, qui est le MÊME objet que
 * `orm:migrate:status --json`. Recalculer ne serait-ce que « à jour ou non »
 * ferait coexister deux vérités : l'écran dirait vert pendant que la commande
 * sortirait en 1, et c'est le jour d'un incident qu'on s'en apercevrait.
 *
 * Deux conséquences qui se voient à l'écran :
 *
 * - chaque geste proposé est **la commande à copier**, telle que le produit la
 *   formule. L'écran ENSEIGNE la ligne de commande, il ne s'y substitue pas —
 *   c'est elle qui tourne dans un travail de déploiement, pas un clic ;
 * - un empêchement (connecteur inconnu, base injoignable, ORM sans migrations)
 *   est MONTRÉ avec son code, sa phrase et ses gestes. Jamais un tableau vide,
 *   qui ressemblerait à « tout va bien ».
 */

/** Ce que chaque verdict vaut à l'œil — couleur, icône, mot. */
const VERDICTS: Record<
  string,
  { color: MantineColor; label: string; icon: typeof IconCheck }
> = {
  "up-to-date": { color: "teal", label: "À jour", icon: IconCheck },
  pending: { color: "yellow", label: "En retard", icon: IconClock },
  drift: {
    color: "orange",
    label: "Dérive de fichier",
    icon: IconAlertTriangle,
  },
  divergent: {
    color: "orange",
    label: "Base divergente",
    icon: IconDatabaseExclamation,
  },
  failed: { color: "red", label: "Migration en échec", icon: IconX },
  adopt: { color: "blue", label: "Historique à adopter", icon: IconClock },
};

/** Ce que vaut le statut d'UNE migration. */
/**
 * Ce que vaut le statut d'UNE migration.
 *
 * ⚠️ Les nuances sont FONCÉES (`.9`) et ce n'est pas cosmétique : en thème
 * clair, un badge Mantine `variant="light"` sur une couleur de base rend
 * 4,32:1 pour du 11 px gras — sous le seuil WCAG AA de 4,5:1, mesuré par
 * axe-core sur cet écran. La nuance foncée est ce qui fait passer le texte.
 */
const STATUTS: Record<string, { color: MantineColor; label: string }> = {
  applied: { color: "teal.9", label: "appliquée" },
  pending: { color: "orange.9", label: "en attente" },
  failed: { color: "red.9", label: "échec" },
  drifted: { color: "orange.9", label: "fichier modifié" },
  missing: { color: "gray.8", label: "fichier absent" },
};

/**
 * Date lisible — les horodatages viennent de l'historique, en millisecondes.
 *
 * @param ms - horodatage, ou `undefined` si la migration n'est pas passée.
 * @returns la date locale, ou un tiret cadratin.
 */
function dateOf(ms?: number): string {
  return ms === undefined ? "—" : new Date(ms).toLocaleString();
}

/** Un fait d'identité : étiquette au-dessus, valeur en dessous. */
function Fait({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Code>{valeur}</Code>
    </div>
  );
}

/** Une commande, affichée telle qu'on doit la taper, avec sa copie. */
function Commande({ command }: { command: string }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Code style={{ flex: 1, whiteSpace: "nowrap", overflowX: "auto" }}>
        {command}
      </Code>
      <CopyButton value={command}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? "Copiée" : "Copier la commande"}>
            <Button
              size="compact-xs"
              variant="light"
              color={copied ? "teal" : "gray"}
              onClick={copy}
              leftSection={
                copied ? <IconCheck size={14} /> : <IconCopy size={14} />
              }
              aria-label={`Copier « ${command} »`}
            >
              {copied ? "Copiée" : "Copier"}
            </Button>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}

/** Les migrations d'une origine, une ligne par migration. */
function SourceTable({ source }: { source: MigrationSource }) {
  const entries: MigrationEntry[] = source.entries ?? [];
  return (
    <Card withBorder padding="md" radius="md">
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <Text fw={600}>{source.name}</Text>
          <Badge color="teal.9" variant="light">
            {source.applied} appliquée(s)
          </Badge>
          {source.pending > 0 && (
            <Badge color="orange.9" variant="light">
              {source.pending} en attente
            </Badge>
          )}
          {source.failed > 0 && (
            <Badge color="red.9" variant="light">
              {source.failed} en échec
            </Badge>
          )}
        </Group>
      </Group>
      {entries.length === 0 ? (
        <Text c="dimmed" size="sm">
          Aucune migration dans cette origine.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={720}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Migration</Table.Th>
                <Table.Th>Statut</Table.Th>
                <Table.Th>Appliquée le</Table.Th>
                <Table.Th style={{ textAlign: "right" }}>Durée</Table.Th>
                <Table.Th>Par</Table.Th>
                <Table.Th>Déploiement</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((e) => {
                const s = STATUTS[e.status] ?? {
                  color: "gray" as MantineColor,
                  label: e.status,
                };
                return (
                  <Table.Tr key={`${source.name}:${e.tag}`}>
                    <Table.Td>
                      <Code>{e.tag}</Code>
                      {e.error !== undefined && (
                        // Le motif de l'échec, en toutes lettres : sans lui,
                        // l'écran dit « ça a raté » et l'exploitant va lire
                        // les journaux d'un pod pour une réponse déjà connue.
                        <Text size="xs" c="red" mt={4}>
                          {e.error}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge color={s.color} variant="light">
                        {s.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{dateOf(e.appliedAt)}</Text>
                    </Table.Td>
                    <Table.Td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {e.durationMs === undefined ? "—" : `${e.durationMs} ms`}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {e.appliedBy ?? "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" ff="monospace">
                        {e.runId ?? "—"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Card>
  );
}

/** Ce qui diverge entre la base et le schéma déclaré, nommé. */
function Divergence({ status }: { status: MigrationStatus }) {
  const d = status.divergence;
  if (!d) {
    return null;
  }
  const tables = d.missingTables ?? [];
  const blocking = d.blocking ?? [];
  const additive = d.additive ?? [];
  return (
    <Alert
      color="orange"
      variant="light"
      icon={<IconDatabaseExclamation size={18} />}
      title="La base ne correspond pas au schéma déclaré"
    >
      <Stack gap="xs">
        {tables.length > 0 && (
          <div>
            <Text size="sm" fw={600}>
              Tables absentes de la base
            </Text>
            <List size="sm">
              {tables.map((t) => (
                <List.Item key={t}>
                  <Code>{t}</Code>
                </List.Item>
              ))}
            </List>
          </div>
        )}
        {blocking.length > 0 && (
          <div>
            <Text size="sm" fw={600}>
              Colonnes manquantes qui bloquent
            </Text>
            <List size="sm">
              {blocking.map((c) => (
                <List.Item key={`${c.table}.${c.column}`}>
                  <Code>{`${c.table}.${c.column}`}</Code>
                  {c.reason !== undefined ? ` — ${c.reason}` : ""}
                </List.Item>
              ))}
            </List>
          </div>
        )}
        {additive.length > 0 && (
          <div>
            <Text size="sm" fw={600}>
              Colonnes manquantes rattrapables
            </Text>
            <List size="sm">
              {additive.map((c) => (
                <List.Item key={`${c.table}.${c.column}`}>
                  <Code>{`${c.table}.${c.column}`}</Code>
                </List.Item>
              ))}
            </List>
          </div>
        )}
      </Stack>
    </Alert>
  );
}

export const Migrations = observer(() => {
  const store = useStore();
  const notifications = useNotifications();
  const [connector, setConnector] = useState<string | null>(null);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [chargementPlan, setChargementPlan] = useState(false);
  const [application, setApplication] = useState(false);

  // 🔴 L'environnement décide de l'EXISTENCE du bouton, pas de son état
  // désactivé : un bouton grisé apprend qu'un geste existe là où il ne doit
  // pas exister. La garde qui compte, elle, vit dans le produit — le plan
  // d'administration refuse hors développement, quel que soit l'écran.
  const infoFetcher = useCallback(
    () => store.api.getAbsolute<KernelInfo>("/nodefony/kernel/api/info"),
    [store],
  );
  const info = useResource(infoFetcher);
  const enDeveloppement = info.data?.environment === "development";

  const ormsFetcher = useCallback(
    () => store.api.getAbsolute<OrmSummary[]>("/nodefony/orm/api/orms"),
    [store],
  );
  const orms = useResource(ormsFetcher);

  // Le connecteur affiché : celui qu'on a choisi, sinon `default` s'il existe,
  // sinon le premier. Jamais « le premier venu » en silence : le sélecteur
  // montre lequel est lu.
  const connectors = useMemo(() => orms.data ?? [], [orms.data]);
  const courant = useMemo(() => {
    if (connector !== null) {
      return connector;
    }
    const parDefaut = connectors.find((o) => o.default) ?? connectors[0];
    return parDefaut?.name ?? "default";
  }, [connector, connectors]);

  const statusFetcher = useCallback(
    () =>
      store.api.getAbsolute<MigrationReply>(
        `/nodefony/orm/api/migrations?connector=${encodeURIComponent(courant)}`,
      ),
    [store, courant],
  );
  const { data, loading, error, reload } = useResource(statusFetcher);

  const empechement = data !== null && isMigrationFailure(data) ? data : null;
  const status = data !== null && !isMigrationFailure(data) ? data : null;
  const verdict = status
    ? (VERDICTS[status.verdict] ?? {
        color: "gray" as MantineColor,
        label: status.verdict,
        icon: IconArrowsExchange,
      })
    : null;
  const VerdictIcon = verdict?.icon ?? IconArrowsExchange;

  const enAttente = (status?.sources ?? []).reduce((n, s) => n + s.pending, 0);

  /** Charge ce qui S'APPLIQUERAIT, et ouvre la confirmation dessus. */
  const ouvrirConfirmation = useCallback(async () => {
    setChargementPlan(true);
    try {
      const reply = await store.api.getAbsolute<MigrationPlanReply>(
        `/nodefony/orm/api/migrations/plan?connector=${encodeURIComponent(courant)}`,
      );
      if (isMigrationFailure(reply)) {
        notifications.notify("error", reply.error.summary, {
          title: reply.error.code,
          source: "api",
        });
        return;
      }
      setPlan(reply);
    } catch (e) {
      notifications.notify(
        "error",
        e instanceof Error ? e.message : "plan illisible",
        { source: "api" },
      );
    } finally {
      setChargementPlan(false);
    }
  }, [store, courant, notifications]);

  /** Applique — après confirmation, et seulement en développement. */
  const appliquer = useCallback(async () => {
    setApplication(true);
    try {
      const reply = await store.api.postAbsolute<MigrationApplyReply>(
        `/nodefony/orm/api/migrations/apply?connector=${encodeURIComponent(courant)}`,
        {},
      );
      if (isMigrationFailure(reply)) {
        // Le refus du produit est rendu TEL QUEL — c'est lui qui fait foi, y
        // compris quand l'écran croyait le geste permis.
        notifications.notify("error", reply.error.summary, {
          title: reply.error.code,
          source: "server",
        });
        return;
      }
      notifications.notify(
        "success",
        `${reply.applied.length} migration(s) appliquée(s) — passage ${reply.runId}`,
        { title: "Migrations appliquées", source: "server" },
      );
      setPlan(null);
      reload();
    } catch (e) {
      notifications.notify(
        "error",
        e instanceof Error ? e.message : "application impossible",
        { source: "api" },
      );
    } finally {
      setApplication(false);
    }
  }, [store, courant, notifications, reload]);

  return (
    <PageLayout
      title="Migrations"
      subtitle={
        status
          ? `Connecteur « ${status.connector} » — ${status.driver.dialect ?? status.driver.kind}, schéma en mode ${status.driver.ddl ?? "?"}`
          : "État du schéma de chaque base"
      }
      icon={<IconArrowsExchange size={22} />}
      actions={
        <Group gap="sm">
          <Select
            data={connectors.map((o) => ({
              value: o.name,
              label: o.connection?.driver
                ? `${o.name} (${o.connection.driver})`
                : o.name,
            }))}
            value={courant}
            onChange={setConnector}
            placeholder="Connecteur"
            aria-label="Connecteur observé"
            w={240}
            allowDeselect={false}
          />
          {enDeveloppement && enAttente > 0 && (
            <Button
              color="orange"
              leftSection={<IconPlayerPlay size={16} />}
              loading={chargementPlan}
              onClick={() => void ouvrirConfirmation()}
            >
              Appliquer ({enAttente})
            </Button>
          )}
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            loading={loading}
            onClick={reload}
          >
            Recharger
          </Button>
        </Group>
      }
    >
      <DataState
        loading={loading && data === null}
        error={error}
        onRetry={reload}
      >
        <Stack gap="lg">
          {empechement !== null && (
            // 🔴 L'empêchement se MONTRE. Le code sert aux scripts, la phrase
            // à l'humain, le « sens » évite la mauvaise correction, et les
            // gestes disent quoi taper — c'est exactement ce que la ligne de
            // commande aurait répondu.
            <Alert
              color="red"
              variant="light"
              icon={<IconAlertTriangle size={18} />}
              title={empechement.error.summary}
            >
              <Stack gap="sm">
                <Group gap="xs">
                  <Badge color="red" variant="outline">
                    {empechement.error.code}
                  </Badge>
                  <Text size="sm" c="dimmed">
                    connecteur « {empechement.connector} »
                  </Text>
                </Group>
                {empechement.error.meaning !== "" && (
                  <Text size="sm">{empechement.error.meaning}</Text>
                )}
                {empechement.error.nextActions.length > 0 && (
                  <Stack gap="xs">
                    <Text size="sm" fw={600}>
                      À faire
                    </Text>
                    {empechement.error.nextActions.map((a) => (
                      <Commande key={a.command} command={a.command} />
                    ))}
                  </Stack>
                )}
              </Stack>
            </Alert>
          )}

          {status !== null && verdict !== null && (
            <>
              <Card withBorder padding="md" radius="md">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Group gap="md" wrap="nowrap">
                    <ThemeIcon
                      color={verdict.color}
                      variant="light"
                      size={44}
                      radius="md"
                    >
                      <VerdictIcon size={24} />
                    </ThemeIcon>
                    <div>
                      <Group gap="xs">
                        <Text fw={700} size="lg">
                          {verdict.label}
                        </Text>
                        <Badge color={verdict.color} variant="light">
                          {status.verdict}
                        </Badge>
                        <DocHint
                          title="D'où vient ce verdict"
                          summary={`Cet écran affiche la réponse du plan d'administration pour « ${status.connector} » — le même objet que \`orm:migrate:status --json\`, sans aucun recalcul.`}
                          sections={[
                            {
                              label: "Pourquoi",
                              body: "Deux calculs de la même question finissent par se contredire : l'écran dirait vert pendant que la commande sortirait en 1, et c'est le jour d'un incident qu'on s'en apercevrait.",
                            },
                            {
                              label: "Si vide",
                              body: "Un connecteur qui ne porte pas de migrations, ou une base injoignable, s'affiche en empêchement NOMMÉ — jamais en tableau vide.",
                            },
                          ]}
                        />
                      </Group>
                      <Text size="sm" c="dimmed" mt={4}>
                        {status.summary}
                      </Text>
                    </div>
                  </Group>
                </Group>
                <Divider my="md" />
                {/* Label AU-DESSUS de la valeur : quatre paires côte à côte
                    sur une seule ligne se lisent comme une phrase continue —
                    « Connecteur default Dialecte sqlite … » — et l'œil ne sait
                    plus ce qui est étiquette et ce qui est valeur. */}
                <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="lg">
                  <Fait label="Connecteur" valeur={status.connector} />
                  <Fait
                    label="Dialecte"
                    valeur={status.driver.dialect ?? status.driver.kind}
                  />
                  <Fait
                    label="Mode de schéma"
                    valeur={status.driver.ddl ?? "—"}
                  />
                  <Fait
                    label="Table d'historique"
                    valeur={status.driver.historyTable ?? "—"}
                  />
                </SimpleGrid>
              </Card>

              <Divergence status={status} />

              {status.nextActions.length > 0 && (
                <Card withBorder padding="md" radius="md">
                  <Group gap="xs" mb="sm">
                    <Text fw={600}>À faire</Text>
                    <WarnHint
                      title="L'écran enseigne la ligne de commande"
                      summary="Ces commandes sont celles que le produit propose, telles qu'elles se tapent. C'est la ligne de commande qui tourne dans un travail de déploiement — pas un clic dans une console d'administration."
                    />
                  </Group>
                  <Stack gap="xs">
                    {status.nextActions.map((a) => (
                      <Commande key={a.command} command={a.command} />
                    ))}
                  </Stack>
                </Card>
              )}

              {status.sources.map((s) => (
                <SourceTable key={s.name} source={s} />
              ))}
            </>
          )}
        </Stack>
      </DataState>
      <Modal
        opened={plan !== null}
        onClose={() => setPlan(null)}
        title="Appliquer les migrations en attente"
        size="lg"
      >
        {plan !== null && (
          <Stack gap="md">
            <Alert
              color="orange"
              variant="light"
              icon={<IconAlertTriangle size={18} />}
            >
              Ce geste modifie le schéma de « {plan.connector} ». Il n'existe
              qu'en développement : en production, les migrations s'appliquent
              dans un travail d'orchestrateur qui se termine AVANT que le
              premier nouvel exemplaire ne démarre.
            </Alert>
            {/* On ne confirme pas une modification de schéma sur une promesse :
                les instructions qui vont être exécutées sont montrées. */}
            <ScrollArea.Autosize mah={360}>
              <Stack gap="sm">
                {plan.pending.map((m) => (
                  <div key={`${m.source}:${m.tag}`}>
                    <Group gap="xs" mb={4}>
                      <Badge variant="light">{m.source}</Badge>
                      <Code>{m.tag}</Code>
                    </Group>
                    <Code block style={{ whiteSpace: "pre-wrap" }}>
                      {m.statements.join(";\n\n")}
                    </Code>
                  </div>
                ))}
              </Stack>
            </ScrollArea.Autosize>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPlan(null)}>
                Annuler
              </Button>
              <Button
                color="orange"
                loading={application}
                leftSection={
                  application ? (
                    <Loader size={14} />
                  ) : (
                    <IconPlayerPlay size={16} />
                  )
                }
                onClick={() => void appliquer()}
              >
                Appliquer {plan.pending.length} migration(s)
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </PageLayout>
  );
});
