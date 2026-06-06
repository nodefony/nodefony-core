import { useState, type ReactNode } from "react";
import { Tabs } from "@mantine/core";
import {
  IconActivityHeartbeat,
  IconArrowsSplit2,
  IconBinaryTree2,
  IconBolt,
  IconBroadcast,
  IconCircuitResistor,
} from "@tabler/icons-react";
import { socketPages } from "./pages";

/* ════════════════════════════════════════════════════════════════════════
 * SocketExplorer — le FORAGE de la brique « Realtime Hub » du Jumeau Vivant.
 *
 * Les vues live de la Socket Nodefony (Architecture / Fan-out / Backplane /
 * Protocole / Sondes / Actions) en ONGLETS 1er niveau. Réutilise EXACTEMENT
 * les graphes du portail doc via le registre `socketPages` (source UNIQUE,
 * jamais un 2ᵉ registre) → « il y a même les graphes realtime de la doc ».
 *
 * Temps réel : suit le switch GLOBAL du Twin (`live`), PAS de switch par
 * graphe (LiveGraphSection avec son switch local reste réservé aux pages de
 * doc). « 0 ticker quand OFF » : seul l'onglet ACTIF monte son graphe (garde
 * `tab === slug`) → un seul abonnement `realtime:health` à la fois, coupé dès
 * qu'on change d'onglet ou qu'on fige le temps réel.
 * ════════════════════════════════════════════════════════════════════════ */

/** Hauteur du graphe (px) — alignée sur le défaut `LiveGraphSection` (doc). */
const GRAPH_HEIGHT = 560;

/** Icône par facette (slug court) — fallback générique. */
const SLUG_ICON: Record<string, ReactNode> = {
  "vue-ensemble": <IconBroadcast size={15} />,
  architecture: <IconBroadcast size={15} />,
  "fan-out": <IconArrowsSplit2 size={15} />,
  backplane: <IconCircuitResistor size={15} />,
  protocole: <IconBinaryTree2 size={15} />,
  sondes: <IconActivityHeartbeat size={15} />,
  actions: <IconBolt size={15} />,
};

/**
 * Facettes ayant un graphe live (= les pages doc Socket qui en portent un),
 * **dédoublonnées par composant** : `vue-ensemble` et `architecture` partagent
 * `ArchitectureLiveGraph` → on ne garde que la 1ʳᵉ (par ordre) pour ne pas
 * afficher 2 onglets au graphe identique. Résultat = 6 vues distinctes.
 */
const FACETS = socketPages
  .filter((p) => p.LiveGraph)
  .filter(
    (p, i, arr) => arr.findIndex((q) => q.LiveGraph === p.LiveGraph) === i,
  );

export interface SocketExplorerProps {
  /** Temps réel global du Jumeau (propagé au graphe de l'onglet actif). */
  live: boolean;
}

export function SocketExplorer({ live }: SocketExplorerProps) {
  const [tab, setTab] = useState<string>(FACETS[0]?.slug ?? "");
  return (
    <Tabs value={tab} onChange={(v) => setTab(v ?? FACETS[0]?.slug ?? "")}>
      <Tabs.List mb="md">
        {FACETS.map((p) => (
          <Tabs.Tab
            key={p.slug}
            value={p.slug}
            leftSection={SLUG_ICON[p.slug] ?? <IconBroadcast size={15} />}
          >
            {p.title}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {FACETS.map((p) => {
        const LiveGraph = p.LiveGraph!;
        return (
          <Tabs.Panel key={p.slug} value={p.slug}>
            {tab === p.slug ? (
              <LiveGraph live={live} height={GRAPH_HEIGHT} />
            ) : null}
          </Tabs.Panel>
        );
      })}
    </Tabs>
  );
}

export default SocketExplorer;
