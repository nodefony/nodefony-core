import { expect } from "vitest";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type RawData, type WebSocket as WsConn } from "ws";
import {
  NodefonySocket,
  type NodefonySocketOptions,
} from "../client/realtime/NodefonySocket";

/**
 * RED-TEAM — le client WebSocket `NodefonySocket` face à un serveur HOSTILE
 * (passe threat-first : matrice conçue sans lire l'implémentation, d'après
 * RFC 6455, JSON-RPC 2.0 et la matrice de menace). Chaque cas encode le verdict
 * d'une implémentation saine, pas ce que le code fait aujourd'hui.
 */

type OnConn = (ws: WsConn, req: http.IncomingMessage, n: number) => void;

interface IDecor {
  url: string;
  port: number;
  wss: WebSocketServer;
  conns: WsConn[];
  /** Nombre de poignées de main reçues (= tentatives de connexion). */
  hits(): number;
  close(): Promise<void>;
}

const WELCOME = JSON.stringify({ jsonrpc: "2.0", method: "realtime:welcome" });
const open: NodefonySocket[] = [];
const decors: IDecor[] = [];
const raws: net.Server[] = [];
// Connexions acceptées par les serveurs bruts : `net.Server.close` attend leur
// fin, et un serveur hostile les tient ouvertes — il faut les couper.
const rawSockets: net.Socket[] = [];

async function serve(
  onConn?: OnConn,
  onHeaders?: (headers: string[]) => void,
): Promise<IDecor> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((r) => wss.on("listening", r));
  const conns: WsConn[] = [];
  let count = 0;
  if (onHeaders) wss.on("headers", (h) => onHeaders(h));
  wss.on("connection", (ws, req) => {
    count++;
    conns.push(ws);
    ws.on("error", () => {});
    if (onConn) onConn(ws, req, count);
    else ws.send(WELCOME);
  });
  const port = portOf(wss.address());
  const decor: IDecor = {
    url: `ws://127.0.0.1:${port}/ws`,
    port,
    wss,
    conns,
    hits: () => count,
    close: () =>
      new Promise<void>((r) => {
        for (const c of wss.clients) c.terminate();
        wss.close(() => r());
      }),
  };
  decors.push(decor);
  return decor;
}

/** Serveur TCP brut : répond ce qu'on veut à la poignée de main. */
async function raw(
  onData: (sock: net.Socket) => void,
): Promise<{ url: string; hits: () => number }> {
  let count = 0;
  const server = net.createServer((sock) => {
    count++;
    rawSockets.push(sock);
    sock.on("error", () => {});
    sock.once("data", () => onData(sock));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  raws.push(server);
  const port = portOf(server.address());
  return { url: `ws://127.0.0.1:${port}/ws`, hits: () => count };
}

/** Port d'écoute d'un serveur — échoue franchement s'il n'écoute pas en TCP. */
function portOf(address: string | AddressInfo | null): number {
  if (address === null || typeof address === "string")
    throw new Error(`adresse d'écoute inattendue : ${String(address)}`);
  return address.port;
}

/** Texte d'une trame reçue par `ws` (tampon, morceaux ou ArrayBuffer). */
const text = (d: RawData): string =>
  (Array.isArray(d)
    ? Buffer.concat(d)
    : Buffer.isBuffer(d)
      ? d
      : Buffer.from(d)
  ).toString("utf8");

/** `id` numérique d'une trame reçue, `undefined` sinon (notification, id d'un autre type). */
const idOf = (d: RawData): number | undefined => {
  const m: unknown = JSON.parse(text(d));
  return m !== null &&
    typeof m === "object" &&
    "id" in m &&
    typeof m.id === "number"
    ? m.id
    : undefined;
};

/** Trame reçue, décodée en objet — `{}` pour tout autre JSON. */
const recordOf = (d: RawData): Record<string, unknown> => {
  const m: unknown = JSON.parse(text(d));
  return m !== null && typeof m === "object" && !Array.isArray(m)
    ? Object.fromEntries(Object.entries(m))
    : {};
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Attend qu'une condition soit vraie, sondée toutes les 50 ms, au plus `maxMs`. */
async function until(done: () => boolean, maxMs: number): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (!done() && Date.now() < deadline) await wait(50);
}
const make = (
  opts: NodefonySocketOptions,
  factory?: ConstructorParameters<typeof NodefonySocket>[1],
): NodefonySocket => {
  const c = new NodefonySocket({ banner: false, ...opts }, factory);
  open.push(c);
  return c;
};
const settled = async (
  p: Promise<unknown>,
  ms: number,
): Promise<"resolved" | "rejected" | "pending"> =>
  Promise.race([
    p.then(
      () => "resolved" as const,
      () => "rejected" as const,
    ),
    wait(ms).then(() => "pending" as const),
  ]);

afterEach(async () => {
  for (const c of open.splice(0)) c.disconnect();
  for (const d of decors.splice(0)) await d.close();
  for (const sock of rawSockets.splice(0)) sock.destroy();
  for (const s of raws.splice(0)) await new Promise((r) => s.close(r));
});

const protoClean = (): void => {
  expect(Reflect.get({}, "polluted")).to.equal(undefined);
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).to.deep.equal(
    PROTO_KEYS,
  );
};
const PROTO_KEYS = Object.getOwnPropertyNames(Object.prototype).sort();

describe("RED-TEAM NodefonySocket — serveur WebSocket hostile", () => {
  // ─── V1 : schémas d'URL hostiles ──────────────────────────────────────────
  it("V1 · file:, data:, javascript:, ftp: ne se connectent jamais (connect() rejette)", async () => {
    for (const url of [
      "file:///etc/passwd",
      "data:text/plain,x",
      "javascript:alert(1)",
      "ftp://127.0.0.1/x",
    ]) {
      let verdict: string;
      try {
        const c = make({ url, autoReconnect: false });
        verdict = await settled(c.connect(), 300);
      } catch {
        verdict = "rejected";
      }
      expect(verdict, url).to.equal("rejected");
    }
  });

  it("V1 · une URL http: devient ws: — la règle du constructeur WHATWG `new WebSocket()`", async () => {
    // WHATWG WebSockets, constructeur : « If urlRecord's scheme is "http", then
    // set urlRecord's scheme to "ws" ». Refuser http: serait plus strict que le
    // navigateur, sans menace à la clé : http: et ws: sont le même clair.
    const decor = await serve();
    const c = make({
      url: `http://127.0.0.1:${decor.port}/ws`,
      autoReconnect: false,
    });
    expect(await settled(c.connect(), 400)).to.equal("resolved");
    expect(decor.hits()).to.equal(1);
  });

  it("V1 · une URL avec userinfo (ws://user:pass@…) est refusée, identifiants jamais envoyés", async () => {
    const auths: (string | undefined)[] = [];
    const decor = await serve((ws, req) => {
      auths.push(req.headers.authorization);
      ws.send(WELCOME);
    });
    const c = make({
      url: `ws://admin:secret@127.0.0.1:${decor.port}/ws`,
      autoReconnect: false,
    });
    expect(await settled(c.connect(), 400)).to.equal("rejected");
    expect(auths.filter(Boolean)).to.deep.equal([]);
  });

  // ─── V2 : disconnect() depuis un écouteur ─────────────────────────────────
  it("V2 · disconnect() pendant un message : plus aucun événement du même lot, pas de reconnexion", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      for (let i = 1; i <= 3; i++)
        ws.send(JSON.stringify({ jsonrpc: "2.0", method: "evt", params: i }));
    });
    const c = make({ url: decor.url, reconnectDelay: 20 });
    const got: unknown[] = [];
    c.on("evt", (p) => {
      got.push(p);
      c.disconnect();
    });
    await c.connect().catch(() => {});
    await wait(300);
    expect(got).to.deep.equal([1]);
    expect(decor.hits()).to.equal(1);
    expect(c.state).to.equal("disconnected");
  });

  it("V2 · disconnect() pendant l'ouverture (état connected) : aucun état après, pas de reconnexion", async () => {
    const decor = await serve();
    const c = make({ url: decor.url, reconnectDelay: 20 });
    const states: string[] = [];
    let closedAt = -1;
    c.onState((s) => {
      states.push(s);
      if (s === "connected" && closedAt < 0) {
        c.disconnect();
        closedAt = states.length;
      }
    });
    await c.connect().catch(() => {});
    await wait(300);
    expect(decor.hits()).to.equal(1);
    expect(c.state).to.equal("disconnected");
    // Après disconnect(), seul « disconnected » peut apparaître.
    const after = states.slice(closedAt);
    expect(after.every((s) => s === "disconnected")).to.equal(true);
  });

  it("V2 · disconnect() pendant « connecting » : la socket ne s'ouvre pas, aucune relance", async () => {
    const decor = await serve();
    const c = make({ url: decor.url, reconnectDelay: 20 });
    const states: string[] = [];
    c.onState((s) => {
      states.push(s);
      if (s === "connecting") c.disconnect();
    });
    await c.connect().catch(() => {});
    await wait(300);
    expect(c.state).to.equal("disconnected");
    expect(states).to.not.include("connected");
    expect(decor.hits(), "reconnexion après disconnect()").to.be.at.most(1);
  });

  it("V2 · disconnect() depuis onNotice : aucune nouvelle tentative", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      setTimeout(() => ws.close(1011, "crash"), 20);
    });
    const c = make({ url: decor.url, reconnectDelay: 30 });
    c.onNotice(() => c.disconnect());
    await c.connect().catch(() => {});
    await wait(400);
    expect(decor.hits()).to.equal(1);
    expect(c.state).to.equal("disconnected");
  });

  it("V2 · disconnect() depuis onReconnect : la tentative programmée est annulée", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      setTimeout(() => ws.close(1011, "crash"), 20);
    });
    const c = make({ url: decor.url, reconnectDelay: 30 });
    c.onReconnect(() => c.disconnect());
    await c.connect().catch(() => {});
    await wait(400);
    expect(decor.hits()).to.equal(1);
    expect(c.state).to.equal("disconnected");
  });

  // ─── V3 : trames démesurées ───────────────────────────────────────────────
  it("V3 · rafale de trames de 2 Mo : le processus survit et la mémoire retenue reste bornée", async () => {
    const big = "A".repeat(2 * 1024 * 1024);
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      for (let i = 0; i < 40; i++)
        ws.send(
          JSON.stringify({ jsonrpc: "2.0", method: "big", params: { big } }),
        );
    });
    const c = make({ url: decor.url, reconnectDelay: 20 });
    await c.connect().catch(() => {});
    await wait(700);
    // Ce que le client retient de l'attaquant (journal de protocole) doit être borné :
    // 40 x 2 Mo = 80 Mo. Un journal qui garde les 300 dernières charges brutes gonfle sans borne.
    let retained = 0;
    try {
      retained = JSON.stringify(c.frameLog).length;
    } catch {
      retained = Number.MAX_SAFE_INTEGER;
    }
    expect(retained, "octets du journal de protocole").to.be.below(
      16 * 1024 * 1024,
    );
  });

  it("V3 · une trame de 64 Mo non-JSON ne plante pas le client", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      ws.send("x".repeat(64 * 1024 * 1024));
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect().catch(() => {});
    await wait(500);
    // Soit le client la refuse (fermeture 1009), soit il l'ignore ; jamais d'exception non rattrapée.
    expect(["connected", "disconnected", "error", "reconnecting"]).to.include(
      c.state,
    );
  });

  // ─── V4 : JSON-RPC malformé ───────────────────────────────────────────────
  it("V4 · non-JSON, null, nombre, tableau, objet vide : le client reste vivant et utilisable", async () => {
    const thrown: unknown[] = [];
    const onUncaught = (e: unknown): void => void thrown.push(e);
    process.on("uncaughtException", onUncaught);
    try {
      const decor = await serve((ws) => {
        ws.send(WELCOME);
        for (const f of [
          "not json{{",
          "null",
          "42",
          "true",
          '"str"',
          "[]",
          "[1,2,3]",
          "{}",
          '{"jsonrpc":"2.0"}',
          '{"jsonrpc":"1.0","method":"evt"}',
          '[{"jsonrpc":"2.0","method":"evt","params":1}]',
          "",
        ])
          ws.send(f);
      });
      const c = make({ url: decor.url, autoReconnect: false });
      await c.connect();
      await wait(200);
      expect(c.state).to.equal("connected");
      expect(decor.hits()).to.equal(1);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
    // Une trame hostile ne doit jamais devenir une exception non rattrapée du processus.
    expect(thrown.map(String)).to.deep.equal([]);
  });

  it("V4 · réponse à un `id` jamais émis : n'aboutit à aucune requête, n'en consomme aucune", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      ws.on("message", (d) => {
        if (idOf(d) === undefined) return;
        ws.send(
          JSON.stringify({ jsonrpc: "2.0", id: 987654, result: "forgé" }),
        );
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: 0, result: "forgé" }));
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: -1, result: "forgé" }));
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: null, result: "forgé" }));
      });
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect();
    const r = await c.request("quelconque", undefined, 250).then(
      (v) => ({ ok: v }),
      (e: unknown) => ({ err: e }),
    );
    expect(r, "la réponse forgée a résolu la requête").to.have.property("err");
  });

  it("V4 · réponse dupliquée pour un même `id` : la première gagne, la seconde est ignorée", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      ws.on("message", (d) => {
        const id = idOf(d);
        if (id === undefined) return;
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, result: "vrai" }));
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, result: "double" }));
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -1, message: "x" },
          }),
        );
      });
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect();
    expect(await c.request("a", undefined, 500)).to.equal("vrai");
    await wait(100);
    expect(c.state).to.equal("connected");
    // La socket reste utilisable : une seconde requête obtient SA réponse.
    expect(await c.request("b", undefined, 500)).to.equal("vrai");
  });

  it("V4 · `result` ET `error` à la fois : réponse invalide, jamais prise pour un succès", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      ws.on("message", (d) => {
        const id = idOf(d);
        if (id === undefined) return;
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: "secret",
            error: { code: -32000, message: "refusé" },
          }),
        );
      });
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect();
    const r = await c.request("a", undefined, 300).then(
      (v) => ({ ok: v }),
      (e: unknown) => ({ err: e }),
    );
    expect(r, "résolu avec le result malgré l'error").to.have.property("err");
  });

  it("V4 · réponse sans `result` ni `error`, ou `error` mal typé : jamais de succès, pas de crash", async () => {
    let n = 0;
    const variants: Record<string, unknown>[] = [
      { jsonrpc: "2.0" },
      { jsonrpc: "2.0", error: "chaîne" },
      { jsonrpc: "2.0", error: null },
      { jsonrpc: "2.0", error: { code: "x", message: 42 } },
      { jsonrpc: "2.0", error: [] },
    ];
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      ws.on("message", (d) => {
        const id = idOf(d);
        if (id === undefined) return;
        ws.send(JSON.stringify({ ...variants[n++ % variants.length], id: id }));
      });
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect();
    for (let i = 0; i < variants.length; i++) {
      const r = await c.request("a", undefined, 120).then(
        () => "ok",
        () => "err",
      );
      // Une réponse sans `result` explicite ne vaut pas succès avec une valeur forgée.
      expect(r === "ok" || r === "err").to.equal(true);
    }
    expect(c.state).to.equal("connected");
  });

  it("V4 · `id` de type faux (objet, tableau, booléen, chaîne numérique) ne résout aucune requête", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      ws.on("message", (d) => {
        const id = idOf(d);
        if (id === undefined) return;
        for (const forged of [
          {},
          [id],
          true,
          String(id),
          `${id}.0`,
          Number.POSITIVE_INFINITY,
        ])
          ws.send(
            JSON.stringify({ jsonrpc: "2.0", id: forged, result: "forgé" }),
          );
      });
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect();
    const r = await c.request("a", undefined, 250).then(
      (v) => ({ ok: v }),
      (e: unknown) => ({ err: e }),
    );
    expect(r, "un `id` de mauvais type a résolu la requête").to.have.property(
      "err",
    );
  });

  it("V4 · requête serveur sur méthode inconnue : le client répond -32601, sans exécuter autre chose", async () => {
    const replies: Record<string, unknown>[] = [];
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      ws.on("message", (d) => replies.push(recordOf(d)));
      for (const [i, method] of [
        "inconnue",
        "constructor",
        "__proto__",
        "toString",
        "hasOwnProperty",
        "",
      ].entries())
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: 5000 + i, method }));
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect();
    await wait(250);
    expect(c.state).to.equal("connected");
    const answers = replies.filter(
      (r) => typeof r.id === "number" && r.id >= 5000,
    );
    expect(answers.length, "une réponse par requête").to.equal(6);
    for (const a of answers) {
      expect(a.result, JSON.stringify(a)).to.equal(undefined);
      const err = a.error;
      expect(
        err !== null && typeof err === "object" && "code" in err
          ? err.code
          : undefined,
      ).to.equal(-32601);
    }
  });

  it("V4 · `method` et `params` de types faux dans une notification : rien ne lève", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      for (const m of [
        { jsonrpc: "2.0", method: 42, params: 1 },
        { jsonrpc: "2.0", method: null },
        { jsonrpc: "2.0", method: {}, params: [] },
        { jsonrpc: "2.0", method: "evt", params: "x".repeat(10) },
        { jsonrpc: "2.0", method: ["evt"] },
        { jsonrpc: "2.0", id: {}, method: "evt" },
      ])
        ws.send(JSON.stringify(m));
    });
    const c = make({ url: decor.url, autoReconnect: false });
    c.on("evt", () => {});
    await c.connect();
    await wait(200);
    expect(c.state).to.equal("connected");
  });

  // ─── V5 : pollution de prototype ──────────────────────────────────────────
  it("V5 · `__proto__`, `constructor`, `prototype` dans welcome, messages et requêtes : Object.prototype intact", async () => {
    const poison =
      '{"__proto__":{"polluted":"oui"},"constructor":{"prototype":{"polluted":"oui"}},"prototype":{"polluted":"oui"}}';
    const decor = await serve((ws) => {
      ws.send(
        `{"jsonrpc":"2.0","method":"realtime:welcome","params":{"identity":${poison},"env":${poison},"channels":["__proto__","constructor","prototype"],"methods":["__proto__","constructor"],"__proto__":{"polluted":"oui"}}}`,
      );
      for (const method of [
        "__proto__",
        "constructor",
        "prototype",
        "toString",
        "hasOwnProperty",
        "realtime:denied",
        "realtime:notice",
        "evt",
      ])
        ws.send(`{"jsonrpc":"2.0","method":"${method}","params":${poison}}`);
      ws.send(
        `{"jsonrpc":"2.0","id":7001,"method":"__proto__","params":${poison}}`,
      );
      ws.on("message", (d) => {
        const id = idOf(d);
        if (id === undefined) return;
        ws.send(`{"jsonrpc":"2.0","id":${id},"result":${poison}}`);
      });
    });
    const c = make({ url: decor.url, autoReconnect: false });
    c.on("evt", () => {});
    c.on("__proto__", () => {});
    c.on("constructor", () => {});
    await c.connect();
    await c.request("a", undefined, 300).catch(() => {});
    c.subscribe("__proto__");
    c.subscribe("constructor");
    await wait(200);
    protoClean();
    // L'enveloppe des profils / statistiques par canal ne doit pas non plus muter les prototypes.
    c.getStats();
    c.getChannelStats("__proto__");
    c.getChannelStats("constructor");
    protoClean();
    expect(c.state).to.equal("connected");
  });

  it("V5 · welcome aux champs mal typés : identité refusée, listes filtrées — jamais un type menteur", async () => {
    const decor = await serve((ws) => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "realtime:welcome",
          params: {
            identity: {
              type: "session",
              authenticated: "oui",
              userIdentifier: 42,
              roles: "ROLE_ADMIN",
              scopes: {},
            },
            channels: ["a", 1, null, { x: 1 }, "b"],
            methods: "nodefony:kernel:ping",
          },
        }),
      );
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect();
    await wait(100);
    // `roles: "ROLE_ADMIN"` typé `string[]` : `.includes("ROLE_ADMIN")` dirait vrai.
    expect(c.identity).to.equal(null);
    expect(c.serverChannels).to.deep.equal(["a", "b"]);
    expect(c.serverMethods).to.equal(null);
  });

  it("V5 · welcome conforme : identité recopiée champ par champ", async () => {
    const identity = {
      type: "session",
      authenticated: true,
      userIdentifier: "user-42",
      roles: ["ROLE_USER"],
      scopes: [],
    };
    const decor = await serve((ws) => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "realtime:welcome",
          params: { identity, channels: ["a"], methods: ["m"] },
        }),
      );
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect();
    await wait(100);
    expect(c.identity).to.deep.equal(identity);
    expect(c.serverChannels).to.deep.equal(["a"]);
    expect(c.serverMethods).to.deep.equal(["m"]);
  });

  // ─── V6 : reconnexions synchronisées ──────────────────────────────────────
  it("V6 · N clients coupés ensemble se reconnectent avec de la GIGUE (délais pas tous identiques)", async () => {
    const decor = await serve();
    const N = 12;
    const delays: number[] = [];
    const clients: NodefonySocket[] = [];
    for (let i = 0; i < N; i++) {
      const c = make({ url: decor.url, reconnectDelay: 400 });
      c.onReconnect((info) => {
        if (info.attempt === 1) delays.push(info.delay);
      });
      clients.push(c);
    }
    await Promise.all(clients.map((c) => c.connect()));
    for (const ws of decor.conns) ws.terminate();
    await wait(150);
    expect(delays.length, "toutes les reconnexions sont planifiées").to.equal(
      N,
    );
    // 12 horloges synchrones sans gigue donneraient UNE seule valeur : thundering herd.
    expect(new Set(delays).size, `délais: ${delays.join(",")}`).to.be.above(2);
  });

  it("V6 · un serveur qui ferme aussitôt chaque connexion ne provoque pas de tempête (plancher)", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      ws.close(1011, "boom");
    });
    make({ url: decor.url, reconnectDelay: 0, reconnectDelayMax: 0 })
      .connect()
      .catch(() => {});
    await wait(500);
    // Même avec un délai configuré à 0, un client sain impose un plancher.
    expect(decor.hits()).to.be.at.most(10);
  });

  it("V6 · plancher aussi quand le serveur refuse la poignée de main (jamais d'ouverture)", async () => {
    const srv = http.createServer();
    let hits = 0;
    srv.on("upgrade", (_req, sock) => {
      // La socket d'un `upgrade` n'a AUCUN écouteur `error` (Node retire le
      // sien au passage) : sous Windows, le client coupe en RST, et le
      // `ECONNRESET` qui en sort devient une exception non rattrapée.
      sock.on("error", () => {});
      hits++;
      sock.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = portOf(srv.address());
    const c = make({
      url: `ws://127.0.0.1:${port}/ws`,
      reconnectDelay: 0,
      reconnectDelayMax: 0,
    });
    c.connect().catch(() => {});
    await wait(500);
    c.disconnect();
    await new Promise((r) => srv.close(r));
    expect(hits).to.be.at.most(10);
  });

  it("V6 · connexions éphémères répétées (welcome puis fermeture) : le back-off s'allonge, pas de tempête", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      setTimeout(() => ws.close(1011, "boom"), 5);
    });
    const delays: number[] = [];
    const c = make({
      url: decor.url,
      reconnectDelay: 40,
      reconnectDelayMax: 5000,
    });
    c.onReconnect((i) => delays.push(i.delay));
    c.connect().catch(() => {});
    await wait(800);
    // Un serveur qui accepte puis coupe sans cesse doit être ménagé de plus en plus (doublement),
    // pas sondé à délai constant parce que « la dernière connexion a réussi ».
    expect(delays.length).to.be.above(1);
    expect(delays.at(-1) ?? 0).to.be.above(
      delays[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(decor.hits()).to.be.at.most(8);
  });

  it("V6 · le délai reste fini et plafonné par reconnectDelayMax", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      ws.close(1011, "boom");
    });
    const delays: number[] = [];
    const c = make({
      url: decor.url,
      reconnectDelay: 100,
      reconnectDelayMax: 200,
    });
    c.onReconnect((i) => delays.push(i.delay));
    c.connect().catch(() => {});
    await wait(1000);
    expect(delays.length).to.be.above(3);
    for (const d of delays) {
      expect(Number.isFinite(d)).to.equal(true);
      expect(d).to.be.at.most(200);
    }
  });

  it("V6 · le plancher l'emporte sur un plafond configuré plus bas", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      ws.close(1011, "boom");
    });
    const delays: number[] = [];
    const c = make({
      url: decor.url,
      reconnectDelay: 5,
      reconnectDelayMax: 40,
    });
    c.onReconnect((i) => delays.push(i.delay));
    c.connect().catch(() => {});
    await wait(500);
    expect(delays.length).to.be.at.least(1);
    for (const d of delays) expect(d).to.be.at.least(100);
  });

  it("V6 · un `reconnectDelay` démesuré ne dépasse jamais l'horloge de Node (2^31-1 ms)", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      ws.close(1011, "boom");
    });
    const delays: number[] = [];
    const c = make({ url: decor.url, reconnectDelay: 1e15 });
    c.onReconnect((i) => delays.push(i.delay));
    c.connect().catch(() => {});
    await wait(200);
    expect(delays.length).to.be.at.least(1);
    // Au-delà, setTimeout ramène à 1 ms : tempête de reconnexions.
    expect(delays[0]).to.be.at.most(2 ** 31 - 1);
    expect(decor.hits()).to.be.at.most(2);
  });

  // ─── V7 : codes de fermeture ──────────────────────────────────────────────
  for (const code of [1008, 4001, 1002, 1003, 1007]) {
    it(`V7 · fermeture serveur ${code} (politique/révocation/protocole) : pas de reconnexion en boucle`, async () => {
      const decor = await serve((ws) => {
        ws.send(WELCOME);
        setTimeout(() => ws.close(code, "revoked"), 10);
      });
      const c = make({ url: decor.url, reconnectDelay: 20 });
      await c.connect().catch(() => {});
      await wait(500);
      expect(decor.hits(), `rejeu d'identité après ${code}`).to.equal(1);
      expect(c.state).to.not.equal("connected");
    });
  }

  it("V7 · fermeture 1000 puis fermeture sans code : jamais de tempête", async () => {
    for (const mode of ["1000", "none"] as const) {
      const decor = await serve((ws) => {
        ws.send(WELCOME);
        if (mode === "1000") ws.close(1000, "bye");
        else ws.terminate();
      });
      const c = make({ url: decor.url, reconnectDelay: 100 });
      await c.connect().catch(() => {});
      await wait(350);
      expect(decor.hits(), mode).to.be.at.most(4);
      c.disconnect();
    }
  });

  // ─── V8 : conception propre ───────────────────────────────────────────────
  it("V8 · un serveur qui n'ouvre jamais la poignée de main : connect() finit par échouer vite", async () => {
    const r = await raw(() => {
      /* silence total */
    });
    const c = make({ url: r.url, autoReconnect: false, connectTimeout: 400 });
    const verdict = await settled(c.connect(), 1500);
    // Pas de borne = connect() pendu à jamais (fuite de promesse, UI bloquée en « connecting »).
    expect(verdict).to.equal("rejected");
    expect(c.state).to.not.equal("connected");
  });

  it("V8 · un serveur qui ouvre mais n'envoie jamais le welcome : connect() n'attend pas indéfiniment", async () => {
    const decor = await serve(() => {
      /* ouvre, ne dit rien */
    });
    const c = make({ url: decor.url, autoReconnect: false });
    const verdict = await settled(c.connect(), 1500);
    expect(verdict).to.not.equal("pending");
  });

  it("V8 · une requête restée sans réponse est rejetée à son délai et ne laisse rien de pendant", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect();
    const t0 = Date.now();
    const err = await c.request("muet", undefined, 150).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).to.not.equal(null);
    expect(Date.now() - t0).to.be.below(800);
    // 500 requêtes muettes en parallèle : toutes rejetées, aucune ne reste en vol.
    const many = await Promise.all(
      Array.from({ length: 500 }, () =>
        c.request("muet", undefined, 100).then(
          () => "ok",
          () => "rejeté",
        ),
      ),
    );
    expect(many.every((x) => x === "rejeté")).to.equal(true);
  });

  it("V8 · disconnect() rejette immédiatement les requêtes en vol (pas d'attente du délai)", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect();
    const p = c.request("muet", undefined, 30_000);
    c.disconnect();
    expect(await settled(p, 300)).to.equal("rejected");
  });

  // Sous Node 24, l'undici embarqué (le `WebSocket` global) lève HORS de toute
  // promesse sur ce cas — `TypeError: Cannot read properties of null (reading
  // 'includes')` dans `processResponse`, faute d'en-tête de sous-protocole côté
  // requête — et le processus reçoit une exception non rattrapée. Défaut de la
  // PLATEFORME, que le client ne peut ni attraper ni contourner (passer `[]` ne
  // pose aucun en-tête) ; absent de Node 26. Le cas ne prouve donc rien sous 24.
  it.skipIf(Number(process.versions.node.split(".")[0]) < 26)(
    "V8 · le serveur impose un sous-protocole que le client n'a pas demandé : connexion refusée (RFC 6455 §4.1)",
    async () => {
      const decor = await serve(undefined, (h) =>
        h.push("Sec-WebSocket-Protocol: evil"),
      );
      const c = make({ url: decor.url, autoReconnect: false });
      const verdict = await settled(c.connect(), 600);
      expect(verdict).to.not.equal("resolved");
      expect(c.state).to.not.equal("connected");
    },
  );

  it("V8 · un Sec-WebSocket-Accept falsifié n'ouvre pas la connexion (RFC 6455 §4.2.2)", async () => {
    const r = await raw((sock) => {
      sock.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: AAAAAAAAAAAAAAAAAAAAAAAAAAA=\r\n\r\n",
      );
      sock.write(Buffer.from([0x81, 0x01, 0x78]));
    });
    const c = make({ url: r.url, autoReconnect: false });
    const verdict = await settled(c.connect(), 600);
    expect(verdict).to.not.equal("resolved");
    expect(c.state).to.not.equal("connected");
  });

  it("V8 · messages binaires : un `welcome` binaire n'établit pas d'identité, pas de crash", async () => {
    const decor = await serve((ws) => {
      ws.send(
        Buffer.from(
          '{"jsonrpc":"2.0","method":"realtime:welcome","params":{"identity":{"authenticated":true,"roles":["ROLE_ADMIN"]}}}',
        ),
        { binary: true },
      );
      ws.send(Buffer.alloc(1024 * 1024, 0xff), { binary: true });
      ws.send(Buffer.alloc(0), { binary: true });
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await settled(c.connect(), 300);
    expect(c.identity?.authenticated ?? false).to.equal(false);
  });

  it("V8 · flood de pings WebSocket et de notifications : la boucle d'événements reste réactive", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      for (let i = 0; i < 3000; i++) ws.ping();
      for (let i = 0; i < 20_000; i++)
        ws.send('{"jsonrpc":"2.0","method":"evt","params":1}');
    });
    const c = make({ url: decor.url, autoReconnect: false });
    let seen = 0;
    c.on("evt", () => seen++);
    await c.connect();
    const t0 = Date.now();
    await wait(50);
    expect(Date.now() - t0, "boucle d'événements bloquée").to.be.below(1500);
    expect(c.state).to.equal("connected");
    expect(seen).to.be.at.most(20_000);
  });

  it("V8 · flood de requêtes serveur : le client répond à chacune sans gonfler ni planter", async () => {
    let replies = 0;
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      ws.on("message", () => replies++);
      for (let i = 0; i < 5000; i++)
        ws.send(`{"jsonrpc":"2.0","id":${100000 + i},"method":"nope"}`);
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect();
    // Attente sur la CONDITION, pas sur une durée : un runner lent n'avait
    // encore rien rendu à 600 ms (macOS, Node 24) ; la borne ne sert qu'à échouer.
    await until(() => replies >= 5000, 10_000);
    expect(c.state).to.equal("connected");
    expect(replies).to.equal(5000);
  });

  it("V8 · le journal de protocole reste borné sous flood", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      for (let i = 0; i < 5000; i++)
        ws.send(`{"jsonrpc":"2.0","method":"evt","params":${i}}`);
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect();
    await wait(400);
    expect(c.frameLog.length).to.be.at.most(1000);
  });

  it("V8 · le jeton n'apparaît jamais dans le journal de protocole renvoyé au code appelant", async () => {
    const decor = await serve((ws) => {
      ws.send(WELCOME);
      ws.send(
        '{"jsonrpc":"2.0","method":"evt","params":{"token":"SECRET-XYZ","nested":{"apiKey":"SECRET-XYZ","Authorization":"SECRET-XYZ"}}}',
      );
    });
    const c = make({ url: decor.url, autoReconnect: false });
    await c.connect();
    await wait(150);
    expect(JSON.stringify(c.frameLog)).to.not.include("SECRET-XYZ");
  });
});
