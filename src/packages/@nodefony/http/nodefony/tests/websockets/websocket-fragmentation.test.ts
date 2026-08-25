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

/**
 * Consomme le message de handshake (`{handshake:true}`) envoyé à la connexion.
 *
 * Passe par {@link premierMessage} plutôt que par un `once("message")` nu :
 * l'attente muette que le commentaire ci-dessous décrit valait pour CETTE
 * étape aussi, et c'est ici qu'elle a mordu. Sur un runner Windows en
 * production, le test a pendu ses 60 s entières pour ne rendre qu'un
 * « timed out » — le handshake n'était jamais arrivé, et rien ne disait
 * pourquoi. Durcir le second message et laisser le premier muet ne protège
 * que la moitié du chemin.
 */
const consumeHandshake = async (ws: WebSocket): Promise<void> => {
  await premierMessage(ws);
};

/**
 * Le PREMIER message reçu — ou la raison pour laquelle il ne viendra jamais.
 *
 * Écouter `message` seul transforme toute autre issue en attente muette : la
 * connexion se ferme, le serveur émet une erreur, et le test pend jusqu'à son
 * plafond pour ne rendre qu'un « timed out » qui n'apprend rien. Vécu sur un
 * runner macOS — 60 s d'attente, aucun indice, alors que les mêmes cas passent en
 * 20 ms sur un poste du même système : la cause est dans le décor, et c'est
 * précisément ce que le silence empêchait de voir.
 *
 * Le plafond n'est PAS relâché : on ne fabrique pas un vert en desserrant un
 * seuil, on rend l'échec parlant.
 */
const premierMessage = (ws: WebSocket): Promise<string> =>
  new Promise((resolve, reject) => {
    const onMessage = (d: Buffer): void => {
      fin();
      resolve(d.toString());
    };
    const onClose = (code: number, raison: Buffer): void => {
      fin();
      reject(
        new Error(
          `connexion FERMÉE avant tout message — code ${code}` +
            (raison.length ? ` « ${raison.toString()} »` : " (sans raison)"),
        ),
      );
    };
    const onError = (e: Error): void => {
      fin();
      reject(new Error(`socket en ERREUR avant tout message — ${e.message}`));
    };
    // Les trois issues sont exclusives : celle qui arrive détache les deux autres,
    // sinon un `close` postérieur au message rejetterait une promesse déjà tenue.
    const fin = (): void => {
      ws.removeListener("message", onMessage);
      ws.removeListener("close", onClose);
      ws.removeListener("error", onError);
    };
    ws.once("message", onMessage);
    ws.once("close", onClose);
    ws.once("error", onError);
  });

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
    const got = premierMessage(ws);
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
    const gotMsg = premierMessage(ws);
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
