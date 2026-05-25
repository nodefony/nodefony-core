/**
 * Helpers PURS du dashboard ORM (formatage, agrégation, signaux de santé) —
 * partagés entre `OrmOverview` (`/nodefony/orm`) et `OrmWorker` (`/nodefony/orm/:pid`).
 * Aucun JSX ici (cf `routes/orm/ConnectorCard.tsx` pour les helpers qui rendent du JSX).
 */
import type { HealthInput } from "./health";
import type { OrmLeanHealth } from "./realtimeHealth";
import type { EntityNode, OrmRate } from "../types/orm";

/** Version de la doc des fiches d'aide (`DocHint`) du dashboard ORM. */
export const ORM_DOC = "v1.2";

/** Formatte un nombre de lignes en compact (1.2k, 3.4M) ; `-1` → « — ». */
export function fmtNum(n: number): string {
  if (n < 0) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** Latence en ms → texte lisible (`0.15 ms`, `2.6 ms`, `1.20 s`). */
export function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(2) : Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Durée en ms → `12s` / `5m 3s` / `2h 10m` / `3j 4h`. */
export function fmtDuration(ms: number | null): string {
  if (ms == null || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}j ${h % 24}h`;
}

/** Horodatage epoch ms → heure locale. */
export function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

/** Octets → texte lisible (o / Ko / Mo / Go). */
export function fmtBytes(n?: number): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} Mo`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} Go`;
}

/**
 * Agrège un ensemble d'entités : relations (total + par type), domaines
 * (entités + lignes), santé (orphelines, colonnes non introspectées).
 * Pure → mémoïsable côté global ET par onglet ORM.
 */
export function analyzeModel(
  ents: EntityNode[],
  countMap: Record<string, number>,
) {
  let relationTotal = 0;
  let orphans = 0;
  let noColumns = 0;
  let rowsTotal = 0;
  const relByType: Record<string, number> = {};
  const entitiesByDomain: Record<string, number> = {};
  const rowsByDomain: Record<string, number> = {};
  for (const e of ents) {
    const rels = e.relations ?? [];
    relationTotal += rels.length;
    if (rels.length === 0) orphans++;
    if (!e.columns || e.columns.length === 0) noColumns++;
    for (const r of rels) relByType[r.type] = (relByType[r.type] ?? 0) + 1;
    const d = e.domain || "(non classé)";
    entitiesByDomain[d] = (entitiesByDomain[d] ?? 0) + 1;
    const c = countMap[e.name];
    if (typeof c === "number" && c > 0) {
      rowsTotal += c;
      rowsByDomain[d] = (rowsByDomain[d] ?? 0) + c;
    }
  }
  return {
    relationTotal,
    orphans,
    noColumns,
    rowsTotal,
    relByType,
    entitiesByDomain,
    rowsByDomain,
    domainCount: Object.keys(entitiesByDomain).length,
  };
}

/**
 * Signaux « Santé ORM » d'UN worker → entrées {@link import("./health").buildHealth}
 * (méthode Derringer-Suich, MÊME brique que la santé du framework). Choix figés (kit) :
 * - **Erreurs/reconnexions = TAUX** (delta/min), JAMAIS le cumul (sinon un vieux
 *   pod paraît malade) → exclus tant qu'on n'a pas 2 snapshots (`value:null`).
 * - **Connecteurs déconnectés + erreurs = PANNE** (`critical` : tirent l'indice à 0).
 * - **Latence EWMA + part de requêtes lentes + reconnexions = SATURATION** (planché
 *   « Dégradé » : ralentit mais sert toujours, jamais « Critique » seul).
 * - La part de requêtes lentes est un **ratio de vie** (slow/total), borné → pas de delta.
 */
export function ormHealthInputs(
  orm: OrmLeanHealth,
  rate: OrmRate,
): HealthInput[] {
  const inputs: HealthInput[] = [];
  // Connecteurs coupés = panne (tous coupés → 0 = Critique).
  inputs.push({
    label: "Connecteurs",
    value: orm.connectors > 0 ? orm.connectors - orm.connected : null,
    good: 0,
    crit: Math.max(1, orm.connectors),
    weight: 1.5,
    critical: true,
  });
  // Taux d'erreurs ORM (delta/min) = panne.
  if (rate.errPerMin != null) {
    inputs.push({
      label: "Erreurs",
      value: rate.errPerMin,
      good: 0,
      crit: 30,
      weight: 1.2,
      critical: true,
    });
  }
  // Part de requêtes lentes (ratio de vie) = saturation.
  if (orm.queryTotal > 0) {
    inputs.push({
      label: "Requêtes lentes",
      value: orm.slowTotal / orm.queryTotal,
      good: 0.01,
      crit: 0.25,
      weight: 1,
      floor: 0.3,
    });
  }
  // Latence EWMA (pire connecteur) = saturation. Se lit à l'aune de l'event-loop lag.
  if (orm.maxEwmaMs != null) {
    inputs.push({
      label: "Latence",
      value: orm.maxEwmaMs,
      good: 20,
      crit: 500,
      weight: 1,
      floor: 0.2,
    });
  }
  // Taux de reconnexions (delta/min) = instabilité (saturation).
  if (rate.reconPerMin != null) {
    inputs.push({
      label: "Reconnexions",
      value: rate.reconPerMin,
      good: 0,
      crit: 6,
      weight: 0.8,
      floor: 0.2,
    });
  }
  return inputs;
}

// Styles « temps réel » — injectés UNE fois (point pulsant + halo de carte).
let livePulseInjected = false;
/** Injecte (une seule fois) les keyframes du flash/halo/point « temps réel ». */
export function ensureLivePulseStyle(): void {
  if (livePulseInjected || typeof document === "undefined") return;
  livePulseInjected = true;
  const el = document.createElement("style");
  el.setAttribute("data-nf-orm-live", "");
  el.textContent = `
@keyframes nf-live-pulse{0%{box-shadow:0 0 0 0 rgba(18,184,134,.5)}70%{box-shadow:0 0 0 5px rgba(18,184,134,0)}100%{box-shadow:0 0 0 0 rgba(18,184,134,0)}}
.nf-live-dot{width:8px;height:8px;border-radius:50%;background:var(--mantine-color-teal-6);animation:nf-live-pulse 1.6s ease-out infinite;flex:0 0 auto}
@keyframes nf-live-glow{0%,100%{box-shadow:0 0 0 0 rgba(18,184,134,0)}50%{box-shadow:0 0 0 3px rgba(18,184,134,.16)}}
.nf-live-card{animation:nf-live-glow 2.4s ease-in-out infinite}
@keyframes nf-flash{0%{background:rgba(18,184,134,.32)}100%{background:transparent}}
.nf-flash{animation:nf-flash .9s ease-out;border-radius:4px}
`;
  document.head.appendChild(el);
}

/** Lecture localStorage tolérante (navigation privée / quota). */
export function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
/** Écriture localStorage tolérante. */
export function lsSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
