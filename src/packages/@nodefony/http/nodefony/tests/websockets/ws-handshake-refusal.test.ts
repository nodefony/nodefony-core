/// <reference types="node" />
/**
 * Integration — #596 : rien ne s'ouvre tant que le pipeline n'a pas dit oui.
 * Requires: server running on 5152 (wss). Start: /start-server
 *
 * Un refus décidé AVANT l'acceptation (pare-feu, origine, garde de l'action)
 * répond par un statut HTTP au handshake (RFC 6455 §4.2.2) — jamais par une
 * ouverture suivie d'une fermeture `1008`, qui faisait croire au client qu'il
 * était connecté. Le client `ws` est pris exprès : lui seul lit le statut d'un
 * handshake refusé (`unexpected-response`), ce que le `WebSocket` standard
 * cache. Le verdict porte donc sur le FIL, pas sur une interprétation.
 *
 * wss://5152 : le cookie `__Host-` n'existe qu'en contexte sécurisé.
 */
import { describe, expect, it } from "vitest";
import https from "node:https";
import tls from "node:tls";
import { drainTo } from "../helpers/scopeDrain.js";
import {
  handshake as handshakeAt,
  type HandshakeOutcome,
} from "../helpers/wsHandshake";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const WSS = "wss://127.0.0.1:5152";
const HUB = "/nodefony/studio/api/realtime";
const ECHO = "/nodefony/test/ws/echo";
const ADMIN_GUARDED = "/nodefony/test/api/admin-guarded";
const TIMEOUT = 10_000;

type Res = { status: number; headers: Record<string, unknown>; body: string };

function request(
  path: string,
  method: string,
  payload?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data =
      payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const req = https.request(
      {
        ...BASE,
        path,
        method,
        headers: data
          ? {
              "content-type": "application/json",
              "content-length": String(data.length),
            }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function loginCookie(identifier: string): Promise<string> {
  const res = await request("/nodefony/security/api/auth/login", "POST", {
    username: identifier,
    password: "secret-de-dev-42",
  });
  expect(res.status, `login ${identifier} attendu 200`).toBe(200);
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(typeof first).toBe("string");
  return (first as string).split(";")[0] as string;
}

async function liveScopes(): Promise<number> {
  const res = await request("/nodefony/test/als-test/scopes", "GET");
  return (JSON.parse(res.body) as { requestScopes: number }).requestScopes;
}

/** Handshake vers une route du serveur de test (cf `helpers/wsHandshake`). */
function handshake(
  path: string,
  headers: Record<string, string> = {},
): Promise<HandshakeOutcome> {
  return handshakeAt(`${WSS}${path}`, { headers });
}

function expectRefused(outcome: HandshakeOutcome, status: number): void {
  if (outcome.kind === "open") {
    outcome.ws.terminate();
    expect.fail(
      `handshake ouvert alors qu'un ${status} était attendu AVANT le 101`,
    );
  }
  expect(outcome.status).toBe(status);
}

describe("#596 — un refus se décide AVANT le 101 (requires server)", () => {
  it("anonyme vers une zone protégée → 401 + WWW-Authenticate, jamais d'ouverture", async () => {
    const outcome = await handshake(HUB);
    expectRefused(outcome, 401);
    if (outcome.kind === "refused")
      expect(
        outcome.headers["www-authenticate"],
        "le défi d'authentification accompagne le 401 (RFC 9110 §11.6.1)",
      ).toBeTypeOf("string");
  });

  it("origine étrangère → 403 au handshake (anti-CSWSH), jamais d'ouverture", async () => {
    expectRefused(
      await handshake(ECHO, { origin: "https://attaquant.example" }),
      403,
    );
  });

  it("connecté SANS le rôle exigé par l'action → 403 au handshake", async () => {
    const cookie = await loginCookie("user");
    expectRefused(await handshake(ADMIN_GUARDED, { cookie }), 403);
  });

  it("le rôle de la ZONE ne ferme pas le tuyau : un non-administrateur ouvre la socket de la console", async () => {
    // `Resolver._areaSecurity` : le filet de zone garde les MESSAGES, pas
    // l'ouverture. Juger les gardes avant le 101 ne doit pas la lui retirer.
    const cookie = await loginCookie("user");
    const outcome = await handshake(HUB, { cookie });
    expect(outcome.kind).toBe("open");
    if (outcome.kind === "open") outcome.ws.close();
  });

  it("connecté AVEC le rôle → la socket s'ouvre (la garde n'est pas un refus de principe)", async () => {
    const cookie = await loginCookie("admin");
    const outcome = await handshake(ADMIN_GUARDED, { cookie });
    expect(outcome.kind).toBe("open");
    if (outcome.kind === "open") outcome.ws.close();
  });

  it("connecté sur la zone protégée → ouverture puis welcome (non-régression)", async () => {
    const cookie = await loginCookie("admin");
    const outcome = await handshake(HUB, { cookie });
    expect(outcome.kind).toBe("open");
    if (outcome.kind !== "open") return;
    const welcome = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("pas de welcome")),
        TIMEOUT,
      );
      outcome.ws.on("message", (raw: Buffer) => {
        const frame = JSON.parse(String(raw)) as { method?: string };
        if (frame.method === "realtime:welcome") {
          clearTimeout(timer);
          resolve(frame);
        }
      });
    });
    outcome.ws.close();
    expect(welcome).toBeTruthy();
  });

  it("route publique, même origine → ouverture et écho (non-régression)", async () => {
    const outcome = await handshake(ECHO);
    expect(outcome.kind).toBe("open");
    if (outcome.kind !== "open") return;
    // L'action répond d'abord au handshake (`{"handshake":true}`), puis à
    // chaque message : on attend l'écho de CELUI-CI, pas la première trame.
    const echoed = await new Promise<string>((resolve) => {
      const onMessage = (raw: Buffer): void => {
        const text = String(raw);
        if (!text.includes("ping-596")) return;
        outcome.ws.off("message", onMessage);
        resolve(text);
      };
      outcome.ws.on("message", onMessage);
      outcome.ws.send("ping-596");
    });
    outcome.ws.close();
    expect(echoed).toContain("ping-596");
  });

  /**
   * La SONDE : le navigateur cache le statut d'un handshake refusé (le code ne
   * voit qu'un échec, comme pour un serveur éteint). Le client pose alors une
   * requête HTTP ordinaire sur l'adresse de la socket, et le serveur répond ce
   * que le handshake aurait décidé — le pare-feu AVANT le 426 du routeur.
   */
  it("sonde : GET anonyme sur la socket protégée → 401 sans en-tête Upgrade", async () => {
    const res = await request(HUB, "GET");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBeTypeOf("string");
    expect(
      res.headers["upgrade"],
      "un refus n'invite pas à l'upgrade",
    ).toBeUndefined();
    expect(res.headers["connection"]).not.toBe("Upgrade");
  });

  it("sonde : GET connecté sur la socket protégée → 426 + Upgrade: websocket (admis)", async () => {
    const cookie = await loginCookie("admin");
    const res = await new Promise<Res>((resolve, reject) => {
      const req = https.request(
        { ...BASE, path: HUB, method: "GET", headers: { cookie } },
        (r) => {
          r.resume();
          r.on("end", () =>
            resolve({
              status: r.statusCode ?? 0,
              headers: r.headers,
              body: "",
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(res.status).toBe(426);
    expect(res.headers["upgrade"]).toBe("websocket");
  });

  it("sonde : GET sur une socket publique → 426 tout de suite (chemin inchangé)", async () => {
    const res = await request(ECHO, "GET");
    expect(res.status).toBe(426);
    expect(res.headers["upgrade"]).toBe("websocket");
  });

  it("vingt refus ne laissent aucun scope de requête ouvert", async () => {
    const before = await liveScopes();
    for (let i = 0; i < 20; i++) expectRefused(await handshake(HUB), 401);
    expect(await drainTo(liveScopes, before, 1)).toBeLessThan(1);
  });

  it("un client qui part pendant la décision ne fait ni tomber le serveur ni fuir un scope", async () => {
    const before = await liveScopes();
    const raw = (reset: boolean) =>
      new Promise<void>((resolve) => {
        const socket = tls.connect({ ...BASE, servername: "localhost" }, () => {
          socket.write(
            `GET ${HUB} HTTP/1.1\r\nHost: 127.0.0.1:5152\r\n` +
              "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
              "Sec-WebSocket-Version: 13\r\n" +
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
            () => {
              if (reset) socket.destroy(new Error("coupure"));
              else socket.end();
              resolve();
            },
          );
        });
        socket.on("error", () => resolve());
      });
    for (let i = 0; i < 20; i++) await raw(i % 2 === 0);
    // Le serveur répond encore : aucune erreur de socket n'a fait tomber le process.
    expect(
      (await request("/nodefony/test/als-test/scopes", "GET")).status,
    ).toBe(200);
    expect(await drainTo(liveScopes, before, 1)).toBeLessThan(1);
  });
});
