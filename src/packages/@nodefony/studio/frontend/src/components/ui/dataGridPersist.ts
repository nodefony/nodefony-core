/**
 * État persisté d'un `DataGrid` (tri, filtres, recherche, colonnes, pagination)
 * et sa relecture gardée.
 *
 * Séparé du composant pour être lu sans React : la relecture est une frontière
 * (stockage navigateur, cf `utils/storedJson.ts`) et s'éprouve en test unitaire.
 *
 * Les formes sont décrites ici sans importer TanStack Table, dont `DataGrid.tsx`
 * reste le seul point de contact : elles recopient sa structure, et c'est
 * l'affectation dans `DataGrid` qui confronte les deux au typage.
 */
import { isPlainObject } from "nodefony";
import {
  arrayOf,
  isBoolean,
  isFiniteNumber,
  isString,
  recordOf,
} from "../../utils/guards";

/** Un critère de tri — forme de `ColumnSort` (TanStack). */
interface ColumnSort {
  id: string;
  desc: boolean;
}

/** Un filtre de colonne — forme de `ColumnFilter` (TanStack). */
interface ColumnFilter {
  id: string;
  value: unknown;
}

/** Ce qu'une grille écrit dans le stockage navigateur. */
export interface PersistedState {
  sorting: ColumnSort[];
  columnFilters: ColumnFilter[];
  globalFilter: string;
  columnVisibility: Record<string, boolean>;
  columnSizing: Record<string, number>;
  pageIndex: number;
  pageSize: number;
}

const isColumnSort = (v: unknown): v is ColumnSort =>
  isPlainObject(v) && typeof v.id === "string" && typeof v.desc === "boolean";

const isColumnFilter = (v: unknown): v is ColumnFilter =>
  isPlainObject(v) && typeof v.id === "string" && "value" in v;

const isPageIndex = (v: unknown): v is number =>
  Number.isInteger(v) && typeof v === "number" && v >= 0;

const isPageSize = (v: unknown): v is number =>
  Number.isInteger(v) && typeof v === "number" && v > 0;

/**
 * Reconstruit l'état d'une grille relu du stockage, champ par champ.
 *
 * Un champ d'une autre forme est abandonné (la grille reprend son défaut pour
 * lui seul) ; les autres sont gardés. Sans cela, un tri relu sous une ancienne
 * forme faisait planter le moteur de tableau à chaque montage.
 *
 * @param value - valeur relue (`readStoredJson`)
 * @returns les champs reconnus ; `null` si la valeur n'est pas un objet
 */
export function parsePersistedState(
  value: unknown,
): Partial<PersistedState> | null {
  if (!isPlainObject(value)) return null;
  const out: Partial<PersistedState> = {};
  if (Array.isArray(value.sorting)) {
    out.sorting = arrayOf(value.sorting, isColumnSort);
  }
  if (Array.isArray(value.columnFilters)) {
    out.columnFilters = arrayOf(value.columnFilters, isColumnFilter);
  }
  if (isString(value.globalFilter)) out.globalFilter = value.globalFilter;
  if (isPlainObject(value.columnVisibility)) {
    out.columnVisibility = recordOf(value.columnVisibility, isBoolean);
  }
  if (isPlainObject(value.columnSizing)) {
    out.columnSizing = recordOf(value.columnSizing, isFiniteNumber);
  }
  if (isPageIndex(value.pageIndex)) out.pageIndex = value.pageIndex;
  if (isPageSize(value.pageSize)) out.pageSize = value.pageSize;
  return out;
}
