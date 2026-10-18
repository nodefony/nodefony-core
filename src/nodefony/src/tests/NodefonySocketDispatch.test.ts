import { expect } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";

/**
 * Discrimination des frames JSON-RPC 2.0 : le RÔLE se lit sur `method`, pas sur
 * `id`. On exerce `handleMessage` (point d'arrivée des frames) sans vrai WebSocket
 * — `request()` enregistre un pending, `send()` est stubé pour capter une réponse
 * sortante. Verrouille le fix « entrant vs sortant » des 2 directions.
 */
interface Internals {
  handleMessage(raw: string): void;
  send(msg: unknown): boolean | void;
}

/**
 * Simule un transport OUVERT. Sans ce stub, `send` répond `false` (aucune socket
 * dans ce décor) et le peer rejette la requête AVANT qu'on puisse lui livrer sa
 * réponse — on ne testerait plus la corrélation, seulement l'absence de socket.
 */
const openTransport = (internal: Internals): void => {
  internal.send = () => true;
};

function newClient(): { client: NodefonySocket; internal: Internals } {
  const client = new NodefonySocket({
    url: "ws://localhost/nodefony/api/realtime",
    autoReconnect: false,
  });
  return { client, internal: client as unknown as Internals };
}

describe("NodefonySocket — discrimination des frames (entrant vs sortant)", () => {
  it("RÉPONSE (id, result, SANS method) → résout la requête sortante", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    const p = client.request<"nodefony:kernel:ping", { ok: boolean }>(
      "nodefony:kernel:ping",
    ); // 1ʳᵉ requête → id 1
    internal.handleMessage(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
    );
    const r = await p;
    expect(r).to.deep.equal({ ok: true });
    client.disconnect();
  });

  it("RÉPONSE error (id, error, SANS method) → rejette la requête sortante", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    const p = client.request("nodefony:orm:flow:reset"); // id 1
    internal.handleMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "method not found" },
      }),
    );
    let rejected = false;
    try {
      await p;
    } catch {
      rejected = true;
    }
    expect(rejected).to.equal(true);
    client.disconnect();
  });

  it("REQUÊTE entrante (method + id) → le client répond -32601, PAS traitée comme une réponse", () => {
    const { client, internal } = newClient();
    const out: unknown[] = [];
    internal.send = (m) => {
      out.push(m);
      return true; // transport ouvert simulé
    };
    // aucune requête sortante enregistrée → si c'était mal classé en réponse, on
    // ne renverrait rien. Ici method présent + id = requête entrante.
    internal.handleMessage(
      JSON.stringify({ jsonrpc: "2.0", id: 42, method: "client:doStuff" }),
    );
    expect(out).to.have.length(1);
    expect(out[0]).to.deep.equal({
      jsonrpc: "2.0",
      id: 42,
      error: { code: -32601, message: "method not found: client:doStuff" },
    });
    client.disconnect();
  });

  it("REQUÊTE entrante à id STRING (JSON-RPC autorise string) → répond avec le même id string", () => {
    const { client, internal } = newClient();
    const out: Array<{ id?: unknown }> = [];
    internal.send = (m) => {
      out.push(m as { id?: unknown });
      return true; // transport ouvert simulé
    };
    internal.handleMessage(
      JSON.stringify({ jsonrpc: "2.0", id: "abc-7", method: "client:x" }),
    );
    expect(out).to.have.length(1);
    expect(out[0]!.id).to.equal("abc-7");
    client.disconnect();
  });

  it("NOTIFICATION (method, SANS id) → dispatch pub/sub, jamais prise pour une réponse", () => {
    const { client, internal } = newClient();
    const received: unknown[] = [];
    client.on("nodefony:dashboard", (p) => received.push(p));
    const out: unknown[] = [];
    internal.send = (m) => {
      out.push(m);
      return true; // transport ouvert simulé
    };
    internal.handleMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "nodefony:dashboard",
        params: { cpu: 12 },
      }),
    );
    expect(received).to.deep.equal([{ cpu: 12 }]);
    expect(out).to.have.length(0); // une notification n'appelle JAMAIS de réponse
    client.disconnect();
  });

  it("frame sans jsonrpc:2.0 → ignorée (ni handler, ni réponse)", () => {
    const { client, internal } = newClient();
    const received: unknown[] = [];
    client.on("x", (p) => received.push(p));
    const out: unknown[] = [];
    internal.send = (m) => {
      out.push(m);
      return true; // transport ouvert simulé
    };
    internal.handleMessage(JSON.stringify({ method: "x", params: 1 }));
    expect(received).to.have.length(0);
    expect(out).to.have.length(0);
    client.disconnect();
  });
});

describe("NodefonySocket — realtime:denied (refus de canal observable)", () => {
  it("notification realtime:denied → onDenied {channel, reason} + onNotice", () => {
    const { client, internal } = newClient();
    const denials: Array<{ channel: string; reason: string }> = [];
    const notices: unknown[] = [];
    client.onDenied((d) => denials.push(d));
    client.onNotice((n) => notices.push(n));
    internal.handleMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "realtime:denied",
        params: { channel: "admin:metrics", reason: "forbidden" },
      }),
    );
    expect(denials).to.deep.equal([
      { channel: "admin:metrics", reason: "forbidden" },
    ]);
    expect(notices).to.have.length(1); // UX générique en plus du seam ciblé
    client.disconnect();
  });

  it("payload partiel → motif par défaut forbidden, channel vide toléré", () => {
    const { client, internal } = newClient();
    const denials: Array<{ channel: string; reason: string }> = [];
    client.onDenied((d) => denials.push(d));
    internal.handleMessage(
      JSON.stringify({ jsonrpc: "2.0", method: "realtime:denied", params: {} }),
    );
    expect(denials).to.deep.equal([{ channel: "", reason: "forbidden" }]);
    client.disconnect();
  });
});

describe("NodefonySocket — realtime:subscribed (l'abonnement effectif se DIT, #610)", () => {
  const frame = (method: string, params: unknown): string =>
    JSON.stringify({ jsonrpc: "2.0", method, params });
  const welcome = (acks: boolean): string =>
    frame("realtime:welcome", {
      ts: 0,
      protocol: "jsonrpc-2.0",
      channels: [],
      methods: [],
      ...(acks ? { subscriptionAcks: true } : {}),
    });
  // Laisse passer les microtâches : une promesse encore pendante l'est vraiment.
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  const track = (p: Promise<void>) => {
    const s = { settled: "pending" as "pending" | "resolved" | "rejected" };
    p.then(
      () => (s.settled = "resolved"),
      () => (s.settled = "rejected"),
    );
    return s;
  };

  it("🔴 whenSubscribed se résout à l'acquittement, PAS au welcome", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    const acks: unknown[] = [];
    client.onSubscribed((a) => acks.push(a));
    client.subscribe("app:flux");
    internal.handleMessage(welcome(true));
    const s = track(client.whenSubscribed("app:flux"));
    await flush();
    expect(s.settled).toBe("pending");
    internal.handleMessage(
      frame("realtime:subscribed", { channel: "app:flux" }),
    );
    await flush();
    expect(s.settled).toBe("resolved");
    expect(acks).to.deep.equal([{ channel: "app:flux" }]);
    // Déjà acquitté : une nouvelle attente se résout tout de suite.
    const again = track(client.whenSubscribed("app:flux"));
    await flush();
    expect(again.settled).toBe("resolved");
    client.disconnect();
  });

  it("sens négatif : un refus du MÊME canal rejette l'attente, refus en `cause`", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    client.subscribe("admin:metrics");
    internal.handleMessage(welcome(true));
    const p = client.whenSubscribed("admin:metrics");
    internal.handleMessage(
      frame("realtime:denied", {
        channel: "admin:metrics",
        reason: "forbidden",
      }),
    );
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).cause).to.deep.equal({
      channel: "admin:metrics",
      reason: "forbidden",
    });
    client.disconnect();
  });

  it("un refus d'un AUTRE canal ne touche pas l'attente", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    client.subscribe("app:a");
    internal.handleMessage(welcome(true));
    const s = track(client.whenSubscribed("app:a"));
    internal.handleMessage(
      frame("realtime:denied", { channel: "app:b", reason: "unknown" }),
    );
    await flush();
    expect(s.settled).toBe("pending");
    client.disconnect();
  });

  it("serveur ANCIEN (welcome sans subscriptionAcks) → résolu au rejeu, jamais pendante", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    client.subscribe("app:flux");
    const before = track(client.whenSubscribed("app:flux"));
    internal.handleMessage(welcome(false));
    await flush();
    expect(before.settled).toBe("resolved");
    const after = track(client.whenSubscribed("app:flux"));
    await flush();
    expect(after.settled).toBe("resolved");
    client.disconnect();
  });

  it("une nouvelle connexion remet l'attente à zéro : l'acquittement précédent ne vaut plus", async () => {
    // Transport inerte : seule compte la remise à zéro que fait la VRAIE
    // ouverture d'une nouvelle tentative (`openSocket`), appelée telle quelle.
    const client = new NodefonySocket(
      { url: "ws://localhost/nodefony/api/realtime", autoReconnect: false },
      () => ({
        readyState: 0,
        connect: () => {},
        send: () => {},
        close: () => {},
        onOpen: () => {},
        onMessage: () => {},
        onClose: () => {},
        onError: () => {},
      }),
    );
    const internal = client as unknown as Internals & {
      openSocket(): Promise<void>;
    };
    openTransport(internal);
    client.subscribe("app:flux");
    internal.handleMessage(welcome(true));
    internal.handleMessage(
      frame("realtime:subscribed", { channel: "app:flux" }),
    );
    void internal.openSocket().catch(() => {});
    internal.handleMessage(welcome(true));
    const s = track(client.whenSubscribed("app:flux"));
    await flush();
    expect(s.settled).toBe("pending");
    internal.handleMessage(
      frame("realtime:subscribed", { channel: "app:flux" }),
    );
    await flush();
    expect(s.settled).toBe("resolved");
    client.disconnect();
  });

  it("sens négatif : sans subscribe() en cours, whenSubscribed rejette au lieu d'attendre", async () => {
    const { client } = newClient();
    const err = await client.whenSubscribed("app:rien").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    client.disconnect();
  });

  it("unsubscribe avant l'acquittement, puis disconnect() : les attentes sont rejetées", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    client.subscribe("app:a");
    client.subscribe("app:b");
    internal.handleMessage(welcome(true));
    const a = track(client.whenSubscribed("app:a"));
    const b = track(client.whenSubscribed("app:b"));
    client.unsubscribe("app:a");
    await flush();
    expect(a.settled).toBe("rejected");
    expect(b.settled).toBe("pending");
    client.disconnect();
    await flush();
    expect(b.settled).toBe("rejected");
  });

  it("attendue AVANT le welcome : reste pendante jusqu'à l'acquittement de la connexion", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    client.subscribe("app:flux");
    const s = track(client.whenSubscribed("app:flux"));
    internal.handleMessage(welcome(true));
    await flush();
    expect(s.settled).toBe("pending");
    internal.handleMessage(
      frame("realtime:subscribed", { channel: "app:flux" }),
    );
    await flush();
    expect(s.settled).toBe("resolved");
    client.disconnect();
  });

  it("N attentes sur le même canal se résolvent TOUTES au même acquittement", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    client.subscribe("app:flux");
    internal.handleMessage(welcome(true));
    const all = [1, 2, 3].map(() => track(client.whenSubscribed("app:flux")));
    internal.handleMessage(
      frame("realtime:subscribed", { channel: "app:flux" }),
    );
    await flush();
    expect(all.map((s) => s.settled)).to.deep.equal([
      "resolved",
      "resolved",
      "resolved",
    ]);
    client.disconnect();
  });

  it("ref-comptage : rendre UN des deux consommateurs ne rejette pas l'attente", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    client.subscribe("app:flux");
    client.subscribe("app:flux");
    internal.handleMessage(welcome(true));
    const s = track(client.whenSubscribed("app:flux"));
    client.unsubscribe("app:flux"); // 2 → 1 : le canal reste demandé
    await flush();
    expect(s.settled).toBe("pending");
    internal.handleMessage(
      frame("realtime:subscribed", { channel: "app:flux" }),
    );
    await flush();
    expect(s.settled).toBe("resolved");
    client.disconnect();
  });

  it("rendu PUIS redemandé : l'ancien acquittement ne compte plus", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    client.subscribe("app:flux");
    internal.handleMessage(welcome(true));
    internal.handleMessage(
      frame("realtime:subscribed", { channel: "app:flux" }),
    );
    client.unsubscribe("app:flux");
    client.subscribe("app:flux");
    const s = track(client.whenSubscribed("app:flux"));
    await flush();
    expect(s.settled).toBe("pending");
    client.disconnect();
  });

  it("sens négatif : une trame hostile (canal non-chaîne, params absents) ne résout rien", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    const acks: unknown[] = [];
    client.onSubscribed((a) => acks.push(a));
    client.subscribe("app:flux");
    internal.handleMessage(welcome(true));
    const s = track(client.whenSubscribed("app:flux"));
    for (const params of [undefined, null, {}, { channel: 42 }, ["app:flux"]])
      internal.handleMessage(frame("realtime:subscribed", params));
    await flush();
    expect(s.settled).toBe("pending");
    expect(acks).to.have.length(0);
    client.disconnect();
  });

  it('sens négatif : `subscriptionAcks` doit valoir EXACTEMENT true ("true", 1 ne valent rien)', async () => {
    for (const flag of ["true", 1, {}]) {
      const { client, internal } = newClient();
      openTransport(internal);
      client.subscribe("app:flux");
      internal.handleMessage(
        frame("realtime:welcome", {
          ts: 0,
          protocol: "jsonrpc-2.0",
          channels: [],
          methods: [],
          subscriptionAcks: flag,
        }),
      );
      // Sans annonce valide, repli sur l'ancien contrat : actif au rejeu.
      const s = track(client.whenSubscribed("app:flux"));
      await flush();
      expect(s.settled).toBe("resolved");
      client.disconnect();
    }
  });

  it("onSubscribed rend un dispose qui coupe l'écouteur", () => {
    const { client, internal } = newClient();
    openTransport(internal);
    const acks: unknown[] = [];
    const off = client.onSubscribed((a) => acks.push(a));
    client.subscribe("app:a");
    client.subscribe("app:b");
    internal.handleMessage(welcome(true));
    internal.handleMessage(frame("realtime:subscribed", { channel: "app:a" }));
    off();
    internal.handleMessage(frame("realtime:subscribed", { channel: "app:b" }));
    expect(acks).to.deep.equal([{ channel: "app:a" }]);
    client.disconnect();
  });

  it('la frame est aussi livrée aux écouteurs `on("realtime:subscribed")`, comme les autres notifications', () => {
    const { client, internal } = newClient();
    openTransport(internal);
    const raw: unknown[] = [];
    client.on("realtime:subscribed", (p) => raw.push(p));
    client.subscribe("app:a");
    internal.handleMessage(welcome(true));
    internal.handleMessage(frame("realtime:subscribed", { channel: "app:a" }));
    expect(raw).to.deep.equal([{ channel: "app:a" }]);
    client.disconnect();
  });

  it("un acquittement pour un canal non demandé est ignoré", () => {
    const { client, internal } = newClient();
    const acks: unknown[] = [];
    client.onSubscribed((a) => acks.push(a));
    internal.handleMessage(welcome(true));
    internal.handleMessage(frame("realtime:subscribed", { channel: "app:x" }));
    expect(acks).to.have.length(0);
    client.disconnect();
  });
});

describe("NodefonySocket — erreur GLOBALE serveur vs réponse corrélée", () => {
  it("frame `{jsonrpc, error}` SANS id → notice « Temps réel »", () => {
    const { client, internal } = newClient();
    const notices: Array<{ message: string }> = [];
    client.onNotice((n) => notices.push(n));
    internal.handleMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "refus tardif" },
      }),
    );
    expect(notices.map((n) => n.message)).to.deep.equal(["refus tardif"]);
    client.disconnect();
  });

  it("erreur à `id: null` (§5 : id illisible) → notice, elle aussi globale", () => {
    const { client, internal } = newClient();
    const notices: unknown[] = [];
    client.onNotice((n) => notices.push(n));
    internal.handleMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      }),
    );
    expect(notices).to.have.length(1);
    client.disconnect();
  });

  it("🔴 frame invalide qui porte l'`id` d'un appel → l'appel échoue, SANS notice globale en double", async () => {
    const { client, internal } = newClient();
    openTransport(internal);
    const notices: unknown[] = [];
    client.onNotice((n) => notices.push(n));
    const p = client.request<"nodefony:kernel:ping">("nodefony:kernel:ping");
    // `result` ET `error` : interdit par §5, donc invalide — mais corrélé.
    internal.handleMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: 1,
        error: { code: -32000, message: "e" },
      }),
    );
    const err = await p.catch((e: unknown) => e);
    expect((err as Error).message).to.equal("e");
    expect(notices).to.have.length(0);
    client.disconnect();
  });
});
