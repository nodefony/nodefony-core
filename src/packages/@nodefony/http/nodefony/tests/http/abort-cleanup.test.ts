/// <reference types="node" />
import { expect } from "chai";
import https from "node:https";
import {
  compteDansJournal,
  journalDuServeur,
  type IJournalServeur,
} from "../helpers/serverLog";

// Regression coverage for the "Response Already sended" CRITIC noise that
// fired on /abort/wait when the client closed the socket while the
// controller was still waiting on its AbortSignal.
//
// Race:
//   1. response "close" → http-kernel.onClose → _abortIfPending + teardown
//      (flips `context.finished = true` and logs the request).
//   2. Controller's signal listener rejects → catch → renderJson(...).
//   3. HttpContext.send sees `finished === true` and used to throw
//      "Response Already sended" → onError tried to render → re-throw → CRITIC.
//
// Expected after the fix: 0 CRITIC, server stays healthy, abortedCount
// matches the number of aborted requests we issued.

const BASE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

function getJson(path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...BASE, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode!, body: raw });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// Fires GET /abort/wait and destroys the socket after `abortAfterMs`.
// Resolves once the socket is torn down. The route waits 2s server-side,
// so any abortAfterMs < 2000 triggers the race.
function abortedGet(path: string, abortAfterMs: number): Promise<void> {
  return new Promise((resolve) => {
    const req = https.request({ ...BASE, path, method: "GET" }, (res) => {
      res.resume();
    });
    req.on("error", () => resolve());
    req.on("close", () => resolve());
    req.end();
    setTimeout(() => req.destroy(), abortAfterMs);
  });
}

describe("Abort cleanup — no CRITIC on client disconnect (requires server)", () => {
  // 🔴 Le journal se DÉCOUVRE (cf `helpers/serverLog`). Le chemin en dur qui
  // vivait ici rendait un faux VERT : l'assertion est NÉGATIVE (« aucun CRITIC »),
  // et un fichier figé n'en contient évidemment aucun — la garde passait sans
  // avoir rien lu du serveur sous test.
  let journal: IJournalServeur | null = null;

  beforeAll(async () => {
    journal = await journalDuServeur(BASE);
    // Reset server-side counters so the assertion is deterministic.
    await getJson("/nodefony/test/abort/reset");
  });

  it("10 client aborts mid-wait → server stays alive, no Response Already sended", async (ctx) => {
    const N = 10;
    await Promise.all(
      Array.from({ length: N }, () =>
        abortedGet("/nodefony/test/abort/wait", 100),
      ),
    );
    // Let teardown handlers and the controller's catch settle.
    await new Promise((r) => setTimeout(r, 500));

    // Server still serves requests.
    const health = await getJson("/nodefony/test/index");
    expect(health.status).to.equal(200);

    // All aborts were observed by the controller.
    const state = await getJson("/nodefony/test/abort/state");
    expect(state.status).to.equal(200);
    expect(state.body.abortedCount).to.equal(N);
    expect(state.body.completedCount).to.equal(0);

    // Best-effort: the kernel log MUST NOT contain the "Response Already
    // sended" CRITIC line for these aborts. Skip silently if the log file is
    // not accessible (e.g. CI runs without the dev launcher).
    if (journal === null) {
      ctx.skip(
        "aucun journal alimenté par le serveur sous test — l'absence de CRITIC " +
          "n'aurait rien prouvé",
      );
      return;
    }
    const count = compteDansJournal(
      journal,
      /CRITIC HttpKernel\s*:.*Response Already sended/,
    );
    expect(count, `journal ${journal.chemin} illisible`).to.be.at.least(0);
    expect(
      count,
      "aucune ligne CRITIC 'Response Already sended' attendue",
    ).to.equal(0);
  });

  it("burst of 20 aborts then a clean request — counters consistent", async () => {
    await getJson("/nodefony/test/abort/reset");
    const N = 20;
    await Promise.all(
      Array.from({ length: N }, () =>
        abortedGet("/nodefony/test/abort/wait", 80),
      ),
    );
    await new Promise((r) => setTimeout(r, 500));

    const state = await getJson("/nodefony/test/abort/state");
    expect(state.body.abortedCount).to.equal(N);

    const ok = await getJson("/nodefony/test/index");
    expect(ok.status).to.equal(200);
  });
});
