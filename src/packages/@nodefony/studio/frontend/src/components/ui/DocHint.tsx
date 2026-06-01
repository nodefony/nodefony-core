import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Group,
  HoverCard,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import type { MantineColor } from "@mantine/core";
import {
  IconInfoCircle,
  IconBook2,
  IconChartLine,
  IconExternalLink,
  IconBulb,
  IconAlertTriangle,
} from "@tabler/icons-react";
import type { FC, ReactNode } from "react";

/** Un paragraphe structuré d'une fiche {@link Hint}. */
export interface DocSection {
  /** Intitulé court du paragraphe (ex. « Technique », « Si vide / 0 »). */
  label: string;
  /** Corps du paragraphe (texte ou nœuds — dynamique autorisé). */
  body: ReactNode;
}

/** Lien externe d'une fiche (rendu sécurisé : `target=_blank` + `rel=noreferrer`). */
export interface HintLink {
  label: string;
  href: string;
}

/** Type de bulle d'aide — pilote l'icône, l'accent et le badge. */
export type HintKind = "doc" | "graph" | "link" | "tip" | "warning";

/** Config visuelle par type (icône déclencheur + en-tête, accent, libellé badge). */
const HINT_KINDS: Record<
  HintKind,
  {
    trigger: FC<{ size?: number; stroke?: number }>;
    header: FC<{ size?: number }>;
    accent: MantineColor;
    badge: string;
  }
> = {
  doc: {
    trigger: IconInfoCircle,
    header: IconBook2,
    accent: "brand",
    badge: "doc",
  },
  graph: {
    trigger: IconChartLine,
    header: IconChartLine,
    accent: "blue",
    badge: "graphe",
  },
  link: {
    trigger: IconExternalLink,
    header: IconExternalLink,
    accent: "grape",
    badge: "lien",
  },
  tip: { trigger: IconBulb, header: IconBulb, accent: "teal", badge: "astuce" },
  warning: {
    trigger: IconAlertTriangle,
    header: IconAlertTriangle,
    accent: "yellow",
    badge: "attention",
  },
};

export interface HintProps {
  /** Type de la bulle (icône + accent + badge). Défaut « doc ». */
  kind?: HintKind;
  /** Titre de la fiche (= le sujet documenté). */
  title: string;
  /** Version de la doc (badge d'en-tête, ex. « v1.0 »). */
  version?: string;
  /** Résumé en une phrase (lead). */
  summary?: ReactNode;
  /** Paragraphes structurés (retrouvés tels quels dans la doc plus tard). */
  sections?: DocSection[];
  /** Liens externes (rendus sécurisés). */
  links?: HintLink[];
  /** Largeur du dropdown (px). Défaut 360. */
  width?: number;
  /**
   * Déclencheur **custom** (ex. un `Badge`/chip) : remplace l'icône ⓘ par
   * défaut → le contenu lui-même ouvre la fiche au survol. L'élément doit
   * accepter une `ref` (composant Mantine OK) ; le rendre focusable
   * (`tabIndex={0}`) pour l'ouverture au clavier (a11y).
   */
  children?: ReactNode;
}

/**
 * **Hint** — bulle d'aide **typée** façon fiche de documentation (≠ tooltip brut).
 * Le `kind` choisit l'icône, l'accent et le badge : `doc` (📖), `graph` (📈),
 * `link` (🔗 externe), `tip` (💡), `warning` (⚠). En-tête (icône + titre + badge
 * version), résumé, **paragraphes structurés** (Technique, Si vide/0…) et **liens
 * externes** sécurisés. Réutilisable partout dans Studio ; le contenu structuré
 * pourra alimenter la doc (`docs/`) plus tard.
 *
 * Ouvre au **survol** ET au **focus clavier** (a11y) ; reste ouverte quand on entre
 * dans la carte (lecture + sélection). Contenu rendu en TEXTE (aucun HTML injecté).
 */
export function Hint({
  kind = "doc",
  title,
  version,
  summary,
  sections = [],
  links = [],
  width = 360,
  children,
}: HintProps) {
  const cfg = HINT_KINDS[kind];
  const Trigger = cfg.trigger;
  const Header = cfg.header;
  return (
    <HoverCard
      width={width}
      shadow="md"
      radius="md"
      withArrow
      openDelay={100}
      closeDelay={120}
      position="top"
      withinPortal
    >
      <HoverCard.Target>
        {children ?? (
          <ActionIcon
            variant="subtle"
            color={kind === "doc" ? "gray" : cfg.accent}
            size="sm"
            radius="xl"
            aria-label={`${cfg.badge} : ${title}`}
          >
            <Trigger size={15} stroke={1.6} />
          </ActionIcon>
        )}
      </HoverCard.Target>
      <HoverCard.Dropdown p={0}>
        {/* En-tête : impression de fiche (icône typée + titre + badge). */}
        <Box
          p="xs"
          style={{
            borderBottom: "1px solid var(--mantine-color-default-border)",
            background: "var(--mantine-color-default-hover)",
            borderTopLeftRadius: "var(--mantine-radius-md)",
            borderTopRightRadius: "var(--mantine-radius-md)",
          }}
        >
          <Group gap={8} wrap="nowrap" justify="space-between">
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <ThemeIcon
                variant="light"
                color={cfg.accent}
                size="sm"
                radius="sm"
              >
                <Header size={14} />
              </ThemeIcon>
              <Text fw={700} size="sm" truncate>
                {title}
              </Text>
            </Group>
            <Badge size="xs" variant="light" color={cfg.accent} tt="none">
              {cfg.badge}
              {version ? ` ${version}` : ""}
            </Badge>
          </Group>
        </Box>
        {/* Corps : résumé + paragraphes + liens. */}
        <Stack gap="sm" p="sm">
          {summary ? (
            <Text size="sm" c="dimmed">
              {summary}
            </Text>
          ) : null}
          {sections.map((s, i) => (
            <Box key={`${s.label}-${i}`}>
              <Text
                size="xs"
                fw={700}
                tt="uppercase"
                c={cfg.accent}
                style={{ letterSpacing: 0.4 }}
                mb={2}
              >
                {s.label}
              </Text>
              <Text size="xs" c="dimmed">
                {s.body}
              </Text>
            </Box>
          ))}
          {links.length > 0 ? (
            <Stack gap={4}>
              {links.map((l) => (
                <Anchor
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  size="xs"
                >
                  <Group gap={4} wrap="nowrap" component="span">
                    <IconExternalLink size={12} />
                    {l.label}
                  </Group>
                </Anchor>
              ))}
            </Stack>
          ) : null}
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

/** Props des presets typés (le `kind` est fixé par le preset). */
export type DocHintProps = Omit<HintProps, "kind">;

/** Fiche **documentation** (📖) — `<Hint kind="doc"/>`. */
export const DocHint: FC<DocHintProps> = (p) => <Hint kind="doc" {...p} />;
/** Fiche **graphe** (📈) — explique comment lire une courbe / une métrique. */
export const GraphHint: FC<DocHintProps> = (p) => <Hint kind="graph" {...p} />;
/** Fiche **lien externe** (🔗) — pointe une ressource (RFC, doc tierce). */
export const LinkHint: FC<DocHintProps> = (p) => <Hint kind="link" {...p} />;
/** Fiche **astuce** (💡) — conseil d'usage, raccourci. */
export const TipHint: FC<DocHintProps> = (p) => <Hint kind="tip" {...p} />;
/** Fiche **attention** (⚠) — limite, piège, prérequis. */
export const WarnHint: FC<DocHintProps> = (p) => <Hint kind="warning" {...p} />;
