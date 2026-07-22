import { useState, type ComponentType } from "react";
import { Box, Code, Group, Paper, Switch, Text } from "@mantine/core";

/* ════════════════════════════════════════════════════════════════════════
 * LiveGraphSection — bloc « graphe live » monté SOUS un markdown.
 *
 * Pattern « 0 ticker quand OFF » (cf skill nodefony-studio-dev) :
 *  - le switch contrôle `live: boolean` passé au composant graphe ;
 *  - le composant graphe LUI-MÊME gère le démontage / monte du sous-arbre
 *    qui consomme le canal realtime → aucun abonnement quand OFF.
 *
 * Réutilisé par toutes les sous-pages Socket qui ont un graphe associé
 * (entrée dans `pages.ts` → `LIVE_GRAPHS[slug]`).
 * ════════════════════════════════════════════════════════════════════════ */

export interface LiveGraphSectionProps {
  /** Composant à monter (signature `{ live?, height? }`). */
  LiveGraph: ComponentType<{ live?: boolean; height?: number }>;
  /** Hauteur du graphe (px). */
  height?: number;
  /** Titre du bloc (défaut : « Schéma live »). */
  title?: string;
  /** Description courte. */
  hint?: string;
}

export function LiveGraphSection({
  LiveGraph,
  height = 560,
  title = "Schéma live",
  hint,
}: LiveGraphSectionProps) {
  const [liveOn, setLiveOn] = useState(false);
  return (
    <Paper withBorder radius="md" p="md" mt="xl">
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Box style={{ maxWidth: 560 }}>
          <Text fw={700} size="md">
            {title}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {hint ?? (
              <>
                Le graphe respire via le canal <Code>nodefony:socket</Code>{" "}
                quand le temps réel est activé. <b>OFF</b> = 0 ticker côté
                serveur (composant statique). <b>ON</b> = abonnement ref-compté.
              </>
            )}
          </Text>
        </Box>
        <Switch
          checked={liveOn}
          onChange={(e) => setLiveOn(e.currentTarget.checked)}
          label="Temps réel"
          aria-label="Activer le temps réel sur le graphe"
        />
      </Group>
      <LiveGraph live={liveOn} height={height} />
    </Paper>
  );
}

export default LiveGraphSection;
