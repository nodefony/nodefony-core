/**
 * UI kit Studio — primitives réutilisables pour accélérer le dev des pages.
 * Importer depuis ce barrel : `import { PageHeader, DataState } from "../components/ui"`.
 */
export { PageHeader, type PageHeaderProps } from "./PageHeader";
export { DataState, type DataStateProps } from "./DataState";
export { StatCard, InfoHint, type StatCardProps } from "./StatCard";
export {
  Hint,
  DocHint,
  GraphHint,
  LinkHint,
  TipHint,
  WarnHint,
  type HintProps,
  type HintKind,
  type HintLink,
  type DocHintProps,
  type DocSection,
} from "./DocHint";
export { KeyValue, DefinitionList, type KeyValueProps } from "./KeyValue";
export {
  MarkdownDoc,
  MermaidDiagram,
  type MarkdownDocProps,
} from "./MarkdownDoc";
export {
  DocToc,
  extractHeadings,
  slugifyHeading,
  type TocHeading,
  type DocTocProps,
} from "./DocToc";
export {
  STICKY_TOP,
  CONTENT_STICKY_TOP,
  SIDEBAR_MAX_HEIGHT,
  HEADING_SCROLL_MARGIN,
  PAGE_CONTENT_HEIGHT,
  PAGE_CONTENT_HEIGHT_WITH_BAND,
  TABS_PANEL_HEIGHT,
  MODAL_FULLSCREEN_BODY,
  MODAL_FULLSCREEN_CONTENT,
} from "./layout";
export { DocLayout, type DocLayoutProps } from "./DocLayout";
export { DocPageHeader, type DocPageHeaderProps } from "./DocPageHeader";
export {
  FlowGraph,
  type FlowGraphProps,
  type FlowGraphNode,
  type FlowGraphEdge,
  type FlowNodeData,
} from "./FlowGraph";
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
