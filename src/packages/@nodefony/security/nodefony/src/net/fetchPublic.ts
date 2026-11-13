import { request as httpsRequest } from "node:https";
import {
  request as httpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from "node:http";
import { isIP, type LookupFunction } from "node:net";
import { assertPublicUrl, type DnsResolver } from "./ssrfGuard";
import { SsrfError } from "../../errors/SsrfError";
import { FetchPublicError } from "../../errors/FetchPublicError";

/**
 * Requête sortante vers un site TIERS, sûre par construction — la primitive que
 * tout code de Nodefony (webhooks, aperçu de lien, agents, RAG) appelle quand
 * l'adresse vient d'un humain.
 *
 * Guide pour un agent : n'écris jamais `fetch(urlUtilisateur)`. Appelle
 * {@link fetchPublic} ; la règle de cible vit dans `assertPublicUrl`
 * (`ssrfGuard.ts`) et n'est jamais recopiée ici.
 */

/** Options de {@link fetchPublic}. */
export interface IFetchPublicOptions {
  /** Méthode HTTP. Défaut : `GET` (`POST` si un corps est fourni). */
  readonly method?: string;
  /** En-têtes ajoutés. Ni `Cookie` ni `Authorization` ne sont posés d'office. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Corps de la requête (texte UTF-8 ou octets). */
  readonly body?: string | Uint8Array;
  /** Redirections suivies au plus. Défaut : `0` (un 3xx est rendu tel quel). */
  readonly maxRedirects?: number;
  /** Octets du corps de réponse lus au plus. Défaut : 1 Mio. */
  readonly maxBytes?: number;
  /** Délai TOTAL (résolution, connexions, redirections, lecture), en ms. Défaut : 10 000. */
  readonly timeoutMs?: number;
  /** Autorise `http:` en plus de `https:`. Défaut : `false`. */
  readonly allowHttp?: boolean;
  /** Autorise les cibles non publiques (dev/test seulement). Défaut : `false`. */
  readonly allowPrivate?: boolean;
  /** Résolveur DNS injectable (tests). Défaut : `node:dns`. */
  readonly resolver?: DnsResolver;
  /**
   * IP DÉJÀ vérifiées par `assertPublicUrl` pour l'adresse de départ : la
   * connexion y est épinglée sans nouvelle résolution. Pour un appelant qui a
   * contrôlé l'adresse plus tôt (webhooks) ; les redirections, elles, sont
   * toujours revérifiées.
   */
  readonly vettedAddresses?: readonly string[];
}

/** Réponse de {@link fetchPublic}. */
export interface IFetchPublicResult {
  /** Code de statut HTTP de la réponse finale. */
  readonly status: number;
  /** En-têtes de la réponse finale. */
  readonly headers: IncomingHttpHeaders;
  /** Corps reçu, NON décodé (`Content-Encoding` n'est jamais appliqué). */
  readonly body: Uint8Array;
  /** `true` si `maxBytes` a coupé la lecture (la connexion a alors été détruite). */
  readonly truncated: boolean;
  /** Adresse de la réponse finale (après redirections). */
  readonly url: URL;
  /** Nombre de redirections suivies. */
  readonly redirects: number;
}

const DEFAULT_MAX_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Statuts de redirection que l'on suit (RFC 9110 §15.4). */
function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

/** En-têtes qui ne doivent jamais suivre une redirection. */
const REDIRECT_STRIPPED: ReadonlySet<string> = new Set([
  "cookie",
  "authorization",
  "proxy-authorization",
  "host",
]);

/** En-têtes qui décrivent le corps — retirés quand la redirection l'abandonne. */
const BODY_HEADERS: ReadonlySet<string> = new Set([
  "content-type",
  "content-length",
  "content-encoding",
]);

/** État partagé par les sauts d'un même appel (délai total, requête en vol). */
interface ICallState {
  current: ClientRequest | null;
  expired: FetchPublicError | null;
}

/** Issue d'un saut : une réponse finale ou une redirection à suivre. */
type HopOutcome =
  | {
      readonly kind: "final";
      readonly status: number;
      readonly headers: IncomingHttpHeaders;
      readonly body: Uint8Array;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "redirect";
      readonly status: number;
      readonly location: string;
    };

/** `lookup` qui n'offre que les IP vérifiées — le nom ne sert plus qu'au SNI et à `Host`. */
function pinnedLookup(addresses: readonly string[]): LookupFunction {
  return (_hostname, options, callback) => {
    const entries = addresses.map((address) => ({
      address,
      family: isIP(address) === 6 ? 6 : 4,
    }));
    const first = entries[0];
    if (first === undefined) {
      callback(
        Object.assign(new Error("aucune adresse vérifiée"), {
          code: "ENOTFOUND",
          errno: -3008,
        }),
        "",
        4,
      );
    } else if (options.all === true) {
      callback(null, entries, first.family);
    } else {
      callback(null, first.address, first.family);
    }
  };
}

/** Concatène les morceaux reçus UNE fois dans un `Uint8Array`. */
function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Un saut HTTP(S) vers l'IP épinglée. Le corps de réponse est lu jusqu'à
 * `maxBytes` puis la connexion est DÉTRUITE (jamais drainée).
 */
function hop(
  url: URL,
  method: string,
  headers: Record<string, string>,
  payload: Uint8Array | null,
  addresses: readonly string[],
  follow: boolean,
  maxBytes: number,
  state: ICallState,
): Promise<HopOutcome> {
  return new Promise<HopOutcome>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: HopOutcome): void => {
      if (settled) return;
      settled = true;
      state.current = null;
      resolve(outcome);
    };
    const fail = (error: NodeJS.ErrnoException): void => {
      if (settled) return;
      settled = true;
      state.current = null;
      const code = error.code;
      reject(
        state.expired ??
          new FetchPublicError(
            "network",
            typeof code === "string"
              ? `${error.message} (${code})`
              : error.message,
          ),
      );
    };

    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = requestFn(url, {
      method,
      headers,
      agent: false,
      ...(addresses.length > 0 ? { lookup: pinnedLookup(addresses) } : {}),
    });
    state.current = req;
    req.on("error", fail);
    req.on("response", (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (follow && isRedirectStatus(status) && typeof location === "string") {
        res.destroy();
        finish({ kind: "redirect", status, location });
        return;
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      res.on("data", (chunk: Uint8Array) => {
        if (settled) return;
        const room = maxBytes - total;
        if (chunk.length > room) {
          if (room > 0) chunks.push(chunk.subarray(0, room));
          total = maxBytes;
          finish({
            kind: "final",
            status,
            headers: res.headers,
            body: concat(chunks, total),
            truncated: true,
          });
          res.destroy();
          req.destroy();
          return;
        }
        chunks.push(chunk);
        total += chunk.length;
      });
      res.on("end", () =>
        finish({
          kind: "final",
          status,
          headers: res.headers,
          body: concat(chunks, total),
          truncated: false,
        }),
      );
      res.on("error", fail);
      res.on("close", () => {
        if (!settled) fail(new Error("connexion fermée avant la fin du corps"));
      });
    });
    req.end(payload);
  });
}

/**
 * Lit une URL fournie par un humain sans jamais atteindre le réseau interne.
 *
 * À CHAQUE saut (adresse de départ comme redirections) : protocole, absence
 * d'identifiants et IP sont jugés par `assertPublicUrl`, puis la connexion est
 * ÉPINGLÉE sur l'IP vérifiée (aucune seconde résolution : un rebinding DNS ne
 * mène nulle part). Le délai est TOTAL — un serveur qui goutte un octet par
 * seconde est coupé — et la lecture s'arrête à `maxBytes` en détruisant la
 * connexion. Aucun cookie, aucun `Authorization` n'est ajouté ni conservé à
 * travers une redirection, et le corps n'est jamais décodé (pas de bombe de
 * décompression).
 *
 * @param rawUrl - adresse à lire.
 * @param options - méthode, corps, bornes et politique de cible.
 * @returns la réponse finale, corps borné et non décodé.
 * @throws SsrfError si la cible, ou une redirection, est interdite.
 * @throws FetchPublicError si le délai total, le nombre de redirections ou le réseau échoue.
 */
export async function fetchPublic(
  rawUrl: string,
  options: IFetchPublicOptions = {},
): Promise<IFetchPublicResult> {
  const maxRedirects = options.maxRedirects ?? 0;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes doit être un entier positif ou nul");
  }
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new RangeError("maxRedirects doit être un entier positif ou nul");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs doit être strictement positif");
  }

  let payload: Uint8Array | null =
    options.body === undefined
      ? null
      : typeof options.body === "string"
        ? new TextEncoder().encode(options.body)
        : options.body;
  let method = (
    options.method ?? (payload === null ? "GET" : "POST")
  ).toUpperCase();
  let headers: Record<string, string> = { "accept-encoding": "identity" };
  if (options.headers !== undefined) {
    for (const [name, value] of Object.entries(options.headers)) {
      headers[name.toLowerCase()] = value;
    }
  }
  if (payload !== null) headers["content-length"] = String(payload.length);

  const allowHttp = options.allowHttp === true;
  const state: ICallState = { current: null, expired: null };
  let expire!: (error: FetchPublicError) => void;
  const deadline = new Promise<never>((_, rejectDeadline) => {
    expire = rejectDeadline;
  });
  deadline.catch(() => undefined);
  const timer = setTimeout(() => {
    const error = new FetchPublicError(
      "timeout",
      `délai total de ${timeoutMs} ms dépassé`,
    );
    state.expired = error;
    expire(error);
    state.current?.destroy();
  }, timeoutMs);

  try {
    let first = true;
    let target = rawUrl;
    let pinnedHost: string | null = null;
    let pinnedAddresses: readonly string[] = [];
    let redirects = 0;
    for (;;) {
      let url: URL;
      let addresses: readonly string[];
      if (
        first &&
        options.vettedAddresses !== undefined &&
        options.vettedAddresses.length > 0
      ) {
        // Adresse de départ déjà vérifiée par l'appelant : protocole et
        // identifiants se jugent ici, l'IP est celle qu'il a contrôlée.
        ({ url } = await Promise.race([
          assertPublicUrl(target, { allowPrivate: true, allowHttp }),
          deadline,
        ]));
        addresses = options.vettedAddresses;
      } else if (!first && new URL(target).hostname === pinnedHost) {
        // Même hôte que le saut précédent : IP déjà vérifiée, jamais re-résolue.
        ({ url } = await Promise.race([
          assertPublicUrl(target, { allowPrivate: true, allowHttp }),
          deadline,
        ]));
        addresses = pinnedAddresses;
      } else {
        const checked = await Promise.race([
          assertPublicUrl(target, {
            allowPrivate: options.allowPrivate === true,
            allowHttp,
            ...(options.resolver !== undefined
              ? { resolver: options.resolver }
              : {}),
          }),
          deadline,
        ]);
        url = checked.url;
        addresses = checked.addresses;
      }
      first = false;
      pinnedHost = url.hostname;
      pinnedAddresses = addresses;

      const outcome = await Promise.race([
        hop(
          url,
          method,
          headers,
          payload,
          addresses,
          maxRedirects > 0,
          maxBytes,
          state,
        ),
        deadline,
      ]);
      if (outcome.kind === "final") {
        return {
          status: outcome.status,
          headers: outcome.headers,
          body: outcome.body,
          truncated: outcome.truncated,
          url,
          redirects,
        };
      }

      if (redirects >= maxRedirects) {
        throw new FetchPublicError(
          "too-many-redirects",
          `plus de ${maxRedirects} redirection(s)`,
        );
      }
      redirects++;
      try {
        target = new URL(outcome.location, url).href;
      } catch {
        throw new SsrfError("en-tête Location invalide");
      }
      // RFC 9110 §15.4.4 : un 303 se suit en GET, quelle que soit la méthode
      // (sauf HEAD) ; 301/302 ne changent qu'un POST (§15.4.2-3, usage établi).
      const toGet =
        (outcome.status === 303 && method !== "GET" && method !== "HEAD") ||
        ((outcome.status === 301 || outcome.status === 302) &&
          method === "POST");
      const next: Record<string, string> = {};
      for (const [name, value] of Object.entries(headers)) {
        if (REDIRECT_STRIPPED.has(name)) continue;
        if (toGet && BODY_HEADERS.has(name)) continue;
        next[name] = value;
      }
      headers = next;
      if (toGet) {
        payload = null;
        method = "GET";
      }
    }
  } finally {
    clearTimeout(timer);
    state.current?.destroy();
  }
}
