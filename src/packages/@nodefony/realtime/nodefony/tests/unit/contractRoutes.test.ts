/**
 * Unit — le démarrage vérifie les routes d'un contrat (`serverRoutes`, #708).
 *
 * Le contrat est un TYPE : il fait compiler `chat.post("/chat/send", …)` contre
 * une route qui peut ne pas exister, ne pas servir la socket, ou valider un
 * autre schéma. La table statique `serverRoutes` du contrôleur porte les
 * VALEURS, et ce contrôle les confronte aux routes montées — une fois, au boot.
 */
import { describe, it, expect } from "vitest";
import "reflect-metadata";
import { BootConfigurationError, Module } from "nodefony";
import { FRAMEWORK_ROUTER, route } from "@nodefony/framework";
import {
  assertContractRoutes,
  readContractRoutes,
} from "../../src/server/contractRoutes";
import type { IMountedBridgeRoute } from "../../src/server/contractRoutes";
import type { IStandardSchemaV1 } from "nodefony";
import { RealtimeController } from "../../src/server/RealtimeController";
import { Realtime } from "../../../index";

/** Un schéma Standard Schema minimal — chaque appel rend un OBJET distinct. */
const schema = (): IStandardSchemaV1 => ({
  "~standard": { version: 1, vendor: "t", validate: (value) => ({ value }) },
});
const SendBody = schema();
const OtherBody = schema();
const HistoryQuery = schema();
const IdParams = schema();

const mounted: IMountedBridgeRoute[] = [
  {
    path: "/chat/send",
    methods: new Set(["POST", "WEBSOCKET"]),
    schema: { body: SendBody },
  },
  {
    path: "/chat/history/",
    methods: new Set(["GET", "WEBSOCKET"]),
    schema: { query: HistoryQuery },
  },
  { path: "/chat/rooms", methods: undefined, schema: null },
  { path: "/chat/http-only", methods: new Set(["POST"]), schema: null },
  {
    path: "/chat/messages/{id}",
    methods: new Set(["GET", "DELETE", "WEBSOCKET"]),
    schema: { params: IdParams },
  },
  { path: "/items/{id}(\\d+)", methods: undefined, schema: null },
];

/** Le message de l'erreur de démarrage levée, ou `null` si rien n'est levé. */
function failure(table: Record<string, unknown>): string | null {
  try {
    assertContractRoutes("ChatRt", table, mounted);
    return null;
  } catch (error) {
    expect(error).to.be.instanceOf(BootConfigurationError);
    return error instanceof Error ? error.message : String(error);
  }
}

describe("contrat de routes — contrôle au démarrage", () => {
  it("accepte chaque entrée servie par le pont avec le MÊME schéma", () => {
    expect(
      failure({
        "POST /chat/send": { body: SendBody },
        "GET /chat/history": { query: HistoryQuery },
        "GET /chat/rooms": {},
        "DELETE /chat/rooms": {},
      }),
    ).to.equal(null);
  });

  it("refuse une entrée sans route, en nommant la classe et l'entrée", () => {
    expect(failure({ "POST /chat/absent": {} })).to.match(
      /ChatRt\.serverRoutes « POST \/chat\/absent ».*aucune route montée/,
    );
  });

  it("refuse une route qui ne sert pas le verbe par la socket", () => {
    expect(failure({ "POST /chat/http-only": {} })).to.match(
      /ne sert pas POST par la socket.*"POST" et "WEBSOCKET"/,
    );
    expect(failure({ "PATCH /chat/send": { body: SendBody } })).to.match(
      /ne sert pas PATCH/,
    );
  });

  it("refuse un schéma différent, absent ou en trop", () => {
    expect(failure({ "POST /chat/send": { body: OtherBody } })).to.match(
      /« body » n'est pas celui que la route valide/,
    );
    expect(failure({ "POST /chat/send": {} })).to.match(
      /« body » n'est pas déclaré, mais la route en valide un/,
    );
    expect(failure({ "GET /chat/rooms": { query: HistoryQuery } })).to.match(
      /« query » est déclaré, mais la route n'en valide aucun/,
    );
  });

  it("accepte un gabarit simple avec le MÊME schéma params, refuse un autre", () => {
    expect(
      failure({
        "GET /chat/messages/{id}": { params: IdParams },
        "DELETE /chat/messages/{id}": { params: IdParams },
      }),
    ).to.equal(null);
    expect(failure({ "GET /chat/messages/{id}": {} })).to.match(
      /« params » n'est pas déclaré, mais la route en valide un/,
    );
    expect(
      failure({ "GET /chat/messages/{id}": { params: OtherBody } }),
    ).to.match(/« params » n'est pas celui que la route valide/);
  });

  it("refuse un gabarit qui n'est pas fait de segments « {nom} » entiers", () => {
    for (const key of [
      "GET /items/{id}(\\d+)",
      "GET /docs/{slug}?",
      "GET /export/{name}.{format}",
    ]) {
      expect(failure({ [key]: {} }), key).to.match(
        /seuls des segments « \{nom\} » entiers/,
      );
    }
  });

  it("refuse une clé ou une valeur mal formée", () => {
    expect(failure({ "SEND /chat/send": {} })).to.match(/<VERBE> <chemin>/);
    expect(failure({ "POST chat/send": {} })).to.match(/<VERBE> <chemin>/);
    expect(failure({ "POST /chat/send": null })).to.match(
      /\{ body\?, query\?, params\? \}/,
    );
    expect(
      failure({ "POST /chat/send": { body: SendBody, result: 1 } }),
    ).to.match(/clé « result » inconnue/);
  });

  it("lit la table statique, et ne contrôle rien sans elle", () => {
    class WithTable {
      static readonly serverRoutes = { "GET /chat/rooms": {} };
    }
    class WithoutTable {}
    class BadTable {
      static readonly serverRoutes = "GET /chat/rooms";
    }
    expect(readContractRoutes(WithTable)).to.deep.equal({
      "GET /chat/rooms": {},
    });
    expect(readContractRoutes(WithoutTable)).to.equal(null);
    expect(() => readContractRoutes(BadTable)).to.throw(
      BootConfigurationError,
      /BadTable : « serverRoutes » doit être un objet/,
    );
  });
});

describe("contrat de routes — branché au démarrage du module (onKernelReady)", () => {
  /** Contrôleur HTTP dont l'action valide `SendBody` — schéma rangé par le vrai décorateur. */
  class ChatHttp {
    @route("chat-send", { path: "/send", schema: { body: SendBody } })
    send(): void {}
  }

  /** Lance `onKernelReady` sur un routeur qui ne monte que `POST|WEBSOCKET /chat/send`. */
  async function boot(table: Record<string, unknown>): Promise<void> {
    class ChatRt extends RealtimeController {
      static readonly serverRoutes = table;
    }
    const router = {
      [FRAMEWORK_ROUTER]: true,
      getRoutes: () => [
        {
          path: "/chat/send",
          methodsSet: new Set(["POST", "WEBSOCKET"]),
          controller: ChatHttp,
          classMethod: "send",
        },
      ],
    };
    const key = "test708:ChatRt";
    Reflect.set(Module.controllers, key, ChatRt);
    try {
      await Reflect.apply(
        Realtime.prototype.onKernelReady,
        // Propriétés PROPRES (defineProperty) : `config` n'est qu'un accesseur
        // sur le prototype, une affectation serait refusée.
        Object.create(Realtime.prototype, {
          config: { value: { enabled: true } },
          kernel: {
            value: {
              container: {
                get: (name: string) => (name === "router" ? router : undefined),
              },
            },
          },
          log: { value: () => {} },
        }),
        [],
      );
    } finally {
      Reflect.deleteProperty(Module.controllers, key);
    }
  }

  it("démarre quand la table correspond aux routes montées (schéma lu sur l'action)", async () => {
    await boot({ "POST /chat/send": { body: SendBody } });
  });

  it("refuse le démarrage sur une entrée sans route, ou un schéma qui n'est pas celui de l'action", async () => {
    await expect(boot({ "GET /chat/absent": {} })).rejects.toThrow(
      /ChatRt\.serverRoutes « GET \/chat\/absent ».*aucune route montée/,
    );
    await expect(
      boot({ "POST /chat/send": { body: OtherBody } }),
    ).rejects.toThrow(/« body » n'est pas celui que la route valide/);
  });
});
