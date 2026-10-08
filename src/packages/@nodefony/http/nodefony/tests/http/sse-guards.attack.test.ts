/// <reference types="node" />
import { expect } from "vitest";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import WebSocket from "ws";
import { SseParser, type ISseEvent } from "nodefony/client";
import { IS_PROD_TARGET } from "../helpers/targetEnv";

/**
 * RED-TEAM #568 — un flux SSE porte les MÊMES gardes qu'une socket WebSocket,
 * sur le serveur réel : plafond de connexions par IP (un seul budget pour les
 * deux transports), fermeture à la révocation de l'identité, pare-feu et CSRF
 * de la zone, coupure du lecteur qui ne lit plus, borne de taille d'un
 * événement, durée de vie.
 *
 * Décor : le plafond est posé À CHAUD par la voie produit
 * (`PATCH /nodefony/kernel/api/config/http`, compte admin), puis remis à `null`
 * à la fin. Requires: server running (5151 + 5152). Start: /start-server.
 */

const H1 = "http://localhost:5151";
const TLS = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const SSE = "/nodefony/test/sse";
const SECURE = "/nodefony/test/secure/sse/hold";
const LOGIN = "/nodefony/security/api/auth/login";
const LOGOUT = "/nodefony/security/api/auth/logout";
const CONFIG = "/nodefony/kernel/api/config/http";
const PASSWORD = "secret-de-dev-42";

interface IJson {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

/** Requête JSON sur 5152 (le cookie de session `__Host-` exige TLS). */
function call(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<IJson> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const h: Record<string, string> = { ...headers };
    if (payload !== undefined) {
      h["content-type"] = "application/json";
      h["content-length"] = String(Buffer.byteLength(payload));
    }
    const req = https.request({ ...TLS, method, path, headers: h }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (raw += c));
      res.on("end", () => {
        let parsed: unknown = raw;
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* texte brut */
        }
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: parsed,
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(10_000, () => req.destroy(new Error("http timeout")));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function login(username: string): Promise<string> {
  const res = await call("POST", LOGIN, {}, { username, password: PASSWORD });
  expect(res.status, `login ${username}`).to.equal(200);
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(first, "cookie de session").to.be.a("string");
  return (first as string).split(";")[0] as string;
}

/** Un flux tenu ouvert : statut, événements reçus, fin observée. */
interface IStream {
  status: number;
  events: ISseEvent[];
  ended: Promise<void>;
  close(): void;
}

/**
 * Ouvre un flux et attend sa PREMIÈRE réponse : l'événement `ready` d'un flux
 * accepté, ou la fin d'une réponse refusée.
 */
function open(
  url: string,
  options: {
    headers?: Record<string, string>;
    method?: string;
    tls?: boolean;
  } = {},
): Promise<IStream> {
  return new Promise((resolve, reject) => {
    const events: ISseEvent[] = [];
    let endedResolve!: () => void;
    const ended = new Promise<void>((r) => (endedResolve = r));
    const onResponse = (res: http.IncomingMessage): void => {
      const status = res.statusCode ?? 0;
      const stream: IStream = {
        status,
        events,
        ended,
        close: () => req.destroy(),
      };
      const parser = new SseParser({
        onEvent: (e) => {
          events.push(e);
          if (e.type === "ready") resolve(stream);
        },
      });
      res.setEncoding("utf8");
      res.on("data", (c: string) => parser.push(c));
      res.on("end", endedResolve);
      res.on("close", endedResolve);
      if (status !== 200) {
        res.resume();
        resolve(stream);
      }
    };
    const init = {
      method: options.method ?? "GET",
      headers: { accept: "text/event-stream", ...options.headers },
    };
    const req = options.tls
      ? https.request({ ...TLS, ...init, path: url }, onResponse)
      : http.request(
          url.startsWith("http") ? url : `${H1}${url}`,
          init,
          onResponse,
        );
    req.on("error", (e) => {
      endedResolve();
      reject(e);
    });
    req.end();
  });
}

/** La fin d'un flux survient-elle avant `ms` ? */
async function endsWithin(stream: IStream, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>(
    (r) => (timer = setTimeout(() => r(false), ms)),
  );
  const result = await Promise.race([stream.ended.then(() => true), timeout]);
  clearTimeout(timer);
  return result;
}

const state = async (): Promise<{ opened: number; closed: number }> =>
  (await call("GET", `${SSE}/state`)).body as {
    opened: number;
    closed: number;
  };

describe("RED-TEAM #568 — gardes d'un flux SSE, parité WebSocket (requires server)", () => {
  let admin = "";
  const streams: IStream[] = [];
  const sockets: WebSocket[] = [];
  const track = (s: IStream): IStream => (streams.push(s), s);

  const patch = (path: string, value: unknown) =>
    call("PATCH", CONFIG, { cookie: admin }, { path, value });

  beforeAll(async () => {
    admin = await login("admin");
  });

  afterEach(async () => {
    for (const s of streams.splice(0)) s.close();
    for (const ws of sockets.splice(0)) ws.terminate();
    await call("GET", `${SSE}/reset`);
  });

  // En production, la config est IMMUABLE (12-factor) : le plafond ne se pose
  // pas à chaud, et ce bloc n'a pas de décor. Le cas ci-dessous constate ce
  // refus — un saut qui s'appuie sur un fait observé, pas sur une supposition.
  describe.runIf(IS_PROD_TARGET)("plafond par IP — cible production", () => {
    it("le plafond ne se pose pas à chaud : 409 prod_immutable", async () => {
      const r = await patch("wsMaxConnectionsPerIp", 50);
      expect(r.status).to.equal(409);
      expect(JSON.stringify(r.body)).to.include("prod_immutable");
    });
  });

  describe.skipIf(IS_PROD_TARGET)(
    "plafond par IP (wsMaxConnectionsPerIp), un budget pour deux transports",
    () => {
      afterAll(async () => {
        // Le décor À CHAUD se défait même si un cas a échoué : sinon les bancs
        // suivants tourneraient sous un plafond de 2 connexions.
        await patch("wsMaxConnectionsPerIp", null);
      });

      // `trustProxy` ne s'édite qu'au démarrage : le banc ne peut pas se donner
      // une IP à lui. Il partage donc 127.0.0.1 avec ce qui est déjà ouvert (un
      // onglet sur l'application) — d'où un plafond large, et des preuves qui ne
      // dépendent pas de ce qui occupait déjà le budget : on remplit jusqu'au
      // refus, puis on observe ce qu'une place rendue permet.
      const CAP = 50;
      const H1V4 = "http://127.0.0.1:5151";

      /** Ouvre des flux jusqu'au premier refus ; rend le refus. */
      async function fill(): Promise<IStream> {
        for (let i = 0; i <= CAP; i++) {
          const s = track(await open(`${H1V4}${SSE}/hold`));
          if (s.status !== 200) return s;
        }
        throw new Error(`aucun refus après ${CAP + 1} flux`);
      }

      /** Ferme un flux accepté et attend que le serveur ait vu la fermeture. */
      async function release(): Promise<void> {
        const before = (await state()).closed;
        const accepted = streams.find((s) => s.status === 200);
        if (accepted === undefined)
          throw new Error("aucun flux accepté à fermer");
        streams.splice(streams.indexOf(accepted), 1);
        accepted.close();
        for (let i = 0; i < 100 && (await state()).closed <= before; i++) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }

      beforeAll(async () => {
        expect(
          (await patch("wsMaxConnectionsPerIp", CAP)).status,
          "plafond",
        ).to.equal(200);
      });

      it("V30 · au-delà du plafond, un flux SSE est refusé en 429 — sans un octet de flux", async () => {
        const refused = await fill();
        expect(refused.status).to.equal(429);
        expect(refused.events).to.have.length(0);
      });

      it("V30 · la place est RENDUE quand le client part", async () => {
        await fill();
        await release();
        expect(track(await open(`${H1V4}${SSE}/hold`)).status).to.equal(200);
      });

      it("V31 · une socket WebSocket et un flux SSE partagent le MÊME budget", async () => {
        await fill();
        await release();
        // La place rendue par un flux SSE, une socket WebSocket la prend…
        const ws = new WebSocket("ws://127.0.0.1:5151/nodefony/test/ws/echo");
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => {
          ws.once("open", () => resolve());
          ws.once("error", reject);
        });
        // … et le flux SSE suivant ne la retrouve pas.
        expect(track(await open(`${H1V4}${SSE}/hold`)).status).to.equal(429);
      });
    },
  );

  describe("zone protégée : pare-feu, CSRF, révocation", () => {
    it("V32 · un anonyme n'ouvre pas de flux dans une zone protégée (401)", async () => {
      const s = track(await open(SECURE, { tls: true }));
      expect(s.status).to.equal(401);
      expect(s.events).to.have.length(0);
    });

    it("V33 · un POST de flux venu d'un autre site est refusé par le CSRF (403)", async () => {
      const cookie = await login("user");
      const s = track(
        await open(SECURE, {
          tls: true,
          method: "POST",
          headers: {
            cookie,
            origin: "https://evil.example",
            "sec-fetch-site": "cross-site",
          },
        }),
      );
      expect(s.status).to.equal(403);
    });

    it("V33 · contrôle positif : le même POST, même origine, ouvre le flux", async () => {
      const cookie = await login("user");
      const s = track(
        await open(SECURE, {
          tls: true,
          method: "POST",
          headers: { cookie, "sec-fetch-site": "same-origin" },
        }),
      );
      expect(s.status).to.equal(200);
    });

    it("V34 · déconnexion → le flux est fermé à la re-validation suivante", async () => {
      const cookie = await login("user");
      const s = track(await open(SECURE, { tls: true, headers: { cookie } }));
      expect(s.status).to.equal(200);
      expect((await call("POST", LOGOUT, { cookie })).status).to.be.oneOf([
        200, 204,
      ]);
      await call("GET", `${SSE}/revalidate`);
      expect(
        await endsWithin(s, 2_000),
        "flux fermé après révocation",
      ).to.equal(true);
    });

    it("V34 · contrôle positif : une session VIVANTE garde son flux à la re-validation", async () => {
      const cookie = await login("user");
      const s = track(await open(SECURE, { tls: true, headers: { cookie } }));
      await call("GET", `${SSE}/revalidate`);
      expect(await endsWithin(s, 500), "flux intact").to.equal(false);
    });
  });

  describe("bornes d'un flux", () => {
    /**
     * Un client qui ouvre un flux et ne lit PLUS rien : le serveur écrit
     * jusqu'à remplir les tampons, puis attend un `drain` qui ne vient jamais.
     */
    function stalledReader(path: string): net.Socket {
      const socket = net.connect(5151, "127.0.0.1", () => {
        socket.write(
          `GET ${path} HTTP/1.1\r\nHost: localhost:5151\r\nAccept: text/event-stream\r\n\r\n`,
        );
        socket.pause();
      });
      socket.on("error", () => {});
      return socket;
    }

    async function closedWithin(ms: number): Promise<boolean> {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if ((await state()).closed >= 1) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    }

    it("V35 · un lecteur qui ne lit plus est COUPÉ après stallTimeout", async () => {
      const socket = stalledReader(`${SSE}/limits?stall=300&flood=1`);
      try {
        expect(await closedWithin(5_000), "flux coupé").to.equal(true);
      } finally {
        socket.destroy();
      }
    });

    it("V35 · contrôle positif : sans délai court, le même lecteur n'est pas coupé tout de suite", async () => {
      const socket = stalledReader(`${SSE}/limits?stall=60000&flood=1`);
      try {
        expect(await closedWithin(1_500), "flux encore ouvert").to.equal(false);
      } finally {
        socket.destroy();
      }
    });

    it("V36 · un événement plus gros que maxEventBytes est refusé, rien n'est écrit", async () => {
      const s = track(
        await open(`${SSE}/limits?max=1000&big=2000&duration=200`),
      );
      await s.ended;
      const refused = s.events.find((e) => e.type === "refused");
      expect(refused?.data).to.equal("RangeError");
      expect(s.events.some((e) => e.data.length >= 2000)).to.equal(false);
    });

    it("V36 · contrôle positif : un événement sous la borne part", async () => {
      const s = track(
        await open(`${SSE}/limits?max=1000&big=500&duration=200`),
      );
      await s.ended;
      expect(s.events.some((e) => e.data.length === 500)).to.equal(true);
      expect(s.events.some((e) => e.type === "refused")).to.equal(false);
    });

    it("V37 · maxDuration ferme le flux de lui-même", async () => {
      const s = track(await open(`${SSE}/limits?duration=150`));
      expect(await endsWithin(s, 2_000)).to.equal(true);
    });
  });
});
