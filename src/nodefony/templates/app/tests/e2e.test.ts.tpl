import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Test E2E — boote l'app RÉELLE (mode production) et lui parle en HTTP + WebSocket.
 *
 * Opt-in via `npm run test:e2e` (build d'abord : un serveur spawné valide le DIST,
 * pas le source). La mécanique est 100 % native Nodefony :
 *   - `nodefony production --detach --wait` : lancement détaché, exit 0 seulement
 *     quand la readiness est sondée (ports ouverts) — aucun sleep arbitraire.
 *   - `nodefony stop` : arrêt propre de tout runtime de l'app.
 * Client WebSocket = `WebSocket` NATIF Node (≥ 22) — zéro dépendance de test.
 */
const RUN = !!process.env["RUN_E2E"];
const bin = path.resolve("node_modules/.bin/nodefony");
const BASE = "http://127.0.0.1:5151";

(RUN ? describe : describe.skip)("e2e — l'app boote et répond (HTTP + WS)", () => {
  beforeAll(() => {
    execFileSync(bin, ["production", "--detach", "--wait"], {
      stdio: "inherit",
      timeout: 120_000,
    });
  }, 130_000);

  afterAll(() => {
    execFileSync(bin, ["stop"], { stdio: "inherit", timeout: 30_000 });
  });

  it("GET /api/hello → 200 + payload JSON", async () => {
    const res = await fetch(`${BASE}/api/hello`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hello: string; pid: number };
    expect(body.hello).toBe("{{appName}}");
    expect(body.pid).toBeGreaterThan(0);
  });

  it("WS /api/echo → echo du message (même controller que le HTTP)", async () => {
    const ws = new WebSocket("ws://127.0.0.1:5151/api/echo");
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
