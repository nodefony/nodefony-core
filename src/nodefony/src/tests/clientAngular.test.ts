// @vitest-environment jsdom
/**
 * Les fonctions d'injection Angular, EXÉCUTÉES — et surtout : leur LIBÉRATION
 * prouvée.
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
 * Angular. Ce fichier ne prouve QUE la traduction — contexte d'injection,
 * signals, ouverture hors zone, et libération.
 *
 * **Pourquoi un DOM et le compilateur, ici, alors que le banc Vue s'en passe.**
 * Un contexte d'injection Angular complet — celui qui porte le planificateur de
 * détection de changements dont `effect()` dépend — n'existe qu'au sein d'une
 * `ApplicationRef`. `createApplication()` est exactement ce que
 * `bootstrapApplication()` appelle, et il touche au document. Un injecteur
 * fabriqué à la main donnerait un banc plus léger qui n'exercerait PAS le
 * chemin réel : `effect()` y lève `NG0201`. Le compilateur (`@angular/compiler`)
 * n'est importé que pour ce banc — le paquet publié, lui, n'en a aucun besoin,
 * c'est précisément la raison pour laquelle `nodefony/angular` ne publie aucun
 * décorateur.
 */
import "@angular/compiler";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createApplication } from "@angular/platform-browser";
import {
  createEnvironmentInjector,
  provideZonelessChangeDetection,
  runInInjectionContext,
  signal,
  ApplicationRef,
  NgZone,
} from "@angular/core";
import { RealtimeClient } from "../client/realtime/RealtimeClient";
import {
  TransportState,
  type IRealtimeTransport,
} from "../realtime/IRealtimeTransport";
import {
  injectNodefony,
  injectNodefonyChannel,
  injectNodefonyChannelData,
  injectNodefonySnapshot,
  injectNodefonyState,
  provideNodefony,
} from "../client/angular/index";

/** L'adresse du banc — jamais atteinte : le transport est un mock. */
const URL_BANC = "ws://loopback/realtime";

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
/** Vrai pendant l'exécution d'un `runOutsideAngular` — lu à la fabrication du transport. */
let horsZone = false;
/** Le transport a-t-il été fabriqué hors zone ? `null` tant qu'aucun ne l'a été. */
let transportHorsZone: boolean | null = null;

function newClient(): RealtimeClient {
  return new RealtimeClient({ url: URL_BANC }, () => {
    transportHorsZone = horsZone;
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
 * Place un client de banc dans le registre des sockets partagées, sous la clé
 * que le client calcule lui-même.
 *
 * La clé est une URL résolue en absolu — la deviner depuis le banc la ferait
 * diverger de la résolution réelle. On laisse donc le client créer son entrée,
 * puis on remplace la valeur : la clé reste celle du produit.
 */
function partagerSous(url: string, client: RealtimeClient): void {
  RealtimeClient.shared({ url });
  const map = (globalThis as { __nfRealtime__?: Map<string, RealtimeClient> })
    .__nfRealtime__!;
  for (const cle of map.keys()) map.set(cle, client);
}

/** Une application Angular zoneless — ce que `bootstrapApplication` construit. */
function appAvec(providers: unknown[]): Promise<ApplicationRef> {
  return createApplication({
    providers: [provideZonelessChangeDetection(), ...(providers as never[])],
  });
}

/**
 * Ce qu'un composant donne à ces fonctions, sans composant : un contexte
 * d'injection avec sa propre durée de vie. `arreter()` est le démontage.
 */
function monter<T>(
  app: ApplicationRef,
  fn: () => T,
): { valeur: T; arreter: () => void } {
  const inj = createEnvironmentInjector([], app.injector);
  const valeur = runInInjectionContext(inj, fn);
  return { valeur, arreter: () => inj.destroy() };
}

beforeEach(() => {
  transports = [];
  horsZone = false;
  transportHorsZone = null;
  delete (globalThis as { __nfRealtime__?: unknown }).__nfRealtime__;
});

describe("provideNodefony — le fournisseur", () => {
  it("fournit la socket FOURNIE, et ne touche pas à son cycle", async () => {
    const client = newClient();
    const app = await appAvec([provideNodefony({ client })]);
    const { valeur, arreter } = monter(app, () => injectNodefony());
    expect(valeur).toBe(client);
    expect(client.state).toBe("disconnected");
    arreter();
    app.destroy();
  });

  it("🔴 la connexion est ouverte HORS ZONE — sinon chaque trame coûte une détection globale", async () => {
    // La règle qui n'existe qu'en Angular, et qui est chiffrée : avec `zone.js`,
    // une socket ouverte DANS la zone fait relancer la détection de changements
    // à chaque trame reçue — un canal à 10 Hz coûte dix détections par seconde à
    // toute l'application. Rien ne le dirait : la page s'afficherait très bien.
    // Le juge est le moment où le TRANSPORT est fabriqué, puisque c'est lui que
    // `zone.js` remplace.
    const client = newClient();
    partagerSous(URL_BANC, client);
    const app = await appAvec([provideNodefony({ url: URL_BANC })]);
    // On observe la VRAIE instance de zone de l'application — l'échanger contre
    // un espion prouverait que l'espion a été appelé, pas que le produit passe
    // par la zone de l'application.
    const zone = app.injector.get(NgZone);
    const vraie = zone.runOutsideAngular.bind(zone);
    vi.spyOn(zone, "runOutsideAngular").mockImplementation(((
      fn: () => unknown,
    ) =>
      vraie(() => {
        horsZone = true;
        try {
          return fn();
        } finally {
          horsZone = false;
        }
      })) as typeof zone.runOutsideAngular);

    const { arreter } = monter(app, () => injectNodefony());
    expect(transportHorsZone, "aucun transport fabriqué").not.toBeNull();
    expect(transportHorsZone).toBe(true);
    arreter();
    app.destroy();
  });

  it("hors fournisseur : erreur explicite, jamais une adresse devinée", async () => {
    const app = await appAvec([]);
    expect(() => monter(app, () => injectNodefony())).toThrow(
      /provideNodefony\(\) n'est pas dans les providers/u,
    );
    app.destroy();
  });

  it("sans url ni client : le fournisseur REFUSE, et il refuse TOUT DE SUITE", () => {
    // Le refus tombe à la composition des providers, pas à la première
    // injection : une erreur qui n'apparaît qu'au premier rendu d'un composant
    // se lit à un endroit qui n'a rien à voir avec sa cause.
    expect(() => provideNodefony({})).toThrow();
  });
});

describe("fonctions d'injection — contexte et libération", () => {
  it("hors contexte d'injection : erreur AVANT que l'abonnement soit pris", async () => {
    const client = newClient();
    await connected(client);
    const app = await appAvec([provideNodefony({ client })]);
    // Exactement le cas de l'appel dans un gestionnaire d'événement ou un
    // `setTimeout` : rien ne libérerait l'abonnement.
    expect(() => injectNodefonyChannelData("live:events")).toThrow();
    expect(client.subscribedChannels).toEqual([]);
    app.destroy();
  });

  it("🔴 la destruction REND l'abonnement au serveur", async () => {
    const client = newClient();
    const t = await connected(client);
    const app = await appAvec([provideNodefony({ client })]);
    const { arreter } = monter(app, () =>
      injectNodefonyChannelData("live:events"),
    );
    expect(abonnements(t)).toEqual(["subscribe live:events"]);
    expect(client.subscribedChannels).toEqual(["live:events"]);

    arreter();

    expect(abonnements(t)).toEqual([
      "subscribe live:events",
      "unsubscribe live:events",
    ]);
    expect(client.subscribedChannels).toEqual([]);
    app.destroy();
  });

  it("deux consommateurs, un seul abonnement réseau — et il n'est rendu qu'au dernier", async () => {
    const client = newClient();
    const t = await connected(client);
    const app = await appAvec([provideNodefony({ client })]);
    const a = monter(app, () => injectNodefonyChannelData("live:events"));
    const b = monter(app, () => injectNodefonyChannelData("live:events"));
    expect(abonnements(t)).toEqual(["subscribe live:events"]);

    a.arreter();
    expect(abonnements(t)).toEqual(["subscribe live:events"]);
    b.arreter();
    expect(abonnements(t)).toEqual([
      "subscribe live:events",
      "unsubscribe live:events",
    ]);
    app.destroy();
  });

  it("un canal SIGNAL déplace l'abonnement, sans en laisser derrière", async () => {
    const client = newClient();
    const t = await connected(client);
    const app = await appAvec([provideNodefony({ client })]);
    const canal = signal("live:a");
    const { arreter } = monter(app, () => injectNodefonyChannelData(canal));
    app.tick();
    expect(client.subscribedChannels).toEqual(["live:a"]);

    canal.set("live:b");
    app.tick();
    expect(client.subscribedChannels).toEqual(["live:b"]);
    expect(abonnements(t)).toEqual([
      "subscribe live:a",
      "unsubscribe live:a",
      "subscribe live:b",
    ]);
    arreter();
    app.destroy();
  });
});

describe("fonctions d'injection — la traduction vers les signals", () => {
  it("la dernière valeur reçue arrive dans le signal", async () => {
    const client = newClient();
    const t = await connected(client);
    const app = await appAvec([provideNodefony({ client })]);
    const { valeur, arreter } = monter(app, () =>
      injectNodefonyChannelData<{ n: number }>("live:events"),
    );
    expect(valeur()).toBeNull();
    t.push("live:events", { n: 1 });
    t.push("live:events", { n: 2 });
    expect(valeur()).toEqual({ n: 2 });
    arreter();
    app.destroy();
  });

  it("l'état de connexion suit la socket", async () => {
    const client = newClient();
    const app = await appAvec([provideNodefony({ client })]);
    const { valeur, arreter } = monter(app, () => injectNodefonyState());
    expect(valeur()).toBe("disconnected");
    await connected(client);
    expect(valeur()).toBe("connected");
    arreter();
    app.destroy();
  });

  it("l'instantané de la socket est rendu, et cite les canaux tenus", async () => {
    const client = newClient();
    await connected(client);
    const app = await appAvec([provideNodefony({ client })]);
    const { valeur, arreter } = monter(app, () => {
      injectNodefonyChannel("live:events", () => {});
      return injectNodefonySnapshot();
    });
    expect(valeur()?.state).toBe("connected");
    expect(valeur()?.channels).toContain("live:events");
    arreter();
    app.destroy();
  });
});
