import { execFileSync } from "node:child_process";
import path from "node:path";
import { readRuntimeState } from "nodefony";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

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
});
