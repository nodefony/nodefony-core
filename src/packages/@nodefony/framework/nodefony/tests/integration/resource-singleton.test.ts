/// <reference types="node" />
/**
 * Integration — POC API souveraine Phase 2 (V4.2 + V4.3 E2E).
 * Requires: server running on 5151 (HTTP) + 5151 (WS).
 * Start: /start-nodefony-server
 *
 * Prouve sur le serveur RÉEL :
 *  1. `ResourceController` singleton hérité : N requêtes → 1 instance.
 *  2. anti-data-race : requêtes CONCURRENTES (action async + délai) sur
 *     l'instance partagée → chaque body porte le requestId de SA requête
 *     (comparé au header `X-Request-Id` de la même réponse).
 *  3. souveraineté : la MÊME action (`detail`) répond en REST et via le pont
 *     WS-RPC `invoke` (path porté par le message) sans être réécrite.
 *  4. read-only : helpers d'écriture absents du service → 501 (pas un crash).
 */
import { expect } from "chai";
import http from "node:http";

const BASE = { hostname: "127.0.0.1", port: 5151 };
const TIMEOUT = 10_000;

type Res = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: unknown;
};

function get(path: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({ ...BASE, method: "GET", path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let body: unknown = raw;
        try {
          body = JSON.parse(raw);
        } catch {
          /* keep raw */
        }
        resolve({ status: res.statusCode!, headers: res.headers, body });
      });
    });
    r.on("error", reject);
    r.setTimeout(TIMEOUT, () => r.destroy(new Error("timeout")));
    r.end();
  });
}

describe("POC souverain — ResourceController singleton (V4.2/V4.3)", () => {
  it("REST list + filtrage explicite", async () => {
    const all = await get("/poc/r-books");
    expect(all.status).to.equal(200);
    expect((all.body as unknown[]).length).to.equal(3);
    const filtered = await get("/poc/r-books?authorId=42");
    expect((filtered.body as { id: string }[]).map((b) => b.id)).to.deep.equal([
      "b1",
      "b2",
    ]);
  });

  it("REST detail par id (auto-JSON de la valeur brute)", async () => {
    const res = await get("/poc/r-books/b3");
    expect(res.status).to.equal(200);
    expect((res.body as { title: string }).title).to.equal("Neuromancer");
  });

  it("singleton : N requêtes → 1 seule instance construite", async () => {
    await get("/poc/r-books");
    await get("/poc/r-books/b1");
    const s1 = await get("/poc/r-books/meta/stats");
    const s2 = await get("/poc/r-books/meta/stats");
    expect((s1.body as { instances: number }).instances).to.equal(1);
    expect((s2.body as { instances: number }).instances).to.equal(1);
  });

  it("anti-data-race : 8 requêtes concurrentes, chacune voit SON requestId", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => get("/poc/r-books/meta/stats?delay=30")),
    );
    const seen = new Set<string>();
    for (const res of results) {
      const body = res.body as { requestId: string; instances: number };
      // L'instance PARTAGÉE a lu, APRÈS 30 ms de concurrence, le requestId de
      // la bulle ALS de CETTE requête — il doit matcher le header X-Request-Id
      // posé par le pipeline pour la même réponse.
      expect(body.requestId).to.equal(res.headers["x-request-id"]);
      expect(body.instances).to.equal(1);
      seen.add(body.requestId);
    }
    expect(seen.size).to.equal(8);
  });

  it("la route vue par l'instance partagée est celle de la requête (ALS)", async () => {
    const res = await get("/poc/r-books/meta/stats");
    expect((res.body as { routeName: string }).routeName).to.equal(
      "poc-rbooks-stats",
    );
  });

  it("WS invoke : la MÊME action detail répond via le pont (souveraineté)", async () => {
    const ws = new WebSocket("ws://127.0.0.1:5151/poc/invoke");
    const messages: unknown[] = [];
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ws timeout")), TIMEOUT);
      ws.addEventListener("message", (e) => {
        const payload = JSON.parse(String(e.data)) as Record<string, unknown>;
        if (payload.handshake) {
          ws.send(JSON.stringify({ id: 7, path: "/poc/r-books/b2" }));
          return;
        }
        messages.push(payload);
        clearTimeout(timer);
        ws.close();
        resolve();
      });
      ws.addEventListener("error", () => reject(new Error("ws error")));
    });
    await done;
    const reply = messages[0] as {
      id: number;
      result: { id: string; title: string };
    };
    expect(reply.id).to.equal(7);
    expect(reply.result.title).to.equal("Hyperion");
  });

  it("WS invoke : 2 invokes sur la même socket (pointeur container corrigé)", async () => {
    const ws = new WebSocket("ws://127.0.0.1:5151/poc/invoke");
    const replies: { id: number; result?: { id: string } }[] = [];
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ws timeout")), TIMEOUT);
      ws.addEventListener("message", (e) => {
        const payload = JSON.parse(String(e.data)) as Record<string, unknown>;
        if (payload.handshake) {
          ws.send(JSON.stringify({ id: 1, path: "/poc/r-books/b1" }));
          return;
        }
        replies.push(payload as (typeof replies)[number]);
        if (replies.length === 1) {
          // 2e invoke sur la MÊME connexion : le pointeur "controller" du
          // container de connexion a été réécrit par le 1er — le garde-fou
          // instanceof d'executeAction doit re-résoudre PocInvokeController.
          ws.send(JSON.stringify({ id: 2, path: "/poc/r-books/b3" }));
          return;
        }
        clearTimeout(timer);
        ws.close();
        resolve();
      });
      ws.addEventListener("error", () => reject(new Error("ws error")));
    });
    await done;
    expect(replies[0].id).to.equal(1);
    expect(replies[0].result?.id).to.equal("b1");
    expect(replies[1].id).to.equal(2);
    expect(replies[1].result?.id).to.equal("b3");
  });

  it("read-only : POST sans create → 405 (méthode non déclarée sur la route)", async () => {
    const res = await new Promise<Res>((resolve, reject) => {
      const r = http.request(
        { ...BASE, method: "POST", path: "/poc/r-books" },
        (rs) => {
          const chunks: Buffer[] = [];
          rs.on("data", (c: Buffer) => chunks.push(c));
          rs.on("end", () =>
            resolve({
              status: rs.statusCode!,
              headers: rs.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      r.on("error", reject);
      r.end();
    });
    expect(res.status).to.equal(405);
  });
});
