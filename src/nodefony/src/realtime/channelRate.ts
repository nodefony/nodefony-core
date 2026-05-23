/**
 * channelRate — granularité (cadence) d'un canal realtime, **convention isomorphe**
 * partagée par les deux bords de la socket.
 *
 * La cadence d'un canal à état (stats, supervision) vit dans son **nom** : `base` nu =
 * cadence serveur par défaut ; `base:<ms>` = cadence explicite. Conséquence voulue (cf
 * vision « la socket Nodefony ») : **1 canal = 1 cadence = 1 ref-count** — `orm:health:2000`
 * et `orm:health:5000` sont deux tickers distincts, jamais réconciliés.
 *
 * Avant ce module la convention était **dupliquée** : le front fabriquait `base:${ms}` à la
 * main (3×) et le serveur la re-parsait+bornait à la main (3×) → dérive garantie (un bord
 * change la borne, l'autre pas). Ici elle est **centralisée et testée** : le front fabrique
 * via {@link rateChannel}, le serveur résout via {@link parseRate} — même fichier, même règle.
 *
 * Pur (aucune allocation hors la string résultat, uniquement quand un suffixe est requis) et
 * appelé au `subscribe` (chemin froid), jamais par frame.
 *
 * @see {@link IRealtimeChannel} — le handle par-canal, futur point d'accroche de la cadence
 *   AIMD (re-subscribe adaptatif), qui s'appuiera sur cette même convention de nommage.
 */

/** Bornes de cadence d'un canal cadencé (toutes en millisecondes). */
export interface RateBounds {
  /** Cadence par défaut — celle du canal de base nu (sans suffixe). */
  readonly default: number;
  /** Borne basse (cadence minimale autorisée, anti-DoS event-loop). */
  readonly min: number;
  /** Borne haute (cadence maximale autorisée). */
  readonly max: number;
}

/**
 * Construit le nom d'un canal cadencé à partir de sa base et de la cadence demandée.
 *
 * `intervalMs` omis OU égal à `defaultMs` → renvoie `base` nu : on **n'émet pas** de suffixe
 * pour la cadence par défaut, ce qui évite de fragmenter le canal de base entre consommateurs
 * qui veulent tous la valeur par défaut (ils partagent alors un seul ticker ref-compté).
 *
 * @param base - canal de base (ex. `"orm:health"`).
 * @param intervalMs - cadence demandée (ms). Omise → canal de base.
 * @param defaultMs - cadence par défaut du canal ; `intervalMs === defaultMs` ⇒ canal de base.
 * @returns `base` ou `base:<ms>`.
 */
export function rateChannel(
  base: string,
  intervalMs?: number,
  defaultMs?: number,
): string {
  if (intervalMs == null || intervalMs === defaultMs) return base;
  return `${base}:${intervalMs}`;
}

/**
 * Résout la cadence (ms) d'un canal cadencé connu, côté serveur. Le serveur connaît la `base`
 * qu'il vient de matcher ; ce helper en extrait le suffixe `:<ms>`, **borne** dans `bounds` et
 * retombe sur `bounds.default` pour le canal de base nu ou un suffixe invalide.
 *
 * @param channel - canal reçu (`base` ou `base:<ms>`).
 * @param base - canal de base déjà identifié par l'appelant.
 * @param bounds - cadence par défaut + bornes min/max.
 * @returns cadence effective (ms), garantie dans `[bounds.min, bounds.max]` (ou `bounds.default`).
 */
export function parseRate(
  channel: string,
  base: string,
  bounds: RateBounds,
): number {
  if (channel === base) return bounds.default;
  const raw = Number.parseInt(channel.slice(base.length + 1), 10);
  if (!Number.isFinite(raw) || raw <= 0) return bounds.default;
  return Math.min(bounds.max, Math.max(bounds.min, raw));
}

/** Vrai si `channel` est le canal de base nu OU une de ses variantes cadencées `base:<ms>`. */
export function isRateChannel(channel: string, base: string): boolean {
  return channel === base || channel.startsWith(`${base}:`);
}
