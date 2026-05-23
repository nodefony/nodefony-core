/**
 * UI kit Studio — primitives réutilisables pour accélérer le dev des pages.
 * Importer depuis ce barrel : `import { PageHeader, DataState } from "../components/ui"`.
 */
export { PageHeader, type PageHeaderProps } from "./PageHeader";
export { DataState, type DataStateProps } from "./DataState";
export { StatCard, InfoHint, type StatCardProps } from "./StatCard";
export { KeyValue, DefinitionList, type KeyValueProps } from "./KeyValue";
export { JsonViewer, type JsonViewerProps } from "./JsonViewer";
export { ConfigView, type ConfigViewProps } from "./ConfigView";
export {
  FlashValue,
  ensureLiveStyles,
  type FlashValueProps,
} from "./FlashValue";
export { KpiCard, type KpiCardProps } from "./KpiCard";
export {
  MiniChart,
  ChartCard,
  Legend,
  type MiniChartProps,
  type MiniChartSeries,
} from "./MiniChart";
export {
  DataGrid,
  type DataGridColumn,
  type DataGridProps,
  type DataGridSort,
  type DataGridServerQuery,
  type DataGridServerResult,
  type DataGridColumnFilter,
  type DataGridFilterOp,
  type DataGridFilterType,
  type DataGridPersist,
} from "./DataGrid";
