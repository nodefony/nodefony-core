/// <reference types="node" />
/**
 * Intégration — seam de **trace des messages WebSocket** (Suivi de requête Studio).
 *
 * Vérifie de bout en bout que `WebsocketContext` logge le CONTENU de chaque frame
 * (RECEIVE/SEND), corrélé par `requestId`, et que le formatage tient aux limites :
 * JSON capturé, frame > cap tronquée (+ ellipse), frame binaire résumée
 * `[binary N B]` (jamais sérialisée).
 *
 * Live server: wss://localhost:5152 — route echo `/nodefony/test/ws/echo`.
 * Lecture via le data plane syslog `GET /nodefony/syslog/api/logs/search`
 * (driver actif = memory en dev → on interroge un requestId FRAIS juste après
 * l'envoi, avant toute éviction du ring, avec quelques relances).
 */
import { expect } from "chai";
import WebSocket from "ws";
import https from "node:https";
import { IS_PROD_TARGET } from "../helpers/targetEnv";

const WSS = "wss://localhost:5152";
const wsOpts = { rejectUnauthorized: false };
/** Doit refléter `WS_LOG_CONTENT_CAP` (wsLogContent.ts). */
const CAP = 4096;

interface LogRow {
  uid: number;
  msgid: string;
  payload: unknown;
  requestId?: string;
}

/** Cookie de session admin (login BFF) — le data plane syslog est protégé (P6 J3b). */
let cookie = "";

/** Login BFF (route en bypass firewall) → cookie pour lire le data plane. */
function login(): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(
      JSON.stringify({ username: "admin", password: "secret" }),
    );
    const req = https.request(
      {
        hostname: "127.0.0.1",
        port: 5152,
        path: "/nodefony/security/api/auth/login",
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          "content-type": "application/json",
          "content-length": String(data.length),
        },
      },
      (res) => {
        const sc = res.headers["set-cookie"];
        const first = Array.isArray(sc) ? sc[0] : sc;
        cookie = typeof first === "string" ? (first.split(";")[0] ?? "") : "";
        res.on("data", () => {});
        res.on("end", () =>
          cookie ? resolve() : reject(new Error("login admin/secret échoué")),
        );
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/** GET JSON sur le data plane (cert auto-signé toléré ; cookie de session requis). */
function getJson(path: string): Promise<{ rows?: LogRow[] }> {
  return new Promise((resolve, reject) => {
    https
      .get(
        {
          hostname: "127.0.0.1",
          port: 5152,
          path,
          rejectUnauthorized: false,
          headers: cookie ? { cookie } : {},
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        },
      )
      .on("error", reject);
  });
}

/** Interroge les logs d'un requestId, avec relances (ring memory = frais d'abord). */
async function searchByRequestId(rid: string): Promise<LogRow[]> {
  for (let i = 0; i < 6; i++) {
    const o = await getJson(
      `/nodefony/syslog/api/logs/search?requestId=${rid}&order=timeStamp:ASC&limit=200`,
    );
    const rows = o.rows ?? [];
    if (rows.some((r) => r.msgid === "WS RECEIVE")) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

/** Ouvre la socket, envoie toutes les frames, laisse le serveur traiter, ferme. */
function sendFrames(
  path: string,
  frames: (string | Buffer)[],
  rid: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WSS}${path}`, {
      ...wsOpts,
      headers: { "x-request-id": rid },
    });
    ws.on("open", () => {
      for (const f of frames) ws.send(f);
      // Laisse le serveur traiter (et logger) les 3 frames avant de fermer.
      setTimeout(() => ws.close(), 400);
    });
    ws.on("close", () => resolve());
    ws.on("error", reject);
    setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        /* déjà fermée */
      }
      resolve();
    }, 8000);
  });
}

// Dev-only : le trace logging détaillé des frames WS est désactivé en production
// (perf/bruit). Skip en prod (sonde /livez), tourne en dev.
describe.skipIf(IS_PROD_TARGET)(
  "WS trace logging — frames loggées & corrélées (seam Suivi de requête)",
  function () {
    // P6 J3b — le data plane syslog (/nodefony/syslog/api/*) est protégé : se loguer
    // pour pouvoir lire les logs (le handshake WS /nodefony/test/ws/echo reste public).
    beforeAll(async () => {
      await login();
    });

    it("RECEIVE/SEND corrélés par requestId : JSON capturé, oversized tronqué, binaire résumé", async () => {
      const rid = `trace-itest-${Math.random().toString(36).slice(2, 10)}`;
      await sendFrames(
        "/nodefony/test/ws/echo",
        [
          JSON.stringify({ hello: "world", n: 42 }),
          "y".repeat(5000), // > CAP → tronqué
          Buffer.alloc(128), // binaire → [binary 128 B]
        ],
        rid,
      );

      const rows = await searchByRequestId(rid);
      expect(
        rows.length,
        "des logs WS doivent être corrélés au requestId",
      ).to.be.greaterThan(0);

      // Corrélation : la requête est filtrée par requestId → tous les logs le portent.
      expect(rows.every((r) => r.requestId === rid)).to.equal(true);

      const recv = rows
        .filter((r) => r.msgid === "WS RECEIVE")
        .map((r) => String(r.payload));
      const send = rows.filter((r) => r.msgid === "WS SEND");
      expect(recv.length, "frames RECEIVE loggées").to.be.greaterThan(0);
      expect(send.length, "échos SEND loggés").to.be.greaterThan(0);

      // Contenu JSON capturé tel quel.
      expect(
        recv.some((p) => p.includes('"hello":"world"')),
        "JSON RECEIVE capturé",
      ).to.equal(true);

      // Frame > cap : tronquée à CAP + ellipse (longueur = CAP+1).
      const big = recv.find((p) => p.startsWith("yyyy"));
      expect(big, "frame oversized loggée").to.be.a("string");
      expect((big as string).length).to.equal(CAP + 1);
      expect((big as string).endsWith("…")).to.equal(true);

      // Frame binaire : résumée, JAMAIS sérialisée (pas de {"0":..} géant).
      expect(
        recv.some((p) => p === "[binary 128 B]"),
        "binaire résumé",
      ).to.equal(true);
    });
  },
);
