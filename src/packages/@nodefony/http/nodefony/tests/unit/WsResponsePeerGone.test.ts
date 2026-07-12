/// <reference types="node" />
import { describe, it, expect } from "vitest";
import Ws from "ws";
import WebsocketResponse, {
  isPeerGoneError,
} from "../../src/context/websocket/Response";
import type WebsocketContext from "../../src/context/websocket/WebsocketContext";

/**
 * Race « client parti pendant l'écriture » (reload/onglet fermé pendant une
 * frame en vol) : le callback de `ws.send()` reçoit EPIPE/ECONNRESET alors que
 * `readyState` était OPEN à l'entrée. Vécu : chaque reload de la home pendant
 * un ping WS écrivait « Error: write EPIPE » + stack au journal.
 * Attendu : résolu SANS reject, loggé DEBUG — une vraie erreur reste ERROR+reject.
 */

interface ILogged {
  severity: unknown;
  pci: unknown;
}

/** Contexte minimal : le Response n'utilise que container.get("syslog") + server. */
function makeContext(logged: ILogged[]): WebsocketContext {
  return {
    container: {
      get: () => ({
        log: (pci: unknown, severity: unknown) => {
          logged.push({ pci, severity });
        },
      }),
    },
    server: null,
  } as unknown as WebsocketContext;
}

/** Connexion mock OPEN dont le send invoque son callback avec `error`. */
function makeConnection(error: Error | undefined): Ws {
  return {
    readyState: Ws.OPEN,
    bufferedAmount: 0,
    send: (_data: unknown, cb: (e?: Error) => void) => cb(error),
  } as unknown as Ws;
}

function errnoError(code: string): NodeJS.ErrnoException {
  const e = new Error(`write ${code}`) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

describe("WS Response — client parti pendant l'écriture (EPIPE et famille)", () => {
  it("isPeerGoneError : codes de déconnexion oui, le reste non", () => {
    for (const code of [
      "EPIPE",
      "ECONNRESET",
      "ECONNABORTED",
      "ERR_STREAM_DESTROYED",
      "ERR_STREAM_WRITE_AFTER_END",
    ]) {
      expect(isPeerGoneError(errnoError(code)), code).toBe(true);
    }
    expect(isPeerGoneError(errnoError("ENOSPC"))).toBe(false);
    expect(isPeerGoneError(new Error("boom"))).toBe(false);
    expect(isPeerGoneError(undefined)).toBe(false);
    expect(isPeerGoneError(null)).toBe(false);
  });

  it("EPIPE au send → RÉSOLU (pas de reject) + log DEBUG, jamais ERROR", async () => {
    const logged: ILogged[] = [];
    const res = new WebsocketResponse(
      makeConnection(errnoError("EPIPE")),
      makeContext(logged),
    );
    await expect(res.send("ping")).resolves.toBe(res);
    expect(logged).toHaveLength(1);
    expect(logged[0].severity).toBe("DEBUG");
    expect(String(logged[0].pci)).toContain("EPIPE");
  });

  it("vraie erreur d'écriture (non-déconnexion) → reject + log ERROR (inchangé)", async () => {
    const logged: ILogged[] = [];
    const res = new WebsocketResponse(
      makeConnection(errnoError("ENOSPC")),
      makeContext(logged),
    );
    await expect(res.send("ping")).rejects.toThrow("ENOSPC");
    expect(logged).toHaveLength(1);
    expect(logged[0].severity).toBe("ERROR");
  });

  it("send sans erreur → résolu, aucun log", async () => {
    const logged: ILogged[] = [];
    const res = new WebsocketResponse(
      makeConnection(undefined),
      makeContext(logged),
    );
    await expect(res.send("pong")).resolves.toBe(res);
    expect(logged).toHaveLength(0);
  });
});
