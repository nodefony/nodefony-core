/**
 * **ConfigEssentials** — l'onglet « Coup d'œil » de la page Configuration : un
 * tableau de bord qui se lit de haut en bas, du plus urgent au plus détaillé.
 *
 * 1. **Bande de synthèse** : le score des verrous de sécurité (anneau), le mode
 *    et les adresses d'écoute, trois compteurs cliquables.
 * 2. **À vérifier d'abord** : chaque point à revoir, pourquoi, et un bouton qui
 *    ouvre le réglage — n'apparaît que s'il y en a.
 * 3. **Cartes de section** sur UN gabarit (Sécurité, Réseau, Variables posées) :
 *    une ligne par réglage — verdict, libellé, emplacement, valeur — et sa bulle
 *    ⓘ (description du schéma, comment le changer) À CÔTÉ du bouton, jamais
 *    dedans : un contrôle ne s'imbrique pas dans un autre.
 *
 * Le modèle est pur (`configEssentialsModel.ts`) ; ici, l'affichage.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Grid,
  Group,
  RingProgress,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
  type MantineColor,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconChevronRight,
  IconCircleCheck,
  IconInfoCircle,
  IconKey,
  IconLock,
  IconPoint,
  IconWorld,
} from "@tabler/icons-react";
import { DocHint, type DocSection } from "../../components/ui";
import type { ConfigSearchDoc } from "./configSearchEngine";
import {
  buildGlance,
  locationOf,
  type EssentialDisplay,
  type EssentialItem,
  type VerdictLevel,
} from "./configEssentialsModel";
import { fieldHelpSections } from "./FieldHelp";

/** Nombre d'éléments d'une liste montrés avant « +N ». */
const LIST_MAX = 2;

const VERDICT: Record<
  VerdictLevel,
  { icon: ReactNode; color: MantineColor; label: string }
> = {
  ok: {
    icon: <IconCircleCheck size={18} />,
    color: "teal",
    label: "En place",
  },
  warn: {
    icon: <IconAlertTriangle size={18} />,
    color: "orange",
    label: "À vérifier",
  },
  info: {
    icon: <IconInfoCircle size={18} />,
    color: "blue",
    label: "À savoir",
  },
};

/** Mode d'exécution, tel que `/nodefony/kernel/api/info` le rend. */
export interface GlanceRuntime {
  environment: string;
  debug?: boolean | undefined;
}

export interface ConfigEssentialsProps {
  index: readonly ConfigSearchDoc[];
  /** Mode d'exécution ; `null` si le noyau n'a pas répondu. */
  runtime: GlanceRuntime | null;
  /** Comptes de la page (réglages modifiés, secrets masqués). */
  counts: { modified: number; secrets: number };
  onOpen: (doc: ConfigSearchDoc) => void;
  /** Bascule vers l'onglet des écarts. */
  onShowOverrides: () => void;
}

/** Texte court d'une valeur (encadré « À vérifier »). */
function displayText(d: EssentialDisplay): string {
  if (d.kind === "bool") return d.on ? "activé" : "désactivé";
  if (d.kind === "list") return d.items.length ? d.items.join(", ") : "aucun";
  return d.text;
}

/** Valeur d'une ligne : interrupteur, pastilles, ou texte — alignée à droite. */
function InlineValue({ display }: { display: EssentialDisplay }) {
  if (display.kind === "bool") {
    return (
      <Badge
        variant="light"
        color={display.on ? "teal" : "gray"}
        tt="none"
        style={{ flexShrink: 0 }}
      >
        {display.on ? "activé" : "désactivé"}
      </Badge>
    );
  }
  if (display.kind === "list") {
    if (!display.items.length) {
      return (
        <Text size="sm" c="dimmed">
          aucun
        </Text>
      );
    }
    const shown = display.items.slice(0, LIST_MAX);
    const rest = display.items.length - shown.length;
    return (
      <Group gap={4} wrap="nowrap" justify="flex-end" style={{ minWidth: 0 }}>
        {shown.map((it) => (
          <Code
            key={it}
            style={{
              fontSize: 12,
              whiteSpace: "nowrap",
              // Pas de zone qui défile : une pastille trop longue se coupe.
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "100%",
            }}
          >
            {it}
          </Code>
        ))}
        {rest > 0 && (
          <Badge
            size="sm"
            variant="default"
            title={display.items.slice(LIST_MAX).join(", ")}
          >
            +{rest}
          </Badge>
        )}
      </Group>
    );
  }
  return (
    <Code
      title={display.text}
      style={{
        fontSize: 12,
        display: "inline-block",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
    >
      {display.text}
    </Code>
  );
}

/** Bulle ⓘ d'un réglage : description du schéma, verdict, comment le changer. */
function ItemHelp({ item }: { item: EssentialItem }) {
  const { doc, verdict } = item;
  const sections: DocSection[] = [];
  if (verdict) {
    sections.push({ label: VERDICT[verdict.level].label, body: verdict.text });
  }
  sections.push(
    ...fieldHelpSections({
      field: doc.field,
      moduleName: doc.moduleName,
      isApp: doc.isApp,
    }),
  );
  return (
    <DocHint
      title={item.label}
      summary={doc.description || "Le schéma ne décrit pas ce réglage."}
      sections={sections}
      width={420}
    />
  );
}

/** Une ligne : bouton (verdict, libellé, emplacement, valeur) + bulle ⓘ à côté. */
function Row({
  item,
  title,
  mono = false,
  first,
  onOpen,
}: {
  item: EssentialItem;
  title: string;
  mono?: boolean;
  first: boolean;
  onOpen: (doc: ConfigSearchDoc) => void;
}) {
  const [hover, setHover] = useState(false);
  const v = item.verdict;
  return (
    <Group
      gap={0}
      wrap="nowrap"
      align="center"
      style={{
        borderTop: first
          ? undefined
          : "1px solid var(--mantine-color-default-border)",
        background: hover ? "var(--mantine-color-default-hover)" : undefined,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <UnstyledButton
        onClick={() => onOpen(item.doc)}
        px="sm"
        py={8}
        style={{ flex: "1 1 auto", minWidth: 0 }}
      >
        <Group gap="sm" wrap="nowrap" align="center">
          <ThemeIcon
            variant="transparent"
            color={v ? VERDICT[v.level].color : "gray"}
            size={20}
            aria-hidden
          >
            {v ? VERDICT[v.level].icon : <IconPoint size={14} />}
          </ThemeIcon>
          <Stack gap={0} style={{ flex: "1 1 auto", minWidth: 0 }}>
            <Text
              size="sm"
              fw={600}
              ff={mono ? "monospace" : undefined}
              truncate
              title={title}
            >
              {title}
            </Text>
            <Text size="xs" c="dimmed" ff="monospace" truncate>
              {locationOf(item.doc)}
            </Text>
            {v?.level === "warn" && (
              <Text size="xs" c="orange">
                {v.text}
              </Text>
            )}
          </Stack>
          <Box
            style={{
              flex: "0 1 auto",
              minWidth: 0,
              maxWidth: "45%",
              textAlign: "right",
            }}
          >
            <InlineValue display={item.display} />
          </Box>
          <IconChevronRight
            size={14}
            color="var(--mantine-color-dimmed)"
            aria-hidden
            style={{ flexShrink: 0 }}
          />
        </Group>
      </UnstyledButton>
      <Box pr="sm" style={{ flexShrink: 0 }}>
        <ItemHelp item={item} />
      </Box>
    </Group>
  );
}

/** Carte de section : le même gabarit pour Sécurité, Réseau et Variables. */
function SectionCard({
  icon,
  color,
  title,
  help,
  items,
  empty,
  mono,
  titleOf,
  onOpen,
}: {
  icon: ReactNode;
  color: MantineColor;
  title: string;
  help: string;
  items: EssentialItem[];
  empty: string;
  mono?: boolean;
  titleOf: (it: EssentialItem) => string;
  onOpen: (doc: ConfigSearchDoc) => void;
}) {
  return (
    <Card withBorder radius="md" p={0}>
      <Group
        gap={8}
        wrap="nowrap"
        px="sm"
        py="xs"
        style={{
          borderBottom: "1px solid var(--mantine-color-default-border)",
        }}
      >
        <ThemeIcon variant="light" color={color} size={28} radius="md">
          {icon}
        </ThemeIcon>
        <Text fw={700}>{title}</Text>
        <Badge size="sm" variant="light" color="gray">
          {items.length}
        </Badge>
        <DocHint title={title} summary={help} width={320} />
      </Group>
      {items.length ? (
        <Stack gap={0}>
          {items.map((it, i) => (
            <Row
              key={`${it.doc.moduleKey}:${it.doc.field.key}`}
              item={it}
              title={titleOf(it)}
              mono={mono}
              first={i === 0}
              onOpen={onOpen}
            />
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed" p="sm">
          {empty}
        </Text>
      )}
    </Card>
  );
}

/** Compteur cliquable de la bande de synthèse. */
function Counter({
  value,
  label,
  onClick,
}: {
  value: number;
  label: string;
  onClick?: (() => void) | undefined;
}) {
  const body = (
    <Stack gap={0} align="center" px="xs">
      <Text
        fw={700}
        style={{
          fontSize: 26,
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </Text>
      <Text size="xs" c="dimmed" ta="center">
        {label}
      </Text>
    </Stack>
  );
  return onClick ? (
    <UnstyledButton onClick={onClick}>{body}</UnstyledButton>
  ) : (
    body
  );
}

export function ConfigEssentials({
  index,
  runtime,
  counts,
  onOpen,
  onShowOverrides,
}: ConfigEssentialsProps) {
  const production = runtime?.environment === "production";
  const view = useMemo(
    () => buildGlance(index, { production }),
    [index, production],
  );
  const { summary, endpoints } = view;

  // Points à vérifier, toutes sections confondues, sans doublon (une variable
  // posée qui coupe un verrou apparaît aussi dans « Sécurité »).
  const warns = useMemo(() => {
    const seen = new Set<string>();
    return [...view.security, ...view.network, ...view.env].filter((it) => {
      if (it.verdict?.level !== "warn") return false;
      const id = `${it.doc.moduleKey}:${it.doc.field.key}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [view]);

  const judged = view.security.filter((i) => i.verdict).length;
  const info = view.security.filter((i) => i.verdict?.level === "info").length;
  const pct = (n: number): number => (judged ? (n / judged) * 100 : 0);
  const modeLabel = !runtime
    ? "mode inconnu"
    : production
      ? "Production"
      : runtime.environment === "development"
        ? "Développement"
        : runtime.environment;
  const firstEnv = view.env[0];

  return (
    <Stack gap="md">
      {/* ── 1. Bande de synthèse ─────────────────────────────────────────── */}
      <Card withBorder radius="md" p="md">
        <Group justify="space-between" align="center" gap="lg" wrap="wrap">
          <Group gap="md" wrap="nowrap">
            <RingProgress
              role="img"
              size={88}
              thickness={9}
              roundCaps
              sections={[
                { value: pct(summary.ok), color: "teal" },
                { value: pct(summary.warn), color: "orange" },
                { value: pct(info), color: "blue" },
              ]}
              label={
                <Text ta="center" fw={700} size="md">
                  {summary.ok}/{judged}
                </Text>
              }
              aria-label={`${summary.ok} verrous en place sur ${judged}, ${summary.warn} à vérifier`}
            />
            <Stack gap={2}>
              <Text fw={700} size="lg" c={summary.warn ? "orange" : "teal"}>
                {summary.warn
                  ? `${summary.warn} point${summary.warn > 1 ? "s" : ""} à vérifier`
                  : "Rien à signaler"}
              </Text>
              <Text size="sm" c="dimmed">
                {summary.ok} verrou{summary.ok > 1 ? "s" : ""} de sécurité en
                place sur {judged} examinés
              </Text>
            </Stack>
          </Group>

          <Stack gap={6} style={{ minWidth: 0 }}>
            <Group gap={8} wrap="nowrap">
              <Text size="xs" c="dimmed" fw={700} tt="uppercase" w={56}>
                Mode
              </Text>
              <Badge
                variant="light"
                color={production ? "blue" : "teal"}
                tt="none"
              >
                {modeLabel}
              </Badge>
              {runtime?.debug && (
                <Badge variant="light" color="orange" tt="none">
                  debug
                </Badge>
              )}
            </Group>
            <Group gap={8} wrap="wrap">
              <Text size="xs" c="dimmed" fw={700} tt="uppercase" w={56}>
                Écoute
              </Text>
              {endpoints.length ? (
                endpoints.map((ep) => (
                  <UnstyledButton
                    key={ep.url}
                    onClick={() => onOpen(ep.doc)}
                    title={`${ep.label} — ouvrir le réglage du port`}
                  >
                    <Code
                      style={{
                        fontSize: 12,
                        whiteSpace: "nowrap",
                        // Pas de zone qui défile : une pastille trop longue se coupe.
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "100%",
                      }}
                    >
                      {ep.url}
                    </Code>
                  </UnstyledButton>
                ))
              ) : (
                <Text size="xs" c="dimmed">
                  aucun port exposé
                </Text>
              )}
              {endpoints[0]?.allInterfaces && (
                <Text size="xs" c="dimmed">
                  toutes les interfaces
                </Text>
              )}
            </Group>
          </Stack>

          <Group gap="md" wrap="nowrap">
            <Counter
              value={counts.modified}
              label="réglages modifiés"
              onClick={onShowOverrides}
            />
            <Counter
              value={view.env.length}
              label="variables posées"
              onClick={firstEnv ? () => onOpen(firstEnv.doc) : undefined}
            />
            <Counter value={counts.secrets} label="secrets masqués" />
          </Group>
        </Group>
      </Card>

      {/* ── 2. À vérifier d'abord ────────────────────────────────────────── */}
      {warns.length > 0 && (
        <Alert
          color="orange"
          variant="light"
          radius="md"
          icon={<IconAlertTriangle size={20} />}
          title="À vérifier d'abord"
        >
          <Stack gap={8}>
            {warns.map((it) => (
              <Group
                key={`${it.doc.moduleKey}:${it.doc.field.key}`}
                justify="space-between"
                wrap="nowrap"
                gap="md"
              >
                <Stack gap={0} style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600}>
                    {it.label} : {displayText(it.display)}
                    {it.doc.envSet ? (
                      <Text span size="xs" c="dimmed" ff="monospace">
                        {"  "}(posé par {it.doc.envSet})
                      </Text>
                    ) : null}
                  </Text>
                  <Text size="sm">{it.verdict?.text}</Text>
                </Stack>
                <Button
                  size="xs"
                  variant="light"
                  color="orange"
                  rightSection={<IconChevronRight size={14} />}
                  onClick={() => onOpen(it.doc)}
                  style={{ flexShrink: 0 }}
                >
                  Ouvrir le réglage
                </Button>
              </Group>
            ))}
          </Stack>
        </Alert>
      )}

      {/* ── 3. Sections ─────────────────────────────────────────────────── */}
      <Grid>
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <SectionCard
            icon={<IconLock size={16} />}
            color={summary.warn ? "orange" : "teal"}
            title="Sécurité"
            help="Les verrous qu'on vérifie d'abord, chacun avec son verdict. La bulle ⓘ d'une ligne dit ce que règle le réglage et comment le changer. Ce sont des règles simples : elles signalent ce qui mérite un second regard, elles ne remplacent pas un audit."
            items={view.security}
            empty="Aucun verrou exposé : le module de sécurité est-il chargé ?"
            titleOf={(it) => it.label}
            onOpen={onOpen}
          />
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Stack gap="md">
            <SectionCard
              icon={<IconWorld size={16} />}
              color="brand"
              title="Réseau"
              help="Par où l'on entre dans l'application, et à qui l'on fait confiance devant elle : le domaine, ses autres noms, le proxy, les noms d'hôte acceptés."
              items={view.network}
              empty="Aucun de ces réglages n'est exposé par l'application."
              titleOf={(it) => it.label}
              onOpen={onOpen}
            />
            <SectionCard
              icon={<IconKey size={16} />}
              color="grape"
              title="Variables posées"
              help="Chaque réglage qu'une variable d'environnement a changé (.env du poste, ou l'hébergeur). Elle l'emporte sur nodefony.config.ts : si l'application ne fait pas ce que dit le fichier, la réponse est souvent ici."
              items={view.env}
              empty="Aucune : tout vient de nodefony.config.ts ou des valeurs d'usine."
              mono
              titleOf={(it) =>
                it.doc.envSet ?? it.doc.envVar ?? it.doc.field.key
              }
              onOpen={onOpen}
            />
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
