/// <reference types="node" />
/**
 * Integration — ce que les quatre vitrines de front consomment, sur le serveur
 * réel : le journal du serveur en flux SSE, et l'identité de leur socket.
 *
 *  - `GET /nodefony/test/api/syslog` vit dans la zone d'administration : un
 *    anonyme reçoit 401, un compte sans rôle de plateforme 403, l'administrateur
 *    un flux d'événements `log` — jamais une ligne DEBUG, et une reprise par
 *    `Last-Event-ID` qui ne rejoue rien de déjà reçu ;
 *  - `/api/live/realtime` est couvert par la zone `test-live` (session puis
 *    anonyme) : l'accueil porte l'identité de la session quand il y en a une,
 *    et l'anonyme se connecte toujours.
 *
 * Requires: server on 5152 (HTTPS) + users `admin`/`user` (secret-de-dev-42).
 * Start: /start-server
 */
import { expect } from "vitest";
import https from "node:https";
import WebSocket from "ws";

const HOST = "localhost";
const PORT = 5152;
const SYSLOG = "/nodefony/test/api/syslog";

/** Connexion BFF : rend le cookie de session. */
function login(username: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(
      JSON.stringify({ username, password: "secret-de-dev-42" }),
    );
    const r = https.request(
      {
        hostname: HOST,
        port: PORT,
        rejectUnauthorized: false,
        method: "POST",
        path: "/nodefony/security/api/auth/login",
        headers: {
          "content-type": "application/json",
          "content-length": String(data.length),
        },
      },
      (res) => {
        res.resume();
        const setCookie = res.headers["set-cookie"]?.[0] ?? "";
        const cookie = setCookie.split(";")[0] ?? "";
        if (!cookie) reject(new Error(`login ${username} : ${res.statusCode}`));
        else resolve(cookie);
      },
    );
    r.on("error", reject);
    r.end(data);
  });
}

interface IFrame {
  id: number;
  severity: string;
}

/**
 * Ouvre le flux et lit jusqu'à `count` événements `log` (ou la fin du délai),
 * puis COUPE la connexion — comme un onglet qu'on ferme.
 */
function readStream(
  headers: Record<string, string>,
  count: number,
): Promise<{ status: number; frames: IFrame[] }> {
  return new Promise((resolve, reject) => {
    const frames: IFrame[] = [];
    const r = https.request(
      {
        hostname: HOST,
        port: PORT,
        rejectUnauthorized: false,
        method: "GET",
        path: SYSLOG,
        headers: { accept: "text/event-stream", ...headers },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status !== 200) {
          res.resume();
          resolve({ status, frames });
          return;
        }
        let buffer = "";
        const done = () => {
          clearTimeout(timer);
          r.destroy();
          resolve({ status, frames });
        };
        const timer = setTimeout(done, 3000);
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let end = buffer.indexOf("\n\n");
          while (end !== -1) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (/^event: log$/m.test(block) && data) {
              const parsed: unknown = JSON.parse(data);
              if (typeof parsed === "object" && parsed !== null) {
                const p: Record<string, unknown> = { ...parsed };
                frames.push({
                  id: Number(p.id),
                  severity: String(p.severity),
                });
              }
            }
            if (frames.length >= count) return done();
            end = buffer.indexOf("\n\n");
          }
        });
      },
    );
    r.on("error", (e: NodeJS.ErrnoException) => {
      // La coupure volontaire du banc n'est pas une erreur.
      if (e.code !== "ECONNRESET") reject(e);
    });
    r.end();
  });
}

/** Ouvre la socket des vitrines et rend l'identité de son accueil. */
function welcomeIdentity(cookie?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${HOST}:${PORT}/api/live/realtime`, {
      rejectUnauthorized: false,
      headers: {
        origin: `https://${HOST}:${PORT}`,
        ...(cookie ? { cookie } : {}),
      },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("aucun realtime:welcome en 5 s"));
    }, 5000);
    ws.on("message", (raw: Buffer) => {
      const frame: unknown = JSON.parse(raw.toString());
      if (typeof frame !== "object" || frame === null) return;
      const f: Record<string, unknown> = { ...frame };
      if (f.method !== "realtime:welcome") return;
      clearTimeout(timer);
      ws.close();
      const params: Record<string, unknown> =
        typeof f.params === "object" && f.params !== null
          ? { ...f.params }
          : {};
      resolve(
        typeof params.identity === "object" && params.identity !== null
          ? { ...params.identity }
          : {},
      );
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

describe("journal du serveur en SSE — /nodefony/test/api/syslog", () => {
  it("anonyme : 401 — un journal d'exploitation n'est pas public", async () => {
    const { status } = await readStream({}, 1);
    expect(status).toBe(401);
  });

  it("compte sans rôle de plateforme : 403", async () => {
    const cookie = await login("user");
    const { status } = await readStream({ cookie }, 1);
    expect(status).toBe(403);
  });

  it("administrateur : un flux d'événements log, sans aucune ligne DEBUG", async () => {
    const cookie = await login("admin");
    const { status, frames } = await readStream({ cookie }, 5);
    expect(status).toBe(200);
    expect(frames.length, "le tampon rejoué doit suffire").toBeGreaterThan(0);
    for (const f of frames) expect(f.severity).not.toBe("DEBUG");
  });

  it("reprise par Last-Event-ID : rien de déjà reçu n'est rejoué", async () => {
    const cookie = await login("admin");
    const first = await readStream({ cookie }, 5);
    const last = first.frames.at(-1)!.id;
    const again = await readStream(
      { cookie, "last-event-id": String(last) },
      3,
    );
    expect(again.status).toBe(200);
    for (const f of again.frames) expect(f.id).toBeGreaterThan(last);
  });
});

describe("socket des vitrines — zone test-live (session puis anonyme)", () => {
  it("sans cookie : la socket s'ouvre, identité anonyme", async () => {
    const identity = await welcomeIdentity();
    expect(identity.authenticated).toBe(false);
  });

  it("avec la session de la console : l'accueil porte l'identité", async () => {
    const identity = await welcomeIdentity(await login("admin"));
    expect(identity.authenticated).toBe(true);
    expect(identity.userIdentifier).toBe("admin");
  });
});
