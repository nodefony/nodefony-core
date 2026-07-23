/**
 * Onglet « Flux & transport » — les FONDS DE PANIER de l'application.
 *
 * Parti pris de rédaction : la page s'adresse à quelqu'un qui ne connaît pas le
 * vocabulaire (« backplane », « fan-out », « sceau »). Chaque mot technique est
 * donc introduit par ce qu'il FAIT, jamais l'inverse, et l'écran répond à trois
 * questions concrètes plutôt que d'afficher des champs de sonde :
 *
 *   1. Quand un serveur publie un message, les autres le reçoivent-ils ?
 *   2. Les messages qui arrivent des autres serveurs sont-ils vérifiés ?
 *   3. En perd-on en route ?
 *
 * Données : `/kernel/api/info` (logs) + `/realtime/api/health` (socket), lues via le
 * miroir partagé `utils/realtimeHealth` (cluster-aware) — jamais une copie locale.
 */
import { observer } from "mobx-react-lite";
import { useCallback } from "react";
import {
  Stack,
  Grid,
  Group,
  Alert,
  Text,
  Card,
  Badge,
  Progress,
  Code,
  List,
  Divider,
} from "@mantine/core";
import {
  IconInfoCircle,
  IconFileText,
  IconBroadcast,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import { DocHint, TipHint } from "../../components/ui";
import { normalize, type HealthPayload } from "../../utils/realtimeHealth";
import type { InstanceHealth } from "../../utils/realtimeHealth";
import {
  KERNEL_INFO_ENDPOINT,
  REALTIME_HEALTH_ENDPOINT,
  type Infra,
  type KernelInfoPartial,
  type LogBackplane,
} from "./storesModel";

interface TransportData {
  log: LogBackplane | null;
  rt: InstanceHealth | null;
  cluster: boolean;
  instances: number;
  publishTotal: number;
  fanoutTotal: number;
}

/** Octets → unité lisible (une file se lit en Ko/Mo, pas en chiffres bruts). */
function bytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

/* ── Schémas ────────────────────────────────────────────────────────────────
   Dessinés à leur taille NATURELLE (480 × 96) puis contraints par `maxWidth` :
   les textes gardent une taille lisible au lieu d'être étirés depuis un dessin
   minuscule. Les deux schémas partagent la même grammaire — source à gauche,
   passage au centre, destination à droite (NN/g #4) : seule la forme du centre
   change, et c'est elle qui porte toute la différence entre les deux fonds de
   panier. Couleurs lues du thème → correctes en clair comme en sombre. */

const INK = "currentColor";
const DIM = "var(--mantine-color-dimmed)";
const SURFACE = "var(--mantine-color-default)";
const BORDER = "var(--mantine-color-default-border)";

const svgStyle = { width: "100%", maxWidth: 480, height: "auto" } as const;

/** Boîte étiquetée, avec sous-titre optionnel. */
function Node({
  x,
  y,
  w,
  h,
  label,
  sub,
  stroke = BORDER,
  fill = SURFACE,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub?: string;
  stroke?: string;
  fill?: string;
}) {
  const cx = x + w / 2;
  return (
    <>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
      />
      <text
        x={cx}
        y={sub ? y + h / 2 - 1 : y + h / 2 + 4}
        textAnchor="middle"
        fontSize={13}
        fill={INK}
      >
        {label}
      </text>
      {sub && (
        <text
          x={cx}
          y={y + h / 2 + 14}
          textAnchor="middle"
          fontSize={11}
          fill={DIM}
        >
          {sub}
        </text>
      )}
    </>
  );
}

/** Flèche droite (horizontale ou oblique), pointe nette. */
function Arrow({
  from,
  to,
  color,
  dashed,
}: {
  from: [number, number];
  to: [number, number];
  color: string;
  dashed?: boolean;
}) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const hx = x2 - Math.cos(angle) * 9;
  const hy = y2 - Math.sin(angle) * 9;
  const wing = 4.5;
  return (
    <>
      <line
        x1={x1}
        y1={y1}
        x2={hx}
        y2={hy}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray={dashed ? "5 4" : undefined}
      />
      {!dashed && (
        <polygon
          points={[
            `${x2},${y2}`,
            `${hx - Math.sin(angle) * wing},${hy + Math.cos(angle) * wing}`,
            `${hx + Math.sin(angle) * wing},${hy - Math.cos(angle) * wing}`,
          ].join(" ")}
          fill={color}
        />
      )}
    </>
  );
}

/**
 * TEMPS RÉEL — le message traverse : serveur → passage → serveur. Le centre est
 * un passage, pas un dépôt : rien ne s'y accumule.
 */
function RealtimeDiagram({
  connected,
  driver,
}: {
  connected: boolean;
  driver: string;
}) {
  const c = connected
    ? "var(--mantine-color-teal-6)"
    : "var(--mantine-color-orange-6)";
  const tint = connected
    ? "var(--mantine-color-teal-light)"
    : "var(--mantine-color-orange-light)";
  return (
    <svg
      viewBox="0 0 480 96"
      style={svgStyle}
      role="img"
      aria-label={
        connected
          ? `Un message publié sur le serveur 1 traverse le fond de panier ${driver} et atteint les clients du serveur 2. Rien n'est conservé au passage.`
          : `Le fond de panier ${driver} ne relie pas les serveurs : un message publié sur le serveur 1 n'atteint jamais le serveur 2.`
      }
    >
      <Node x={0} y={16} w={130} h={48} label="Serveur 1" sub="publie" />
      <Arrow from={[130, 40]} to={[175, 40]} color={c} />
      <Node
        x={175}
        y={16}
        w={130}
        h={48}
        label={driver}
        sub="passage"
        stroke={c}
        fill={tint}
      />
      <Arrow from={[305, 40]} to={[350, 40]} color={c} dashed={!connected} />
      <Node x={350} y={16} w={130} h={48} label="Serveur 2" sub="ses clients" />
      {!connected && (
        <text x={327} y={30} textAnchor="middle" fontSize={14} fill={c}>
          ✕
        </text>
      )}
      <text x={240} y={88} textAnchor="middle" fontSize={11} fill={DIM}>
        le message passe, puis disparaît — rien n'est gardé
      </text>
    </svg>
  );
}

/**
 * JOURNAUX — le flux s'accumule : les serveurs écrivent dans une destination qui
 * GARDE (cylindre), la console vient y relire. Le cylindre est dessiné en trois
 * primitives (deux ellipses + un corps) plutôt qu'en `path` : bords nets.
 */
function LogsDiagram({ driver }: { driver: string }) {
  const c = "var(--mantine-color-blue-6)";
  const tint = "var(--mantine-color-blue-light)";
  const cx = 240;
  const rx = 56;
  const top = 18;
  const bottom = 62;
  return (
    <svg
      viewBox="0 0 480 96"
      style={svgStyle}
      role="img"
      aria-label={`Les serveurs écrivent leurs journaux dans ${driver}, qui les conserve ; la console vient les relire ensuite.`}
    >
      <Node x={0} y={4} w={130} h={30} label="Serveur 1" />
      <Node x={0} y={46} w={130} h={30} label="Serveur 2" />
      <Arrow from={[130, 19]} to={[178, 32]} color={c} />
      <Arrow from={[130, 61]} to={[178, 50]} color={c} />
      {/* Cylindre : corps sans bordure horizontale, puis flancs, puis ellipses. */}
      <rect
        x={cx - rx}
        y={top}
        width={rx * 2}
        height={bottom - top}
        fill={tint}
        stroke="none"
      />
      <line x1={cx - rx} y1={top} x2={cx - rx} y2={bottom} stroke={c} />
      <line x1={cx + rx} y1={top} x2={cx + rx} y2={bottom} stroke={c} />
      <ellipse cx={cx} cy={bottom} rx={rx} ry={9} fill={tint} stroke={c} />
      <ellipse cx={cx} cy={top} rx={rx} ry={9} fill={SURFACE} stroke={c} />
      <text x={cx} y={44} textAnchor="middle" fontSize={13} fill={INK}>
        {driver}
      </text>
      <text x={cx} y={58} textAnchor="middle" fontSize={11} fill={DIM}>
        conserve
      </text>
      <Arrow from={[cx + rx, 40]} to={[350, 40]} color={c} />
      <Node
        x={350}
        y={16}
        w={130}
        h={48}
        label="Console"
        sub="relit"
        stroke={c}
      />
      <text x={240} y={88} textAnchor="middle" fontSize={11} fill={DIM}>
        les lignes restent — tu les relis quand tu veux
      </text>
    </svg>
  );
}

export const TransportTab = observer(
  ({ infra }: { infra: Infra | undefined }) => {
    const store = useStore();
    const fetcher = useCallback(async (): Promise<TransportData> => {
      // Les deux sondes peuvent 403/manquer (module realtime absent) → non bloquant.
      const [info, health] = await Promise.all([
        store.api
          .getAbsolute<KernelInfoPartial>(KERNEL_INFO_ENDPOINT)
          .catch(() => null),
        store.api
          .getAbsolute<HealthPayload>(REALTIME_HEALTH_ENDPOINT)
          .catch(() => null),
      ]);
      const norm = normalize(health);
      return {
        log: info?.backplanes?.log ?? null,
        rt: norm?.instances[0] ?? null,
        cluster: norm?.cluster ?? false,
        instances: norm?.instances.length ?? 0,
        publishTotal: norm?.totals.publishTotal ?? 0,
        fanoutTotal: norm?.totals.fanoutTotal ?? 0,
      };
    }, [store]);

    const { data } = useResource(fetcher);
    const log = data?.log;
    const rt = data?.rt ?? null;
    const bp = rt?.backplane;
    const queue = bp?.queue;
    const drivers = rt?.backplaneDrivers ?? [];
    const connected = bp?.crossPod === true;
    const servers = data?.instances ?? 0;
    const maxBytes = queue?.maxBytes ?? 0;
    const inFlight = queue?.bytes ?? 0;
    const fill = maxBytes > 0 ? Math.min(100, (inFlight / maxBytes) * 100) : 0;
    const dropped = queue?.droppedTotal ?? 0;
    const failed = queue?.failedTotal ?? 0;
    // « Vérifié » n'a de sens que sur un fond de panier PARTAGÉ, où un tiers peut
    // écrire. En mono-serveur ou entre les processus d'une même machine, l'émetteur
    // est connu par construction : afficher « non vérifié » y serait un faux signal.
    const checkKnown = bp?.sealed !== undefined;

    return (
      <Stack gap="md">
        {/* Montrer, pas raconter (NN/g #2 et #6) : deux dessins contrastés
            portent la distinction que trois paragraphes ne passaient pas. */}
        <Text size="sm" c="dimmed">
          Un <strong>fond de panier</strong> relie les serveurs d'une même
          application. Nodefony en a deux : ils ne transportent pas la même
          chose, et un seul conserve quelque chose.
        </Text>
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder radius="md" p="md" h="100%">
              <Group gap={6} mb={4}>
                <IconBroadcast size={17} />
                <Text fw={600}>Temps réel</Text>
                <Badge
                  size="xs"
                  variant="light"
                  color={connected ? "teal" : "gray"}
                >
                  {bp?.driver ?? "—"}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed" mb="xs">
                Répète aux autres serveurs ce qui vient d'arriver, pour que
                leurs clients le voient aussi.
              </Text>
              <RealtimeDiagram
                connected={connected}
                driver={bp?.driver ?? "—"}
              />
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder radius="md" p="md" h="100%">
              <Group gap={6} mb={4}>
                <IconFileText size={17} />
                <Text fw={600}>Journaux</Text>
                <Badge size="xs" variant="light" color="blue">
                  {log?.driver ?? "—"}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed" mb="xs">
                Rassemble les journaux de tous les serveurs pour que tu puisses
                les relire au même endroit.
              </Text>
              <LogsDiagram driver={log?.driver ?? "—"} />
            </Card>
          </Grid.Col>
        </Grid>

        {/* ── 1 · TEMPS RÉEL — tout ce qui le concerne dans UNE carte. Trois
              blocs séparés donnaient trois sujets ; il n'y en a qu'un, et les
              sous-titres disent à quel fond de panier chaque chiffre se rapporte. */}
        <Card withBorder radius="md" p="md">
          <Group gap="xs" mb="xs">
            <IconBroadcast size={18} />
            <Text fw={600}>Temps réel — en détail</Text>
            <Badge
              size="sm"
              variant="light"
              color={connected ? "teal" : "gray"}
            >
              {bp?.driver ?? "—"}
            </Badge>
            <TipHint
              title="À quoi sert ce fond de panier"
              summary="Deux personnes discutent dans ton application. Si elles ne sont pas servies par le même serveur, seul ce fond de panier fait passer le message de l'une à l'autre."
              sections={[
                {
                  label: "Sans lui",
                  body: "Chaque serveur ne prévient que SES clients. L'autre moitié des utilisateurs ne reçoit rien — sans erreur, sans log. C'est la panne la plus discrète du temps réel.",
                },
                {
                  label: "Avec",
                  body: "Le serveur qui reçoit le message le dépose sur le fond de panier ; les autres le lisent et le donnent à leurs propres clients.",
                },
                {
                  label: "Il ne garde rien",
                  body: "Le message part vers ceux qui écoutent à cet instant, puis disparaît : aucun historique, aucun rejeu. Un client déconnecté ne le rattrapera pas.",
                },
              ]}
            />
          </Group>

          {bp ? (
            <Text size="sm">
              {connected ? (
                <>
                  ✅ <strong>Les messages circulent entre les serveurs.</strong>{" "}
                  Un message publié ici est répété aux autres via{" "}
                  <Code>{bp.driver}</Code>
                  {bp.channel ? (
                    <>
                      {" "}
                      (ils se parlent sur <Code>{bp.channel}</Code>)
                    </>
                  ) : null}
                  .
                </>
              ) : (
                <>
                  ⚠️ <strong>Les messages ne sortent pas de ce serveur.</strong>{" "}
                  Le mécanisme actuel (<Code>{bp.driver}</Code>) livre
                  uniquement aux clients connectés ici.{" "}
                  {servers > 1
                    ? `Or ${servers} serveurs tournent : les clients des autres ne reçoivent rien.`
                    : "C'est sans conséquence tant qu'un seul serveur tourne."}
                </>
              )}
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              Pas d'information : le module temps réel n'est pas chargé, ou la
              sonde n'est pas lisible avec ce compte.
            </Text>
          )}

          {bp && !connected && servers > 1 && (
            <Alert
              variant="light"
              color="orange"
              mt="sm"
              icon={<IconAlertTriangle size={16} />}
            >
              <Text size="sm">
                <strong>Une partie de tes utilisateurs ne recevra rien.</strong>{" "}
                {servers} serveurs tournent, mais chacun ne prévient que ses
                propres clients : deux personnes ne se verront que si elles sont
                tombées sur le même. Il faut un fond de panier partagé (Redis) —
                voir « ce que tu peux brancher » plus bas.
              </Text>
            </Alert>
          )}

          {/* Confiance — même fond de panier, autre question. */}
          <Divider
            my="sm"
            label="Les messages qui arrivent des autres serveurs"
            labelPosition="left"
          />
          <Group gap="xs" align="baseline">
            <Text size="sm" fw={600}>
              {checkKnown
                ? bp?.sealed
                  ? "expéditeur vérifié"
                  : "expéditeur NON vérifié"
                : "aucun message extérieur"}
            </Text>
            <DocHint
              title="Vérifier l'expéditeur"
              summary={
                checkKnown
                  ? bp?.sealed
                    ? "Chaque message reçu porte une signature ; ceux qui n'en ont pas sont refusés."
                    : "Les messages reçus ne sont pas signés : leur expéditeur n'est pas vérifié."
                  : "La question ne se pose pas ici : rien n'arrive de l'extérieur."
              }
              sections={[
                {
                  label: "Pourquoi vérifier",
                  body: "Un fond de panier partagé est une boîte aux lettres commune. Tout ce qui sait y déposer une enveloppe est redistribué à TOUS les serveurs, donc à tous les utilisateurs. Sans signature, il suffit d'un accès à cette boîte pour diffuser n'importe quoi.",
                },
                {
                  label: "La signature",
                  body: "Chaque message est cacheté à l'envoi avec un secret partagé entre tes serveurs ; à l'arrivée, un cachet qui ne correspond pas fait jeter le message. On l'appelle aussi le sceau.",
                },
                {
                  label: "Ici",
                  body: checkKnown
                    ? bp?.sealed
                      ? "Signature active : les messages non authentifiés sont refusés à l'entrée."
                      : "Aucune signature : à corriger avant d'exposer ce fond de panier au-delà de la machine."
                    : "Aucun message ne vient de l'extérieur (un seul processus, ou passage interne entre processus d'une même machine) : il n'y a pas d'expéditeur inconnu possible.",
                },
              ]}
            />
          </Group>

          {/* Pertes — n'existe que si le transport a une file d'attente. */}
          {queue && (
            <>
              <Divider
                my="sm"
                label="Est-ce qu'on perd des messages ?"
                labelPosition="left"
              />
              {maxBytes > 0 && (
                <Progress
                  value={fill}
                  color={fill > 80 ? "orange" : "teal"}
                  size="sm"
                  radius="sm"
                  mb="xs"
                  aria-label={`File d'attente d'envoi remplie à ${fill.toFixed(0)} %`}
                />
              )}
              <Group gap="lg">
                <Text size="sm">
                  En attente : <strong>{bytes(inFlight)}</strong>
                  {maxBytes > 0 && (
                    <Text span size="sm" c="dimmed">
                      {" "}
                      / {bytes(maxBytes)}
                    </Text>
                  )}
                </Text>
                <Text size="sm" c={dropped > 0 ? "orange" : undefined}>
                  Jetés faute de place : <strong>{dropped}</strong>
                </Text>
                <Text size="sm" c={failed > 0 ? "orange" : undefined}>
                  Refusés : <strong>{failed}</strong>
                </Text>
                <DocHint
                  title="La file d'attente d'envoi"
                  summary={`${bytes(inFlight)} de messages attendent d'être déposés${maxBytes > 0 ? `, sur ${bytes(maxBytes)} autorisés` : ""}.`}
                  sections={[
                    {
                      label: "Ce qui se passe",
                      body: "Déposer un message sur le fond de panier n'est pas instantané. En attendant l'accusé de réception, les messages patientent en mémoire : si le fond de panier ralentit, cette file grossit — et la mémoire du serveur avec elle.",
                    },
                    {
                      label: "Pourquoi un plafond",
                      body: "Sans limite, un fond de panier lent finirait par saturer la mémoire et faire tomber le serveur. Au-delà du plafond, les messages en trop sont jetés : on sacrifie des messages pour garder le serveur debout.",
                    },
                    {
                      label: "Activité",
                      body: `${data?.publishTotal ?? 0} message(s) publié(s) et ${data?.fanoutTotal ?? 0} distribution(s) aux clients depuis le démarrage${data?.cluster ? ", tous serveurs confondus" : ""}. Un même message compte autant de distributions qu'il a de destinataires.`,
                    },
                  ]}
                />
              </Group>
              {dropped > 0 && (
                <Text size="xs" c="orange" mt="xs">
                  Ces messages n'ont jamais atteint les autres serveurs : ils
                  ont été sacrifiés pour éviter de saturer la mémoire.
                </Text>
              )}
            </>
          )}

          {/* Alternatives — le registre réel, pas un catalogue figé. */}
          {drivers.length > 0 && (
            <>
              <Divider
                my="sm"
                label="Ce que tu peux brancher à la place"
                labelPosition="left"
              />
              <Group gap={6} wrap="wrap" mb={6}>
                {drivers.map((d) => (
                  <Badge
                    key={d}
                    size="sm"
                    variant={d === bp?.driver ? "filled" : "outline"}
                    color={d === bp?.driver ? "teal" : "gray"}
                    style={{ textTransform: "none" }}
                  >
                    {d}
                    {d === bp?.driver ? " — en service" : ""}
                  </Badge>
                ))}
              </Group>
              <List size="xs" spacing={2} c="dimmed">
                <List.Item>
                  <Code>loopback</Code> — tout reste dans le processus. Parfait
                  seul, inutile à plusieurs.
                </List.Item>
                <List.Item>
                  <Code>cluster</Code> — relie les processus d'une même machine.
                </List.Item>
                <List.Item>
                  <Code>redis</Code> — relie des serveurs différents, y compris
                  sur plusieurs machines.
                </List.Item>
              </List>
            </>
          )}
        </Card>

        {/* ── 2 · JOURNAUX — l'autre fond de panier, même grille de lecture. ── */}
        <Card withBorder radius="md" p="md">
          <Group gap="xs" mb="xs">
            <IconFileText size={18} />
            <Text fw={600}>Journaux — en détail</Text>
            <Badge size="sm" variant="light" color="blue">
              {log?.driver ?? "—"}
            </Badge>
            <TipHint
              title="À quoi sert ce fond de panier"
              summary="Il ne fait pas circuler de messages : il rassemble les journaux pour qu'on puisse les relire au même endroit."
              sections={[
                {
                  label: "Écrire et relire sont deux choses",
                  body: "Les journaux sont toujours écrits sur la sortie standard du serveur — règle des applications conteneurisées, elle ne change pas. Ce réglage décide seulement d'OÙ la console va les relire ensuite.",
                },
                {
                  label: "À plusieurs serveurs",
                  body: "Une destination locale ne montre que les journaux du serveur interrogé. Une destination partagée (Loki, OpenSearch) rassemble ceux de tous : c'est là qu'on retrouve une erreur survenue ailleurs.",
                },
                {
                  label: "Différence avec le temps réel",
                  body: "Celui-ci CONSERVE : on relit des heures ou des jours après. Le temps réel, lui, ne garde rien.",
                },
              ]}
            />
          </Group>
          <Text size="sm">
            La console relit les journaux via <Code>{log?.driver ?? "—"}</Code>.
            Ils sont écrits, eux, vers <Code>{log?.sink ?? "—"}</Code>.
          </Text>
          {log?.available && log.available.length > 0 && (
            <>
              <Divider
                my="sm"
                label="Destinations disponibles"
                labelPosition="left"
              />
              <Group gap={6} wrap="wrap">
                {log.available.map((d) => (
                  <Badge
                    key={d.name}
                    size="sm"
                    variant={d.name === log.driver ? "filled" : "outline"}
                    color={d.name === log.driver ? "teal" : "gray"}
                    style={{ textTransform: "none" }}
                    title={
                      d.query
                        ? "Permet de relire et filtrer les journaux"
                        : "Écrit seulement : on ne peut pas relire depuis cette destination"
                    }
                  >
                    {d.name}
                    {d.name === log.driver ? " — en service" : ""}
                    {d.query ? "" : " (écriture seule)"}
                  </Badge>
                ))}
              </Group>
            </>
          )}
        </Card>

        {!rt && (
          <Alert
            variant="light"
            color="gray"
            icon={<IconInfoCircle size={16} />}
          >
            <Text size="sm">
              Aucune information temps réel : le module{" "}
              <Code>@nodefony/realtime</Code> n'est pas chargé, ou la sonde
              n'est pas lisible avec ce compte. La relecture des journaux reste
              affichée ci-dessus.
              {infra?.cache
                ? " Un serveur Redis est pourtant déclaré : il pourrait servir de fond de panier."
                : ""}
            </Text>
          </Alert>
        )}
      </Stack>
    );
  },
);
