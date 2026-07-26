import { observer } from "mobx-react-lite";
import { useState, type ReactNode } from "react";
import { Anchor, Badge, Breadcrumbs, Group, Switch } from "@mantine/core";
import {
  IconChevronRight,
  IconCpu,
  IconTopologyStar3,
} from "@tabler/icons-react";
import { PageLayout, DataState, DocHint } from "../components/ui";
import {
  PAGE_CONTENT_HEIGHT,
  PAGE_CONTENT_HEIGHT_WITH_BAND,
} from "../components/ui/layout";
import { useTwinTopology } from "../realtime/twin/useTwinTopology";
import { schemaTitle } from "../realtime/twin/twinSchemas";
import { TwinMapView } from "../realtime/twin/TwinMap";
import { TwinNodePanel } from "../realtime/twin/TwinNodePanel";
import { SocketExplorer } from "../realtime/socket/SocketExplorer";
import { OrmOverview } from "./OrmOverview";

/** Version de la doc des fiches d'aide (`DocHint`) de la page Carte du serveur. */
const TWIN_DOC = "v1.3";

/**
 * **Carte du serveur** (`/nodefony/twin`) — explorateur d'ARCHITECTURE RUNTIME, vivant.
 *
 * Aussi appelée « jumeau numérique » (digital twin) : une réplique vivante de
 * l'architecture qui tourne. Carte maîtrisée (positions fixes + frontières de
 * process), data-driven → forage multi-niveaux. Deux gestes par brique :
 * **clic = creuser** (entre dans le sous-schéma, ex. les bases et services
 * externes → Redis/Kafka/Loki/OpenSearch) ; **ⓘ = explications** (dialog liens
 * + docs). Les connecteurs réels sont en vision directe. Le contenu des dialogs
 * = blocs réutilisables (→ généricité page / widget de bureau / dialog).
 */
export const Twin = observer(() => {
  const { data, loading, error, reload } = useTwinTopology();
  const [live, setLive] = useState(true);
  const [stack, setStack] = useState<string[]>(["root"]);
  const [selected, setSelected] = useState<string | null>(null);

  const info = data?.info ?? null;
  const connectors = data?.connectors ?? [];
  const snapshot = data?.normalized ?? null;
  const current = stack[stack.length - 1];
  const cluster =
    !!data?.normalized?.cluster && data.normalized.instances.length > 1;
  const workers = data?.normalized?.instances.length ?? 0;
  const deep = stack.length > 1;

  // Forages « vue spéciale » (non-TwinSchema) : un composant dédié réutilisé
  // au lieu de la carte. Une entrée par brique forée vers un écran riche.
  const specialViews: Record<string, ReactNode> = {
    "realtime-view": <SocketExplorer live={live} />,
    "orm-view": <OrmOverview embedded />,
  };

  return (
    <PageLayout
      icon={<IconTopologyStar3 size={22} />}
      title="Carte du serveur"
      subtitle="Votre serveur en train de tourner, vu d'un coup d'œil : les requêtes entrent par le haut, traversent le cœur, atteignent les bases et services en bas. Cliquez sur un élément pour zoomer, ⓘ pour une explication."
      actions={
        <Group gap="xs">
          {cluster ? (
            <Badge
              variant="light"
              color="grape"
              leftSection={<IconCpu size={12} />}
            >
              Cluster · {workers} workers
            </Badge>
          ) : null}
          <DocHint
            title="Carte du serveur"
            version={TWIN_DOC}
            summary="Une vue vivante de l'architecture de votre serveur en train de tourner — pour comprendre, en un coup d'œil, par où passe une requête. Aussi appelée « jumeau numérique » (digital twin)."
            sections={[
              {
                label: "À quoi ça sert",
                body: "Voir comment votre serveur est construit et ce qu'il fait en direct : quels éléments le composent, comment une requête les traverse, et lesquels sont actifs maintenant.",
              },
              {
                label: "Lire la carte",
                body: "En haut : les clients (navigateurs, autres services). Au centre : le cœur du serveur, qui reçoit et traite. En bas : les bases de données et services externes (Redis, Kafka, Loki, OpenSearch). Les pointillés = la limite de votre serveur (au-dessus/en dessous = hors de lui, reliés par configuration).",
              },
              {
                label: "Deux gestes",
                body: "Cliquer sur un élément = zoomer dedans (on entre dans son détail ; le fil d'Ariane en haut permet de revenir). Icône ⓘ = une explication (à quoi il sert + liens vers la doc).",
              },
              {
                label: "Temps réel",
                body: "Activé par défaut : les liens s'animent quand des données circulent et les éléments montrent leur activité (connexions, requêtes, canaux). Coupez l'interrupteur « Temps réel » pour figer l'image.",
              },
            ]}
          />
          <Switch
            size="sm"
            checked={live}
            onChange={(e) => setLive(e.currentTarget.checked)}
            label="Temps réel"
            aria-label="Activer le temps réel sur la carte du serveur"
          />
        </Group>
      }
    >
      {deep ? (
        <Breadcrumbs separator={<IconChevronRight size={14} />}>
          {stack.map((id, i) => (
            <Anchor
              key={`${id}-${i}`}
              onClick={() => setStack((s) => s.slice(0, i + 1))}
              c={i === stack.length - 1 ? undefined : "dimmed"}
              fw={i === stack.length - 1 ? 600 : 400}
            >
              {schemaTitle(id)}
            </Anchor>
          ))}
        </Breadcrumbs>
      ) : null}

      <DataState
        loading={loading && !data}
        error={error}
        onRetry={reload}
        minHeight={420}
      >
        {data
          ? (specialViews[current] ?? (
              <TwinMapView
                schemaId={current}
                info={info}
                connectors={connectors}
                snapshot={snapshot}
                live={live}
                height={
                  deep ? PAGE_CONTENT_HEIGHT_WITH_BAND : PAGE_CONTENT_HEIGHT
                }
                onEnter={(schemaId) => setStack((s) => [...s, schemaId])}
                onInfo={setSelected}
              />
            ))
          : null}
      </DataState>

      <TwinNodePanel
        nodeId={selected}
        info={info}
        connectors={connectors}
        onClose={() => setSelected(null)}
      />
    </PageLayout>
  );
});

export default Twin;
