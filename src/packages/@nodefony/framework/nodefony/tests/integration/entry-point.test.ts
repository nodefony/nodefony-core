/// <reference types="node" />
/**
 * Integration — `entryPoint` d'une zone (#548) : un visiteur anonyme qui
 * NAVIGUE vers une page protégée est conduit à la page de connexion.
 * Requires: server running on 5152 (https). Start: /start-server
 *
 * Décor : la zone `test-pages` (`src/modules/test/nodefony/config/config.ts`,
 * `entryPoint: "/login"`) et sa route témoin `/nodefony/test/page-guarded`
 * (GET, HEAD, POST et WEBSOCKET). Tout ce qui n'est pas une navigation garde son
 * 401 : une API, un `fetch()` ou une socket qui recevraient une page HTML de
 * connexion casseraient leur client.
 */
import { expect } from "vitest";
import https from "node:https";
import WebSocket from "ws";

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };
const PAGE = "/nodefony/test/page-guarded";
const TIMEOUT = 10_000;

type Res = { status: number; headers: Record<string, unknown> };

function request(
  path: string,
  headers: Record<string, string>,
  method = "GET",
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method, headers }, (res) => {
      res.resume();
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers }),
      );
    });
    req.setTimeout(TIMEOUT, () => req.destroy(new Error(`timeout ${path}`)));
    req.on("error", reject);
    req.end();
  });
}

/** Ce qu'envoie un navigateur qui ouvre la page (barre d'adresse, lien). */
const NAVIGATION = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
};

describe("entryPoint — la page protégée conduit le visiteur à la connexion", () => {
  it("une navigation anonyme reçoit 302 vers /login?from=<chemin>, sans défi", async () => {
    const res = await request(PAGE, NAVIGATION);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `/login?from=${encodeURIComponent(PAGE)}`,
    );
    expect(res.headers["www-authenticate"]).toBeUndefined();
  });

  it("la requête du chemin demandé voyage aussi", async () => {
    const res = await request(`${PAGE}?onglet=2`, NAVIGATION);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `/login?from=${encodeURIComponent(`${PAGE}?onglet=2`)}`,
    );
  });

  it("🔴 un appel d'API garde son 401 et son WWW-Authenticate", async () => {
    const res = await request(PAGE, { accept: "application/json" });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBeDefined();
    expect(res.headers.location).toBeUndefined();
  });

  it("🔴 un fetch() qui accepte du HTML n'est pas une navigation : 401", async () => {
    const res = await request(PAGE, {
      ...NAVIGATION,
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    });
    expect(res.status).toBe(401);
  });

  it("🔴 un POST garde son 401", async () => {
    const res = await request(
      PAGE,
      { ...NAVIGATION, "sec-fetch-site": "same-origin" },
      "POST",
    );
    expect(res.status).toBe(401);
    expect(res.headers.location).toBeUndefined();
  });

  it("🔴 une connexion WebSocket garde son refus", async () => {
    const outcome = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`wss://localhost:5152${PAGE}`, {
        rejectUnauthorized: false,
        headers: { accept: "text/html" },
      });
      ws.on("unexpected-response", (_req, res) =>
        resolve(`http ${String(res.statusCode)}`),
      );
      ws.on("close", (code) => resolve(`close ${String(code)}`));
      ws.on("error", () => undefined);
    });
    expect(outcome).not.toBe("http 302");
    expect(["http 401", "close 1008"]).toContain(outcome);
  });
});
