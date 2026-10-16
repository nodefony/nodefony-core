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
 * La porte ne fournit que ce qu'elle seule sait faire : OUVRIR son flux
 * (`renderSse()` pour une route HTTP).
 */

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
  const { signal, open, onError } = options;
  let sink: S | null = null;
  let pending: Promise<void> = Promise.resolve();
  const transport: IMcpTransport = {};
  if (signal) transport.signal = signal;
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
