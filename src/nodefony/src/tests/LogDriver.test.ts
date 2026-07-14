/*
 *   NODEFONY FRAMEWORK UNIT TEST — MOCHA STYLE
 *
 *   Log Backplane (LB.0/LB.1) — axe DESTINATION queryable :
 *   - filterPdus (helper PUR : critères AND, ordre récent-first, pagination)
 *   - logDriverRegistry (register/setActive/list, throw inconnu)
 *   - createMemoryLogDriver (query délègue à filterPdus sur la source injectée)
 *   - pduToRecord (projection Pdu → forme wire)
 */
import assert from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import Pdu from "../syslog/Pdu";
import { filterPdus } from "../syslog/drivers/filterPdus";
import { pduProtocol } from "../syslog/drivers/pduProtocol";
import { pduFlowStep, FLOW_STEPS } from "../syslog/drivers/pduFlow";
import { pduToRecord } from "../syslog/drivers/ILogDriver";
import { createMemoryLogDriver } from "../syslog/drivers/MemoryLogDriver";
import { createFileLogDriver } from "../syslog/drivers/FileLogDriver";
import { createClusterFileLogDriver } from "../syslog/drivers/ClusterFileLogDriver";
import { resolveQueryDriver } from "../syslog/drivers/builtinLogDrivers";
import {
  registerLogDriver,
  setActiveLogDriver,
  getActiveLogDriver,
  listLogDrivers,
  _resetLogDriverRegistry,
} from "../syslog/drivers/logDriverRegistry";

/** Fabrique un Pdu daté (timeStamp explicite pour les tests de plage/ordre). */
const mk = (
  payload: unknown,
  severity: Pdu["severityName"] | number,
  moduleName = "MOD",
  msgid = "",
  ts?: number,
  requestId?: string,
): Pdu => {
  const pdu = new Pdu(payload, severity as never, moduleName, msgid, "", ts);
  if (requestId !== undefined) pdu.requestId = requestId;
  return pdu;
};

describe("Log Backplane (LB.0/LB.1)", () => {
  describe("filterPdus — helper pur", () => {
    // Jeu de données : 5 Pdu, timestamps croissants (anciens → récents).
    const sample = (): Pdu[] => [
      mk("alpha login", "INFO", "AUTH", "LOGIN", 1000, "req-1"),
      mk("db slow query", "WARNING", "ORM", "QUERY", 2000, "req-1"),
      mk("boom", "ERROR", "HTTP", "KERNEL", 3000, "req-2"),
      mk("critical fail", "CRITIC", "HTTP", "KERNEL", 4000, "req-2"),
      mk("hello world", "DEBUG", "ROUTER", "MATCH", 5000, "req-3"),
    ];

    it("vide → tout, ordre RÉCENT d'abord", () => {
      const r = filterPdus(sample());
      assert.strictEqual(r.total, 5);
      assert.strictEqual(r.rows.length, 5);
      assert.strictEqual(r.rows[0]!.payload, "hello world"); // le + récent
      assert.strictEqual(r.rows[4]!.payload, "alpha login"); // le + ancien
      assert.strictEqual(r.truncated, false);
    });

    it("severity unique", () => {
      const r = filterPdus(sample(), { severity: "ERROR" });
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.rows[0]!.payload, "boom");
    });

    it("severity multiple (array) + insensible casse", () => {
      const r = filterPdus(sample(), { severity: ["error", "critic"] });
      assert.strictEqual(r.total, 2);
      assert.deepStrictEqual(
        r.rows.map((x) => x.severityName),
        ["CRITIC", "ERROR"], // récent d'abord
      );
    });

    it("module — inclusion insensible casse", () => {
      const r = filterPdus(sample(), { module: "http" });
      assert.strictEqual(r.total, 2);
    });

    it("msgid — inclusion", () => {
      const r = filterPdus(sample(), { msgid: "LOGIN" });
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.rows[0]!.moduleName, "AUTH");
    });

    it("requestId — match EXACT", () => {
      const r = filterPdus(sample(), { requestId: "req-2" });
      assert.strictEqual(r.total, 2);
      // exact : "req-" ne doit RIEN matcher (pas d'inclusion)
      assert.strictEqual(filterPdus(sample(), { requestId: "req-" }).total, 0);
    });

    it("plage from/to (timeStamp inclus)", () => {
      const r = filterPdus(sample(), { from: 2000, to: 4000 });
      assert.strictEqual(r.total, 3);
    });

    it("text — plein-texte payload + msgid + module", () => {
      assert.strictEqual(filterPdus(sample(), { text: "boom" }).total, 1);
      assert.strictEqual(filterPdus(sample(), { text: "ROUTER" }).total, 1); // module
      assert.strictEqual(filterPdus(sample(), { text: "query" }).total, 1); // 1 Pdu (payload ET msgid)
      assert.strictEqual(filterPdus(sample(), { text: "fail" }).total, 1); // payload
    });

    it("critères combinés en AND", () => {
      const r = filterPdus(sample(), { module: "HTTP", severity: "ERROR" });
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.rows[0]!.payload, "boom");
    });

    it("limit/offset/total/truncated", () => {
      const r = filterPdus(sample(), { limit: 2, offset: 0 });
      assert.strictEqual(r.total, 5);
      assert.strictEqual(r.rows.length, 2);
      assert.strictEqual(r.truncated, true);
      const r2 = filterPdus(sample(), { limit: 2, offset: 4 });
      assert.strictEqual(r2.rows.length, 1);
      assert.strictEqual(r2.truncated, false);
    });

    it("0 match → rows vide, total 0", () => {
      const r = filterPdus(sample(), { module: "NOPE" });
      assert.strictEqual(r.total, 0);
      assert.strictEqual(r.rows.length, 0);
    });
  });

  describe("filterPdus — protocole WS/HTTP", () => {
    // 2 logs WS (msgid "WEBSOCKET CONTEXT") + 3 logs HTTP (req/router/applicatif).
    const proto = (): Pdu[] => [
      mk("client connected", "INFO", "@http", "WEBSOCKET CONTEXT", 1000),
      mk("GET / 200", "INFO", "@http", "req", 2000),
      mk("onMessage RECEIVE", "DEBUG", "@http", "WEBSOCKET CONTEXT", 3000),
      mk("Match route", "DEBUG", "ROUTER", "MATCH", 4000),
      mk("db demo", "INFO", "app", "DB-DEMO", 5000),
    ];

    it("protocol ws → uniquement les logs WEBSOCKET CONTEXT", () => {
      const r = filterPdus(proto(), { protocol: "ws" });
      assert.strictEqual(r.total, 2);
      assert.ok(r.rows.every((x) => x.msgid === "WEBSOCKET CONTEXT"));
    });

    it("protocol http → tout SAUF les logs WS", () => {
      const r = filterPdus(proto(), { protocol: "http" });
      assert.strictEqual(r.total, 3);
      assert.ok(r.rows.every((x) => x.msgid !== "WEBSOCKET CONTEXT"));
    });

    it("protocol + severity combinés en AND", () => {
      const r = filterPdus(proto(), { protocol: "ws", severity: "DEBUG" });
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.rows[0]!.payload, "onMessage RECEIVE");
    });
  });

  describe("pduProtocol — classification pure", () => {
    it("WEBSOCKET CONTEXT → ws", () => {
      assert.strictEqual(
        pduProtocol(mk("x", "INFO", "@http", "WEBSOCKET CONTEXT")),
        "ws",
      );
    });
    it("tout autre msgid → http", () => {
      assert.strictEqual(pduProtocol(mk("x", "INFO", "@http", "req")), "http");
      assert.strictEqual(pduProtocol(mk("x", "INFO", "MOD", "")), "http");
    });
  });

  describe("pduFlowStep — classification d'étape", () => {
    it("events HTTP → étapes structurées", () => {
      assert.strictEqual(
        pduFlowStep(mk("EVENT CONTEXT onRequest", "DEBUG", "@http", "http2")),
        "request-in",
      );
      assert.strictEqual(
        pduFlowStep(
          mk("EVENT CONTEXT onRequestEnd", "DEBUG", "@http", "http2"),
        ),
        "body-received",
      );
      assert.strictEqual(
        pduFlowStep(mk("Match route : GET /", "DEBUG", "ROUTER", "router")),
        "route-matched",
      );
      assert.strictEqual(
        pduFlowStep(
          mk("EVENT KERNEL onRequest", "DEBUG", "NODEFONY", "KERNEL"),
        ),
        "kernel-dispatch",
      );
      assert.strictEqual(
        pduFlowStep(mk("GET / 200", "INFO", "@http", "req")),
        "request-end",
      );
    });
    it("events WS → sous-étapes", () => {
      assert.strictEqual(
        pduFlowStep(
          mk("EVENT CONTEXT onConnect", "DEBUG", "@http", "WEBSOCKET CONTEXT"),
        ),
        "ws-open",
      );
      assert.strictEqual(
        pduFlowStep(
          mk("EVENT CONTEXT onMessage", "DEBUG", "@http", "WEBSOCKET CONTEXT"),
        ),
        "ws-message",
      );
      assert.strictEqual(
        pduFlowStep(
          mk("EVENT CONTEXT onClose", "DEBUG", "@http", "WEBSOCKET CONTEXT"),
        ),
        "ws-close",
      );
    });
    it("frames WS du seam http (msgid `WS RECEIVE|SEND|BROADCAST`) → ws-message", () => {
      // Le contenu d'une frame ne porte pas de marqueur d'event → classer par msgid.
      assert.strictEqual(
        pduFlowStep(mk('{"jsonrpc":"2.0"}', "DEBUG", "@http", "WS RECEIVE")),
        "ws-message",
      );
      assert.strictEqual(
        pduFlowStep(mk("pong", "DEBUG", "@http", "WS SEND")),
        "ws-message",
      );
      assert.strictEqual(
        pduFlowStep(mk("[binary 12 B]", "DEBUG", "@http", "WS BROADCAST")),
        "ws-message",
      );
    });
    it("msgid commençant par WS mais hors direction connue → pas ws-message", () => {
      // Garde-fou : seules RECEIVE/SEND/BROADCAST matchent (pas « WS FOO »).
      assert.strictEqual(
        pduFlowStep(mk("payload neutre", "DEBUG", "@http", "WS FOO")),
        null,
      );
    });
    it("log applicatif libre → null", () => {
      assert.strictEqual(
        pduFlowStep(mk("DB demo result", "INFO", "app", "DB-DEMO")),
        null,
      );
    });
    it("toutes les étapes sont dans FLOW_STEPS", () => {
      // garde-fou : pas d'id renvoyé hors table (sinon select front incohérent)
      for (const sample of [
        mk("onRequest", "DEBUG", "@http", "http2"),
        mk("onConnect", "DEBUG", "@http", "WEBSOCKET CONTEXT"),
        mk("SAVE SESSION", "DEBUG", "session", "session"),
      ]) {
        const id = pduFlowStep(sample);
        if (id !== null)
          assert.ok(id in FLOW_STEPS, `${id} absent de FLOW_STEPS`);
      }
    });
  });

  describe("filterPdus — critère flow (étape)", () => {
    const flowSample = (): Pdu[] => [
      mk(
        "EVENT CONTEXT onConnect",
        "DEBUG",
        "@http",
        "WEBSOCKET CONTEXT",
        1000,
      ),
      mk(
        "EVENT CONTEXT onMessage",
        "DEBUG",
        "@http",
        "WEBSOCKET CONTEXT",
        2000,
      ),
      mk("Match route : GET /", "DEBUG", "ROUTER", "router", 3000),
      mk("GET / 200", "INFO", "@http", "req", 4000),
    ];
    it("flow unique → uniquement l'étape", () => {
      const r = filterPdus(flowSample(), { flow: "ws-open" });
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.rows[0]!.payload, "EVENT CONTEXT onConnect");
    });
    it("flow multiple (OU) → union des étapes", () => {
      const r = filterPdus(flowSample(), { flow: ["ws-open", "ws-message"] });
      assert.strictEqual(r.total, 2);
    });
    it("flow + protocol combinés en AND", () => {
      const r = filterPdus(flowSample(), {
        protocol: "ws",
        flow: "route-matched",
      });
      assert.strictEqual(r.total, 0); // route-matched est HTTP, pas WS
    });
  });

  describe("pduToRecord", () => {
    it("projette les champs ; requestId présent", () => {
      const p = mk("x", "INFO", "M", "ID", 1234, "req-9");
      const rec = pduToRecord(p);
      assert.strictEqual(rec.severityName, "INFO");
      assert.strictEqual(rec.moduleName, "M");
      assert.strictEqual(rec.timeStamp, 1234);
      assert.strictEqual(rec.requestId, "req-9");
    });
    it("requestId OMIS si absent (0 verbosité wire)", () => {
      const p = mk("x", "INFO");
      assert.ok(!("requestId" in pduToRecord(p)));
    });
  });

  describe("logDriverRegistry", () => {
    beforeEach(() => _resetLogDriverRegistry());
    afterEach(() => _resetLogDriverRegistry());

    it("register → premier devient actif ; list ; setActive ; getActive", () => {
      const mem = createMemoryLogDriver(() => []);
      registerLogDriver(mem);
      assert.strictEqual(getActiveLogDriver(), mem);
      assert.deepStrictEqual(
        listLogDrivers().map((d) => d.name),
        ["memory"],
      );
      const fake = {
        name: "fake",
        capabilities: { write: true, query: false, stream: false },
      };
      registerLogDriver(fake);
      assert.strictEqual(getActiveLogDriver(), mem); // actif inchangé
      assert.strictEqual(setActiveLogDriver("fake"), fake);
      assert.strictEqual(getActiveLogDriver(), fake);
    });

    it("setActiveLogDriver throw sur nom inconnu", () => {
      assert.throws(() => setActiveLogDriver("ghost"), /Unknown log driver/);
    });

    it("getActiveLogDriver = null si rien enregistré", () => {
      assert.strictEqual(getActiveLogDriver(), null);
    });
  });

  describe("createMemoryLogDriver", () => {
    it("capabilities memory (volatile, queryable, stream)", () => {
      const d = createMemoryLogDriver(() => []);
      assert.deepStrictEqual(d.capabilities, {
        write: false,
        query: true,
        stream: true,
      });
    });

    it("query délègue à filterPdus sur la source injectée (lazy)", async () => {
      let ring: Pdu[] = [];
      const d = createMemoryLogDriver(() => ring);
      ring = [mk("a", "INFO", "M1"), mk("b", "ERROR", "M2", "", 2000)];
      const r = await d.query!({ severity: "ERROR" });
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.rows[0]!.payload, "b");
    });
  });
});

describe("Log Backplane (LB.2) — driver file JSONL queryable", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nf-lb2-"));
    file = join(dir, "logs.jsonl");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Écrit 3 enregistrements JSONL (forme wire plate), timestamps croissants. */
  const writeSample = (): void => {
    const rows = [
      {
        uid: 1,
        severity: 6,
        severityName: "INFO",
        moduleName: "AUTH",
        msgid: "LOGIN",
        msg: "",
        timeStamp: 1000,
        pid: 1,
        payload: "alpha login",
        requestId: "req-1",
      },
      {
        uid: 2,
        severity: 4,
        severityName: "WARNING",
        moduleName: "ORM",
        msgid: "QUERY",
        msg: "",
        timeStamp: 2000,
        pid: 1,
        payload: "db slow query",
        requestId: "req-1",
      },
      {
        uid: 3,
        severity: 3,
        severityName: "ERROR",
        moduleName: "HTTP",
        msgid: "KERNEL",
        msg: "",
        timeStamp: 3000,
        pid: 1,
        payload: "boom",
        requestId: "req-2",
      },
    ];
    writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  };

  it("capabilities file (persistant, queryable, pas de stream)", () => {
    const d = createFileLogDriver({ path: file });
    assert.deepStrictEqual(d.capabilities, {
      write: true,
      query: true,
      stream: false,
    });
  });

  it("fichier absent → résultat vide, jamais de throw", async () => {
    const d = createFileLogDriver({ path: join(dir, "nope.jsonl") });
    const r = await d.query!({});
    assert.deepStrictEqual(r, { rows: [], total: 0, truncated: false });
  });

  it("relit le JSONL et filtre (severity ; récent d'abord ; même logique que memory)", async () => {
    writeSample();
    const d = createFileLogDriver({ path: file });
    const all = await d.query!({});
    assert.strictEqual(all.total, 3);
    assert.strictEqual(all.rows[0]!.payload, "boom"); // le + récent d'abord
    assert.strictEqual(all.rows[2]!.payload, "alpha login");
    const err = await d.query!({ severity: "ERROR" });
    assert.strictEqual(err.total, 1);
    assert.strictEqual(err.rows[0]!.moduleName, "HTTP");
  });

  it("requestId EXACT + plage from/to + pagination", async () => {
    writeSample();
    const d = createFileLogDriver({ path: file });
    assert.strictEqual((await d.query!({ requestId: "req-1" })).total, 2);
    assert.strictEqual((await d.query!({ requestId: "req-" })).total, 0); // exact, pas inclusion
    assert.strictEqual((await d.query!({ from: 2000, to: 3000 })).total, 2);
    const p = await d.query!({ limit: 1 });
    assert.strictEqual(p.rows.length, 1);
    assert.strictEqual(p.total, 3);
    assert.strictEqual(p.truncated, true);
  });

  it("lignes vides / JSON corrompu / non-Pdu → ignorées (write tronqué par crash)", async () => {
    writeFileSync(
      file,
      JSON.stringify({
        uid: 1,
        severity: 6,
        severityName: "INFO",
        moduleName: "M",
        msgid: "",
        msg: "",
        timeStamp: 1000,
        pid: 1,
        payload: "ok",
      }) +
        "\n" +
        "{ ceci n'est pas du json\n" + // corrompu
        "\n" + // ligne vide
        JSON.stringify({ nope: true }) + // objet sans champs discriminants → coerce null
        "\n",
    );
    const d = createFileLogDriver({ path: file });
    const r = await d.query!({});
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.rows[0]!.payload, "ok");
  });

  it("maxScanBytes borne la lecture à la QUEUE du fichier (anti-OOM)", async () => {
    const rows: string[] = [];
    for (let i = 1; i <= 50; i++) {
      rows.push(
        JSON.stringify({
          uid: i,
          severity: 6,
          severityName: "INFO",
          moduleName: "M",
          msgid: "",
          msg: "",
          timeStamp: i * 1000,
          pid: 1,
          payload: `p${i}`,
        }),
      );
    }
    writeFileSync(file, rows.join("\n") + "\n");
    const d = createFileLogDriver({ path: file, maxScanBytes: 300 });
    const r = await d.query!({});
    assert.ok(
      r.total > 0 && r.total < 50,
      `attendu une fenêtre tronquée, reçu total=${r.total}`,
    );
    assert.strictEqual(r.rows[0]!.payload, "p50"); // le + récent présent, fragment partiel jeté
  });
});

describe("Log Backplane (LB.5) — défaut `auto` adapté au mode (resolveQueryDriver)", () => {
  it("auto + mono-process → memory (0 I/O)", () => {
    assert.strictEqual(resolveQueryDriver("auto", false), "memory");
    assert.strictEqual(resolveQueryDriver(undefined, false), "memory");
  });

  it("auto + worker de cluster → cluster-file (vue unifiée)", () => {
    assert.strictEqual(resolveQueryDriver("auto", true), "cluster-file");
    assert.strictEqual(resolveQueryDriver(undefined, true), "cluster-file");
  });

  it("surcharge explicite respectée — même en cluster (on ne réécrit que le défaut)", () => {
    // memory choisi EXPRÈS en cluster : non promu (principe de moindre surprise).
    assert.strictEqual(resolveQueryDriver("memory", true), "memory");
    assert.strictEqual(resolveQueryDriver("file", true), "file");
    assert.strictEqual(resolveQueryDriver("loki", true), "loki");
    assert.strictEqual(
      resolveQueryDriver("cluster-file", false),
      "cluster-file",
    );
  });
});

describe("Log Backplane (LB.5) — agrégation cluster (cluster-file)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nf-lb5-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // Le `pid` de la ligne écrite vient du 1ᵉʳ argument de `writeWorker` (un Rec ne
  // le porte pas : un enregistrement appartient au worker qui l'écrit).
  type Rec = {
    uid: number;
    timeStamp: number;
    payload: string;
    severityName?: string;
    severity?: number;
    moduleName?: string;
    msgid?: string;
    requestId?: string;
  };

  /** Écrit le JSONL `nodefony-<pid>.jsonl` d'UN worker (forme wire plate). */
  const writeWorker = (pid: number, recs: Rec[], name?: string): void => {
    const lines = recs.map((r) =>
      JSON.stringify({
        uid: r.uid,
        severity: r.severity ?? 6,
        severityName: r.severityName ?? "INFO",
        moduleName: r.moduleName ?? "MOD",
        msgid: r.msgid ?? "",
        msg: "",
        timeStamp: r.timeStamp,
        pid,
        payload: r.payload,
        ...(r.requestId !== undefined ? { requestId: r.requestId } : {}),
      }),
    );
    writeFileSync(
      join(dir, name ?? `nodefony-${pid}.jsonl`),
      lines.join("\n") + "\n",
    );
  };

  it("capabilities cluster-file (persistant, queryable, pas de stream)", () => {
    const d = createClusterFileLogDriver({ dir });
    assert.deepStrictEqual(d.capabilities, {
      write: true,
      query: true,
      stream: false,
    });
  });

  it("dossier absent / vide → résultat vide, jamais de throw", async () => {
    const d1 = createClusterFileLogDriver({ dir: join(dir, "nope") });
    assert.deepStrictEqual(await d1.query!({}), {
      rows: [],
      total: 0,
      truncated: false,
    });
    const d2 = createClusterFileLogDriver({ dir });
    assert.deepStrictEqual(await d2.query!({}), {
      rows: [],
      total: 0,
      truncated: false,
    });
  });

  it("fusionne 2 workers en ordre CHRONOLOGIQUE global (timeStamp entrelacés)", async () => {
    // Worker A et B émettent en alternance : a1<b1<a2<b2<a3 par timeStamp.
    writeWorker(100, [
      { uid: 1, timeStamp: 1000, payload: "a1" },
      { uid: 2, timeStamp: 3000, payload: "a2" },
      { uid: 3, timeStamp: 5000, payload: "a3" },
    ]);
    writeWorker(200, [
      { uid: 1, timeStamp: 2000, payload: "b1" },
      { uid: 2, timeStamp: 4000, payload: "b2" },
    ]);
    const d = createClusterFileLogDriver({ dir });
    const r = await d.query!({});
    assert.strictEqual(r.total, 5);
    // récent d'abord (desc) : a3(5000) b2(4000) a2(3000) b1(2000) a1(1000)
    assert.deepStrictEqual(
      r.rows.map((x) => x.payload),
      ["a3", "b2", "a2", "b1", "a1"],
    );
    // ordre asc (chronologique) = l'inverse
    const asc = await d.query!({ order: "asc" });
    assert.deepStrictEqual(
      asc.rows.map((x) => x.payload),
      ["a1", "b1", "a2", "b2", "a3"],
    );
  });

  it("filtre (requestId/severity) à travers TOUS les workers", async () => {
    writeWorker(100, [
      { uid: 1, timeStamp: 1000, payload: "a-info", requestId: "req-1" },
      {
        uid: 2,
        timeStamp: 3000,
        payload: "a-err",
        severityName: "ERROR",
        severity: 3,
        requestId: "req-9",
      },
    ]);
    writeWorker(200, [
      { uid: 1, timeStamp: 2000, payload: "b-info", requestId: "req-1" },
      {
        uid: 2,
        timeStamp: 4000,
        payload: "b-err",
        severityName: "ERROR",
        severity: 3,
        requestId: "req-1",
      },
    ]);
    const d = createClusterFileLogDriver({ dir });
    // requestId présent dans les 2 workers → agrégation correcte
    const byReq = await d.query!({ requestId: "req-1" });
    assert.strictEqual(byReq.total, 3);
    assert.deepStrictEqual(
      byReq.rows.map((x) => x.payload),
      ["b-err", "b-info", "a-info"], // récent d'abord (4000, 2000, 1000)
    );
    const byErr = await d.query!({ severity: "ERROR" });
    assert.strictEqual(byErr.total, 2);
  });

  it("tie-break à timeStamp égal : pid puis uid (chronologie intra-worker)", async () => {
    // Même timeStamp partout → départage par pid (100 avant 200), uid intra-worker.
    writeWorker(100, [
      { uid: 1, timeStamp: 1000, payload: "a1" },
      { uid: 2, timeStamp: 1000, payload: "a2" },
    ]);
    writeWorker(200, [{ uid: 1, timeStamp: 1000, payload: "b1" }]);
    const d = createClusterFileLogDriver({ dir });
    const asc = await d.query!({ order: "asc" });
    // chrono : pid100(uid1,uid2) puis pid200(uid1)
    assert.deepStrictEqual(
      asc.rows.map((x) => x.payload),
      ["a1", "a2", "b1"],
    );
  });

  it("ignore les fichiers hors motif (préfixe/suffixe)", async () => {
    writeWorker(100, [{ uid: 1, timeStamp: 1000, payload: "ok" }]);
    writeWorker(0, [{ uid: 1, timeStamp: 9000, payload: "other" }], "app.log");
    writeWorker(0, [{ uid: 1, timeStamp: 9000, payload: "txt" }], "notes.txt");
    const d = createClusterFileLogDriver({ dir });
    const r = await d.query!({});
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.rows[0]!.payload, "ok");
  });

  it("maxFiles borne le nombre de fichiers scannés (anti-OOM)", async () => {
    // 4 workers, 1 Pdu chacun, timeStamps croissants → on en garde 2 (les récents).
    for (let i = 1; i <= 4; i++) {
      writeWorker(i * 10, [{ uid: 1, timeStamp: i * 1000, payload: `w${i}` }]);
    }
    const d = createClusterFileLogDriver({ dir, maxFiles: 2 });
    const r = await d.query!({});
    assert.strictEqual(
      r.total,
      2,
      `maxFiles=2 → 2 fichiers scannés, reçu total=${r.total}`,
    );
  });
});
