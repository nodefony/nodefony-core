import { describe, it, expect, afterEach } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import {
  RealtimeChannel,
  RealtimeAction,
} from "../../decorators/realtimeDecorators.js";
import type { ContextType } from "@nodefony/http";
import type { RealtimePublish } from "../../interfaces/IRealtimeController.js";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken.js";
import { createRealtimeHarness } from "../../testing/index.js";
// Le VRAI verrou d'autorisation de `@nodefony/security`, importé EN SOURCE —
// même précédent que la matrice `realtimeChannelAuth.e2e`. Les deux paquets sont
// indépendants au RUNTIME ; un test a le droit de les relier pour prouver que
// l'option `frameAuthorizer` du harnais accepte bien le verrou réel, et pas un
// faux qui dirait oui à tout.
import {
  buildFrameAuthorizer,
  DEFAULT_SYSTEM_RULES,
  type IFrameAuthorizerFirewall,
} from "../../../../security/nodefony/src/realtime/frameAuthorizer.js";

/**
 * Ce que le harnais publié doit rendre possible — les cas qui, jusqu'ici,
 * exigeaient une centaine de lignes de plomberie recopiée dans chaque
 * application. Chaque cas ci-dessous est écrit comme le sera celui d'un
 * utilisateur : un controller ordinaire, aucune sous-classe de test, aucun faux
 * contexte à composer.
 *
 * C'est aussi ce qui verrouille la stabilité du contrat : ces tests parlent au
 * harnais par son API publique seule.
 */

/** Controller de démonstration — la forme exacte de ce que le scaffold génère. */
class DemoRt extends RealtimeController {
  disposed: string[] = [];

  constructor(context: ContextType) {
    super("demo-rt", context);
  }

  /** Canal LIBRE : un flux se lit, aucune politique déclarée. */
  @RealtimeChannel("demo:ticker")
  ticker(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { n: 1 });
    return () => {
      this.disposed.push(channel);
    };
  }

  /** Canal réservé aux connexions identifiées. */
  @RealtimeChannel("demo:members", { authenticated: true })
  members(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { members: true });
    return () => {};
  }

  /** Canal réservé à un rôle. */
  @RealtimeChannel("demo:admin", { roles: ["ROLE_ADMIN"] })
  admin(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { admin: true });
    return () => {};
  }

  /** Action ouverte (lecture pure) — comme le `ping` du gabarit. */
  @RealtimeAction("demo:ping", { authenticated: false })
  ping(): { pong: boolean } {
    return { pong: true };
  }

  /**
   * La voie DYNAMIQUE : sert tout `demo:room:<id>`. Le registre des politiques
   * étant indexé par nom EXACT, aucun de ces canaux n'hérite de quoi que ce
   * soit — c'est le piège que le harnais doit rendre visible.
   */
  override createRealtimeChannel(
    channel: string,
    publish: RealtimePublish,
  ): (() => void) | null {
    if (!channel.startsWith("demo:room:")) return null;
    publish(channel, { room: channel });
    return () => {};
  }
}

const mkToken = (
  authenticated: boolean,
  roles: string[] = [],
): IRealtimeToken => ({
  type: authenticated ? "session" : "anonymous",
  getUserIdentifier: () => (authenticated ? "alice" : "anonymous"),
  isAuthenticated: () => authenticated,
  getRoles: () => roles,
  getScopes: () => [],
  getAttribute: () => undefined,
});

/** Firewall factice : hiérarchie ROLE_ADMIN ⊇ ROLE_USER, aucune zone HTTP. */
const firewall: IFrameAuthorizerFirewall = {
  matchPath: () => null,
  hasRole: (roles, required) =>
    roles.includes(required) ||
    (required === "ROLE_USER" && roles.includes("ROLE_ADMIN")),
};

/** Le verrou réel, tel qu'une application avec `@nodefony/security` le pose. */
const realAuthorizer = () =>
  buildFrameAuthorizer(firewall, {
    channelResolver: getRealtimeHub(),
    systemRules: DEFAULT_SYSTEM_RULES,
  });

describe("createRealtimeHarness — le décor d'un test de socket, publié", () => {
  afterEach(() => getRealtimeHub().clear());

  it("connect() rend le welcome — canaux et actions découvrables", async () => {
    const h = createRealtimeHarness((ctx) => new DemoRt(ctx));
    const welcome = await h.connect();
    const params = welcome.params as Record<string, unknown>;
    expect(params.protocol).to.equal("jsonrpc-2.0");
    expect(params.channels).to.include("demo:ticker");
    expect(params.methods).to.include("demo:ping");
    h.dispose();
  });

  it("le message arrive — un canal abonné pousse jusqu'au client", async () => {
    const h = createRealtimeHarness((ctx) => new DemoRt(ctx));
    await h.connect();
    await h.subscribe("demo:ticker");
    expect(h.messages("demo:ticker")).to.deep.equal([{ n: 1 }]);
    h.dispose();
  });

  it("une action répond, appariée par identifiant", async () => {
    const h = createRealtimeHarness((ctx) => new DemoRt(ctx));
    await h.connect();
    expect(await h.call("demo:ping")).to.deep.equal({ pong: true });
    h.dispose();
  });

  it("le désabonnement libère le provider", async () => {
    const h = createRealtimeHarness((ctx) => new DemoRt(ctx));
    await h.connect();
    await h.subscribe("demo:ticker");
    expect(h.controller.disposed).to.have.length(0);
    await h.unsubscribe("demo:ticker");
    expect(h.controller.disposed).to.deep.equal(["demo:ticker"]);
    h.dispose();
  });

  it("la fermeture de la socket dispose les providers restés ouverts", async () => {
    const h = createRealtimeHarness((ctx) => new DemoRt(ctx));
    await h.connect();
    await h.subscribe("demo:ticker");
    h.close();
    expect(h.controller.disposed).to.deep.equal(["demo:ticker"]);
    h.dispose();
  });

  it("abonnement REFUSÉ sans identité — le canal authentifié se tait", async () => {
    const h = createRealtimeHarness((ctx) => new DemoRt(ctx), {
      frameAuthorizer: realAuthorizer(),
    });
    await h.connect();
    await h.subscribe("demo:members");
    expect(h.messages("demo:members")).to.have.length(0);
    expect(h.denials().map((d) => d.channel)).to.deep.equal(["demo:members"]);
    h.dispose();
  });

  it("… et l'accepte dès qu'une identité est posée au handshake", async () => {
    const h = createRealtimeHarness((ctx) => new DemoRt(ctx), {
      identity: mkToken(true, ["ROLE_USER"]),
      frameAuthorizer: realAuthorizer(),
    });
    await h.connect();
    await h.subscribe("demo:members");
    expect(h.messages("demo:members")).to.deep.equal([{ members: true }]);
    expect(h.denials()).to.have.length(0);
    h.dispose();
  });

  it("le rôle exigé garde le canal — ROLE_USER refusé, ROLE_ADMIN admis", async () => {
    const user = createRealtimeHarness((ctx) => new DemoRt(ctx), {
      identity: mkToken(true, ["ROLE_USER"]),
      frameAuthorizer: realAuthorizer(),
    });
    await user.connect();
    await user.subscribe("demo:admin");
    expect(user.messages("demo:admin")).to.have.length(0);
    expect(user.denials().map((d) => d.channel)).to.deep.equal(["demo:admin"]);
    user.dispose();

    const admin = createRealtimeHarness((ctx) => new DemoRt(ctx), {
      identity: mkToken(true, ["ROLE_ADMIN"]),
      frameAuthorizer: realAuthorizer(),
    });
    await admin.connect();
    await admin.subscribe("demo:admin");
    expect(admin.messages("demo:admin")).to.deep.equal([{ admin: true }]);
    admin.dispose();
  });

  it("le canal DYNAMIQUE n'est couvert par aucune politique — le harnais le dit", async () => {
    const h = createRealtimeHarness((ctx) => new DemoRt(ctx), {
      identity: mkToken(true, ["ROLE_ADMIN"]),
      frameAuthorizer: realAuthorizer(),
    });
    await h.connect();
    // Le canal NOMMÉ porte sa politique : rien à signaler.
    await h.subscribe("demo:admin");
    expect(h.notices).to.have.length(0);
    // Le canal DÉRIVÉ est servi par la fabrique dynamique : son auteur le croit
    // gardé comme `demo:admin`, il ne l'est pas — l'avertissement le dit.
    await h.subscribe("demo:room:42");
    expect(h.notices).to.have.length(1);
    expect(h.notices[0]).to.contain("demo:room:42");
    expect(h.notices[0]).to.match(/exact/iu);
    h.dispose();
  });

  it("connect() ÉCHOUE en nommant la cause quand l'Origin est refusée", async () => {
    getRealtimeHub().setOriginGuard((o) => o === "https://app.example.com");
    const h = createRealtimeHarness((ctx) => new DemoRt(ctx), {
      origin: "https://evil.example.com",
      resetHub: false, // garder la politique posée juste au-dessus
    });
    await expect(h.connect()).rejects.toThrow(/socket fermée \(code 4003\)/u);
    expect(h.closes[0]?.code).to.equal(4003);
    h.dispose();
  });
});
