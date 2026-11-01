import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { startSpareApp, type ISpareApp } from "nodefony/testing";
import { NodefonySocket } from "nodefony/client";
import { CBOR_FRAME_CODEC } from "nodefony/cbor";
import { JSON_BYTES_FRAME_CODEC, type IFrameCodec } from "nodefony";

/**
 * **Codec binaire sur un VRAI serveur** (#618, ADR-0022 §2).
 *
 * Le banc en mémoire (`realtimeCodec.e2e`) prouve la négociation et la bascule
 * avec une connexion simulée. Il ne voit pas ce que seul le fil montre : que
 * `ws` renvoie bien le sous-protocole choisi dans le `101`, que les trames
 * partent en BINAIRE (opcode 2) et non en texte, que le `Buffer` livré par
 * `ws` se décode, et que la diffusion mutualisée sert deux connexions de codecs
 * différents sur des sockets réelles.
 *
 * Décor : un exemplaire `production` JETABLE de l'application du dépôt
 * (`startSpareApp`, ports à part — le serveur de développement n'est pas
 * touché), codec `cbor`, modules de banc chargés par dérogation
 * (`NF_WITH_DEV_MODULES`) pour atteindre `/api/live/codec`. Il vit dans le lot
 * `test:cluster` (vrais process) sous `NF_RUN_CLUSTER_E2E`, avec les autres
 * bancs qui démarrent un processus.
 */

const RUN = process.env.NF_RUN_CLUSTER_E2E === "1";
const HTTP_PORT = 5381;
const HTTPS_PORT = 5382;
const REPO_ROOT = fileURLToPath(
  new URL("../../../../../../../", import.meta.url),
);
const URL_CODEC = `ws://127.0.0.1:${HTTP_PORT}/api/live/codec`;
const CBOR = "nodefony.jsonrpc.cbor.v1";
const TEXT = "nodefony.jsonrpc.v1";

/** Socket WHATWG brute : ce que le fil livre, trame par trame. */
interface IRawPeer {
  ws: WebSocket;
  frames: Array<string | ArrayBuffer>;
  /** Attend la `n`-ième trame reçue (1 = l'accueil). */
  nth: (n: number) => Promise<string | ArrayBuffer>;
}

function openRaw(protocols: string[]): Promise<IRawPeer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_CODEC, protocols);
    ws.binaryType = "arraybuffer";
    const frames: Array<string | ArrayBuffer> = [];
    const waiters: Array<() => void> = [];
    ws.addEventListener("message", (ev: MessageEvent<string | ArrayBuffer>) => {
      frames.push(ev.data);
      for (const w of waiters.splice(0)) w();
    });
    const nth = (n: number): Promise<string | ArrayBuffer> =>
      new Promise((ok, ko) => {
        const deadline = setTimeout(
          () => ko(new Error(`trame n°${n} jamais reçue`)),
          5000,
        );
        const check = (): void => {
          const f = frames[n - 1];
          if (f !== undefined) {
            clearTimeout(deadline);
            ok(f);
          } else waiters.push(check);
        };
        check();
      });
    ws.addEventListener("open", () => resolve({ ws, frames, nth }));
    ws.addEventListener("error", () =>
      reject(new Error("poignée de main refusée")),
    );
  });
}

async function openClient(
  codec: IFrameCodec | undefined,
): Promise<NodefonySocket> {
  const client = new NodefonySocket({
    url: URL_CODEC,
    autoReconnect: false,
    ...(codec === undefined ? {} : { codec }),
  });
  // `connect()` se résout à l'ouverture ; le codec n'est en vigueur qu'à
  // l'ACCUEIL, qui suit.
  const welcomed = new Promise<void>((resolve) =>
    client.on("realtime:welcome", () => resolve()),
  );
  await client.connect();
  await welcomed;
  return client;
}

describe.skipIf(!RUN)("Codec CBOR sur un vrai serveur WebSocket (#618)", () => {
  let app: ISpareApp | null = null;

  beforeAll(async () => {
    app = await startSpareApp({
      port: HTTP_PORT,
      httpsPort: HTTPS_PORT,
      root: REPO_ROOT,
      env: {
        NODE_ENV: "production",
        NF_LOG_DRIVER: "null",
        NF_REALTIME_CODEC: "cbor",
        NF_WITH_DEV_MODULES: "1",
      },
    });
  }, 90_000);

  afterAll(async () => {
    await app?.stop();
  });

  it("le `101` renvoie CBOR, l'accueil est du texte, tout ce qui suit part en binaire", async () => {
    const raw = await openRaw([CBOR, TEXT]);
    try {
      expect(raw.ws.protocol).toBe(CBOR);
      const welcome = await raw.nth(1);
      expect(typeof welcome).toBe("string");
      expect(
        (JSON.parse(welcome as string) as { params: { codec?: string } }).params
          .codec,
      ).toBe(CBOR);
      raw.ws.send(
        CBOR_FRAME_CODEC.encode({
          jsonrpc: "2.0",
          id: 1,
          method: "codec:echo",
          params: { data: new Uint8Array([0, 128, 255]) },
        }),
      );
      const reply = await raw.nth(2);
      // Opcode binaire : `ws` a reçu des octets et les a envoyés comme tels.
      expect(reply).toBeInstanceOf(ArrayBuffer);
      const decoded = CBOR_FRAME_CODEC.decode(
        new Uint8Array(reply as ArrayBuffer),
      ) as { id: number; result: { echoed: { data: Uint8Array } } };
      expect(decoded.id).toBe(1);
      expect([...decoded.result.echoed.data]).toEqual([0, 128, 255]);
    } finally {
      raw.ws.close();
    }
  });

  it("une trame CBOR illisible est écartée, la connexion sert encore", async () => {
    const raw = await openRaw([CBOR]);
    try {
      await raw.nth(1);
      raw.ws.send(new Uint8Array([0xff, 0xfe, 0x00]));
      raw.ws.send(
        CBOR_FRAME_CODEC.encode({
          jsonrpc: "2.0",
          id: 2,
          method: "codec:echo",
          params: { ok: true },
        }),
      );
      const reply = await raw.nth(2);
      const decoded = CBOR_FRAME_CODEC.decode(
        new Uint8Array(reply as ArrayBuffer),
      ) as { id: number; result: { echoed: { ok: boolean } } };
      // Aucune réponse à la trame illisible : la suivante est celle de `id: 2`.
      expect(decoded.id).toBe(2);
      expect(decoded.result.echoed.ok).toBe(true);
      expect(raw.ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      raw.ws.close();
    }
  });

  it("le `101` renvoie le choix du SERVEUR, pas le premier offert (RFC 6455 §4.2.2)", async () => {
    // Texte offert en premier : le défaut de `ws` le renverrait, alors que le
    // serveur retient CBOR — l'écho dirait au navigateur un autre codec que
    // celui de la connexion.
    const raw = await openRaw([TEXT, CBOR]);
    try {
      expect(raw.ws.protocol).toBe(CBOR);
      const welcome = await raw.nth(1);
      expect(
        (JSON.parse(welcome as string) as { params: { codec?: string } }).params
          .codec,
      ).toBe(CBOR);
    } finally {
      raw.ws.close();
    }
  });

  it("client sans offre : le texte reste le fil, sans sous-protocole", async () => {
    const raw = await openRaw([]);
    try {
      expect(raw.ws.protocol).toBe("");
      const welcome = await raw.nth(1);
      expect(
        (JSON.parse(welcome as string) as { params: { codec?: string } }).params
          .codec,
      ).toBeUndefined();
      raw.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "codec:echo",
          params: { n: 1 },
        }),
      );
      expect(typeof (await raw.nth(2))).toBe("string");
    } finally {
      raw.ws.close();
    }
  });

  it("NodefonySocket : octets aller-retour en `Uint8Array`, sans base64", async () => {
    const client = await openClient(CBOR_FRAME_CODEC);
    try {
      expect(client.codec).toBe(CBOR);
      const bytes = new Uint8Array([9, 8, 7, 0, 255]);
      const res = await client.request<
        "codec:echo",
        { echoed: { data: Uint8Array } }
      >("codec:echo", { data: bytes });
      expect(res.echoed.data).toBeInstanceOf(Uint8Array);
      expect([...res.echoed.data]).toEqual([...bytes]);
    } finally {
      client.disconnect();
    }
  });

  it("diffusion à trois connexions réelles de codecs différents : chacune reçoit SA trame", async () => {
    const cbor = await openClient(CBOR_FRAME_CODEC);
    // Texte qui a activé la convention d'octets : il réanime `$bytes`.
    const bytesText = await openClient(JSON_BYTES_FRAME_CODEC);
    // Texte nu : aucun codec importé — l'accueil (`bytesMarker`) lui fait
    // prendre la convention d'octets.
    const plain = await openClient(undefined);
    const clients = [cbor, bytesText, plain];
    try {
      expect(clients.map((c) => c.codec)).toEqual([CBOR, TEXT, TEXT]);
      const got: Array<Array<{ seq: number; data: unknown }>> = [[], [], []];
      clients.forEach((c, i) => {
        c.on("codec:tick", (p) =>
          got[i]?.push(p as { seq: number; data: unknown }),
        );
        c.subscribe("codec:tick");
      });
      await Promise.all(clients.map((c) => c.whenSubscribed("codec:tick")));
      const ack = await cbor.request<"codec:publish", { published: boolean }>(
        "codec:publish",
        { seq: 42 },
      );
      expect(ack.published).toBe(true);
      await expect
        .poll(() => got.map((g) => g.length), { timeout: 5000 })
        .toEqual([1, 1, 1]);
      expect(got.map((g) => g[0]?.seq)).toEqual([42, 42, 42]);
      // Les trois : les MÊMES octets, en `Uint8Array` — le texte nu compris,
      // sans rien avoir importé (`bytesMarker` de l'accueil).
      for (const g of got) {
        const data = g[0]?.data;
        expect(data).toBeInstanceOf(Uint8Array);
        expect(data instanceof Uint8Array ? [...data] : null).toEqual([
          1, 2, 3, 255,
        ]);
      }
    } finally {
      for (const c of clients) c.disconnect();
    }
  });
});
