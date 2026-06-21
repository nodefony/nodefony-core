import { Stack, Tabs } from "@mantine/core";
import type { ComponentProps, ReactNode } from "react";
import { PageHeader } from "./PageHeader";

/**
 * **PageLayout** — squelette de page Studio STANDARD : garantit une topbar
 * (`PageHeader`) **toujours figée** au scroll, identique sur toutes les pages.
 *
 * Pourquoi : le sticky « marchait sur certaines pages, pas d'autres » parce que
 * chaque route bricolait sa propre structure (`<Stack>` avec ou sans `sticky`,
 * `height:100%`, gaps variables…). Centraliser ici = un SEUL endroit qui pose
 * la structure correcte → cohérence garantie, fini les topbars qui défilent.
 *
 * Le `PageHeader` est rendu `sticky` d'office (`top:0`, relatif au scroll de
 * `AppShell.Main`) et publie sa hauteur réelle dans `--nf-pageheader-height` ;
 * `StickyTabsList` s'en sert pour coller la barre d'onglets **pile dessous**
 * (2ᵉ topbar des pages à onglets — cf ORM, Rôles).
 */
export interface PageLayoutProps {
  title: ReactNode;
  /** Sous-titre gris (description courte). */
  subtitle?: ReactNode;
  /** Icône à gauche du titre. */
  icon?: ReactNode;
  /** Actions à droite (boutons, filtres globaux…). */
  actions?: ReactNode;
  /** Espacement vertical entre le header et le contenu (défaut `md`). */
  gap?: string;
  children: ReactNode;
}

export function PageLayout({
  title,
  subtitle,
  icon,
  actions,
  gap = "md",
  children,
}: PageLayoutProps) {
  return (
    <Stack gap={gap}>
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={actions}
        sticky
      />
      {children}
    </Stack>
  );
}

/**
 * **StickyTabsList** — `Tabs.List` qui se fige **sous** le `PageHeader` sticky
 * (la 2ᵉ topbar). Colle à `top: --nf-pageheader-height` (publié par le
 * PageHeader sticky) avec un fond opaque pour masquer le contenu qui défile
 * dessous. Drop-in : remplace `<Tabs.List>` dans une page à onglets.
 */
export function StickyTabsList({
  children,
  ...rest
}: ComponentProps<typeof Tabs.List>) {
  return (
    <Tabs.List
      {...rest}
      style={{
        position: "sticky",
        // Pile sous le PageHeader sticky (sa hauteur réelle publiée en var).
        top: "var(--nf-pageheader-height, 76px)",
        zIndex: 1,
        background: "var(--mantine-color-body)",
        ...rest.style,
      }}
    >
      {children}
    </Tabs.List>
  );
}
