import { useState } from "react";
import type { ReactNode } from "react";
import { Box, Button, Collapse, SimpleGrid } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type {
  InstanceHealth,
  NormalizedHealth,
  PodTotals,
} from "../utils/realtimeHealth";

export interface ClusterViewProps {
  /** Santé normalisée (`normalize()` ramène mono ET cluster au même modèle). */
  normalized: NormalizedHealth | null;
  /** Résumé agrégé du POD — affiché par défaut (rollup adapté à la métrique). */
  renderSummary: (totals: PodTotals, instances: InstanceHealth[]) => ReactNode;
  /**
   * Détail d'UN worker. `opts.grid` = `false` en mono (rendu seul, peut être riche),
   * `true` dans la grille cluster dépliée (rendu compact, pas de sparkline pod).
   */
  renderInstance: (inst: InstanceHealth, opts: { grid: boolean }) => ReactNode;
  /** Lien de forage optionnel par worker (URL). */
  drillTo?: (inst: InstanceHealth) => string;
}

/**
 * Vue cluster-aware **partagée** par les widgets système — LA réponse au « cluster > 1 ».
 *
 * Source unique normalisée. En **mono** (`instances.length <= 1`) on rend la valeur
 * simple, **zéro bruit**. En **cluster** on rend le **résumé pod** (1 tuile = 1 verdict)
 * + une **grille par worker dépliable** (détail à 1 clic), chaque worker linkable vers
 * son forage. L'agrégation reste dans les utils partagés (`normalize`, `buildHealth`).
 */
export function ClusterView({
  normalized,
  renderSummary,
  renderInstance,
  drillTo,
}: ClusterViewProps) {
  const [open, setOpen] = useState(false);
  if (!normalized) return null;
  const { instances, totals, cluster } = normalized;

  // Mono : 1 worker → la valeur directe, aucune mécanique cluster.
  if (!cluster || instances.length <= 1) {
    return (
      <>{instances[0] ? renderInstance(instances[0], { grid: false }) : null}</>
    );
  }

  // Cluster : résumé pod par défaut + grille par worker au dépliage.
  return (
    <Box>
      {renderSummary(totals, instances)}
      <Button
        variant="subtle"
        color="grape"
        size="compact-xs"
        mt={6}
        aria-expanded={open}
        leftSection={
          open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />
        }
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Masquer" : "Voir"} les {instances.length} workers
      </Button>
      <Collapse expanded={open}>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs" mt="xs">
          {instances.map((inst) => {
            const body = renderInstance(inst, { grid: true });
            const href = drillTo?.(inst);
            return href ? (
              <Box
                key={inst.instanceId}
                component="a"
                href={href}
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  display: "block",
                }}
              >
                {body}
              </Box>
            ) : (
              <Box key={inst.instanceId}>{body}</Box>
            );
          })}
        </SimpleGrid>
      </Collapse>
    </Box>
  );
}
