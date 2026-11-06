/// <reference types="node" />
import { expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { stripVTControlCharacters } from "node:util";
import { IS_PROD_TARGET } from "../helpers/targetEnv";
import {
  H1,
  openFlow,
  pause,
  until,
  type Transport,
} from "../helpers/streamClient";

/**
 * Ce qui est PROPRE au flux d'octets (`renderStream` / `openStream`, #724) —
 * le cycle de vie commun avec le SSE est éprouvé par la table de parité
 * (`streamLifecycle.test.ts`). Ici : HEAD, erreur de la source avant et après
 * le premier morceau, source muette, source déjà finie, producteur bloqué en
 * écriture, relais `fetch`.
 */

const BASE = "/nodefony/test/stream";

interface IResult {
  reason: string;
  bytes: number;
}

interface IStreamState {
  sendedAtOpen: boolean | null;
  closed: number;
  reasons: string[];
  lastResult: IResult | null;
  sourceDestroyed: boolean | null;
  childExited: boolean | null;
  sessionWrites: number | null;
}

async function state(
  route: "state" | "reset" = "state",
): Promise<IStreamState> {
  const res = await fetch(`${H1}${BASE}/${route}`);
  return (await res.json()) as IStreamState;
}

/** Attend la fin du dernier flux et la rend. */
async function lastResult(ms = 3000): Promise<IResult> {
  let result: IResult | null = null;
  await until(async () => {
    result = (await state()).lastResult;
    return result !== null;
  }, ms);
  if (result === null) throw new Error("aucun résultat");
  return result;
}

interface IJournalEntry {
  severity: string;
  msgid: string;
  text: string;
}

/**
 * Repère du journal du serveur : rend la lecture de ce qui suit.
 *
 * Le texte est rendu SANS codes de couleur : le journal d'accès se colore à
 * l'émission quand le serveur tourne sous `FORCE_COLOR` (la CI le pose), et
 * une ligne `\x1b[36mGET` ne répond plus à `/^GET\s+500\s/` — ni une phrase
 * colorée à l'`includes` d'`expectQuietJournal`, qui passerait alors à vide.
 */
async function journalFrom(): Promise<() => Promise<IJournalEntry[]>> {
  const mark = await fetch(`${H1}${BASE}/journal/mark`);
  const { uid } = (await mark.json()) as { uid: number };
  return async () => {
    const res = await fetch(`${H1}${BASE}/journal?since=${uid}`);
    const entries = (await res.json()) as IJournalEntry[];
    for (const e of entries) e.text = stripVTControlCharacters(e.text);
    return entries;
  };
}

/**
 * Les erreurs ÉCRITES au journal, hors lignes d'accès : une réponse 5xx
 * journalise aussi sa ligne d'accès en ERROR, mais c'est un autre fait.
 */
function errorsOf(entries: IJournalEntry[]): IJournalEntry[] {
  return entries.filter((e) => e.severity === "ERROR" && e.msgid !== "req");
}

/** La ligne d'accès (`req`) d'une URL, lue après le repère. */
async function accessLine(
  read: () => Promise<IJournalEntry[]>,
  path: string,
): Promise<string> {
  const lines = (await read()).filter(
    (e) => e.msgid === "req" && e.text.includes(path),
  );
  expect(lines, `ligne d'accès de ${path}`).to.have.length(1);
  return lines[0]?.text ?? "";
}

/** Ce que le journal ne doit JAMAIS porter après un flux. */
function expectQuietJournal(entries: IJournalEntry[]): void {
  const joined = entries.map((e) => `${e.msgid} ${e.text}`);
  expect(
    joined.filter((t) => t.includes("onError on closed context")),
    "« onError on closed context »",
  ).to.have.length(0);
  expect(
    joined.filter((t) => /n'a rien envoyé|délai d'expiration/.test(t)),
    "« réponse non envoyée »",
  ).to.have.length(0);
}

const H2_TRANSPORTS: Transport[] = IS_PROD_TARGET
  ? ["HTTP/2"]
  : ["HTTP/2", "h2c"];

describe("Flux d'octets — renderStream (requires server)", () => {
  beforeEach(async () => {
    await state("reset");
  });

  for (const transport of ["HTTP/1.1", ...H2_TRANSPORTS] as Transport[]) {
    it(`${transport} : HEAD rend les en-têtes du GET, sans corps, et détruit la source`, async () => {
      const flow = await openFlow(transport, `${BASE}/end`, "HEAD");
      expect(flow.status).to.equal(200);
      expect(String(flow.headers["content-type"])).to.match(/^text\/plain/);
      expect(await flow.done).to.equal("end");
      flow.dispose();
      expect(flow.raw).to.equal("");
      expect(await lastResult()).to.deep.equal({ reason: "end", bytes: 0 });
      expect((await state()).sourceDestroyed).to.equal(true);
    });

    it(`${transport} : une erreur APRÈS le premier octet est une COUPURE, jamais une fin propre`, async () => {
      const flow = await openFlow(transport, `${BASE}/fail?when=after`);
      expect(flow.status).to.equal(200);
      expect(await flow.done).to.equal("abort");
      flow.dispose();
      expect(flow.raw).to.equal("prêt");
      expect(await lastResult()).to.deep.equal({ reason: "error", bytes: 5 });
    });
  }

  it("GET : en-têtes par défaut d'un flux, et le corps entier", async () => {
    const res = await fetch(`${H1}${BASE}/end`);
    expect(res.status).to.equal(200);
    expect(res.headers.get("cache-control")).to.equal("no-cache, no-transform");
    expect(res.headers.get("x-accel-buffering")).to.equal("no");
    expect(res.headers.get("accept-ranges")).to.equal(null);
    expect(await res.text()).to.equal("prêt fin");
    expect(await lastResult()).to.deep.equal({ reason: "end", bytes: 9 });
  });

  it("une erreur AVANT le premier octet rend la page d'erreur ordinaire : 500", async () => {
    const res = await fetch(`${H1}${BASE}/fail?when=before`);
    expect(res.status).to.equal(500);
    await res.text();
    expect((await lastResult()).reason).to.equal("error");
    expect((await state()).sourceDestroyed).to.equal(true);
  });

  it("…et le code d'une HttpError levée par la source : 502", async () => {
    const res = await fetch(`${H1}${BASE}/fail?when=before&status=502`);
    expect(res.status).to.equal(502);
    await res.text();
    expect((await lastResult()).reason).to.equal("error");
  });

  it("journal d'une erreur AVANT le premier octet : jamais deux ERROR, ni « closed context », ni « non envoyée »", async () => {
    const read = await journalFrom();
    const res = await fetch(`${H1}${BASE}/fail?when=before`);
    expect(res.status).to.equal(500);
    await res.text();
    await lastResult();
    await pause(100);
    const entries = await read();
    // Une ERROR au plus : celle du moteur d'erreurs, écrite en mode debug.
    expect(errorsOf(entries), "entrées ERROR").to.have.length.at.most(1);
    expectQuietJournal(entries);
  });

  it("erreur AVANT le premier octet sur une session mutée : sauvée deux fois, ÉCRITE une fois", async () => {
    const res = await fetch(`${H1}${BASE}/fail-session`);
    expect(res.status).to.equal(500);
    expect(res.headers.get("set-cookie"), "cookie de session").to.not.equal(
      null,
    );
    await res.text();
    await lastResult();
    expect((await state()).sessionWrites, "écritures de session").to.equal(1);
  });

  it("journal d'une erreur APRÈS le premier octet : UNE seule ERROR, celle du flux", async () => {
    const read = await journalFrom();
    const flow = await openFlow("HTTP/1.1", `${BASE}/fail?when=after`);
    expect(await flow.done).to.equal("abort");
    flow.dispose();
    await lastResult();
    await pause(100);
    const entries = await read();
    const errors = errorsOf(entries);
    expect(errors, "entrées ERROR").to.have.length(1);
    expect(errors[0]?.msgid).to.equal("STREAM");
    expectQuietJournal(entries);
    // Coupé par le serveur : 500 au journal d'accès, jamais 499.
    expect(await accessLine(read, "/fail?when=after")).to.match(/^GET\s+500\s/);
  });

  it("journal d'un flux quitté par le client : aucun avertissement « réponse non envoyée »", async () => {
    const read = await journalFrom();
    const flow = await openFlow("HTTP/1.1", `${BASE}/hold`);
    await flow.first;
    flow.leave();
    expect((await lastResult()).reason).to.equal("client");
    flow.dispose();
    await pause(100);
    const entries = await read();
    expect(errorsOf(entries), "entrées ERROR").to.have.length(0);
    expectQuietJournal(entries);
  });

  it("Content-Length tenu : le corps fait EXACTEMENT la longueur annoncée", async () => {
    const res = await fetch(`${H1}${BASE}/length?declared=9`);
    expect(res.status).to.equal(200);
    expect(await res.text()).to.equal("prêt fin");
    expect(await lastResult()).to.deep.equal({ reason: "end", bytes: 9 });
  });

  it("Content-Length contredit dès le PREMIER morceau : rien n'est parti, page d'erreur 500", async () => {
    const res = await fetch(`${H1}${BASE}/length?declared=3`);
    expect(res.status).to.equal(500);
    await res.text();
    expect((await lastResult()).reason).to.equal("error");
  });

  for (const [declared, label] of [
    ["7", "PLUS LONGUE"],
    ["12", "PLUS COURTE"],
  ] as const) {
    for (const transport of ["HTTP/1.1", ...H2_TRANSPORTS] as Transport[]) {
      it(`${transport} : source ${label} que Content-Length (${declared}) → COUPURE, jamais une fin propre (RFC 9112 §6.3, RFC 9113 §8.1.1)`, async () => {
        const read = await journalFrom();
        const flow = await openFlow(
          transport,
          `${BASE}/length?declared=${declared}`,
        );
        expect(await flow.done).to.equal("abort");
        flow.dispose();
        expect((await lastResult()).reason).to.equal("error");
        await pause(100);
        if (transport === "HTTP/1.1") {
          expect(
            await accessLine(read, `/length?declared=${declared}`),
          ).to.match(/^GET\s+500\s/);
        }
      });
    }
  }

  it("HEAD : la longueur annoncée est celle du GET, aucun corps — jamais une coupure", async () => {
    const flow = await openFlow(
      "HTTP/1.1",
      `${BASE}/length?declared=9`,
      "HEAD",
    );
    expect(flow.status).to.equal(200);
    expect(flow.headers["content-length"]).to.equal("9");
    expect(await flow.done).to.equal("end");
    flow.dispose();
    expect(await lastResult()).to.deep.equal({ reason: "end", bytes: 0 });
  });

  it("un en-tête refusé au premier morceau rend 500, sans abattre le serveur", async () => {
    const res = await fetch(`${H1}${BASE}/bad-header`);
    expect(res.status).to.equal(500);
    expect(res.headers.get("x-injected")).to.equal(null);
    expect(res.headers.get("set-cookie") ?? "").to.not.contain("volé");
    await res.text();
    expect((await lastResult()).reason).to.equal("error");
    const health = await fetch(`${H1}${BASE}/state`);
    expect(health.status).to.equal(200);
  });

  it("une source MUETTE avant son premier octet rend 504 au bout d'idleTimeout", async () => {
    const started = Date.now();
    const res = await fetch(`${H1}${BASE}/limits?silent=1&idle=300`);
    expect(res.status).to.equal(504);
    await res.text();
    expect(Date.now() - started).to.be.lessThan(2500);
    expect(await lastResult()).to.deep.equal({ reason: "timeout", bytes: 0 });
  });

  it("une source qui se TAIT après son premier octet est coupée au bout d'idleTimeout", async () => {
    const read = await journalFrom();
    const flow = await openFlow("HTTP/1.1", `${BASE}/limits?idle=300`);
    expect(flow.status).to.equal(200);
    expect(await flow.done).to.equal("abort");
    expect((await lastResult()).reason).to.equal("timeout");
    // La ligne d'accès dit que le SERVEUR a coupé (504), pas que le client
    // est parti (499).
    await pause(100);
    expect(await accessLine(read, "/limits?idle=300")).to.match(/^GET\s+504\s/);
  });

  it("idleTimeout: 0 désarme le chien de garde : une source muette reste ouverte", async () => {
    // Les en-têtes partent au premier octet : une source muette ne rend RIEN,
    // pas même un statut. On observe donc la requête brute, sans l'attendre.
    let answered = false;
    const req = http.get(`${H1}${BASE}/limits?silent=1&idle=0`, (res) => {
      answered = true;
      res.resume();
    });
    req.on("error", () => undefined);
    await until(async () => (await state()).sendedAtOpen === true);
    await pause(1200);
    expect(answered, "ni 504 ni coupure").to.equal(false);
    expect((await state()).lastResult).to.equal(null);
    req.destroy();
    expect((await lastResult()).reason).to.equal("client");
  });

  for (const kind of ["empty", "destroyed"]) {
    it(`source déjà finie (${kind}) : réponse terminée, { end, 0 }, sans promesse pendue`, async () => {
      const res = await fetch(`${H1}${BASE}/finished?kind=${kind}`);
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal("");
      expect(await lastResult()).to.deep.equal({ reason: "end", bytes: 0 });
    });
  }

  it("producteur BLOQUÉ en écriture : le départ du client le libère en moins de 5 s, sans kill", async () => {
    const flow = await openFlow("HTTP/1.1", `${BASE}/child`);
    await flow.first;
    // Le client ne lit pas : le producteur se bloque sur sa sortie pleine.
    await pause(300);
    expect((await state()).childExited).to.equal(false);
    flow.leave();
    await until(async () => (await state()).childExited === true, 5000);
    expect((await lastResult()).reason).to.equal("client");
    expect((await state()).sourceDestroyed).to.equal(true);
  });

  it("relais fetch : le départ du client ferme la connexion amont en moins de 2 s", async () => {
    let markClosed!: () => void;
    const upstreamClosed = new Promise<void>((r) => (markClosed = r));
    const chunk = Buffer.alloc(16_384, 0x7a);
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/x-test" });
      const timer = setInterval(() => res.write(chunk), 20);
      res.on("close", () => {
        clearInterval(timer);
        markClosed();
      });
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const { port } = upstream.address() as AddressInfo;
    try {
      const flow = await openFlow("HTTP/1.1", `${BASE}/relay?port=${port}`);
      expect(flow.headers["content-type"]).to.equal("application/x-test");
      await flow.first;
      flow.leave();
      const closedInTime = await Promise.race([
        upstreamClosed.then(() => true),
        pause(2000).then(() => false),
      ]);
      expect(closedInTime, "amont fermé en moins de 2 s").to.equal(true);
      expect((await lastResult()).reason).to.equal("client");
    } finally {
      upstream.closeAllConnections();
      await new Promise((r) => upstream.close(r));
    }
  });
});

/**
 * `streamFile` (et ses habillages `renderFileDownload`, `renderMediaStream`)
 * repose sur la même brique : la réponse est prise à l'appel, la ligne d'accès
 * dit la vérité, et un fichier n'hérite pas des en-têtes d'un flux vivant.
 */
describe("Fichier en flux — streamFile sur la brique (requires server)", () => {
  const HTML = "/nodefony/test/html";

  it("téléchargement servi en ENTIER : 200 au journal d'accès, jamais 499", async () => {
    const read = await journalFrom();
    const res = await fetch(`${H1}${HTML}/download`);
    expect(res.status).to.equal(200);
    const body = await res.arrayBuffer();
    expect(body.byteLength).to.equal(Number(res.headers.get("content-length")));
    await pause(100);
    expect(await accessLine(read, `${HTML}/download`)).to.match(/^GET\s+200\s/);
    const entries = await read();
    expect(errorsOf(entries), "entrées ERROR").to.have.length(0);
    expectQuietJournal(entries);
  });

  it("média servi : aucun avertissement « réponse non envoyée »", async () => {
    const read = await journalFrom();
    const res = await fetch(`${H1}${HTML}/media`);
    expect(res.status).to.equal(200);
    await res.arrayBuffer();
    await pause(100);
    const entries = await read();
    expect(errorsOf(entries), "entrées ERROR").to.have.length(0);
    expectQuietJournal(entries);
  });

  it("un fichier n'hérite pas des en-têtes d'un flux VIVANT ; son type et sa taille sont gardés", async () => {
    const res = await fetch(`${H1}${HTML}/stream`);
    expect(res.status).to.equal(200);
    expect(res.headers.get("content-type")).to.match(/^application\/json/);
    expect(res.headers.get("cache-control")).to.equal(null);
    expect(res.headers.get("x-accel-buffering")).to.equal(null);
    const body = await res.arrayBuffer();
    expect(body.byteLength).to.be.greaterThan(0);
    expect(body.byteLength).to.equal(Number(res.headers.get("content-length")));
  });

  for (const transport of ["HTTP/1.1", ...H2_TRANSPORTS] as Transport[]) {
    it(`${transport} : HEAD d'un téléchargement — en-têtes du GET, aucun corps`, async () => {
      const flow = await openFlow(transport, `${HTML}/download`, "HEAD");
      expect(flow.status).to.equal(200);
      expect(Number(flow.headers["content-length"])).to.be.greaterThan(0);
      expect(String(flow.headers["content-disposition"])).to.match(
        /^attachment/,
      );
      expect(await flow.done).to.equal("end");
      flow.dispose();
      expect(flow.raw).to.equal("");
    });
  }

  it("fichier ILLISIBLE à l'ouverture (EACCES) : 500, la page d'erreur ordinaire", async (ctx) => {
    const read = await journalFrom();
    const res = await fetch(`${H1}${HTML}/unreadable`);
    if (res.status === 501) {
      await res.text();
      ctx.skip(); // mode 000 sans effet (Windows, root) : capacité constatée absente
    }
    expect(res.status).to.equal(500);
    await res.text();
    await pause(100);
    expect(await accessLine(read, `${HTML}/unreadable`)).to.match(
      /^GET\s+500\s/,
    );
    expectQuietJournal(await read());
  });

  it("un en-tête posé par l'action AVANT renderStream n'est pas écrasé par un défaut", async () => {
    await state("reset");
    const res = await fetch(`${H1}${BASE}/app-header`);
    expect(res.status).to.equal(200);
    expect(res.headers.get("cache-control")).to.equal("max-age=60");
    expect(res.headers.get("x-accel-buffering")).to.equal("no");
    expect(await res.text()).to.equal("prêt");
  });
});

/**
 * Les délais RÉELS, que les cas ci-dessus éprouvent en millisecondes : le
 * défaut d'`idleTimeout` (le `responseTimeout` du serveur, 30 s) et sa
 * désactivation tenue plus longtemps que le délai de socket du serveur.
 * ~80 s : derrière `NF_RUN_LONG_STREAM=1` (`scripts/test/vitest/gates.ts`).
 */
describe.runIf(process.env.NF_RUN_LONG_STREAM === "1")(
  "Flux d'octets — délais réels (requires server)",
  () => {
    beforeEach(async () => {
      await state("reset");
    });

    it("défaut : une source qui se tait est coupée entre 30 et 37,5 s (timeout), socket fermée, 504 au journal", async () => {
      const read = await journalFrom();
      const started = Date.now();
      const flow = await openFlow("HTTP/1.1", `${BASE}/limits`);
      expect(flow.status).to.equal(200);
      const ending = await Promise.race([
        flow.done,
        pause(40_000).then(() => "pending" as const),
      ]);
      const elapsed = Date.now() - started;
      flow.dispose();
      expect(ending, "coupée avant 40 s").to.equal("abort");
      // Chien de garde par quarts (7,5 s) : le premier quart ne voit le premier
      // morceau qu'à 7,5 s, d'où une coupure entre 1 et 1,25 × idleTimeout.
      expect(elapsed).to.be.within(29_500, 38_500);
      expect((await lastResult()).reason).to.equal("timeout");
      await pause(100);
      expect(await accessLine(read, "/limits")).to.match(/^GET\s+504\s/);
    }, 50_000);

    it("idleTimeout: 0 — une source muette 40 s reste ouverte, sans 408 ni 504", async () => {
      const read = await journalFrom();
      const flow = await openFlow("HTTP/1.1", `${BASE}/limits?idle=0`);
      await flow.first;
      const ending = await Promise.race([
        flow.done,
        pause(40_000).then(() => "pending" as const),
      ]);
      expect(ending, "toujours ouverte après 40 s").to.equal("pending");
      expect((await state()).lastResult).to.equal(null);
      flow.leave();
      expect((await lastResult()).reason).to.equal("client");
      flow.dispose();
      await pause(100);
      expect(await accessLine(read, "/limits?idle=0")).to.match(/^GET\s+499\s/);
    }, 55_000);
  },
);
