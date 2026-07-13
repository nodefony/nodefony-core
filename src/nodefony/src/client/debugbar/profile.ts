/**
 * Modèle PUR du panneau Network + profil serveur — aucune dépendance DOM/réseau
 * (le fetch vit dans `DebugBar.ts`, l'interception dans `network.ts`). Testable
 * côté Node, comme {@link DebugBarModel}.
 *
 * Deux responsabilités :
 *  - {@link NetworkModel} : ring buffer des appels AJAX observés + compteurs +
 *    cache des profils serveur déjà fetchés (par `requestId`).
 *  - {@link computeWaterfall} : layout proportionnel des phases serveur (le
 *    centre UX — une timeline type Chrome/Symfony).
 */
import type { NetEntry } from "./network";

/** Phase serveur projetée (miroir client de `@nodefony/http` `ProfilePhase`). */
export interface ProfilePhase {
  name: string;
  startMs: number;
  durationMs: number | null;
}

/** Requête ORM (miroir client de `@nodefony/http` `ProfileQuery` — SEAM futur). */
export interface ProfileQuery {
  sql: string;
  durationMs: number;
  rows?: number;
  connector?: string;
}

/** Profil serveur complet (miroir client de `@nodefony/http` `ProfileEntry`). */
export interface ProfileEntry {
  requestId: string;
  ts: number;
  kind: "http" | "ws";
  method: string | null;
  url: string;
  scheme: string;
  status: number | null;
  durationMs: number | null;
  route: string | null;
  controller: string | null;
  action: string | null;
  remoteAddress: string | null;
  user: string | null;
  /** `traceparent` W3C (RFC-propre), si présent. */
  traceparent: string | null;
  error: string | null;
  phases: ProfilePhase[];
  /** Requêtes ORM (SEAM futur — `undefined` tant qu'aucun adapter ne pushe). */
  queries?: ProfileQuery[];
}

/** État de chargement d'un profil serveur dans le cache. */
export type ProfileState =
  | { status: "loading" }
  | { status: "ready"; profile: ProfileEntry }
  | { status: "missing" }
  | { status: "error"; message: string };

/** Une barre du waterfall (positions en % du span total). */
export interface WaterfallBar {
  name: string;
  leftPct: number;
  widthPct: number;
  durationMs: number;
  /** Classe de couleur CSS (cf STYLES `.wf-<tier>`). */
  tier: string;
}

/** Couleur stable par nom de phase canonique. */
const PHASE_TIER: Record<string, string> = {
  parse: "parse",
  resolve: "resolve",
  firewall: "firewall",
  // Porte socket : re-validation de l'identité du peer à chaque frame (lecture
  // du store de session) — famille sécurité, mais distincte du firewall HTTP.
  identity: "identity",
  initialize: "init",
  action: "action",
  render: "render",
  send: "send",
};

/** Mappe un nom de phase vers sa classe de couleur (défaut neutre). */
export function phaseTier(name: string): string {
  return PHASE_TIER[name] ?? "other";
}

/** Logs/appels conservés dans le panneau Network. */
const NET_MAX = 80;

export class NetworkModel {
  private readonly _byId = new Map<number, NetEntry>();
  private readonly _profiles = new Map<string, ProfileState>();
  private _total = 0;
  private _errors = 0;

  /** Upsert d'une entrée (pending puis résolue partagent le même `id`). */
  ingest(entry: NetEntry): void {
    const known = this._byId.has(entry.id);
    if (!known) this._total++;
    // Recompte le statut d'erreur (peut basculer pending → erreur/4xx/5xx).
    const prev = this._byId.get(entry.id);
    const wasErr = prev ? isError(prev) : false;
    const isErr = isError(entry);
    if (isErr && !wasErr) this._errors++;
    else if (!isErr && wasErr) this._errors--;
    this._byId.set(entry.id, entry);
    if (this._byId.size > NET_MAX) {
      const oldest = this._byId.keys().next().value;
      if (oldest !== undefined) {
        const ev = this._byId.get(oldest);
        if (ev && isError(ev)) this._errors--;
        this._byId.delete(oldest);
      }
    }
  }

  /** Entrées récentes (récent → ancien) pour le rendu. */
  entries(): NetEntry[] {
    return [...this._byId.values()].reverse();
  }

  get total(): number {
    return this._total;
  }
  get errors(): number {
    return this._errors;
  }
  get pending(): number {
    let n = 0;
    for (const e of this._byId.values()) if (e.pending) n++;
    return n;
  }

  // ── Cache de profils serveur ──────────────────────────────────────────

  profileState(requestId: string): ProfileState | undefined {
    return this._profiles.get(requestId);
  }
  setProfileState(requestId: string, state: ProfileState): void {
    this._profiles.set(requestId, state);
  }

  clear(): void {
    this._byId.clear();
    this._profiles.clear();
    this._total = 0;
    this._errors = 0;
  }
}

/** Vrai si une entrée est en erreur réseau ou status ≥ 400. */
export function isError(e: NetEntry): boolean {
  if (e.error) return true;
  return e.status !== null && e.status >= 400;
}

/**
 * Calcule le layout proportionnel des phases serveur (waterfall). Pur.
 *
 * Chaque barre est positionnée sur le span `[min start, max end]` en %. Une
 * phase de durée nulle reçoit une largeur plancher (visibilité). Span nul →
 * barres vides (évite la division par zéro).
 *
 * @param phases - phases du profil serveur (startMs relatif + durationMs)
 * @returns barres prêtes à rendre (gauche/largeur en %)
 */
export function computeWaterfall(phases: ProfilePhase[]): WaterfallBar[] {
  if (phases.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const p of phases) {
    if (p.startMs < min) min = p.startMs;
    const end = p.startMs + (p.durationMs ?? 0);
    if (end > max) max = end;
  }
  const span = max - min;
  return phases.map((p) => {
    const dur = p.durationMs ?? 0;
    const leftPct = span > 0 ? ((p.startMs - min) / span) * 100 : 0;
    const widthRaw = span > 0 ? (dur / span) * 100 : 0;
    return {
      name: p.name,
      leftPct: clampPct(leftPct),
      // Plancher 1.5% pour qu'une phase ~0ms reste visible.
      widthPct: clampPct(Math.max(widthRaw, dur > 0 || span === 0 ? 1.5 : 0.6)),
      durationMs: Math.round(dur * 100) / 100,
      tier: phaseTier(p.name),
    };
  });
}

function clampPct(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v > 100) return 100;
  return Math.round(v * 100) / 100;
}
