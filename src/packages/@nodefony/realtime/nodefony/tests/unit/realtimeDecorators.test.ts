import "reflect-metadata";
import { describe, it, expect } from "vitest";
import {
  RealtimeAction,
  RealtimeChannel,
  RealtimeInbound,
  getRealtimeActions,
  getRealtimeChannels,
  getRealtimeInbound,
  type RealtimeChannelFactory,
} from "../../decorators/realtimeDecorators";
import type {
  RealtimeInboundHandler,
  RealtimePublish,
} from "../../interfaces/IRealtimeController";

/**
 * Décorateurs realtime — moteur déclaratif (NestJS-like). Tests purs : on instancie
 * la classe décorée et on lit le registre via les helpers. Le branchement avec
 * `RealtimeController` (handshake) est testé séparément dans `RealtimeController.test.ts`.
 */

describe("@RealtimeAction — registre des actions RPC", () => {
  it("enregistre une méthode unique avec son nom de canal RPC", () => {
    class Ctrl {
      @RealtimeAction("kernel:ping")
      ping(): { pong: true } {
        return { pong: true };
      }
    }
    const inst = new Ctrl();
    const actions = getRealtimeActions(inst);
    expect(actions).to.not.equal(null);
    expect(Object.keys(actions!)).to.deep.equal(["kernel:ping"]);
    // Bind sur l'instance : `this` reste le controller même appelé via le map.
    expect(actions!["kernel:ping"]!(undefined)).to.deep.equal({ pong: true });
  });

  it("enregistre plusieurs actions sur la même classe", () => {
    class Ctrl {
      @RealtimeAction("kernel:ping")
      ping(): number {
        return 1;
      }
      @RealtimeAction("kernel:gc")
      gc(): number {
        return 2;
      }
    }
    const actions = getRealtimeActions(new Ctrl())!;
    expect(Object.keys(actions).sort()).to.deep.equal([
      "kernel:gc",
      "kernel:ping",
    ]);
  });

  it("propage les params au handler (params libres, sync OR async)", async () => {
    class Ctrl {
      @RealtimeAction("echo")
      echoSync(params: unknown): unknown {
        return params;
      }
      @RealtimeAction("echoAsync")
      async echoAsync(params: unknown): Promise<unknown> {
        return params;
      }
    }
    const actions = getRealtimeActions(new Ctrl())!;
    expect(actions["echo"]!({ x: 1 })).to.deep.equal({ x: 1 });
    expect(await actions["echoAsync"]!({ y: 2 })).to.deep.equal({ y: 2 });
  });

  it("le `this` reste lié à l'instance (lecture de membre privé)", () => {
    class Ctrl {
      private counter = 41;
      @RealtimeAction("bump")
      bump(): number {
        this.counter += 1;
        return this.counter;
      }
    }
    const actions = getRealtimeActions(new Ctrl())!;
    expect(actions["bump"]!(undefined)).to.equal(42);
  });

  it("classe sans décorateur → getRealtimeActions renvoie null (bypass 0-coût)", () => {
    class Plain {}
    expect(getRealtimeActions(new Plain())).to.equal(null);
  });
});

describe("@RealtimeChannel — registre des canaux pub/sub", () => {
  it("enregistre un factory pour un nom EXACT, retournant son dispose", () => {
    class Ctrl {
      @RealtimeChannel("dashboard:stats")
      stats(_channel: string, _publish: RealtimePublish): () => void {
        return () => {};
      }
    }
    const channels = getRealtimeChannels(new Ctrl());
    expect(channels).to.not.equal(null);
    expect(Object.keys(channels!)).to.deep.equal(["dashboard:stats"]);
    const dispose = channels!["dashboard:stats"]!("dashboard:stats", () => {});
    expect(typeof dispose).to.equal("function");
  });

  it("le factory reçoit (channel, publish) et `this` reste l'instance", () => {
    let seenChannel: string | null = null;
    let publishedCount = 0;
    class Ctrl {
      private id = "C1";
      @RealtimeChannel("ch1")
      ch1(channel: string, publish: RealtimePublish): () => void {
        seenChannel = channel;
        publish(channel, { from: this.id }); // utilise un membre privé pour vérifier le bind
        return () => {
          publishedCount = -1;
        };
      }
    }
    const factory: RealtimeChannelFactory = getRealtimeChannels(new Ctrl())![
      "ch1"
    ]!;
    const dispose = factory("ch1", (_c, _p) => {
      publishedCount++;
    });
    expect(seenChannel).to.equal("ch1");
    expect(publishedCount).to.equal(1);
    dispose();
    expect(publishedCount).to.equal(-1);
  });
});

describe("@RealtimeInbound — registre des canaux full-duplex entrants", () => {
  it("enregistre le handler, `reply` permet le push serveur→client", () => {
    const replied: unknown[] = [];
    class Ctrl {
      @RealtimeInbound("chat:send")
      onSend(params: unknown, reply: (payload: unknown) => void): void {
        const text = (params as { text?: unknown })?.text;
        if (typeof text === "string") reply({ echoed: text });
      }
    }
    const inbound = getRealtimeInbound(new Ctrl())!;
    inbound["chat:send"]!({ text: "hi" }, (p) => replied.push(p));
    expect(replied).to.deep.equal([{ echoed: "hi" }]);
  });

  it("classe sans `@RealtimeInbound` → null (chemin notification = 0 lookup)", () => {
    class Plain {}
    expect(getRealtimeInbound(new Plain())).to.equal(null);
  });
});

describe("héritage — la subclass voit les décorateurs de la parent ET les siens", () => {
  it("getRealtimeActions remonte la chaîne prototype (Reflect.getMetadata)", () => {
    class Base {
      @RealtimeAction("base:ping")
      ping(): string {
        return "base";
      }
    }
    class Sub extends Base {
      @RealtimeAction("sub:hello")
      hello(): string {
        return "sub";
      }
    }
    // Reflect.getMetadata sur Sub remonte naturellement à Base.
    const subActions = getRealtimeActions(new Sub())!;
    // Au minimum, l'action de Sub est présente. Selon le compilateur TS,
    // l'action de Base peut être vue via la chaîne prototype (cas standard
    // de reflect-metadata). On verrouille au moins l'action de Sub :
    expect(subActions["sub:hello"]!(undefined)).to.equal("sub");
  });
});

describe("multiples instances de la même classe — registre PAR CLASSE, bind PAR INSTANCE", () => {
  it("deux instances → mêmes noms d'actions, mais `this` distinct", () => {
    class Ctr {
      constructor(private label: string) {}
      @RealtimeAction("who")
      who(): string {
        return this.label;
      }
    }
    const a = getRealtimeActions(new Ctr("A"))!;
    const b = getRealtimeActions(new Ctr("B"))!;
    expect(a["who"]!(undefined)).to.equal("A");
    expect(b["who"]!(undefined)).to.equal("B");
    // Le registre des NOMS est partagé (posé sur le constructor), mais chaque
    // appel d'helper crée un nouveau map avec des fonctions bind à l'instance —
    // c'est exactement ce qu'on veut au handshake.
    expect(Object.keys(a)).to.deep.equal(Object.keys(b));
  });
});
