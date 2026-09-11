/*
 *   NODEFONY FRAMEWORK UNIT TEST — MOCHA STYLE
 *
 *   Log Backplane (LB.4) — destinations prod HTTP (fetch MOCKÉ, 0 réseau) :
 *   - createLokiLogDriver        : query LogQL → filterPdus (autorité finale)
 *   - createOpenSearchLogDriver  : query _search → filterPdus ; 404 = vide
 *   - LokiTransport              : push batché /loki/api/v1/push (streams + values ns)
 *   - OpenSearchTransport        : bulk batché /_bulk (NDJSON terminé par \n)
 *   - BatchingHttpTransport      : drop borné quand la queue sature
 */
import assert from "node:assert";
import Pdu from "../syslog/Pdu";
import { pduToRecord } from "../syslog/drivers/ILogDriver";
import { createLokiLogDriver } from "../syslog/drivers/LokiLogDriver";
import { createOpenSearchLogDriver } from "../syslog/drivers/OpenSearchLogDriver";
import { LokiTransport } from "../syslog/transports/LokiTransport";
import { OpenSearchTransport } from "../syslog/transports/OpenSearchTransport";
import type {
  FetchLike,
  FetchInitLike,
  FetchResponseLike,
} from "../syslog/httpFetch";

/** Fabrique un Pdu daté. */
const mk = (
  payload: unknown,
  severity: string,
  moduleName = "MOD",
  msgid = "",
  ts = 1000,
  requestId?: string,
): Pdu => {
  const pdu = new Pdu(payload, severity as never, moduleName, msgid, "", ts);
  if (requestId !== undefined) pdu.requestId = requestId;
  return pdu;
};

interface MockCall {
  url: string;
  init?: FetchInitLike;
}

/** Construit un `FetchLike` factice + capture les appels. */
const mockFetch = (
  handler: (
    url: string,
    init?: FetchInitLike,
  ) => { status?: number; body?: unknown },
): { fn: FetchLike; calls: MockCall[] } => {
  const calls: MockCall[] = [];
  const fn: FetchLike = (url, init) => {
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    const res: FetchResponseLike = {
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        typeof body === "string" ? body : JSON.stringify(body),
      json: async () => body,
    };
    return Promise.resolve(res);
  };
  return { fn, calls };
};

describe("Log Backplane (LB.4) — driver loki (query LogQL)", () => {
  // Réponse query_range : Loki renvoie récent d'abord (direction=backward).
  const lokiBody = (pdus: Pdu[]): unknown => ({
    status: "success",
    data: {
      resultType: "streams",
      result: [
        {
          stream: { app: "nodefony" },
          values: pdus.map((p) => [
            `${p.timeStamp}000000`,
            JSON.stringify(pduToRecord(p)),
          ]),
        },
      ],
    },
  });

  const sample = (): Pdu[] => [
    mk("boom", "ERROR", "HTTP", "KERNEL", 3000, "req-2"),
    mk("slow", "WARNING", "ORM", "QUERY", 2000, "req-1"),
    mk("login", "INFO", "AUTH", "LOGIN", 1000, "req-1"),
  ];

  it("relit + filtre via filterPdus (récent d'abord, même sémantique)", async () => {
    const { fn, calls } = mockFetch(() => ({ body: lokiBody(sample()) }));
    const d = createLokiLogDriver({ url: "http://loki:3100", fetchImpl: fn });
    const all = await d.query!({});
    assert.strictEqual(all.total, 3);
    assert.strictEqual(all.rows[0]!.payload, "boom"); // le + récent
    assert.strictEqual(all.rows[2]!.payload, "login");
    // L'URL cible bien query_range avec le sélecteur de base.
    assert.match(calls[0]!.url, /\/loki\/api\/v1\/query_range\?/);
    assert.match(decodeURIComponent(calls[0]!.url), /\{app="nodefony"\}/);
  });

  it("severity → label matcher dans le LogQL ; filtrage exact par filterPdus", async () => {
    const { fn, calls } = mockFetch(() => ({ body: lokiBody(sample()) }));
    const d = createLokiLogDriver({ url: "http://loki:3100", fetchImpl: fn });
    const r = await d.query!({ severity: "ERROR" });
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.rows[0]!.payload, "boom");
    assert.match(decodeURIComponent(calls[0]!.url), /severity=~"ERROR"/);
  });

  it("requestId exact + text : line filters LogQL", async () => {
    const { fn, calls } = mockFetch(() => ({ body: lokiBody(sample()) }));
    const d = createLokiLogDriver({ url: "http://loki:3100", fetchImpl: fn });
    const r = await d.query!({ requestId: "req-1" });
    assert.strictEqual(r.total, 2);
    // URLSearchParams encode l'espace en `+` (form-urlencoded) → Loki le re-décode
    // en espace côté serveur. On reproduit cette détente pour vérifier le LogQL.
    const q = decodeURIComponent(calls[0]!.url).replace(/\+/g, " ");
    assert.match(q, /\|= "req-1"/);
  });

  it("HTTP !ok → throw explicite (infra de logs visible)", async () => {
    const { fn } = mockFetch(() => ({ status: 503 }));
    const d = createLokiLogDriver({ url: "http://loki:3100", fetchImpl: fn });
    await assert.rejects(() => d.query!({}), /query HTTP 503/);
  });
});

describe("Log Backplane (LB.4) — driver opensearch (query _search)", () => {
  const osBody = (pdus: Pdu[]): unknown => ({
    hits: {
      total: { value: pdus.length, relation: "eq" },
      hits: pdus.map((p) => ({ _source: pduToRecord(p) })),
    },
  });
  const sample = (): Pdu[] => [
    mk("boom", "ERROR", "HTTP", "KERNEL", 3000),
    mk("login", "INFO", "AUTH", "LOGIN", 1000),
  ];

  it("relit hits._source + filtre ; body _search trié desc", async () => {
    const { fn, calls } = mockFetch(() => ({ body: osBody(sample()) }));
    const d = createOpenSearchLogDriver({
      url: "http://opensearch:9200",
      fetchImpl: fn,
    });
    const all = await d.query!({});
    assert.strictEqual(all.total, 2);
    assert.strictEqual(all.rows[0]!.payload, "boom");
    assert.match(calls[0]!.url, /\/nodefony-logs\/_search$/);
    const body = JSON.parse(String(calls[0]!.init!.body));
    assert.strictEqual(body.sort[0].timeStamp.order, "desc");
    assert.strictEqual(body.track_total_hits, true);
  });

  it("from/to → range filter sur timeStamp", async () => {
    const { fn, calls } = mockFetch(() => ({ body: osBody(sample()) }));
    const d = createOpenSearchLogDriver({
      url: "http://opensearch:9200",
      fetchImpl: fn,
    });
    await d.query!({ from: 1000, to: 2000 });
    const body = JSON.parse(String(calls[0]!.init!.body));
    assert.deepStrictEqual(body.query.bool.filter[0].range.timeStamp, {
      gte: 1000,
      lte: 2000,
    });
  });

  it("404 (index absent) → résultat vide, jamais de throw", async () => {
    const { fn } = mockFetch(() => ({ status: 404 }));
    const d = createOpenSearchLogDriver({
      url: "http://opensearch:9200",
      fetchImpl: fn,
    });
    assert.deepStrictEqual(await d.query!({}), {
      rows: [],
      total: 0,
      truncated: false,
    });
  });

  it("5xx → throw explicite", async () => {
    const { fn } = mockFetch(() => ({ status: 500 }));
    const d = createOpenSearchLogDriver({
      url: "http://opensearch:9200",
      fetchImpl: fn,
    });
    await assert.rejects(() => d.query!({}), /search HTTP 500/);
  });
});

describe("Log Backplane (LB.4) — LokiTransport (push batché)", () => {
  it("close() flush → 1 POST coalescé ; values en ns ; grouping par labels", async () => {
    const { fn, calls } = mockFetch(() => ({ status: 204 }));
    const t = new LokiTransport({
      url: "http://loki:3100",
      fetchImpl: fn,
      batchSize: 100, // pas d'auto-flush → close() déterministe
    });
    await t.send(mk("a", "INFO", "AUTH", "", 1000));
    await t.send(mk("b", "INFO", "AUTH", "", 2000));
    await t.send(mk("c", "ERROR", "HTTP", "", 3000));
    await t.close();
    assert.strictEqual(calls.length, 1); // 1 seul POST
    assert.match(calls[0]!.url, /\/loki\/api\/v1\/push$/);
    const body = JSON.parse(String(calls[0]!.init!.body));
    // 2 jeux de labels distincts (AUTH/INFO vs HTTP/ERROR) → 2 streams.
    assert.strictEqual(body.streams.length, 2);
    const authStream = body.streams.find(
      (s: { stream: { module: string } }) => s.stream.module === "AUTH",
    );
    assert.strictEqual(authStream.values.length, 2);
    assert.strictEqual(authStream.values[0][0], "1000000000"); // 1000ms → ns
    assert.strictEqual(authStream.stream.severity, "INFO");
  });

  it("queue saturée → DROP borné + compteur (anti-OOM)", async () => {
    const { fn } = mockFetch(() => ({ status: 204 }));
    const t = new LokiTransport({
      url: "http://loki:3100",
      fetchImpl: fn,
      batchSize: 100,
      maxQueue: 2,
    });
    await t.send(mk("a", "INFO"));
    await t.send(mk("b", "INFO"));
    await t.send(mk("c", "INFO")); // 3ᵉ au-delà du plafond → drop
    assert.strictEqual(t.stats.dropped, 1);
  });
});

describe("Log Backplane (LB.4) — OpenSearchTransport (bulk batché)", () => {
  it("close() flush → POST /_bulk NDJSON terminé par newline", async () => {
    const { fn, calls } = mockFetch(() => ({
      body: { took: 1, errors: false, items: [] },
    }));
    const t = new OpenSearchTransport({
      url: "http://opensearch:9200",
      fetchImpl: fn,
      batchSize: 100,
    });
    await t.send(mk("a", "INFO", "AUTH", "", 1000));
    await t.send(mk("b", "ERROR", "HTTP", "", 2000));
    await t.close();
    // Deux appels : la pose du modèle d'index, puis le bulk.
    const bulk = calls.find((c) => c.url.endsWith("/_bulk"));
    assert.ok(
      bulk,
      `aucun appel /_bulk — reçus : ${calls.map((c) => c.url).join(", ")}`,
    );
    assert.strictEqual(
      bulk!.init!.headers!["content-type"],
      "application/x-ndjson",
    );
    const body = String(bulk!.init!.body);
    assert.ok(body.endsWith("\n"), "le corps bulk DOIT finir par un newline");
    const lines = body.split("\n").filter((l) => l.length > 0);
    assert.strictEqual(lines.length, 4); // 2 action + 2 doc
    assert.deepStrictEqual(JSON.parse(lines[0]!), {
      index: { _index: "nodefony-logs" },
    });
  });

  /**
   * 🔴 Un horodatage que les outils savent lire — #328.
   *
   * Le défaut ne se voyait NI à l'écriture (elle réussit), NI à la relecture par
   * le pilote du framework (il trie un entier). Il n'apparaissait qu'au moment
   * où un outil tiers ouvre l'index — donc quand l'utilisateur veut enfin
   * regarder ses journaux. Ces cas le rendent visible ICI.
   */
  it("chaque document porte @timestamp en ISO 8601, et GARDE timeStamp", async () => {
    const { fn, calls } = mockFetch(() => ({
      body: { took: 1, errors: false, items: [] },
    }));
    const t = new OpenSearchTransport({
      url: "http://opensearch:9200",
      fetchImpl: fn,
      batchSize: 100,
    });
    await t.send(mk("a", "INFO", "AUTH", "", 1_780_270_122_919));
    await t.close();

    const bulk = calls.find((c) => c.url.endsWith("/_bulk"))!;
    const lignes = String(bulk.init!.body)
      .split("\n")
      .filter((l) => l.length > 0);
    const doc = JSON.parse(lignes[1]!) as Record<string, unknown>;
    assert.strictEqual(
      doc["@timestamp"],
      // Valeur vérifiée par un calcul INDÉPENDANT (python : datetime.utcfromtimestamp),
      // pas par un `new Date(…).toISOString()` qui rejouerait le code sous test.
      "2026-05-31T23:28:42.919Z",
      "sans un champ de type date, aucune vue chronologique n'existe",
    );
    // Le champ numérique RESTE : c'est lui que le pilote de relecture filtre et
    // trie. Réparer un outil tiers en cassant le nôtre ne serait pas réparer.
    assert.strictEqual(doc["timeStamp"], 1_780_270_122_919);
  });

  it("pose le modèle d'index UNE fois, et déclare @timestamp de type date", async () => {
    const { fn, calls } = mockFetch(() => ({
      body: { took: 1, errors: false, items: [] },
    }));
    const t = new OpenSearchTransport({
      url: "http://opensearch:9200",
      fetchImpl: fn,
      batchSize: 1,
    });
    await t.send(mk("a", "INFO", "AUTH", "", 1000));
    await t.send(mk("b", "INFO", "AUTH", "", 2000));
    await t.close();

    const modeles = calls.filter((c) => c.url.includes("/_index_template/"));
    // Deux lots, UN seul modèle : la promesse est mémorisée, pas rejouée.
    assert.strictEqual(
      modeles.length,
      1,
      `le modèle doit être posé une seule fois (reçu ${modeles.length})`,
    );
    assert.strictEqual(modeles[0]!.init!.method, "PUT");
    const corps = JSON.parse(String(modeles[0]!.init!.body)) as {
      index_patterns: string[];
      template: { mappings: { properties: Record<string, { type: string }> } };
    };
    assert.deepStrictEqual(corps.index_patterns, ["nodefony-logs*"]);
    // Sans ce type, un index créé À NEUF retomberait sur le mapping deviné —
    // et personne ne repasse derrière sur un déploiement vierge.
    assert.strictEqual(
      corps.template.mappings.properties["@timestamp"]?.type,
      "date",
    );
    assert.strictEqual(
      corps.template.mappings.properties["timeStamp"]?.type,
      "long",
    );
  });

  it("un modèle REFUSÉ ne fait pas perdre les journaux", async () => {
    // Droits insuffisants, serveur d'une autre famille : le document part quand
    // même. Un transport de journaux qui bloque sur sa propre configuration
    // transforme un défaut d'observabilité en perte de données.
    const { fn, calls } = mockFetch((url) =>
      url.includes("/_index_template/")
        ? { status: 403, body: { error: "forbidden" } }
        : { body: { took: 1, errors: false, items: [] } },
    );
    const t = new OpenSearchTransport({
      url: "http://opensearch:9200",
      fetchImpl: fn,
      batchSize: 100,
    });
    await t.send(mk("a", "INFO", "AUTH", "", 1000));
    await t.close();
    assert.ok(
      calls.some((c) => c.url.endsWith("/_bulk")),
      "le bulk doit partir malgré le refus du modèle",
    );
  });
});
