import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ActionIcon,
  Box,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconMaximize,
} from "@tabler/icons-react";
import { DocToc, extractHeadings } from "./DocToc";
import {
  CONTENT_STICKY_TOP,
  MODAL_FULLSCREEN_BODY,
  MODAL_FULLSCREEN_CONTENT,
  SIDEBAR_MAX_HEIGHT,
} from "./layout";

/** Largeur fixe de la colonne navigation (docs-site, façon MDN/Docusaurus). */
const NAV_WIDTH = 264;
/** Largeur fixe du sommaire « Sur cette page ». */
const TOC_WIDTH = 240;

/**
 * Injecte UNE fois la grille flex responsive du docs-site (pattern `ensureDocStyles`
 * de MarkdownDoc — la pseudo-classe media-query est impossible en style inline).
 *
 * Modèle : 3 colonnes flex — nav (largeur fixe) | contenu (flex, DOMINANT) |
 * sommaire (largeur fixe). En `container`, chaque colonne prend la hauteur fixe
 * `--nf-doc-h` et scrolle INDÉPENDAMMENT (robuste : 0 dépendance au sticky/scroll
 * de page). Sous 992px : empilement vertical, hauteurs auto, sommaire masqué.
 */
function ensureDocLayoutStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("nf-doclayout-styles")) return;
  const el = document.createElement("style");
  el.id = "nf-doclayout-styles";
  el.textContent = `
.nf-doc-region{display:flex;gap:var(--mantine-spacing-xl,32px);align-items:stretch}
.nf-doc-region.is-page{align-items:flex-start}
.nf-doc-nav{flex:0 0 ${NAV_WIDTH}px;width:${NAV_WIDTH}px}
.nf-doc-toc{flex:0 0 ${TOC_WIDTH}px;width:${TOC_WIDTH}px}
.nf-doc-main{flex:1 1 0;min-width:0}
.nf-doc-region.is-container>.nf-doc-region-col{height:var(--nf-doc-h)}
@media (max-width:991px){
  .nf-doc-region{flex-direction:column}
  .nf-doc-nav,.nf-doc-toc{flex-basis:auto;width:100%}
  .nf-doc-toc{display:none}
  .nf-doc-region.is-container>.nf-doc-region-col{height:auto}
}`;
  document.head.appendChild(el);
}

/* ════════════════════════════════════════════════════════════════════════
 * DocLayout — LE layout de documentation UNIQUE, utilisé PARTOUT.
 *
 * 3 colonnes : nav (gauche) | contenu (centre) | sommaire « Sur cette page »
 * (droite, cachable). Gère 2 modes de scroll + le plein écran :
 *  - `mode="page"`      : le contenu scrolle avec LA PAGE ; sidebars sticky
 *    (portail /nodefony/documentation).
 *  - `mode="container"` : hauteur fixe `height` ; le contenu scrolle EN INTERNE ;
 *    sidebars à hauteur fixe (onglet Docs d'un module, plein écran).
 *  - **Plein écran** : ouvre une modale qui rend le MÊME layout en `container`
 *    plein viewport, **sommaire ouvert par défaut**.
 *
 * Règles tenues (cf [[feedback_studio_layout_rigor]]) : 0 magic number (layout.ts),
 * en-tête de panneau FIXE + corps scrollable (JAMAIS `sticky` dans un ScrollArea
 * Mantine, cassé), un seul scroll par zone.
 * ════════════════════════════════════════════════════════════════════════ */

export interface DocLayoutProps {
  /** Titre de la sidebar gauche (ex « Documentation », « Pages »). */
  navTitle: string;
  /** Actions d'en-tête de la sidebar (ex boutons tout plier/déplier). */
  navActions?: ReactNode;
  /** Champ de recherche de la sidebar (fixe, hors scroll). */
  navSearch?: ReactNode;
  /** Corps de la sidebar (arbre / liste de pages) — scrollable. */
  nav: ReactNode;
  /** En-tête du contenu (titre + badges + actions propres à la page). */
  title?: ReactNode;
  /** Corps du contenu (markdown rendu, page riche…). */
  children: ReactNode;
  /** Source markdown du sommaire « Sur cette page » (absent ⇒ pas de colonne droite). */
  tocMarkdown?: string;
  mode?: "page" | "container";
  /** Hauteur en `mode="container"` (ex READER_HEIGHT). */
  height?: string;
  /** Affiche le bouton plein écran. */
  enableFullscreen?: boolean;
}

export function DocLayout({
  navTitle,
  navActions,
  navSearch,
  nav,
  title,
  children,
  tocMarkdown,
  mode = "page",
  height = "70vh",
  enableFullscreen = true,
}: DocLayoutProps) {
  const [fullscreen, setFullscreen] = useState(false);
  // Le sommaire est visible par défaut. L'utilisateur peut le masquer pour
  // gagner de la largeur de lecture, soit via le bouton « masquer » DANS la
  // colonne TOC elle-même (à côté de « Sur cette page »), soit en passant en
  // plein écran. En modal fullscreen, on force `true` pour ne pas hériter
  // d'un état masqué de la vue page.
  const [tocVisible, setTocVisible] = useState(true);
  const readerViewport = useRef<HTMLDivElement>(null);

  const hasToc = !!tocMarkdown && extractHeadings(tocMarkdown).length > 0;

  // Grille flex responsive du docs-site, injectée 1× (idempotent).
  ensureDocLayoutStyles();

  /** Rend les 3 colonnes flex (nav | contenu | sommaire) pour un mode/hauteur. */
  const renderGrid = (m: "page" | "container", h: string, isModal: boolean) => {
    const showToc = hasToc && (isModal ? true : tocVisible);
    const panelHeight = m === "page" ? SIDEBAR_MAX_HEIGHT : h;

    // — Colonne NAV (largeur fixe via `.nf-doc-nav`) : en-tête FIXE + corps scrollable.
    //   `page` → sticky sous le PageHeader, hauteur plafonnée. `container` → hauteur
    //   = `--nf-doc-h` (CSS `.nf-doc-region-col`) → scroll interne INDÉPENDANT.
    const navStyle: CSSProperties =
      m === "page"
        ? {
            position: "sticky",
            top: CONTENT_STICKY_TOP,
            maxHeight: SIDEBAR_MAX_HEIGHT,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }
        : { display: "flex", flexDirection: "column", overflow: "hidden" };

    const sidebar = (
      <Paper
        withBorder
        radius="md"
        p="sm"
        className="nf-doc-nav nf-doc-region-col"
        style={navStyle}
      >
        <Box style={{ flexShrink: 0 }}>
          <Group justify="space-between" mb={6} px="xs" wrap="nowrap">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">
              {navTitle}
            </Text>
            {navActions}
          </Group>
          {navSearch}
        </Box>
        <ScrollArea type="hover" style={{ flex: 1, minHeight: 0 }}>
          {nav}
        </ScrollArea>
      </Paper>
    );

    // En-tête du contenu (titre + toggle sommaire + plein écran). `page` → sticky
    // au même `top` que les sidebars (le titre reste lisible au scroll). `container`
    // → bandeau FIXE en haut du flex column ; la lecture (ScrollArea) scrolle dessous.
    const headerStickyStyle: CSSProperties =
      m === "page"
        ? {
            position: "sticky",
            top: CONTENT_STICKY_TOP,
            background: "var(--mantine-color-body)",
            zIndex: 1,
            paddingTop: "var(--mantine-spacing-xs, 8px)",
            paddingBottom: "var(--mantine-spacing-xs, 8px)",
          }
        : {};
    const headerBar = (
      <Group
        gap="xs"
        mb="md"
        wrap="nowrap"
        style={{ flexShrink: 0, ...headerStickyStyle }}
      >
        <Box style={{ flex: 1, minWidth: 0 }}>{title}</Box>
        {hasToc && !showToc && !isModal && (
          <Tooltip label="Afficher le sommaire" position="left">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => setTocVisible(true)}
              aria-label="Afficher le sommaire"
            >
              <IconLayoutSidebarRightExpand size={16} />
            </ActionIcon>
          </Tooltip>
        )}
        {enableFullscreen && !isModal && (
          <Tooltip label="Plein écran" position="left">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={() => setFullscreen(true)}
              aria-label="Plein écran"
            >
              <IconMaximize size={16} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    );

    // — Colonne CONTENU (flex DOMINANT via `.nf-doc-main`) — `page` scrolle avec
    //   la page ; `container` a son propre ScrollArea (hauteur `--nf-doc-h`).
    const center =
      m === "page" ? (
        <Box className="nf-doc-main nf-doc-region-col">
          {headerBar}
          {children}
        </Box>
      ) : (
        <Box
          className="nf-doc-main nf-doc-region-col"
          style={{ display: "flex", flexDirection: "column" }}
        >
          {headerBar}
          <ScrollArea
            type="auto"
            offsetScrollbars
            viewportRef={readerViewport}
            style={{ flex: 1, minHeight: 0 }}
          >
            {children}
          </ScrollArea>
        </Box>
      );

    // — Colonne SOMMAIRE (largeur fixe via `.nf-doc-toc`) — sticky en `page` ;
    //   en `container` la hauteur vient de `align-items:stretch` + DocToc `maxHeight`.
    const tocCol = showToc && tocMarkdown && (
      <Box
        className="nf-doc-toc"
        style={
          m === "page"
            ? {
                position: "sticky",
                top: CONTENT_STICKY_TOP,
                alignSelf: "flex-start",
              }
            : undefined
        }
      >
        <Paper withBorder radius="md" p="sm">
          <DocToc
            markdown={tocMarkdown}
            scrollRootRef={m === "container" ? readerViewport : undefined}
            maxHeight={panelHeight}
            actions={
              !isModal ? (
                <Tooltip label="Masquer le sommaire">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="xs"
                    onClick={() => setTocVisible(false)}
                    aria-label="Masquer le sommaire"
                  >
                    <IconLayoutSidebarRightCollapse size={14} />
                  </ActionIcon>
                </Tooltip>
              ) : undefined
            }
          />
        </Paper>
      </Box>
    );

    const regionStyle: CSSProperties = { "--nf-doc-h": h } as CSSProperties;
    return (
      <Box
        className={`nf-doc-region ${m === "page" ? "is-page" : "is-container"}`}
        style={regionStyle}
      >
        {sidebar}
        {center}
        {tocCol}
      </Box>
    );
  };

  return (
    <>
      {renderGrid(mode, height, false)}
      <Modal
        opened={fullscreen}
        onClose={() => setFullscreen(false)}
        fullScreen
        radius={0}
        title={navTitle}
        styles={{ body: { height: MODAL_FULLSCREEN_BODY } }}
      >
        {renderGrid("container", MODAL_FULLSCREEN_CONTENT, true)}
      </Modal>
    </>
  );
}

export default DocLayout;
