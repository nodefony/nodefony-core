//
// ─── RealtimeController — une instance PAR CONNEXION (#506) ─────────────────
//
// Les contrôleurs sont singletons par défaut ; `RealtimeController` ne l'est
// pas, par construction : son pair JSON-RPC capture l'instance du handshake,
// et `notifyClient` / `requestClient` désignent « CETTE connexion » par
// l'instance. Partagée, une instance ferait ouvrir des sockets qui ne disent
// jamais `realtime:welcome` — une panne indiscernable d'un incident réseau.
//
// Débrancher : `static override scope` (le défaut singleton reprend la main —
// le harnais ne voit plus aucune frame), ou le corps de
// `RealtimeController.assertScope` (plus aucun refus).
//
import { expect } from "vitest";
import "reflect-metadata";
import { BootConfigurationError } from "nodefony";
import type { Module } from "nodefony";
import { Router, Scope } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { createRealtimeHarness } from "../../testing/index.js";

const fakeModule = {
  name: "@nodefony/rt-scope",
  log() {},
} as unknown as Module;

describe("RealtimeController — portée par connexion (#506)", () => {
  it("sa portée est request, malgré le défaut singleton des contrôleurs", () => {
    class ChatRt extends RealtimeController {}
    expect(RealtimeController.scope).to.equal("request");
    expect(ChatRt.scope).to.equal("request");
  });

  it("deux connexions ont deux instances, chacune liée à SA connexion", async () => {
    class PairRt extends RealtimeController {
      constructor(context: ContextType) {
        super("PairRt", context);
      }
    }
    const a = createRealtimeHarness((ctx) => new PairRt(ctx));
    await a.connect();
    const b = createRealtimeHarness((ctx) => new PairRt(ctx), {
      resetHub: false,
    });
    await b.connect();
    expect(a.controller).to.not.equal(b.controller);
  });

  it('Router.setController refuse au démarrage une sous-classe @Scope("singleton"), en la nommant', () => {
    @Scope("singleton")
    class SharedRt extends RealtimeController {}
    expect(() => Router.setController(SharedRt, fakeModule)).to.throw(
      BootConfigurationError,
      /SharedRt/,
    );
  });

  it("le constructeur refuse aussi, pour qui construit par new hors du routeur", () => {
    @Scope("singleton")
    class SharedByNewRt extends RealtimeController {}
    expect(() =>
      createRealtimeHarness((ctx) => new SharedByNewRt("SharedByNewRt", ctx)),
    ).to.throw(BootConfigurationError, /SharedByNewRt/);
  });
});
