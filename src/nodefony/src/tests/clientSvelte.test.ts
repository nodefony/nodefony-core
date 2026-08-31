// @vitest-environment jsdom
/**
 * Les liaisons Svelte, EXÉCUTÉES dans de VRAIS composants compilés — et surtout :
 * leur LIBÉRATION prouvée.
 *
 * Ce que ces cas tiennent, et que rien d'autre ne peut tenir : **un abonnement
 * qui fuit ne se voit pas à l'écran**. La page continue d'afficher ce qu'il
 * faut, le serveur continue de pousser un canal que plus personne ne regarde,
 * et le défaut n'apparaît qu'en production, sous la forme d'un trafic qui monte
 * sans raison. Le seul juge est le compte des trames `subscribe`/`unsubscribe`
 * émises vers le serveur — c'est ce que ces cas comptent.
 *
 * Les règles du temps réel elles-mêmes (appariement, ref-comptage, dernier reçu
 * gagne, anneaux, filtres) sont éprouvées UNE fois pour les quatre fronts dans
 * `clientObserve.test.ts` : les rejouer ici mesurerait le socle à travers
 * Svelte. Ce fichier ne prouve QUE la traduction — l'instant où l'abonnement est
 * pris, celui où il est rendu, et l'ordre quand un canal change.
 *
 * **Pourquoi des fixtures `.svelte` compilées, et pas un simulacre.** Les runes
 * et les effets sont des constructions du COMPILATEUR : ils n'existent pas dans
 * un `.ts`. Or tout ce que ce banc doit prouver est décidé par le système
 * d'effets RÉEL — un harnais qui l'imiterait mesurerait le harnais. Le
 * compilateur est donc branché sur la suite du cœur (`vitest.config.ts`), et
 * ces quatre fixtures sont montées puis démontées pour de bon.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import { RealtimeClient } from "../client/realtime/RealtimeClient";
import {
  TransportState,
  type IRealtimeTransport,
} from "../realtime/IRealtimeTransport";
import {
  configureNodefony,
  nodefony,
  nodefonyChannel,
  nodefonyChannelData,
  nodefonySnapshot,
  nodefonyState,
} from "../client/svelte/index";
import LitValeur from "./fixtures/LitValeur.svelte";
import NeLitRien from "./fixtures/NeLitRien.svelte";
import CanalMobile from "./fixtures/CanalMobile.svelte";
import EffetCanal from "./fixtures/EffetCanal.svelte";

class MockTransport implements IRealtimeTransport {
  readyState: number = TransportState.CONNECTING;
  sent: string[] = [];
  private _open: (() => void) | null = null;
  private _msg: ((raw: string) => void) | null = null;
  connect(): void {}
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
  onClose(): void {}
  onError(): void {}
  fireOpen(): void {
    this.readyState = TransportState.OPEN;
    this._open?.();
    // Le serveur réel enchaîne l'ouverture et son `realtime:welcome` — et il JETTE
    // toute frame reçue entre les deux (`RealtimeController.handleRealtime`). Un mock
    // qui s'arrête à l'ouverture décrit un serveur qui n'existe pas : c'est ce qui a
    // laissé passer la perte des abonnements posés avant le welcome et rejoués après
    // une reconnexion. Sans `params` : la seule conséquence voulue ici est le rejeu.
    this._msg?.(JSON.stringify({ jsonrpc: "2.0", method: "realtime:welcome" }));
  }
  push(channel: string, payload: unknown): void {
    this._msg?.(
      JSON.stringify({ jsonrpc: "2.0", method: channel, params: payload }),
    );
  }
}

let transports: MockTransport[] = [];

function newClient(): RealtimeClient {
  return new RealtimeClient({ url: "ws://loopback/realtime" }, () => {
    const t = new MockTransport();
    transports.push(t);
    return t;
  });
}

async function connected(client: RealtimeClient): Promise<MockTransport> {
  const promise = client.connect();
  transports[transports.length - 1]!.fireOpen();
  await promise;
  return transports[transports.length - 1]!;
}

/** Les trames d'abonnement émises vers le serveur, dans l'ordre. */
function abonnements(t: MockTransport): string[] {
  return t.sent
    .map((raw) => JSON.parse(raw) as { method: string; params?: unknown })
    .filter((f) => f.method === "subscribe" || f.method === "unsubscribe")
    .map(
      (f) =>
        `${f.method} ${(f.params as { channel?: string })?.channel ?? "?"}`,
    );
}

/** Une cible de montage neuve — un composant démonté ne laisse rien derrière. */
function cible(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  transports = [];
  delete (globalThis as { __nfRealtime__?: unknown }).__nfRealtime__;
  document.body.innerHTML = "";
});

describe("configureNodefony — la politique de la page", () => {
  it("fournit la socket FOURNIE, et ne touche pas à son cycle", () => {
    const client = newClient();
    configureNodefony({ client });
    expect(nodefony()).toBe(client);
    expect(client.state).toBe("disconnected");
  });

  it("sans url ni client : REFUS — le framework ne devine aucune adresse", () => {
    expect(() => configureNodefony({})).toThrow();
  });
});

describe("valeurs réactives — l'abonnement suit la LECTURE", () => {
  it("🔴 le démontage REND l'abonnement au serveur", async () => {
    const client = newClient();
    const t = await connected(client);
    configureNodefony({ client });

    const el = cible();
    const app = mount(LitValeur, {
      target: el,
      props: { source: nodefonyChannelData("live:events") },
    });
    flushSync();
    expect(abonnements(t)).toEqual(["subscribe live:events"]);
    expect(client.subscribedChannels).toEqual(["live:events"]);

    unmount(app);
    flushSync();

    expect(abonnements(t)).toEqual([
      "subscribe live:events",
      "unsubscribe live:events",
    ]);
    expect(client.subscribedChannels).toEqual([]);
  });

  it("🔴 une valeur que PERSONNE ne lit ne s'abonne pas — le seul écart entre les quatre fronts", async () => {
    // React, Vue et Angular s'abonnent au montage. Ici l'abonnement suit la
    // LECTURE : c'est le contrat de `createSubscriber`, et celui des primitives
    // réactives de Svelte lui-même. Ce cas existe pour que l'écart soit ÉCRIT :
    // le jour où quelqu'un le corrigerait « par symétrie », il saurait qu'il
    // change un comportement voulu, pas qu'il répare un oubli.
    const client = newClient();
    const t = await connected(client);
    configureNodefony({ client });

    const app = mount(NeLitRien, {
      target: cible(),
      props: { source: nodefonyChannelData("live:events") },
    });
    flushSync();
    expect(abonnements(t)).toEqual([]);
    expect(client.subscribedChannels).toEqual([]);
    unmount(app);
  });

  it("deux composants, un seul abonnement réseau — et il n'est rendu qu'au dernier", async () => {
    const client = newClient();
    const t = await connected(client);
    configureNodefony({ client });

    const a = mount(LitValeur, {
      target: cible(),
      props: { source: nodefonyChannelData("live:events") },
    });
    const b = mount(LitValeur, {
      target: cible(),
      props: { source: nodefonyChannelData("live:events") },
    });
    flushSync();
    expect(abonnements(t)).toEqual(["subscribe live:events"]);

    unmount(a);
    flushSync();
    expect(abonnements(t)).toEqual(["subscribe live:events"]);
    unmount(b);
    flushSync();
    expect(abonnements(t)).toEqual([
      "subscribe live:events",
      "unsubscribe live:events",
    ]);
  });

  it("un canal qui change prend le NOUVEAU avant de rendre l'ancien", async () => {
    // L'ordre est celui du système d'effets, pas de la liaison — et il est
    // l'inverse de celui de Vue et d'Angular, qui libèrent d'abord. Sur deux
    // canaux distincts la différence est sans conséquence ; elle est notée ici
    // parce qu'un banc qui asserte un ordre doit asserter CELUI QUI A LIEU.
    const client = newClient();
    const t = await connected(client);
    configureNodefony({ client });

    const app = mount(CanalMobile, {
      target: cible(),
      props: { fabrique: (canal: string) => nodefonyChannelData(canal) },
    });
    flushSync();
    expect(client.subscribedChannels).toEqual(["live:a"]);

    (app as unknown as { changer(n: string): void }).changer("live:b");
    flushSync();

    expect(abonnements(t)).toEqual([
      "subscribe live:a",
      "subscribe live:b",
      "unsubscribe live:a",
    ]);
    expect(client.subscribedChannels).toEqual(["live:b"]);

    unmount(app);
    flushSync();
    expect(client.subscribedChannels).toEqual([]);
  });

  it("la dernière valeur reçue arrive dans la vue", async () => {
    const client = newClient();
    const t = await connected(client);
    configureNodefony({ client });

    const el = cible();
    const app = mount(LitValeur, {
      target: el,
      props: { source: nodefonyChannelData<{ n: number }>("live:events") },
    });
    flushSync();
    expect(el.textContent).toContain("null");

    t.push("live:events", { n: 1 });
    t.push("live:events", { n: 2 });
    flushSync();
    expect(el.textContent).toContain('"n":2');
    unmount(app);
  });

  it("l'état de connexion suit la socket", async () => {
    const client = newClient();
    configureNodefony({ client });

    const el = cible();
    const app = mount(LitValeur, {
      target: el,
      props: { source: nodefonyState() },
    });
    flushSync();
    expect(el.textContent).toContain("disconnected");

    await connected(client);
    flushSync();
    expect(el.textContent).toContain("connected");
    unmount(app);
  });

  it("l'instantané de la socket est rendu, et cite les canaux tenus", async () => {
    const client = newClient();
    await connected(client);
    configureNodefony({ client });

    const el = cible();
    const abonne = mount(EffetCanal, {
      target: cible(),
      props: { brancher: () => nodefonyChannel("live:events", () => {}) },
    });
    // Les effets sont DIFFÉRÉS : sans ce vidage, l'abonnement n'a pas encore eu
    // lieu quand l'instantané est lu, et l'instantané dit vrai — il n'y a
    // simplement rien à citer. Le rafraîchissement suivant vient de
    // l'échantillonneur, une seconde plus tard.
    flushSync();
    const app = mount(LitValeur, {
      target: el,
      props: { source: nodefonySnapshot() },
    });
    flushSync();
    expect(el.textContent).toContain('"state":"connected"');
    expect(el.textContent).toContain("live:events");
    unmount(app);
    unmount(abonne);
  });
});

describe("nodefonyChannel — la forme NON paresseuse", () => {
  it("s'abonne sans qu'aucune valeur ne soit affichée, et rend au démontage", async () => {
    const client = newClient();
    const t = await connected(client);
    configureNodefony({ client });

    const recus: unknown[] = [];
    const app = mount(EffetCanal, {
      target: cible(),
      props: {
        brancher: () =>
          nodefonyChannel("live:salon", (m) => {
            recus.push(m);
          }),
      },
    });
    flushSync();
    expect(abonnements(t)).toEqual(["subscribe live:salon"]);

    t.push("live:salon", { texte: "bonjour" });
    expect(recus).toEqual([{ texte: "bonjour" }]);

    unmount(app);
    flushSync();
    expect(abonnements(t)).toEqual([
      "subscribe live:salon",
      "unsubscribe live:salon",
    ]);
  });

  it("hors configuration : erreur explicite, jamais une adresse devinée", async () => {
    // La socket de la page est un état de MODULE, que les cas précédents ont
    // posé. Le seul moyen honnête d'éprouver l'état initial est donc de
    // recharger le module : lever l'erreur soi-même dans le test aurait vérifié
    // le test, pas le produit.
    vi.resetModules();
    const frais = (await import("../client/svelte/index")) as {
      nodefony: () => unknown;
    };
    expect(() => frais.nodefony()).toThrow(/configureNodefony/u);
  });
});
