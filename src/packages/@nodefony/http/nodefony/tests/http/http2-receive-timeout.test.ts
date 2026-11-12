/// <reference types="node" />
/**
 * Réception d'un corps HTTP/2 BORNÉE (#765), sur le serveur RÉEL.
 *
 * `node:http2` ne borne pas la réception d'une requête : un corps qui n'arrive
 * jamais à son terme tenait le flux ouvert sans fin (constaté : aucune réponse
 * au bout de 45 s, quand HTTP/1.1 coupe à 30 s). Le framework la borne par
 * `requestTimeout` (30 s par défaut) — un balayage, jamais un minuteur par
 * requête (`src/servers/receiveDeadline.ts`).
 *
 * Ce que ces cas tiennent :
 * - h2c (5153) ET TLS (5152) : 408 jamais avant le délai, son corps reçu en
 *   entier, PUIS le flux fermé en `NO_ERROR` (RFC 9113 §8.1) — sans cette
 *   fermeture, le client garde sa place de flux sur la session ;
 * - une route `bodyStream` n'est pas concernée : le corps y est lu par l'action ;
 * - une route inconnue (404) ne lit PAS le corps : la réponse part sans
 *   l'attendre (#695, critère 51) — une méthode refusée (405) non plus : elle
 *   est levée par le routeur AVANT l'étape du corps. Vu rouge en lisant le
 *   corps avant le routage ;
 * - témoin de non-régression : un refus rendu avant la fin du corps (413)
 *   ferme lui aussi son flux — Node le faisait déjà sur ce chemin ; ce cas ne
 *   mord donc PAS si l'on retire la fermeture, les cas 408 si.
 *
 * - HTTP/1.1 (5151) : la borne est celle de Node (`server.requestTimeout`),
 *   vérifiée toutes les 30 s (`connectionsCheckingInterval`) — coupure entre
 *   30 et 60 s. Le statut est 408, celui de Node : notre écouteur
 *   `clientError` le répondait 400 (#695, critère 26).
 *
 * Les cas sont indépendants et longs (≈ 31–60 s) : ils tournent en parallèle.
 */
import net from "node:net";
import { describe, expect, it } from "vitest";
import http2 from "node:http2";
import { IS_PROD_TARGET } from "../helpers/targetEnv";

/** `requestTimeout` par défaut de la config http (non surchargé par l'app de banc). */
const RECEIVE_TIMEOUT_MS = 30_000;
/** Route POST qui LIT son corps (`@Body()`) : la réception y est bornée. */
const READS_BODY = "/nodefony/test/decorators/body";
/**
 * Aucune route ne répond ici : le corps n'est PAS lu, le 404 part aussitôt
 * (#695, critère 51).
 */
const UNROUTED = "/nodefony/test/http2-receive-timeout/unrouted";
/**
 * Route GET seule : un POST y reçoit 405, levé par le routeur avant l'étape du
 * corps — rougit si le corps venait à être lu avant le routage.
 */
const GET_ONLY = "/nodefony/test/decorators/query";
/** Route `bodyStream: true` du module test : l'action lit le flux elle-même. */
const STREAMED = "/nodefony/test/schema/upload?name=lent";

interface IOutcome {
  status: number | null;
  bodyBytes: number;
  body: string;
  /** ms entre l'envoi et les en-têtes de réponse. */
  responseMs: number | null;
  /** ms entre l'envoi et la fermeture du flux ; `null` = encore ouvert au plafond. */
  closeMs: number | null;
  rstCode: number | undefined;
}

/**
 * POST un corps qui s'écrit au compte-gouttes : `drip` octets, un toutes les
 * `everyMs`, puis la fin du corps seulement si `end` — sinon jamais.
 */
function post(
  origin: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    method?: string;
    drip: number;
    everyMs: number;
    end: boolean;
    capMs: number;
  },
): Promise<IOutcome> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const session = http2.connect(origin, { rejectUnauthorized: false });
    session.on("error", () => undefined);
    const stream = session.request({
      ":method": options.method ?? "POST",
      ":path": path,
      "content-type": "application/octet-stream",
      ...options.headers,
    });
    const outcome: IOutcome = {
      status: null,
      bodyBytes: 0,
      body: "",
      responseMs: null,
      closeMs: null,
      rstCode: undefined,
    };
    let sent = 1;
    stream.write("x");
    const drip = setInterval(() => {
      if (stream.closed || stream.destroyed) return;
      if (sent < options.drip) {
        sent++;
        stream.write("x");
      } else {
        clearInterval(drip);
        if (options.end) stream.end();
      }
    }, options.everyMs);
    const finish = (): void => {
      clearInterval(drip);
      clearTimeout(cap);
      session.close();
      resolve(outcome);
    };
    // Au plafond, l'issue est FIGÉE : la fermeture que le test provoque
    // lui-même (`destroy`) ne doit pas passer pour celle du serveur.
    let capped = false;
    const cap = setTimeout(() => {
      capped = true;
      clearInterval(drip);
      resolve(outcome);
      session.destroy();
    }, options.capMs);
    stream.on("response", (headers) => {
      outcome.status = Number(headers[":status"]);
      outcome.responseMs = performance.now() - t0;
    });
    stream.on("data", (chunk: Buffer) => {
      outcome.bodyBytes += chunk.length;
      outcome.body += chunk.toString();
    });
    stream.on("error", () => undefined);
    stream.on("close", () => {
      if (capped) return;
      outcome.closeMs = performance.now() - t0;
      outcome.rstCode = stream.rstCode;
      finish();
    });
  });
}

/** Pas de contrôle de Node pour `requestTimeout` en HTTP/1.1 (défaut). */
const NODE_CHECK_INTERVAL_MS = 30_000;

interface IH1Outcome {
  readonly statusLine: string | null;
  readonly responseMs: number | null;
  readonly closeMs: number | null;
}

/**
 * Un POST HTTP/1.1 brut au corps JAMAIS fini : `declared` octets annoncés,
 * un octet par seconde — le client LENT, que borne `requestTimeout` ; un
 * client muet serait coupé avant, en silence, par l'inactivité de la socket.
 * Rend la ligne de statut, son instant, et l'instant où le SERVEUR ferme la
 * socket (`null` au plafond).
 */
function postH1Unfinished(
  path: string,
  declared: number,
  capMs: number,
): Promise<IH1Outcome> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let statusLine: string | null = null;
    let responseMs: number | null = null;
    const socket = net.connect(5151, "127.0.0.1");
    const drip = setInterval(() => {
      if (socket.writable) socket.write("1");
    }, 1000);
    const cap = setTimeout(() => {
      clearInterval(drip);
      socket.destroy();
      resolve({ statusLine, responseMs, closeMs: null });
    }, capMs);
    socket.on("data", (c: Buffer) => {
      if (statusLine !== null) return;
      statusLine = c.toString("latin1").split("\r\n")[0] ?? "";
      responseMs = performance.now() - t0;
    });
    socket.on("close", () => {
      clearTimeout(cap);
      clearInterval(drip);
      resolve({ statusLine, responseMs, closeMs: performance.now() - t0 });
    });
    socket.on("error", (e) => {
      clearInterval(drip);
      reject(e);
    });
    socket.write(
      `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:5151\r\n` +
        `Content-Type: application/json\r\nContent-Length: ${declared}\r\n\r\n`,
    );
    socket.write('{"a":');
  });
}

const TARGETS: readonly (readonly [string, string, boolean])[] = [
  // h2c n'est servi qu'en développement : absent d'une cible de production.
  ["h2c (5153)", "http://localhost:5153", IS_PROD_TARGET],
  ["h2 TLS (5152)", "https://localhost:5152", false],
];

describe.concurrent(
  "HTTP/2 — réception du corps bornée (#765, requires server)",
  () => {
    for (const [label, origin, skip] of TARGETS) {
      it.skipIf(skip)(
        `${label} : un corps jamais terminé reçoit 408 après le délai, puis le flux est fermé`,
        async () => {
          const out = await post(origin, READS_BODY, {
            drip: 1,
            everyMs: 1000,
            end: false,
            capMs: RECEIVE_TIMEOUT_MS + 15_000,
          });
          expect(out.status, "statut").to.equal(408);
          // Jamais AVANT le délai configuré.
          expect(out.responseMs ?? 0).to.be.at.least(RECEIVE_TIMEOUT_MS);
          // La réponse d'erreur part ENTIÈRE, avant la fermeture.
          expect(out.bodyBytes).to.be.greaterThan(0);
          // Le flux est fermé PAR LE SERVEUR, aussitôt la réponse écrite.
          expect(out.closeMs, "flux encore ouvert au plafond").to.not.equal(
            null,
          );
          expect((out.closeMs ?? Infinity) - (out.responseMs ?? 0)).to.be.below(
            3000,
          );
          expect(out.rstCode).to.equal(http2.constants.NGHTTP2_NO_ERROR);
        },
        RECEIVE_TIMEOUT_MS + 20_000,
      );
    }

    it(
      "h2 TLS (5152) : un corps MULTIPART jamais terminé reçoit 408, puis le flux est fermé",
      async () => {
        // Le multipart a sa propre lecture (busboy, en flux) : sa prise
        // d'interruption est distincte de celle des corps bufferisés.
        const out = await post("https://localhost:5152", READS_BODY, {
          headers: { "content-type": "multipart/form-data; boundary=nf765" },
          drip: 1,
          everyMs: 1000,
          end: false,
          capMs: RECEIVE_TIMEOUT_MS + 15_000,
        });
        expect(out.status, "statut").to.equal(408);
        expect(out.responseMs ?? 0).to.be.at.least(RECEIVE_TIMEOUT_MS);
        expect(out.closeMs, "flux encore ouvert au plafond").to.not.equal(null);
        expect((out.closeMs ?? Infinity) - (out.responseMs ?? 0)).to.be.below(
          3000,
        );
        expect(out.rstCode).to.equal(http2.constants.NGHTTP2_NO_ERROR);
      },
      RECEIVE_TIMEOUT_MS + 20_000,
    );

    it.skipIf(IS_PROD_TARGET)(
      "h2c : une route `bodyStream` alimentée au compte-gouttes au-delà du délai n'est PAS coupée",
      async () => {
        // 4 octets sur 40 s : une borne ABSOLUE l'aurait coupée à 30 s.
        const out = await post("http://localhost:5153", STREAMED, {
          drip: 4,
          everyMs: 10_000,
          end: true,
          capMs: 60_000,
        });
        expect(out.status, out.body).to.equal(200);
        expect(JSON.parse(out.body)).to.deep.equal({ name: "lent", bytes: 4 });
      },
      70_000,
    );

    for (const [label, origin, skip] of TARGETS) {
      it.skipIf(skip)(
        `${label} : une erreur rendue avant la fin du corps (413) ferme aussi le flux`,
        async () => {
          // Content-Length au-delà de `maxBodySize` : refus AVANT lecture.
          const out = await post(origin, READS_BODY, {
            headers: { "content-length": String(64 * 1024 * 1024) },
            drip: 1,
            everyMs: 1000,
            end: false,
            capMs: 10_000,
          });
          expect(out.status, "statut").to.equal(413);
          expect(out.bodyBytes).to.be.greaterThan(0);
          expect(out.closeMs, "flux encore ouvert au plafond").to.not.equal(
            null,
          );
          expect((out.closeMs ?? Infinity) - (out.responseMs ?? 0)).to.be.below(
            3000,
          );
          expect(out.rstCode).to.equal(http2.constants.NGHTTP2_NO_ERROR);
        },
        15_000,
      );
    }

    // #695, critère 51 — une route que personne ne lira ne lit pas le corps.
    // Le FAIT asserté : la réponse arrive alors que le corps n'est pas fini
    // (`end: false`) ; avant, elle n'arrivait qu'au délai de réception (408),
    // bien après le plafond de 10 s.
    for (const [label, origin, skip] of TARGETS) {
      for (const [status, path, method] of [
        [404, UNROUTED, "POST"],
        [405, GET_ONLY, "POST"],
      ] as const) {
        it.skipIf(skip)(
          `${label} : ${status} sans lire le corps — réponse avant la fin du corps, puis flux fermé`,
          async () => {
            const out = await post(origin, path, {
              method,
              drip: 1,
              everyMs: 1000,
              end: false,
              capMs: 10_000,
            });
            expect(out.status, "aucune réponse avant le plafond").to.equal(
              status,
            );
            expect(out.bodyBytes).to.be.greaterThan(0);
            expect(out.closeMs, "flux encore ouvert au plafond").to.not.equal(
              null,
            );
            expect(out.rstCode).to.equal(http2.constants.NGHTTP2_NO_ERROR);
          },
          15_000,
        );
      }
    }

    // #695, critère 26 — HTTP/1.1 : la borne de Node, au statut de Node.
    it(
      "HTTP/1.1 (5151) : un corps jamais terminé reçoit 408 — jamais 400 — après le délai, puis la socket est fermée",
      async () => {
        const out = await postH1Unfinished(
          READS_BODY,
          1000,
          RECEIVE_TIMEOUT_MS + NODE_CHECK_INTERVAL_MS + 10_000,
        );
        expect(out.statusLine).to.equal("HTTP/1.1 408 Request Timeout");
        // Jamais AVANT le délai configuré.
        expect(out.responseMs ?? 0).to.be.at.least(RECEIVE_TIMEOUT_MS);
        expect(out.closeMs, "socket encore ouverte au plafond").to.not.equal(
          null,
        );
      },
      RECEIVE_TIMEOUT_MS + NODE_CHECK_INTERVAL_MS + 20_000,
    );
  },
);
