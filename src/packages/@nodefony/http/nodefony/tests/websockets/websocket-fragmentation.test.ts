/// <reference types="node" />
import { expect } from "chai";
import WebSocket from "ws";
import * as ws from "ws";

// G3 — RFC 6455 §5.4 Fragmentation. Un message peut être découpé : 1ère frame
// opcode≠0 + FIN=0, puis continuations opcode=0 + FIN=0, terminée par opcode=0 +
// FIN=1. Les frames de contrôle (ping/pong/close) PEUVENT être injectées au milieu.
// `ws` réassemble ; on vérifie que le pipeline Nodefony reçoit le message COMPLET,
// y compris quand un ping s'intercale (croise le heartbeat G2).

const ECHO = "ws://127.0.0.1:5151/nodefony/test/ws/echo";
const OPCODE_TEXT = 0x01;
const OPCODE_CONT = 0x00;
const OPCODE_PING = 0x09;

// `@types/ws` n'expose pas `Sender` → on type juste ce qu'on utilise (0 any).
interface IFrameOptions {
  fin: boolean;
  opcode: number;
  mask: boolean;
  readOnly: boolean;
  rsv1: boolean;
}
type FrameFn = (data: Buffer, options: IFrameOptions) => Buffer[];
// `Sender` est exporté en named par le wrapper ESM de `ws` (pas attaché au default,
// et absent de `@types/ws`) → import namespace + cast typé (0 any).
const senderFrame = (ws as unknown as { Sender: { frame: FrameFn } }).Sender
  .frame;

// Frame cliente masquée (RFC §5.3 : un client DOIT masquer).
const mkFrame = (data: Buffer, fin: boolean, opcode: number): Buffer[] =>
  senderFrame(data, { fin, opcode, mask: true, readOnly: false, rsv1: false });

const openEcho = (): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(ECHO);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });

// Consomme le message de handshake ({handshake:true}) envoyé à la connexion.
const consumeHandshake = (ws: WebSocket): Promise<void> =>
  new Promise((r) => ws.once("message", () => r()));

const writeRawFrames = (ws: WebSocket, frames: Buffer[][]): void => {
  const sock = (ws as unknown as { _socket: { write(b: Buffer): void } })
    ._socket;
  for (const frame of frames) {
    for (const buf of frame) {
      sock.write(buf);
    }
  }
};

describe("WS fragmentation — RFC 6455 §5.4", () => {
  // L'echo renvoie le message en JSON (cf convention websocket.test.ts) → on
  // fragmente un objet JSON et on vérifie qu'il revient intact après réassemblage.
  const parseFrag = (raw: string): string =>
    (JSON.parse(raw) as { frag: string }).frag;

  it("réassemble un message JSON fragmenté (echo renvoie le tout)", async () => {
    const ws = await openEcho();
    await consumeHandshake(ws);
    const got = new Promise<string>((r) =>
      ws.once("message", (d: Buffer) => r(d.toString())),
    );
    writeRawFrames(ws, [
      mkFrame(Buffer.from('{"frag":'), false, OPCODE_TEXT),
      mkFrame(Buffer.from('"MENT'), false, OPCODE_CONT),
      mkFrame(Buffer.from('-OK"}'), true, OPCODE_CONT),
    ]);
    expect(parseFrag(await got)).to.equal("MENT-OK");
    ws.terminate();
  });

  it("gère un PING injecté entre fragments (pong + réassemblage intact)", async () => {
    const ws = await openEcho();
    await consumeHandshake(ws);
    const gotMsg = new Promise<string>((r) =>
      ws.once("message", (d: Buffer) => r(d.toString())),
    );
    const gotPong = new Promise<void>((r) => ws.once("pong", () => r()));
    writeRawFrames(ws, [
      mkFrame(Buffer.from('{"frag":"AAA'), false, OPCODE_TEXT),
      mkFrame(Buffer.from("hb"), true, OPCODE_PING), // contrôle interjeté (§5.4)
      mkFrame(Buffer.from('BBB"}'), true, OPCODE_CONT),
    ]);
    await gotPong; // serveur a pong (autoPong) sans corrompre le flux fragmenté
    expect(parseFrag(await gotMsg)).to.equal("AAABBB");
    ws.terminate();
  });
});
