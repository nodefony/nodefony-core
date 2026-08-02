import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  Group,
  Loader,
  LoadingOverlay,
  Menu,
  MultiSelect,
  Pagination,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronUp,
  IconColumns3,
  IconFilter,
  IconFilterOff,
  IconSearch,
  IconSelector,
  IconTrash,
} from "@tabler/icons-react";
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnSizingState,
  type FilterFn,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { DataState } from "./DataState";
import { InfoHint } from "./StatCard";

/** Type de filtre d'une colonne → opérateurs + saisie disponibles. */
export type DataGridFilterType = "text" | "number" | "select" | "multiselect";

/** Opérateur de filtre. */
export type DataGridFilterOp =
  | "contains"
  | "equals"
  | "in"
  | "startsWith"
  | "endsWith"
  | "isEmpty"
  | "notEmpty"
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<=";

/** Valeur de filtre stockée par colonne (TanStack `columnFilters`). */
interface FilterValue {
  op: DataGridFilterOp;
  value: string;
}

/** Un filtre actif (forme exposée au loader serveur). */
export interface DataGridColumnFilter {
  key: string;
  op: DataGridFilterOp;
  value: string;
}

/** Définition d'une colonne du {@link DataGrid}. */
export interface DataGridColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  sortable?: boolean;
  /** Active le filtre par colonne (ligne de filtres inline sous l'en-tête). */
  filterable?: boolean;
  /**
   * Type de filtre (défaut `"text"`). `"select"` → une valeur ;
   * `"multiselect"` → plusieurs (opérateur « est l'un de »), pour une colonne
   * dont le domaine est fermé et court : méthodes HTTP, statuts, sévérités.
   */
  filterType?: DataGridFilterType;
  /**
   * Options des filtres `select`/`multiselect` — REQUIS en mode serveur (le
   * grid n'a qu'une page, il ne peut pas déduire le domaine) ; déduit par
   * faceting en mode client.
   */
  filterOptions?: string[];
  hint?: string;
  render?: (row: T) => ReactNode;
  /** Valeur scalaire — tri + recherche + filtre, et affichage par défaut. */
  value?: (row: T) => string | number | null;
  /** Largeur initiale (px) — la colonne reste redimensionnable. */
  size?: number;
}

export interface DataGridSort {
  key: string;
  dir: "asc" | "desc";
}

/** Requête envoyée au loader en mode **serveur**. */
export interface DataGridServerQuery {
  page: number;
  pageSize: number;
  sort: DataGridSort | null;
  search: string;
  columnFilters: DataGridColumnFilter[];
}

export interface DataGridServerResult<T> {
  rows: T[];
  total: number;
}

/** Persistance de l'état du grid (tri/filtres/recherche/colonnes/pagination). */
export interface DataGridPersist {
  /** Clé de stockage (unique par grille, ex. `"studio.orm.databases"`). */
  key: string;
  /** Cible : `"session"` (défaut, onglet) ou `"local"` (durable). */
  storage?: "session" | "local";
}

interface BaseProps<T> {
  columns: DataGridColumn<T>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  /**
   * Atténue (opacité réduite) une ligne « inactive » pour la repérer d'un coup
   * d'œil — ex. webhook désactivé, clé révoquée, utilisateur verrouillé. Le badge
   * de statut porte la couleur ; le dim distingue le bloc inactif du reste.
   */
  dimRow?: (row: T) => boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
  emptyMessage?: string;
  height?: number | string;
  initialSort?: DataGridSort;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Message affiché dans l'overlay de chargement (défaut « Chargement… »). */
  loadingMessage?: string;
  /** Sauvegarde/restaure l'état dans le storage navigateur (+ bouton « effacer »). */
  persist?: DataGridPersist;
  /**
   * Mode SERVEUR : signal de filtres EXTERNES (barre de filtres pilotée par la
   * page, hors `columnFilters` natifs). Quand sa valeur change, la pagination
   * repart à la page 1 (comme le fait le filtre natif) → évite de requêter une
   * page inexistante après un nouveau filtrage. Mémoïser une valeur stable
   * (ex. une string dérivée des filtres).
   */
  resetPageSignal?: unknown;
  /**
   * Active la **sélection multiple** : colonne de cases à cocher en 1ʳᵉ position +
   * case « select-all » dans l'en-tête (état indéterminé si sélection partielle).
   * Sans cette prop, le rendu est INCHANGÉ (opt-in, 100 % rétro-compatible).
   */
  selectable?: boolean;
  /**
   * Barre d'actions groupées rendue AU-DESSUS du tableau (sous la toolbar),
   * visible uniquement si `selectable` ET au moins une ligne cochée. Reçoit les
   * lignes sélectionnées (`T[]`) + `clearSelection()` pour tout désélectionner.
   */
  bulkActions?: (selectedRows: T[], clearSelection: () => void) => ReactNode;
}

/** Mode CLIENT : `data` complet → TanStack trie/filtre/pagine en mémoire. */
interface ClientProps<T> extends BaseProps<T> {
  mode: "client";
  data: T[];
  loading?: boolean;
  error?: string | null;
}

/** Mode SERVEUR : `loader` (mémoïsé !) appelé à chaque page/tri/recherche/filtre. */
interface ServerProps<T> extends BaseProps<T> {
  mode: "server";
  loader: (q: DataGridServerQuery) => Promise<DataGridServerResult<T>>;
}

export type DataGridProps<T> = ClientProps<T> | ServerProps<T>;

// ── Persistance (storage navigateur) ────────────────────────────────────────
interface PersistedState {
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  globalFilter: string;
  columnVisibility: VisibilityState;
  columnSizing: ColumnSizingState;
  pageIndex: number;
  pageSize: number;
}

/** Préfixe de namespace → indexe le storage par grille (clé unique par DataGrid). */
const STORAGE_PREFIX = "nf.datagrid:";
const storageKey = (p: DataGridPersist) => STORAGE_PREFIX + p.key;

function getStore(kind: "session" | "local"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Lit l'état persisté (SYNCHRONE → utilisable dans un initialiseur `useState`). */
function loadPersisted(p?: DataGridPersist): Partial<PersistedState> | null {
  if (!p) return null;
  const s = getStore(p.storage ?? "session");
  if (!s) return null;
  try {
    const raw = s.getItem(storageKey(p));
    return raw ? (JSON.parse(raw) as Partial<PersistedState>) : null;
  } catch {
    return null;
  }
}

// Métadonnées portées par chaque colonne TanStack (align/filtre/aide).
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right";
    filterType?: DataGridFilterType;
    filterOptions?: string[];
    hint?: string;
  }
}

const TEXT_OPS: { value: DataGridFilterOp; label: string }[] = [
  { value: "contains", label: "contient" },
  { value: "equals", label: "égal à" },
  { value: "startsWith", label: "commence par" },
  { value: "endsWith", label: "finit par" },
  { value: "isEmpty", label: "est vide" },
  { value: "notEmpty", label: "non vide" },
];
const NUMBER_OPS: { value: DataGridFilterOp; label: string }[] = [
  { value: "=", label: "=" },
  { value: "!=", label: "≠" },
  { value: ">", label: ">" },
  { value: ">=", label: "≥" },
  { value: "<", label: "<" },
  { value: "<=", label: "≤" },
];
const SELECT_OPS: { value: DataGridFilterOp; label: string }[] = [
  { value: "equals", label: "est" },
];
const MULTISELECT_OPS: { value: DataGridFilterOp; label: string }[] = [
  { value: "in", label: "est l'un de" },
];
const VALUELESS: ReadonlySet<DataGridFilterOp> = new Set([
  "isEmpty",
  "notEmpty",
]);

function opsFor(type: DataGridFilterType | undefined) {
  if (type === "number") return NUMBER_OPS;
  if (type === "select") return SELECT_OPS;
  if (type === "multiselect") return MULTISELECT_OPS;
  return TEXT_OPS;
}

/**
 * Sépare la valeur d'un filtre `in` — une liste est transportée comme UNE
 * chaîne (`"GET,POST"`), parce que `DataGridColumnFilter.value` est un `string`
 * qui doit traverser une query string. Les jetons vides sont écartés.
 */
const tokens = (raw: string): string[] =>
  raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");

const NUM_OPS: ReadonlySet<DataGridFilterOp> = new Set([
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
]);

function matchFilter(raw: unknown, f: FilterValue): boolean {
  const s = String(raw ?? "");
  const v = f.value;
  // Saisie partielle / non comparable → ne filtre PAS (évite de tout vider en tapant).
  if (!VALUELESS.has(f.op) && v === "") return true;
  if (NUM_OPS.has(f.op) && Number.isNaN(Number(v))) return true;
  switch (f.op) {
    case "contains":
      return s.toLowerCase().includes(v.toLowerCase());
    case "equals":
      return s === v;
    // « est l'un de » : la cellule est elle aussi découpée en jetons, si bien
    // qu'une colonne multi-valeur (`GET,POST`) matche dès qu'UNE des méthodes
    // choisies s'y trouve. Une cellule mono-valeur ne donne qu'un jeton — la
    // même règle y produit le « est l'un de » attendu, sans second cas.
    case "in": {
      const wanted = tokens(v);
      if (wanted.length === 0) return true;
      const cell = tokens(s);
      return cell.some((c) => wanted.includes(c));
    }
    case "startsWith":
      return s.toLowerCase().startsWith(v.toLowerCase());
    case "endsWith":
      return s.toLowerCase().endsWith(v.toLowerCase());
    case "isEmpty":
      return s === "";
    case "notEmpty":
      return s !== "";
    case "=":
      return Number(raw) === Number(v);
    case "!=":
      return Number(raw) !== Number(v);
    case ">":
      return Number(raw) > Number(v);
    case ">=":
      return Number(raw) >= Number(v);
    case "<":
      return Number(raw) < Number(v);
    case "<=":
      return Number(raw) <= Number(v);
    default:
      return true;
  }
}

// filterFn TanStack : applique l'opérateur stocké à la valeur de cellule.
const operatorFilter: FilterFn<unknown> = (row, columnId, filterValue) => {
  const f = filterValue as FilterValue | undefined;
  if (!f) return true;
  return matchFilter(row.getValue(columnId), f);
};

// Styles de la poignée de redimensionnement — injectés UNE fois (hover via CSS,
// pas de re-render par survol). Au repos : invisible (zéro barre permanente).
// Survol : grip gris discret. Drag : barre accent pleine hauteur.
let resizerStyleInjected = false;
function ensureResizerStyle() {
  if (resizerStyleInjected || typeof document === "undefined") return;
  resizerStyleInjected = true;
  const el = document.createElement("style");
  el.setAttribute("data-nf-datagrid-resizer", "");
  el.textContent = `
.nf-dg-resizer{position:absolute;top:0;right:0;height:100%;width:11px;
  display:flex;align-items:center;justify-content:flex-end;
  cursor:col-resize;user-select:none;touch-action:none;z-index:2;
  background:transparent;}
.nf-dg-resizer::before{content:"";width:2px;height:55%;border-radius:2px;
  background:var(--mantine-color-default-border);opacity:.35;
  transition:opacity 120ms ease,height 120ms ease,background-color 120ms ease;}
.nf-dg-resizer:hover::before{opacity:1;height:70%;}
.nf-dg-resizer[data-resizing="true"]::before{opacity:1;height:100%;
  background:var(--mantine-primary-color-filled);}
`;
  document.head.appendChild(el);
}

/** Filtre INLINE d'une colonne (sous l'en-tête) — opérateur + valeur, sans popover. */
function FilterCell<T>({
  column,
  isServer,
}: {
  column: Column<T, unknown>;
  isServer: boolean;
}) {
  const meta = column.columnDef.meta;
  const type = meta?.filterType ?? "text";
  const ops = opsFor(type);
  const fv = column.getFilterValue() as FilterValue | undefined;
  const op = fv?.op ?? ops[0].value;
  const value = fv?.value ?? "";
  const valueless = VALUELESS.has(op);
  const header = String(column.columnDef.header ?? column.id);

  if (type === "multiselect") {
    // Domaine fermé : en mode serveur il est DÉCLARÉ (le grid n'a qu'une page,
    // il ne peut rien déduire) ; en client il vient du faceting. Une cellule
    // multi-valeur (`GET,POST`) est éclatée en jetons, sinon la liste proposerait
    // des combinaisons au lieu des valeurs.
    const options = isServer
      ? (meta?.filterOptions ?? [])
      : [
          ...new Set(
            [...column.getFacetedUniqueValues().keys()].flatMap((v) =>
              tokens(String(v)),
            ),
          ),
        ].sort();
    return (
      <MultiSelect
        size="xs"
        placeholder="filtrer"
        data={options}
        value={tokens(value)}
        clearable
        searchable
        hidePickedOptions
        comboboxProps={{ withinPortal: true }}
        onChange={(vals) =>
          column.setFilterValue(
            vals.length ? { op: "in", value: vals.join(",") } : undefined,
          )
        }
        aria-label={`filtrer ${header}`}
      />
    );
  }

  if (type === "select") {
    const options = isServer
      ? (meta?.filterOptions ?? [])
      : [...column.getFacetedUniqueValues().keys()]
          .map((v) => String(v))
          .filter((s) => s.length > 0)
          .sort();
    return (
      <Select
        size="xs"
        placeholder="filtrer"
        data={options}
        value={value || null}
        clearable
        searchable
        comboboxProps={{ withinPortal: true }}
        onChange={(v) =>
          column.setFilterValue(v ? { op: "equals", value: v } : undefined)
        }
        aria-label={`filtrer ${header}`}
      />
    );
  }

  return (
    <Group gap={4} wrap="nowrap">
      <Select
        size="xs"
        w={type === "number" ? 64 : 96}
        data={ops}
        value={op}
        comboboxProps={{ withinPortal: true }}
        aria-label={`opérateur ${header}`}
        onChange={(v) => {
          if (!v) return;
          const no = v as DataGridFilterOp;
          if (VALUELESS.has(no)) column.setFilterValue({ op: no, value: "" });
          else
            column.setFilterValue(value !== "" ? { op: no, value } : undefined);
        }}
      />
      {!valueless && (
        <TextInput
          size="xs"
          type={type === "number" ? "number" : "text"}
          placeholder="valeur"
          value={value}
          aria-label={`valeur ${header}`}
          onChange={(e) => {
            const nv = e.currentTarget.value;
            column.setFilterValue(nv !== "" ? { op, value: nv } : undefined);
          }}
        />
      )}
    </Group>
  );
}

/**
 * **DataGrid** — grille paginée RÉUTILISABLE bâtie sur **TanStack Table** (déjà
 * dans nos deps) : tri, filtres par colonne à OPÉRATEURS (inline, pas de popover),
 * faceting (valeurs distinctes), recherche globale, pagination **client ou serveur**.
 *
 * - `mode="client"` : `data` → tri/filtre/pagination en mémoire (getXxxRowModel).
 * - `mode="server"` : `loader({page,pageSize,sort,search,columnFilters})` → manual*
 *   (le serveur fait le travail). ⚠️ `loader` DOIT être mémoïsé (`useCallback`).
 *
 * Colonnes déclaratives (`render`/`value`/`sortable`/`filterable`/`filterType`/`hint`).
 */
export function DataGrid<T>(props: DataGridProps<T>) {
  const {
    columns,
    getRowId,
    onRowClick,
    dimRow,
    pageSizeOptions = [10, 25, 50, 100],
    emptyMessage = "Aucune donnée.",
    // Défaut GLOBAL = mode flux : la page scrolle (1 seul scroll, pas de « scroll
    // trap » de tableau imbriqué) + pagination collée en bas (sticky) + en-tête
    // figé. Une grille pleine page sans contenu au-dessus peut passer un token de
    // hauteur fixe explicite. Règle : cf skill nodefony-studio-dev (mandatory).
    height = "auto",
    initialSort,
  } = props;
  const isServer = props.mode === "server";
  const defaultSort: SortingState = initialSort
    ? [{ id: initialSort.key, desc: initialSort.dir === "desc" }]
    : [];

  // Lecture SYNCHRONE du storage une seule fois (initialiseurs lazy) → l'état
  // restauré est prêt AVANT le 1er rendu et AVANT le 1er appel serveur (pas de
  // double-fetch « vide puis restauré »).
  const [persisted] = useState(() => loadPersisted(props.persist));

  const [sorting, setSorting] = useState<SortingState>(
    () => persisted?.sorting ?? defaultSort,
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    () => persisted?.columnFilters ?? [],
  );
  const [globalFilter, setGlobalFilter] = useState(
    () => persisted?.globalFilter ?? "",
  );
  const [pagination, setPagination] = useState<PaginationState>(() => ({
    pageIndex: persisted?.pageIndex ?? 0,
    pageSize: persisted?.pageSize ?? props.pageSize ?? 25,
  }));
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => persisted?.columnVisibility ?? {},
  );
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
    () => persisted?.columnSizing ?? {},
  );
  const [showFilters, setShowFilters] = useState(
    () => (persisted?.columnFilters?.length ?? 0) > 0,
  );
  // Sélection multiple (opt-in) — indexée par `getRowId` → stable au tri/filtre.
  // Volontairement NON persistée (transitoire, comme une sélection d'écran).
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const clearSelection = () => setRowSelection({});

  // Injecte le style de la poignée de resize une seule fois (CSS hover/drag).
  useEffect(ensureResizerStyle, []);

  const loader = isServer ? props.loader : null;
  const [serverRows, setServerRows] = useState<T[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Mode serveur : (re)charge à chaque changement d'état.
  useEffect(() => {
    if (!loader) return;
    let cancelled = false;
    setServerLoading(true);
    const sort: DataGridSort | null = sorting[0]
      ? { key: sorting[0].id, dir: sorting[0].desc ? "desc" : "asc" }
      : null;
    const cf: DataGridColumnFilter[] = columnFilters.map((f) => {
      const v = f.value as FilterValue;
      return { key: f.id, op: v.op, value: v.value };
    });
    loader({
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      sort,
      search: globalFilter,
      columnFilters: cf,
    })
      .then((res) => {
        if (cancelled) return;
        setServerRows(res.rows);
        setServerTotal(res.total);
        setServerError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setServerError(e instanceof Error ? e.message : "chargement échoué");
      })
      .finally(() => {
        if (!cancelled) setServerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    loader,
    sorting,
    columnFilters,
    globalFilter,
    pagination.pageIndex,
    pagination.pageSize,
  ]);

  // Persiste l'état (tri/filtres/recherche/colonnes/pagination) à chaque changement.
  useEffect(() => {
    if (!props.persist) return;
    const s = getStore(props.persist.storage ?? "session");
    if (!s) return;
    const snap: PersistedState = {
      sorting,
      columnFilters,
      globalFilter,
      columnVisibility,
      columnSizing,
      pageIndex: pagination.pageIndex,
      pageSize: pagination.pageSize,
    };
    try {
      s.setItem(storageKey(props.persist), JSON.stringify(snap));
    } catch {
      /* quota / navigation privée — on ignore */
    }
  }, [
    props.persist,
    sorting,
    columnFilters,
    globalFilter,
    columnVisibility,
    columnSizing,
    pagination,
  ]);

  // Tout changement de tri/filtre/recherche ramène page 1 (client ET serveur)
  // → évite de requêter une page inexistante après filtrage.
  useEffect(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [sorting, columnFilters, globalFilter]);

  // Idem pour les filtres EXTERNES (mode serveur) : un changement de signal
  // ramène page 1 ET PURGE les lignes affichées. On saute le 1ᵉʳ rendu (sinon on
  // annulerait une page restaurée du storage au montage).
  //
  // 🔑 La purge est cruciale : sans elle, pendant le refetch (event-loop chargé →
  // réponse lente), la grille continue d'afficher l'ANCIEN résultat (non filtré,
  // ex. des DEBUG) → on croit que le filtre « ne marche pas ». Vider d'abord =
  // on ne voit jamais un résultat périmé sous un filtre actif.
  const firstResetSignal = useRef(true);
  useEffect(() => {
    if (firstResetSignal.current) {
      firstResetSignal.current = false;
      return;
    }
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
    setServerRows([]);
    setServerTotal(0);
  }, [props.resetPageSignal]);

  const data = isServer
    ? serverRows
    : props.mode === "client"
      ? props.data
      : [];

  const tableColumns = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((col) => ({
        id: col.key,
        accessorFn: (row: T) => (col.value ? col.value(row) : ""),
        header: col.header,
        enableSorting: col.sortable ?? false,
        enableColumnFilter: col.filterable ?? false,
        size: col.size,
        filterFn: operatorFilter as FilterFn<T>,
        cell: (ctx) =>
          col.render
            ? col.render(ctx.row.original)
            : String(ctx.getValue() ?? ""),
        meta: {
          align: col.align,
          filterType: col.filterType,
          filterOptions: col.filterOptions,
          hint: col.hint,
        },
      })),
    [columns],
  );

  const table = useReactTable<T>({
    data,
    columns: tableColumns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
      pagination,
      columnVisibility,
      columnSizing,
      rowSelection,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: props.selectable ?? false,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    getRowId: (row) => getRowId(row),
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    manualPagination: isServer,
    manualSorting: isServer,
    manualFiltering: isServer,
    rowCount: isServer ? serverTotal : undefined,
    ...(isServer
      ? {}
      : {
          getSortedRowModel: getSortedRowModel(),
          getFilteredRowModel: getFilteredRowModel(),
          getPaginationRowModel: getPaginationRowModel(),
          getFacetedRowModel: getFacetedRowModel(),
          getFacetedUniqueValues: getFacetedUniqueValues(),
        }),
  });

  const loading = isServer ? serverLoading : (props.loading ?? false);
  const error = isServer ? serverError : (props.error ?? null);
  const rows = table.getRowModel().rows;
  const total = isServer
    ? serverTotal
    : table.getFilteredRowModel().rows.length;
  const pageCount = isServer
    ? Math.max(1, Math.ceil(serverTotal / pagination.pageSize))
    : Math.max(1, table.getPageCount());
  const start =
    total === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const end = Math.min((pagination.pageIndex + 1) * pagination.pageSize, total);

  const searchable = props.searchable ?? true;
  const filterable = columns.some((c) => c.filterable);
  const activeCount = columnFilters.length;
  const hasActive = globalFilter.trim().length > 0 || activeCount > 0;
  const reset = () => {
    setGlobalFilter("");
    setColumnFilters([]);
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  };
  // Efface la sauvegarde storage ET remet l'état par défaut (tri/colonnes inclus).
  const clearStorage = () => {
    if (props.persist) {
      getStore(props.persist.storage ?? "session")?.removeItem(
        storageKey(props.persist),
      );
    }
    setSorting(defaultSort);
    setColumnFilters([]);
    setGlobalFilter("");
    setColumnVisibility({});
    setColumnSizing({});
    setPagination({ pageIndex: 0, pageSize: props.pageSize ?? 25 });
    setShowFilters(false);
  };

  // Sélection multiple — lignes cochées (page courante en mode serveur).
  const selectable = props.selectable ?? false;
  const selectedRows = selectable
    ? table.getSelectedRowModel().rows.map((r) => r.original)
    : [];
  const showBulkBar =
    selectable && !!props.bulkActions && selectedRows.length > 0;

  const sortIcon = (s: false | "asc" | "desc") =>
    s === false ? (
      <IconSelector size={13} style={{ opacity: 0.4 }} />
    ) : s === "asc" ? (
      <IconChevronUp size={13} />
    ) : (
      <IconChevronDown size={13} />
    );

  return (
    <Stack
      gap="xs"
      style={{
        // `height="auto"` = grille en FLUX (hauteur de son contenu) → la PAGE
        // scrolle (pas de scroll interne qui capte la molette), pagination
        // toujours atteignable. Sinon hauteur fixe → scroll interne classique.
        height: height === "auto" ? undefined : height,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Group gap="xs" wrap="nowrap">
        {searchable && (
          <TextInput
            size="xs"
            leftSection={<IconSearch size={14} />}
            placeholder={props.searchPlaceholder ?? "Rechercher…"}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 200 }}
            aria-label="recherche dans le tableau"
          />
        )}
        {!searchable && <div style={{ flex: 1 }} />}
        {filterable && (
          <Button
            size="xs"
            variant={showFilters ? "light" : "subtle"}
            color={activeCount > 0 ? "brand" : "gray"}
            leftSection={<IconFilter size={14} />}
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
          >
            Filtres{activeCount > 0 ? ` (${activeCount})` : ""}
          </Button>
        )}
        {hasActive && (
          <Button
            size="xs"
            variant="light"
            color="red"
            leftSection={<IconFilterOff size={14} />}
            onClick={reset}
            aria-label="effacer recherche et filtres"
          >
            Effacer{activeCount > 0 ? ` (${activeCount})` : ""}
          </Button>
        )}
        <Menu
          shadow="md"
          position="bottom-end"
          withinPortal
          closeOnItemClick={false}
        >
          <Menu.Target>
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              leftSection={<IconColumns3 size={14} />}
            >
              Colonnes
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Afficher les colonnes</Menu.Label>
            <Stack gap={6} px="sm" py={4}>
              {table.getAllLeafColumns().map((col) => (
                <Checkbox
                  key={col.id}
                  size="xs"
                  checked={col.getIsVisible()}
                  onChange={() => col.toggleVisibility()}
                  label={String(col.columnDef.header ?? col.id)}
                />
              ))}
            </Stack>
            {props.persist && (
              <>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={clearStorage}
                >
                  Effacer la sauvegarde
                </Menu.Item>
              </>
            )}
          </Menu.Dropdown>
        </Menu>
      </Group>
      {showBulkBar && (
        <Paper withBorder p="xs" role="region" aria-label="Actions groupées">
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Group gap="sm" wrap="nowrap">
              <Text size="sm" fw={600}>
                {selectedRows.length} sélectionné
                {selectedRows.length > 1 ? "s" : ""}
              </Text>
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                onClick={clearSelection}
              >
                Tout désélectionner
              </Button>
            </Group>
            <Group gap="xs" wrap="nowrap">
              {props.bulkActions?.(selectedRows, clearSelection)}
            </Group>
          </Group>
        </Paper>
      )}
      <div
        style={{
          position: "relative",
          flex: height === "auto" ? "0 0 auto" : 1,
          minHeight: 0,
          display: "flex",
        }}
      >
        <LoadingOverlay
          visible={loading}
          zIndex={3}
          overlayProps={{ backgroundOpacity: 0.35 }}
          loaderProps={{
            children: (
              <Stack align="center" gap={6}>
                <Loader size="sm" />
                <Text size="xs" c="dimmed">
                  {props.loadingMessage ?? "Chargement…"}
                </Text>
              </Stack>
            ),
          }}
        />
        <ScrollArea
          // `flex:1` TOUJOURS : le parent est un flex ROW → flex pilote la
          // LARGEUR (la grille doit remplir toute la largeur dispo). Le mode flux
          // ne change que le scroll vertical : `type="never"` = pas de scrollbar
          // interne (la page scrolle), `minHeight:0` neutre en hauteur auto.
          style={{ flex: 1, minHeight: 0, width: "100%" }}
          type={height === "auto" ? "never" : "auto"}
          offsetScrollbars="y"
        >
          <DataState loading={false} error={error}>
            {/* Mode flux (page-scroll) : header NON sticky — sinon il colle au même
                `top:0` que le PageHeader (sa propre topbar) avec un z-index Mantine
                plus haut → il passe DEVANT le titre de page (conflit z signalé). En
                hauteur fixe, il colle DANS le ScrollArea interne (aucun contact avec
                la page) → sticky OK. */}
            <Table
              stickyHeader={height !== "auto"}
              striped
              highlightOnHover
              style={{
                tableLayout: "fixed",
                width: table.getCenterTotalSize(),
                minWidth: "100%",
              }}
            >
              <Table.Thead>
                {table.getHeaderGroups().map((hg) => (
                  <Table.Tr key={hg.id}>
                    {selectable && (
                      <Table.Th
                        style={{ width: 36, textAlign: "center" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          size="xs"
                          aria-label="Tout sélectionner"
                          checked={table.getIsAllPageRowsSelected()}
                          indeterminate={table.getIsSomePageRowsSelected()}
                          onChange={table.getToggleAllPageRowsSelectedHandler()}
                        />
                      </Table.Th>
                    )}
                    {hg.headers.map((h) => {
                      const align = h.column.columnDef.meta?.align ?? "left";
                      const hint = h.column.columnDef.meta?.hint;
                      return (
                        <Table.Th
                          key={h.id}
                          style={{
                            textAlign: align,
                            width: h.getSize(),
                            position: "relative",
                          }}
                        >
                          <Group
                            gap={4}
                            wrap="nowrap"
                            justify={
                              align === "right" ? "flex-end" : "flex-start"
                            }
                          >
                            {h.column.getCanSort() ? (
                              <UnstyledButton
                                onClick={h.column.getToggleSortingHandler()}
                                aria-label={`trier par ${String(h.column.columnDef.header)}`}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                }}
                              >
                                <Text size="sm" fw={600}>
                                  {flexRender(
                                    h.column.columnDef.header,
                                    h.getContext(),
                                  )}
                                </Text>
                                {sortIcon(h.column.getIsSorted())}
                              </UnstyledButton>
                            ) : (
                              <Text size="sm" fw={600}>
                                {flexRender(
                                  h.column.columnDef.header,
                                  h.getContext(),
                                )}
                              </Text>
                            )}
                            {hint ? <InfoHint text={hint} /> : null}
                          </Group>
                          {h.column.getCanResize() && (
                            <div
                              className="nf-dg-resizer"
                              data-resizing={
                                h.column.getIsResizing() ? "true" : undefined
                              }
                              onMouseDown={h.getResizeHandler()}
                              onTouchStart={h.getResizeHandler()}
                              onClick={(e) => e.stopPropagation()}
                              onDoubleClick={() => h.column.resetSize()}
                              role="separator"
                              aria-orientation="vertical"
                              aria-label={`redimensionner ${String(h.column.columnDef.header)}`}
                              title="Glisser pour redimensionner · double-clic pour réinitialiser"
                            />
                          )}
                        </Table.Th>
                      );
                    })}
                  </Table.Tr>
                ))}
                {showFilters && (
                  <Table.Tr>
                    {selectable && <Table.Th style={{ width: 36 }} />}
                    {table.getHeaderGroups()[0]?.headers.map((h) => (
                      <Table.Th
                        key={`f-${h.id}`}
                        style={{
                          paddingTop: 4,
                          paddingBottom: 8,
                          width: h.getSize(),
                        }}
                      >
                        {h.column.getCanFilter() ? (
                          <FilterCell column={h.column} isServer={isServer} />
                        ) : null}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                )}
              </Table.Thead>
              <Table.Tbody>
                {rows.length === 0 && !loading && (
                  <Table.Tr>
                    <Table.Td
                      colSpan={
                        table.getVisibleLeafColumns().length +
                        (selectable ? 1 : 0)
                      }
                      style={{ textAlign: "center", padding: 24 }}
                    >
                      <Text size="sm" c="dimmed">
                        {emptyMessage}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
                {rows.map((row) => (
                  <Table.Tr
                    key={row.id}
                    onClick={
                      onRowClick ? () => onRowClick(row.original) : undefined
                    }
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRowClick(row.original);
                            }
                          }
                        : undefined
                    }
                    tabIndex={onRowClick ? 0 : undefined}
                    style={{
                      ...(onRowClick ? { cursor: "pointer" } : null),
                      // Ligne inactive (désactivée/révoquée/verrouillée) → atténuée.
                      ...(dimRow?.(row.original) ? { opacity: 0.5 } : null),
                    }}
                  >
                    {selectable && (
                      <Table.Td
                        style={{ width: 36, textAlign: "center" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          size="xs"
                          aria-label="Sélectionner la ligne"
                          checked={row.getIsSelected()}
                          onChange={row.getToggleSelectedHandler()}
                        />
                      </Table.Td>
                    )}
                    {row.getVisibleCells().map((cell) => (
                      <Table.Td
                        key={cell.id}
                        style={{
                          textAlign:
                            cell.column.columnDef.meta?.align ?? "left",
                          width: cell.column.getSize(),
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </DataState>
        </ScrollArea>
      </div>

      <Group
        justify="space-between"
        wrap="nowrap"
        gap="xs"
        style={
          // Mode flux (`height="auto"`) : la PAGE scrolle (1 seul scroll, pas de
          // « scroll trap » de tableau imbriqué — anti-pattern UX) et la barre de
          // pagination reste COLLÉE en bas du viewport (toujours accessible). Fond
          // opaque + bordure pour ne pas laisser voir les lignes défiler dessous.
          height === "auto"
            ? {
                position: "sticky",
                // `AppShell.Main` a `paddingBottom: spacing-md + debugbar` → un
                // `bottom:0` laisserait cette marge sous la barre. On tire de
                // `-spacing-md` pour COLLER la barre au bas (la part `debugbar` du
                // padding est préservée → jamais masquée par la debug bar).
                bottom: "calc(-1 * var(--mantine-spacing-md))",
                // Sous le PageHeader (z:2) et la StickyTabsList (z:1), au-dessus
                // des lignes qui défilent dessous (échelle z des sticky).
                zIndex: 1,
                background: "var(--mantine-color-body)",
                borderTop: "1px solid var(--mantine-color-default-border)",
                paddingBlock: "var(--mantine-spacing-xs)",
              }
            : undefined
        }
      >
        <Text size="xs" c="dimmed">
          {start}–{end} sur {total}
        </Text>
        <Group gap="xs" wrap="nowrap">
          <Select
            data={pageSizeOptions.map((n) => String(n))}
            value={String(pagination.pageSize)}
            onChange={(v) => v && table.setPageSize(Number(v))}
            size="xs"
            w={92}
            aria-label="lignes par page"
            comboboxProps={{ withinPortal: true }}
          />
          <Pagination
            total={pageCount}
            value={pagination.pageIndex + 1}
            onChange={(p) => table.setPageIndex(p - 1)}
            size="sm"
            withEdges
          />
        </Group>
      </Group>
    </Stack>
  );
}
