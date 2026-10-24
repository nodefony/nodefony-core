#!/usr/bin/env node
/**
 * Tableaux de bord d'EXEMPLE des journaux Nodefony — Grafana (Loki) et
 * OpenSearch Dashboards — rendus depuis UNE liste de panneaux.
 *
 * ## Pourquoi un générateur
 *
 * Les deux outils montrent la même chose (vue d'ensemble, activité, HTTP, qui
 * écrit, journaux) : la liste des panneaux est écrite UNE fois, chaque outil a
 * son rendu. Un tableau de bord cliqué à la main ne se relit pas en revue, ne
 * se compare pas d'un outil à l'autre, et le format d'OpenSearch Dashboards
 * imbrique du JSON dans des chaînes — l'écrire à la main, c'est le casser.
 *
 * ## Ce que les panneaux supposent
 *
 * - `log.format: "json"` : une ligne = un enregistrement (`severityName`,
 *   `moduleName`, `msgid`, `payload`, `requestId`, `pid`).
 * - La ligne d'accès de PRODUCTION (`msgid: "audit"`) : sa charge est un JSON
 *   (`method`, `url`, `status`, `durationMs`…). Grafana la déplie à la requête
 *   (LogQL `| json`) ; OpenSearch la trouve rangée sous `http.*` par le
 *   pipeline d'ingestion que pose le transport (`opensearchShared.ts#buildAuditPipeline`).
 *
 * Ce sont des EXEMPLES livrés aux applications générées : rien ne les charge
 * par défaut (cf le README rendu à côté).
 *
 * @usage    node scripts/generate/observability-dashboards.mjs          # réécrit les deux exemples
 * @usage    node scripts/generate/observability-dashboards.mjs --check  # sortie 1 si un exemple est périmé
 * @output   src/nodefony/templates/app/complete/docker/examples/dashboards/{grafana,opensearch}-nodefony-logs.*.tpl
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const OUT_DIR = path.join(
  ROOT,
  "src/nodefony/templates/app/complete/docker/examples/dashboards",
);
const GRAFANA_FILE = path.join(OUT_DIR, "grafana-nodefony-logs.json.tpl");
const OPENSEARCH_FILE = path.join(
  OUT_DIR,
  "opensearch-nodefony-logs.ndjson.tpl",
);

const TITLE = "Nodefony — journaux";
const GUIDE = [
  "**Journaux d'une application Nodefony.** Vue d'ensemble, activité, trafic HTTP, et les lignes elles-mêmes.",
  "",
  'Les panneaux HTTP lisent la ligne d\'accès de **production** (`msgid: audit`), écrite avec `log.format: "json"` : en développement, elle sort dans un autre format et ces panneaux restent vides.',
  "",
  "**Latence** : chaque ligne d'accès porte la durée de sa requête (`durationMs`), de l'arrivée à la fin de la réponse — production comprise. Seul `timing.enabled: false` la retire.",
  "",
  "Une ligne mène à toute sa requête : copier son `requestId` dans le filtre du même nom.",
].join("\n");
const LATENCY_HELP =
  "Durée de chaque requête (durationMs), de l'arrivée à la fin de la réponse. Vide seulement si l'application a coupé le chronométrage (timing.enabled: false).";

/** Couleurs FIXES, identiques dans les deux outils : une sévérité se reconnaît d'un coup d'œil. */
const SEVERITY_COLORS = {
  EMERGENCY: "#8F1D1D",
  ALERT: "#B42318",
  CRITIC: "#C4314B",
  ERROR: "#E5484D",
  WARNING: "#F59E0B",
  NOTICE: "#8B5CF6",
  INFO: "#3B82F6",
  DEBUG: "#9CA3AF",
};
const STATUS_COLORS = {
  "2xx": "#22A06B",
  "3xx": "#3B82F6",
  "4xx": "#F59E0B",
  "5xx": "#E5484D",
};

// ───────────────────────────── Grafana (Loki) ─────────────────────────────

const DS = { type: "loki", uid: "${datasource}" };
/** Toutes les lignes, filtrées par les variables du tableau de bord. */
const LINES =
  '{app=~"$app"} |= "$requestId" |~ "(?i)$search" | json | severityName=~"$severity" | moduleName=~"$module"';
/** Les lignes d'accès de production, dépliées : status, method, url, duration, path, family. */
const HTTP =
  '{app=~"$app"} |= "audit" |= "$requestId" | json | msgid="audit" | moduleName=~"$module" | line_format "{{.payload}}" | json status="status", method="method", url="url", duration="durationMs" | label_format path=`{{ regexReplaceAll "^[a-z]+://[^/]+|[?#].*$" .url "" }}`, family=`{{ regexReplaceAll "^([1-5])[0-9][0-9]$" .status "${1}xx" }}`';
const SEV_ERR = "EMERGENCY|ALERT|CRITIC|ERROR";

let panelId = 0;
const gp = (x, y, w, h) => ({ x, y, w, h });

function row(title, y) {
  return {
    type: "row",
    title,
    collapsed: false,
    gridPos: gp(0, y, 24, 1),
    id: ++panelId,
    panels: [],
  };
}

function stat(
  title,
  expr,
  y,
  x,
  {
    unit = "short",
    color = "#3B82F6",
    thresholds,
    decimals,
    noValue = "0",
  } = {},
) {
  return {
    type: "stat",
    title,
    id: ++panelId,
    datasource: DS,
    gridPos: gp(x, y, 4, 4),
    ...(noValue === "0" ? {} : { description: LATENCY_HELP }),
    targets: [
      {
        refId: "A",
        datasource: DS,
        expr,
        queryType: "instant",
        instant: true,
        range: false,
      },
    ],
    options: {
      reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false },
      colorMode: "background_solid",
      graphMode: "none",
      justifyMode: "center",
      textMode: "value",
      wideLayout: true,
    },
    fieldConfig: {
      defaults: {
        unit,
        ...(decimals === undefined ? {} : { decimals }),
        noValue,
        color: { mode: "thresholds" },
        thresholds: thresholds ?? {
          mode: "absolute",
          steps: [{ color, value: null }],
        },
      },
      overrides: [],
    },
  };
}

function colorOverrides(map) {
  return Object.entries(map).map(([name, color]) => ({
    matcher: { id: "byName", options: name },
    properties: [{ id: "color", value: { mode: "fixed", fixedColor: color } }],
  }));
}

function bars(title, targets, y, x, w, colors, unit = "short") {
  return {
    type: "timeseries",
    title,
    maxDataPoints: 60,
    id: ++panelId,
    datasource: DS,
    gridPos: gp(x, y, w, 8),
    targets: targets.map((t, i) => ({
      refId: String.fromCharCode(65 + i),
      datasource: DS,
      ...t,
    })),
    options: {
      legend: { displayMode: "list", placement: "bottom", showLegend: true },
      tooltip: { mode: "multi", sort: "desc" },
    },
    fieldConfig: {
      defaults: {
        unit,
        custom: {
          drawStyle: "bars",
          barAlignment: 0,
          fillOpacity: 85,
          lineWidth: 0,
          stacking: { mode: "normal", group: "A" },
          axisSoftMin: 0,
        },
        color: { mode: "palette-classic" },
      },
      overrides: colorOverrides(colors),
    },
  };
}

function lines(title, targets, y, x, w, unit) {
  return {
    type: "timeseries",
    title,
    description: LATENCY_HELP,
    maxDataPoints: 60,
    id: ++panelId,
    datasource: DS,
    gridPos: gp(x, y, w, 8),
    targets: targets.map((t, i) => ({
      refId: String.fromCharCode(65 + i),
      datasource: DS,
      ...t,
    })),
    options: {
      legend: { displayMode: "list", placement: "bottom", showLegend: true },
      tooltip: { mode: "multi", sort: "desc" },
    },
    fieldConfig: {
      defaults: {
        unit,
        custom: {
          drawStyle: "line",
          lineWidth: 2,
          fillOpacity: 10,
          showPoints: "never",
          spanNulls: true,
          axisSoftMin: 0,
        },
        color: { mode: "palette-classic" },
      },
      overrides: colorOverrides({
        p50: "#22A06B",
        p95: "#F59E0B",
        p99: "#E5484D",
      }),
    },
  };
}

function barGauge(title, expr, y, x, w, legend) {
  return {
    type: "bargauge",
    title,
    id: ++panelId,
    datasource: DS,
    gridPos: gp(x, y, w, 8),
    targets: [
      {
        refId: "A",
        datasource: DS,
        expr,
        queryType: "instant",
        instant: true,
        range: false,
        legendFormat: legend,
      },
    ],
    options: {
      orientation: "horizontal",
      displayMode: "gradient",
      showUnfilled: true,
      valueMode: "color",
      namePlacement: "left",
      // Taille FIXE : sans elle, peu de lignes donnent des libellés géants.
      text: { titleSize: 13, valueSize: 15 },
      minVizHeight: 14,
      maxVizHeight: 26,
      sizing: "manual",
      // Une requête instantanée arrive en UN tableau (colonne de libellés +
      // `Value #A`, une ligne par série) : afficher chaque LIGNE, nommée par
      // sa colonne de libellés.
      reduceOptions: { calcs: [], fields: "/^Value/", values: true },
    },
    transformations: [
      { id: "sortBy", options: { sort: [{ field: "Value #A", desc: true }] } },
    ],
    fieldConfig: {
      defaults: { unit: "short", color: { mode: "continuous-BlPu" }, min: 0 },
      overrides: [],
    },
  };
}

function logs(title, expr, y, h) {
  return {
    type: "logs",
    title,
    id: ++panelId,
    datasource: DS,
    gridPos: gp(0, y, 24, h),
    targets: [{ refId: "A", datasource: DS, expr, queryType: "range" }],
    options: {
      showTime: true,
      showLabels: false,
      showCommonLabels: false,
      wrapLogMessage: true,
      prettifyLogMessage: false,
      enableLogDetails: true,
      dedupStrategy: "none",
      sortOrder: "Descending",
    },
  };
}

function grafanaDashboard() {
  panelId = 0;
  // Une ligne lisible : la ligne d'accès se résume (méthode, statut, chemin,
  // durée) au lieu de déverser son JSON ; les autres gardent leur texte. La
  // sévérité n'y figure pas : Grafana l'affiche déjà en tête de ligne.
  const lineFmt =
    " | regexp `" +
    String.raw`\\"method\\":\\"(?P<m>[A-Z]+)\\",\\"url\\":\\"(?P<u>[^\\"]+)\\",\\"status\\":(?P<st>[0-9]+),\\"durationMs\\":(?P<d>[0-9.]+|null)` +
    '` | line_format `{{.moduleName}} · {{.msgid}}  {{ if .st }}{{.m}} {{.st}} {{ regexReplaceAll "^[a-z]+://[^/]+" .u "" }}{{ if ne .d "null" }}  {{ printf "%.5s" .d }} ms{{ end }}{{ else }}{{.payload}}{{ end }}`';
  const panels = [
    {
      type: "text",
      title: "",
      id: ++panelId,
      gridPos: gp(0, 0, 24, 5),
      options: { mode: "markdown", content: GUIDE },
    },
    row("Vue d'ensemble", 5),
    stat("Lignes", `sum(count_over_time(${LINES} [$__range]))`, 6, 0),
    stat(
      "Erreurs",
      `sum(count_over_time(${LINES} | severityName=~"${SEV_ERR}" [$__range]))`,
      6,
      4,
      {
        thresholds: {
          mode: "absolute",
          steps: [
            { color: "#22A06B", value: null },
            { color: SEVERITY_COLORS.ERROR, value: 1 },
          ],
        },
      },
    ),
    stat(
      "Avertissements",
      `sum(count_over_time(${LINES} | severityName="WARNING" [$__range]))`,
      6,
      8,
      {
        thresholds: {
          mode: "absolute",
          steps: [
            { color: "#22A06B", value: null },
            { color: SEVERITY_COLORS.WARNING, value: 1 },
          ],
        },
      },
    ),
    stat("Requêtes HTTP", `sum(count_over_time(${HTTP} [$__range]))`, 6, 12),
    stat(
      "Réponses 5xx",
      `sum(count_over_time(${HTTP} | family="5xx" [$__range]))`,
      6,
      16,
      {
        thresholds: {
          mode: "absolute",
          steps: [
            { color: "#22A06B", value: null },
            { color: STATUS_COLORS["5xx"], value: 1 },
          ],
        },
      },
    ),
    stat(
      "Latence p95",
      `quantile_over_time(0.95, ${HTTP} | unwrap duration | __error__="" [$__range]) by ()`,
      6,
      20,
      {
        unit: "ms",
        decimals: 1,
        noValue: "non mesurée",
        thresholds: {
          mode: "absolute",
          steps: [
            { color: "#22A06B", value: null },
            { color: "#F59E0B", value: 300 },
            { color: "#E5484D", value: 1000 },
          ],
        },
      },
    ),
    row("Activité", 10),
    bars(
      "Lignes par sévérité",
      [
        {
          expr: `sum by (severityName) (count_over_time(${LINES} [$__auto]))`,
          legendFormat: "{{severityName}}",
        },
      ],
      11,
      0,
      12,
      SEVERITY_COLORS,
    ),
    bars(
      "Requêtes par famille de statut",
      [
        {
          expr: `sum by (family) (count_over_time(${HTTP} [$__auto]))`,
          legendFormat: "{{family}}",
        },
      ],
      11,
      12,
      12,
      STATUS_COLORS,
    ),
    row("HTTP", 19),
    lines(
      "Latence des requêtes",
      [50, 95, 99].map((q) => ({
        expr: `quantile_over_time(0.${q}, ${HTTP} | unwrap duration | __error__="" [$__auto]) by ()`,
        legendFormat: `p${q}`,
      })),
      20,
      0,
      12,
      "ms",
    ),
    barGauge(
      "Chemins les plus sollicités",
      `topk(10, sum by (path) (count_over_time(${HTTP} [$__range])))`,
      20,
      12,
      6,
      "{{path}}",
    ),
    barGauge(
      "Statuts",
      `sum by (status) (count_over_time(${HTTP} [$__range]))`,
      20,
      18,
      6,
      "{{status}}",
    ),
    row("Qui écrit", 28),
    barGauge(
      "Modules",
      `topk(10, sum by (moduleName) (count_over_time(${LINES} [$__range])))`,
      29,
      0,
      12,
      "{{moduleName}}",
    ),
    barGauge(
      "Catégories (msgid)",
      `topk(10, sum by (msgid) (count_over_time(${LINES} [$__range])))`,
      29,
      12,
      12,
      "{{msgid}}",
    ),
    row("Journaux", 37),
    logs(
      "Erreurs et avertissements",
      `${LINES} | severityName=~"${SEV_ERR}|WARNING"${lineFmt}`,
      38,
      10,
    ),
    logs("Journal", `${LINES}${lineFmt}`, 48, 14),
  ];
  const custom = (name, label, values) => ({
    type: "custom",
    name,
    label,
    query: values.join(","),
    multi: true,
    includeAll: true,
    allValue: ".*",
    current: { selected: true, text: ["All"], value: ["$__all"] },
  });
  const textbox = (name, label) => ({
    type: "textbox",
    name,
    label,
    query: "",
    current: { text: "", value: "" },
  });
  return {
    title: TITLE,
    uid: "nodefony-logs",
    description:
      "Exemple livré par Nodefony : journaux d'une application (Loki, log.format json).",
    tags: ["nodefony", "logs"],
    editable: true,
    graphTooltip: 1,
    schemaVersion: 41,
    version: 1,
    time: { from: "now-1h", to: "now" },
    refresh: "30s",
    timezone: "browser",
    templating: {
      list: [
        {
          type: "datasource",
          name: "datasource",
          label: "Source",
          query: "loki",
          current: {},
          hide: 0,
        },
        {
          type: "query",
          name: "app",
          label: "Application",
          datasource: DS,
          query: {
            qryType: 1,
            query: "label_values(app)",
            refId: "LokiVariableQueryEditor-VariableQuery",
          },
          definition: "label_values(app)",
          refresh: 2,
          multi: true,
          includeAll: true,
          allValue: ".+",
          current: { selected: true, text: ["All"], value: ["$__all"] },
        },
        custom("severity", "Sévérité", Object.keys(SEVERITY_COLORS)),
        {
          type: "query",
          name: "module",
          label: "Module",
          datasource: DS,
          query: {
            qryType: 1,
            query: 'label_values({app=~"$app"}, module)',
            refId: "LokiVariableQueryEditor-VariableQuery",
          },
          definition: 'label_values({app=~"$app"}, module)',
          refresh: 2,
          multi: true,
          includeAll: true,
          allValue: ".*",
          current: { selected: true, text: ["All"], value: ["$__all"] },
        },
        textbox("search", "Recherche"),
        textbox("requestId", "requestId"),
      ],
    },
    annotations: { list: [] },
    panels,
  };
}

// ─────────────────────────── OpenSearch Dashboards ───────────────────────────

const INDEX_PATTERN_ID = "nodefony-logs";
const INDEX_REF = "kibanaSavedObjectMeta.searchSourceJSON.index";
const indexRef = {
  name: INDEX_REF,
  type: "index-pattern",
  id: INDEX_PATTERN_ID,
};
const AUDIT = "msgid:audit";

const searchSource = (query) =>
  JSON.stringify({
    query: { query, language: "kuery" },
    filter: [],
    indexRefName: INDEX_REF,
  });

function visualization(id, title, visState, { query = "", uiState = {} } = {}) {
  return {
    type: "visualization",
    id,
    attributes: {
      title,
      description: "",
      version: 1,
      visState: JSON.stringify({ title, ...visState }),
      uiStateJSON: JSON.stringify(uiState),
      kibanaSavedObjectMeta: { searchSourceJSON: searchSource(query) },
    },
    references: [indexRef],
  };
}

const count = (label) => ({
  id: "1",
  enabled: true,
  type: "count",
  schema: "metric",
  params: { customLabel: label },
});
const dateHistogram = {
  id: "2",
  enabled: true,
  type: "date_histogram",
  schema: "segment",
  params: {
    field: "@timestamp",
    interval: "auto",
    min_doc_count: 1,
    extended_bounds: {},
  },
};

function metricVis(id, title, query, agg, color) {
  return visualization(
    id,
    title,
    {
      type: "metric",
      params: {
        addTooltip: true,
        addLegend: false,
        type: "metric",
        metric: {
          percentageMode: false,
          useRanges: false,
          colorSchema: "Green to Red",
          metricColorMode: "None",
          colorsRange: [{ from: 0, to: 10000 }],
          labels: { show: true },
          invertColors: false,
          style: {
            bgFill: color,
            bgColor: false,
            labelColor: false,
            subText: "",
            fontSize: 40,
          },
        },
      },
      aggs: [agg ?? count(title)],
    },
    { query },
  );
}

const axes = (title, horizontal = false) => ({
  grid: {
    categoryLines: false,
    valueAxis: horizontal ? undefined : "ValueAxis-1",
  },
  categoryAxes: [
    {
      id: "CategoryAxis-1",
      type: "category",
      position: horizontal ? "left" : "bottom",
      show: true,
      style: {},
      scale: { type: "linear" },
      labels: { show: true, filter: !horizontal, truncate: 200 },
      title: {},
    },
  ],
  valueAxes: [
    {
      id: "ValueAxis-1",
      name: "LeftAxis-1",
      type: "value",
      position: horizontal ? "bottom" : "left",
      show: true,
      style: {},
      scale: { type: "linear", mode: "normal" },
      labels: { show: true, rotate: 0, filter: false, truncate: 100 },
      title: { text: title },
    },
  ],
});

function stackedVis(id, title, group, colors, query = "") {
  return visualization(
    id,
    title,
    {
      type: "histogram",
      params: {
        type: "histogram",
        ...axes("Lignes"),
        seriesParams: [
          {
            show: true,
            type: "histogram",
            mode: "stacked",
            data: { label: "Lignes", id: "1" },
            valueAxis: "ValueAxis-1",
            drawLinesBetweenPoints: true,
            lineWidth: 2,
            showCircles: true,
          },
        ],
        addTooltip: true,
        addLegend: true,
        legendPosition: "bottom",
        times: [],
        addTimeMarker: false,
        labels: { show: false },
        thresholdLine: {
          show: false,
          value: 10,
          width: 1,
          style: "full",
          color: "#E7664C",
        },
      },
      aggs: [
        count("Lignes"),
        dateHistogram,
        { id: "3", enabled: true, schema: "group", ...group },
      ],
    },
    { query, uiState: { vis: { colors } } },
  );
}

function latencyVis() {
  return visualization(
    "nodefony-logs-latency",
    "Latence des requêtes",
    {
      type: "line",
      params: {
        type: "line",
        ...axes("ms"),
        seriesParams: [
          {
            show: true,
            type: "line",
            mode: "normal",
            data: { label: "Latence", id: "1" },
            valueAxis: "ValueAxis-1",
            drawLinesBetweenPoints: true,
            lineWidth: 2,
            interpolate: "linear",
            showCircles: false,
          },
        ],
        addTooltip: true,
        addLegend: true,
        legendPosition: "bottom",
        times: [],
        addTimeMarker: false,
        labels: {},
        thresholdLine: {
          show: false,
          value: 10,
          width: 1,
          style: "full",
          color: "#E7664C",
        },
      },
      aggs: [
        {
          id: "1",
          enabled: true,
          type: "percentiles",
          schema: "metric",
          params: {
            field: "http.durationMs",
            percents: [50, 95, 99],
            customLabel: "durée",
          },
        },
        dateHistogram,
      ],
    },
    {
      query: AUDIT,
      uiState: {
        vis: {
          colors: {
            "50th percentile of durée": "#22A06B",
            "95th percentile of durée": "#F59E0B",
            "99th percentile of durée": "#E5484D",
          },
        },
      },
    },
  );
}

function pathsVis() {
  return visualization(
    "nodefony-logs-paths",
    "Chemins les plus sollicités",
    {
      type: "table",
      params: {
        perPage: 10,
        showPartialRows: false,
        showMetricsAtAllLevels: false,
        sort: { columnIndex: 1, direction: "desc" },
        showTotal: false,
        totalFunc: "sum",
        percentageCol: "",
      },
      aggs: [
        count("Requêtes"),
        {
          id: "3",
          enabled: true,
          type: "percentiles",
          schema: "metric",
          params: {
            field: "http.durationMs",
            percents: [95],
            customLabel: "durée",
          },
        },
        {
          id: "4",
          enabled: true,
          type: "max",
          schema: "metric",
          params: { field: "http.status", customLabel: "Pire statut" },
        },
        {
          id: "2",
          enabled: true,
          type: "terms",
          schema: "bucket",
          params: {
            field: "http.path",
            size: 15,
            order: "desc",
            orderBy: "1",
            otherBucket: false,
            missingBucket: false,
            customLabel: "Chemin",
          },
        },
      ],
    },
    { query: AUDIT },
  );
}

function terms(field, size, label) {
  return {
    type: "terms",
    params: {
      field,
      size,
      order: "desc",
      orderBy: "1",
      otherBucket: false,
      missingBucket: false,
      customLabel: label,
    },
  };
}

function pieVis() {
  return visualization(
    "nodefony-logs-statuses",
    "Statuts",
    {
      type: "pie",
      params: {
        type: "pie",
        addTooltip: true,
        addLegend: true,
        legendPosition: "right",
        isDonut: true,
        labels: { show: false, values: true, last_level: true, truncate: 100 },
      },
      aggs: [
        count("Requêtes"),
        {
          id: "2",
          enabled: true,
          schema: "segment",
          ...terms("http.status", 10, "Statut"),
        },
      ],
    },
    { query: AUDIT },
  );
}

function rankVis(id, title, field) {
  return visualization(id, title, {
    type: "horizontal_bar",
    params: {
      type: "histogram",
      ...axes("Lignes", true),
      seriesParams: [
        {
          show: true,
          type: "histogram",
          mode: "normal",
          data: { label: "Lignes", id: "1" },
          valueAxis: "ValueAxis-1",
          drawLinesBetweenPoints: true,
          lineWidth: 2,
          showCircles: true,
        },
      ],
      addTooltip: true,
      addLegend: false,
      legendPosition: "right",
      times: [],
      addTimeMarker: false,
      labels: { show: true },
      thresholdLine: {
        show: false,
        value: 10,
        width: 1,
        style: "full",
        color: "#E7664C",
      },
    },
    aggs: [
      count("Lignes"),
      { id: "2", enabled: true, schema: "segment", ...terms(field, 10, title) },
    ],
  });
}

function controlsVis() {
  const ctl = (i, fieldName, label, size) => ({
    id: String(i + 1),
    fieldName,
    label,
    type: "list",
    options: {
      type: "terms",
      multiselect: true,
      dynamicOptions: true,
      size,
      order: "desc",
    },
    parent: "",
    indexPatternRefName: `control_${i}_index_pattern`,
  });
  return {
    type: "visualization",
    id: "nodefony-logs-controls",
    attributes: {
      title: "Filtres",
      description: "",
      version: 1,
      visState: JSON.stringify({
        title: "Filtres",
        type: "input_control_vis",
        params: {
          controls: [
            ctl(0, "severityName", "Sévérité", 8),
            ctl(1, "moduleName", "Module", 20),
            ctl(2, "http.status", "Statut HTTP", 20),
          ],
          updateFiltersOnChange: true,
          useTimeFilter: true,
          pinFilters: false,
        },
        aggs: [],
      }),
      uiStateJSON: "{}",
      kibanaSavedObjectMeta: {
        searchSourceJSON: JSON.stringify({
          query: { query: "", language: "kuery" },
          filter: [],
        }),
      },
    },
    references: [0, 1, 2].map((i) => ({
      name: `control_${i}_index_pattern`,
      type: "index-pattern",
      id: INDEX_PATTERN_ID,
    })),
  };
}

function guideVis() {
  return {
    type: "visualization",
    id: "nodefony-logs-guide",
    attributes: {
      title: "Lire ce tableau de bord",
      description: "",
      version: 1,
      visState: JSON.stringify({
        title: "Lire ce tableau de bord",
        type: "markdown",
        params: { fontSize: 12, openLinksInNewTab: false, markdown: GUIDE },
        aggs: [],
      }),
      uiStateJSON: "{}",
      kibanaSavedObjectMeta: {
        searchSourceJSON: JSON.stringify({
          query: { query: "", language: "kuery" },
          filter: [],
        }),
      },
    },
    references: [],
  };
}

function savedSearch(id, title, query) {
  return {
    type: "search",
    id,
    attributes: {
      title,
      description: "",
      columns: [
        "severityName",
        "moduleName",
        "msgid",
        "http.method",
        "http.status",
        "http.path",
        "http.durationMs",
        "payload",
      ],
      sort: [["@timestamp", "desc"]],
      version: 1,
      kibanaSavedObjectMeta: { searchSourceJSON: searchSource(query) },
    },
    references: [indexRef],
  };
}

function opensearchObjects() {
  const sevErr = "severity <= 3";
  const objects = [
    {
      type: "index-pattern",
      id: INDEX_PATTERN_ID,
      attributes: {
        title: "nodefony-logs*",
        timeFieldName: "@timestamp",
        // Les millisecondes à une décimale, partout où la durée s'affiche.
        fieldFormatMap: JSON.stringify({
          "http.durationMs": { id: "number", params: { pattern: "0,0.0" } },
        }),
      },
      references: [],
    },
    guideVis(),
    controlsVis(),
    metricVis("nodefony-logs-m-lines", "Lignes", ""),
    metricVis("nodefony-logs-m-errors", "Erreurs", sevErr),
    metricVis(
      "nodefony-logs-m-warnings",
      "Avertissements",
      "severityName:WARNING",
    ),
    metricVis("nodefony-logs-m-requests", "Requêtes HTTP", AUDIT),
    metricVis(
      "nodefony-logs-m-5xx",
      "Réponses 5xx",
      `${AUDIT} and http.status >= 500`,
    ),
    metricVis("nodefony-logs-m-p95", "Latence p95", AUDIT, {
      id: "1",
      enabled: true,
      type: "percentiles",
      schema: "metric",
      params: {
        field: "http.durationMs",
        percents: [95],
        customLabel: "durée",
      },
    }),
    stackedVis(
      "nodefony-logs-severity",
      "Lignes par sévérité",
      terms("severityName", 8, "Sévérité"),
      SEVERITY_COLORS,
    ),
    stackedVis(
      "nodefony-logs-families",
      "Requêtes par famille de statut",
      terms("http.family", 5, "Famille"),
      STATUS_COLORS,
      AUDIT,
    ),
    latencyVis(),
    pathsVis(),
    pieVis(),
    rankVis("nodefony-logs-modules", "Modules", "moduleName"),
    rankVis("nodefony-logs-msgid", "Catégories (msgid)", "msgid"),
    savedSearch(
      "nodefony-logs-errors",
      "Erreurs et avertissements",
      "severity <= 4",
    ),
    savedSearch("nodefony-logs-journal", "Journal", ""),
  ];
  // Grille de 48 colonnes ; une unité de hauteur ≈ 20 px.
  const layout = [
    ["nodefony-logs-guide", "visualization", 0, 0, 28, 9],
    ["nodefony-logs-controls", "visualization", 28, 0, 20, 9],
    ["nodefony-logs-m-lines", "visualization", 0, 9, 8, 6],
    ["nodefony-logs-m-errors", "visualization", 8, 9, 8, 6],
    ["nodefony-logs-m-warnings", "visualization", 16, 9, 8, 6],
    ["nodefony-logs-m-requests", "visualization", 24, 9, 8, 6],
    ["nodefony-logs-m-5xx", "visualization", 32, 9, 8, 6],
    ["nodefony-logs-m-p95", "visualization", 40, 9, 8, 6],
    ["nodefony-logs-severity", "visualization", 0, 15, 24, 14],
    ["nodefony-logs-families", "visualization", 24, 15, 24, 14],
    ["nodefony-logs-latency", "visualization", 0, 29, 24, 14],
    ["nodefony-logs-paths", "visualization", 24, 29, 14, 14],
    ["nodefony-logs-statuses", "visualization", 38, 29, 10, 14],
    ["nodefony-logs-modules", "visualization", 0, 43, 24, 14],
    ["nodefony-logs-msgid", "visualization", 24, 43, 24, 14],
    ["nodefony-logs-errors", "search", 0, 57, 48, 16],
    ["nodefony-logs-journal", "search", 0, 73, 48, 22],
  ];
  const panels = layout.map(([, , x, y, w, h], i) => ({
    version: "3.5.0",
    gridData: { x, y, w, h, i: String(i + 1) },
    panelIndex: String(i + 1),
    embeddableConfig: {},
    panelRefName: `panel_${i}`,
  }));
  objects.push({
    type: "dashboard",
    id: "nodefony-logs",
    attributes: {
      title: TITLE,
      hits: 0,
      description:
        "Exemple livré par Nodefony : journaux d'une application (OpenSearch, log.format json).",
      panelsJSON: JSON.stringify(panels),
      optionsJSON: JSON.stringify({ hidePanelTitles: false, useMargins: true }),
      version: 1,
      timeRestore: true,
      timeTo: "now",
      timeFrom: "now-1h",
      refreshInterval: { pause: false, value: 30000 },
      kibanaSavedObjectMeta: {
        searchSourceJSON: JSON.stringify({
          query: { query: "", language: "kuery" },
          filter: [],
        }),
      },
    },
    references: layout.map(([id, type], i) => ({
      name: `panel_${i}`,
      type,
      id,
    })),
  });
  return objects;
}

// ──────────────────────────────── Écriture ────────────────────────────────

// Rendu au format du formateur qu'embarque l'application générée (ses réglages,
// pas ceux du dépôt) : sans quoi son `npm run format` réécrit l'exemple.
const PRETTIER_OPTIONS = JSON.parse(
  readFileSync(
    path.join(ROOT, "src/nodefony/templates/app/base/prettierrc.json.tpl"),
    "utf8",
  ),
);

const outputs = [
  [
    GRAFANA_FILE,
    await format(JSON.stringify(grafanaDashboard()), {
      ...PRETTIER_OPTIONS,
      parser: "json",
    }),
  ],
  [
    OPENSEARCH_FILE,
    `${opensearchObjects()
      .map((o) => JSON.stringify(o))
      .join("\n")}\n`,
  ],
];

for (const [, content] of outputs) {
  // Un gabarit est rendu par eta : une balise résiduelle casserait la génération.
  if (content.includes("<%"))
    throw new Error("balise eta dans un tableau de bord");
}

if (process.argv.includes("--check")) {
  const stale = outputs.filter(([file, content]) => {
    try {
      return readFileSync(file, "utf8") !== content;
    } catch {
      return true;
    }
  });
  for (const [file] of stale) {
    process.stderr.write(
      `❌ périmé : ${path.relative(ROOT, file)} — node scripts/generate/observability-dashboards.mjs\n`,
    );
  }
  process.exit(stale.length === 0 ? 0 : 1);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [file, content] of outputs) {
  writeFileSync(file, content);
  process.stdout.write(`✓ ${path.relative(ROOT, file)}\n`);
}
