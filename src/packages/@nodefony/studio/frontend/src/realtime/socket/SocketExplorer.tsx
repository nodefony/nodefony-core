import { Suspense, useState, type ReactNode } from "react";
import { Tabs, Text } from "@mantine/core";
import {
  IconActivityHeartbeat,
  IconArrowsSplit2,
  IconBinaryTree2,
  IconBolt,
  IconBroadcast,
  IconCircuitResistor,
} from "@tabler/icons-react";
import { LIVE_GRAPH_CATALOG } from "./liveGraphs";

/* ════════════════════════════════════════════════════════════════════════
 * SocketExplorer — le FORAGE de la brique « Realtime Hub » du Jumeau Vivant.
 *
 * Les vues live de la Socket Nodefony (Architecture / Fan-out / Backplane /
 * Protocole / Sondes / Actions) en ONGLETS 1er niveau. Réutilise EXACTEMENT
 * les graphes du portail doc via le registre `liveGraphs` (source UNIQUE,
 * jamais un 2ᵉ registre) → « il y a même les graphes realtime de la doc ».
 *
 * Temps réel : suit le switch GLOBAL du Twin (`live`), PAS de switch par
 * graphe (LiveGraphSection avec son switch local reste réservé aux pages de
 * doc). « 0 ticker quand OFF » : seul l'onglet ACTIF monte son graphe (garde
 * `tab === slug`) → un seul abonnement `nodefony:socket` à la fois, coupé dès
 * qu'on change d'onglet ou qu'on fige le temps réel.
 * ════════════════════════════════════════════════════════════════════════ */

/** Hauteur du graphe (px) — alignée sur le défaut `LiveGraphSection` (doc). */
const GRAPH_HEIGHT = 560;

/** Icône par graphe — fallback générique. */
const GRAPH_ICON: Record<string, ReactNode> = {
  architecture: <IconBroadcast size={15} />,
  "fan-out": <IconArrowsSplit2 size={15} />,
  backplane: <IconCircuitResistor size={15} />,
  protocole: <IconBinaryTree2 size={15} />,
  sondes: <IconActivityHeartbeat size={15} />,
  actions: <IconBolt size={15} />,
};

/**
 * Une facette par graphe du catalogue — il est déjà dédoublonné et ordonné à
 * la source (le registre porte un graphe une seule fois, quel que soit le
 * nombre de pages qui l'invoquent).
 */
const FACETS = LIVE_GRAPH_CATALOG;

export interface SocketExplorerProps {
  /** Temps réel global du Jumeau (propagé au graphe de l'onglet actif). */
  live: boolean;
}

export function SocketExplorer({ live }: SocketExplorerProps) {
  const [tab, setTab] = useState<string>(FACETS[0]?.name ?? "");
  return (
    <Tabs value={tab} onChange={(v) => setTab(v ?? FACETS[0]?.name ?? "")}>
      <Tabs.List mb="md">
        {FACETS.map((g) => (
          <Tabs.Tab
            key={g.name}
            value={g.name}
            leftSection={GRAPH_ICON[g.name] ?? <IconBroadcast size={15} />}
          >
            {g.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {FACETS.map((g) => {
        const LiveGraph = g.component;
        return (
          <Tabs.Panel key={g.name} value={g.name}>
            {tab === g.name ? (
              <Suspense
                fallback={
                  <Text size="sm" c="dimmed" py="xl">
                    Chargement du schéma…
                  </Text>
                }
              >
                <LiveGraph live={live} height={GRAPH_HEIGHT} />
              </Suspense>
            ) : null}
          </Tabs.Panel>
        );
      })}
    </Tabs>
  );
}

export default SocketExplorer;
