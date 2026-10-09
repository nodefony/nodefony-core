/**
 * Un `fetch` de banc pour `NodefonySse` : chaque appel rend un flux
 * `text/event-stream` que le test alimente, et l'on COMPTE les flux encore
 * ouverts — un flux est fermé quand le client a abandonné sa requête.
 *
 * C'est le juge des liaisons de vue : une connexion qui fuit ne se voit pas à
 * l'écran, elle ne se voit qu'au compte des requêtes que personne n'a fermées.
 * Aucun réseau, aucun minuteur : le banc tourne à l'identique sous Node et
 * sous jsdom.
 */

/** Une requête reçue par le banc. */
export interface ISseCall {
  readonly url: string;
  readonly signal: AbortSignal;
  /** Écrit des octets dans le flux (un ou plusieurs blocs SSE). */
  push(text: string): void;
}

export interface ISseFetchBench {
  readonly fetch: typeof fetch;
  readonly calls: ISseCall[];
  /** Combien de requêtes le client n'a pas abandonnées. */
  open(): number;
}

/**
 * @param status - statut rendu par chaque requête ; tout autre que 200 est un
 *   refus du serveur (le client passe à `CLOSED`, sans reconnexion).
 */
export function sseFetchBench(status = 200): ISseFetchBench {
  const calls: ISseCall[] = [];
  const encoder = new TextEncoder();
  const fakeFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? new AbortController().signal;
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    signal.addEventListener("abort", () => {
      try {
        controller?.error(new DOMException("aborted", "AbortError"));
      } catch {
        // flux déjà fermé
      }
    });
    calls.push({
      url:
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input,
      signal,
      // Un flux abandonné par le client n'accepte plus rien : un serveur réel
      // écrirait dans le vide, sans erreur pour le banc.
      push: (text) => {
        if (!signal.aborted) controller?.enqueue(encoder.encode(text));
      },
    });
    return Promise.resolve(
      new Response(status === 200 ? body : null, {
        status,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
  };
  return {
    fetch: fakeFetch as typeof fetch,
    calls,
    open: () => calls.filter((c) => !c.signal.aborted).length,
  };
}

/** Laisse passer la réponse de `fetch` et la lecture des morceaux en attente. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}
