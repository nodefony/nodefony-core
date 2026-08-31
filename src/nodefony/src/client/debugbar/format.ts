/**
 * Helpers de formatage PURS de la debug bar — aucune dépendance DOM/réseau,
 * donc unit-testables côté Node (suite mocha du core).
 */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Formatte un nombre d'octets en unité lisible (1 décimale, base 1024).
 *
 * @param bytes - taille en octets (négatif/NaN → "0 B")
 * @returns ex. `"1.5 MB"`, `"0 B"`
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  // Pas de décimale inutile pour les octets bruts.
  return `${i === 0 ? n : n.toFixed(1)} ${UNITS[i]}`;
}

/**
 * Formatte une durée (secondes) en chaîne compacte (`1h 02m`, `3m 12s`, `45s`).
 *
 * @param seconds - uptime en secondes
 */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0s";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** Palier de santé d'une jauge 0-100 — pilote la couleur du widget. */
export type GaugeTier = "ok" | "warn" | "crit";

/**
 * Classe une valeur 0-100 en palier vert/orange/rouge.
 *
 * @param percent - valeur de la jauge
 * @param warn - seuil orange (défaut 70)
 * @param crit - seuil rouge (défaut 90)
 */
export function gauge(percent: number, warn = 70, crit = 90): GaugeTier {
  if (!Number.isFinite(percent)) return "ok";
  if (percent >= crit) return "crit";
  if (percent >= warn) return "warn";
  return "ok";
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;]*m/g;

/** Retire les séquences d'échappement ANSI (couleurs terminal) d'une chaîne. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "");
}

/**
 * Calcule l'attribut `points` d'un `<polyline>` SVG (sparkline) à partir d'une
 * série de valeurs. Pur → testable. Mise à l'échelle sur `[0, max]`.
 *
 * @param values - série temporelle (gauche = ancien, droite = récent)
 * @param width - largeur du viewBox
 * @param height - hauteur du viewBox
 * @param max - plafond de l'axe Y (défaut = max de la série, plancher 1)
 * @returns ex. `"0,14 10,7 20,2"` (vide si < 2 points)
 */
export function sparklinePoints(
  values: number[],
  width: number,
  height: number,
  max?: number,
): string {
  const n = values.length;
  if (n < 2) return "";
  const top = max ?? Math.max(...values, 1);
  const ceil = top > 0 ? top : 1;
  const step = width / (n - 1);
  let out = "";
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(values[i]!) ? values[i]! : 0;
    const ratio = Math.min(1, Math.max(0, v / ceil));
    const x = Math.round(i * step * 100) / 100;
    const y = Math.round((height - ratio * height) * 100) / 100;
    out += i === 0 ? `${x},${y}` : ` ${x},${y}`;
  }
  return out;
}

/**
 * Heure locale d'un horodatage, à la milliseconde — `14:03:27.482`.
 *
 * La date n'y figure pas : une barre de débogage montre ce qui vient de se
 * passer, et une date répétée sur chaque ligne coûte de la place sans rien
 * apprendre. Le détail d'une entrée, lui, rend l'horodatage complet.
 */
export function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
  const ms = d.getMilliseconds();
  const p3 = ms < 10 ? `00${ms}` : ms < 100 ? `0${ms}` : String(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3}`;
}
