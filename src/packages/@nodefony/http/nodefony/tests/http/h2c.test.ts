/// <reference types="node" />
/**
 * HTTP/2 en clair (h2c, `servers.h2c`, 5153) sur le serveur RÉEL — le port qu'un
 * proxy inverse emploie pour parler HTTP/2 à ses amonts.
 *
 * Ce que ce fichier garde, chaque fois par un client réel :
 * - le contexte dit `h2c`, et le schéma ne vient ni de `:scheme` ni d'un
 *   `X-Forwarded-Proto` non fiable ; pas de HSTS sur un port en clair ;
 * - plusieurs flux sur UNE session, la forme d'un proxy ;
 * - HTTP/1.1 n'y est pas servi : le serveur répond par la préface HTTP/2 et
 *   ferme, sans laisser la connexion pendue ;
 * - la bascule `Upgrade: h2c` (retirée par RFC 9113 §3.1, vecteur de
 *   contrebande h2c) est refusée sur le port HTTP/1.1 — jamais de 101 ;
 * - CONNECT ne tunnelise rien, et le CONNECT étendu (RFC 8441) n'est pas
 *   annoncé : les WebSocket restent sur le port HTTP.
 *
 * h2c n'est actif que sur l'app de développement : en production, la suite saute.
 */
import { expect } from "vitest";
import http2 from "node:http2";
import net from "node:net";
import { IS_PROD_TARGET } from "../helpers/targetEnv";

const H2C = "http://localhost:5153";
const CONTEXT = "/nodefony/test/context";

interface IH2Reply {
  status: number;
  headers: http2.IncomingHttpHeaders;
  body: string;
}

/** Une requête sur une session h2c déjà ouverte. */
function request(
  session: http2.ClientHttp2Session,
  headers: http2.OutgoingHttpHeaders,
): Promise<IH2Reply> {
  return new Promise((resolve, reject) => {
    const stream = session.request(headers);
    const out: IH2Reply = { status: 0, headers: {}, body: "" };
    stream.on("response", (h) => {
      out.status = Number(h[":status"]);
      out.headers = h;
    });
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => (out.body += chunk));
    stream.on("end", () => resolve(out));
    stream.on("error", reject);
    stream.end();
  });
}

/** Ouvre une session h2c et attend les réglages du serveur. */
function connect(): Promise<http2.ClientHttp2Session> {
  return new Promise((resolve, reject) => {
    const session = http2.connect(H2C);
    session.once("error", reject);
    session.once("remoteSettings", () => resolve(session));
  });
}

/** Écrit des octets bruts sur un port et rend ce que le serveur renvoie avant de fermer. */
function raw(
  port: number,
  payload: string,
  timeoutMs = 3000,
): Promise<{ bytes: Buffer; closedAfterMs: number | null }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let bytes = Buffer.alloc(0);
    const socket = net.connect(port, "127.0.0.1", () => socket.write(payload));
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ bytes, closedAfterMs: null });
    }, timeoutMs);
    socket.on("data", (d: Buffer) => (bytes = Buffer.concat([bytes, d])));
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      resolve({ bytes, closedAfterMs: Date.now() - start });
    });
  });
}

describe.skipIf(IS_PROD_TARGET)(
  "h2c — HTTP/2 en clair (requires server)",
  () => {
    let session: http2.ClientHttp2Session;
    beforeAll(async () => {
      session = await connect();
    });
    afterAll(() => {
      session.close();
    });

    it("le contexte dit h2c ; schéma http malgré X-Forwarded-Proto ; pas de HSTS", async () => {
      const r = await request(session, {
        ":path": CONTEXT,
        // Ni le pseudo-en-tête du client ni un en-tête de proxy NON fiable ne
        // décident du schéma : seul le transport (ou un proxy de confiance).
        ":scheme": "https",
        "x-forwarded-proto": "https",
      });
      expect(r.status).to.equal(200);
      const ctx = JSON.parse(r.body) as Record<string, unknown>;
      expect(ctx).to.include({
        alpnProtocol: "h2c",
        scheme: "http",
        serverType: "http",
        type: "http",
      });
      expect(r.headers["strict-transport-security"]).to.equal(undefined);
    });

    it("forme proxy : 32 flux simultanés sur UNE session, tous servis", async () => {
      const replies = await Promise.all(
        Array.from({ length: 32 }, () =>
          request(session, { ":path": CONTEXT }),
        ),
      );
      expect(replies.map((r) => r.status)).to.eql(Array(32).fill(200));
      expect(session.destroyed).to.equal(false);
    });

    it("HTTP/1.1 sur le port h2c : préface HTTP/2, fermeture, aucune réponse HTTP/1", async () => {
      const { bytes, closedAfterMs } = await raw(
        5153,
        "GET / HTTP/1.1\r\nHost: localhost:5153\r\n\r\n",
      );
      expect(
        closedAfterMs,
        "le serveur ferme, la connexion ne pend pas",
      ).not.to.equal(null);
      expect(closedAfterMs!).to.be.lessThan(1000);
      expect(bytes.toString("latin1")).not.to.match(/^HTTP\/1/);
      // Première trame : SETTINGS (type 0x4), la préface serveur de RFC 9113 §3.4.
      expect(bytes[3]).to.equal(0x04);
      // Le port sert toujours HTTP/2 après le client égaré.
      const after = await request(session, { ":path": CONTEXT });
      expect(after.status).to.equal(200);
    });

    for (const path of [CONTEXT, "/nodefony/kernel/api/livez"]) {
      it(`Upgrade: h2c sur le port HTTP/1.1 (${path}) : refus 4xx, jamais de 101 (RFC 9113 §3.1)`, async () => {
        // Un proxy qui relaie l'en-tête tel quel ouvrirait sinon un tunnel h2c
        // qui contourne ses propres règles — la contrebande h2c. Le code exact
        // dépend du chemin (le dispatcher d'upgrade refuse 404 un chemin sans
        // route WebSocket, 400 sinon) ; l'invariant est l'absence de bascule.
        const { bytes, closedAfterMs } = await raw(
          5151,
          `GET ${path} HTTP/1.1\r\nHost: localhost:5151\r\n` +
            "Connection: Upgrade, HTTP2-Settings\r\nUpgrade: h2c\r\n" +
            "HTTP2-Settings: AAMAAABkAARAAAAAAAIAAAAA\r\n\r\n",
        );
        const text = bytes.toString("latin1");
        expect(text).to.match(/^HTTP\/1\.1 4\d\d /);
        expect(text).not.to.include("101 Switching Protocols");
        expect(closedAfterMs, "refus suivi de la fermeture").not.to.equal(null);
      });
    }

    it("le proxy interne relaie en h2c comme en HTTP/1.1 (traduction h2 → HTTP/1.1 vers l'amont)", async () => {
      // L'amont (Vite) répond en HTTP/1.1, avec `connection`/`keep-alive` :
      // en-têtes INTERDITS en HTTP/2 (RFC 9113 §8.2.2). Relayés tels quels, Node
      // refuserait la réponse ; le relais doit les retirer, sans rien changer d'autre.
      const path = "/_vite/default/@vite/client";
      const h1 = await fetch(`http://127.0.0.1:5151${path}`);
      const h1Body = await h1.text();
      const h2 = await request(session, { ":path": path });
      expect(h2.status).to.equal(h1.status);
      expect(h2.headers.via, "réponse passée par le relais").to.be.a("string");
      expect(h2.headers["content-type"]).to.equal(
        h1.headers.get("content-type"),
      );
      expect(h2.body).to.equal(h1Body);
      for (const name of ["connection", "keep-alive", "transfer-encoding"]) {
        expect(h2.headers, name).not.to.have.property(name);
      }
    });

    it("CONNECT ne tunnelise rien : 405", async () => {
      const r = await request(session, {
        ":method": "CONNECT",
        ":authority": "localhost:443",
      });
      expect(r.status).to.equal(405);
    });

    it("CONNECT étendu (RFC 8441) non annoncé : le flux est refusé, sans réponse", async () => {
      expect(session.remoteSettings.enableConnectProtocol).to.equal(false);
      const fresh = await connect();
      try {
        const stream = fresh.request({
          ":method": "CONNECT",
          ":protocol": "websocket",
          ":scheme": "http",
          ":path": "/nodefony/test/ws",
          ":authority": "localhost:5153",
        });
        stream.on("error", () => {});
        let answered = false;
        stream.on("response", () => (answered = true));
        await new Promise((resolve) => stream.on("close", resolve));
        expect(answered, "aucune réponse à un CONNECT étendu").to.equal(false);
        expect(stream.rstCode).to.equal(http2.constants.NGHTTP2_PROTOCOL_ERROR);
      } finally {
        fresh.destroy();
      }
    });
  },
);
