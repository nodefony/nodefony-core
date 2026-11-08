import { NodefonySse, type NodefonySseOptions } from "nodefony/client";

/**
 * Appeler une route depuis la page et montrer ce qui revient VRAIMENT :
 * statut, en-têtes utiles, durée, et le corps morceau par morceau quand il
 * arrive en flux. Plus la même chose pour une WebSocket (les trames reçues)
 * et pour un flux SSE (les événements, et les reconnexions).
 *
 * Guide pour un agent : brique du KIT, partagée par les démos — « Premiers
 * pas » et « Flux SSE » s'en servent pour chaque geste (`ProbeResult.tsx`
 * l'affiche). Rien n'est simulé : `fetch`, `WebSocket` et `EventSource` du
 * navigateur, contre le serveur
 * qui sert la page. Une redirection est SUIVIE (c'est ce que fait un
 * navigateur) : `redirected` et `finalUrl` disent où elle a mené.
 */

/** Un morceau du corps, horodaté depuis l'envoi de la requête. */
export interface IProbeChunk {
  /** Millisecondes écoulées depuis l'envoi. */
  at: number;
  text: string;
}

/** Ce qu'un appel a rendu, tel que le navigateur l'a reçu. */
export interface IProbeResult {
  /** La requête, telle qu'on l'écrirait : `GET /demo/api/first/web`. */
  request: string;
  /** Les en-têtes de `SENT_HEADERS` que la requête a portés. */
  sent: readonly (readonly [string, string])[];
  /** `null` quand la requête n'a pas abouti (réseau, socket refusée). */
  status: number | null;
  /** Durée totale, corps compris, en millisecondes. */
  ms: number;
  headers: readonly (readonly [string, string])[];
  /** Le corps entier ; JSON remis en forme. */
  body: string;
  chunks: readonly IProbeChunk[];
  redirected: boolean;
  /** Adresse finale, quand une redirection a été suivie. */
  finalUrl: string | null;
  error: string | null;
}

/** Les en-têtes qui apprennent quelque chose, dans cet ordre. */
export const SHOWN_HEADERS = [
  "content-type",
  "content-length",
  "accept-ranges",
  "content-range",
  "content-disposition",
  "cache-control",
  "etag",
  "last-modified",
  "x-accel-buffering",
  "x-demo",
] as const;

/** Les en-têtes de REQUÊTE qui changent la réponse, montrés avec elle. */
export const SENT_HEADERS = [
  "accept",
  "range",
  "if-range",
  "if-none-match",
  "last-event-id",
] as const;

/** Octets montrés d'un corps binaire. */
export const PROBE_BINARY_BYTES = 64;

/** Au-delà, le corps affiché est coupé : la page n'est pas un éditeur. */
export const PROBE_BODY_LIMIT = 6000;

/** Un corps JSON remis en forme ; tout autre texte tel quel, borné. */
export function formatBody(text: string, contentType: string | null): string {
  let shown = text;
  if (contentType?.includes("json") === true) {
    try {
      shown = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // Pas du JSON valide malgré l'en-tête : montré brut, c'est un constat.
    }
  }
  return shown.length > PROBE_BODY_LIMIT
    ? `${shown.slice(0, PROBE_BODY_LIMIT)}\n… (${shown.length - PROBE_BODY_LIMIT} caractères de plus)`
    : shown;
}

/**
 * Un corps qui se lit comme du texte : JSON, HTML, texte, flux SSE — ou sans
 * type annoncé. Le reste (vidéo, image, octets) se montre en hexadécimal.
 */
export function isTextual(contentType: string | null): boolean {
  if (contentType === null) return true;
  return /^text\/|json|xml|javascript|x-www-form-urlencoded/u.test(contentType);
}

/**
 * Les premiers octets d'un corps binaire, comme un éditeur hexadécimal :
 * position, seize octets, puis leur lecture en ASCII (`.` hors imprimable).
 *
 * @param bytes - les premiers octets reçus
 * @param total - la taille totale du corps
 */
export function hexPreview(bytes: Uint8Array, total: number): string {
  const lines = [`${total} octets reçus — les ${bytes.length} premiers :`];
  for (let at = 0; at < bytes.length; at += 16) {
    const row = [...bytes.subarray(at, at + 16)];
    const hex = row.map((byte) => byte.toString(16).padStart(2, "0"));
    const ascii = row
      .map((byte) =>
        byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".",
      )
      .join("");
    lines.push(
      `${at.toString(16).padStart(8, "0")}  ${hex.join(" ").padEnd(47)}  ${ascii}`,
    );
  }
  return lines.join("\n");
}

/** Les en-têtes de `SENT_HEADERS` que porte `init`. */
export function pickSent(
  init: RequestInit,
): readonly (readonly [string, string])[] {
  const headers = new Headers(init.headers);
  return SENT_HEADERS.flatMap((name) => {
    const value = headers.get(name);
    return value === null ? [] : [[name, value] as const];
  });
}

/** Les en-têtes de `SHOWN_HEADERS` présents dans la réponse. */
export function pickHeaders(
  headers: Headers,
): readonly (readonly [string, string])[] {
  return SHOWN_HEADERS.flatMap((name) => {
    const value = headers.get(name);
    return value === null ? [] : [[name, value] as const];
  });
}

// #region probe-http
/**
 * Appelle `url` et lit le corps EN FLUX : `onChunk` reçoit chaque morceau à
 * son arrivée, pour l'afficher sans attendre la fin.
 *
 * @param url - chemin de la route (même origine que la page)
 * @param init - méthode, en-têtes, corps
 * @param onChunk - appelé à chaque morceau du corps
 * @returns ce que le navigateur a reçu ; ne rejette jamais
 */
export async function probeHttp(
  url: string,
  init: RequestInit = {},
  onChunk?: (chunks: readonly IProbeChunk[]) => void,
): Promise<IProbeResult> {
  const request = `${init.method ?? "GET"} ${url}`;
  const sent = pickSent(init);
  const start = performance.now();
  const since = () => Math.round(performance.now() - start);
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    const contentType = response.headers.get("content-type");
    // Un corps binaire décodé en texte n'apprend rien : on en garde les
    // premiers octets, et on compte le reste.
    const textual = isTextual(contentType);
    const head = new Uint8Array(PROBE_BINARY_BYTES);
    let received = 0;
    const chunks: IProbeChunk[] = [];
    const decoder = new TextDecoder();
    const reader = response.body?.getReader();
    for (;;) {
      if (reader === undefined) break;
      const { done, value } = await reader.read();
      if (done) break;
      if (received < PROBE_BINARY_BYTES) {
        head.set(value.subarray(0, PROBE_BINARY_BYTES - received), received);
      }
      received += value.byteLength;
      chunks.push({
        at: since(),
        text: textual
          ? decoder.decode(value, { stream: true })
          : `+${value.byteLength} octets`,
      });
      onChunk?.([...chunks]);
    }
    const text = chunks.map((chunk) => chunk.text).join("") + decoder.decode();
    return {
      request,
      sent,
      status: response.status,
      ms: since(),
      headers: pickHeaders(response.headers),
      body: textual
        ? formatBody(text, contentType)
        : received === 0
          ? ""
          : hexPreview(
              head.subarray(0, Math.min(received, PROBE_BINARY_BYTES)),
              received,
            ),
      chunks: textual ? chunks : [],
      redirected: response.redirected,
      finalUrl: response.redirected ? new URL(response.url).pathname : null,
      error: null,
    };
  } catch (error) {
    return failed(request, since(), error, sent);
  }
}
// #endregion

// #region probe-socket
/**
 * Ouvre une WebSocket vers `path`, garde la PREMIÈRE trame reçue, envoie
 * `message`, garde la réponse, puis referme.
 *
 * @param path - chemin de la route (même origine que la page)
 * @param message - envoyé une fois la première trame reçue
 * @returns les trames reçues, en `chunks` ; ne rejette jamais
 */
export function probeSocket(
  path: string,
  message: string,
): Promise<IProbeResult> {
  const request = `WEBSOCKET ${path}`;
  const start = performance.now();
  const since = () => Math.round(performance.now() - start);
  return new Promise((resolve) => {
    const chunks: IProbeChunk[] = [];
    const url = new URL(path, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      resolve(failed(request, since(), error));
      return;
    }
    const finish = (error: string | null) => {
      clearTimeout(guard);
      socket.close();
      resolve({
        request,
        sent: [],
        status: error === null ? 101 : null,
        ms: since(),
        headers: [],
        body: chunks
          .map((chunk) => formatBody(chunk.text, "application/json"))
          .join("\n\n"),
        chunks,
        redirected: false,
        finalUrl: null,
        error,
      });
    };
    // Une socket refusée ne lève rien : sans réponse, on conclut au refus.
    const guard = setTimeout(() => finish("aucune trame en 5 s"), 5000);
    socket.addEventListener("message", (event: MessageEvent<unknown>) => {
      chunks.push({
        at: since(),
        text: typeof event.data === "string" ? event.data : "(trame binaire)",
      });
      if (chunks.length === 1) socket.send(message);
      else finish(null);
    });
    socket.addEventListener("error", () => finish("socket refusée"));
  });
}
// #endregion

// #region probe-sse
/** Comment lire un flux SSE, et quand s'arrêter. */
export interface IProbeSseOptions {
  /** Types d'événements écoutés, en plus de `message`. */
  events?: readonly string[];
  /** Le type qui annonce la fin : la page ferme en le recevant. */
  doneEvent?: string;
  /** La page ferme après ce nombre d'événements. */
  maxEvents?: number;
  /**
   * Les événements de ce type se mettent bout à bout sur UNE ligne, qui
   * grandit : une réponse écrite mot à mot se lit comme une phrase.
   */
  growEvent?: string;
  /**
   * Pour `EventSource`, une fin de flux est une coupure : il se reconnecte.
   * Vrai : la page ferme à la première coupure.
   */
  closeOnError?: boolean;
  /** `POST`, en-têtes, reprise : `NodefonySse`, qui sait ce que le natif refuse. */
  init?: NodefonySseOptions;
}

/**
 * Lit le flux SSE de `url` avec `EventSource` — ou `NodefonySse` quand
 * `init` est donné — et note chaque événement, chaque ouverture et chaque
 * coupure, horodatés.
 *
 * @param url - chemin de la route (même origine que la page)
 * @param options - événements écoutés, condition d'arrêt
 * @param onChunk - appelé à chaque événement
 * @returns les événements reçus, en `chunks` ; ne rejette jamais
 */
export function probeSse(
  url: string,
  options: IProbeSseOptions = {},
  onChunk?: (chunks: readonly IProbeChunk[]) => void,
): Promise<IProbeResult> {
  const client = options.init === undefined ? "EventSource" : "NodefonySse";
  const request = `${client} ${options.init?.method ?? "GET"} ${url}`;
  const start = performance.now();
  const since = () => Math.round(performance.now() - start);
  return new Promise((resolve) => {
    const chunks: IProbeChunk[] = [];
    const note = (text: string) => {
      chunks.push({ at: since(), text });
      onChunk?.([...chunks]);
    };
    let source: EventSource | NodefonySse;
    try {
      source =
        options.init === undefined
          ? new EventSource(url)
          : new NodefonySse(url, options.init);
    } catch (error) {
      resolve(failed(request, since(), error));
      return;
    }
    // Un flux ne s'ouvre qu'en 200 `text/event-stream` : ouvert, c'est un 200.
    let opened = false;
    let received = 0;
    let lastId = "";
    const finish = (error: string | null) => {
      clearTimeout(guard);
      source.close();
      resolve({
        request,
        sent: [],
        status: opened ? 200 : null,
        ms: since(),
        headers: [],
        body: chunks.map((chunk) => chunk.text).join("\n"),
        chunks,
        redirected: false,
        finalUrl: null,
        error,
      });
    };
    const guard = setTimeout(() => finish("flux non terminé en 15 s"), 15_000);
    source.addEventListener("open", () => {
      note(lastId === "" ? "▶ ouvert" : `▶ rouvert — Last-Event-ID: ${lastId}`);
      opened = true;
    });
    const onEvent = (event: Event) => {
      if (!(event instanceof MessageEvent)) return;
      received += 1;
      if (event.lastEventId !== "") lastId = event.lastEventId;
      const id = event.lastEventId === "" ? "" : ` #${event.lastEventId}`;
      const last = chunks.at(-1);
      const head = `${event.type}${id} · `;
      if (
        event.type === options.growEvent &&
        last?.text.startsWith(head) === true
      ) {
        chunks[chunks.length - 1] = {
          at: since(),
          text: `${last.text} ${String(event.data)}`,
        };
        onChunk?.([...chunks]);
      } else {
        note(`${head}${String(event.data)}`);
      }
      if (event.type === options.doneEvent || received === options.maxEvents) {
        note("■ la page ferme le flux");
        finish(null);
      }
    };
    for (const type of ["message", ...(options.events ?? [])]) {
      source.addEventListener(type, onEvent);
    }
    source.addEventListener("error", () => {
      if (source.readyState === EventSource.CLOSED) {
        note("■ réponse sans flux : le client ne se reconnecte plus");
        finish(null);
      } else if (options.closeOnError === true) {
        note(
          "■ fin du flux — la page ferme, sinon le client se reconnecterait",
        );
        finish(null);
      } else {
        note("↻ coupé : le client se reconnecte");
      }
    });
  });
}
// #endregion

/** Le résultat d'un appel qui n'a pas abouti. */
function failed(
  request: string,
  ms: number,
  error: unknown,
  sent: readonly (readonly [string, string])[] = [],
): IProbeResult {
  return {
    request,
    sent,
    status: null,
    ms,
    headers: [],
    body: "",
    chunks: [],
    redirected: false,
    finalUrl: null,
    error: error instanceof Error ? error.message : String(error),
  };
}
