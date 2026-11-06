/// <reference types="node" />
import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect } from "vitest";
import { openSseStream } from "../../src/context/http/SseStream";
import type HttpContext from "../../src/context/http/HttpContext";

/**
 * Parité du cycle de vie d'une réponse en flux (#724) — le cas que le serveur
 * réel ne sait pas rendre déterministe : le client part PENDANT la sauvegarde
 * de la session, avant que le flux ne soit construit.
 *
 * La réponse Node est réelle (serveur local, socket réelle) ; seul le contexte
 * est réduit à ce que l'ouverture lit, pour tenir la sauvegarde en suspens le
 * temps que le client s'en aille.
 *
 * Chaque type de flux est une ligne de `OPENERS` : l'ouverture, puis la
 * question « le flux s'est-il terminé ? ».
 */

interface IOpener {
  name: string;
  /** Ouvre le flux ; rend la sonde « terminé ? ». */
  open(context: HttpContext): Promise<() => boolean>;
}

const OPENERS: IOpener[] = [
  {
    name: "SSE",
    open: async (context) => {
      const sse = await openSseStream(context, { heartbeat: false });
      return () => sse.closed;
    },
  },
];

interface IHarness {
  context: HttpContext;
  /** Libère la sauvegarde de session en suspens. */
  releaseSave(): void;
  /** Réglée quand la réponse Node a émis `close` (client parti). */
  responseClosed: Promise<void>;
}

/**
 * Un serveur local dont chaque requête rend un contexte réduit autour de la
 * VRAIE réponse Node, avec une session dont la sauvegarde attend `releaseSave`.
 */
async function serve(): Promise<{
  url: string;
  next: Promise<IHarness>;
  server: http.Server;
}> {
  let deliver!: (h: IHarness) => void;
  const next = new Promise<IHarness>((r) => (deliver = r));
  const server = http.createServer((req, res) => {
    let releaseSave!: () => void;
    const saved = new Promise<void>((r) => (releaseSave = r));
    const responseClosed = new Promise<void>((r) => res.once("close", r));
    const fake = {
      sended: false,
      finished: false,
      httpKernel: null,
      session: {},
      request: { request: req },
      response: {
        response: res,
        isHeaderSent: () => res.headersSent,
        setHeaders: (headers: Record<string, string>) => {
          for (const [name, value] of Object.entries(headers))
            res.setHeader(name, value);
        },
      },
      saveSession: () => saved.then(() => null),
      writeHead: (status: number) => res.writeHead(status),
      log: () => undefined,
      close: () => undefined,
    };
    deliver({
      context: fake as unknown as HttpContext,
      releaseSave,
      responseClosed,
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/`, next, server };
}

for (const opener of OPENERS) {
  describe(`Parité du cycle de vie — ${opener.name} (unitaire)`, () => {
    it("un client parti PENDANT la sauvegarde de session termine quand même le flux", async () => {
      const { url, next, server } = await serve();
      try {
        const req = http.get(url);
        req.on("error", () => undefined);
        const harness = await next;
        const opening = opener.open(harness.context);
        // Le client s'en va pendant que la session se sauve.
        req.destroy();
        await harness.responseClosed;
        harness.releaseSave();
        const isClosed = await opening;
        await new Promise((r) => setImmediate(r));
        expect(isClosed(), "flux terminé après le départ du client").to.equal(
          true,
        );
      } finally {
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
      }
    });
  });
}
