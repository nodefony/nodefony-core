/// <reference types="node" />
/**
 * #663 — canal `diagnostics_channel` `nodefony.http.request`.
 *
 * Un abonné RÉEL vit dans le process du serveur (sonde
 * `src/modules/test/.../TraceChannelController.ts`) : le banc l'arme, émet des
 * requêtes réelles, relit ce que l'abonné a vu, puis le désarme — le serveur
 * retrouve alors le coût nul (aucun abonné) que mesure le gate mémoire.
 *
 * Requiert le serveur dev (port 5152, https/wss).
 */
import { expect } from "vitest";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { expectHandshakeRefused, handshake } from "../helpers/wsHandshake";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const PROBE = "/nodefony/test/trace-channel";
const WSS = "wss://localhost:5152";
const WS_ROUTE = `${WSS}/nodefony/test/ws`;

interface ISnapshot {
  event: string;
  protocol: string;
  method: string | null;
  scheme: string;
  url: string;
  route: string | null;
  routePath: string | null;
  module: string | null;
  statusCode: number | null;
  durationMs: number | null;
  error: string | null;
  sameObject: boolean;
}

const get = (
  path: string,
  requestId?: string,
): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const r = https.request(
      {
        ...BASE,
        method: "GET",
        path,
        headers: requestId ? { "X-Request-Id": requestId } : {},
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    r.on("error", reject);
    r.end();
  });

const readEvents = async (): Promise<Record<string, ISnapshot[]>> => {
  const res = await get(`${PROBE}/events`);
  return JSON.parse(res.body) as Record<string, ISnapshot[]>;
};

/** Attend la fin de la trace : `asyncEnd` part au `close`, APRÈS la réponse. */
const waitForEnd = async (requestId: string): Promise<ISnapshot[]> => {
  const deadline = Date.now() + 3000;
  for (;;) {
    const events = (await readEvents())[requestId] ?? [];
    if (events.some((e) => e.event === "asyncEnd")) return events;
    if (Date.now() > deadline) return events;
    await new Promise((r) => setTimeout(r, 20));
  }
};

const names = (events: ISnapshot[]): string[] => events.map((e) => e.event);
const last = (events: ISnapshot[]): ISnapshot => {
  const end = events.at(-1);
  if (end === undefined) throw new Error("aucun événement");
  return end;
};

describe("Canal diagnostics_channel nodefony.http.request (#663, requires server)", () => {
  let armId = "";

  beforeAll(async () => {
    armId = randomUUID();
    const res = await get(`${PROBE}/arm`, armId);
    expect(res.status).to.equal(200);
  });

  afterAll(async () => {
    await get(`${PROBE}/disarm`);
  });

  it("une requête commencée AVANT l'abonnement n'émet rien, pas même sa fin", async () => {
    // La requête `/arm` s'est abonnée en cours de route : sa fin a lieu après
    // l'abonnement, mais son début avant — aucune fin orpheline.
    await get(`${PROBE}/ok`, randomUUID());
    expect((await readEvents())[armId]).to.equal(undefined);
  });

  it("HTTP servi : start → end → asyncStart → asyncEnd, un seul objet, résultat rempli à la fin", async () => {
    const id = randomUUID();
    const res = await get(`${PROBE}/ok`, id);
    expect(res.status).to.equal(200);
    const events = await waitForEnd(id);
    expect(names(events)).to.deep.equal([
      "start",
      "end",
      "asyncStart",
      "asyncEnd",
    ]);
    expect(events.every((e) => e.sameObject)).to.equal(true);
    const start = events[0];
    expect(start?.protocol).to.equal("http");
    expect(start?.method).to.equal("GET");
    expect(start?.scheme).to.equal("https");
    expect(start?.url).to.contain(`${PROBE}/ok`);
    // À l'entrée, rien du résultat n'est encore connu.
    expect(start?.route).to.equal(null);
    expect(start?.statusCode).to.equal(null);
    expect(start?.durationMs).to.equal(null);
    const end = last(events);
    expect(end.statusCode).to.equal(200);
    expect(end.routePath).to.equal(`${PROBE}/ok`);
    expect(end.route).to.be.a("string");
    expect(end.module).to.equal("test");
    expect(end.durationMs).to.be.a("number");
    expect(end.durationMs).to.be.greaterThan(0);
    expect(end.error).to.equal(null);
  });

  it("la route racine publie le gabarit `/`, jamais une chaîne vide", async () => {
    // Le routeur range la racine en `""` : un `http.route` vide serait faux.
    const id = randomUUID();
    const res = await get("/", id);
    expect(res.status).to.equal(200);
    const end = last(await waitForEnd(id));
    expect(end.routePath).to.equal("/");
    expect(end.module).to.equal("app");
  });

  it("HTTP en erreur : `error` publié avant asyncStart, statut 500", async () => {
    const id = randomUUID();
    const res = await get("/nodefony/test/crash/sync", id);
    expect(res.status).to.equal(500);
    const events = await waitForEnd(id);
    expect(names(events)).to.deep.equal([
      "start",
      "end",
      "error",
      "asyncStart",
      "asyncEnd",
    ]);
    const end = last(events);
    expect(end.statusCode).to.equal(500);
    expect(end.error).to.be.a("string");
  });

  it("handshake WebSocket accepté : fin publiée à l'acceptation, statut 101", async () => {
    const id = randomUUID();
    const outcome = await handshake(WS_ROUTE, {
      headers: { "X-Request-Id": id },
    });
    expect(outcome.kind).to.equal("open");
    if (outcome.kind === "open") outcome.ws.terminate();
    const events = await waitForEnd(id);
    expect(names(events)).to.deep.equal([
      "start",
      "end",
      "asyncStart",
      "asyncEnd",
    ]);
    const end = last(events);
    expect(end.protocol).to.equal("websocket");
    expect(end.scheme).to.equal("wss");
    expect(end.statusCode).to.equal(101);
    expect(end.error).to.equal(null);
  });

  it("handshake WebSocket refusé : `error` puis fin, avec le statut du refus", async () => {
    const id = randomUUID();
    const refused = await expectHandshakeRefused(WS_ROUTE, {
      origin: "https://evil.example.com",
      headers: { "X-Request-Id": id },
    });
    expect(refused.status).to.equal(403);
    const events = await waitForEnd(id);
    expect(names(events)).to.deep.equal([
      "start",
      "end",
      "error",
      "asyncStart",
      "asyncEnd",
    ]);
    const end = last(events);
    expect(end.statusCode).to.equal(403);
    expect(end.error).to.be.a("string");
  });

  it("désabonné : plus rien n'est publié", async () => {
    // `disarm` vide l'état et se désabonne ; la lecture ne réarme pas : si le
    // désabonnement ne mordait pas, l'abonné enregistrerait encore.
    await get(`${PROBE}/disarm`);
    const id = randomUUID();
    await get(`${PROBE}/ok`, id);
    await new Promise((r) => setTimeout(r, 100));
    expect((await readEvents())[id]).to.equal(undefined);
  });
});
