import { observer } from "mobx-react-lite";
import { useCallback, useState } from "react";
import {
  Badge,
  Button,
  Code,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconRefresh,
  IconSearch,
  IconRoute,
  IconArrowsSort,
  IconSortAscending,
  IconSortDescending,
  IconShieldOff,
} from "@tabler/icons-react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { useStore } from "../stores";
import { useResource } from "../hooks";
import { PageHeader, DataState } from "../components/ui";

/** Une route telle que sérialisée par `/nodefony/framework/api/routes`. */
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

const col = createColumnHelper<RouteRow>();

const columns = [
  col.accessor((r) => r.methods.join(","), {
    id: "methods",
    header: "Méthodes",
    enableSorting: false,
    cell: (info) => (
      <Group gap={4} wrap="nowrap">
        {info.row.original.methods.map((m) => (
          <Badge key={m} size="sm" variant="filled" color={METHOD_COLORS[m] ?? "gray"}>
            {m}
          </Badge>
        ))}
      </Group>
    ),
  }),
  col.accessor("path", {
    header: "Path",
    cell: (info) => <Code>{info.getValue() ?? "—"}</Code>,
  }),
  col.accessor("name", {
    header: "Name",
    cell: (info) => (
      <Text size="sm" c="dimmed">
        {info.getValue()}
      </Text>
    ),
  }),
  col.accessor((r) => [r.controller, r.action].filter(Boolean).join("."), {
    id: "handler",
    header: "Controller.action",
    cell: (info) => {
      const v = info.getValue();
      return v ? <Code>{v}</Code> : <Text c="dimmed">—</Text>;
    },
  }),
  col.accessor((r) => r.module ?? "", {
    id: "module",
    header: "Module",
    cell: (info) => {
      const v = info.getValue();
      return v ? (
        <Badge variant="light" color="brand" size="sm">
          {v}
        </Badge>
      ) : (
        <Text c="dimmed">—</Text>
      );
    },
  }),
  col.accessor((r) => (r.bypassFirewall ? "bypass" : "protected"), {
    id: "firewall",
    header: "Firewall",
    cell: (info) =>
      info.row.original.bypassFirewall ? (
        <Tooltip label="Route hors firewall (bypassFirewall)">
          <Badge color="red" variant="light" size="sm" leftSection={<IconShieldOff size={12} />}>
            bypass
          </Badge>
        </Tooltip>
      ) : (
        <Text c="dimmed" size="sm">
          ✓
        </Text>
      ),
  }),
];

/**
 * RoutesView — table de routage HTTP+WS réelle, alimentée par le data plane
 * `GET /nodefony/framework/api/routes` (Router dump). Recherche globale + tri.
 *
 * Page de RÉFÉRENCE du pattern d'écran Studio : `useResource` (fetch + erreur +
 * annulation), `PageHeader` (titre/sous-titre/actions), `DataState` (états
 * loading/error). Aucune donnée mock.
 */
export const RoutesView = observer(() => {
  const store = useStore();
  const fetcher = useCallback(
    () => store.api.getAbsolute<RouteRow[]>("/nodefony/framework/api/routes"),
    [store],
  );
  const { data, loading, error, reload } = useResource(fetcher);
  const rows = data ?? [];

  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "path", desc: false }]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { globalFilter, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const shown = table.getRowModel().rows.length;

  return (
    <Stack gap="md">
      <PageHeader
        icon={<IconRoute size={24} />}
        title="Routes"
        subtitle={
          <>
            Router dump via <Code>/nodefony/framework/api/routes</Code> — {shown}/
            {rows.length} route(s)
          </>
        }
        actions={
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            loading={loading}
            onClick={reload}
          >
            Recharger
          </Button>
        }
      />

      <TextInput
        placeholder="Filtrer (path, méthode, controller, module…)"
        leftSection={<IconSearch size={16} />}
        value={globalFilter}
        onChange={(e) => setGlobalFilter(e.currentTarget.value)}
        maw={420}
      />

      <DataState loading={loading && rows.length === 0} error={error} onRetry={reload}>
        <ScrollArea>
          <Table striped highlightOnHover withTableBorder stickyHeader>
            <Table.Thead>
              {table.getHeaderGroups().map((hg) => (
                <Table.Tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const sortable = h.column.getCanSort();
                    const dir = h.column.getIsSorted();
                    return (
                      <Table.Th
                        key={h.id}
                        onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                        style={{ cursor: sortable ? "pointer" : "default", userSelect: "none" }}
                      >
                        <Group gap={4} wrap="nowrap">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sortable &&
                            (dir === "asc" ? (
                              <IconSortAscending size={14} />
                            ) : dir === "desc" ? (
                              <IconSortDescending size={14} />
                            ) : (
                              <IconArrowsSort size={14} opacity={0.4} />
                            ))}
                        </Group>
                      </Table.Th>
                    );
                  })}
                </Table.Tr>
              ))}
            </Table.Thead>
            <Table.Tbody>
              {shown === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={columns.length}>
                    <Text c="dimmed" ta="center" py="md">
                      Aucune route ne correspond.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <Table.Tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <Table.Td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </DataState>
    </Stack>
  );
});

export default RoutesView;
