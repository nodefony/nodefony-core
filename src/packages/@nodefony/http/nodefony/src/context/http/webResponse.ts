import type http from "node:http";
import { Readable } from "node:stream";
import { HOP_BY_HOP } from "../../proxy/forward";
import type { ByteStreamSource } from "./ByteStream";

/**
 * En-têtes qu'une réponse RELAYÉE (issue de `fetch`) ne garde pas. Son corps a
 * déjà été DÉCODÉ par `fetch` : `content-encoding` et `content-length`
 * décrivent encore les octets compressés de l'amont, et les recopier
 * annoncerait un corps qui n'est pas celui qu'on envoie. Ses cookies
 * appartiennent à l'amont : les relayer les poserait sous le domaine de
 * l'application.
 */
const UPSTREAM_ONLY: ReadonlySet<string> = new Set([
  "content-encoding",
  "content-length",
  "set-cookie",
]);

/** Corps d'une `Response` sans corps (`new Response(null, { status: 204 })`). */
const emptyBody = (): Readable => Readable.from([], { objectMode: false });

/** Ce qu'une `Response` Web devient pour le flux d'octets de Nodefony. */
export interface IWebResponseParts {
  /** Statut de la réponse. */
  status: number;
  /** En-têtes à poser, filtrés (voir {@link webResponseParts}). */
  headers: http.OutgoingHttpHeaders;
  /** Corps, Web ou vide — jamais `null`. */
  source: ByteStreamSource;
}

/**
 * Traduit une `Response` Web standard en statut, en-têtes et corps pour le flux
 * d'octets — sans la lire : le corps reste un flux.
 *
 * Deux origines, deux règles, que `response.type` distingue :
 * - **construite par l'application** (`new Response(…)`, `Response.json(…)`,
 *   `Response.redirect(…)` — `type === "default"`) : ses en-têtes sont les
 *   siens, cookies compris (`getSetCookie()`), et partent tels quels ;
 * - **relayée** (issue de `fetch` — `"basic"`, `"cors"`…) : `content-encoding`,
 *   `content-length` et `set-cookie` de l'amont sont écartés (voir
 *   `UPSTREAM_ONLY`).
 *
 * Les en-têtes de connexion (RFC 9110 §7.6.1 — la liste du relais,
 * `HOP_BY_HOP`) ne partent jamais : ils décrivent un saut, et HTTP/2 les
 * refuse.
 *
 * @param response - une `Response` dont le corps n'a pas été consommé.
 * @returns statut, en-têtes filtrés et corps.
 */
export function webResponseParts(response: Response): IWebResponseParts {
  const relayed = response.type !== "default";
  // Littéral sans risque : une valeur d'en-tête est une CHAÎNE, et affecter une
  // chaîne à `__proto__` ne change pas le prototype (le setter l'ignore).
  const headers: http.OutgoingHttpHeaders = {};
  // Les noms rendus par `Headers` sont déjà en minuscules (Fetch Standard).
  for (const [name, value] of response.headers) {
    if (name === "set-cookie" || HOP_BY_HOP.has(name)) continue;
    if (relayed && UPSTREAM_ONLY.has(name)) continue;
    headers[name] = value;
  }
  if (!relayed) {
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) headers["set-cookie"] = cookies;
  }
  return {
    status: response.status,
    headers,
    source: response.body ?? emptyBody(),
  };
}
