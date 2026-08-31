/**
 * Les composables Vue, EXÉCUTÉS — et surtout : leur LIBÉRATION prouvée.
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
 * `clientObserve.test.ts` : les rejouer ici mesurerait le socle à travers Vue.
 * Ce fichier ne prouve QUE la traduction — portée, réactivité, non-réactivité
 * du client, et libération.
 *
 * Aucun DOM : `createApp` ne touche au document qu'au `mount`, et
 * `app.runWithContext` + `effectScope` donnent exactement ce qu'un composant
 * donne à un composable — un contexte d'injection et une portée d'effet.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createApp, effectScope, isReactive, ref, type App } from "vue";
import { RealtimeClient } from "../client/realtime/RealtimeClient";
import {
  TransportState,
  type IRealtimeTransport,
} from "../realtime/IRealtimeTransport";
import {
  nodefonyVue,
  useNodefony,
  useNodefonyChannel,
  useNodefonyChannelData,
  useNodefonySnapshot,
  useNodefonyState,
} from "../client/vue/index";

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

/**
 * Ce qu'un composant donne à un composable, sans composant : un contexte
 * d'injection et une portée d'effet. `arreter()` est le démontage.
 */
function monter<T>(
  app: App,
  composable: () => T,
): { valeur: T; arreter: () => void } {
  const scope = effectScope();
  let valeur!: T;
  app.runWithContext(() => {
    scope.run(() => {
      valeur = composable();
    });
  });
  return { valeur, arreter: () => scope.stop() };
}

function appAvec(client: RealtimeClient): App {
  const app = createApp({});
  app.use(nodefonyVue, { client });
  return app;
}

beforeEach(() => {
  transports = [];
  delete (globalThis as { __nfRealtime__?: unknown }).__nfRealtime__;
});

describe("nodefonyVue — le plugin", () => {
  it("fournit la socket FOURNIE, et ne touche pas à son cycle", () => {
    const client = newClient();
    const app = appAvec(client);
    const { valeur, arreter } = monter(app, () => useNodefony());
    expect(valeur).toBe(client);
    arreter();
  });

  it("la socket n'est JAMAIS enveloppée dans un proxy réactif", () => {
    // La règle qui n'existe qu'en Vue : un `ref()`/`reactive()` sur le client
    // casserait ses égalités de référence internes et ferait payer une
    // interception à chaque accès, pour une réactivité dont il n'a aucun
    // besoin. `markRaw` est la seule chose qui l'empêche, et rien d'autre ne
    // le dirait — une page « marche » parfaitement avec un client proxifié,
    // jusqu'au jour où une comparaison d'identité échoue.
    const client = newClient();
    const { valeur, arreter } = monter(appAvec(client), () => useNodefony());
    expect(isReactive(valeur)).toBe(false);
    arreter();
  });

  it("hors plugin : erreur explicite, jamais une adresse devinée", () => {
    const app = createApp({});
    expect(() => monter(app, () => useNodefony())).toThrow(
      /plugin n'est pas installé/u,
    );
  });

  it("sans url ni client : le plugin REFUSE — le framework ne devine aucune adresse", () => {
    const app = createApp({});
    expect(() => app.use(nodefonyVue, {})).toThrow();
  });
});

describe("composables — portée et libération", () => {
  it("hors portée d'effet : erreur AVANT que l'abonnement soit pris", () => {
    const client = newClient();
    const app = appAvec(client);
    // Contexte d'injection SANS portée : exactement le cas de l'appel au
    // niveau d'un module ou dans un gestionnaire d'événement.
    expect(() =>
      app.runWithContext(() => useNodefonyChannelData("live:events")),
    ).toThrow(/portée/u);
  });

  it("🔴 le démontage REND l'abonnement au serveur", async () => {
    const client = newClient();
    const t = await connected(client);
    const app = appAvec(client);
    const { arreter } = monter(app, () =>
      useNodefonyChannelData("live:events"),
    );
    expect(abonnements(t)).toEqual(["subscribe live:events"]);
    expect(client.subscribedChannels).toEqual(["live:events"]);

    arreter();

    expect(abonnements(t)).toEqual([
      "subscribe live:events",
      "unsubscribe live:events",
    ]);
    expect(client.subscribedChannels).toEqual([]);
  });

  it("deux composables, un seul abonnement réseau — et il n'est rendu qu'au dernier", async () => {
    const client = newClient();
    const t = await connected(client);
    const app = appAvec(client);
    const a = monter(app, () => useNodefonyChannelData("live:events"));
    const b = monter(app, () => useNodefonyChannelData("live:events"));
    expect(abonnements(t)).toEqual(["subscribe live:events"]);

    a.arreter();
    expect(abonnements(t)).toEqual(["subscribe live:events"]);
    b.arreter();
    expect(abonnements(t)).toEqual([
      "subscribe live:events",
      "unsubscribe live:events",
    ]);
  });

  it("un canal RÉACTIF déplace l'abonnement, sans en laisser derrière", async () => {
    const client = newClient();
    const t = await connected(client);
    const app = appAvec(client);
    const canal = ref("live:a");
    const { arreter } = monter(app, () => useNodefonyChannelData(canal));
    expect(client.subscribedChannels).toEqual(["live:a"]);

    canal.value = "live:b";
    // Le watcher de Vue est différé : on attend le cycle suivant.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(client.subscribedChannels).toEqual(["live:b"]);
    expect(abonnements(t)).toEqual([
      "subscribe live:a",
      "unsubscribe live:a",
      "subscribe live:b",
    ]);
    arreter();
  });
});

describe("composables — la traduction vers la réactivité", () => {
  it("la dernière valeur reçue arrive dans la ref", async () => {
    const client = newClient();
    const t = await connected(client);
    const app = appAvec(client);
    const { valeur, arreter } = monter(app, () =>
      useNodefonyChannelData<{ n: number }>("live:events"),
    );
    expect(valeur.value).toBeNull();
    t.push("live:events", { n: 1 });
    t.push("live:events", { n: 2 });
    expect(valeur.value).toEqual({ n: 2 });
    arreter();
  });

  it("l'état de connexion suit la socket", async () => {
    const client = newClient();
    const app = appAvec(client);
    const { valeur, arreter } = monter(app, () => useNodefonyState());
    expect(valeur.value).toBe("disconnected");
    await connected(client);
    expect(valeur.value).toBe("connected");
    arreter();
  });

  it("l'instantané de la socket est rendu, et cite les canaux tenus", async () => {
    const client = newClient();
    await connected(client);
    const app = appAvec(client);
    const { valeur, arreter } = monter(app, () => {
      useNodefonyChannel("live:events", () => {});
      return useNodefonySnapshot();
    });
    expect(valeur.value?.state).toBe("connected");
    expect(valeur.value?.channels).toContain("live:events");
    arreter();
  });
});
