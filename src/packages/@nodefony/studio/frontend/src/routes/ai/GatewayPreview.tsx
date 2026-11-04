import { useState, type ReactNode } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Card,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconApi,
  IconArrowRight,
  IconBrain,
  IconDevices,
  IconMaximize,
  IconPlug,
  IconRobot,
  IconRouter,
  IconTerminal2,
} from "@tabler/icons-react";
// Logo de la passerelle de référence (projet open source) : son NOM reste une
// donnée du modèle, le fichier porte un nom générique.
import gatewayLogoUrl from "../../assets/ai-logos/gateway-reference.svg";
import { NODEFONY_LOGO_URL } from "../../components/NodefonyLogo";
import {
  DocHint,
  MODAL_FULLSCREEN_CONTENT,
  PageLayout,
  type LiveNodeData,
} from "../../components/ui";
import { TwinMap } from "../../realtime/twin/TwinMap";
import type {
  Pt,
  SchemaBrick,
  SchemaInner,
  SchemaLink,
  TwinSchema,
} from "../../realtime/twin/twinSchemas";
import {
  DIALOGUE_AGENTS,
  DIALOGUE_STEPS,
  GATEWAY_FOR_DUMMIES,
  GATEWAY_FUNCTIONS,
  GATEWAY_NODES,
  GATEWAY_PILLARS,
  GATEWAY_REFERENCE,
  NODEFONY_ROLES,
  PROTOCOLS,
  type IGatewayNode,
  type INodefonyRole,
  type NodefonyReadiness,
} from "./aiPreviewModel";
import { PreviewBanner } from "./aiPreviewParts";

const READINESS: Record<
  NodefonyReadiness,
  { color: string; label: string; status: "ok" | "warn" | "idle" }
> = {
  real: { color: "teal", label: "réel", status: "ok" },
  partial: { color: "yellow", label: "en partie", status: "warn" },
  target: { color: "gray", label: "cible", status: "idle" },
};

/** L'ordre de la légende — typé, plutôt qu'un `Object.keys` converti. */
const READINESS_ORDER: NodefonyReadiness[] = ["real", "partial", "target"];

function ReadinessBadge({ readiness }: { readiness: NodefonyReadiness }) {
  const r = READINESS[readiness];
  return (
    // Largeur naturelle : dans une cellule étroite, Mantine tronquerait « réel » en « r… ».
    <Badge
      variant="light"
      color={r.color}
      size="sm"
      style={{ minWidth: "max-content" }}
    >
      {r.label}
    </Badge>
  );
}

/**
 * Le logo Nodefony, partout où Nodefony intervient. Décoratif (`alt` vide) :
 * le nom de la brique ou du texte voisin dit déjà « Nodefony ».
 */
function NodefonyMark({ size = 18 }: { size?: number }) {
  return (
    <img
      src={NODEFONY_LOGO_URL}
      alt=""
      height={size}
      style={{ height: size, width: "auto", display: "block" }}
      draggable={false}
    />
  );
}

/** Le logo de la passerelle de référence, partout où ELLE intervient. Décoratif. */
function GatewayMark({ size = 18 }: { size?: number }) {
  return (
    <img
      src={gatewayLogoUrl}
      alt=""
      height={size}
      style={{ height: size, width: "auto", display: "block" }}
      draggable={false}
    />
  );
}

/**
 * Un schéma avec le bouton « plein écran » des schémas Studio — le même geste
 * que `FlowGraph` : bouton en haut à droite, modale plein écran.
 */
function MapFrame({
  title,
  height,
  children,
}: {
  title: string;
  height: number;
  children: (height: number | string) => ReactNode;
}) {
  const [full, setFull] = useState(false);
  return (
    <>
      <Box pos="relative">
        <Tooltip label="Plein écran">
          <ActionIcon
            variant="default"
            size="lg"
            onClick={() => setFull(true)}
            aria-label={`Agrandir le schéma : ${title}`}
            // Au-dessus des briques (2), SOUS l'en-tête collant de la page.
            style={{ position: "absolute", top: 8, right: 8, zIndex: 3 }}
          >
            <IconMaximize size={16} />
          </ActionIcon>
        </Tooltip>
        {children(height)}
      </Box>
      <Modal
        opened={full}
        onClose={() => setFull(false)}
        fullScreen
        radius={0}
        title={title}
      >
        {full ? children(MODAL_FULLSCREEN_CONTENT) : null}
      </Modal>
    </>
  );
}

const ICONS: Record<string, ReactNode> = {
  cli: <IconTerminal2 size={16} />,
  agents: <IconRobot size={16} />,
  apps: <IconDevices size={16} />,
  gateway: <GatewayMark size={118} />,
  llm: <IconBrain size={16} />,
  mcp: <IconPlug size={16} />,
  apis: <IconApi size={16} />,
};

/** Une fiche détaillée : une brique du grand schéma, ou un agent du dialogue. */
interface IDetail {
  id: string;
  label: string;
  sub: string;
  detail: string;
  nodefony?: NodefonyReadiness | undefined;
  examples?: string[] | undefined;
}

/** L'explication « pour les nuls » d'une brique, exemples du marché compris. */
function hintOf(d: IDetail): string {
  return d.examples
    ? `${d.detail} Exemples : ${d.examples.join(", ")}.`
    : d.detail;
}

// ─── Le grand schéma : la composition de la passerelle de référence ────────
// Trois colonnes à positions FIXES (en % du cadre) : sources à gauche, la
// passerelle au centre — une puce massive, comme sur le schéma de référence —
// entourée de ses quatre fonctions, destinations à droite.

const COLUMN_X = { source: 13, gateway: 50, destination: 87 } as const;
const ROW_Y = {
  source: [12, 44, 80],
  destination: [12, 44, 82],
} as const;

/** Position d'un nœud : sa colonne, puis son rang dans la colonne. */
function placeOf(n: IGatewayNode): Pt {
  if (n.column === "gateway") return { x: COLUMN_X.gateway, y: 46 };
  const rank = GATEWAY_NODES.filter((m) => m.column === n.column).indexOf(n);
  return { x: COLUMN_X[n.column], y: ROW_Y[n.column][rank] ?? 50 };
}

/**
 * Les quatre fonctions, serrées contre la passerelle : le milieu des liens reste
 * libre pour le protocole qu'ils portent.
 */
const FUNCTION_POS: Pt[] = [
  { x: 38, y: 24 },
  { x: 62, y: 24 },
  { x: 38, y: 72 },
  { x: 62, y: 72 },
];

/** Les rôles Nodefony tenus dans une case du schéma. */
function rolesOf(nodeId: string): INodefonyRole[] {
  return NODEFONY_ROLES.filter((r) => r.attachTo === nodeId);
}

/**
 * Les encadrés Nodefony DANS une case — comme la rangée de logos de produits au
 * bas des cartes du schéma de référence. Une boîte par `box` du rôle (un agent
 * = une boîte) : le logo, son nom, et ses rôles en pastilles (allumées si
 * réelles, en pointillé si à venir).
 */
function nodefonyInner(nodeId: string): SchemaInner[] | undefined {
  const roles = rolesOf(nodeId);
  if (roles.length === 0) return undefined;
  const boxes = [...new Set(roles.map((r) => r.box))];
  return boxes.map((box) => ({
    title: box,
    icon: <NodefonyMark size={16} />,
    color: "brand",
    items: roles
      .filter((r) => r.box === box)
      .map((r) => ({
        label: `${r.pin} · ${READINESS[r.readiness].label}`,
        active: r.readiness === "real",
      })),
  }));
}

/** L'explication d'une case, ses rôles Nodefony compris. */
function caseHint(n: IGatewayNode): string {
  const roles = rolesOf(n.id);
  const nodefony = roles.length
    ? ` Nodefony ici : ${roles.map((r) => `${r.label} (${READINESS[r.readiness].label})`).join(" ; ")}.`
    : "";
  return hintOf(n) + nodefony;
}

function nodeColor(n: IGatewayNode): string {
  return n.column === "gateway" ? "violet" : "gray";
}

// Topologie statique : construite une fois au chargement du module.
const SCHEMA: TwinSchema = {
  id: "agent-gateway",
  title: "passerelle d'agents — sources, plan de contrôle, destinations",
  bricks: [
    ...GATEWAY_NODES.map((n): SchemaBrick => ({
      id: n.id,
      // Le centre porte le nom de la passerelle de référence — une donnée.
      title: n.column === "gateway" ? GATEWAY_REFERENCE.name : n.label,
      color: nodeColor(n),
      icon: ICONS[n.id],
      pos: placeOf(n),
      emphasis: n.column === "gateway",
      // Assez large pour le titre entier ; pas de ⓘ : le clic ouvre déjà la fiche.
      // La passerelle est une PUCE, comme sur le schéma de référence : width = son côté.
      width: n.column === "gateway" ? 170 : 220,
      ...(n.column === "gateway" ? { variant: "chip" as const } : {}),
      inner: nodefonyInner(n.id),
      // Explication « pour les nuls » au survol et au focus clavier.
      hint: caseHint(n),
    })),
    ...GATEWAY_FUNCTIONS.map((f, i): SchemaBrick => ({
      id: `fn-${i}`,
      title: f.label,
      hint: f.hint,
      color: "violet",
      icon: <GatewayMark size={12} />,
      pos: FUNCTION_POS[i] ?? { x: 50, y: 50 },
      external: true,
    })),
  ],
  links: [
    ...GATEWAY_NODES.filter((n) => n.column !== "gateway").map(
      (n): SchemaLink => {
        const link: SchemaLink = {
          from: n.column === "source" ? n.id : "gateway",
          to: n.column === "source" ? "gateway" : n.id,
        };
        // Le protocole s'écrit côté brique, loin des fonctions de la passerelle.
        if (n.protocol) {
          link.label = n.protocol;
          link.labelAt = n.column === "source" ? 0.42 : 0.56;
        }
        return link;
      },
    ),
    // Les quatre fonctions font partie de la passerelle : reliées à elle.
    ...GATEWAY_FUNCTIONS.map((_, i): SchemaLink => ({
      from: `fn-${i}`,
      to: "gateway",
      cross: true,
    })),
  ],
  boundaries: [],
};

/** Pastilles allumées : les quatre fonctions de la passerelle. */
const LIVE: Record<string, LiveNodeData> = Object.fromEntries(
  GATEWAY_FUNCTIONS.map((_, i) => [`fn-${i}`, { status: "ok" }]),
);

// ─── Le petit schéma : plusieurs agents Nodefony qui se parlent (A2A) ──────

const DIALOGUE_POS: Record<string, Pt> = {
  "a-support": { x: 15, y: 50 },
  "a-legal": { x: 85, y: 26 },
  "a-billing": { x: 85, y: 74 },
};

const DIALOGUE_SCHEMA: TwinSchema = {
  id: "agent-dialogue",
  title: "trois agents Nodefony qui se parlent en A2A, à travers la passerelle",
  bricks: [
    ...DIALOGUE_AGENTS.map((a): SchemaBrick => ({
      id: a.id,
      // Le nombre de pods EST le message : chaque agent grossit seul.
      title: `${a.label} · ${a.pods} pods`,
      color: "brand",
      icon: <NodefonyMark />,
      pos: DIALOGUE_POS[a.id] ?? { x: 50, y: 50 },
      emphasis: true,
      width: 236,
      hint: `${a.sub}. ${a.detail}`,
    })),
    {
      id: "d-gateway",
      title: GATEWAY_REFERENCE.name,
      color: "violet",
      icon: <GatewayMark size={76} />,
      // Un peu au-dessus du centre : le nom de la puce s’écrit dessous.
      pos: { x: 50, y: 44 },
      emphasis: true,
      width: 108,
      variant: "chip",
      hint: "Elle relaie l'A2A tel quel : elle vérifie qui parle à qui, trace l'échange et compte son coût. Elle ne lit pas la tâche.",
    },
  ],
  // Tout le dialogue est une cible : liens en pointillé.
  links: [
    {
      from: "a-support",
      to: "d-gateway",
      cross: true,
      label: "A2A",
    },
    {
      from: "d-gateway",
      to: "a-billing",
      cross: true,
      label: "A2A",
    },
    {
      from: "d-gateway",
      to: "a-legal",
      cross: true,
      label: "A2A",
    },
  ],
  boundaries: [],
};

const DIALOGUE_LIVE: Record<string, LiveNodeData> = Object.fromEntries(
  DIALOGUE_AGENTS.map((a) => [a.id, { status: READINESS[a.nodefony].status }]),
);

/** Toutes les fiches ouvrables d'un clic, des deux schémas. */
const DETAILS: Record<string, IDetail> = Object.fromEntries([
  ...GATEWAY_NODES.map((n): [string, IDetail] => [n.id, n]),
  ...DIALOGUE_AGENTS.map((a): [string, IDetail] => [a.id, a]),
]);

/** Un agent dans la boîte d'une application (vue « tout ensemble »). */
function AgentChip({ label }: { label: string }) {
  return (
    <Paper withBorder radius="xl" px="sm" py={4}>
      <Group gap={6} wrap="nowrap">
        <NodefonyMark size={14} />
        <Text size="sm" fw={600}>
          Agent {label}
        </Text>
      </Group>
    </Paper>
  );
}

/** La boîte d'une application : la bordure de la marque, comme sur le schéma. */
const APP_BOX = {
  border: "2px solid var(--mantine-color-brand-5)",
  background:
    "color-mix(in srgb, var(--mantine-color-brand-6) 8%, var(--mantine-color-body))",
} as const;

const PROMISE_BOX = {
  background: "var(--mantine-color-default-hover)",
} as const;

const EYEBROW = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
} as const;

const noEnter = () => undefined;

/**
 * Passerelle d'agents — où se place une application Nodefony face à une
 * passerelle (trafic des modèles, des outils MCP et des agents A2A).
 *
 * Le schéma reprend la composition d'une passerelle de référence (sources →
 * plan de contrôle → destinations), rendue par le moteur de la Carte du
 * serveur, et marque du logo Nodefony les RÔLES qu'une application Nodefony
 * peut y tenir — agent, agent ou outils qu'on appelle, API d'entreprise —,
 * souvent plusieurs à la fois. Le bloc de déploiement montre ses agents rangés
 * ensemble, puis séparés en applications qui se parlent en A2A.
 */
export function GatewayPreview() {
  const [selectedId, setSelectedId] = useState<string | null>("mcp");
  // La passerelle du petit schéma ouvre la fiche de la passerelle.
  const selected =
    DETAILS[selectedId === "d-gateway" ? "gateway" : (selectedId ?? "")] ??
    null;

  const realPillars = GATEWAY_PILLARS.filter(
    (p) => p.readiness === "real",
  ).length;
  const realRoles = NODEFONY_ROLES.filter((r) => r.readiness === "real");
  const selectedRoles = selected
    ? NODEFONY_ROLES.filter((r) => r.attachTo === selected.id)
    : [];

  return (
    <PageLayout
      title="Passerelle d'agents"
      subtitle="La passerelle règle le trafic au bord ; Nodefony règle l'application derrière — la donnée, l'utilisateur, l'action."
      icon={<IconRouter size={22} />}
    >
      <PreviewBanner module="@nodefony/ai" contract="MCP · A2A · gRPC" />

      <Card withBorder radius="md" padding="md">
        <Text fw={600} mb="sm">
          {GATEWAY_REFERENCE.name}, pour les nuls
        </Text>
        <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }} spacing="md">
          {GATEWAY_FOR_DUMMIES.map((step) => (
            <Stack key={step.title} gap={4}>
              <Group gap={6} wrap="nowrap">
                {step.nodefony && <NodefonyMark size={16} />}
                <Text size="sm" fw={700}>
                  {step.title}
                </Text>
              </Group>
              <Text size="sm">{step.body}</Text>
            </Stack>
          ))}
        </SimpleGrid>
      </Card>

      <Card withBorder radius="md" padding="md">
        <Group gap={8} wrap="nowrap" align="flex-start" mb="md">
          <NodefonyMark size={18} />
          <Text size="sm">
            <b>
              Le logo Nodefony marque les rôles qu'une application Nodefony peut
              tenir ici
            </b>{" "}
            : ses agents et son front (à gauche), ses outils et ses agents qu'on
            appelle (MCP, A2A), une API d'entreprise (REST, WebSocket, gRPC).
            Une même application peut en tenir plusieurs à la fois.
          </Text>
        </Group>
        <SimpleGrid cols={3} mb="xs">
          <Text size="xs" fw={700} c="dimmed" style={EYEBROW}>
            Sources · clients
          </Text>
          <Text size="xs" fw={700} c="dimmed" ta="center" style={EYEBROW}>
            Passerelle · plan de contrôle
          </Text>
          <Text size="xs" fw={700} c="dimmed" ta="right" style={EYEBROW}>
            Destinations · modèles & agents
          </Text>
        </SimpleGrid>

        <MapFrame title="Passerelle d'agents" height={680}>
          {(h) => (
            <TwinMap
              schema={SCHEMA}
              liveNodeData={LIVE}
              live={false}
              height={h}
              onEnter={noEnter}
              onInfo={setSelectedId}
            />
          )}
        </MapFrame>

        <Group gap="md" justify="center" mt="xs">
          <Group gap={6} wrap="nowrap">
            <NodefonyMark size={14} />
            <Text size="xs" c="dimmed">
              Rôles Nodefony :
            </Text>
          </Group>
          {READINESS_ORDER.map((k) => (
            <Group key={k} gap={6} wrap="nowrap">
              <span
                className={`nf-tm-dot is-${READINESS[k].status}`}
                aria-hidden
              />
              <Text size="xs">{READINESS[k].label}</Text>
            </Group>
          ))}
          <Text size="xs" c="dimmed">
            · ⇄ = dans les deux sens · pointillé = à construire · survol =
            explication
          </Text>
        </Group>

        <Group
          justify="space-between"
          mt="sm"
          pt="sm"
          wrap="nowrap"
          style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
        >
          <Text size="xs" fw={700} c="dimmed" style={EYEBROW}>
            Requête · entrant
          </Text>
          <Text size="xs" fw={700} ta="center" style={EYEBROW}>
            {GATEWAY_PILLARS.map((p) => p.verb).join(" · ")}
          </Text>
          <Text size="xs" fw={700} c="dimmed" ta="right" style={EYEBROW}>
            Réponse · sortant
          </Text>
        </Group>
      </Card>

      <Card withBorder radius="md" padding="md">
        <Group gap={6} mb="sm">
          <Text fw={600}>Qui parle quoi</Text>
          <DocHint
            title="Protocole, transport, flux"
            summary="Le protocole dit ce qu'on se dit (MCP, A2A, gRPC) ; le transport, par où ça passe (HTTP, HTTP/2, WebSocket) ; le flux, comment une réponse longue arrive morceau par morceau (SSE, flux gRPC)."
            sections={[
              {
                label: "La passerelle",
                body: "Elle relaie chacun tel quel : elle n'en traduit aucun.",
              },
            ]}
          />
        </Group>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Échange</Table.Th>
              <Table.Th>Protocole</Table.Th>
              <Table.Th>Transport</Table.Th>
              <Table.Th>Réponse longue</Table.Th>
              <Table.Th>
                <Group gap={6} wrap="nowrap">
                  <NodefonyMark size={14} />
                  Nodefony
                </Group>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {PROTOCOLS.map((p) => (
              <Table.Tr key={p.exchange}>
                <Table.Td>
                  <Text size="sm" fw={600}>
                    {p.exchange}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{p.protocol}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{p.transport}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{p.stream}</Text>
                </Table.Td>
                <Table.Td>
                  <ReadinessBadge readiness={p.readiness} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Card withBorder radius="md" padding="md">
        <Group gap={6} mb={4}>
          <NodefonyMark />
          <Text fw={600}>Déployer des agents : deux façons, le même code</Text>
        </Group>
        <Text size="sm" c="dimmed" mb="md">
          Un agent est un MODULE Nodefony. Une application, c'est la liste des
          modules qu'on lui donne. On choisit donc au déploiement de ranger les
          agents ensemble ou séparément — sans réécrire un seul agent.
        </Text>

        <Stack gap="md">
          <Paper withBorder radius="md" p="md">
            <Group gap={6} mb={4}>
              <Badge color="brand" variant="filled" size="sm">
                A
              </Badge>
              <Text fw={700}>Tout ensemble</Text>
              <Badge variant="light" color="gray" size="sm" tt="none">
                pour commencer
              </Badge>
            </Group>
            <Text size="sm" mb="sm">
              Une seule application charge les trois agents. On lance 3 pods,
              tous identiques.
            </Text>
            <Paper radius="md" p="sm" style={APP_BOX}>
              <Group gap={6} mb="xs">
                <NodefonyMark size={14} />
                <Text size="xs" fw={700}>
                  Application Nodefony · 3 pods identiques
                </Text>
              </Group>
              <Group gap="xs" align="center">
                <AgentChip label="Support" />
                <Group gap={4} wrap="nowrap">
                  <IconArrowRight size={14} aria-hidden />
                  <Text size="xs" c="dimmed">
                    appel direct
                  </Text>
                </Group>
                <AgentChip label="Juriste" />
                <AgentChip label="Facturation" />
              </Group>
            </Paper>
            <Text size="sm" mt="sm">
              Le support appelle le juriste <b>directement, en mémoire</b> : pas
              de réseau, pas de passerelle entre eux.
            </Text>
            <Text size="sm" c="dimmed">
              La limite : tout grossit ensemble. Pour 10 juristes, on paie aussi
              10 facturations.
            </Text>
          </Paper>

          <Paper withBorder radius="md" p="md">
            <Group gap={6} mb={4}>
              <Badge color="brand" variant="filled" size="sm">
                B
              </Badge>
              <Text fw={700}>Séparé</Text>
              <Badge variant="light" color="gray" size="sm" tt="none">
                quand la charge l'exige
              </Badge>
            </Group>
            <Text size="sm" mb="sm">
              Chaque application ne charge qu'un agent, et a son propre nombre
              de pods.
            </Text>
            <MapFrame
              title="Déploiement séparé : un agent par application"
              height={300}
            >
              {(h) => (
                <TwinMap
                  schema={DIALOGUE_SCHEMA}
                  liveNodeData={DIALOGUE_LIVE}
                  live={false}
                  height={h}
                  onEnter={noEnter}
                  onInfo={setSelectedId}
                />
              )}
            </MapFrame>
            <Text size="sm" mt="sm">
              Le support appelle le juriste{" "}
              <b>en A2A, à travers la passerelle</b>, qui vérifie et trace
              l'échange.
            </Text>
            <Text size="sm" c="dimmed">
              On ajoute des pods au juriste seul, quand il est très demandé.
            </Text>
          </Paper>

          <Paper p="sm" radius="md" style={PROMISE_BOX}>
            <Group gap={8} wrap="nowrap" align="flex-start">
              <NodefonyMark size={16} />
              <Text size="sm" style={{ flex: 1 }}>
                <b>Le même code dans A et dans B.</b> L'agent support écrit «
                demande au juriste » une seule fois ; Nodefony choisit, selon le
                déploiement, l'appel direct (A) ou l'appel A2A (B). Passer de A
                à B ne réécrit aucun agent.
              </Text>
              <ReadinessBadge readiness="target" />
            </Group>
          </Paper>
        </Stack>

        <Text fw={600} size="sm" mt="lg">
          Dans B, comment deux agents se parlent
        </Text>
        <SimpleGrid cols={{ base: 1, md: 3, xl: 5 }} spacing="md" mt="xs">
          {DIALOGUE_STEPS.map((step, i) => (
            <Stack key={step.title} gap={4}>
              <Group gap={6} wrap="nowrap">
                <Badge variant="filled" color="gray" size="sm" circle>
                  {i + 1}
                </Badge>
                {step.by === "nodefony" ? (
                  <NodefonyMark size={14} />
                ) : (
                  <GatewayMark size={14} />
                )}
                <Text size="sm" fw={700}>
                  {step.title}
                </Text>
              </Group>
              <Text size="sm">{step.body}</Text>
              <Group gap={4}>
                {step.by === "nodefony" ? (
                  <ReadinessBadge readiness={step.readiness} />
                ) : (
                  <Badge variant="light" color="violet" size="sm" tt="none">
                    fait par la passerelle
                  </Badge>
                )}
              </Group>
            </Stack>
          ))}
        </SimpleGrid>
      </Card>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card withBorder radius="md" padding="md" aria-live="polite">
          {selected ? (
            <Stack gap="sm">
              <Group gap={6}>
                {selected.nodefony && <NodefonyMark />}
                <Text fw={600}>{selected.label}</Text>
                {selected.nodefony && (
                  <ReadinessBadge readiness={selected.nodefony} />
                )}
              </Group>
              <Text size="sm" c="dimmed">
                {selected.sub}
              </Text>
              <Text size="sm">{selected.detail}</Text>
              {selected.examples && (
                <Group gap={6}>
                  <Text size="xs" c="dimmed">
                    Exemples du marché :
                  </Text>
                  {selected.examples.map((e) => (
                    <Badge key={e} variant="default" size="sm" tt="none">
                      {e}
                    </Badge>
                  ))}
                </Group>
              )}
              {selectedRoles.length > 0 && (
                <>
                  <Group gap={6}>
                    <NodefonyMark size={14} />
                    <Text size="sm" fw={600}>
                      Ce que Nodefony tient dans cette case
                    </Text>
                  </Group>
                  <Table striped>
                    <Table.Tbody>
                      {selectedRoles.map((r) => (
                        <Table.Tr key={r.id}>
                          <Table.Td>
                            <Text size="sm" fw={600}>
                              {r.label}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{r.detail}</Text>
                          </Table.Td>
                          <Table.Td>
                            <ReadinessBadge readiness={r.readiness} />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </>
              )}
            </Stack>
          ) : (
            <Text size="sm" c="dimmed">
              Cliquez sur une brique du schéma pour voir ce qu'elle apporte.
            </Text>
          )}
        </Card>

        <Card withBorder radius="md" padding="md">
          <Text fw={600} mb="xs">
            La passerelle de référence
          </Text>
          <Text size="sm" mb="xs">
            {GATEWAY_REFERENCE.tagline}
          </Text>
          <Text size="sm" mb="xs">
            Elle ne remplace pas l'application, et Nodefony ne la remplace pas :
            l'une gouverne le trafic qui entre et sort, l'autre ce que
            l'application fait de chaque appel.
          </Text>
          <Anchor
            href={GATEWAY_REFERENCE.url}
            target="_blank"
            rel="noreferrer noopener"
            size="sm"
          >
            {GATEWAY_REFERENCE.name}
          </Anchor>
        </Card>
      </SimpleGrid>

      <Card withBorder radius="md" padding="md">
        <Group gap={6} mb="sm">
          <Text fw={600}>Le même verbe, à deux niveaux</Text>
          <DocHint
            title="Ce qui est déjà vrai"
            summary={`${realPillars} des ${GATEWAY_PILLARS.length} verbes sont déjà tenus par Nodefony à l'intérieur de l'application ; les autres sont des cibles de la couche IA.`}
            sections={[
              {
                label: "Rôles déjà tenus aujourd'hui",
                body:
                  realRoles.length > 0
                    ? realRoles.map((r) => r.label).join(", ")
                    : "Aucun rôle n'est encore tenu.",
              },
            ]}
          />
        </Group>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Verbe</Table.Th>
              <Table.Th>À la passerelle</Table.Th>
              <Table.Th>
                <Group gap={6} wrap="nowrap">
                  <NodefonyMark size={14} />
                  Dans Nodefony
                </Group>
              </Table.Th>
              <Table.Th>État</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {GATEWAY_PILLARS.map((p) => (
              <Table.Tr key={p.verb}>
                <Table.Td>
                  <Text size="sm" fw={600}>
                    {p.verb}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{p.atGateway}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{p.inNodefony}</Text>
                </Table.Td>
                <Table.Td>
                  <ReadinessBadge readiness={p.readiness} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </PageLayout>
  );
}
