/**
 * Ce que la barre de débogage voit des flux longue durée (#665) : la naissance
 * d'un `WebSocket` ou d'un `EventSource`, et leur cycle — ouverture, fermeture,
 * code, reconnexions. Jamais une trame. Les classes natives sont remplacées par
 * des doublures `EventTarget` : seul le contrat d'événements compte ici.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installNetworkInterceptor,
  type NetEntry,
} from "../client/debugbar/network";

class FakeWs extends EventTarget {
  readonly url: string;
  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }
}

class FakeEs extends EventTarget {
  readonly CLOSED = 2;
  readonly url: string;
  readyState = 0;
  closes = 0;
  constructor(url: string | URL) {
    super();
    this.url = String(url);
  }
  close(): void {
    this.closes++;
    this.readyState = 2;
  }
}

/** Compte les écouteurs posés et retirés sur une doublure. */
function countListeners(target: EventTarget): { live: () => number } {
  let n = 0;
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (...a: Parameters<typeof add>) => {
    n++;
    add(...a);
  };
  target.removeEventListener = (...a: Parameters<typeof remove>) => {
    n--;
    remove(...a);
  };
  return { live: () => n };
}

const closeEvent = (code: number, reason = ""): Event =>
  Object.assign(new Event("close"), { code, reason });

function install(
  win: Record<string, unknown>,
  ignore?: (u: string) => boolean,
) {
  vi.stubGlobal("window", win);
  const seen: NetEntry[] = [];
  const uninstall = installNetworkInterceptor({
    onChange: (e) => seen.push(e),
    ...(ignore ? { ignore } : {}),
  });
  return { seen, uninstall };
}

describe("installNetworkInterceptor — WebSocket", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("🔴 une connexion naît, s'ouvre en 101, se ferme sur son code ; écouteurs retirés", () => {
    const win: Record<string, unknown> = { WebSocket: FakeWs };
    const { seen, uninstall } = install(win);
    const Ws = win.WebSocket as typeof FakeWs;
    expect(Ws).to.not.equal(FakeWs);
    const ws = new Ws("wss://h/nodefony/studio/api/realtime");
    expect(ws).toBeInstanceOf(FakeWs);
    const entry = seen.at(-1);
    expect(entry?.method).toBe("WS");
    expect(entry?.pending).toBe(true);
    expect(entry?.stream?.state).toBe("connecting");
    ws.dispatchEvent(new Event("open"));
    expect(entry?.status).toBe(101);
    expect(entry?.stream?.state).toBe("open");
    ws.dispatchEvent(closeEvent(1006));
    expect(entry?.stream).toMatchObject({ state: "closed", code: 1006 });
    expect(entry?.error).toBe(null);
    uninstall();
    expect(win.WebSocket).toBe(FakeWs);
  });

  it("aucun écouteur ne survit à la fermeture", () => {
    const win: Record<string, unknown> = {};
    // La doublure compte AVANT que l'intercepteur n'écoute.
    let probe: { live: () => number } | null = null;
    win.WebSocket = class extends FakeWs {
      constructor(url: string | URL) {
        super(url);
        probe = countListeners(this);
      }
    };
    install(win);
    const ws = new (win.WebSocket as typeof FakeWs)("wss://h/x");
    expect(probe?.live()).toBe(2);
    ws.dispatchEvent(closeEvent(1000));
    expect(probe?.live()).toBe(0);
  });

  it("fermée avant de s'ouvrir : un échec, avec son code", () => {
    const win: Record<string, unknown> = { WebSocket: FakeWs };
    const { seen } = install(win);
    const ws = new (win.WebSocket as typeof FakeWs)("wss://h/x");
    ws.dispatchEvent(closeEvent(1006));
    expect(seen.at(-1)?.error).toContain("1006");
    expect(seen.at(-1)?.pending).toBe(false);
  });

  it("une adresse ignorée n'est pas suivie, la connexion reste native", () => {
    const win: Record<string, unknown> = { WebSocket: FakeWs };
    const { seen } = install(win, (u) => u.includes("vite"));
    new (win.WebSocket as typeof FakeWs)("wss://h/vite-hmr");
    expect(seen).toHaveLength(0);
  });

  it("désinstallé, un flux encore ouvert n'annonce plus rien", () => {
    const win: Record<string, unknown> = { WebSocket: FakeWs };
    const { seen, uninstall } = install(win);
    const ws = new (win.WebSocket as typeof FakeWs)("wss://h/x");
    const before = seen.length;
    uninstall();
    ws.dispatchEvent(new Event("open"));
    expect(seen).toHaveLength(before);
  });
});

describe("installNetworkInterceptor — EventSource", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("🔴 s'ouvre en 200, compte les reconnexions du navigateur, se ferme par close()", () => {
    const win: Record<string, unknown> = { EventSource: FakeEs };
    const { seen, uninstall } = install(win);
    const es = new (win.EventSource as typeof FakeEs)("https://h/flux");
    const entry = seen.at(-1);
    expect(entry?.stream?.kind).toBe("sse");
    es.dispatchEvent(new Event("open"));
    expect(entry?.status).toBe(200);
    es.dispatchEvent(new Event("error")); // readyState CONNECTING : relance
    expect(entry?.stream).toMatchObject({ state: "connecting", reconnects: 1 });
    es.dispatchEvent(new Event("open"));
    expect(entry?.stream?.state).toBe("open");
    es.close();
    expect(es.closes).toBe(1);
    expect(entry?.stream?.state).toBe("closed");
    expect(entry?.error).toBe(null);
    uninstall();
    expect(win.EventSource).toBe(FakeEs);
  });

  it("refusé (CLOSED avant ouverture) : un échec", () => {
    const win: Record<string, unknown> = { EventSource: FakeEs };
    const { seen } = install(win);
    const es = new (win.EventSource as typeof FakeEs)("https://h/flux");
    es.readyState = 2;
    es.dispatchEvent(new Event("error"));
    expect(seen.at(-1)?.error).toContain("refusé");
    expect(seen.at(-1)?.stream?.state).toBe("closed");
  });
});

describe("installNetworkInterceptor — flux reçu par fetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("🔴 un 200 text/event-stream devient un flux, fermé par son signal d'abandon", async () => {
    const res = new Response("", {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    });
    const win: Record<string, unknown> = {
      fetch: () => Promise.resolve(res),
    };
    const { seen } = install(win);
    const ctl = new AbortController();
    const got = await (win.fetch as typeof fetch)("https://h/flux", {
      signal: ctl.signal,
    });
    expect(got).toBe(res);
    const entry = seen.at(-1);
    expect(entry?.stream).toMatchObject({ kind: "sse", state: "open" });
    ctl.abort();
    expect(entry?.stream?.state).toBe("closed");
  });

  it("une réponse JSON reste un appel ordinaire, sans flux alloué", async () => {
    const win: Record<string, unknown> = {
      fetch: () =>
        Promise.resolve(
          new Response("{}", {
            headers: { "Content-Type": "application/json" },
          }),
        ),
    };
    const { seen } = install(win);
    await (win.fetch as typeof fetch)("https://h/api");
    expect(seen.at(-1)?.stream).toBe(undefined);
  });
});
