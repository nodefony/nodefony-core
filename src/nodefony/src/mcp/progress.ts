import {
  jsonRpcNotification,
  type IJsonRpcNotification,
} from "../jsonrpc/index";

/**
 * La progression d'un appel d'outil (`notifications/progress`) — règle PURE,
 * horloge injectée.
 *
 * La norme (`basic/patterns/progress`) pose quatre exigences, toutes tenues
 * ICI plutôt que dans chaque outil :
 *  - une notification ne cite qu'un jeton fourni par une requête EN COURS — le
 *    rapporteur se tait dès que l'outil a rendu sa réponse ({@link IMcpProgressReporter.end}) ;
 *  - `progress` CROÎT à chaque notification — une valeur qui stagne ou recule
 *    est ignorée, pas transmise ;
 *  - la cadence est bornée (« SHOULD implement rate limiting ») ;
 *  - sans jeton, rien n'est émis : l'agent n'a rien demandé.
 */

/** Intervalle minimal entre deux notifications de progression, en millisecondes. */
export const MCP_PROGRESS_MIN_INTERVAL_MS = 100;

/** Longueur maximale du `message` d'une progression, en caractères. */
export const MCP_PROGRESS_MESSAGE_MAX = 1000;

/** Un jeton de progression : chaîne ou entier (`progress` §Progress Flow). */
export type McpProgressToken = string | number;

/** Le rapporteur d'UN appel : ce que l'outil appelle, ce que la porte clôt. */
export interface IMcpProgressReporter {
  /**
   * Signale un avancement ; ignoré s'il ne croît pas, s'il arrive trop tôt
   * après le précédent, ou après {@link end}.
   */
  progress(progress: number, total?: number, message?: string): void;
  /** L'outil a rendu sa réponse : plus aucune notification ne part. */
  end(): void;
}

/**
 * Lit le jeton de progression d'une requête (`params._meta.progressToken`).
 *
 * @param params - les `params` de la requête.
 * @returns le jeton, ou `null` s'il manque ou n'est ni une chaîne ni un entier.
 */
export function readProgressToken(
  params: Record<string, unknown>,
): McpProgressToken | null {
  const meta = params._meta;
  if (typeof meta !== "object" || meta === null || !("progressToken" in meta)) {
    return null;
  }
  const token = meta.progressToken;
  if (typeof token === "string") return token;
  if (typeof token === "number" && Number.isInteger(token)) return token;
  return null;
}

/** Le rapporteur muet : aucun jeton, ou aucune porte capable d'un flux. */
const SILENT: IMcpProgressReporter = {
  progress: () => {},
  end: () => {},
};

/**
 * Fabrique le rapporteur de progression d'un appel.
 *
 * @param token - le jeton de la requête ({@link readProgressToken}), ou `null`.
 * @param notify - émet une notification sur le flux de la réponse ; absent
 *   quand la porte ne sait pas tenir de flux.
 * @param now - horloge (millisecondes), injectée pour l'épreuve.
 * @param minIntervalMs - intervalle minimal entre deux notifications.
 * @returns un rapporteur, muet quand il n'y a ni jeton ni flux.
 */
export function createProgressReporter(
  token: McpProgressToken | null,
  notify: ((notification: IJsonRpcNotification) => void) | undefined,
  now: () => number = Date.now,
  minIntervalMs: number = MCP_PROGRESS_MIN_INTERVAL_MS,
): IMcpProgressReporter {
  if (token === null || notify === undefined) return SILENT;
  let ended = false;
  let last = Number.NEGATIVE_INFINITY;
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    progress(progress, total, message) {
      if (ended || !Number.isFinite(progress) || progress <= last) return;
      const at = now();
      if (at - lastAt < minIntervalMs) return;
      last = progress;
      lastAt = at;
      const params: Record<string, unknown> = {
        progressToken: token,
        progress,
      };
      if (total !== undefined && Number.isFinite(total)) params.total = total;
      if (message !== undefined) {
        params.message = message.slice(0, MCP_PROGRESS_MESSAGE_MAX);
      }
      notify(jsonRpcNotification("notifications/progress", params));
    },
    end() {
      ended = true;
    },
  };
}
