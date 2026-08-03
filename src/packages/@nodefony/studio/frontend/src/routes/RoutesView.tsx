import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Badge, Code, Group, Text, Tooltip } from "@mantine/core";
import { IconRoute, IconShieldOff } from "@tabler/icons-react";
import { useStore } from "../stores";
import {
  PageLayout,
  DataGrid,
  toPageParams,
  withoutColumnFilters,
  fromPage,
  type DataGridColumn,
  type DataGridServerQuery,
  type DataGridServerResult,
} from "../components/ui";
import type { IPage } from "nodefony";

/**
 * Le point d'entrée paginé des routes — une seule écriture, lue par le loader
 * ET par la lecture des capacités (une clé de catalogue qui diverge de l'URL
 * appelée rendrait `pageCapabilities` silencieusement nul, donc tout non
 * triable).
 */
const ROUTES_ENDPOINT = "/nodefony/framework/api/routes/page";

/** Une route telle que sérialisée par `/nodefony/framework/api/routes/page`. */
interface RouteRow {
  name: string;
  path: string | null;
  methods: string[];
  controller: string | null;
  action: string | null;
  module: string | null;
  host: string | null;
  bypassFirewall: boolean;
}

const METHOD_COLORS: Record<string, string> = {
  GET: "teal",
  POST: "blue",
  PUT: "yellow",
  PATCH: "grape",
  DELETE: "red",
  ANY: "gray",
};

/**
 * RoutesView — table de routage HTTP+WS, alimentée en **pagination SERVEUR** par
 * `GET /nodefony/framework/api/routes/page` (page/pageSize/sort/recherche/filtres
 * traités côté back). Démontre `<DataGrid mode="server">` : tri/filtre/recherche
 * envoyés au data plane, persistance restaurée AVANT la 1ʳᵉ requête.
 */
export const RoutesView = observer(() => {
  const store = useStore();
  const navigate = useNavigate();

  // Domaine du filtre « Méthodes » — demandé au serveur, pas deviné. En
  // pagination serveur le grid n'a qu'une page sous les yeux : il ne peut pas
  // déduire les valeurs possibles. `info` rend les méthodes RÉELLEMENT montées,
  // donc le filtre ne propose ni une méthode absente ni n'en oublie une.
  const [methodOptions, setMethodOptions] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    store.api
      .getAbsolute<{ methods: string[] }>("/nodefony/framework/api/info")
      .then((info) => {
        if (alive) setMethodOptions(info.methods ?? []);
      })
      .catch(() => {
        // Le filtre reste utilisable sans domaine (liste vide = aucune option
        // proposée) — une erreur ici ne doit pas priver la page de sa table.
      });
    return () => {
      alive = false;
    };
  }, [store]);

  // Ce que `routes/page` DÉCLARE savoir faire, lu dans le catalogue admin déjà
  // chargé — jamais deviné. Les six colonnes étaient `sortable: true` en dur et
  // coïncidaient avec l'allowlist du serveur par hasard : le premier renommage
  // aurait rendu un en-tête cliquable qui répond 400.
  const caps = store.admin.pageCapabilities(ROUTES_ENDPOINT);
  const sortable = useMemo(
    () => new Set(caps?.sortable ?? []),
    [caps?.sortable],
  );

  const loader = useCallback(
    async (q: DataGridServerQuery): Promise<DataGridServerResult<RouteRow>> => {
      // Les routes ne sont pas une ressource persistée : elles vivent en mémoire
      // dans le Router, et `routes/page` les filtre avec son propre langage
      // d'opérateurs (`contains`, `in`, `startsWith` — cf `matchOp` côté back).
      // Ce langage n'est PAS le contrat de filtre du framework (`nom=valeur`,
      // sans opérateur) : il reste donc sérialisé ICI, dans la seule vue qui le
      // parle, au lieu d'être émis d'office vers des data planes qui le
      // refuseraient.
      const params = toPageParams(withoutColumnFilters(q));
      if (q.columnFilters.length) {
        params.set("filters", JSON.stringify(q.columnFilters));
      }
      const page = await store.api.getAbsolute<IPage<RouteRow>>(
        `${ROUTES_ENDPOINT}?${params}`,
      );
      return fromPage(page);
    },
    [store],
  );

  const columns = useMemo<DataGridColumn<RouteRow>[]>(
    () => [
      {
        key: "methods",
        header: "Méthodes",
        sortable: sortable.has("methods"),
        filterable: true,
        filterType: "multiselect",
        filterOptions: methodOptions,
        value: (r) => r.methods.join(","),
        render: (r) => (
          <Group gap={4} wrap="nowrap">
            {r.methods.map((m) => (
              <Badge
                key={m}
                size="sm"
                variant="filled"
                color={METHOD_COLORS[m] ?? "gray"}
              >
                {m}
              </Badge>
            ))}
          </Group>
        ),
      },
      {
        key: "path",
        header: "Path",
        sortable: sortable.has("path"),
        filterable: true,
        filterType: "text",
        value: (r) => r.path ?? "",
        render: (r) => <Code>{r.path ?? "—"}</Code>,
      },
      {
        key: "name",
        header: "Name",
        sortable: sortable.has("name"),
        filterable: true,
        filterType: "text",
        value: (r) => r.name,
        render: (r) => (
          <Text size="sm" c="dimmed">
            {r.name}
          </Text>
        ),
      },
      {
        key: "controller",
        header: "Controller.action",
        sortable: sortable.has("controller"),
        filterable: true,
        filterType: "text",
        value: (r) => [r.controller, r.action].filter(Boolean).join("."),
        render: (r) => {
          const v = [r.controller, r.action].filter(Boolean).join(".");
          return v ? <Code>{v}</Code> : <Text c="dimmed">—</Text>;
        },
      },
      {
        key: "module",
        header: "Module",
        sortable: sortable.has("module"),
        filterable: true,
        filterType: "text",
        value: (r) => r.module ?? "",
        render: (r) => {
          const m = r.module;
          return m ? (
            <Badge
              component="button"
              variant="light"
              color="brand"
              size="sm"
              style={{ cursor: "pointer" }}
              title={`Ouvrir le module ${m}`}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/nodefony/modules/${encodeURIComponent(m)}`);
              }}
            >
              {m}
            </Badge>
          ) : (
            <Text c="dimmed">—</Text>
          );
        },
      },
      {
        key: "firewall",
        header: "Firewall",
        sortable: sortable.has("firewall"),
        filterable: true,
        filterType: "select",
        filterOptions: ["protected", "bypass"],
        value: (r) => (r.bypassFirewall ? "bypass" : "protected"),
        render: (r) =>
          r.bypassFirewall ? (
            <Tooltip label="Route hors firewall (bypassFirewall)">
              <Badge
                color="red"
                variant="light"
                size="sm"
                leftSection={<IconShieldOff size={12} />}
              >
                bypass
              </Badge>
            </Tooltip>
          ) : (
            <Text c="dimmed" size="sm">
              ✓
            </Text>
          ),
      },
    ],
    // `methodOptions` arrive APRÈS le premier rendu (fetch) — sans lui ici, les
    // colonnes resteraient mémoïsées avec un domaine vide et le filtre ne
    // proposerait jamais rien. Même raison pour `sortable` : le catalogue admin
    // arrive lui aussi après le premier rendu.
    [navigate, methodOptions, sortable],
  );

  return (
    <PageLayout
      icon={<IconRoute size={24} />}
      title="Routes"
      subtitle={
        <>
          Pagination SERVEUR via{" "}
          <Code>/nodefony/framework/api/routes/page</Code>
        </>
      }
    >
      <DataGrid
        mode="server"
        loader={loader}
        columns={columns}
        getRowId={(r) => r.name || `${r.methods.join()}:${r.path}`}
        // Un tri initial sur un champ que le serveur ne trie pas partirait en
        // 400 dès le premier chargement, avant tout clic.
        initialSort={
          sortable.has("path") ? { key: "path", dir: "asc" } : undefined
        }
        pageSize={25}
        searchable={caps?.search ?? false}
        searchPlaceholder="Rechercher (path, méthode, controller, module…)"
        emptyMessage="Aucune route ne correspond."
        persist={{ key: "studio.routes", storage: "session" }}
      />
    </PageLayout>
  );
});

export default RoutesView;
