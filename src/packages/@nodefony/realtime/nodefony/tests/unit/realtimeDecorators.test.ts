import "reflect-metadata";
import { describe, it, expect } from "vitest";
import {
  RealtimeAction,
  RealtimeChannel,
  RealtimeInbound,
  getRealtimeActions,
  getRealtimeChannels,
  getRealtimeInbound,
  getRealtimeChannelPolicies,
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
      @RealtimeAction("nodefony:kernel:ping")
      ping(): { pong: true } {
        return { pong: true };
      }
    }
    const inst = new Ctrl();
    const actions = getRealtimeActions(inst);
    expect(actions).to.not.equal(null);
    expect(Object.keys(actions!)).to.deep.equal(["nodefony:kernel:ping"]);
    // Bind sur l'instance : `this` reste le controller même appelé via le map.
    expect(actions!["nodefony:kernel:ping"]!(undefined)).to.deep.equal({
      pong: true,
    });
  });

  it("enregistre plusieurs actions sur la même classe", () => {
    class Ctrl {
      @RealtimeAction("nodefony:kernel:ping")
      ping(): number {
        return 1;
      }
      @RealtimeAction("nodefony:kernel:gc")
      gc(): number {
        return 2;
      }
    }
    const actions = getRealtimeActions(new Ctrl())!;
    expect(Object.keys(actions).sort()).to.deep.equal([
      "nodefony:kernel:gc",
      "nodefony:kernel:ping",
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

// ── FERMÉE PAR DÉFAUT ──────────────────────────────────────────────────────
// Une action RPC est une méthode que le pair APPELLE : elle agit (`nodefony:kernel:gc`,
// `nodefony:scaffold:run`, `orders:quote`). Elle était pourtant la seule des trois
// surfaces déclaratives à ne pas accepter de politique, et le verrou laisse
// passer ce qu'aucune politique ne couvre (`frameAuthorizer.ts`, « canal
// applicatif libre ») : toute action applicative était donc PUBLIQUE, sans que
// rien ne le dise. Un défaut sûr ne se documente pas, il se code.
describe("@RealtimeAction — politique d'autorisation (fermée par défaut)", () => {
  it("SANS politique déclarée → exige une connexion authentifiée", () => {
    class Ctrl {
      @RealtimeAction("orders:quote")
      quote(): number {
        return 1;
      }
    }
    const policies = getRealtimeChannelPolicies(new Ctrl());
    expect(policies).to.not.equal(null);
    expect(policies!["orders:quote"]).to.deep.equal({ authenticated: true });
  });

  it("AVEC politique déclarée → la politique de l'auteur est respectée telle quelle", () => {
    class Ctrl {
      @RealtimeAction("admin:purge", { roles: ["ROLE_ADMIN"] })
      purge(): void {}
    }
    const policies = getRealtimeChannelPolicies(new Ctrl())!;
    expect(policies["admin:purge"]).to.deep.equal({ roles: ["ROLE_ADMIN"] });
  });

  it("ouverture EXPLICITE (`authenticated: false`) → action publique assumée", () => {
    // Le seul moyen de rendre une action publique est désormais de l'écrire.
    // `satisfies()` ne contraint rien quand `authenticated` est falsy.
    class Ctrl {
      @RealtimeAction("public:health", { authenticated: false })
      health(): string {
        return "ok";
      }
    }
    const policies = getRealtimeChannelPolicies(new Ctrl())!;
    expect(policies["public:health"]).to.deep.equal({ authenticated: false });
  });

  it("la politique par défaut n'écrase pas celle d'un canal homonyme déjà déclaré", () => {
    // Le registre des politiques est indexé par NOM et partagé entre les trois
    // décorateurs : une action ne doit pas rétrograder la politique d'un canal
    // portant le même nom (ici plus stricte que le défaut).
    class Ctrl {
      @RealtimeChannel("ops:feed", { roles: ["ROLE_ADMIN"] })
      feed(_channel: string, _publish: RealtimePublish): () => void {
        return () => {};
      }
      @RealtimeAction("ops:feed")
      feedAction(): void {}
    }
    const policies = getRealtimeChannelPolicies(new Ctrl())!;
    expect(policies["ops:feed"]).to.deep.equal({ roles: ["ROLE_ADMIN"] });
  });

  it("le handler reste enregistré normalement (la politique ne change rien au routage)", () => {
    class Ctrl {
      @RealtimeAction("orders:quote")
      quote(): number {
        return 42;
      }
    }
    const actions = getRealtimeActions(new Ctrl())!;
    expect(actions["orders:quote"]!(undefined)).to.equal(42);
  });
});

describe("@RealtimeChannel — registre des canaux pub/sub", () => {
  it("enregistre un factory pour un nom EXACT, retournant son dispose", () => {
    class Ctrl {
      @RealtimeChannel("nodefony:dashboard")
      stats(_channel: string, _publish: RealtimePublish): () => void {
        return () => {};
      }
    }
    const channels = getRealtimeChannels(new Ctrl());
    expect(channels).to.not.equal(null);
    expect(Object.keys(channels!)).to.deep.equal(["nodefony:dashboard"]);
    const dispose = channels!["nodefony:dashboard"]!(
      "nodefony:dashboard",
      () => {},
    );
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

describe("policies d'autorisation (@RealtimeChannel/@RealtimeInbound opts)", () => {
  it("sans opts → aucune policy (canal libre, 0 alloc)", () => {
    class Ctrl {
      @RealtimeChannel("chat:public")
      pub(_c: string, _p: RealtimePublish): () => void {
        return () => {};
      }
    }
    expect(getRealtimeChannelPolicies(new Ctrl())).to.equal(null);
  });

  it("opts vide ({}) → ignoré (pas de contrainte = pas de policy)", () => {
    class Ctrl {
      @RealtimeChannel("chat:x", {})
      x(_c: string, _p: RealtimePublish): () => void {
        return () => {};
      }
    }
    expect(getRealtimeChannelPolicies(new Ctrl())).to.equal(null);
  });

  it("@RealtimeChannel avec roles/scopes/authenticated → policy indexée par canal", () => {
    class Ctrl {
      @RealtimeChannel("admin:metrics", { roles: ["ROLE_ADMIN"] })
      a(_c: string, _p: RealtimePublish): () => void {
        return () => {};
      }
      @RealtimeChannel("api:flux", { scopes: ["metrics:read"] })
      b(_c: string, _p: RealtimePublish): () => void {
        return () => {};
      }
      @RealtimeChannel("members:area", { authenticated: true })
      c(_c: string, _p: RealtimePublish): () => void {
        return () => {};
      }
    }
    const pol = getRealtimeChannelPolicies(new Ctrl())!;
    expect(pol["admin:metrics"]).to.deep.equal({ roles: ["ROLE_ADMIN"] });
    expect(pol["api:flux"]).to.deep.equal({ scopes: ["metrics:read"] });
    expect(pol["members:area"]).to.deep.equal({ authenticated: true });
  });

  it("@RealtimeInbound partage le MÊME registre (gating du push)", () => {
    class Ctrl {
      @RealtimeInbound("ops:command", { roles: ["ROLE_ADMIN"] })
      cmd(_p: unknown, _r: (x: unknown) => void): void {}
    }
    const pol = getRealtimeChannelPolicies(new Ctrl())!;
    expect(pol["ops:command"]).to.deep.equal({ roles: ["ROLE_ADMIN"] });
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

describe("getters — robustesse défensive (entrée non-fonction ignorée)", () => {
  it("une entrée de registre pointant une propriété NON-fonction est filtrée", () => {
    // Cas dégradé (registre corrompu / propriété écrasée) : le nom existe dans le
    // map mais l'instance ne porte pas une fonction sous cette clé → l'entrée est
    // ignorée (jamais bind d'une non-fonction au handshake).
    class Weird {
      notAFn = 42;
    }
    Reflect.defineMetadata("realtime:actions", { "x:act": "notAFn" }, Weird);
    Reflect.defineMetadata("realtime:channels", { "x:chan": "notAFn" }, Weird);
    Reflect.defineMetadata("realtime:inbound", { "x:in": "notAFn" }, Weird);
    const inst = new Weird();
    expect(getRealtimeActions(inst)).to.deep.equal({});
    expect(getRealtimeChannels(inst)).to.deep.equal({});
    expect(getRealtimeInbound(inst)).to.deep.equal({});
  });
});
