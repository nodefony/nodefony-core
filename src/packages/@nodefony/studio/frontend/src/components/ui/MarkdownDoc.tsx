import {
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Alert,
  Anchor,
  Box,
  Code,
  Text,
  TypographyStylesProvider,
  rem,
  useMantineColorScheme,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
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
 * ════════════════════════════════════════════════════════════════════════ */

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
        <Code block>{code}</Code>
        <Text size="xs" c="dimmed" mt="xs">
          {error}
        </Text>
      </Alert>
    );
  }
  return <Box ref={containerRef} my="md" style={{ textAlign: "center" }} />;
}

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

/** Rendu markdown complet (typographie Mantine + Mermaid + liens). */
export function MarkdownDoc({
  markdown,
  onInternalLink,
  maxWidth = 860,
}: MarkdownDocProps) {
  const components: Components = {
    code({ className, children }) {
      if (/\blanguage-mermaid\b/.test(className ?? "")) {
        return (
          <MermaidDiagram code={String(children ?? "").replace(/\n$/, "")} />
        );
      }
      return <code className={className}>{children}</code>;
    },
    // Ancres sur les titres (id = même slug que le sommaire DocToc) → navigation.
    h2: ({ children }) => (
      <h2 id={slugifyHeading(nodeText(children))} style={HEADING_STYLE}>
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 id={slugifyHeading(nodeText(children))} style={HEADING_STYLE}>
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 id={slugifyHeading(nodeText(children))} style={HEADING_STYLE}>
        {children}
      </h4>
    ),
    a({ href, children }) {
      const h = String(href ?? "");
      const ext = /^https?:\/\//i.test(h);
      const m = h.match(/^\.?\/?([a-z0-9._-]+)\.md(#.*)?$/i);
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
    <TypographyStylesProvider>
      <Box
        style={{ maxWidth: rem(maxWidth), fontSize: rem(15), lineHeight: 1.75 }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {markdown}
        </ReactMarkdown>
      </Box>
    </TypographyStylesProvider>
  );
}

export default MarkdownDoc;
