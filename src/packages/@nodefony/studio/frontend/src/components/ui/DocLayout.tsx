import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ActionIcon,
  Box,
  Grid,
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

  /** Rend les 3 colonnes pour un mode/hauteur donnés. */
  const renderGrid = (m: "page" | "container", h: string, isModal: boolean) => {
    const showToc = hasToc && (isModal ? true : tocVisible);
    const panelHeight = m === "page" ? SIDEBAR_MAX_HEIGHT : h;
    const centerSpan = showToc ? { base: 12, md: 6 } : { base: 12, md: 9 };

    const sidebarStyle =
      m === "page"
        ? {
            position: "sticky" as const,
            top: CONTENT_STICKY_TOP,
            display: "flex",
            flexDirection: "column" as const,
            maxHeight: SIDEBAR_MAX_HEIGHT,
            overflow: "hidden",
          }
        : {
            display: "flex",
            flexDirection: "column" as const,
            height: h,
            overflow: "hidden",
          };

    // Colonne gauche : en-tête FIXE (titre + actions + recherche) + corps scrollable.
    const sidebar = (
      <Paper withBorder radius="md" p="sm" style={sidebarStyle}>
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

    // Barre d'en-tête du contenu (titre fourni + toggle sommaire + plein écran).
    // En mode "page" : sticky AU MÊME `top` que la sidebar/TOC (CONTENT_STICKY_TOP)
    // → le titre de la sous-page reste lisible quand on scroll dans un long contenu,
    // cohérent visuellement avec les sidebars sticky. Règle docs-site (skill
    // `nodefony-documentation` §Règles de mise en page).
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
    // Quand le sommaire est MASQUÉ, on rapatrie le bouton « afficher » à
    // droite du titre (sinon il n'y a plus aucun moyen de le rouvrir). Quand
    // le sommaire est VISIBLE, le bouton « masquer » vit DANS la card TOC
    // elle-même, à côté de « Sur cette page » (emplacement légitime — on agit
    // sur la TOC depuis la TOC).
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

    // Colonne centre : header + corps (scroll page en `page`, interne en `container`).
    const center =
      m === "page" ? (
        <Box>
          {headerBar}
          {children}
        </Box>
      ) : (
        <Box style={{ display: "flex", flexDirection: "column", height: h }}>
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

    // Colonne droite : sommaire (sticky en `page`, hauteur fixe en `container`).
    const tocCol = showToc && tocMarkdown && (
      <Grid.Col span={{ base: 12, md: 3 }} visibleFrom="md">
        <Box
          style={
            m === "page"
              ? { position: "sticky", top: CONTENT_STICKY_TOP }
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
      </Grid.Col>
    );

    return (
      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, md: 3 }}>{sidebar}</Grid.Col>
        <Grid.Col span={centerSpan}>{center}</Grid.Col>
        {tocCol}
      </Grid>
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
