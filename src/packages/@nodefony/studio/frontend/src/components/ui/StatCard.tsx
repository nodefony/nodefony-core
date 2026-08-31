import {
  ActionIcon,
  Card,
  Grid,
  Group,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { DocHint } from "./DocHint";

/**
 * InfoHint — bulle d'aide ⓘ accessible : ouvre au survol, au focus clavier ET
 * au touch (`events`), `tabIndex={0}` + `aria-label` pour le lecteur d'écran.
 * Le standard Studio pour expliciter une métrique sans alourdir le label.
 */
export function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip
      label={text}
      multiline
      w={280}
      withArrow
      position="top"
      events={{ hover: true, focus: true, touch: true }}
    >
      {/*
        Un BOUTON, pas un `ThemeIcon` : celui-ci rend un `<div>` de rôle
        générique, sur lequel `aria-label` est INTERDIT (`aria-prohibited-attr`,
        mesuré par axe) — le nom était donc écrit et ignoré, et le `tabIndex`
        donnait un arrêt de tabulation qui n'annonçait rien. Le patron est celui
        de `DocHint`, y compris son `w`/`h` : `size="sm"` rend 22 px, sous les
        24 px exigés par WCAG 2.5.8 pour une cible de pointage.
      */}
      <ActionIcon
        variant="subtle"
        color="gray"
        size="sm"
        w={24}
        h={24}
        style={{ cursor: "help" }}
        aria-label={text}
      >
        <IconInfoCircle size={15} />
      </ActionIcon>
    </Tooltip>
  );
}

export interface StatCardProps {
  label: string;
  icon?: ReactNode;
  /**
   * Texte d'aide court. **Routé via une fiche `DocHint`** (norme Studio : l'aide
   * d'une carte est une fiche typée, pas un tooltip brut `InfoHint`). Le `title`
   * de la fiche = le `label` de la carte.
   */
  hint?: string;
  /** Fiche d'aide riche (ex. `<DocHint sections=… />`) — rendue À LA PLACE de `hint`. */
  info?: ReactNode;
  /** Span Grid responsive. Le composant rend sa propre `Grid.Col`. Défaut 1/4 large. */
  span?: Record<string, number>;
  /**
   * Rend la carte CLIQUABLE — typiquement pour appliquer au tableau le filtre
   * qui a produit le nombre affiché.
   *
   * Opt-in : sans cette prop, le rendu et le comportement sont **inchangés**.
   * Une carte n'est cliquable que si le serveur publie la facette
   * correspondante ; sinon le clic filtrerait sur autre chose que ce qu'elle
   * annonce, et deux nombres se contrediraient à l'écran.
   */
  onClick?: () => void;
  /**
   * La sélection décrite par cette carte est ACTIVE (son filtre est posé).
   * Se voit — bordure et fond accentués — et s'annonce (`aria-pressed`).
   */
  active?: boolean;
  /**
   * Ce que le clic va faire, en clair, pour le lecteur d'écran ET l'infobulle.
   * Ex. « Filtrer sur les comptes verrouillés ». Sans ce libellé, une carte
   * cliquable ne s'annonce que par son nombre.
   */
  actionLabel?: string;
  children: ReactNode;
}

/**
 * StatCard — carte KPI standard (label en capitales + ⓘ + icône + valeur).
 * Extraite du Dashboard, réutilisable par toute page métrique (Database,
 * Firewall stats, Sessions…). Rend sa propre `Grid.Col` → s'utilise DANS une
 * `<Grid>`. `h="100%"` aligne les cartes d'une même ligne.
 */
export function StatCard({
  label,
  icon,
  hint,
  info,
  span = { base: 12, sm: 6, lg: 3 },
  onClick,
  active = false,
  actionLabel,
  children,
}: StatCardProps) {
  // Une carte cliquable est un vrai bouton à bascule pour les technologies
  // d'assistance : `role`/`aria-pressed` disent l'état, `tabIndex` la rend
  // atteignable au clavier, et Entrée/Espace l'actionnent comme un bouton natif.
  // Un `<div onClick>` seul aurait été invisible et inatteignable sans souris.
  const interactive = onClick !== undefined;
  return (
    <Grid.Col span={span}>
      <Card
        withBorder
        radius="md"
        p="lg"
        h="100%"
        role={interactive ? "button" : undefined}
        aria-pressed={interactive ? active : undefined}
        aria-label={interactive ? actionLabel : undefined}
        title={interactive ? actionLabel : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={onClick}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
        style={
          interactive
            ? {
                cursor: "pointer",
                borderColor: active
                  ? "var(--mantine-color-brand-5)"
                  : undefined,
                backgroundColor: active
                  ? "var(--mantine-color-brand-light)"
                  : undefined,
              }
            : undefined
        }
      >
        <Group justify="space-between" wrap="nowrap">
          <Stack gap={2}>
            <Group gap={4}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {label}
              </Text>
              {/* Norme Studio : l'aide d'une carte est une FICHE typée (DocHint,
                  HoverCard ouverte au survol/focus), jamais un tooltip brut. Un
                  simple `hint` est routé via DocHint (title = label).
                  Le clic y est ARRÊTÉ : sur une carte cliquable, ouvrir l'aide
                  ne doit pas filtrer le tableau — deux intentions distinctes
                  partagent la même surface. */}
              <span
                onClick={interactive ? (e) => e.stopPropagation() : undefined}
                onKeyDown={interactive ? (e) => e.stopPropagation() : undefined}
              >
                {info ??
                  (hint ? <DocHint title={label} summary={hint} /> : null)}
              </span>
            </Group>
            {children}
          </Stack>
          {icon}
        </Group>
      </Card>
    </Grid.Col>
  );
}
