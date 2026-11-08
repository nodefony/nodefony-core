/**
 * Appeler une route depuis la page et montrer ce qui revient VRAIMENT :
 * statut, en-têtes utiles, durée, et le corps morceau par morceau quand il
 * arrive en flux. Plus la même chose pour une WebSocket : les trames reçues.
 *
 * Guide pour un agent : brique du KIT, partagée par les démos — « Premiers
 * pas » s'en sert pour chacune de ses étapes (`ProbeResult.tsx` l'affiche).
 * Rien n'est simulé : `fetch` et `WebSocket` du navigateur, contre le serveur
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
  "content-disposition",
  "cache-control",
  "etag",
  "last-modified",
  "x-demo",
] as const;

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
  const start = performance.now();
  const since = () => Math.round(performance.now() - start);
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    const chunks: IProbeChunk[] = [];
    const decoder = new TextDecoder();
    const reader = response.body?.getReader();
    for (;;) {
      if (reader === undefined) break;
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push({
        at: since(),
        text: decoder.decode(value, { stream: true }),
      });
      onChunk?.([...chunks]);
    }
    const text = chunks.map((chunk) => chunk.text).join("") + decoder.decode();
    return {
      request,
      status: response.status,
      ms: since(),
      headers: pickHeaders(response.headers),
      body: formatBody(text, response.headers.get("content-type")),
      chunks,
      redirected: response.redirected,
      finalUrl: response.redirected ? new URL(response.url).pathname : null,
      error: null,
    };
  } catch (error) {
    return failed(request, since(), error);
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

/** Le résultat d'un appel qui n'a pas abouti. */
function failed(request: string, ms: number, error: unknown): IProbeResult {
  return {
    request,
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
