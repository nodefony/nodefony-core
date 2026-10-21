import type { IMcpTransport } from "./server";

/**
 * Le flux de réponse d'une requête MCP, ouvert PARESSEUSEMENT — brique
 * générique de la boîte à outils, indépendante du transport.
 *
 * Toute porte (HTTP de développement, porte d'une application, futur `stdio`)
 * a la même décision à prendre : répondre en un objet, ou en flux quand
 * l'appel a quelque chose à dire en route. La règle vit ICI, une fois : le flux
 * ne s'ouvre qu'au PREMIER envoi, les envois s'enchaînent dans l'ordre, et la
 * réponse finale clôt le flux. Un appel qui ne dit rien en route n'ouvre rien —
 * la porte répond alors comme avant.
 *
 * Exception : un appel encore en cours au bout du délai de grâce
 * ({@link MCP_STREAM_GRACE_MS}) ouvre le flux sans rien y écrire. La norme
 * oblige le client à accepter une réponse SSE (`transports/streamable-http`),
 * avec ou sans `progressToken` ; or une réponse JSON qui tarde tombe sous le
 * délai d'inactivité de la requête (408), quand un flux ouvert le désarme et
 * bat de lui-même. Un outil court n'y voit rien : il a répondu avant.
 *
 * La porte ne fournit que ce qu'elle seule sait faire : OUVRIR son flux
 * (`renderSse()` pour une route HTTP).
 */

/**
 * Délai de grâce, en ms : au-delà, un appel sans réponse ouvre le flux. Très en
 * deçà du délai d'inactivité d'une requête (30 s par défaut), assez long pour
 * qu'un outil ordinaire réponde en JSON comme avant.
 */
export const MCP_STREAM_GRACE_MS = 5000;

/** Ce qu'une porte sait ouvrir : un puits d'événements, ordonné. */
export interface IMcpEventSink {
  /** Le flux est-il fermé (client parti, ou clos) ? */
  readonly closed: boolean;
  /**
   * Envoie un message JSON-RPC ; peut lever à l'appel ou rendre une promesse
   * de contre-pression.
   */
  send(data: unknown): Promise<void> | undefined;
}

/** Le flux de réponse d'UNE requête, vu de la porte. */
export interface IMcpResponseStream<S extends IMcpEventSink> {
  /** À donner au protocole (`IMcpServerContext.transport`). */
  readonly transport: IMcpTransport;
  /**
   * Attend les envois en cours puis, si un flux a été ouvert, y écrit la
   * réponse finale.
   *
   * @param body - la réponse JSON-RPC finale.
   * @returns le flux ouvert (à clore par la porte), ou `null` : rien n'a été
   *   envoyé en route, la porte répond en un objet.
   */
  finish(body: unknown): Promise<S | null>;
}

/** Options de {@link createMcpResponseStream}. */
export interface IMcpResponseStreamOptions<S extends IMcpEventSink> {
  /** Abattu quand le client abandonne la requête. */
  signal?: AbortSignal | undefined;
  /**
   * Ouvre le flux de la porte ; absent quand le client n'en accepte pas — la
   * progression devient alors muette, jamais refusée.
   */
  open?: (() => S | Promise<S>) | undefined;
  /**
   * Ouvre le flux si l'appel n'a pas répondu dans ce délai (ms) ; absent ou 0 :
   * le flux ne s'ouvre qu'au premier envoi.
   */
  graceMs?: number | undefined;
  /** Un envoi perdu (client parti, événement refusé) : à journaliser. */
  onError?: ((error: unknown, final: boolean) => void) | undefined;
}

/**
 * Fabrique le flux de réponse paresseux d'une requête MCP.
 *
 * @param options - signal d'abandon, ouverture du flux, journal des pertes.
 * @returns le transport à donner au protocole, et `finish()`.
 */
export function createMcpResponseStream<S extends IMcpEventSink>(
  options: IMcpResponseStreamOptions<S>,
): IMcpResponseStream<S> {
  const { signal, open, onError, graceMs } = options;
  let sink: S | null = null;
  let pending: Promise<void> = Promise.resolve();
  let grace: ReturnType<typeof setTimeout> | null = null;
  const transport: IMcpTransport = {};
  if (signal) transport.signal = signal;
  if (open && graceMs !== undefined && graceMs > 0) {
    grace = setTimeout(() => {
      grace = null;
      // Client parti : ouvrir un flux vers personne n'apprendrait rien.
      if (sink !== null || signal?.aborted === true) return;
      const previous = pending;
      pending = (async () => {
        await previous;
        sink ??= await open();
      })().catch((error: unknown) => onError?.(error, false));
    }, graceMs);
    // Le minuteur d'une requête ne retient jamais le process.
    grace.unref();
  }
  if (open) {
    transport.notify = (notification) => {
      const previous = pending;
      pending = (async () => {
        await previous;
        sink ??= await open();
        if (!sink.closed) await sink.send(notification);
      })().catch((error: unknown) => onError?.(error, false));
    };
  }
  return {
    transport,
    async finish(body) {
      if (grace !== null) {
        clearTimeout(grace);
        grace = null;
      }
      await pending;
      if (sink === null) return null;
      if (!sink.closed) {
        try {
          await sink.send(body);
        } catch (error) {
          onError?.(error, true);
        }
      }
      return sink;
    },
  };
}
