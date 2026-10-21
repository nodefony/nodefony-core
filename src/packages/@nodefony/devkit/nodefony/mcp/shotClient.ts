import http from "node:http";

/** Délai d'une requête du tir, en ms : au-delà, elle compte « sans réponse ». */
export const SHOT_REQUEST_TIMEOUT_MS = 15_000;

/** Où l'application écoute, vue de son propre process. */
export interface IShotTarget {
  /** Adresse de connexion (boucle locale). */
  host: string;
  port: number;
  /** En-tête `Host` envoyé : le domaine que l'application attend. */
  hostHeader: string;
}

/** Une requête du tir. */
export interface IShotRequest {
  method: "GET" | "HEAD" | "POST";
  path: string;
  headers: Readonly<Record<string, string>>;
  /** Lire le corps de la réponse (connexion seulement ; un tir le jette). */
  readBody?: boolean | undefined;
}

/** Ce que le client retient d'une réponse. */
export interface IShotResponse {
  status: number;
  location: string | null;
  setCookie: readonly string[];
  body: string | null;
}

/** Le client d'UN tir : ses connexions vivent le temps de l'appel. */
export interface IShotClient {
  send(request: IShotRequest, signal: AbortSignal): Promise<IShotResponse>;
  /** Ferme les connexions gardées ouvertes ; les requêtes en vol échouent. */
  close(): void;
}

/**
 * Client `node:http` d'un tir : connexions gardées ouvertes entre deux requêtes,
 * comme un navigateur, au plus `concurrency` à la fois, toutes fermées par
 * `close()`. Un `fetch` passerait par un pool global, qui survivrait à l'appel.
 *
 * @param target - l'adresse d'écoute de l'application.
 * @param concurrency - connexions simultanées au plus.
 * @returns le client, à fermer en fin de tir.
 */
export function createShotClient(
  target: IShotTarget,
  concurrency: number,
): IShotClient {
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
  return {
    send(request, signal) {
      return new Promise<IShotResponse>((resolve, reject) => {
        const req = http.request({
          host: target.host,
          port: target.port,
          method: request.method,
          path: request.path,
          agent,
          signal,
          timeout: SHOT_REQUEST_TIMEOUT_MS,
          headers: { ...request.headers, host: target.hostHeader },
        });
        req.once("timeout", () => {
          req.destroy(new Error("délai de réponse dépassé"));
        });
        req.once("error", reject);
        req.once("response", (res) => {
          const chunks: Buffer[] | null = request.readBody ? [] : null;
          if (chunks === null) res.resume();
          else res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.once("error", reject);
          res.once("end", () => {
            const location = res.headers.location;
            resolve({
              status: res.statusCode ?? 0,
              location: typeof location === "string" ? location : null,
              setCookie: res.headers["set-cookie"] ?? [],
              body:
                chunks === null ? null : Buffer.concat(chunks).toString("utf8"),
            });
          });
        });
        req.end();
      });
    },
    close() {
      agent.destroy();
    },
  };
}

/**
 * Lit l'adresse d'écoute du serveur HTTP en clair de l'application (service
 * `server-http`), telle qu'il l'a réellement obtenue — port de repli compris.
 *
 * Une écoute sur toutes les interfaces (`0.0.0.0`, `::`) se joint par la boucle
 * locale : c'est aussi ce qui rend l'appel LOCAL pour la route de connexion du
 * profilage.
 *
 * @param server - ce que le conteneur rend pour `server-http`.
 * @returns la cible, ou `null` si aucun serveur n'est prêt.
 */
export function readShotTarget(server: unknown): IShotTarget | null {
  if (
    typeof server !== "object" ||
    server === null ||
    !("ready" in server) ||
    server.ready !== true ||
    !("port" in server) ||
    typeof server.port !== "number" ||
    server.port <= 0
  ) {
    return null;
  }
  const address =
    "address" in server && typeof server.address === "string"
      ? server.address
      : "";
  const host =
    address === "" || address === "0.0.0.0"
      ? "127.0.0.1"
      : address === "::"
        ? "::1"
        : address;
  const domain =
    "domain" in server &&
    typeof server.domain === "string" &&
    server.domain !== ""
      ? server.domain
      : host.includes(":")
        ? `[${host}]`
        : host;
  return { host, port: server.port, hostHeader: `${domain}:${server.port}` };
}
