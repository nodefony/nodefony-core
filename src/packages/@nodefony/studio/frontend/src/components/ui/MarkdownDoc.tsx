import {
  Children,
  cloneElement,
  isValidElement,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Box,
  Group,
  Modal,
  Paper,
  Text,
  Tooltip,
  Typography,
  rem,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconBulb,
  IconCheck,
  IconCopy,
  IconExclamationMark,
  IconInfoCircle,
} from "@tabler/icons-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { slugifyHeading } from "./DocToc";
import { HEADING_SCROLL_MARGIN, MODAL_FULLSCREEN_BODY } from "./layout";
import { LiveGraphSection } from "../../realtime/socket/LiveGraphSection";
import {
  LIVE_GRAPH_NAMES,
  resolveLiveGraph,
} from "../../realtime/socket/liveGraphs";

/** Texte plat d'un nœud React (pour calculer l'ancre `id` d'un titre). */
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) {
    return nodeText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** Décale l'ancre sous l'en-tête sticky (titre non masqué après un saut). */
const HEADING_STYLE = { scrollMarginTop: HEADING_SCROLL_MARGIN } as const;

/* ════════════════════════════════════════════════════════════════════════
 * MarkdownDoc — rendu markdown RÉUTILISABLE (GFM + Mermaid + liens sûrs).
 *
 * Brique unique de présentation de doc : utilisée par l'onglet Docs des modules
 * (`ModuleDetail`), la démo `/nodefony/documentation`, et le futur module
 * @nodefony/documentation. Sécurité : pas de `rehype-raw` (0 HTML injecté),
 * Mermaid en `securityLevel:"strict"`, liens externes `rel="noreferrer noopener"`.
 *
 * Surcharges « template impeccable » :
 *  - admonitions GFM : `> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]` → <Alert>.
 *  - heading anchors : icône # cliquable au hover (copie l'URL profond).
 *  - code blocks : topbar « langue + Copier » (pas de syntax highlighting, différé).
 * ════════════════════════════════════════════════════════════════════════ */

/** Injecte UNE seule fois les styles statiques (hover anchor) — `:hover` ≠ inline. */
function ensureDocStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("nf-doc-styles")) return;
  const s = document.createElement("style");
  s.id = "nf-doc-styles";
  s.textContent = `
    /* Un schéma se lit D'ABORD EN ENTIER. Mermaid pose \`max-width\` EN LIGNE sur
       son SVG et le comprime à la largeur de la colonne : un \`flowchart\` s'étire
       alors en hauteur (mesuré 351 × 1549 px), et il faut défiler pour en voir des
       bouts — sans jamais avoir la vue d'ensemble. On le met à l'ÉCHELLE : il tient
       dans la largeur ET la hauteur offertes, ratio préservé. Le zoom se fait en
       ouvrant le schéma, pas en le parcourant au doigt. */
    .nf-mermaid > svg {
      max-width: 100% !important;
      /* dvh et non vh : sur mobile, la barre d'adresse escamotable fausse vh,
         et le schéma déborde de l'écran au premier défilement. */
      max-height: 60dvh;
      width: auto;
      height: auto;
    }
    /* Ouvert : le schéma prend TOUTE la place offerte, sans jamais la dépasser.
       Le rendre à sa taille réelle le laissait déborder — « trop gros », et on
       revenait à devoir le parcourir au lieu de le voir. L'échelle reste donc
       relative à la FENÊTRE, ici comme dans le corps de la page ; seul le
       plafond change, parce que la place disponible change. */
    .nf-mermaid-zoom > svg {
      max-width: 100% !important;
      max-height: calc(100dvh - 9rem);
    }
    .nf-heading { position: relative; }
    .nf-heading-anchor {
      opacity: 0;
      transition: opacity 0.15s ease;
      margin-left: 0.4em;
      color: var(--mantine-color-dimmed);
      text-decoration: none;
      font-weight: normal;
      cursor: pointer;
      user-select: none;
    }
    .nf-heading:hover .nf-heading-anchor,
    .nf-heading:focus-within .nf-heading-anchor { opacity: 0.7; }
    .nf-heading-anchor:hover,
    .nf-heading-anchor:focus { opacity: 1 !important; color: var(--mantine-primary-color-filled); outline: none; }
    @media (prefers-reduced-motion: reduce) { .nf-heading-anchor { transition: none; } }

    /* Catalogue de briques : l'en-tête de card (nom en pastille + libellé). */
    .nf-brick-h {
      display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
      border-left: 3px solid var(--mantine-primary-color-filled);
      background: var(--mantine-color-default-hover);
      border-radius: 8px; padding: 10px 14px;
    }
    .nf-brick-name {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.82em; font-weight: 700;
      color: var(--mantine-primary-color-filled);
      background: var(--mantine-color-default);
      padding: 2px 10px; border-radius: 20px; white-space: nowrap;
    }
    .nf-brick-name a { color: inherit; text-decoration: none; }
    .nf-brick-title { font-size: 0.92em; }
    .nf-brick-h:hover { border-left-color: var(--mantine-primary-color-filled); }

    /* Grille de cards d'un catalogue (bloc de fence nodefony-cards).
       Parti pris : card d'INFORMATION sobre — pastille d'icône, titre net,
       description atténuée, méta discrète, chevron d'affordance. Aucune ombre
       portée ni dégradé : la hiérarchie vient de la typo et de l'espacement. */
    /* ── Grille de cards ──────────────────────────────────────────────────
       Respiration d'abord : une card de catalogue se BALAIE, elle ne se lit
       pas en continu. Colonnes plus larges et gouttière franche pour que
       chaque card se détache comme un objet, au lieu de former un bloc. */
    .nf-cards {
      display: grid; gap: 14px; margin: 1.5em 0;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      align-items: stretch;
    }

    /* 🔴 ZÉRO SOULIGNEMENT, à aucun état. Une card est une SURFACE cliquable,
       pas un lien dans une phrase : souligner son contenu au survol barbouille
       le titre, la description ET la méta d'un trait. Le wrapper Typography de
       Mantine style les ancres au survol, il faut donc désamorcer explicitement
       — sur la card ET sur toute sa descendance, à tous les états. */
    .nf-card,
    .nf-card *,
    .nf-card:hover,
    .nf-card:hover *,
    .nf-card:focus,
    .nf-card:focus-visible,
    .nf-card:active,
    .nf-card:active * {
      text-decoration: none;
    }

    .nf-card {
      display: flex; align-items: flex-start; gap: 13px;
      padding: 16px 18px; color: inherit;
      background: var(--mantine-color-body);
      border-color: var(--mantine-color-default-border);
    }

    /* Un seul signal de survol qui PORTE — l'élévation. La bordure d'accent et
       la teinte du titre l'accompagnent discrètement ; trois signaux d'égale
       force se diluaient et rendaient le survol illisible. */
    .nf-card-link {
      cursor: pointer;
      transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
      will-change: transform;
    }
    .nf-card-link:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 18px -6px rgba(0, 0, 0, .28);
      border-color: color-mix(in srgb, var(--mantine-primary-color-filled) 55%, var(--mantine-color-default-border));
    }
    .nf-card-link:active { transform: translateY(0); box-shadow: none; }
    .nf-card-link:hover .nf-card-title { color: var(--mantine-primary-color-filled); }
    .nf-card-link:hover .nf-card-go { opacity: .9; transform: translateX(3px); }
    .nf-card-link:hover .nf-card-icon {
      background: color-mix(in srgb, var(--mantine-primary-color-filled) 22%, transparent);
    }
    .nf-card-link:focus-visible {
      outline: 2px solid var(--mantine-primary-color-filled);
      outline-offset: 3px;
    }

    /* Pastille d'icône : repère stable à gauche, taille fixe → les colonnes de
       texte s'alignent d'une card à l'autre même quand les titres diffèrent. */
    .nf-card-icon {
      flex: 0 0 auto; width: 36px; height: 36px; border-radius: 10px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 18px; line-height: 1;
      background: color-mix(in srgb, var(--mantine-primary-color-filled) 13%, transparent);
      transition: background-color .16s ease;
    }

    .nf-card-body { display: flex; flex-direction: column; min-width: 0; gap: 4px; flex: 1 1 auto; }
    .nf-card-title {
      font-weight: 650; font-size: 15px; line-height: 1.25;
      letter-spacing: -0.01em;
      transition: color .16s ease;
    }
    /* La description porte le vrai contenu : elle doit rester CONFORTABLE.
       Contraste relevé d'un cran par rapport au gris atténué — une description
       qu'on doit deviner ne sert à rien. */
    .nf-card-desc {
      font-size: 13.2px; line-height: 1.5;
      color: var(--mantine-color-text);
      opacity: .78;
    }
    .nf-card-meta {
      font-size: 11.5px; line-height: 1.3; color: var(--mantine-color-dimmed);
      margin-top: 3px; font-variant-numeric: tabular-nums;
    }
    .nf-card-go {
      flex: 0 0 auto; align-self: center; opacity: .3; font-size: 16px;
      color: var(--mantine-primary-color-filled);
      transition: opacity .16s ease, transform .16s ease;
    }

    /* Card mise en avant : pleine largeur, liseré d'accent — un point d'entrée
       unique se distingue du catalogue sans crier. */
    .nf-card-featured {
      grid-column: 1 / -1;
      border-left: 3px solid var(--mantine-primary-color-filled);
      background: color-mix(in srgb, var(--mantine-primary-color-filled) 6%, var(--mantine-color-body));
    }
    .nf-card-featured .nf-card-title { font-size: 16px; }
    .nf-card-featured .nf-card-icon { width: 40px; height: 40px; font-size: 20px; }

    /* Ombre plus dense en thème sombre : sur fond foncé, une ombre légère ne se
       voit pas — l'élévation serait perdue exactement là où elle porte seule. */
    @media (prefers-color-scheme: dark) {
      .nf-card-link:hover { box-shadow: 0 8px 22px -6px rgba(0, 0, 0, .6); }
    }
    [data-mantine-color-scheme="dark"] .nf-card-link:hover {
      box-shadow: 0 8px 22px -6px rgba(0, 0, 0, .6);
    }

    @media (prefers-reduced-motion: reduce) {
      .nf-card-link, .nf-card-go, .nf-card-title, .nf-card-icon { transition: none; }
      .nf-card-link:hover { transform: none; }
      .nf-card-link:hover .nf-card-go { transform: none; }
    }
  `;
  document.head.appendChild(s);
}

/* ─── Admonitions (GitHub flavor) ────────────────────────────────────────── */

interface AdmonitionMeta {
  title: string;
  color: string;
  icon: ReactNode;
}

const ADMONITIONS: Record<string, AdmonitionMeta> = {
  note: { title: "Note", color: "blue", icon: <IconInfoCircle size={18} /> },
  tip: { title: "Astuce", color: "teal", icon: <IconBulb size={18} /> },
  important: {
    title: "Important",
    color: "violet",
    icon: <IconAlertCircle size={18} />,
  },
  warning: {
    title: "Avertissement",
    color: "yellow",
    icon: <IconAlertTriangle size={18} />,
  },
  caution: {
    title: "Attention",
    color: "red",
    icon: <IconExclamationMark size={18} />,
  },
};

const ADMONITION_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i;

/**
 * Cherche `[!TYPE]` dans le premier text node du blockquote ; si trouvé →
 * retourne le type + les children avec le préfixe retiré. Sinon `null`.
 *
 * Pourquoi : `remark-gfm` ne parse pas les admonitions GitHub — le marqueur
 * arrive ici comme du texte brut dans le 1ᵉʳ paragraphe du blockquote.
 */
function parseAdmonition(
  children: ReactNode,
): { meta: AdmonitionMeta; rest: ReactNode } | null {
  let typeKey: string | null = null;

  const strip = (node: ReactNode): ReactNode => {
    if (typeKey) return node;
    if (typeof node === "string") {
      const m = ADMONITION_RE.exec(node);
      if (!m) return node;
      typeKey = m[1].toLowerCase();
      const cleaned = node.replace(ADMONITION_RE, "");
      return cleaned ? cleaned : null;
    }
    if (Array.isArray(node)) {
      const out = node.map(strip).filter((c) => c !== null && c !== "");
      return out;
    }
    if (isValidElement(node)) {
      const childrenProp = (node.props as { children?: ReactNode }).children;
      const stripped = strip(childrenProp);
      if (typeKey)
        return cloneElement(
          node as React.ReactElement<{ children?: ReactNode }>,
          {},
          stripped,
        );
      return node;
    }
    return node;
  };

  const rest = strip(children);
  if (!typeKey) return null;
  const meta = ADMONITIONS[typeKey];
  return meta ? { meta, rest } : null;
}

/* ─── Mermaid (rendu vectoriel theme-aware) ──────────────────────────────── */

/** Rend un block ```mermaid``` en SVG vectoriel (lazy, theme-aware). */
export function MermaidDiagram({ code }: { code: string }) {
  const { colorScheme } = useMantineColorScheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  // Le SVG rendu est gardé pour la vue agrandie — la re-générer appellerait
  // mermaid une seconde fois pour le même diagramme.
  const [svgHtml, setSvgHtml] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: colorScheme === "light" ? "default" : "dark",
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        const { svg } = await mermaid.render(
          `mermaid-${baseId}-${Date.now()}`,
          code,
        );
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setSvgHtml(svg);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, colorScheme, baseId]);
  if (error) {
    return (
      <Alert color="orange" icon={<IconAlertTriangle size={16} />} my="md">
        <Box
          component="pre"
          style={{
            margin: 0,
            fontSize: rem(12),
            whiteSpace: "pre-wrap",
            overflowX: "auto",
          }}
        >
          {code}
        </Box>
        <Text size="xs" c="dimmed" mt="xs">
          {error}
        </Text>
      </Alert>
    );
  }
  // Un diagramme garde ses PROPORTIONS et défile dans son propre cadre — il ne
  // s'écrase pas à la largeur de la colonne. Mermaid écrit un `max-width` EN LIGNE
  // sur le SVG qu'il rend : contraint à 576 px dans une mise en page à trois
  // colonnes, un `flowchart` s'étire en hauteur (mesuré : 351 × 1549 px sur la vue
  // d'ensemble — un ruban illisible). La règle `.nf-mermaid > svg` d'
  // `ensureDocStyles` annule cette contrainte ; ici on borne la hauteur et on
  // laisse le conteneur défiler.
  return (
    <>
      <Box
        ref={containerRef}
        className="nf-mermaid"
        my="md"
        onClick={() => setZoom(true)}
        title="Agrandir le schéma"
        style={{ textAlign: "center", cursor: "zoom-in" }}
      />
      {/* Le schéma à sa taille réelle, quand la vue d'ensemble ne suffit plus.
          Le contenu est réinjecté ici : le SVG rendu par mermaid vit dans le
          conteneur ci-dessus, on n'en fabrique pas un second. */}
      <Modal
        opened={zoom}
        onClose={() => setZoom(false)}
        fullScreen
        radius={0}
        title="Schéma"
        styles={{ body: { height: MODAL_FULLSCREEN_BODY, overflow: "auto" } }}
      >
        <Box
          className="nf-mermaid nf-mermaid-zoom"
          style={{ textAlign: "center" }}
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      </Modal>
    </>
  );
}

/* ─── Code block enrichi (topbar langue + Copier) ────────────────────────── */

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  }, [code]);
  return (
    <Paper withBorder radius="md" my="md" style={{ overflow: "hidden" }}>
      <Group
        justify="space-between"
        px="sm"
        py={4}
        wrap="nowrap"
        style={{
          background: "var(--mantine-color-default-hover)",
          borderBottom: "1px solid var(--mantine-color-default-border)",
        }}
      >
        <Text
          size="xs"
          c="dimmed"
          ff="monospace"
          tt="lowercase"
          style={{ userSelect: "none" }}
        >
          {language || "text"}
        </Text>
        <Tooltip label={copied ? "Copié" : "Copier"} withinPortal>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            onClick={copy}
            aria-label={copied ? "Code copié" : "Copier le bloc de code"}
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          </ActionIcon>
        </Tooltip>
      </Group>
      <Box
        component="pre"
        style={{
          margin: 0,
          padding: rem(12),
          overflowX: "auto",
          fontSize: rem(13),
          lineHeight: 1.6,
        }}
      >
        <code>{code}</code>
      </Box>
    </Paper>
  );
}

/** Style inline de l'en-tête de card (le reste vit dans `ensureDocStyles`). */
const BRICK_HEADING_STYLE = {
  scrollMarginTop: HEADING_SCROLL_MARGIN,
  marginTop: "1.4em",
  marginBottom: "0.4em",
} as const;

/* ─── Bloc déclaratif ```nodefony-livegraph → graphe live ────────────────── */

/** Ce qu'une page écrit dans la fence. Seul `graph` est obligatoire. */
interface DocLiveGraphSpec {
  /** Nom du graphe dans le registre (`backplane`, `protocole`, …). */
  graph: string;
  /** Hauteur en pixels (défaut : celle de `LiveGraphSection`). */
  height?: number;
  /** Titre du bloc — sinon « Schéma live ». */
  title?: string;
  /** Phrase d'explication sous le titre. */
  hint?: string;
}

/**
 * Monte un **graphe live** là où l'auteur l'a posé dans la page — au fil du
 * propos, pas en pied de page.
 *
 * Même principe que Mermaid et `nodefony-cards` : une fence typée = un
 * composant, le contenu reste du JSON versionnable, et le markdown ne porte
 * jamais de HTML brut. Le graphe est chargé à la demande (`lazy`) : une page
 * sans fence ne tire ni `FlowGraph` ni les hooks temps réel.
 *
 * Robuste par construction — JSON invalide ou nom inconnu n'efface pas la
 * page : le bloc reste lisible en brut, avec la raison.
 */
function DocLiveGraph({ json }: { json: string }) {
  let spec: DocLiveGraphSpec | null = null;
  let error: string | null = null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("un objet est attendu");
    }
    const g = (parsed as { graph?: unknown }).graph;
    if (typeof g !== "string" || g.length === 0) {
      throw new Error("champ `graph` manquant");
    }
    spec = parsed as DocLiveGraphSpec;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const Graph = spec ? resolveLiveGraph(spec.graph) : undefined;

  if (!spec || !Graph) {
    return (
      <Alert color="orange" title="Graphe live non rendu" mt="md">
        <Text size="sm" mb="xs">
          {error ??
            `Graphe « ${spec?.graph ?? "?"} » inconnu. Disponibles : ${LIVE_GRAPH_NAMES.join(", ")}.`}
        </Text>
        <pre style={{ margin: 0, overflowX: "auto", fontSize: "0.8em" }}>
          {json}
        </pre>
      </Alert>
    );
  }

  return (
    <Suspense
      fallback={
        <Paper withBorder radius="md" p="md" mt="xl">
          <Text size="sm" c="dimmed">
            Chargement du schéma…
          </Text>
        </Paper>
      }
    >
      <LiveGraphSection
        LiveGraph={Graph}
        height={spec.height}
        title={spec.title}
        hint={spec.hint}
      />
    </Suspense>
  );
}

/* ─── Bloc déclaratif ```nodefony-cards → grille de cards ────────────────── */

/** Une card de catalogue, telle qu'écrite dans le bloc JSON de la page. */
interface DocCardItem {
  /** Titre affiché (obligatoire — une card sans titre n'a pas de sens). */
  title: string;
  /** Cible : lien `.md` traduit en slug par le serveur, ou URL externe. */
  href?: string;
  /** Pictogramme (emoji) — purement décoratif, jamais porteur de sens seul. */
  icon?: string;
  /** Une à deux phrases : à quoi ça sert, quand on en a besoin. */
  desc?: string;
  /** Repère court affiché en pied (ex. « 13 pages », « stable »). */
  meta?: string;
  /** Card mise en avant : pleine largeur, accentuée (un point d'entrée unique). */
  featured?: boolean;
}

/**
 * Rend un catalogue en **grille de cards** — ce qu'un enchaînement de titres
 * markdown ne peut pas produire : react-markdown rend à plat, donc le corps
 * d'une card n'est pas englobable. D'où le bloc déclaratif.
 *
 * Robuste par construction : un JSON invalide n'efface pas la page, il affiche
 * le bloc brut (une page de doc doit rester lisible même mal écrite).
 */
function DocCards({
  json,
  onNavigate,
}: {
  json: string;
  onNavigate?: (slug: string) => boolean;
}) {
  let items: DocCardItem[] = [];
  let error: string | null = null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error("un tableau est attendu");
    items = parsed.filter(
      (i): i is DocCardItem =>
        typeof i === "object" &&
        i !== null &&
        typeof (i as DocCardItem).title === "string",
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (error || !items.length) {
    return (
      <Alert color="yellow" variant="light" title="Bloc de cards illisible">
        <Text size="sm">{error ?? "aucune card valide dans ce bloc"}</Text>
      </Alert>
    );
  }
  const go = (href?: string) => (e: React.MouseEvent) => {
    if (!href || !onNavigate) return;
    // Même tolérance que les liens markdown ordinaires (cf l'override `a`) :
    // `./page.md` autant que `page.md`. Un auteur écrit naturellement la forme
    // relative — elle est lisible sur GitHub — et exiger ici la forme nue
    // fabriquait des cards qui s'affichent bien mais ne naviguent pas, sans
    // qu'aucun gate puisse le voir : le fichier existe, le lien est juste inerte.
    const slug = href.match(/^\.?\/?([A-Za-z0-9._~-]+)\.md(?:#.*)?$/)?.[1];
    if (slug && onNavigate(slug)) e.preventDefault();
  };
  return (
    <Box className="nf-cards">
      {items.map((it) => (
        <Paper
          key={it.title}
          component={it.href ? "a" : "div"}
          href={it.href}
          onClick={go(it.href)}
          withBorder
          radius="md"
          className={[
            "nf-card",
            it.href ? "nf-card-link" : "",
            it.featured ? "nf-card-featured" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {/* Pictogramme dans une pastille : l'œil accroche un repère stable
              à gauche, la colonne de texte reste alignée d'une card à l'autre. */}
          {it.icon ? (
            <span className="nf-card-icon" aria-hidden="true">
              {it.icon}
            </span>
          ) : null}
          <span className="nf-card-body">
            <span className="nf-card-title">{it.title}</span>
            {it.desc ? <span className="nf-card-desc">{it.desc}</span> : null}
            {it.meta ? <span className="nf-card-meta">{it.meta}</span> : null}
          </span>
          {/* Chevron : dit que la card MÈNE quelque part (affordance), et
              glisse au survol. Décoratif — le titre porte déjà le sens. */}
          {it.href ? (
            <span className="nf-card-go" aria-hidden="true">
              →
            </span>
          ) : null}
        </Paper>
      ))}
    </Box>
  );
}

/* ─── Catalogue de briques : `### `nom` — titre` → en-tête de card ───────── */

/** Titre de card reconnu : le nom (code inline, parfois lié) et son libellé. */
interface BrickHeading {
  name: ReactNode;
  title: string;
}

/** L'élément est-il un `<code>` (éventuellement enveloppé dans un `<a>`) ? */
function codeOf(node: ReactNode): ReactNode | null {
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === "code") return el;
  // Nom LIÉ (`### [\`cors\`](cors.md) — …`) : le lien porte le code.
  if (
    el.type === "a" ||
    typeof el.type === "function" ||
    typeof el.type === "object"
  ) {
    const inner = Children.toArray(el.props?.children ?? []);
    if (
      inner.length === 1 &&
      isValidElement(inner[0]) &&
      inner[0].type === "code"
    ) {
      return el; // on garde le lien : la card reste cliquable
    }
  }
  return null;
}

/**
 * Reconnaît `### \`nom\` — titre` (le motif de catalogue du standard).
 *
 * Retourne `null` dès que la forme n'y est pas — un `###` ordinaire doit rester
 * un titre ordinaire, jamais une card par accident.
 */
function parseBrickHeading(children: ReactNode): BrickHeading | null {
  const parts = Children.toArray(children);
  if (parts.length < 2) return null;
  const name = codeOf(parts[0]);
  if (!name) return null;
  const rest = parts
    .slice(1)
    .map((p) => (typeof p === "string" ? p : nodeText(p)))
    .join("")
    .trim();
  const title = rest.replace(/^[—–-]\s*/, "").trim();
  if (!title || title === rest) return null; // pas de séparateur → pas une card
  return { name, title };
}

/* ─── Heading avec anchor cliquable au hover ─────────────────────────────── */

function HeadingWithAnchor({
  level,
  children,
}: {
  level: 2 | 3 | 4;
  children: ReactNode;
}) {
  useEffect(() => ensureDocStyles(), []);
  const id = slugifyHeading(nodeText(children));
  const label = nodeText(children);
  const onAnchorClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      if (typeof window === "undefined") return;
      const url = `${window.location.origin}${window.location.pathname}#${id}`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).catch(() => {});
      }
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      document.getElementById(id)?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "start",
      });
    },
    [id],
  );
  const anchor = (
    <a
      href={`#${id}`}
      className="nf-heading-anchor"
      onClick={onAnchorClick}
      aria-label={`Lien vers la section : ${label}`}
    >
      #
    </a>
  );
  if (level === 2) {
    return (
      <h2 id={id} className="nf-heading" style={HEADING_STYLE}>
        {children}
        {anchor}
      </h2>
    );
  }
  if (level === 3) {
    // Catalogue de briques (standard §6-ergo n°6) : `### \`nom\` — titre` — le nom en
    // code inline, éventuellement lié (forme d'un hub). Rendu en EN-TÊTE DE CARD :
    // pastille + titre sur un liseré d'accent, pour que la série se balaie d'un œil.
    const card = parseBrickHeading(children);
    if (card) {
      return (
        <h3
          id={id}
          className="nf-heading nf-brick-h"
          style={BRICK_HEADING_STYLE}
        >
          <span className="nf-brick-name">{card.name}</span>
          <span className="nf-brick-title">{card.title}</span>
          {anchor}
        </h3>
      );
    }
    return (
      <h3 id={id} className="nf-heading" style={HEADING_STYLE}>
        {children}
        {anchor}
      </h3>
    );
  }
  return (
    <h4 id={id} className="nf-heading" style={HEADING_STYLE}>
      {children}
      {anchor}
    </h4>
  );
}

/* ─── MarkdownDoc — composant principal ──────────────────────────────────── */

export interface MarkdownDocProps {
  markdown: string;
  /**
   * Clic sur un lien interne `xxx.md` → callback (slug). Si absent, le lien
   * `.md` est rendu en ancre normale. Permet à un TOC de naviguer.
   */
  onInternalLink?: (slug: string) => boolean;
  /** Largeur max de la colonne de lecture (px). Défaut 860. */
  maxWidth?: number;
}

/** Rendu markdown complet (typographie Mantine + Mermaid + liens + admonitions). */
export function MarkdownDoc({
  markdown,
  onInternalLink,
  maxWidth = 860,
}: MarkdownDocProps) {
  const components: Components = {
    h2: ({ children }) => (
      <HeadingWithAnchor level={2}>{children}</HeadingWithAnchor>
    ),
    h3: ({ children }) => (
      <HeadingWithAnchor level={3}>{children}</HeadingWithAnchor>
    ),
    h4: ({ children }) => (
      <HeadingWithAnchor level={4}>{children}</HeadingWithAnchor>
    ),
    blockquote: ({ children }) => {
      const adm = parseAdmonition(children);
      if (adm) {
        return (
          <Alert
            color={adm.meta.color}
            icon={adm.meta.icon}
            title={adm.meta.title}
            variant="light"
            my="md"
          >
            {adm.rest}
          </Alert>
        );
      }
      return <blockquote>{children}</blockquote>;
    },
    pre: ({ children }) => {
      // children attendu : <code className="language-X">…</code>
      const child = Array.isArray(children) ? children[0] : children;
      if (isValidElement(child)) {
        const props = child.props as {
          className?: string;
          children?: ReactNode;
        };
        const cls = props.className ?? "";
        const raw = String(props.children ?? "").replace(/\n$/, "");
        if (/\blanguage-mermaid\b/.test(cls)) {
          return <MermaidDiagram code={raw} />;
        }
        // Bloc déclaratif : une fence typée = un composant (même principe que
        // Mermaid). Le contenu reste du JSON versionnable et réingérable — 0
        // HTML brut dans le markdown, la règle du standard tient.
        if (/\blanguage-nodefony-cards\b/.test(cls)) {
          return <DocCards json={raw} onNavigate={onInternalLink} />;
        }
        if (/\blanguage-nodefony-livegraph\b/.test(cls)) {
          return <DocLiveGraph json={raw} />;
        }
        if (/\blanguage-/.test(cls)) {
          const lang = cls.match(/language-([a-z0-9]+)/i)?.[1] ?? "";
          return <CodeBlock language={lang} code={raw} />;
        }
      }
      return <pre>{children}</pre>;
    },
    code({ className, children }) {
      // Inline only (les blocks passent par `pre` → CodeBlock).
      return <code className={className}>{children}</code>;
    },
    a({ href, children }) {
      const h = String(href ?? "");
      const ext = /^https?:\/\//i.test(h);
      // Le serveur a déjà traduit les liens internes en SLUGS (`mod~security~cors.md`) :
      // le `~` fait partie du charset, et un chemin relatif ne devrait plus arriver ici.
      // Cf `DocumentationService.#resolveLinks` — seul le serveur connaît chemin → slug.
      const m = h.match(/^\.?\/?([A-Za-z0-9._~-]+)\.md(#.*)?$/);
      const slug = m?.[1];
      if (slug && onInternalLink) {
        return (
          <Anchor
            onClick={(e) => {
              if (onInternalLink(slug)) e.preventDefault();
            }}
            style={{ cursor: "pointer" }}
          >
            {children}
          </Anchor>
        );
      }
      return (
        <Anchor
          href={h}
          target={ext ? "_blank" : undefined}
          rel={ext ? "noreferrer noopener" : undefined}
        >
          {children}
        </Anchor>
      );
    },
  };
  return (
    <Typography>
      <Box
        style={{ maxWidth: rem(maxWidth), fontSize: rem(15), lineHeight: 1.75 }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {markdown}
        </ReactMarkdown>
      </Box>
    </Typography>
  );
}

export default MarkdownDoc;
