/// <reference types="node" />
/**
 * Integration — historique de la supervision et sonde de débit de Studio
 * (#618 D4/D5/D6/D10), sur le serveur RÉEL.
 * Requires: server running on 5152 (wss), app de dev en codec CBOR (D1).
 * Start: /start-server
 *
 * Ce que les tests unitaires ne voient pas : le CHEMIN. L'historique est servi
 * par le broker du plan d'administration, donc par ses deux transports — le
 * REST (octets sous `$bytes`, en-tête `x-nodefony-bytes`) et le pont
 * `api.request` de la socket (octets natifs sous CBOR, `$bytes` pour un client
 * resté en texte). La sonde de débit passe par le verrou de trame de security.
 */
import { describe, it, expect } from "vitest";
import https from "node:https";
import WebSocket from "ws";
import {
  BYTES_MARKER_HEADER,
  textCodecForMarker,
  fromLittleEndianBytes,
  createThroughputPayload,
  PLATFORM_METHODS,
  SUPERVISION_HISTORY_COLUMNS,
  SUPERVISION_LOOP_BANDS,
  type ISupervisionHistory,
  type IFrameCodec,
} from "nodefony";
import { CBOR_FRAME_CODEC } from "nodefony/cbor";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const HUB_URL = "wss://127.0.0.1:5152/nodefony/studio/api/realtime";
const HISTORY = "/nodefony/studio/api/supervision/history";
const TIMEOUT = 10_000;
const PASSWORD = "secret-de-dev-42";

type Res = { status: number; headers: Record<string, unknown>; text: string };
type Reply = {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function request(
  path: string,
  method: string,
  headers: Record<string, string> = {},
  payload?: unknown,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data =
      payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const req = https.request(
      {
        ...BASE,
        path,
        method,
        headers: {
          ...headers,
          ...(data
            ? {
                "content-type": "application/json",
                "content-length": String(data.length),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    if (data) req.write(data);
    req.end();
  });
}

async function loginCookie(identifier: string): Promise<string> {
  const res = await request(
    "/nodefony/security/api/auth/login",
    "POST",
    {},
    { username: identifier, password: PASSWORD },
  );
  expect(res.status, `login ${identifier}`).to.equal(200);
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(first, "cookie de session").to.be.a("string");
  return String(first).split(";")[0] ?? "";
}

/**
 * Client minimal de la socket Studio. `cbor` : offre le sous-protocole CBOR ;
 * sinon client texte, qui relit les octets selon le marqueur de l'accueil.
 */
function connect(
  cookie: string,
  cbor: boolean,
): Promise<{
  protocol: string;
  call: (method: string, params: unknown) => Promise<Reply>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB_URL, cbor ? [CBOR_FRAME_CODEC.protocol] : [], {
      rejectUnauthorized: false,
      headers: { cookie },
    });
    let codec: IFrameCodec | null = null;
    const pending = new Map<number, (r: Reply) => void>();
    let nextId = 1;
    const timer = setTimeout(
      () => reject(new Error("welcome timeout")),
      TIMEOUT,
    );
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      // L'accueil arrive toujours en texte ; la bascule vers CBOR suit.
      const frame =
        codec === null || (!isBinary && codec === CBOR_FRAME_CODEC)
          ? (JSON.parse(String(data)) as Record<string, unknown>)
          : (codec.decode(
              isBinary ? new Uint8Array(data) : String(data),
            ) as Record<string, unknown>);
      if (frame.method === "realtime:welcome") {
        clearTimeout(timer);
        const params = frame.params as { bytes?: string };
        codec =
          ws.protocol === CBOR_FRAME_CODEC.protocol
            ? CBOR_FRAME_CODEC
            : textCodecForMarker(params.bytes);
        const used = codec;
        resolve({
          protocol: ws.protocol,
          call: (method, callParams) =>
            new Promise<Reply>((res, rej) => {
              const id = nextId++;
              const t = setTimeout(
                () => rej(new Error(`rpc timeout ${method}`)),
                TIMEOUT,
              );
              pending.set(id, (r) => {
                clearTimeout(t);
                res(r);
              });
              ws.send(
                used.encode({ jsonrpc: "2.0", id, method, params: callParams }),
              );
            }),
          close: () => ws.close(),
        });
        return;
      }
      if (typeof frame.id === "number" && frame.method === undefined) {
        pending.get(frame.id)?.(frame as Reply);
        pending.delete(frame.id);
      }
    });
  });
}

/** Vérifie la forme d'un historique relu et rend sa colonne `ts`. */
function checkHistory(h: ISupervisionHistory, where: string): number[] {
  expect(h.columns, where).to.deep.equal([...SUPERVISION_HISTORY_COLUMNS]);
  expect(h.loopColumns, where).to.deep.equal([...SUPERVISION_LOOP_BANDS]);
  expect(h.values, `${where} : séries en octets`).to.be.instanceOf(Uint8Array);
  expect(h.loop, `${where} : bandes en octets`).to.be.instanceOf(Uint8Array);
  const values = fromLittleEndianBytes(h.values, Float64Array);
  const loop = fromLittleEndianBytes(h.loop, Float32Array);
  expect(values.length, where).to.equal(
    SUPERVISION_HISTORY_COLUMNS.length * h.length,
  );
  expect(loop.length, where).to.equal(SUPERVISION_LOOP_BANDS.length * h.length);
  const ts = Array.from(values.subarray(0, h.length));
  for (let i = 1; i < ts.length; i += 1) {
    expect(ts[i], `${where} : ts croissants`).to.be.greaterThan(
      ts[i - 1] ?? Infinity,
    );
  }
  return ts;
}

describe("Studio — historique de la supervision, deux transports (requires server)", () => {
  it("REST : 200, octets sous `$bytes` annoncés par l'en-tête, relus en séries", async () => {
    const cookie = await loginCookie("admin");
    await request(HISTORY, "GET", { cookie }); // première visite : démarre l'enregistreur
    await new Promise((r) => setTimeout(r, 2200));
    const res = await request(HISTORY, "GET", { cookie });
    expect(res.status).to.equal(200);
    const marker = res.headers[BYTES_MARKER_HEADER];
    expect(
      marker,
      "app de dev en CBOR (D1) → REST sous convention d'octets",
    ).to.be.a("string");
    expect(res.text).to.include(String(marker));
    const h = textCodecForMarker(marker).decode(
      res.text,
    ) as ISupervisionHistory;
    const ts = checkHistory(h, "REST");
    expect(h.length, "≥ 2 points après 2 s").to.be.at.least(2);
    expect(
      Date.now() - (ts.at(-1) ?? 0),
      "dernier point récent",
    ).to.be.lessThan(5000);
  });

  it("pont socket : même historique en CBOR (octets natifs) et en texte (`$bytes`)", async () => {
    const cookie = await loginCookie("admin");
    for (const cbor of [true, false]) {
      const hub = await connect(cookie, cbor);
      try {
        if (cbor) expect(hub.protocol).to.equal(CBOR_FRAME_CODEC.protocol);
        const reply = await hub.call("api.request", { path: HISTORY });
        expect(
          reply.error,
          `${cbor ? "CBOR" : "texte"} : pas d'erreur`,
        ).to.equal(undefined);
        const h = reply.result as ISupervisionHistory;
        checkHistory(h, cbor ? "pont CBOR" : "pont texte");
        expect(h.length).to.be.at.least(1);
      } finally {
        hub.close();
      }
    }
  });

  it("un ROLE_USER est refusé (403), en REST comme par le pont", async () => {
    const cookie = await loginCookie("user");
    const res = await request(HISTORY, "GET", { cookie });
    expect(res.status).to.equal(403);
    const hub = await connect(cookie, true);
    try {
      const reply = await hub.call("api.request", { path: HISTORY });
      expect(reply.result).to.equal(undefined);
      const data = reply.error?.data as { status?: number } | undefined;
      expect(data?.status).to.equal(403);
    } finally {
      hub.close();
    }
  });
});

describe("Studio — sonde de débit `nodefony:realtime:throughput` (requires server)", () => {
  it("administrateur : 64 Ko rendus à l'octet près, en CBOR comme en texte", async () => {
    const cookie = await loginCookie("admin");
    const expected = createThroughputPayload(65536);
    for (const cbor of [true, false]) {
      const hub = await connect(cookie, cbor);
      try {
        const reply = await hub.call(PLATFORM_METHODS.throughput, {
          size: 65536,
        });
        expect(reply.error, cbor ? "CBOR" : "texte").to.equal(undefined);
        const result = reply.result as { size: number; bytes: Uint8Array };
        expect(result.size).to.equal(65536);
        expect(result.bytes).to.be.instanceOf(Uint8Array);
        expect(
          Buffer.from(result.bytes).equals(expected),
          "octets identiques",
        ).to.equal(true);
      } finally {
        hub.close();
      }
    }
  });

  it("taille hors liste → -32602, rien n'est fabriqué", async () => {
    const hub = await connect(await loginCookie("admin"), true);
    try {
      const reply = await hub.call(PLATFORM_METHODS.throughput, { size: 1000 });
      expect(reply.result).to.equal(undefined);
      expect(reply.error?.code).to.equal(-32602);
    } finally {
      hub.close();
    }
  });

  it("un ROLE_USER, qui ouvre pourtant la socket, est refusé par le verrou de trame", async () => {
    const hub = await connect(await loginCookie("user"), true);
    try {
      const reply = await hub.call(PLATFORM_METHODS.throughput, { size: 1024 });
      expect(reply.result, "aucune charge pour un non-administrateur").to.equal(
        undefined,
      );
      expect(reply.error, "refus du verrou").to.not.equal(undefined);
    } finally {
      hub.close();
    }
  });
});
