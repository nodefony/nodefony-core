/// <reference types="node" />
import http from "node:http";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { expect, vi } from "vitest";
import {
  StallSweep,
  STALL_SWEEP_PERIOD_MS,
  STREAM_STALL_TIMEOUT_MS,
  StreamLifecycle,
  type StreamTarget,
} from "../../src/context/http/StreamLifecycle";
import type HttpContext from "../../src/context/http/HttpContext";

/**
 * Balayage de blocage des flux dont un tiers tient les écritures (gRPC,
 * ADR-0026 D4 point 4, critère 21 de #695).
 *
 * Flux RÉELS (h2c et HTTP/1.1, sockets locales) : la contre-pression est celle
 * d'un vrai client qui ne lit pas. Les tours du balayage sont joués à la main
 * avec une horloge choisie — le seuil se prouve sans attendre 30 s.
 */

const STALL = STREAM_STALL_TIMEOUT_MS;
const CHUNK = Buffer.alloc(1024, 1);

interface IServed {
  target: StreamTarget;
  response: http.ServerResponse | http2.Http2ServerResponse;
}

interface IHarness {
  sweep: StallSweep;
  close: ReturnType<typeof vi.fn>;
  open(served: IServed): StreamLifecycle;
}

/** Un cycle de vie réel sur une réponse réelle, autour d'un contexte réduit. */
function harness(): IHarness {
  // Période immense : seuls les tours joués à la main comptent.
  const sweep = new StallSweep(2_000_000_000);
  const close = vi.fn();
  const kernel = {
    sweepStall: (l: StreamLifecycle) => sweep.add(l),
    unsweepStall: (l: StreamLifecycle) => sweep.delete(l),
    watchStream: () => undefined,
    unwatchStream: () => undefined,
  };
  return {
    sweep,
    close,
    open: ({ target, response }) =>
      new StreamLifecycle(
        { httpKernel: kernel, close } as unknown as HttpContext,
        target,
        response,
        {
          stallTimeout: STALL,
          maxDuration: false,
          revalidate: null,
          identifier: null,
          foreignWriter: true,
        },
      ),
  };
}

/** Écrit jusqu'à la contre-pression, comme l'adaptateur avant d'attendre `drain`. */
async function fill(target: StreamTarget): Promise<void> {
  for (let i = 0; i < 100_000; i++) {
    if (!target.write(CHUNK)) return;
    if (i % 64 === 63) await new Promise((r) => setImmediate(r));
  }
  throw new Error("aucune contre-pression");
}

interface ITransport {
  name: string;
  /** Ouvre `count` flux ; le client lit ceux dont l'indice est dans `read`. */
  start(
    count: number,
    read: ReadonlySet<number>,
  ): Promise<{
    served: IServed[];
    resume(index: number): void;
    stop(): Promise<void>;
  }>;
}

const TRANSPORTS: ITransport[] = [
  {
    name: "h2c",
    start: async (count, read) => {
      const served: IServed[] = [];
      const server = http2.createServer((_req, res) => {
        res.writeHead(200);
        served.push({ target: res.stream, response: res });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;
      const client = http2.connect(`http://127.0.0.1:${port}`);
      const streams: http2.ClientHttp2Stream[] = [];
      for (let i = 0; i < count; i++) {
        const s = client.request({ ":path": "/" });
        s.on("error", () => undefined);
        if (read.has(i)) s.resume();
        else s.pause();
        streams.push(s);
        // L'ordre d'arrivée fait l'indice.
        while (served.length <= i) await new Promise((r) => setTimeout(r, 2));
      }
      return {
        served,
        resume: (i) => streams[i]?.resume(),
        stop: async () => {
          client.destroy();
          await new Promise((r) => server.close(r));
        },
      };
    },
  },
  {
    name: "HTTP/1.1",
    start: async (count, read) => {
      const served: IServed[] = [];
      const server = http.createServer((_req, res) => {
        res.writeHead(200);
        // `writeHead` n'envoie rien avant la première écriture.
        res.flushHeaders();
        served.push({ target: res, response: res });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;
      const responses: http.IncomingMessage[] = [];
      const agent = new http.Agent({ keepAlive: false });
      for (let i = 0; i < count; i++) {
        const req = http.get(`http://127.0.0.1:${port}/`, { agent });
        req.on("error", () => undefined);
        const [res] = (await once(req, "response")) as [http.IncomingMessage];
        res.on("error", () => undefined);
        if (read.has(i)) res.resume();
        else res.pause();
        responses.push(res);
      }
      return {
        served,
        resume: (i) => responses[i]?.resume(),
        stop: async () => {
          for (const r of responses) r.destroy();
          server.closeAllConnections();
          await new Promise((r) => server.close(r));
        },
      };
    },
  },
];

describe("Balayage de blocage — StallSweep (unitaire)", () => {
  it("période = moitié du seuil : coupé entre le seuil et 1,5 × le seuil", () => {
    expect(STALL_SWEEP_PERIOD_MS * 2).to.equal(STREAM_STALL_TIMEOUT_MS);
  });

  it("minuteur armé au premier flux, arrêté au dernier — et jamais avant", () => {
    const sweep = new StallSweep(1000);
    const a = { sweepStall: vi.fn() } as unknown as StreamLifecycle;
    const b = { sweepStall: vi.fn() } as unknown as StreamLifecycle;
    expect(sweep.running).to.equal(false);
    sweep.add(a);
    sweep.add(b);
    expect(sweep.running).to.equal(true);
    sweep.sweep(42);
    expect(a.sweepStall).toHaveBeenCalledWith(42);
    sweep.delete(a);
    expect(sweep.running).to.equal(true);
    sweep.delete(b);
    sweep.delete(b);
    expect(sweep.running).to.equal(false);
    expect(sweep.size).to.equal(0);
  });
});

for (const transport of TRANSPORTS) {
  describe(`Balayage de blocage — ${transport.name} (unitaire, flux réels)`, () => {
    it("client qui ne lit plus : coupé au seuil, pas avant ; place, balayage et drain rendus", async () => {
      const h = harness();
      const run = await transport.start(1, new Set());
      try {
        const served = run.served[0]!;
        const lifecycle = h.open(served);
        expect(h.sweep.size).to.equal(1);
        const drainBefore = served.target.listenerCount("drain");
        await fill(served.target);
        h.sweep.sweep(1_000);
        expect(served.target.listenerCount("drain")).to.equal(drainBefore + 1);
        h.sweep.sweep(1_000 + STALL - 1);
        expect(served.target.destroyed, "pas avant le seuil").to.equal(false);
        h.sweep.sweep(1_000 + STALL);
        expect(served.target.destroyed, "coupé au seuil").to.equal(true);
        await once(served.response, "close");
        expect(lifecycle.closed).to.equal(true);
        expect(lifecycle.cause).to.equal("stall");
        expect(h.sweep.size, "retiré du balayage").to.equal(0);
        expect(served.target.listenerCount("drain"), "drain retiré").to.equal(
          drainBefore,
        );
      } finally {
        await run.stop();
      }
    });

    it("client lent qui lit : jamais coupé — seul un drain ferme l'attente", async () => {
      const h = harness();
      const run = await transport.start(1, new Set());
      try {
        const served = run.served[0]!;
        const lifecycle = h.open(served);
        await fill(served.target);
        h.sweep.sweep(1_000);
        // Le client reprend sa lecture : le tampon se vide, `drain` part.
        run.resume(0);
        await once(served.target, "drain");
        // Le tampon se remplit de nouveau aussitôt, comme sous l'adaptateur.
        await fill(served.target);
        h.sweep.sweep(1_000 + STALL);
        expect(served.target.destroyed, "lent mais vivant").to.equal(false);
        expect(lifecycle.closed).to.equal(false);
        // La nouvelle contre-pression ouvre une NOUVELLE attente, datée du tour.
        h.sweep.sweep(1_000 + 2 * STALL - 1);
        expect(served.target.destroyed).to.equal(false);
      } finally {
        await run.stop();
      }
    });

    it("flux muet : jamais coupé, quel que soit le temps écoulé", async () => {
      const h = harness();
      const run = await transport.start(1, new Set([0]));
      try {
        const served = run.served[0]!;
        const lifecycle = h.open(served);
        served.target.write(CHUNK);
        for (let t = 1_000; t <= 20 * STALL; t += STALL_SWEEP_PERIOD_MS) {
          h.sweep.sweep(t);
        }
        expect(served.target.destroyed).to.equal(false);
        expect(lifecycle.closed).to.equal(false);
      } finally {
        await run.stop();
      }
    });

    it("fermeture par le serveur (révocation) : transport détruit, réponse jamais terminée par-dessus l'adaptateur", async () => {
      const h = harness();
      const run = await transport.start(1, new Set([0]));
      try {
        const served = run.served[0]!;
        const lifecycle = h.open(served);
        void lifecycle.close();
        expect(served.target.destroyed).to.equal(true);
        expect(
          h.close,
          "context.close() = second écrivain",
        ).not.toHaveBeenCalled();
        expect(lifecycle.cause).to.equal("server");
        expect(h.sweep.size).to.equal(0);
      } finally {
        await run.stop();
      }
    });
  });
}

describe("Balayage de blocage — h2c, deux flux d'UNE session (unitaire)", () => {
  it("flux bloqué coupé même quand son voisin de session est lu", async () => {
    const h = harness();
    const run = await TRANSPORTS[0]!.start(2, new Set([1]));
    try {
      const [blocked, neighbour] = run.served;
      h.open(blocked!);
      h.open(neighbour!);
      await fill(blocked!.target);
      // Le voisin avance pendant toute l'attente.
      for (let i = 0; i < 32; i++) neighbour!.target.write(CHUNK);
      h.sweep.sweep(1_000);
      h.sweep.sweep(1_000 + STALL);
      expect(blocked!.target.destroyed, "bloqué coupé").to.equal(true);
      expect(neighbour!.target.destroyed, "voisin vivant").to.equal(false);
    } finally {
      await run.stop();
    }
  });
});
