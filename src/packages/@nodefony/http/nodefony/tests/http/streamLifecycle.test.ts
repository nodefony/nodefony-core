/// <reference types="node" />
import { expect } from "vitest";
import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import { IS_PROD_TARGET } from "../helpers/targetEnv";

/**
 * Table de PARITÉ du cycle de vie d'une réponse en flux (#724).
 *
 * Le SSE (`openSseStream`) et le flux d'octets (`openStream`) reposent sur la
 * MÊME brique de cycle de vie : prise de la réponse, session sauvée avant les
 * en-têtes, fermeture lue sur la réponse, fin idempotente, gardes de durée.
 * Chaque type de flux est une ligne de `KINDS`, et chaque cas ci-dessous est
 * joué sur chaque ligne : si l'un diverge de l'autre, c'est ici que ça rougit.
 *
 * Chaque ligne expose le MÊME vocabulaire de routes sous sa base :
 * `hold` (tenu ouvert, premier morceau envoyé), `end` (fin par le serveur,
 * demandée deux fois), `session?v=` (valeur de session posée avant
 * l'ouverture), `taken` (seconde ouverture tentée), `limits?stall=&flood=1`
 * et `limits?duration=`, `state`, `reset`.
 *
 * Hors de cette table, parce qu'ils exigent un décor à part : le plafond par
 * IP et la révocation (`sse-guards.attack.test.ts`, V30-V34), et le délai
 * d'inactivité désarmé (30 s par défaut).
 */

const H1 = "http://localhost:5151";
const H2 = "https://localhost:5152";
const H2C = "http://localhost:5153";

interface IKind {
  name: string;
  base: string;
}

const KINDS: IKind[] = [{ name: "SSE", base: "/nodefony/test/sse" }];

type Transport = "HTTP/1.1" | "HTTP/2" | "h2c";
const TRANSPORTS: Transport[] = ["HTTP/1.1", "HTTP/2", "h2c"];

/** Comment le client a vu la réponse finir : fin propre, ou coupure. */
type Ending = "end" | "abort";

interface IFlow {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  raw: string;
  /** Réglée au premier morceau du corps. */
  first: Promise<void>;
  /** Réglée à la fin vue par le client. */
  done: Promise<Ending>;
  /** Le client s'en va : HTTP/1.1 détruit la socket, HTTP/2 annule le flux seul. */
  leave(): void;
  /** Libère la session HTTP/2 du client (sans effet en HTTP/1.1). */
  dispose(): void;
}

/** Ouvre une réponse en HTTP/1.1 et rend la main à l'arrivée des en-têtes. */
function openH1(path: string): Promise<IFlow> {
  return new Promise((resolve, reject) => {
    let settleFirst!: () => void;
    let settleDone!: (e: Ending) => void;
    const first = new Promise<void>((r) => (settleFirst = r));
    const done = new Promise<Ending>((r) => (settleDone = r));
    const req = http.request(`${H1}${path}`, (res) => {
      const flow: IFlow = {
        status: res.statusCode ?? 0,
        headers: res.headers,
        raw: "",
        first,
        done,
        leave: () => req.destroy(),
        dispose: () => undefined,
      };
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        flow.raw += chunk;
        settleFirst();
      });
      res.on("end", () => settleDone("end"));
      res.on("close", () => settleDone(res.complete ? "end" : "abort"));
      resolve(flow);
    });
    req.on("error", (e) => {
      settleDone("abort");
      reject(e);
    });
    req.end();
  });
}

/** Même ouverture en HTTP/2, chiffré ou en clair (h2c). */
function openH2(path: string, origin: string): Promise<IFlow> {
  return new Promise((resolve, reject) => {
    let settleFirst!: () => void;
    let settleDone!: (e: Ending) => void;
    const first = new Promise<void>((r) => (settleFirst = r));
    const done = new Promise<Ending>((r) => (settleDone = r));
    const session = http2.connect(origin, { rejectUnauthorized: false });
    session.on("error", reject);
    const req = session.request({ ":path": path, ":method": "GET" });
    const flow: IFlow = {
      status: 0,
      headers: {},
      raw: "",
      first,
      done,
      leave: () => req.close(http2.constants.NGHTTP2_CANCEL),
      dispose: () => session.close(),
    };
    req.on("response", (headers) => {
      flow.status = Number(headers[":status"]);
      flow.headers = headers;
      resolve(flow);
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      flow.raw += chunk;
      settleFirst();
    });
    req.on("end", () => settleDone("end"));
    req.on("close", () =>
      settleDone(
        req.rstCode === http2.constants.NGHTTP2_NO_ERROR ? "end" : "abort",
      ),
    );
    req.on("error", () => settleDone("abort"));
    req.end();
  });
}

function open(transport: Transport, path: string): Promise<IFlow> {
  if (transport === "HTTP/1.1") return openH1(path);
  return openH2(path, transport === "HTTP/2" ? H2 : H2C);
}

interface IState {
  opened: number;
  closed: number;
  closeSawRequestId: Array<string | null>;
  sendedAtOpen: boolean | null;
  contextClosed: number;
  refusedStatus: number | null;
}

async function getState(
  kind: IKind,
  route: "state" | "reset",
): Promise<IState> {
  const res = await fetch(`${H1}${kind.base}/${route}`);
  return (await res.json()) as IState;
}

async function until(check: () => Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("délai dépassé");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const kind of KINDS) {
  describe(`Parité du cycle de vie — ${kind.name} (requires server)`, () => {
    beforeEach(async () => {
      await getState(kind, "reset");
    });

    it("la réponse est PRISE dès le retour de l'ouverture", async () => {
      const flow = await open("HTTP/1.1", `${kind.base}/hold`);
      await flow.first;
      expect((await getState(kind, "state")).sendedAtOpen).to.equal(true);
      flow.leave();
      await until(async () => (await getState(kind, "state")).closed === 1);
    });

    for (const transport of TRANSPORTS) {
      // h2c n'existe que sur l'app de dev (servers.h2c, éteint en production).
      const skip = IS_PROD_TARGET && transport === "h2c";

      it.skipIf(skip)(
        `${transport} : le départ du client termine le flux UNE fois, écouteur dans la bulle de la requête`,
        async () => {
          const flow = await open(transport, `${kind.base}/hold`);
          await flow.first;
          // Le client est encore là : rien ne doit être fermé.
          await pause(150);
          expect((await getState(kind, "state")).closed).to.equal(0);
          flow.leave();
          await until(async () => (await getState(kind, "state")).closed === 1);
          flow.dispose();
          // Une seconde fin (teardown du noyau, fermeture tardive) ne rappelle rien.
          await pause(150);
          const after = await getState(kind, "state");
          expect(after.closed).to.equal(1);
          expect(after.closeSawRequestId).to.have.length(1);
          expect(after.closeSawRequestId[0]).to.be.a("string");
        },
      );

      it.skipIf(skip)(
        `${transport} : fin par le serveur, demandée deux fois — le client voit UNE fin propre`,
        async () => {
          const flow = await open(transport, `${kind.base}/end`);
          expect(flow.status).to.equal(200);
          expect(await flow.done).to.equal("end");
          flow.dispose();
          await until(async () => (await getState(kind, "state")).closed === 1);
          const after = await getState(kind, "state");
          expect(after.closed, "fin du flux").to.equal(1);
          expect(after.contextClosed, "fin du contexte").to.equal(1);
        },
      );
    }

    it("la session est sauvée AVANT les en-têtes : son cookie part avec eux", async () => {
      const value = `parity-${Date.now()}`;
      const flow = await open("HTTP/1.1", `${kind.base}/session?v=${value}`);
      expect(await flow.done).to.equal("end");
      const setCookie = flow.headers["set-cookie"];
      if (!Array.isArray(setCookie))
        throw new Error("Set-Cookie absent de la réponse en flux");
      const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
      const read = await fetch(`${H1}/nodefony/test/rest/session/get/parity`, {
        headers: { cookie },
      });
      expect(((await read.json()) as { value: unknown }).value).to.equal(value);
    });

    it("une seconde ouverture est refusée (500), le premier flux finit normalement", async () => {
      const flow = await open("HTTP/1.1", `${kind.base}/taken`);
      expect(flow.status).to.equal(200);
      expect(await flow.done).to.equal("end");
      expect(flow.raw.length).to.be.greaterThan(0);
      expect((await getState(kind, "state")).refusedStatus).to.equal(500);
    });

    it("un client qui ne lit plus est COUPÉ au bout de stallTimeout", async () => {
      const socket = net.connect(5151, "127.0.0.1", () => {
        socket.write(
          `GET ${kind.base}/limits?stall=300&flood=1 HTTP/1.1\r\nHost: localhost:5151\r\n\r\n`,
        );
        socket.pause();
      });
      socket.on("error", () => undefined);
      try {
        await until(
          async () => (await getState(kind, "state")).closed === 1,
          5000,
        );
      } finally {
        socket.destroy();
      }
    });

    it("la durée de vie maximale ferme le flux d'elle-même", async () => {
      const flow = await open("HTTP/1.1", `${kind.base}/limits?duration=150`);
      const ending = await Promise.race([
        flow.done,
        pause(2000).then(() => "pending" as const),
      ]);
      expect(ending).to.not.equal("pending");
      await until(async () => (await getState(kind, "state")).closed === 1);
    });
  });
}
