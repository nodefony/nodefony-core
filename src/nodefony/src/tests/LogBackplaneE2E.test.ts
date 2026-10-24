/// <reference types="node" />
import { describe, it, beforeAll, assert } from "vitest";
import { randomUUID } from "node:crypto";
import Pdu from "../syslog/Pdu";
import { createLokiLogDriver } from "../syslog/drivers/LokiLogDriver";
import { createOpenSearchLogDriver } from "../syslog/drivers/OpenSearchLogDriver";
import { LokiTransport } from "../syslog/transports/LokiTransport";
import { OpenSearchTransport } from "../syslog/transports/OpenSearchTransport";
import type { ILogQueryResult } from "../syslog/drivers/ILogDriver";
import { captureJsonLines } from "./logCapture";

// ── E2E RÉEL — loki / opensearch contre un VRAI serveur (gated) ────────────────
//
// LogBackplaneHttp.test.ts prouve le FORMAT (LogQL / _search / bulk) avec un fetch
// MOCKÉ. Ce fichier prouve qu'un vrai Loki / OpenSearch l'ACCEPTE : push réel →
// ingestion → relecture par NOTRE driver → round-trip write↔read. C'est le seul
// test qui attrape un rejet du serveur (labels, fenêtre de timestamps, mapping).
//
// Gated (cf scripts/test/vitest/gates.ts LOKI_GATE / OPENSEARCH_GATE) : SKIP sans l'URL. Décor :
//   docker compose -f docker/docker-compose.yml --profile loki --profile opensearch up -d loki opensearch
//   NF_LOKI_TEST_URL=http://127.0.0.1:3100 NF_OPENSEARCH_TEST_URL=http://127.0.0.1:9200 \
//     npx vitest run src/tests/LogBackplaneE2E.test.ts
//
// Isolation : les volumes persistent d'un run à l'autre → chaque run tague ses Pdu
// d'un `requestId` UNIQUE et ne relit QUE ceux-là (fenêtre temporelle serrée +
// filtre requestId). Aucune purge, aucune collision inter-runs.

const LOKI_URL = process.env.NF_LOKI_TEST_URL?.trim();
const OS_URL = process.env.NF_OPENSEARCH_TEST_URL?.trim();

/** Un Pdu daté « maintenant » (Loki rejette les timestamps trop vieux/futurs). */
const mk = (
  payload: string,
  severity: string,
  reqId: string,
  ts: number,
): Pdu => {
  const pdu = new Pdu(payload, severity as never, "E2E", "BACKPLANE", "", ts);
  pdu.requestId = reqId;
  return pdu;
};

/** Rejoue une query jusqu'à ce que le prédicat passe (ingestion/refresh async). */
async function poll(
  run: () => Promise<ILogQueryResult>,
  ok: (r: ILogQueryResult) => boolean,
  tries = 30,
  delayMs = 500,
): Promise<ILogQueryResult> {
  let last: ILogQueryResult = { rows: [], total: 0, truncated: false };
  for (let i = 0; i < tries; i++) {
    last = await run();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

describe.skipIf(!LOKI_URL)("Log Backplane E2E — Loki réel", () => {
  const reqId = `e2e-loki-${randomUUID()}`;
  const t0 = Date.now();

  beforeAll(async () => {
    const transport = new LokiTransport({ url: LOKI_URL! });
    // 3 Pdu, deux sévérités — timestamps « maintenant », espacés pour l'ordre.
    await transport.send(mk("loki-alpha", "INFO", reqId, t0));
    await transport.send(mk("loki-bravo", "ERROR", reqId, t0 + 1));
    await transport.send(mk("loki-charlie", "INFO", reqId, t0 + 2));
    await transport.close(); // flush → push HTTP réel
  });

  it("push → ingestion → relecture (write↔read cohérents)", async () => {
    const driver = createLokiLogDriver({ url: LOKI_URL! });
    const r = await poll(
      () =>
        driver.query!({ from: t0 - 5_000, to: t0 + 60_000, requestId: reqId }),
      (r) => r.total >= 3,
    );
    assert.strictEqual(r.total, 3, "les 3 Pdu poussés doivent revenir");
    // Récent d'abord, payload et requestId intacts après aller-retour Loki.
    assert.strictEqual(r.rows[0]!.payload, "loki-charlie");
    assert.strictEqual(r.rows[0]!.requestId, reqId);
  });

  describe("relecture seule — un collecteur pousse la sortie JSON", () => {
    // Étiquettes d'un collecteur (les SIENNES, sans `severity`), uniques par run.
    const container = `shop-${randomUUID()}`;
    const t1 = Date.now();

    beforeAll(async () => {
      // Les lignes EXACTES de la sortie `log.format: "json"`, poussées comme un
      // collecteur le ferait : rien de ce banc n'écrit le JSON à la main.
      const lines = captureJsonLines([
        mk("ro-alpha", "INFO", reqId, t1),
        mk("ro-bravo", "ERROR", reqId, t1 + 1),
      ]);
      const res = await fetch(`${LOKI_URL!}/loki/api/v1/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          streams: [
            {
              stream: { container },
              values: lines.map((l, i) => [`${t1 + i}000000`, l.trimEnd()]),
            },
          ],
        }),
      });
      assert.ok(res.ok, `push collecteur refusé : HTTP ${res.status}`);
    });

    it("le driver en relecture seule relit, sélecteur et sévérité compris", async () => {
      const driver = createLokiLogDriver({
        url: LOKI_URL!,
        write: false,
        labels: { container },
      });
      const all = await poll(
        () => driver.query!({ from: t1 - 5_000, to: t1 + 60_000 }),
        (r) => r.total >= 2,
      );
      assert.strictEqual(all.total, 2);
      assert.strictEqual(all.rows[0]!.requestId, reqId);
      const errors = await driver.query!({
        from: t1 - 5_000,
        to: t1 + 60_000,
        severity: "ERROR",
      });
      assert.strictEqual(errors.total, 1);
      assert.strictEqual(errors.rows[0]!.payload, "ro-bravo");
    });
  });

  it("le filtre severity est honoré sur le round-trip", async () => {
    const driver = createLokiLogDriver({ url: LOKI_URL! });
    const r = await poll(
      () =>
        driver.query!({
          from: t0 - 5_000,
          to: t0 + 60_000,
          requestId: reqId,
          severity: "ERROR",
        }),
      (r) => r.total >= 1,
    );
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.rows[0]!.payload, "loki-bravo");
  });
});

describe.skipIf(!OS_URL)("Log Backplane E2E — OpenSearch réel", () => {
  const reqId = `e2e-os-${randomUUID()}`;
  const t0 = Date.now();

  beforeAll(async () => {
    const transport = new OpenSearchTransport({ url: OS_URL! });
    await transport.send(mk("os-alpha", "INFO", reqId, t0));
    await transport.send(mk("os-bravo", "ERROR", reqId, t0 + 1));
    await transport.send(mk("os-charlie", "INFO", reqId, t0 + 2));
    await transport.close(); // flush → bulk HTTP réel
  });

  it("push → indexation → relecture (write↔read cohérents)", async () => {
    const driver = createOpenSearchLogDriver({ url: OS_URL! });
    const r = await poll(
      () =>
        driver.query!({ from: t0 - 5_000, to: t0 + 60_000, requestId: reqId }),
      (r) => r.total >= 3,
    );
    assert.strictEqual(r.total, 3, "les 3 Pdu indexés doivent revenir");
    assert.strictEqual(r.rows[0]!.payload, "os-charlie"); // récent d'abord
    assert.strictEqual(r.rows[0]!.requestId, reqId);
  });

  it("le filtre severity est honoré sur le round-trip", async () => {
    const driver = createOpenSearchLogDriver({ url: OS_URL! });
    const r = await poll(
      () =>
        driver.query!({
          from: t0 - 5_000,
          to: t0 + 60_000,
          requestId: reqId,
          severity: "ERROR",
        }),
      (r) => r.total >= 1,
    );
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.rows[0]!.payload, "os-bravo");
  });

  describe("relecture seule — un collecteur indexe la sortie JSON dans l'index de l'application", () => {
    // Index propre à l'application, unique par run (un index est en minuscules).
    const index = `shop-${randomUUID()}`;
    const t1 = Date.now();

    beforeAll(async () => {
      // Les lignes EXACTES de la sortie `log.format: "json"`, analysées en champs
      // à la racine du document comme un collecteur le fait (Fluent Bit, Vector).
      const lines = captureJsonLines([
        mk("ro-alpha", "INFO", reqId, t1),
        mk("ro-bravo", "ERROR", reqId, t1 + 1),
      ]);
      const body = lines
        .map((l) => `{"index":{"_index":"${index}"}}\n${l.trimEnd()}\n`)
        .join("");
      const res = await fetch(`${OS_URL!}/_bulk?refresh=true`, {
        method: "POST",
        headers: { "content-type": "application/x-ndjson" },
        body,
      });
      assert.ok(res.ok, `indexation collecteur refusée : HTTP ${res.status}`);
    });

    it("le driver relit l'index déclaré, sévérité comprise", async () => {
      const driver = createOpenSearchLogDriver({ url: OS_URL!, index });
      const all = await poll(
        () => driver.query!({ from: t1 - 5_000, to: t1 + 60_000 }),
        (r) => r.total >= 2,
      );
      assert.strictEqual(all.total, 2);
      assert.strictEqual(all.rows[0]!.requestId, reqId);
      const errors = await driver.query!({
        from: t1 - 5_000,
        to: t1 + 60_000,
        severity: "ERROR",
      });
      assert.strictEqual(errors.total, 1);
      assert.strictEqual(errors.rows[0]!.payload, "ro-bravo");
    });
  });

  it("le modèle d'index porte le nom de son index — deux applications ne s'écrasent pas", async () => {
    const index = `app-${randomUUID()}`;
    const transport = new OpenSearchTransport({ url: OS_URL!, index });
    await transport.send(mk("tpl", "INFO", reqId, Date.now()));
    await transport.close();
    const res = await fetch(`${OS_URL!}/_index_template/${index}`);
    assert.strictEqual(res.status, 200, "modèle d'index absent sous son nom");
  });
});
