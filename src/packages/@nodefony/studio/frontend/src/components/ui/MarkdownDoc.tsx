import {
  Children,
  cloneElement,
  isValidElement,
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
import { HEADING_SCROLL_MARGIN } from "./layout";

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
  return <Box ref={containerRef} my="md" style={{ textAlign: "center" }} />;
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
