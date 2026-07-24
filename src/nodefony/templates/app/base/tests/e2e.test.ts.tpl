import { execFileSync } from "node:child_process";
import path from "node:path";
import { readRuntimeState } from "nodefony";
<% if (it.complete) { %>// La façade temps réel isomorphe — côté Node, subpath `nodefony/client`.
import { RealtimeClient } from "nodefony/client";
<% } %>import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Test E2E — boote l'app RÉELLE (mode production) et lui parle en HTTP + WebSocket.
 *
 * Seule porte d'entrée : `npm run test:e2e` (build d'abord : un serveur spawné
 * valide le DIST, pas le source). Ce fichier est EXCLU de `vitest.config.ts` et
 * ciblé par `vitest.e2e.config.ts` — invoqué, il tourne TOUJOURS : pas de gate
 * d'environnement qui l'afficherait « skipped » dans un rapport vert.
 * La mécanique est 100 % native Nodefony :
 *   - `nodefony production --detach --wait` : lancement détaché, exit 0 seulement
 *     quand la readiness est sondée (ports ouverts) — aucun sleep arbitraire.
 *   - `nodefony stop` : arrêt propre de tout runtime de l'app.
 * Client WebSocket = `WebSocket` NATIF Node (≥ 22) — zéro dépendance de test.
 *
 * Le port n'est PAS écrit en dur : le serveur publie ses ports effectifs
 * (`readRuntimeState`) — un test qui suppose 5151 casse dès que l'app déclare son
 * port (`NF_PORT`, `PORT` en PaaS) ou qu'un port occupé l'a fait glisser en dev.
 */
const bin = path.resolve("node_modules/.bin/nodefony");
let BASE = "http://127.0.0.1:5151";
let WS_BASE = "ws://127.0.0.1:5151";

describe("e2e — l'app boote et répond (HTTP + WS)", () => {
  beforeAll(() => {
    execFileSync(bin, ["production", "--detach", "--wait"], {
      stdio: "inherit",
      timeout: 120_000,
    });
    // `--wait` n'est sorti que serveur PRÊT : ses ports sont publiés. Le premier
    // est celui du serveur en clair (une app TLS-only adaptera ces deux lignes).
    const port = readRuntimeState(process.cwd())?.ports[0] ?? 5151;
    BASE = `http://127.0.0.1:${port}`;
    WS_BASE = `ws://127.0.0.1:${port}`;
  }, 130_000);

  afterAll(() => {
    execFileSync(bin, ["stop"], { stdio: "inherit", timeout: 30_000 });
  });

  it("GET /api/hello → 200 + payload JSON", async () => {
    const res = await fetch(`${BASE}/api/hello`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hello: string; pid: number };
    expect(body.hello).toBe("<%= it.appName %>");
    expect(body.pid).toBeGreaterThan(0);
  });

  it("WS /api/echo → echo du message (même controller que le HTTP)", async () => {
    const ws = new WebSocket(`${WS_BASE}/api/echo`);
    const echoed = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout WS 10s")), 10_000);
      ws.addEventListener("open", () => ws.send("ping-e2e"));
      ws.addEventListener("message", (event) => {
        const data = JSON.parse(String(event.data)) as { echo?: string };
        // Le handshake du controller peut répondre d'abord — on attend l'echo.
        if (data.echo !== undefined) {
          clearTimeout(timer);
          resolve(data);
        }
      });
      ws.addEventListener("error", () => reject(new Error("erreur WS")));
    });
    ws.close();
    expect(echoed).toEqual({ echo: "ping-e2e" });
  });

  it("probe cloud-native /livez → 200 (celle qu'interroge k8s)", async () => {
    const res = await fetch(`${BASE}/livez`);
    expect(res.status).toBe(200);
  });
<% if (it.complete) { %>
  it("realtime — RPC live:ping + canal live:ticker par la FAÇADE", async () => {
    // La MÊME façade que les vitrines navigateur — zéro `ws` à la main.
    const live = new RealtimeClient({ url: `${WS_BASE}/api/live/realtime` });
    try {
      // Listener posé AVANT subscribe : le provider démarre au 1ᵉʳ abonné.
      const tickP = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("timeout tick 10s")),
          10_000,
        );
        live.on("live:ticker", (msg) => {
          clearTimeout(timer);
          resolve(msg);
        });
      });
      await live.connect();
      // Action OUVERTE ({ authenticated: false }) — répond même anonyme.
      const pong = (await live.request("live:ping", {})) as { pong: boolean };
      expect(pong.pong).toBe(true);
      // Canal libre : 1 tick/s tant qu'au moins un client est abonné.
      live.subscribe("live:ticker");
      const tick = (await tickP) as { n: number; pid: number };
      expect(tick.n).toBeGreaterThan(0);
      expect(tick.pid).toBeGreaterThan(0);
    } finally {
      // Le nettoyage vit dans le `finally` : une assertion qui tombe ne doit
      // jamais laisser une socket ouverte derrière le run.
      live.disconnect();
    }
  }, 15_000);
<% } %>});
