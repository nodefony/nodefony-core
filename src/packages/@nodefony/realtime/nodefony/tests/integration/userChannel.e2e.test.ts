import { describe, it, expect, afterEach } from "vitest";
import "reflect-metadata";
import type { ISubscriberIdentity } from "nodefony";
import type { ContextType } from "@nodefony/http";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { RealtimeHub, getRealtimeHub } from "../../src/server/RealtimeHub.js";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken.js";
import type {
  BackplaneHandler,
  IBackplane,
  IBackplaneInfo,
} from "../../interfaces/IBackplane.js";
import {
  createRealtimeHarness,
  type IRealtimeHarness,
} from "../../testing/index.js";
// Le VRAI verrou de `@nodefony/security`, en source — même précédent que
// `realtimeHarness.e2e` : prouver la brique avec le verrou d'une application réelle.
import {
  buildFrameAuthorizer,
  DEFAULT_SYSTEM_RULES,
  type IFrameAuthorizerFirewall,
} from "../../../../security/nodefony/src/realtime/frameAuthorizer.js";

/**
 * #710 — livrer un message à UNE personne (ADR-0022 §6, D1). L'application ne
 * déclare RIEN : ni canal, ni `allow`, ni diffusion. Le contrôleur ci-dessous
 * est vide à dessein — c'est le cas d'une application qui n'a jamais entendu
 * parler du canal personnel, et qui doit pourtant le servir correctement.
 */
class EmptyRt extends RealtimeController {
  constructor(context: ContextType) {
    super("empty-rt", context);
  }
}

const firewall: IFrameAuthorizerFirewall = {
  matchPath: () => null,
  hasRole: (roles, required) => roles.includes(required),
};
const securityLock = () =>
  buildFrameAuthorizer(firewall, {
    channelResolver: getRealtimeHub(),
    systemRules: DEFAULT_SYSTEM_RULES,
  });

/** Jeton d'une connexion : compte `id`, ou anonyme si `id === null`. */
const tokenOf = (id: string | null): IRealtimeToken => {
  const authenticated = id !== null;
  const who: ISubscriberIdentity = Object.freeze({
    type: authenticated ? "session" : "anonymous",
    authenticated,
    id,
    userIdentifier: authenticated ? `login-${id}` : "anonymous",
    roles: authenticated ? ["ROLE_USER"] : ["ROLE_ANONYMOUS"],
    scopes: [],
    issuer: null,
    account: authenticated,
  });
  return {
    type: who.type,
    getUserIdentifier: () => who.userIdentifier,
    isAuthenticated: () => authenticated,
    getRoles: () => [...who.roles],
    getScopes: () => [],
    getAttribute: () => undefined,
    getIdentity: () => who,
  };
};

let open: IRealtimeHarness<EmptyRt>[] = [];
/** Une connexion (un onglet) ; seule la première remet le hub à zéro. */
const tab = async (
  id: string | null,
  withSecurity = true,
): Promise<IRealtimeHarness<EmptyRt>> => {
  const h = createRealtimeHarness((ctx) => new EmptyRt(ctx), {
    identity: tokenOf(id),
    ...(withSecurity ? { frameAuthorizer: securityLock() } : {}),
    resetHub: open.length === 0,
  });
  open.push(h);
  await h.connect();
  return h;
};

afterEach(() => {
  for (const h of open) h.dispose();
  open = [];
  getRealtimeHub().clear();
});

/** Le détail d'un refus, nom du canal effacé : seule la FORME doit être commune. */
const shapeOf = (h: IRealtimeHarness<EmptyRt>, channel: string) => {
  const d = h.denials().find((x) => x.channel === channel);
  return d === undefined
    ? undefined
    : { reason: d.reason, detail: d.detail?.replaceAll(channel, "<canal>") };
};

describe("#710 — canal personnel, sans rien déclarer", () => {
  it("42 reçoit sur ses TROIS onglets ; 43 ne reçoit rien", async () => {
    const tabs = [await tab("42"), await tab("42"), await tab("42")];
    const other = await tab("43");
    for (const t of tabs) await t.subscribe("user:42");
    await other.subscribe("user:43");

    getRealtimeHub().publishToUser("42", { text: "salut" });

    for (const t of tabs) {
      expect(t.messages("user:42")).to.deep.equal([{ text: "salut" }]);
    }
    expect(other.messages("user:43")).to.deep.equal([]);
    expect(other.denials()).to.deep.equal([]);
  });

  it("43 qui demande user:42 (existe) et user:999 (n'existe pas) reçoit DEUX refus identiques", async () => {
    await tab("42").then((t) => t.subscribe("user:42"));
    const intruder = await tab("43");
    await intruder.subscribe("user:42");
    await intruder.subscribe("user:999");

    const existing = shapeOf(intruder, "user:42");
    expect(existing?.reason).to.equal("forbidden");
    // Ni oracle d'existence ni oracle de présence : même motif, même détail.
    expect(shapeOf(intruder, "user:999")).to.deep.equal(existing);
    getRealtimeHub().publishToUser("42", { secret: true });
    expect(intruder.messages("user:42")).to.deep.equal([]);
  });

  it("un anonyme qui demande user:null est refusé", async () => {
    const anon = await tab(null);
    await anon.subscribe("user:null");
    expect(shapeOf(anon, "user:null")?.reason).to.equal("forbidden");
  });

  it("sans module de sécurité, la règle tient encore : allow ne fait que retirer", async () => {
    const intruder = await tab("43", false);
    await intruder.subscribe("user:42");
    expect(shapeOf(intruder, "user:42")?.reason).to.equal("forbidden");
    await intruder.subscribe("user:43");
    expect(intruder.denials().map((d) => d.channel)).to.deep.equal(["user:42"]);
  });

  it("jamais d'abonnement d'office : connecté sans onUser, aucun canal user: ouvert", async () => {
    await tab("42");
    await tab("43");
    const channels = getRealtimeHub()
      .probe()
      .channels.map((c) => c.channel);
    expect(channels.filter((c) => c.startsWith("user:"))).to.deep.equal([]);
  });

  it("une politique de l'APPLICATION sur user:… l'emporte sur la règle intégrée", () => {
    const hub = new RealtimeHub();
    const open = (): boolean => true;
    hub.registerChannelPolicy("user:public", {
      authenticated: false,
      allow: open,
    });
    expect(hub.resolveChannelAdmission("user:public")?.allow).to.equal(open);
    expect(hub.resolveChannelAdmission("user:42")?.allow).not.to.equal(open);
    expect(hub.resolveChannelPolicy("user:42")?.authenticated).to.equal(true);
  });
});

/**
 * Bus en mémoire entre deux hubs — le même fil que deux pods reliés par Redis,
 * sans infrastructure : chaque publication est rendue à l'AUTRE extrémité.
 */
function busPair(): [IBackplane, IBackplane] {
  const handlers: Array<BackplaneHandler | null> = [null, null];
  const end = (me: 0 | 1): IBackplane => ({
    originId: `pod-${me}`,
    start: () => {},
    stop: () => {},
    publish: (channel, payload) =>
      handlers[me === 0 ? 1 : 0]?.({
        channel,
        payload,
        originId: `pod-${me}`,
      }),
    onMessage: (h) => {
      handlers[me] = h;
    },
    describe: (): IBackplaneInfo => ({
      driver: "test-bus",
      kind: "memory",
      originId: `pod-${me}`,
      crossPod: true,
    }),
  });
  return [end(0), end(1)];
}

describe("#710 — entre deux serveurs, et ce que la sonde en dit", () => {
  it("Bob sur B reçoit le message publié depuis A, SANS aucune déclaration de l'application", () => {
    const a = new RealtimeHub();
    const b = new RealtimeHub();
    const [busA, busB] = busPair();
    a.setBackplane(busA);
    b.setBackplane(busB);
    const received: unknown[] = [];
    // L'onglet de Bob, tel que le contrôleur l'inscrit sur son pod (B).
    b.subscribe(
      "user:bob",
      (p) => received.push(p),
      () => null,
    );

    a.publishToUser("bob", { from: "alice", text: "coucou" });

    expect(received).to.deep.equal([{ from: "alice", text: "coucou" }]);
    expect(b.probe().ingressRejectedTotal).to.equal(0);
  });

  it("localOnlyTotal monte sur un canal non diffusable QUAND un bus est branché, jamais sans", () => {
    const alone = new RealtimeHub();
    alone.publish("room:1", { n: 1 });
    expect(alone.probe().localOnlyTotal).to.equal(0);

    const hub = new RealtimeHub();
    hub.setBackplane(busPair()[0]);
    hub.publish("room:1", { n: 1 });
    hub.publish("room:1", { n: 2 });
    hub.publishToUser("42", { n: 3 }); // diffusé : ne compte pas
    expect(hub.probe().localOnlyTotal).to.equal(2);
  });

  it("le bus branché déclare user: diffusable — la ligne de démarrage le liste", () => {
    const hub = new RealtimeHub();
    expect(hub.broadcastPrefixes()).to.deep.equal([]);
    hub.setBackplane(busPair()[0]);
    expect(hub.broadcastPrefixes()).to.deep.equal(["user:"]);
  });
});
