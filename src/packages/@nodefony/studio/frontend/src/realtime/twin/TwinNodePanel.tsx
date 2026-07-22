import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBolt,
  IconBook,
  IconDatabase,
} from "@tabler/icons-react";
import {
  KeyValue,
  DefinitionList,
  DocHint,
  WarnHint,
} from "../../components/ui";
import "../../workspace/widgets"; // side-effect : peuple le registre de blocs
import { BlockView, getBlock } from "../../blocks";
import type { NormalizedHealth } from "../../utils/realtimeHealth";
import { useTwinLive } from "./twinLive";
import {
  ARCH_NODE_INFO,
  useRecentLogActivity,
  type ArchNodeId,
  type LogPulse,
} from "./twinArchitecture";
import type { ConnectorRow, KernelInfo } from "./useTwinTopology";

/* ════════════════════════════════════════════════════════════════════════
 * TwinNodePanel — la boîte ⓘ (dialog d'EXPLICATIONS) du Jumeau.
 *
 * Ouverte par l'icône ⓘ d'une brique. Montre ce qui s'y passe en direct +
 * une section « Liens & docs » (emplacement des futurs extraits de doc ciblés
 * tirés du portail `/nodefony/documentation`). Gère les briques d'archi
 * (ArchNodeId) ET les connecteurs réels (`conn-<name>`).
 * ════════════════════════════════════════════════════════════════════════ */

function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
function fmtBytes(n: number | undefined): string {
  if (!n) return "—";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}
function fmtUptime(s: number | undefined): string {
  if (!s) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h${m}` : `${h}h`;
}
function sevColor(s: string): string {
  if (/(emerg|alert|crit|error|err)/.test(s)) return "red";
  if (/warn/.test(s)) return "yellow";
  if (/(notice|info)/.test(s)) return "blue";
  return "gray";
}
function vendorColor(vendor: string): string {
  const v = vendor.toLowerCase();
  if (v.includes("drizzle")) return "lime";
  if (v.includes("mongoose")) return "green";
  return "teal";
}

/** Bouton de forage vers une page Studio (ferme le dialog avant de naviguer). */
function GoTo({
  href,
  label,
  icon,
  onClose,
}: {
  href: string;
  label: string;
  icon?: ReactNode;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  return (
    <Button
      variant="light"
      size="xs"
      leftSection={icon}
      rightSection={icon ? undefined : <IconArrowRight size={14} />}
      onClick={() => {
        onClose();
        navigate(href);
      }}
    >
      {label}
    </Button>
  );
}

/* ─── Panneaux par métier ─────────────────────────────────────────────────── */

function HttpPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { count, recent } = useRecentLogActivity();
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Badge
          color={count > 0 ? "teal" : "gray"}
          variant="light"
          leftSection={<IconBolt size={12} />}
        >
          {count} événement(s) / 8 s
        </Badge>
      </Group>
      <Text size="sm" fw={600}>
        Requêtes récentes
      </Text>
      <Text size="xs" c="dimmed">
        Chaque ligne porte son <Code>requestId</Code> — cliquez-le pour suivre
        la requête de bout en bout.
      </Text>
      <ScrollArea.Autosize mah={300}>
        <Stack gap={6}>
          {recent.length === 0 ? (
            <Text size="sm" c="dimmed">
              En attente d'activité… (le trafic arrive ici en direct)
            </Text>
          ) : (
            recent.map((l: LogPulse, i: number) => (
              <Group
                key={`${l.requestId ?? "x"}-${i}`}
                gap={6}
                wrap="nowrap"
                align="flex-start"
              >
                <Badge
                  size="xs"
                  color={sevColor(l.severity)}
                  variant="light"
                  style={{ flexShrink: 0 }}
                >
                  {l.severity}
                </Badge>
                {l.requestId ? (
                  <Code
                    style={{ cursor: "pointer", flexShrink: 0 }}
                    onClick={() => {
                      onClose();
                      navigate(
                        `/nodefony/logs/trace/${encodeURIComponent(l.requestId as string)}`,
                      );
                    }}
                  >
                    {l.requestId.slice(0, 8)}
                  </Code>
                ) : (
                  <Code c="dimmed" style={{ flexShrink: 0 }}>
                    —
                  </Code>
                )}
                <Text size="xs" lineClamp={2} style={{ minWidth: 0 }}>
                  {l.message || (
                    <span style={{ opacity: 0.5 }}>(sans message)</span>
                  )}
                </Text>
              </Group>
            ))
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}

function WsPanel({
  totals,
}: {
  totals: NormalizedHealth["totals"] | undefined;
}) {
  return (
    <Stack gap="sm">
      <DefinitionList>
        <KeyValue k="Connexions WS" v={fmt(totals?.connectionCount)} />
        <KeyValue k="Canaux abonnés" v={fmt(totals?.channelCount)} />
        <KeyValue k="Messages émis" v={fmt(totals?.messagesSentTotal)} />
        <KeyValue k="Octets émis" v={fmtBytes(totals?.bytesSentTotal)} />
        <KeyValue k="Entrants (inbound)" v={fmt(totals?.inboundTotal)} />
      </DefinitionList>
      <Text size="xs" c="dimmed">
        Le WebSocket est full-duplex : il alimente le Realtime Hub (la Socket
        Nodefony) qui fan-out vers les abonnés.
      </Text>
    </Stack>
  );
}

function KernelPanel({ info }: { info: KernelInfo | null }) {
  return (
    <Stack gap="sm">
      <DefinitionList>
        <KeyValue k="Version" v={info?.version ?? "—"} mono />
        <KeyValue k="Environnement" v={info?.environment ?? "—"} />
        <KeyValue k="Uptime" v={fmtUptime(info?.uptime)} />
        <KeyValue k="PID" v={info ? String(info.pid) : "—"} mono />
        <KeyValue k="Node" v={info?.node ?? "—"} mono />
        <KeyValue k="Modules chargés" v={fmt(info?.modules)} />
        {info?.git?.branch ? (
          <KeyValue
            k="Git"
            v={`${info.git.branch} · ${info.git.commit ?? ""}`}
            mono
          />
        ) : null}
      </DefinitionList>
      <Text size="xs" c="dimmed">
        Le kernel route chaque requête vers son controller, orchestre le boot et
        héberge les services (DI).
      </Text>
    </Stack>
  );
}

function OrmPanel({
  totals,
}: {
  totals: NormalizedHealth["totals"] | undefined;
}) {
  const orm = totals?.orm;
  if (!orm) {
    return (
      <Text size="sm" c="dimmed">
        Aucun flux ORM remonté. En production, activez la sonde de flux (
        <Code>NODEFONY_ORM_FLOW=1</Code>).
      </Text>
    );
  }
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Badge color={orm.connected > 0 ? "teal" : "red"} variant="light">
          {orm.connected}/{orm.connectors} connecteur(s)
        </Badge>
      </Group>
      <DefinitionList>
        <KeyValue k="Requêtes (total)" v={fmt(orm.queryTotal)} />
        <KeyValue k="Lentes" v={fmt(orm.slowTotal)} />
        <KeyValue k="Erreurs" v={fmt(orm.errorTotal)} />
        <KeyValue k="Reconnexions" v={fmt(orm.reconnectTotal)} />
        <KeyValue
          k="Latence EWMA max"
          v={orm.maxEwmaMs != null ? `${orm.maxEwmaMs.toFixed(2)} ms` : "—"}
        />
      </DefinitionList>
      <Text size="xs" c="dimmed">
        Le pipeline touche l'ORM pour chaque requête base ; les connecteurs
        portent les connexions réelles aux bases.
      </Text>
    </Stack>
  );
}

function ConnectorPanel({ connector }: { connector: ConnectorRow }) {
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Badge color={connector.connected ? "teal" : "red"} variant="light">
          {connector.connected ? "connecté" : "déconnecté"}
        </Badge>
        <Badge color={vendorColor(connector.vendor)} variant="light">
          {connector.vendor}
        </Badge>
      </Group>
      <DefinitionList>
        <KeyValue k="Nom" v={connector.name} mono />
        <KeyValue k="Driver" v={connector.driver} mono />
        <KeyValue k="Cible" v={connector.target} mono />
        <KeyValue k="Version" v={connector.version} mono />
      </DefinitionList>
      <Text size="xs" c="dimmed">
        Connecteur de base géré par l'ORM <b>{connector.vendor}</b> via le
        driver <Code>{connector.driver}</Code>.
      </Text>
    </Stack>
  );
}

function RealtimePanel({ norm }: { norm: NormalizedHealth | null }) {
  const totals = norm?.totals;
  const chans = useMemo(() => {
    const m = new Map<string, { subscribers: number; messages: number }>();
    for (const inst of norm?.instances ?? []) {
      for (const c of inst.channels) {
        const e = m.get(c.channel) ?? { subscribers: 0, messages: 0 };
        e.subscribers += c.subscribers;
        e.messages += c.messages;
        m.set(c.channel, e);
      }
    }
    return [...m.entries()].sort((a, b) => b[1].messages - a[1].messages);
  }, [norm]);
  return (
    <Stack gap="sm">
      <DefinitionList>
        <KeyValue k="Canaux actifs" v={fmt(totals?.channelCount)} />
        <KeyValue k="Fan-out (total)" v={fmt(totals?.fanoutTotal)} />
        <KeyValue k="Connexions" v={fmt(totals?.connectionCount)} />
        <KeyValue
          k="Backpressure"
          v={`${fmtBytes(totals?.backpressure.totalBufferedAmount)} · ${totals?.backpressure.slowConsumers ?? 0} lents`}
        />
      </DefinitionList>
      <Text size="sm" fw={600}>
        Canaux ({chans.length})
      </Text>
      <ScrollArea.Autosize mah={220}>
        <Stack gap={4}>
          {chans.map(([name, s]) => (
            <Group key={name} justify="space-between" gap="xs" wrap="nowrap">
              <Code style={{ minWidth: 0 }}>{name}</Code>
              <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                <Badge size="xs" variant="light" color="grape">
                  {s.subscribers} ab.
                </Badge>
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {fmt(s.messages)} msg
                </Text>
              </Group>
            </Group>
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}

/** Version des fiches d'aide du fond de panier realtime (badge des bulles). */
const BP_DOC = "v1.0";

/**
 * Pages du portail de documentation vers lesquelles renvoient les fiches d'aide.
 * Le portail adresse une page par son slug (`mod~<module>~<fichier>`) — écrire
 * l'URL ici plutôt qu'un chemin de fichier garde le lien valide même si la page
 * est déplacée dans l'arborescence du module.
 */
const DOC_CONFIGURATION =
  "/nodefony/documentation?doc=mod~realtime~configuration";
const DOC_SECURITE = "/nodefony/documentation?doc=mod~realtime~securite";

/** Libellé + fiche d'aide d'une ligne du panneau (la clé de `KeyValue`). */
function LabelWithHint({ label, hint }: { label: string; hint: ReactNode }) {
  return (
    <Group gap={6} wrap="nowrap">
      <span>{label}</span>
      {hint}
    </Group>
  );
}

function BpRealtimePanel({
  norm,
  cluster,
}: {
  norm: NormalizedHealth | null;
  cluster: boolean;
}) {
  const bp = norm?.instances[0]?.backplane;
  const rejets = norm?.totals?.ingressRejectedTotal ?? 0;
  const driver = bp?.driver ?? (cluster ? "ipc" : "loopback");
  const canal = bp?.channel;
  // Le scellement ne se pose que sur un transport PARTAGÉ : en mono-process ou
  // en IPC (maître ↔ ses propres workers), aucun tiers ne peut écrire sur le bus.
  const busPartage = bp?.crossPod === true;
  const scelle = bp?.sealed === true;
  // File d'envoi : seuls les transports réseau en ont une (acquittement
  // asynchrone). Absente en mono-processus et sur le lien maître ↔ workers.
  const file = bp?.queue;
  const perdues = file?.droppedTotal ?? 0;

  return (
    <Stack gap="sm">
      <DefinitionList>
        <KeyValue
          k={
            <LabelWithHint
              label="Driver"
              hint={
                <DocHint
                  title="Le fil qui relie les processus"
                  version={BP_DOC}
                  summary={`Ce processus relaie ses publications par « ${driver} ». Sans fil, un message publié ici n'atteindrait que les navigateurs connectés à CE processus.`}
                  sections={[
                    {
                      label: "Les trois fils natifs",
                      body: "« loopback » : aucun relais, un seul processus. « cluster » : liaison interne entre les workers d'une même machine. « redis » : publication/abonnement entre machines distinctes.",
                    },
                    {
                      label: "Si la valeur surprend",
                      body: "Le fil se choisit à la configuration (`backplane.driver`) et peut être imposé au déploiement par NF_REALTIME_DRIVER. Un nom inconnu au démarrage laisse le hub local, avec un avertissement dans le journal.",
                    },
                  ]}
                  links={[
                    {
                      label: "Configuration du temps réel",
                      href: DOC_CONFIGURATION,
                    },
                  ]}
                />
              }
            />
          }
          v={driver}
          mono
        />
        <KeyValue k="Portée" v={bp?.kind ?? (cluster ? "cluster" : "local")} />
        <KeyValue
          k={
            <LabelWithHint
              label="Cross-pod"
              hint={
                <DocHint
                  title="Jusqu'où porte le relais"
                  version={BP_DOC}
                  summary={
                    busPartage
                      ? "Oui : le relais franchit les frontières de machine — d'autres hôtes reçoivent ce qui est publié ici."
                      : "Non : le relais ne sort pas de cette machine (un seul processus, ou des workers locaux)."
                  }
                  sections={[
                    {
                      label: "Pourquoi ça change tout",
                      body: "Un relais qui sort de la machine passe par une infrastructure partagée, que d'autres peuvent atteindre. C'est là que le scellement des messages devient nécessaire — et c'est pourquoi il n'est pas demandé sur une liaison interne.",
                    },
                  ]}
                  links={[
                    {
                      label: "Architecture du temps réel",
                      href: DOC_CONFIGURATION,
                    },
                  ]}
                />
              }
            />
          }
          v={busPartage ? "oui" : "non"}
        />
        {canal ? (
          <KeyValue
            k={
              <LabelWithHint
                label="Canal"
                hint={
                  <DocHint
                    title="Sur quel bus ce processus est branché"
                    version={BP_DOC}
                    summary={`Le transport publie et écoute sur « ${canal} ». Tout ce qui passe par ce nom est reçu par tous les processus qui l'écoutent, et par eux seuls.`}
                    sections={[
                      {
                        label: "À quoi ça sert de le voir",
                        body: "C'est la seule façon de répondre à « suis-je sur le bus que je crois ? ». Deux déploiements d'une même application (préproduction et production) qui partagent une infrastructure portent le même nom dérivé : sans cloison explicite, ils s'échangent leurs diffusions.",
                      },
                      {
                        label: "Comment le changer",
                        body: "Par la cloison `backplane.namespace`, ou au déploiement par NF_REALTIME_BACKPLANE_NAMESPACE. Le nom affiché ici est celui réellement utilisé, pas celui qui est écrit dans la configuration.",
                      },
                    ]}
                    links={[
                      {
                        label: "La cloison, clé par clé",
                        href: DOC_CONFIGURATION,
                      },
                      {
                        label: "Ce que le bus ne défend pas",
                        href: DOC_SECURITE,
                      },
                    ]}
                  />
                }
              />
            }
            v={canal}
            mono
          />
        ) : null}
        {busPartage ? (
          <KeyValue
            k={
              <LabelWithHint
                label="Messages scellés"
                hint={
                  scelle ? (
                    <DocHint
                      title="Les messages portent une signature"
                      version={BP_DOC}
                      summary="Chaque message publié sur ce bus est signé, et ce processus rejette tout message dont la signature est absente ou fausse."
                      sections={[
                        {
                          label: "Ce que ça empêche",
                          body: "Une infrastructure de diffusion ne vérifie pas qui publie. Sans signature, quiconque peut y écrire — autre application, identifiant fuité — diffuse ce qu'il veut sur vos canaux, sur tous vos processus à la fois.",
                        },
                        {
                          label: "La condition",
                          body: "Le secret doit être IDENTIQUE sur tous les processus de l'application. S'il diverge, plus rien ne passe entre eux et le compteur de messages refusés reste à zéro : le trafic est écarté avant même l'examen du canal.",
                        },
                      ]}
                      links={[
                        { label: "Sécurité du temps réel", href: DOC_SECURITE },
                        {
                          label: "Poser le secret",
                          href: DOC_CONFIGURATION,
                        },
                      ]}
                    />
                  ) : (
                    <WarnHint
                      title="Bus ouvert — aucune signature"
                      summary="Les messages circulent sans preuve d'origine : quiconque peut écrire sur cette infrastructure publie sur vos canaux, sur tous vos processus."
                      sections={[
                        {
                          label: "Ce qui reste protégé",
                          body: "Les canaux internes (journaux, audit, santé) restent hors d'atteinte : seuls les canaux explicitement diffusables sont acceptés depuis le bus. L'injection est donc bornée aux canaux applicatifs.",
                        },
                        {
                          label: "Comment fermer",
                          body: "Poser `backplane.secret`, ou NF_REALTIME_BACKPLANE_SECRET au déploiement — au moins 32 caractères, le même partout. Le démarrage signale ce mode ouvert par un avertissement.",
                        },
                      ]}
                    />
                  )
                }
              />
            }
            v={scelle ? "oui" : "NON — bus ouvert"}
          />
        ) : null}
        <KeyValue
          k={
            <LabelWithHint
              label="Messages du bus refusés"
              hint={
                <DocHint
                  title="Messages venus du bus et jetés"
                  version={BP_DOC}
                  summary={
                    rejets === 0
                      ? "Zéro : aucun message étranger n'a tenté d'atteindre un canal interdit de circulation. C'est la valeur normale."
                      : `${rejets} message(s) reçus du bus visaient un canal qui n'a pas le droit de circuler entre processus. Ils ont été comptés puis jetés.`
                  }
                  sections={[
                    {
                      label: "Ce qui est refusé",
                      body: "Un canal ne franchit la frontière du processus que s'il est déclaré diffusable. Les canaux internes — journaux, audit, santé — décrivent CE processus : les faire voyager n'aurait aucun sens, et permettrait d'y injecter de fausses lignes.",
                    },
                    {
                      label: "Si ce n'est pas zéro",
                      body: "Deux explications. Bénigne : une autre application partage la même cloison et ses canaux sont refusés — chacun chez soi. Sérieuse : quelqu'un écrit sur votre bus. Le nom du canal visé n'est pas exposé ici, volontairement : un compteur ne doit pas devenir un moyen de sonder ce que le système accepte.",
                    },
                    {
                      label: "Ce que ce compteur ne voit pas",
                      body: "Les messages rejetés PLUS TÔT, faute de signature valide, ne sont pas comptés ici : ils sont écartés par le transport avant d'atteindre le hub.",
                    },
                  ]}
                  links={[
                    { label: "Sécurité du temps réel", href: DOC_SECURITE },
                  ]}
                />
              }
            />
          }
          v={fmt(rejets)}
        />
        {file ? (
          <KeyValue
            k={
              <LabelWithHint
                label="File d'envoi vers le bus"
                hint={
                  perdues === 0 ? (
                    <DocHint
                      title="Ce qui attend d'être remis au bus"
                      version={BP_DOC}
                      summary={`${fmtBytes(file.bytes)} en attente d'accusé de réception. Au-delà de ${fmtBytes(file.maxBytes)}, les publications suivantes sont abandonnées plutôt que de s'empiler.`}
                      sections={[
                        {
                          label: "Pourquoi une limite",
                          body: "Publier n'attend pas : le message est confié au bus et le code continue. Si le bus ralentit, les messages s'accumulent en mémoire — sans plafond, une rafale peut faire enfler le processus jusqu'à l'étouffement.",
                        },
                        {
                          label: "Ce qui se passe à la limite",
                          body: "Les publications sont abandonnées et comptées ici : le processus reste debout, mais les autres processus ne reçoivent pas ces messages-là. Les pages connectées se resynchronisent d'elles-mêmes à la reprise.",
                        },
                        {
                          label: "Régler le plafond",
                          body: "Par `backplane.maxQueueBytes`. La valeur 0 lève toute limite — la mémoire n'est alors plus protégée du tout.",
                        },
                      ]}
                      links={[
                        { label: "Configuration", href: DOC_CONFIGURATION },
                      ]}
                    />
                  ) : (
                    <WarnHint
                      title="Le bus n'a pas suivi — des messages ont été abandonnés"
                      summary={`${perdues} publication(s) n'ont pas été remises aux autres processus : la file avait atteint son plafond de ${fmtBytes(file.maxBytes)}.`}
                      sections={[
                        {
                          label: "Ce que ça veut dire",
                          body: "Le bus n'accuse plus réception assez vite : soit il est lent ou injoignable, soit cette application publie plus que le lien ne peut porter. La mémoire du processus a été préservée au prix de ces messages.",
                        },
                        {
                          label: "Quoi regarder",
                          body: "L'état du serveur de bus et sa latence d'abord ; le volume publié ensuite. Relever le plafond ne fait que retarder le problème si le bus reste en retard.",
                        },
                      ]}
                    />
                  )
                }
              />
            }
            v={
              perdues === 0
                ? `${fmtBytes(file.bytes)} en attente`
                : `${fmt(perdues)} abandonnée(s)`
            }
          />
        ) : null}
      </DefinitionList>
      <Text size="xs" c="dimmed">
        Le fond de panier relie les processus : un message publié sur l'un est
        relayé aux autres. Survolez un libellé pour savoir ce qu'il décrit.
      </Text>
    </Stack>
  );
}

function BpLogsPanel({ info }: { info: KernelInfo | null }) {
  const log = info?.backplanes?.log;
  return (
    <Stack gap="sm">
      <DefinitionList>
        <KeyValue k="Driver" v={log?.driver ?? "—"} mono />
        <KeyValue k="Sortie (sink)" v={log?.sink ?? "—"} mono />
      </DefinitionList>
      <Text size="xs" c="dimmed">
        Le backplane de logs collecte chaque Pdu et le diffuse (console,
        fichier, Loki, OpenSearch…) sans coupler le code à la destination.{" "}
        <Code>syslog:stream</Code> en est la prise temps réel.
      </Text>
    </Stack>
  );
}

/* ─── Métadonnées + contenu d'un nœud ─────────────────────────────────────── */

interface NodeMeta {
  title: string;
  color: string;
  icon: () => ReactNode;
  href: string;
}

function metaOf(nodeId: string, connectors: ConnectorRow[]): NodeMeta | null {
  if (nodeId.startsWith("conn-")) {
    const c = connectors.find((x) => `conn-${x.name}` === nodeId);
    if (!c) return null;
    return {
      title: c.name,
      color: vendorColor(c.vendor),
      icon: () => <IconDatabase size={20} />,
      href: "/nodefony/orm",
    };
  }
  if (nodeId in ARCH_NODE_INFO) return ARCH_NODE_INFO[nodeId as ArchNodeId];
  return null;
}

/** Contenu live d'un nœud — abonné `realtime:health` tant que le dialog est ouvert. */
function PanelContent({
  nodeId,
  info,
  connectors,
  onClose,
}: {
  nodeId: string;
  info: KernelInfo | null;
  connectors: ConnectorRow[];
  onClose: () => void;
}) {
  const live = useTwinLive();
  const norm = live.normalized;
  const totals = norm?.totals;

  if (nodeId.startsWith("conn-")) {
    const c = connectors.find((x) => `conn-${x.name}` === nodeId);
    return c ? <ConnectorPanel connector={c} /> : null;
  }
  switch (nodeId as ArchNodeId) {
    case "http":
      return <HttpPanel onClose={onClose} />;
    case "ws":
      return <WsPanel totals={totals} />;
    case "kernel":
      return <KernelPanel info={info} />;
    case "orm":
    case "connectors":
      return <OrmPanel totals={totals} />;
    case "realtime": {
      // PREUVE de la généricité : le dialog monte le MÊME bloc que le bureau.
      const def = getBlock("realtime.hub");
      if (def) {
        return (
          <BlockView
            def={def}
            ctx={{
              live: true,
              cluster: !!norm?.cluster,
              instanceCount: norm?.instances.length ?? 1,
              roles: [],
            }}
            container="dialog"
          />
        );
      }
      return <RealtimePanel norm={norm} />;
    }
    case "bp-realtime":
      return (
        <BpRealtimePanel norm={norm} cluster={!!info?.cluster?.isCluster} />
      );
    case "bp-logs": {
      // Le MÊME bloc « Log Backplane » qu'au bureau (tuiles lecture/écriture/temps réel).
      const def = getBlock("logs.backplane");
      if (def) {
        return (
          <BlockView
            def={def}
            ctx={{
              live: false,
              cluster: !!norm?.cluster,
              instanceCount: norm?.instances.length ?? 1,
              roles: [],
            }}
            container="dialog"
          />
        );
      }
      return <BpLogsPanel info={info} />;
    }
    default:
      return null;
  }
}

export interface TwinNodePanelProps {
  nodeId: string | null;
  info: KernelInfo | null;
  connectors: ConnectorRow[];
  onClose: () => void;
}

/** Boîte ⓘ — dialog « explications » d'une brique du Jumeau. */
export function TwinNodePanel({
  nodeId,
  info,
  connectors,
  onClose,
}: TwinNodePanelProps) {
  const meta = nodeId ? metaOf(nodeId, connectors) : null;
  return (
    <Modal
      opened={nodeId !== null && meta !== null}
      onClose={onClose}
      size="lg"
      centered
      radius="md"
      title={
        meta ? (
          <Group gap="xs">
            <ThemeIcon variant="light" color={meta.color} radius="md">
              {meta.icon()}
            </ThemeIcon>
            <Text fw={700}>{meta.title}</Text>
            <Badge size="xs" color="teal" variant="dot">
              en direct
            </Badge>
          </Group>
        ) : null
      }
    >
      {nodeId && meta ? (
        <Stack gap="sm">
          <PanelContent
            nodeId={nodeId}
            info={info}
            connectors={connectors}
            onClose={onClose}
          />
          <Divider my={4} label="Liens & docs" labelPosition="left" />
          <Group gap="xs">
            <GoTo href={meta.href} label="Page dédiée" onClose={onClose} />
            <GoTo
              href="/nodefony/documentation"
              label="Documentation"
              icon={<IconBook size={14} />}
              onClose={onClose}
            />
          </Group>
          <Text size="10px" c="dimmed">
            Bientôt : extraits de doc ciblés tirés du portail, directement ici.
          </Text>
        </Stack>
      ) : null}
    </Modal>
  );
}

export default TwinNodePanel;
