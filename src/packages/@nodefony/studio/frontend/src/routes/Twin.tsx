import { observer } from "mobx-react-lite";
import { useState } from "react";
import {
  Anchor,
  Badge,
  Breadcrumbs,
  Group,
  Stack,
  Switch,
} from "@mantine/core";
import {
  IconChevronRight,
  IconCpu,
  IconTopologyStar3,
} from "@tabler/icons-react";
import { PageHeader, DataState, DocHint } from "../components/ui";
import {
  PAGE_CONTENT_HEIGHT,
  PAGE_CONTENT_HEIGHT_WITH_BAND,
} from "../components/ui/layout";
import { useTwinTopology } from "../realtime/twin/useTwinTopology";
import { schemaTitle } from "../realtime/twin/twinSchemas";
import { TwinMapView } from "../realtime/twin/TwinMap";
import { TwinNodePanel } from "../realtime/twin/TwinNodePanel";
import { SocketExplorer } from "../realtime/socket/SocketExplorer";

/** Version de la doc des fiches d'aide (`DocHint`) de la page Jumeau. */
const TWIN_DOC = "v1.2";

/**
 * **Jumeau Vivant** (`/nodefony/twin`) — explorateur d'ARCHITECTURE RUNTIME, vivant.
 *
 * Carte maîtrisée (positions fixes + frontières de process), data-driven →
 * forage multi-niveaux. Deux gestes par brique : **clic = creuser** (entre dans
 * le sous-schéma, ex. les fonds de panier → Redis/Kafka/Loki/OpenSearch) ;
 * **ⓘ = explications** (dialog liens + docs). Les connecteurs réels sont en
 * vision directe. Le contenu des dialogs = blocs réutilisables (→ généricité
 * page / widget de bureau / dialog).
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

  return (
    <Stack gap="md">
      <PageHeader
        sticky
        icon={<IconTopologyStar3 size={22} />}
        title="Jumeau Vivant"
        subtitle="L'architecture qui tourne — entrée HTTP/WS, kernel, ORM, Socket, fonds de panier. Cliquez pour creuser, ⓘ pour comprendre."
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
              title="Jumeau Vivant"
              version={TWIN_DOC}
              summary="L'architecture runtime du serveur, vivante et explorable."
              sections={[
                {
                  label: "Deux gestes",
                  body: "Clic sur une brique = creuser (on entre dans son schéma détaillé). Icône ⓘ = explications (liens + docs). Le fil d'Ariane permet de remonter.",
                },
                {
                  label: "Frontières",
                  body: "Les pointillés marquent la frontière du process : clients au-dessus, bases et backends d'infra (Redis, Kafka, Loki, OpenSearch) en dessous — reliés par config.",
                },
                {
                  label: "Temps réel",
                  body: "Activé par défaut : les arêtes portent le flux, les briques affichent leur activité (connecteurs, requêtes, canaux). Coupez le switch pour figer.",
                },
              ]}
            />
            <Switch
              size="sm"
              checked={live}
              onChange={(e) => setLive(e.currentTarget.checked)}
              label="Temps réel"
              aria-label="Activer le temps réel sur le Jumeau"
            />
          </Group>
        }
      />

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
        {data ? (
          current === "realtime-view" ? (
            <SocketExplorer live={live} />
          ) : (
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
          )
        ) : null}
      </DataState>

      <TwinNodePanel
        nodeId={selected}
        info={info}
        connectors={connectors}
        onClose={() => setSelected(null)}
      />
    </Stack>
  );
});

export default Twin;
