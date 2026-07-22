import { describe, it, expect, beforeEach } from "vitest";
import "reflect-metadata";
import { Container, Event, RequestContext } from "nodefony";
import type { Module } from "nodefony";
import type { IUser } from "@nodefony/user";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import { RealtimeService } from "../../src/service/RealtimeService.js";
import { defineRealtimeConfig } from "../../config/defineModuleConfig.js";
import { RealtimeChannel } from "../../decorators/realtimeDecorators.js";
import type { ContextType } from "@nodefony/http";
import type { RealtimePublish } from "../../interfaces/IRealtimeController.js";
// Le VRAI Firewall de @nodefony/security (source) — c'est SON `#wireRealtime` qui
// câble le hub. AUCUN frameAuthorizer posé à la main : on prouve la chaîne RÉELLE
// firewall → hub → client. security ⊥ realtime au runtime ; un TEST relie les deux.
import { Firewall } from "../../../../security/index.js";
import { RealtimeClient } from "../../../../../../nodefony/src/client/realtime/RealtimeClient.js";
import {
  TransportState,
  type IRealtimeTransport,
} from "../../../../../../nodefony/src/realtime/IRealtimeTransport.js";

/**
 * E2E « câblage sécurité COMPLET » — le test le plus probant de la pile :
 *
 *   VRAI Firewall (@nodefony/security) boote avec une vraie config (zones +
 *   roleHierarchy + realtimeChannels) → `#wireRealtime` câble le hub realtime
 *   (`useAuthenticator(SessionRealtimeAuthenticator)` + `setFrameAuthorizer`)
 *   → VRAI RealtimeController résout l'identité au handshake VIA L'ALS (comme le
 *   HttpKernel en prod) → VRAI RealtimeClient observe la décision.
 *
 * Rien n'est mocké du côté décision : ni le verrou, ni la hiérarchie de rôles, ni
 * le câblage. On pose seulement l'`IUser` dans l'ALS au handshake (ce que fait le
 * pipeline HTTP réel) et on regarde QUI peut s'abonner À QUOI.
 *
 * ⚠️ Les méthodes de canal NE doivent PAS s'appeler `syslog`/`log`/… : `Service`
 * pose des propriétés d'instance (`this.syslog`, le logger) qui SHADOWENT une
 * méthode homonyme → le décorateur lirait l'objet logger au lieu de la fonction.
 */

const OPEN = 1;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

class Wire {
  feedServer: ((raw: string | null) => void) | null = null;
  pumpClient: ((raw: string) => void) | null = null;
  open = true;
  toClient(raw: string): void {
    queueMicrotask(() => this.pumpClient?.(raw));
  }
  toServer(raw: string): void {
    queueMicrotask(() => this.feedServer?.(raw));
  }
}

// Transport SANS handshake auto : on déclenche le handshake serveur nous-mêmes,
// DANS la bulle `RequestContext.run({ user })` (sinon l'ALS serait vide au moment
// où le SessionRealtimeAuthenticator lit l'identité).
class ManualTransport implements IRealtimeTransport {
  readyState: number = TransportState.CONNECTING;
  private _onOpen: (() => void) | null = null;
  constructor(private readonly wire: Wire) {}
  connect(): void {
    this.readyState = TransportState.OPEN;
    queueMicrotask(() => this._onOpen?.());
  }
  send(raw: string): void {
    if (this.readyState === TransportState.OPEN) this.wire.toServer(raw);
  }
  close(): void {
    this.readyState = TransportState.CLOSED;
  }
  onOpen(cb: () => void): void {
    this._onOpen = cb;
  }
  onMessage(cb: (raw: string) => void): void {
    this.wire.pumpClient = cb;
  }
  onClose(): void {
    /* noop pour ce banc */
  }
  onError(): void {
    /* noop */
  }
}

/** Controller réel : canal système (syslog), config (billing), métier (team), libre (chat). */
class WiredRt extends RealtimeController {
  constructor(ctx: ContextType) {
    super("wired-rt", ctx);
  }
  @RealtimeChannel("nodefony:syslog")
  onSyslog(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { ok: true, channel });
    return () => {};
  }
  @RealtimeChannel("billing:invoices")
  onBilling(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { ok: true, channel });
    return () => {};
  }
  @RealtimeChannel("team:feed", { roles: ["ROLE_USER"] })
  onTeam(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { ok: true, channel });
    return () => {};
  }
  @RealtimeChannel("chat:public")
  onChat(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { ok: true, channel });
    return () => {};
  }
  feed(raw: string | null): void {
    this.handleRealtime(raw);
  }
}

// IUser de test (le vrai contrat consommé par UserRealtimeToken/SessionRealtime…).
const mkUser = (identifier: string, roles: string[]): IUser => ({
  id: "00000000-0000-4000-8000-000000000abc",
  identifier,
  roles,
  hasRole: (r: string) => roles.includes(r),
  isActive: () => true,
  isLocked: () => false,
});

const ADMIN = mkUser("boss", ["ROLE_ADMIN"]);
const USER = mkUser("alice", ["ROLE_USER"]);

/**
 * Boote le VRAI Firewall sur un container partagé avec le VRAI RealtimeService,
 * et déclenche `#wireRealtime` (câblage hub = singleton, partagé avec le controller).
 */
async function bootSecurity(
  fwOptions?: Record<string, unknown>,
): Promise<void> {
  const container = new Container();
  const nc = new Event({}, null, {});
  const svcModule = {
    container,
    notificationsCenter: nc,
    options: defineRealtimeConfig(),
    // Le service lit sa config via `this.module.config` (miroir prod).
    config: defineRealtimeConfig(),
  } as unknown as Module;
  const svc = new RealtimeService(svcModule);
  await svc.init(svcModule);
  container.set("realtimeService", svc);
  // Mock kernel : `once(event, cb)` enregistre le hook. On garde TOUS les events
  // (contrat réel du kernel, pas seulement `onBoot`) dans une Map — le `let` narrowé
  // à `null` par le flow-analysis ne survivait pas à l'affectation en closure.
  const kernelHooks = new Map<string, () => void>();
  container.set("kernel", {
    container,
    once: (event: string, cb: () => void) => {
      kernelHooks.set(event, cb);
    },
  });
  new Firewall({
    container,
    notificationsCenter: nc,
    options: fwOptions ?? {
      roleHierarchy: { ROLE_ADMIN: ["ROLE_USER"] },
      areas: {
        "rt-zone": {
          pattern: "^/realtime",
          authenticators: ["session"],
          realtime: true,
        },
      },
      realtimeChannels: [{ pattern: "billing:", roles: ["ROLE_ADMIN"] }],
    },
  } as unknown as Module);
  kernelHooks.get("onBoot")?.(); // #build → #wireRealtime → câble le hub singleton
}

function makeServer(wire: Wire): WiredRt {
  const conn = {
    get readyState() {
      return wire.open ? OPEN : TransportState.CLOSED;
    },
    send: (raw: string, cb?: (err?: Error) => void) => {
      wire.toClient(raw);
      cb?.();
    },
    close: () => {
      wire.open = false;
    },
  };
  const ctx = {
    connection: conn,
    once: () => {},
    request: { headers: { host: "localhost" }, url: "/realtime" },
    cookies: {},
    url: "/realtime",
    remoteAddress: "127.0.0.1",
    origin: "",
  };
  const rt = new WiredRt(ctx as unknown as ContextType);
  wire.feedServer = (raw) => rt.feed(raw);
  return rt;
}

/**
 * Monte un client + déclenche le handshake serveur DANS la bulle ALS de `user`
 * (`null` = anonyme : ALS vide → SessionRealtimeAuthenticator ne supporte pas →
 * ANONYMOUS_REALTIME_TOKEN, comme un vrai visiteur non loggué).
 */
async function connectAs(user: IUser | null): Promise<RealtimeClient> {
  const wire = new Wire();
  const rt = makeServer(wire);
  const transport = new ManualTransport(wire);
  const client = new RealtimeClient(
    { url: "ws://loopback/realtime", autoReconnect: false },
    () => transport,
  );
  await client.connect(); // branche pumpClient, transport OPEN (PAS de handshake)
  await flush();
  // Handshake DANS l'ALS (ce que fait HttpKernel.handleWebsocket en prod).
  await RequestContext.run(
    { requestId: "t-ws", user: user ?? undefined },
    async () => {
      rt.feed(null);
      await flush();
      await flush();
    },
  );
  return client;
}

async function trySubscribe(
  client: RealtimeClient,
  channel: string,
): Promise<{ ticks: unknown[]; denied: Array<{ channel: string }> }> {
  const ticks: unknown[] = [];
  const denied: Array<{ channel: string; reason: string }> = [];
  client.on(channel, (p) => ticks.push(p));
  client.onDenied((d) => denied.push(d));
  client.subscribe(channel);
  await flush();
  await flush();
  return { ticks, denied };
}

describe("E2E câblage firewall → realtime (chaîne sécu RÉELLE, 0 mock de décision)", () => {
  beforeEach(async () => {
    getRealtimeHub().clear();
    await bootSecurity();
  });

  it("welcome : identité ADMIN résolue par le VRAI authenticator (ALS → token)", async () => {
    const client = await connectAs(ADMIN);
    expect(client.identity?.authenticated).to.equal(true);
    expect(client.identity?.userIdentifier).to.equal("boss");
    expect(client.identity?.roles).to.deep.equal(["ROLE_ADMIN"]);
    client.disconnect();
  });

  it("anonyme (ALS vide) → identité anonyme (Zero Trust fallback)", async () => {
    const client = await connectAs(null);
    expect(client.identity?.authenticated).to.equal(false);
    client.disconnect();
  });

  it("nodefony:syslog (système ROLE_ADMIN) : ADMIN abonné, USER refusé, ANON refusé", async () => {
    const admin = await connectAs(ADMIN);
    const a = await trySubscribe(admin, "nodefony:syslog");
    expect(a.ticks).to.deep.equal([{ ok: true, channel: "nodefony:syslog" }]);
    expect(a.denied).to.have.length(0);
    admin.disconnect();

    const user = await connectAs(USER);
    const u = await trySubscribe(user, "nodefony:syslog");
    expect(u.ticks).to.have.length(0);
    expect(u.denied.map((d) => d.channel)).to.deep.equal(["nodefony:syslog"]);
    user.disconnect();

    const anon = await connectAs(null);
    const n = await trySubscribe(anon, "nodefony:syslog");
    expect(n.ticks).to.have.length(0);
    expect(n.denied.map((d) => d.channel)).to.deep.equal(["nodefony:syslog"]);
    anon.disconnect();
  });

  it("billing: (durci par realtimeChannels config) : ADMIN OK, USER refusé", async () => {
    const admin = await connectAs(ADMIN);
    const a = await trySubscribe(admin, "billing:invoices");
    expect(a.ticks).to.have.length(1);
    admin.disconnect();

    const user = await connectAs(USER);
    const u = await trySubscribe(user, "billing:invoices");
    expect(u.denied.map((d) => d.channel)).to.deep.equal(["billing:invoices"]);
    user.disconnect();
  });

  it("team:feed (@RealtimeChannel ROLE_USER) : USER OK, ADMIN OK (hiérarchie ⊇)", async () => {
    // ADMIN en 1ᵉʳ → crée le provider (tick immédiat) : prouve l'accès via
    // ROLE_ADMIN ⊇ ROLE_USER. USER ensuite rejoint le provider PARTAGÉ (hub
    // singleton) → pas de nouveau tick immédiat, mais ZÉRO refus = autorisé.
    const admin = await connectAs(ADMIN);
    const a = await trySubscribe(admin, "team:feed");
    expect(a.ticks).to.have.length(1);
    expect(a.denied).to.have.length(0);
    admin.disconnect();

    const user = await connectAs(USER);
    const u = await trySubscribe(user, "team:feed");
    expect(u.denied).to.have.length(0); // ROLE_USER autorisé (pas de refus)
    user.disconnect();
  });

  it("chat:public (libre) : même un ANONYME s'abonne (canal applicatif public)", async () => {
    const anon = await connectAs(null);
    const n = await trySubscribe(anon, "chat:public");
    expect(n.ticks).to.deep.equal([{ ok: true, channel: "chat:public" }]);
    expect(n.denied).to.have.length(0);
    anon.disconnect();
  });

  it("refus ISOLÉ : un USER refusé sur syslog: garde l'accès aux canaux libres", async () => {
    const user = await connectAs(USER);
    const denied = await trySubscribe(user, "nodefony:syslog");
    expect(denied.denied).to.have.length(1);
    // La connexion vit : le canal libre fonctionne malgré le refus précédent.
    const ok = await trySubscribe(user, "chat:public");
    expect(ok.ticks).to.have.length(1);
    user.disconnect();
  });
});

describe("F82 — plancher système SANS zone realtime qualifiante (fail-closed)", () => {
  // security chargé MAIS aucune zone (`areas: {}`) → dans `#wireRealtime`, `wired`
  // reste false. Avant le correctif, `setFrameAuthorizer` n'était appelé QUE dans la
  // branche `wired` → aucun verrou posé → `runAuthorizer` renvoyait `true` pour TOUTE
  // frame → les canaux d'introspection système (`syslog:`, `nodefony:audit`, `orm:`…)
  // étaient servis à l'anonyme (F82). Le plancher système ne dépend pas des zones : il
  // doit être armé dès que le hub existe. Les authenticators de session restent, eux,
  // par zone (sans zone = personne n'est authentifié = canaux système fermés à tous).
  beforeEach(async () => {
    getRealtimeHub().clear();
    await bootSecurity({
      roleHierarchy: { ROLE_ADMIN: ["ROLE_USER"] },
      areas: {},
    });
  });

  it("nodefony:syslog refusé à l'anonyme même sans zone (plancher système armé)", async () => {
    const anon = await connectAs(null);
    const r = await trySubscribe(anon, "nodefony:syslog");
    expect(r.ticks).to.have.length(0);
    expect(r.denied.some((d) => d.channel === "nodefony:syslog")).to.equal(
      true,
    );
    anon.disconnect();
  });

  it("chat:public reste ouvert à l'anonyme (pas de sur-fermeture des canaux libres)", async () => {
    const anon = await connectAs(null);
    const r = await trySubscribe(anon, "chat:public");
    expect(r.ticks).to.deep.equal([{ ok: true, channel: "chat:public" }]);
    expect(r.denied).to.have.length(0);
    anon.disconnect();
  });
});
