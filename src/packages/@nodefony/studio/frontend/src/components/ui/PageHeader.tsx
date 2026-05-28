import { Group, Stack, Text, Title } from "@mantine/core";
import { useEffect, useRef, type ReactNode } from "react";

export interface PageHeaderProps {
  title: ReactNode;
  /** Sous-titre gris sous le titre (description courte de la page). */
  subtitle?: ReactNode;
  /** Icône optionnelle à gauche du titre. */
  icon?: ReactNode;
  /** Actions alignées à droite (boutons « Recharger », filtres globaux…). */
  actions?: ReactNode;
  /**
   * Colle l'en-tête en haut de la zone scrollable (juste sous la barre AppShell)
   * → le titre reste visible quand la page défile. Pour les pages longues
   * (dashboards, hub). Fond opaque + bord bas pour masquer le contenu qui passe
   * dessous. PUBLIE sa hauteur réelle dans `--nf-pageheader-height` (utilisée
   * par `layout.ts` pour `CONTENT_STICKY_TOP` et `SIDEBAR_MAX_HEIGHT`).
   */
  sticky?: boolean;
}

/**
 * PageHeader — en-tête standard d'une page Studio : titre + sous-titre + zone
 * d'actions. Centralise le bloc dupliqué dans toutes les routes (Dashboard,
 * Routes, Modules…). Une page = un `<PageHeader/>`.
 *
 * Accessibilité : le titre est un `h1` (`order={1}`) — un seul par page, point
 * d'ancrage du lecteur d'écran ; `size="h2"` conserve la taille visuelle
 * historique. Les titres de cartes restent `h2`+ (hiérarchie cohérente).
 *
 * Sticky : publie sa **vraie hauteur** dans `--nf-pageheader-height` via
 * `ResizeObserver` au montage (et à chaque resize). `layout.ts` lit cette var
 * pour calculer `CONTENT_STICKY_TOP` / `SIDEBAR_MAX_HEIGHT` dynamiquement —
 * fini les valeurs en dur (`"76px"`) qui laissaient un trou de quelques px
 * sous le PageHeader quand sa hauteur réelle dépassait l'approximation.
 */
export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  sticky,
}: PageHeaderProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Publie la hauteur RÉELLE du PageHeader sticky pour que les sticky
  // en aval (sidebar/TOC/headerBar DocLayout) se calent pile dessous.
  useEffect(() => {
    if (!sticky || !ref.current) return;
    const root = document.documentElement;
    const el = ref.current;
    const publish = () => {
      // Préfère `offsetHeight` (entier, prend padding+border, pas marges) —
      // c'est ce qui sépare visuellement le PageHeader du contenu.
      root.style.setProperty("--nf-pageheader-height", `${el.offsetHeight}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      // Remet à 0 au démontage pour qu'une page sans PageHeader sticky ne
      // garde pas un offset fantôme.
      root.style.setProperty("--nf-pageheader-height", "0px");
    };
  }, [sticky]);

  return (
    <Group
      ref={ref}
      justify="space-between"
      align="flex-end"
      wrap="nowrap"
      mb="md"
      // Sticky : se fige sous la barre AppShell (hauteur 56 → var Mantine). Les
      // marges négatives + padding réalignés couvrent toute la largeur malgré le
      // padding de AppShell.Main, sinon le contenu déborderait sur les côtés.
      style={
        sticky
          ? {
              position: "sticky",
              top: "var(--app-shell-header-height, 56px)",
              zIndex: 2,
              background: "var(--mantine-color-body)",
              marginInline: "calc(var(--mantine-spacing-md) * -1)",
              paddingInline: "var(--mantine-spacing-md)",
              paddingBlock: "var(--mantine-spacing-sm)",
              borderBottom: "1px solid var(--mantine-color-default-border)",
            }
          : undefined
      }
    >
      <Stack gap={4}>
        <Group gap="xs" wrap="nowrap">
          {icon}
          <Title order={1} size="h2">
            {title}
          </Title>
        </Group>
        {subtitle && (
          // `component="div"` : le sous-titre peut être un nœud riche (Group, badges…) →
          // un <p> (défaut de Text) y serait invalide (« <p> dans <p> » → erreur d'hydratation).
          <Text c="dimmed" size="sm" component="div">
            {subtitle}
          </Text>
        )}
      </Stack>
      {actions && (
        <Group gap="xs" wrap="nowrap">
          {actions}
        </Group>
      )}
    </Group>
  );
}
