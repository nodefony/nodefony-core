/// <reference types="node" />
//
// ─── gRPC : flux longs — muet vivant, client bloqué coupé (#695, critère 21) ──
//
// Décor : serveur de dev (skill `nodefony-start-server`) — 5151 HTTP/1.1,
// 5152 HTTP/2 + TLS, 5153 h2c (développement). Méthode `EchoService.Watch` du
// module `test` (flux serveur), `Converse` (bidirectionnel).
//
// Clients BRUTS (`node:http2`, `node:http`) : il faut tenir la lecture à la
// main — un client gRPC lit tout ce qui arrive, et ne se « bloque » jamais.
//
// La coupure se constate CÔTÉ SERVEUR : un client qui ne lit pas ne voit pas la
// fin de sa connexion (HTTP/1.1 : socket en pause, ni FIN ni RST lus). `Watch`
// note l'interruption de son signal sous un témoin, que `Stall` rend.
//
// ADR-0026 D4 point 4 : un flux n'a aucune échéance ; le client qui ne lit plus
// est coupé par le balayage de blocage, entre le seuil (30 s) et le seuil plus
// la période (15 s) après la première contre-pression vue.
//
import { randomUUID } from "node:crypto";
import http from "node:http";
import http2 from "node:http2";
import { expect } from "vitest";
import { create, toBinary } from "@bufbuild/protobuf";
import {
  ConverseRequestSchema,
  WatchRequestSchema,
} from "../../../../../../modules/test/nodefony/gen/nodefony/test/v1/echo_pb.js";
import { IS_PROD_TARGET } from "../../../../http/nodefony/tests/helpers/targetEnv";

const SERVICE = "/nodefony.test.v1.EchoService";
/** Délai de blocage d'un flux (`STREAM_STALL_TIMEOUT_MS`). */
const STALL_MS = 30_000;
/** Période du balayage (`STALL_SWEEP_PERIOD_MS`). */
const SWEEP_MS = 15_000;
/**
 * Vie exigée d'un flux muet : au-delà de chaque délai de 30 s du décor
 * (réponse, session HTTP/2, réception) ET de la coupure la plus tardive d'un
 * bloqué (seuil + période).
 */
const MUTED_MS = 60_000;

/** Un message gRPC encadré : drapeau, longueur sur 4 octets, charge. */
function frame(payload: Uint8Array): Buffer {
  const out = Buffer.alloc(5 + payload.length);
  out.writeUInt32BE(payload.length, 1);
  out.set(payload, 5);
  return out;
}

const watch = (
  follow: boolean,
  burst: number,
  bytes: number,
  witness: string,
): Buffer =>
  frame(
    toBinary(
      WatchRequestSchema,
      create(WatchRequestSchema, { follow, burst, bytes, witness }),
    ),
  );

/** Le serveur a-t-il vu interrompu l'appel de ce témoin ? (`Stall`, Connect JSON) */
async function abortedOnServer(witness: string): Promise<boolean> {
  const r = await fetch(`http://127.0.0.1:5151${SERVICE}/Stall`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ block: false, witness }),
  });
  const body: unknown = await r.json();
  return typeof body === "object" && body !== null && "aborted" in body
    ? body.aborted === true
    : false;
}

/**
 * Attend que le serveur voie l'appel du témoin interrompu : ms depuis `t0`
 * (horloge du test, une seule), ou `null` passé `ms`.
 */
async function cutOnServer(
  witness: string,
  t0: number,
  ms: number,
): Promise<number | null> {
  while (Date.now() - t0 < ms) {
    if (await abortedOnServer(witness)) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return null;
}

interface IOpened {
  /** Réglée à la fermeture du flux, par l'une ou l'autre partie (ms depuis l'ouverture). */
  closed: Promise<number>;
  /** Octets reçus. */
  received(): number;
  cancel(): void;
}

/** Un appel gRPC natif sur HTTP/2, lecture tenue par `read`. */
function h2Call(
  base: string,
  method: string,
  body: Buffer,
  read: boolean,
  endRequest = true,
): IOpened {
  const t0 = Date.now();
  const session = http2.connect(base, { rejectUnauthorized: false });
  session.on("error", () => undefined);
  const stream = session.request({
    ":method": "POST",
    ":path": `${SERVICE}/${method}`,
    "content-type": "application/grpc",
    te: "trailers",
  });
  stream.on("error", () => undefined);
  let bytes = 0;
  if (read) stream.on("data", (c: Buffer) => (bytes += c.length));
  else stream.pause();
  if (endRequest) stream.end(body);
  else stream.write(body);
  // Une fin propre (RST_STREAM NO_ERROR) n'émet `close` qu'une fois les
  // données reçues CONSOMMÉES (`internal/http2/core#onStreamClose`) : un client
  // qui ne lit pas ne le verrait jamais. `closed` passe à vrai dès le RST reçu.
  const closed = new Promise<number>((resolve) => {
    const done = (): void => {
      clearInterval(poll);
      resolve(Date.now() - t0);
      session.close();
    };
    const poll = setInterval(() => {
      if (stream.closed) done();
    }, 250);
    poll.unref();
    stream.once("close", done);
  });
  return {
    closed,
    received: () => bytes,
    cancel: () => {
      stream.close(http2.constants.NGHTTP2_CANCEL);
      session.destroy();
    },
  };
}

/** Un appel Connect en flux sur HTTP/1.1, lecture tenue par `read`. */
function h1Call(method: string, body: Buffer, read: boolean): IOpened {
  const t0 = Date.now();
  const agent = new http.Agent({ keepAlive: false });
  const req = http.request(`http://127.0.0.1:5151${SERVICE}/${method}`, {
    method: "POST",
    agent,
    headers: { "content-type": "application/connect+proto" },
  });
  req.on("error", () => undefined);
  let bytes = 0;
  const closed = new Promise<number>((resolve) => {
    req.once("close", () => resolve(Date.now() - t0));
  });
  req.on("response", (res) => {
    res.on("error", () => undefined);
    if (read) res.on("data", (c: Buffer) => (bytes += c.length));
    else res.pause();
  });
  req.end(body);
  return {
    closed,
    received: () => bytes,
    cancel: () => req.destroy(),
  };
}

interface IDecor {
  label: string;
  open(
    method: string,
    body: Buffer,
    read: boolean,
    endRequest?: boolean,
  ): IOpened;
}

const DECORS: IDecor[] = [
  {
    label: "5152 HTTP/2+TLS gRPC",
    open: (m, b, r, e) => h2Call("https://127.0.0.1:5152", m, b, r, e),
  },
  { label: "5151 HTTP/1.1 Connect", open: (m, b, r) => h1Call(m, b, r) },
];
if (!IS_PROD_TARGET) {
  DECORS.unshift({
    label: "5153 h2c gRPC",
    open: (m, b, r, e) => h2Call("http://127.0.0.1:5153", m, b, r, e),
  });
}

/** Rien n'arrive avant `ms` : la promesse rend `null`, sinon le temps de fermeture. */
const closedWithin = (p: Promise<number>, ms: number): Promise<number | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

describe("gRPC — flux longs (critère 21, ADR-0026 D4 point 4)", () => {
  it(
    "tous les décors à la fois : muet vivant au-delà de tous les délais de 30 s, bloqué coupé, jamais avant le seuil",
    async () => {
      const t0 = Date.now();
      const muted: Array<[string, IOpened, string | null]> = [];
      const blocked: Array<[string, IOpened, string]> = [];
      for (const decor of DECORS) {
        const quiet = randomUUID();
        muted.push([
          `${decor.label} — flux serveur muet`,
          decor.open("Watch", watch(false, 1, 1, quiet), true),
          quiet,
        ]);
        const stuck = randomUUID();
        blocked.push([
          `${decor.label} — client qui ne lit plus`,
          decor.open("Watch", watch(true, 0, 16_384, stuck), false),
          stuck,
        ]);
      }
      // Bidirectionnel muet : un message, requête laissée OUVERTE (HTTP/2 seul —
      // Connect sur HTTP/1.1 est semi-duplex).
      for (const decor of DECORS.filter(
        (d) => d.label.includes("HTTP/2") || d.label.includes("h2c"),
      )) {
        const hello = frame(
          toBinary(
            ConverseRequestSchema,
            create(ConverseRequestSchema, { sentence: "bonjour" }),
          ),
        );
        muted.push([
          `${decor.label} — bidirectionnel muet, requête ouverte`,
          decor.open("Converse", hello, true, false),
          null,
        ]);
      }
      try {
        const cuts = await Promise.all(
          blocked.map(([, , witness]) =>
            // Attendre le FAIT, large : la fenêtre exacte (seuil, seuil +
            // période) est prouvée en unitaire, horloge injectée
            // (`stallSweep.test.ts`) — jamais une durée assertée ici.
            cutOnServer(witness, t0, STALL_MS + SWEEP_MS + 60_000),
          ),
        );
        const alive = await Promise.all(
          muted.map(([, o]) =>
            closedWithin(o.closed, Math.max(0, MUTED_MS - (Date.now() - t0))),
          ),
        );
        const mutedAborted = await Promise.all(
          muted.map(([, , witness]) =>
            witness === null
              ? Promise.resolve(false)
              : abortedOnServer(witness),
          ),
        );
        blocked.forEach(([label], i) => {
          const at = cuts[i];
          expect(at, `${label} : coupé`).not.to.equal(null);
          // Le seuil, jamais avant.
          expect(at, `${label} : pas avant le seuil`).to.be.greaterThanOrEqual(
            STALL_MS,
          );
        });
        muted.forEach(([label, o], i) => {
          expect(
            alive[i],
            `${label} : toujours ouvert à ${MUTED_MS} ms`,
          ).to.equal(null);
          expect(
            o.received(),
            `${label} : a reçu son premier message`,
          ).to.be.greaterThan(0);
          expect(
            mutedAborted[i],
            `${label} : jamais interrompu côté serveur`,
          ).to.equal(false);
        });
      } finally {
        for (const [, o] of [...muted, ...blocked]) o.cancel();
      }
    },
    MUTED_MS + STALL_MS + SWEEP_MS + 30_000,
  );
});
