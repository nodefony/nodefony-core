/**
 * Le socle AGNOSTIQUE des liaisons de vue, EXÉCUTÉ — pas lu.
 *
 * Ces cas tiennent les onze règles qui vivaient dans les hooks React et que les
 * liaisons Vue, Angular et Svelte auraient recopiées une par une : précédence de
 * la socket fournie, cycle de connexion, appariement `on`↔`subscribe`, dernier
 * reçu gagne, format coalescé du journal, tailles d'anneau, filtres, canal par
 * défaut, noms d'événements locaux.
 *
 * Pourquoi ici plutôt que dans les hooks : une règle prouvée à travers React
 * n'est prouvée que pour React. Un test qui parle au socle prouve la règle pour
 * les quatre fronts à la fois — c'est exactement ce que l'extraction achète.
 *
 * Transport MOCK piloté à la main, aucun réseau, aucun DOM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { RealtimeClient } from "../client/realtime/RealtimeClient";
import {
  TransportState,
  type IRealtimeTransport,
} from "../realtime/IRealtimeTransport";
import { LOCAL_EVENTS, isLocalEvent } from "../client/realtime/localEvents";
import { PLATFORM_CHANNELS } from "../realtime/platformChannels";
import {
  connectShared,
  observeChannel,
  observeChannelData,
  observeChannelStats,
  observeIdentity,
  observeNoticeLog,
  observeNotices,
  observeReconnect,
  observeState,
  observeSyslog,
  adaptiveRebindKey,
  type ConnectSharedOptions,
  type SharedConnection,
} from "../client/realtime/observe";
import type { NodefonyNotice } from "../client/realtime/notice";

class MockTransport implements IRealtimeTransport {
  readyState: number = TransportState.CONNECTING;
  sent: string[] = [];
  connectCalls = 0;
  private _open: (() => void) | null = null;
  private _close: ((c: number, r: string) => void) | null = null;
  private _msg: ((raw: string) => void) | null = null;
  connect(): void {
    this.connectCalls++;
  }
  send(raw: string): void {
    this.sent.push(raw);
  }
  close(): void {
    this.readyState = TransportState.CLOSED;
  }
  onOpen(cb: () => void): void {
    this._open = cb;
  }
  onMessage(cb: (raw: string) => void): void {
    this._msg = cb;
  }
  onClose(cb: (c: number, r: string) => void): void {
    this._close = cb;
  }
  onError(): void {}
  fireOpen(): void {
    this.readyState = TransportState.OPEN;
    this._open?.();
  }
  fireClose(code = 1006, reason = ""): void {
    this.readyState = TransportState.CLOSED;
    this._close?.(code, reason);
  }
  /** Pousse une notification JSON-RPC sur un canal (ce que fait le serveur). */
  push(channel: string, payload: unknown): void {
    this._msg?.(
      JSON.stringify({ jsonrpc: "2.0", method: channel, params: payload }),
    );
  }
}

let transports: MockTransport[] = [];

function newClient(opts: Record<string, unknown> = {}): RealtimeClient {
  return new RealtimeClient({ url: "ws://loopback/realtime", ...opts }, () => {
    const t = new MockTransport();
    transports.push(t);
    return t;
  });
}

/** Ouvre la socket et rend le transport courant, prêt à pousser des frames. */
async function connected(client: RealtimeClient): Promise<MockTransport> {
  const promise = client.connect();
  transports[transports.length - 1]!.fireOpen();
  await promise;
  return transports[transports.length - 1]!;
}

/** Ce que la socket a émis vers le serveur, décodé. */
function outbound(t: MockTransport): { method: string; params: unknown }[] {
  return t.sent.map(
    (raw) => JSON.parse(raw) as { method: string; params: unknown },
  );
}

beforeEach(() => {
  transports = [];
  // Le registre de `shared()` vit sur `globalThis` : sans purge, un cas hérite de
  // la socket du précédent et « prouve » un partage qui n'a pas eu lieu.
  delete (globalThis as { __nfRealtime__?: unknown }).__nfRealtime__;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("connectShared — le cycle de connexion, une seule fois pour quatre fronts", () => {
  it("même URL → MÊME socket (une seule connexion réseau pour la page)", () => {
    const a = connectShared({ url: "ws://loopback/realtime" });
    const b = connectShared({ url: "ws://loopback/realtime" });
    expect(a.socket).toBe(b.socket);
    expect(a.owned).toBe(true);
  });

  it("une socket FOURNIE l'emporte sur l'URL, et son cycle n'est pas touché", () => {
    const mien = newClient();
    const connect = vi.spyOn(mien, "connect");
    const opts: ConnectSharedOptions = {
      url: "ws://loopback/autre",
      client: mien,
    };
    const connexion: SharedConnection = connectShared(opts);
    expect(connexion.socket).toBe(mien);
    expect(connexion.owned).toBe(false);
    connexion.start();
    // C'est la règle en creux — « ne pas faire » — celle qui se perd à la recopie.
    expect(connect).not.toHaveBeenCalled();
  });

  it("start() connecte la socket qu'on possède, et AVALE le rejet", async () => {
    const connexion = connectShared({ url: "ws://loopback/realtime" });
    const connect = vi
      .spyOn(connexion.socket, "connect")
      .mockRejectedValue(new Error("serveur absent"));
    // Un rejet non avalé remonterait en `unhandledRejection` et tuerait la page.
    expect(() => connexion.start()).not.toThrow();
    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("sans URL ni socket : échec FRANC (le framework ne devine aucune adresse)", () => {
    expect(() => connectShared({})).toThrow(/adresse du serveur temps réel/);
  });
});

describe("observeState / observeIdentity — l'état courant, puis ses transitions", () => {
  it("émet l'état COURANT à la souscription (une liaison n'a rien à initialiser)", async () => {
    const client = newClient();
    await connected(client);
    const vus: string[] = [];
    const dispose = observeState(client, (s) => vus.push(s));
    expect(vus).toEqual(["connected"]);
    client.disconnect();
    expect(vus).toEqual(["connected", "disconnected"]);
    dispose();
    void client.connect();
    expect(vus).toEqual(["connected", "disconnected"]);
  });

  it("observeIdentity : `null` d'abord, puis l'identité annoncée au welcome", async () => {
    const client = newClient();
    const t = await connected(client);
    const vues: (string | null)[] = [];
    observeIdentity(client, (i) =>
      vues.push(i ? (i.userIdentifier ?? "?") : null),
    );
    expect(vues).toEqual([null]);
    t.push("realtime:welcome", {
      identity: { authenticated: true, userIdentifier: "alice", roles: [] },
    });
    expect(vues).toEqual([null, "alice"]);
  });

  it("observeReconnect : une tentative est un ÉVÉNEMENT — rien n'est rejoué à la souscription", async () => {
    vi.useFakeTimers();
    const client = newClient({ reconnectDelay: 10 });
    const t = await connected(client);
    const essais: number[] = [];
    observeReconnect(client, (info) => essais.push(info.attempt));
    expect(essais).toEqual([]);
    t.fireClose(1006);
    expect(essais).toEqual([1]);
  });
});

describe("observeChannel — l'appariement abonnement/désabonnement", () => {
  it("s'abonne au canal, livre les messages, et REND l'abonnement au dispose", async () => {
    const client = newClient();
    const t = await connected(client);
    const recus: unknown[] = [];
    const dispose = observeChannel(client, "live:ticker", (p) => recus.push(p));

    expect(
      outbound(t).some(
        (f) =>
          f.method === "subscribe" &&
          (f.params as { channel: string }).channel === "live:ticker",
      ),
    ).toBe(true);

    t.push("live:ticker", { n: 1 });
    t.push("live:ticker", { n: 2 });
    expect(recus).toEqual([{ n: 1 }, { n: 2 }]);

    dispose();
    expect(
      outbound(t).some(
        (f) =>
          f.method === "unsubscribe" &&
          (f.params as { channel: string }).channel === "live:ticker",
      ),
    ).toBe(true);
    t.push("live:ticker", { n: 3 });
    expect(recus).toHaveLength(2);
  });

  it("deux observateurs du même canal ne se coupent pas l'un l'autre", async () => {
    const client = newClient();
    const t = await connected(client);
    const a: unknown[] = [];
    const b: unknown[] = [];
    const offA = observeChannel(client, "live:ticker", (p) => a.push(p));
    observeChannel(client, "live:ticker", (p) => b.push(p));
    offA();
    t.push("live:ticker", { n: 7 });
    expect(a).toHaveLength(0);
    expect(b).toEqual([{ n: 7 }]);
  });

  it("observeChannelData : `null` initial, puis DERNIER REÇU GAGNE", async () => {
    const client = newClient();
    const t = await connected(client);
    const vus: unknown[] = [];
    observeChannelData<{ n: number }>(client, "live:ticker", (v) =>
      vus.push(v),
    );
    expect(vus).toEqual([null]);
    t.push("live:ticker", { n: 1 });
    t.push("live:ticker", { n: 2 });
    expect(vus[vus.length - 1]).toEqual({ n: 2 });
  });

  it("observeChannelStats : instantané courant, puis à chaque échantillon", async () => {
    vi.useFakeTimers();
    const client = newClient();
    const t = await connected(client);
    const vus: (number | null)[] = [];
    observeChannelStats(client, "live:ticker", (s) =>
      vus.push(s?.msgCount ?? null),
    );
    expect(vus).toEqual([null]);
    t.push("live:ticker", { n: 1 });
    vi.advanceTimersByTime(1000);
    expect(vus[vus.length - 1]).toBe(1);
  });

  it("adaptiveRebindKey : trois valeurs, et trois seulement, refont l'abonnement", () => {
    const base = adaptiveRebindKey("nodefony:dashboard", 1000, true);
    expect(adaptiveRebindKey("nodefony:dashboard", 1000, true)).toBe(base);
    expect(adaptiveRebindKey("nodefony:dashboard", 2000, true)).not.toBe(base);
    expect(adaptiveRebindKey("nodefony:dashboard", 1000, false)).not.toBe(base);
    expect(adaptiveRebindKey("nodefony:socket", 1000, true)).not.toBe(base);
  });
});

describe("observeSyslog — le format du serveur décodé UNE fois", () => {
  it("accepte le lot COALESCÉ `{ logs, dropped }` autant que l'entrée unique", async () => {
    const client = newClient();
    const t = await connected(client);
    let vues: unknown[] = [];
    observeSyslog(client, (e) => (vues = e));
    t.push(PLATFORM_CHANNELS.syslog, {
      logs: [
        { severity: "INFO", msg: "a" },
        { severity: "ERROR", msg: "b" },
      ],
      dropped: 0,
    });
    expect(vues).toHaveLength(2);
    t.push(PLATFORM_CHANNELS.syslog, { severity: "INFO", msg: "seul" });
    expect(vues).toHaveLength(3);
  });

  it("filtre par sévérité, et n'émet RIEN quand le lot est entièrement écarté", async () => {
    const client = newClient();
    const t = await connected(client);
    const emissions: number[] = [];
    observeSyslog(client, (e) => emissions.push(e.length), {
      severities: ["ERROR"],
    });
    expect(emissions).toEqual([0]);
    t.push(PLATFORM_CHANNELS.syslog, {
      logs: [{ severity: "INFO", msg: "ignorée" }],
    });
    expect(emissions).toEqual([0]);
    t.push(PLATFORM_CHANNELS.syslog, {
      logs: [{ severity: "ERROR", msg: "!" }],
    });
    expect(emissions).toEqual([0, 1]);
  });

  it("borne l'anneau : les plus anciennes lignes sont évincées", async () => {
    const client = newClient();
    const t = await connected(client);
    let vues: unknown[] = [];
    observeSyslog(client, (e) => (vues = e), { max: 3 });
    for (let n = 0; n < 5; n++)
      t.push(PLATFORM_CHANNELS.syslog, { severity: "INFO", n });
    expect(vues).toHaveLength(3);
    expect((vues[0] as { n: number }).n).toBe(2);
  });

  it("le canal par défaut vient de la TABLE, pas d'une chaîne écrite en clair", async () => {
    const client = newClient();
    const t = await connected(client);
    observeSyslog(client, () => {});
    expect(
      outbound(t).some(
        (f) =>
          f.method === "subscribe" &&
          (f.params as { channel: string }).channel ===
            PLATFORM_CHANNELS.syslog,
      ),
    ).toBe(true);
  });
});

describe("observeNotices / observeNoticeLog — l'historique borné des incidents", () => {
  const notice = (source: NodefonyNotice["source"], message: string) =>
    ({ level: "warning", source, message, ts: 0 }) as NodefonyNotice;

  it("chaque notice atteint l'abonné", async () => {
    const client = newClient();
    const t = await connected(client);
    const vues: string[] = [];
    observeNotices(client, (n) => vues.push(n.message));
    t.fireClose(1006);
    expect(vues.length).toBeGreaterThan(0);
  });

  it("le journal borne l'anneau et filtre par source", () => {
    const client = newClient();
    let vues: NodefonyNotice[] = [];
    observeNoticeLog(client, (n) => (vues = n), {
      max: 2,
      sources: ["server"],
    });
    const emit = (n: NodefonyNotice) =>
      (client as unknown as { fireNotice(n: NodefonyNotice): void }).fireNotice(
        n,
      );
    emit(notice("realtime", "écartée"));
    expect(vues).toHaveLength(0);
    emit(notice("server", "1"));
    emit(notice("server", "2"));
    emit(notice("server", "3"));
    expect(vues.map((n) => n.message)).toEqual(["2", "3"]);
  });
});

describe("les noms d'événements locaux ne sortent PAS de leur table", () => {
  const REPO = path.resolve(import.meta.dirname, "..", "..", "..", "..");
  /** La table elle-même, et les tests qui figent le contrat, gardent leurs littéraux. */
  const EXEMPTS = /localEvents\.ts$|\.test\.tsx?$|[\\/]tests?[\\/]/;

  /** Sources et GABARITS du dépôt — un gabarit est du code distribué, il compte. */
  function sources(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sources(full, acc);
      else if (/\.(ts|tsx|vue|svelte|tpl)$/.test(entry.name)) acc.push(full);
    }
    return acc;
  }

  it("isLocalEvent reconnaît les six noms de la table, et rien d'autre", () => {
    for (const nom of Object.values(LOCAL_EVENTS)) {
      expect(isLocalEvent(nom)).toBe(true);
    }
    expect(isLocalEvent("live:ticker")).toBe(false);
    expect(isLocalEvent("__inventé__")).toBe(false);
  });

  it("aucun `__événement__` écrit en dur dans le code exécutable ni dans un gabarit", () => {
    const noms = Object.values(LOCAL_EVENTS) as string[];
    const fautes: string[] = [];
    for (const fichier of sources(path.join(REPO, "src"))) {
      if (EXEMPTS.test(fichier)) continue;
      const lignes = readFileSync(fichier, "utf8").split("\n");
      lignes.forEach((ligne, i) => {
        // La PROSE (TSDoc, commentaire) nomme les événements pour les expliquer,
        // pas pour s'y abonner : seul le code compte.
        if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) return;
        for (const nom of noms) {
          if (new RegExp(`["'\`]${nom}["'\`]`).test(ligne)) {
            fautes.push(
              `${path.relative(REPO, fichier).split(path.sep).join("/")}:${i + 1}  ${nom}`,
            );
          }
        }
      });
    }
    expect(
      fautes,
      `écrire ${fautes.length} littéral(aux) au lieu d'appeler la porte publique (onState/onStats/onIdentity/onNotice/onDenied/onReconnect)`,
    ).toEqual([]);
  });
});
