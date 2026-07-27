/// <reference types="node" />
/**
 * Integration — RADIOGRAPHIE de la porte SOCKET (profil PAR FRAME).
 * Requires: server running on 5152 (wss). Start: /start-server
 *
 * Le contexte WebSocket vit pour la CONNEXION : son `requestId` est unique pour
 * toute la socket et ses phases sont cumulatives. Une invocation du pont
 * (`api.request`) reçoit donc son propre profil, identifié
 * `<requestId de la connexion>.<n° de frame>`, rendu au client dans un champ
 * `meta` FRÈRE du `result` (le `result` reste la valeur nue : « snapshot ≡ GET
 * REST »).
 *
 * Gates :
 *  1. la réponse du pont porte `meta.requestId`, et `result` reste inchangé ;
 *  2. ce `requestId` est un profil `kind: "ws"` dans le Profiler, avec la route,
 *     l'action et un waterfall de phases ;
 *  3. deux frames de la MÊME socket → deux profils DISTINCTS (pas de cumul) ;
 *  4. un refus (404) est profilé aussi, et son id voyage dans `error.data`.
 */
import { expect } from "chai";
import https from "node:https";
import WebSocket from "ws";
import { IS_PROD_TARGET } from "../helpers/targetEnv";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const AUTH = "/nodefony/security/api/auth";
const HUB_URL = "wss://127.0.0.1:5152/nodefony/studio/api/realtime";
const MODULES_PATH = "/nodefony/kernel/api/modules";
const GHOST_PATH = "/nodefony/kernel/api/ghost-route-that-never-existed";
const TIMEOUT = 10_000;

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

function request(
  path: string,
  method: string,
  headers: Record<string, string> = {},
  payload: unknown = undefined,
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
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            /* texte brut */
          }
          resolve({
            status: res.statusCode!,
            headers: res.headers as Record<string, unknown>,
            body,
          });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    if (data) req.write(data);
    req.end();
  });
}

function sessionCookieOf(res: Res): string | null {
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof first !== "string") return null;
  return first.split(";")[0] ?? null;
}

async function loginCookie(identifier: string, password: string) {
  const res = await request(
    `${AUTH}/login`,
    "POST",
    {},
    { username: identifier, password },
  );
  expect(res.status, "login").to.equal(200);
  const cookie = sessionCookieOf(res);
  expect(cookie, "session cookie").to.be.a("string");
  return cookie as string;
}

/** Réponse JSON-RPC : `meta` est le champ frère du `result` (radiographie). */
type JsonRpcReply = {
  id: number;
  result?: unknown;
  meta?: { requestId?: string };
  error?: {
    code: number;
    message: string;
    data?: { status?: number; requestId?: string };
  };
};

/** Profil serveur (forme lue du data plane du Profiler). */
type Profile = {
  requestId: string;
  kind: string;
  method: string | null;
  url: string;
  status: number | null;
  durationMs: number | null;
  route: string | null;
  controller: string | null;
  action: string | null;
  error: string | null;
  phases: { name: string; startMs: number; durationMs: number | null }[];
};

function hubConnect(cookie: string): Promise<{
  request: (path: string) => Promise<JsonRpcReply>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB_URL, {
      rejectUnauthorized: false,
      headers: { cookie },
    });
    const pending = new Map<number, (r: JsonRpcReply) => void>();
    let nextId = 1;
    const timer = setTimeout(
      () => reject(new Error("welcome timeout")),
      TIMEOUT,
    );
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.on("message", (data: Buffer) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (frame.method === "realtime:welcome") {
        clearTimeout(timer);
        resolve({
          request: (path: string) =>
            new Promise<JsonRpcReply>((res, rej) => {
              const id = nextId++;
              const t = setTimeout(
                () => rej(new Error(`rpc timeout ${path}`)),
                TIMEOUT,
              );
              pending.set(id, (reply) => {
                clearTimeout(t);
                res(reply);
              });
              ws.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  method: "api.request",
                  params: { path },
                }),
              );
            }),
          close: () => ws.close(),
        });
        return;
      }
      if (typeof frame.id === "number" && !frame.method) {
        pending.get(frame.id as number)?.(frame as unknown as JsonRpcReply);
        pending.delete(frame.id as number);
      }
    });
  });
}

/** Lit un profil au data plane du Profiler (dev-only). */
async function profileOf(cookie: string, requestId: string): Promise<Profile> {
  const res = await request(
    `/nodefony/profiler/api/${encodeURIComponent(requestId)}`,
    "GET",
    { cookie },
  );
  expect(res.status, `profil ${requestId}`).to.equal(200);
  return res.body as Profile;
}

// La radiographie est une capacité de DÉVELOPPEMENT : `WebsocketContext.beginFrame`
// rend `null` quand profiler et timing sont éteints — zéro allocation par frame en
// production, donc pas de `meta.requestId` à lire. Ces trois cas ne peuvent donc
// s'écrire que contre un serveur de développement ; ce que la production doit tenir
// (le pont répond, sans radiographie) est éprouvé juste après.
describe.skipIf(IS_PROD_TARGET)(
  "Pont api.request — radiographie PAR FRAME (requires server)",
  () => {
    it("la réponse porte meta.requestId, et ce profil est un kind ws complet", async () => {
      const cookie = await loginCookie("admin", "secret");
      const hub = await hubConnect(cookie);
      try {
        const reply = await hub.request(MODULES_PATH);
        expect(reply.error, "pas d'erreur RPC").to.equal(undefined);
        // Le contrat « result nu » est INTACT : la méta voyage à côté (cette route
        // rend un TABLEAU de modules — la méta ne l'a donc pas emballé).
        expect(reply.result, "result").to.be.an("array");
        const requestId = reply.meta?.requestId;
        expect(requestId, "meta.requestId").to.be.a("string");
        // Une frame, pas une connexion : l'id est suffixé du n° d'invocation.
        expect(requestId).to.match(/\.\d+$/);

        const profile = await profileOf(cookie, requestId as string);
        expect(profile.kind, "kind").to.equal("ws");
        expect(profile.status, "status").to.equal(200);
        expect(profile.method, "méthode logique").to.equal("GET");
        expect(profile.url, "url de la FRAME (pas de la connexion)").to.equal(
          MODULES_PATH,
        );
        expect(profile.controller, "controller").to.be.a("string");
        expect(profile.action, "action").to.be.a("string");
        // Le waterfall de la porte socket : au minimum le resolve et l'action.
        const names = profile.phases.map((p) => p.name);
        expect(names, "phases").to.include("resolve");
        expect(names, "phases").to.include("action");
        expect(profile.durationMs, "durée").to.be.a("number");
      } finally {
        hub.close();
      }
    });

    it("deux frames de la MÊME socket → deux profils distincts (aucun cumul de phases)", async () => {
      const cookie = await loginCookie("admin", "secret");
      const hub = await hubConnect(cookie);
      try {
        const first = await hub.request(MODULES_PATH);
        const second = await hub.request(MODULES_PATH);
        const id1 = first.meta?.requestId as string;
        const id2 = second.meta?.requestId as string;
        expect(id1, "id frame 1").to.be.a("string");
        expect(id2, "id frame 2").to.be.a("string");
        expect(id1, "deux frames = deux profils").to.not.equal(id2);
        // Même connexion → même préfixe, numéros d'invocation qui se suivent.
        expect(id1.slice(0, id1.lastIndexOf("."))).to.equal(
          id2.slice(0, id2.lastIndexOf(".")),
        );

        const p1 = await profileOf(cookie, id1);
        const p2 = await profileOf(cookie, id2);
        // La preuve du non-cumul : la 2ᵉ frame ne porte pas les phases de la 1ʳᵉ.
        expect(p2.phases.length, "phases de la 2ᵉ frame").to.equal(
          p1.phases.length,
        );
        expect(p1.phases.filter((p) => p.name === "action").length).to.equal(1);
        expect(p2.phases.filter((p) => p.name === "action").length).to.equal(1);
      } finally {
        hub.close();
      }
    });

    it("un refus (404) est profilé, et son id voyage dans error.data", async () => {
      const cookie = await loginCookie("admin", "secret");
      const hub = await hubConnect(cookie);
      try {
        const reply = await hub.request(GHOST_PATH);
        expect(reply.error?.data?.status, "statut du refus").to.equal(404);
        const requestId = reply.error?.data?.requestId;
        expect(requestId, "id du profil du refus").to.be.a("string");

        const profile = await profileOf(cookie, requestId as string);
        expect(profile.kind).to.equal("ws");
        expect(profile.status, "le refus est profilé AVEC son statut").to.equal(
          404,
        );
        expect(profile.error, "motif du refus").to.be.a("string");
      } finally {
        hub.close();
      }
    });
  },
);

// Le versant PRODUCTION de la même porte : ce qu'on ne mesure plus ne doit rien
// coûter au service rendu. Sans ce cas, le mode livré n'aurait AUCUNE preuve que
// le pont RPC fonctionne — le fichier entier se serait tu, et un pont cassé en
// production serait passé pour un banc « dev-only ».
describe.runIf(IS_PROD_TARGET)(
  "Pont api.request — en production, le pont répond SANS radiographie",
  () => {
    it("result nu, aucun meta.requestId (profil par frame non alloué)", async () => {
      const cookie = await loginCookie("admin", "secret");
      const hub = await hubConnect(cookie);
      try {
        const reply = await hub.request(MODULES_PATH);
        expect(reply.error, "pas d'erreur RPC").to.equal(undefined);
        expect(reply.result, "result").to.be.an("array");
        expect(
          reply.meta?.requestId,
          "aucune radiographie en production",
        ).to.equal(undefined);
      } finally {
        hub.close();
      }
    });

    it("un refus reste un refus (404 exposé), sans id de profil", async () => {
      const cookie = await loginCookie("admin", "secret");
      const hub = await hubConnect(cookie);
      try {
        const reply = await hub.request(GHOST_PATH);
        expect(reply.error?.data?.status, "statut du refus").to.equal(404);
        expect(
          reply.error?.data?.requestId,
          "pas de profil en production",
        ).to.equal(undefined);
      } finally {
        hub.close();
      }
    });
  },
);
