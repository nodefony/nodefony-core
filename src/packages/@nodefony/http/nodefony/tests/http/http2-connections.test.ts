/// <reference types="node" />
/**
 * Gestion des connexions HTTP/2 sur le serveur RÉEL (#770) — le branchement
 * de `manageHttp2Connections` dans les DEUX serveurs HTTP/2 : TLS (5152) et
 * h2c (5153). L'app de banc arme `http2.minPingInterval` et
 * `http2.keepaliveInterval` (`nodefony/config/http.ts`).
 *
 * La règle elle-même (âge, grâce, keepalive, police des PING) se prouve en
 * process, pas à pas : `tests/unit/http2Connections.test.ts`. Ici, seulement
 * ce que le serveur de l'application FAIT de sa config.
 *
 * Débrancher l'appel à `manageHttp2Connections` dans `server-https.ts` ou
 * `server-h2c.ts` fait tomber le cas du port concerné.
 */
import { expect } from "vitest";
import http2 from "node:http2";
import { IS_PROD_TARGET } from "../helpers/targetEnv";

const H2 = "https://localhost:5152";
const H2C = "http://localhost:5153";
const TLS = { rejectUnauthorized: false } as const;

interface IGoaway {
  code: number;
  data: string;
}

/** Ouvre une session et attend les réglages du serveur. */
function open(url: string): Promise<http2.ClientHttp2Session> {
  return new Promise((resolve, reject) => {
    const session = http2.connect(url, url.startsWith("https") ? TLS : {});
    session.once("error", reject);
    session.once("remoteSettings", () => {
      session.removeListener("error", reject);
      session.on("error", () => {});
      resolve(session);
    });
  });
}

/** Une rafale de PING sans rien demander entre eux, puis le GOAWAY reçu. */
async function burstPings(url: string): Promise<IGoaway> {
  const session = await open(url);
  const announced = new Promise<IGoaway>((resolve) =>
    session.once("goaway", (code, _last, data) =>
      resolve({ code, data: data?.toString() ?? "" }),
    ),
  );
  const closed = new Promise<void>((r) => session.once("close", () => r()));
  for (let i = 0; i < 4; i++) session.ping(() => {});
  const goaway = await announced;
  await closed;
  return goaway;
}

/**
 * Témoin : cinq PING espacés par une requête — le serveur écrit entre eux.
 * Sans la remise à zéro de gRPC A8 (trame écrite = compte effacé), le 4ᵉ
 * dépasserait les 2 fautes tolérées : ce témoin la prouve aussi, TLS compris.
 */
async function pingsBetweenRequests(url: string): Promise<boolean> {
  const session = await open(url);
  try {
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve, reject) =>
        session.ping((err) => (err ? reject(err) : resolve())),
      );
      await new Promise<void>((resolve, reject) => {
        const req = session.request({ ":path": "/livez" });
        req.on("error", reject);
        req.on("end", () => resolve());
        req.resume();
      });
    }
    return session.closed;
  } finally {
    await new Promise<void>((r) => session.close(() => r()));
  }
}

const TOO_MANY_PINGS: IGoaway = {
  code: http2.constants.NGHTTP2_ENHANCE_YOUR_CALM,
  data: "too_many_pings",
};

describe("connexions HTTP/2 — TLS 5152 (requires server)", () => {
  it("rafale de PING : GOAWAY ENHANCE_YOUR_CALM « too_many_pings », session fermée", async () => {
    expect(await burstPings(H2)).to.deep.equal(TOO_MANY_PINGS);
  });

  it("témoin : des PING entrecoupés de réponses ne sont jamais punis (gRPC A8)", async () => {
    expect(await pingsBetweenRequests(H2)).to.equal(false);
  });
});

describe.skipIf(IS_PROD_TARGET)(
  "connexions HTTP/2 — h2c 5153 (requires server)",
  () => {
    it("rafale de PING : GOAWAY ENHANCE_YOUR_CALM « too_many_pings », session fermée", async () => {
      expect(await burstPings(H2C)).to.deep.equal(TOO_MANY_PINGS);
    });

    it("témoin : des PING entrecoupés de réponses ne sont jamais punis (gRPC A8)", async () => {
      expect(await pingsBetweenRequests(H2C)).to.equal(false);
    });
  },
);
