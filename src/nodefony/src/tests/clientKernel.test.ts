/**
 * Le kernel client, EXÉCUTÉ — pas lu.
 *
 * Ce que ces cas tiennent, et que la seule lecture du code ne prouve pas :
 *
 * - **`boot()` idempotent**, y compris pour deux appels CONCURRENTS — c'est le
 *   critère de fin du ticket, et le cas concurrent est celui qu'un compteur de
 *   fin de fonction rate.
 * - **L'état ne régresse jamais** : ni un `boot()` après la mort, ni un `ready`
 *   arrivé en retard sur un `terminate()` parti pendant la connexion.
 * - **Les deux gardes D9**, chacune née d'une régression vécue en production :
 *   couper la socket UNIQUEMENT sur un vrai changement de compte, et la rouvrir
 *   HORS de cette garde. Débrancher l'une ou l'autre doit faire tomber un cas
 *   d'ici — c'est la seule preuve qu'elles sont tenues par le framework et non
 *   par la vigilance de celui qui recopie la glue.
 * - **Zéro listener navigateur survivant** à `terminate()` — un kernel qui fuit
 *   ses écouteurs de page est un kernel qui fuit la page entière.
 *
 * Aucun réseau, aucun DOM réel : la socket et le document sont des doubles dont
 * on COMPTE les appels.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ClientKernel, createClientKernel } from "../client/ClientKernel";
import type { RealtimeClient } from "../client/realtime/RealtimeClient";

/** Socket double — on ne mesure que ce que le kernel LUI demande. */
interface FakeSocket {
  connects: number;
  disconnects: number;
  calls: string[];
  connect(): Promise<void>;
  disconnect(): void;
}

const fakeSocket = (opts: { failConnect?: boolean } = {}): FakeSocket => {
  const s: FakeSocket = {
    connects: 0,
    disconnects: 0,
    calls: [],
    connect(): Promise<void> {
      s.connects += 1;
      s.calls.push("connect");
      return opts.failConnect
        ? Promise.reject(new Error("socket refusée"))
        : Promise.resolve();
    },
    disconnect(): void {
      s.disconnects += 1;
      s.calls.push("disconnect");
    },
  };
  return s;
};

const asClient = (s: FakeSocket): RealtimeClient =>
  s as unknown as RealtimeClient;

/** Kernel muni d'une socket double, sans passer par la fabrique de socket. */
const kernelWith = (s: FakeSocket): ClientKernel => {
  const k = createClientKernel({ browserEvents: false });
  k.set("realtime", asClient(s));
  return k;
};

describe("ClientKernel — composition et registre", () => {
  it("rend `undefined` (et non `null`) pour un service absent", () => {
    const k = createClientKernel({ browserEvents: false });
    expect(k.get("realtime")).toBeUndefined();
    expect(k.has("realtime")).toBe(false);
  });

  it("enregistre et relit un service sous son nom contractuel", () => {
    const s = fakeSocket();
    const k = kernelWith(s);
    expect(k.has("realtime")).toBe(true);
    expect(k.get("realtime")).toBe(asClient(s));
  });

  it("ne compose RIEN sans option — l'opt-in est strict (D7)", async () => {
    const k = createClientKernel({ browserEvents: false });
    await k.boot();
    expect(k.state).toBe("ready");
    expect(k.has("realtime")).toBe(false);
  });

  it("compose dès le CONSTRUCTEUR, avant tout boot()", () => {
    // Une application câble ses magasins sur les services du kernel avant de le
    // démarrer : si la composition attendait `boot()`, elle n'aurait rien à
    // câbler. Composer n'ouvre rien — la connexion reste l'affaire de `boot()`.
    const k = createClientKernel({
      browserEvents: false,
      realtime: { url: "ws://127.0.0.1:1/none" },
    });
    expect(k.state).toBe("created");
    expect(k.has("realtime")).toBe(true);
    expect(k.get("realtime")?.state).not.toBe("connected");
  });
});

describe("ClientKernel — cycle de vie (D5)", () => {
  it("boot() émet onBoot puis onReady, une seule fois chacun", async () => {
    const s = fakeSocket();
    const k = kernelWith(s);
    const seen: string[] = [];
    k.on("onBoot", () => seen.push("onBoot"));
    k.on("onReady", () => seen.push("onReady"));
    await k.boot();
    expect(seen).toEqual(["onBoot", "onReady"]);
    expect(k.state).toBe("ready");
    expect(s.connects).toBe(1);
  });

  it("boot() rappelé ne recompose ni ne réémet rien", async () => {
    const s = fakeSocket();
    const k = kernelWith(s);
    let boots = 0;
    k.on("onBoot", () => (boots += 1));
    await k.boot();
    await k.boot();
    await k.boot();
    expect(boots).toBe(1);
    expect(s.connects).toBe(1);
  });

  it("deux boot() CONCURRENTS ne composent qu'une fois", async () => {
    const s = fakeSocket();
    const k = kernelWith(s);
    let boots = 0;
    k.on("onBoot", () => (boots += 1));
    await Promise.all([k.boot(), k.boot(), k.boot()]);
    expect(boots).toBe(1);
    expect(s.connects).toBe(1);
    expect(k.state).toBe("ready");
  });

  it("`connectOnBoot: false` : c'est le login qui ouvre, pas le démarrage", async () => {
    // Une socket authentifiée ne s'ouvre pas avant de savoir QUI se connecte —
    // sinon le démarrage produit une connexion anonyme que le pod refuse.
    const s = fakeSocket();
    const k = createClientKernel({
      browserEvents: false,
      connectOnBoot: false,
    });
    k.set("realtime", asClient(s));
    await k.boot();
    expect(k.state).toBe("ready");
    expect(s.connects).toBe(0);
    k.setIdentity({ key: "alice" });
    expect(s.connects).toBe(1);
  });

  it("une socket qui refuse de s'ouvrir ne bloque pas l'application", async () => {
    const s = fakeSocket({ failConnect: true });
    const k = kernelWith(s);
    await k.boot();
    expect(k.state).toBe("ready");
  });

  it("l'état ne régresse jamais : boot() après terminate() ne ressuscite rien", async () => {
    const s = fakeSocket();
    const k = kernelWith(s);
    await k.boot();
    await k.terminate();
    expect(k.state).toBe("terminated");
    await k.boot();
    expect(k.state).toBe("terminated");
  });

  it("un terminate() PENDANT la connexion n'est pas écrasé par le ready en retard", async () => {
    const s = fakeSocket();
    // La libération vit dans un conteneur : assignée depuis une closure, une
    // variable simple serait restreinte à `null` par le compilateur.
    const gate: { release: (() => void) | null } = { release: null };
    s.connect = (): Promise<void> => {
      s.connects += 1;
      return new Promise<void>((r) => (gate.release = r));
    };
    const k = kernelWith(s);
    const booting = k.boot();
    await k.terminate();
    gate.release?.();
    await booting;
    expect(k.state).toBe("terminated");
  });

  it("terminate() est idempotent et n'émet qu'une fois", async () => {
    const s = fakeSocket();
    const k = kernelWith(s);
    let ends = 0;
    k.on("onTerminate", () => (ends += 1));
    await k.boot();
    await k.terminate();
    await k.terminate();
    expect(ends).toBe(1);
    expect(s.disconnects).toBe(1);
  });
});

describe("ClientKernel — l'annonce dans la console", () => {
  /** Console double : on compte ce que le kernel écrit, sans polluer la sortie. */
  const spyConsole = () => {
    const calls: string[] = [];
    let groupes = 0;
    let fins = 0;
    const vraie = globalThis.console;
    globalThis.console = {
      ...vraie,
      log: (...a: unknown[]) => calls.push(String(a[0])),
      groupCollapsed: () => {
        groupes += 1;
      },
      groupEnd: () => {
        fins += 1;
      },
    } as Console;
    return {
      calls,
      get groupes() {
        return groupes;
      },
      get fins() {
        return fins;
      },
      restore: () => {
        globalThis.console = vraie;
      },
    };
  };

  it("annonce le kernel une fois, et referme son groupe", async () => {
    const spy = spyConsole();
    try {
      const k = createClientKernel({ browserEvents: false, name: "MON APP" });
      await k.boot();
      expect(spy.calls[0]).toContain("nodefony");
      expect(spy.groupes).toBe(1);
      // Un groupe laissé ouvert avale tous les messages suivants de l'application.
      expect(spy.fins).toBe(spy.groupes);
    } finally {
      spy.restore();
    }
  });

  it("expose un handle inspectable, et le REPREND à la mort du kernel", async () => {
    const spy = spyConsole();
    const g = globalThis as { nodefony?: { kernel?: unknown } };
    try {
      const k = createClientKernel({ browserEvents: false });
      await k.boot();
      // Le vrai apport : taper `nodefony` dans la console rend l'objet vivant.
      expect(g.nodefony?.kernel).toBe(k);
      await k.terminate();
      // Un handle qui survit retient un kernel MORT — la fuite classique d'un
      // rechargement à chaud, qui en accumulerait un par rechargement.
      expect(g.nodefony).toBeUndefined();
    } finally {
      spy.restore();
      delete g.nodefony;
    }
  });

  it("`banner: false` n'écrit RIEN — la console d'une app publiée n'est pas à nous", async () => {
    const spy = spyConsole();
    try {
      const k = createClientKernel({ browserEvents: false, banner: false });
      await k.boot();
      expect(spy.calls).toEqual([]);
      expect(spy.groupes).toBe(0);
    } finally {
      spy.restore();
    }
  });
});

describe("ClientKernel — cycle d'identité (D9, règle de sécurité)", () => {
  it("premier login : connect() SANS disconnect() — jamais couper au boot", async () => {
    const s = fakeSocket();
    const k = kernelWith(s);
    await k.boot();
    s.calls.length = 0;
    k.setIdentity({ key: "alice" });
    expect(s.calls).toEqual(["connect"]);
  });

  it("VRAI changement de compte : disconnect() PUIS connect()", async () => {
    const s = fakeSocket();
    const k = kernelWith(s);
    await k.boot();
    k.setIdentity({ key: "alice" });
    s.calls.length = 0;
    k.setIdentity({ key: "bob" });
    expect(s.calls).toEqual(["disconnect", "connect"]);
  });

  it("déconnexion : disconnect() sans reconnexion", async () => {
    const s = fakeSocket();
    const k = kernelWith(s);
    await k.boot();
    k.setIdentity({ key: "alice" });
    s.calls.length = 0;
    k.setIdentity(null);
    expect(s.calls).toEqual(["disconnect"]);
  });

  it("clé INCHANGÉE : la socket n'est pas touchée, l'application pas réveillée", async () => {
    const s = fakeSocket();
    const k = kernelWith(s);
    await k.boot();
    k.setIdentity({ key: "alice", data: { roles: ["USER"] } });
    s.calls.length = 0;
    let changes = 0;
    k.on("onIdentityChange", () => (changes += 1));
    k.setIdentity({ key: "alice", data: { roles: ["USER", "ADMIN"] } });
    expect(s.calls).toEqual([]);
    expect(changes).toBe(0);
    // Le profil rafraîchi est tout de même relu — silencieusement.
    expect(k.identity?.data).toEqual({ roles: ["USER", "ADMIN"] });
  });

  it("onIdentityChange porte la nouvelle identité ET la précédente", async () => {
    const s = fakeSocket();
    const k = kernelWith(s);
    await k.boot();
    const seen: unknown[][] = [];
    k.on("onIdentityChange", (...args) => seen.push(args));
    k.setIdentity({ key: "alice" });
    k.setIdentity({ key: "bob" });
    expect(seen).toEqual([
      [{ key: "alice" }, null],
      [{ key: "bob" }, { key: "alice" }],
    ]);
  });

  it("sans socket composée, déclarer une identité ne jette pas", async () => {
    const k = createClientKernel({ browserEvents: false });
    await k.boot();
    expect(() => k.setIdentity({ key: "alice" })).not.toThrow();
    expect(k.identity).toEqual({ key: "alice" });
  });
});

describe("ClientKernel — pont navigateur et fuite d'écouteurs (D5)", () => {
  type Listener = () => void;
  interface FakeTarget {
    listeners: Map<string, Set<Listener>>;
    addEventListener(t: string, h: Listener): void;
    removeEventListener(t: string, h: Listener): void;
    dispatch(t: string): void;
    count(): number;
  }
  const target = (): FakeTarget => {
    const listeners = new Map<string, Set<Listener>>();
    return {
      listeners,
      addEventListener(t, h): void {
        let set = listeners.get(t);
        if (!set) listeners.set(t, (set = new Set()));
        set.add(h);
      },
      removeEventListener(t, h): void {
        listeners.get(t)?.delete(h);
      },
      dispatch(t): void {
        for (const h of listeners.get(t) ?? []) h();
      },
      count(): number {
        let n = 0;
        for (const set of listeners.values()) n += set.size;
        return n;
      },
    };
  };

  let doc: FakeTarget & { visibilityState: string };
  let win: FakeTarget;
  const g = globalThis as unknown as {
    document?: unknown;
    window?: unknown;
  };

  beforeEach(() => {
    doc = Object.assign(target(), { visibilityState: "visible" });
    win = target();
    g.document = doc;
    g.window = win;
  });

  afterEach(() => {
    delete g.document;
    delete g.window;
  });

  it("ponte visibilité et connectivité sur les événements du kernel", async () => {
    const k = createClientKernel();
    const seen: unknown[][] = [];
    k.on("onVisibility", (...a) => seen.push(["visibility", ...a]));
    k.on("onOnline", (...a) => seen.push(["online", ...a]));
    await k.boot();
    doc.visibilityState = "hidden";
    doc.dispatch("visibilitychange");
    win.dispatch("offline");
    win.dispatch("online");
    expect(seen).toEqual([
      ["visibility", false],
      ["online", false],
      ["online", true],
    ]);
  });

  it("`pagehide` termine le kernel (best-effort de fin de page)", async () => {
    const k = createClientKernel();
    await k.boot();
    win.dispatch("pagehide");
    expect(k.state).toBe("terminated");
  });

  it("terminate() ne laisse AUCUN écouteur derrière lui", async () => {
    const k = createClientKernel();
    await k.boot();
    expect(k.browserListenerCount).toBeGreaterThan(0);
    expect(doc.count() + win.count()).toBe(k.browserListenerCount);
    await k.terminate();
    expect(k.browserListenerCount).toBe(0);
    expect(doc.count() + win.count()).toBe(0);
  });

  it("`browserEvents: false` ne pose aucun écouteur", async () => {
    const k = createClientKernel({ browserEvents: false });
    await k.boot();
    expect(k.browserListenerCount).toBe(0);
    expect(doc.count() + win.count()).toBe(0);
  });
});
