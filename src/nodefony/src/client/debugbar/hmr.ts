/**
 * Sonde HMR Vite — se branche en **2ᵉ client** sur le WebSocket HMR du serveur
 * de dev Vite (sous-protocole `vite-hmr`) pour OBSERVER les hot-updates en live.
 *
 * But (psychologie produit) : montrer que le frontend (React/Vue/Angular) et le
 * backend realtime Nodefony vivent dans le MÊME runtime — chaque sauvegarde de
 * fichier fait pulser la debug bar. Vite diffuse à tous les clients HMR, donc
 * écouter en plus du client de la page n'interfère pas.
 *
 * Protocole HMR Vite (messages JSON) : `connected`, `update` (`updates[]`),
 * `full-reload`, `error`, `prune`. On ne fait que LIRE — aucun envoi.
 */
export type HmrKind =
  | "connected"
  | "update"
  | "full-reload"
  | "error"
  | "prune";

export interface HmrEvent {
  kind: HmrKind;
  /** Chemin du module mis à jour (si fourni par Vite). */
  path?: string;
}

interface ViteHmrUpdate {
  path?: unknown;
  acceptedPath?: unknown;
}
interface ViteHmrMessage {
  type?: unknown;
  updates?: unknown;
  path?: unknown;
}

/**
 * Ouvre un WS HMR vers `url` et appelle `onEvent` à chaque message Vite.
 * Reconnexion best-effort (1,5 s). No-op hors navigateur.
 *
 * @param url - WS HMR Vite, ex. `wss://127.0.0.1:5173/`
 * @returns dispose() — ferme le WS et stoppe la reconnexion (OBLIGATOIRE).
 */
export function connectViteHmr(
  url: string,
  onEvent: (e: HmrEvent) => void,
): () => void {
  if (typeof WebSocket === "undefined") return () => {};
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const open = (): void => {
    try {
      ws = new WebSocket(url, "vite-hmr");
    } catch {
      return;
    }
    ws.onmessage = (ev: MessageEvent): void => {
      if (typeof ev.data !== "string") return;
      let m: ViteHmrMessage;
      try {
        m = JSON.parse(ev.data) as ViteHmrMessage;
      } catch {
        return;
      }
      if (!m || typeof m.type !== "string") return;
      switch (m.type) {
        case "connected":
          onEvent({ kind: "connected" });
          break;
        case "update":
          if (Array.isArray(m.updates)) {
            for (const u of m.updates as ViteHmrUpdate[]) {
              const p = u?.acceptedPath ?? u?.path;
              onEvent({ kind: "update", path: typeof p === "string" ? p : undefined });
            }
          }
          break;
        case "full-reload":
          onEvent({
            kind: "full-reload",
            path: typeof m.path === "string" ? m.path : undefined,
          });
          break;
        case "error":
          onEvent({ kind: "error" });
          break;
        case "prune":
          onEvent({ kind: "prune" });
          break;
        default:
          break;
      }
    };
    ws.onclose = (): void => {
      ws = null;
      if (closed) return;
      retry = setTimeout(open, 1500);
    };
    ws.onerror = (): void => {
      /* close gère la reconnexion */
    };
  };

  open();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    ws?.close();
    ws = null;
  };
}
