/**
 * **TabbedPage** — layout **console à onglets** réutilisable : en-tête + barre de
 * mode sticky + onglets (le 1ᵉʳ = « Accueil / Vue d'ensemble »).
 *
 * Standardise l'ergonomie de TOUTES les consoles Studio (Logs, Realtime Hub, ORM,
 * Cluster, Supervision…) : on arrive sur la page, la **même logique** s'applique —
 * un en-tête, une `StatusBar` qui dit le mode courant quel que soit l'onglet, puis
 * des onglets dont le premier explique « ce qu'on regarde et ce qu'on peut faire ».
 *
 * Composé sur des briques existantes (`PageHeader` sticky + `StatusBar` sticky) :
 * la `StatusBar` se cale pile sous le `PageHeader` (hauteur réelle publiée dans
 * `--nf-pageheader-height`). Le layout ne fait AUCUN fetch : il orchestre des
 * panneaux fournis par la page consommatrice.
 */
import type { ReactNode } from "react";
import { Stack, Tabs } from "@mantine/core";
import { PageHeader } from "./PageHeader";

/** Un onglet du layout (le `panel` est fourni par la page consommatrice). */
export interface TabbedPageTab {
  /** Identifiant stable (clé d'URL / d'état). */
  value: string;
  /** Libellé de l'onglet. */
  label: string;
  /** Icône à gauche du libellé. */
  icon?: ReactNode;
  /** Badge à droite du libellé (compteur, état…). */
  badge?: ReactNode;
  /** Contenu du panneau. */
  panel: ReactNode;
}

export interface TabbedPageProps {
  /** Titre (h1 via PageHeader). */
  title: ReactNode;
  /** Sous-titre court. */
  subtitle?: ReactNode;
  /** Icône de l'en-tête. */
  icon?: ReactNode;
  /** Actions à droite de l'en-tête (boutons « Rafraîchir »…). */
  actions?: ReactNode;
  /** Barre de mode sticky sous l'en-tête (typiquement un `<StatusBar/>`). */
  statusBar?: ReactNode;
  /** Les onglets (le 1ᵉʳ doit être l'« Accueil / Vue d'ensemble »). */
  tabs: TabbedPageTab[];
  /** Onglet actif (controlled). */
  value: string;
  /** Changement d'onglet. */
  onChange: (value: string) => void;
  /**
   * Garde TOUS les panneaux montés même inactifs. Défaut `false` (inactif =
   * démonté → les abonnements temps réel / tickers d'un onglet s'arrêtent quand
   * on le quitte = ref-count à 0). Ne passer `true` que si l'état d'un panneau
   * doit survivre au changement d'onglet.
   */
  keepMounted?: boolean;
}

/**
 * Assemble en-tête + barre de mode + onglets. La page consommatrice gère le
 * `value`/`onChange` (deep-link, bascule programmée comme « trace → Explorer ») et
 * fournit le `statusBar` + les `panel`. Les overlays (drawers) restent à la page.
 */
export function TabbedPage({
  title,
  subtitle,
  icon,
  actions,
  statusBar,
  tabs,
  value,
  onChange,
  keepMounted = false,
}: TabbedPageProps) {
  return (
    <Stack gap="md">
      <PageHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        actions={actions}
        sticky
      />
      {statusBar}
      <Tabs
        value={value}
        onChange={(v) => v && onChange(v)}
        keepMounted={keepMounted}
      >
        <Tabs.List>
          {tabs.map((t) => (
            <Tabs.Tab
              key={t.value}
              value={t.value}
              leftSection={t.icon}
              rightSection={t.badge}
            >
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {tabs.map((t) => (
          <Tabs.Panel key={t.value} value={t.value} pt="md">
            {t.panel}
          </Tabs.Panel>
        ))}
      </Tabs>
    </Stack>
  );
}
