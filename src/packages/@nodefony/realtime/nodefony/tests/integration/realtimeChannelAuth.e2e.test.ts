import { describe, it, expect, beforeEach } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import {
  RealtimeAction,
  RealtimeChannel,
  RealtimeInbound,
} from "../../decorators/realtimeDecorators.js";
import type { ContextType } from "@nodefony/http";
// Depuis `nodefony`, comme le contrôleur : l'ALS n'est pas un singleton global,
// un import du cœur EN SOURCE en ouvrirait un second que le contrôleur ne lit pas.
import {
  RequestContext,
  type ChannelAllowFunction,
  type ISubscriberIdentity,
  type RequestContextPayload,
} from "nodefony";
import type {
  RealtimeInboundHandler,
  RealtimePublish,
} from "../../interfaces/IRealtimeController.js";
import { ANONYMOUS_REALTIME_TOKEN } from "../../src/server/AnonymousRealtimeToken.js";
import type { IRealtimeWelcome } from "../../../../../../nodefony/src/realtime/RealtimeEventMap.js";
import type { IRealtimeAuthenticator } from "../../interfaces/IRealtimeAuthenticator.js";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken.js";
// Le VRAI verrou d'autorisation de @nodefony/security, importé EN SOURCE (comme le
// banc loopback importe le client core en source). security ⊥ realtime au RUNTIME
// (aucun import dans le code du package) ; un TEST, lui, a le droit de relier les
// deux pour prouver la jonction réelle — c'est tout l'intérêt d'un E2E.
import {
  buildFrameAuthorizer,
  DEFAULT_SYSTEM_RULES,
  type IFrameAuthorizerFirewall,
} from "../../../../security/nodefony/src/realtime/frameAuthorizer.js";
// VRAI client navigateur (core isomorphe), en source.
import { NodefonySocket } from "../../../../../../nodefony/src/client/realtime/NodefonySocket.js";
import {
  TransportState,
  type IRealtimeTransport,
} from "../../../../../../nodefony/src/realtime/IRealtimeTransport.js";

/**
 * MATRICE E2E « protection des canaux » — VRAI {@link NodefonySocket} ↔ VRAI
 * {@link RealtimeController} reliés par un câble loopback in-process, avec le VRAI
 * verrou de frame de `@nodefony/security` ({@link buildFrameAuthorizer}) posé sur
 * le hub. On exerce la décision RBAC sur CHAQUE combinaison identité × canal :
 *
 *   - identités : anonyme, user (ROLE_USER), admin (ROLE_ADMIN), service (scope).
 *   - canaux    : libre, authentifié, ROLE_USER, ROLE_ADMIN, scope, système (syslog).
 *
 * Pour chaque cellule on vérifie le COMPORTEMENT OBSERVABLE, pas un booléen interne :
 *   - autorisé → le provider démarre, le client reçoit le 1ᵉʳ tick, AUCUN refus.
 *   - refusé   → aucun tick (canal jamais abonné), le client reçoit `realtime:denied`.
 *
 * Les unit (`realtimeFrameLock`) prouvent la LOGIQUE du verrou ; ce banc prouve la
 * JONCTION : hub → `beforeDispatch` → décision → (drop + denied | dispatch).
 */

const OPEN = 1;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

class LoopbackWire {
  feedServer: ((raw: string | null) => void) | null = null;
  pumpClient: ((raw: string) => void) | null = null;
  closeClient: ((code: number, reason: string) => void) | null = null;
  serverConnOpen = true;
  deliverToClient(raw: string): void {
    queueMicrotask(() => this.pumpClient?.(raw));
  }
  deliverToServer(raw: string): void {
    queueMicrotask(() => this.feedServer?.(raw));
  }
}

class LoopbackClientTransport implements IRealtimeTransport {
  readyState: number = TransportState.CONNECTING;
  private _onOpen: (() => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;
  constructor(private readonly wire: LoopbackWire) {}
  connect(): void {
    this.readyState = TransportState.OPEN;
    queueMicrotask(() => {
      this._onOpen?.();
      this.wire.feedServer?.(null); // handshake serveur
    });
  }
  send(raw: string): void {
    if (this.readyState !== TransportState.OPEN) return;
    this.wire.deliverToServer(raw);
  }
  close(code = 1000, reason = ""): void {
    this.readyState = TransportState.CLOSED;
    this._onClose?.(code, reason);
  }
  onOpen(cb: () => void): void {
    this._onOpen = cb;
  }
  onMessage(cb: (raw: string) => void): void {
    this.wire.pumpClient = cb;
  }
  onClose(cb: (code: number, reason: string) => void): void {
    this._onClose = cb;
    this.wire.closeClient = cb;
  }
  onError(): void {
    /* erreurs surfacées par close */
  }
}

/**
 * Controller de test : un canal par classe de protection, chacun déclaré via
 * `@RealtimeChannel` (la policy métier voyage jusqu'au verrou). Chaque provider
 * pousse un tick immédiat à l'abonnement → preuve OBSERVABLE de l'abonnement.
 * `nodefony:syslog` n'a PAS de policy métier : c'est le PLANCHER système (ROLE_ADMIN)
 * du verrou qui le garde — on prouve qu'un canal réservé est protégé sans rien déclarer.
 */
class AuthRt extends RealtimeController {
  constructor(ctx: ContextType) {
    super("auth-rt", ctx);
  }

  @RealtimeChannel("chat:public")
  chatPublic(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { ok: true, channel });
    return () => {};
  }

  @RealtimeChannel("members:area", { authenticated: true })
  membersArea(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { ok: true, channel });
    return () => {};
  }

  @RealtimeChannel("team:feed", { roles: ["ROLE_USER"] })
  teamFeed(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { ok: true, channel });
    return () => {};
  }

  @RealtimeChannel("admin:metrics", { roles: ["ROLE_ADMIN"] })
  adminMetrics(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { ok: true, channel });
    return () => {};
  }

  @RealtimeChannel("api:flux", { scopes: ["metrics:read"] })
  apiFlux(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { ok: true, channel });
    return () => {};
  }

  @RealtimeChannel("nodefony:syslog")
  syslogStream(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { ok: true, channel });
    return () => {};
  }

  // Canal inbound protégé (push client→serveur) : même gating que subscribe.
  @RealtimeInbound("ops:command", { roles: ["ROLE_ADMIN"] })
  opsCommand(params: unknown, reply: (payload: unknown) => void): void {
    reply({ executed: true, params });
  }

  // ── Actions RPC : fermées par défaut ────────────────────────────────────
  // `orders:quote` ne déclare RIEN. Avant, une action sans politique n'était
  // couverte par aucune règle et le verrou la laissait passer : un anonyme
  // pouvait l'appeler. Elle doit désormais exiger une connexion authentifiée
  // SANS que son auteur ait eu à y penser.
  @RealtimeAction("orders:quote")
  ordersQuote(): { quoted: true } {
    return { quoted: true };
  }

  // Ouverture explicite : le seul moyen de rendre une action publique est de
  // l'écrire. Prouve que le défaut est un DÉFAUT, pas un verrou inconditionnel.
  @RealtimeAction("catalog:browse", { authenticated: false })
  catalogBrowse(): { ok: true } {
    return { ok: true };
  }

  // L'AUTRE voie de déclaration : l'override, qui n'a aucun endroit où écrire
  // une politique. Elle doit hériter du même défaut fermé que le décorateur —
  // sinon fermer `@RealtimeAction` ne ferait que déplacer la porte ouverte.
  protected override realtimeActions(): Record<
    string,
    (params: unknown) => unknown
  > {
    return { "legacy:run": () => ({ ran: true }) };
  }

  feed(raw: string | null): void {
    this.handleRealtime(raw);
  }
}

/** Ce que `makeServer` sait monter : un contrôleur qu'on nourrit de trames brutes. */
interface IFeedableRt extends RealtimeController {
  feed(raw: string | null): void;
}
type FeedableRtClass = new (ctx: ContextType) => IFeedableRt;

function makeServer(
  wire: LoopbackWire,
  environment?: string,
  Rt: FeedableRtClass = AuthRt,
  context?: RequestContextPayload,
): IFeedableRt {
  const conn = {
    get readyState() {
      return wire.serverConnOpen ? OPEN : TransportState.CLOSED;
    },
    send: (raw: string, cb?: (err?: Error) => void) => {
      wire.deliverToClient(raw);
      cb?.();
    },
    close: (code?: number, reason?: string) => {
      wire.serverConnOpen = false;
      queueMicrotask(() => wire.closeClient?.(code ?? 1000, reason ?? ""));
    },
  };
  const ctx = {
    type: "websocket",
    connection: conn,
    once: () => {},
    request: { headers: {}, url: "/realtime" },
    cookies: {},
    url: "/realtime",
    remoteAddress: "127.0.0.1",
    origin: "",
  };
  const rt = new Rt(ctx as unknown as ContextType);
  // Le mode d'exécution du kernel décide si un refus dit POURQUOI. Les autres
  // scénarios de ce fichier montent le contrôleur sans kernel : `environment`
  // y vaut `undefined`, qui vaut production — leurs refus restent donc nus, et
  // c'est ce qu'ils vérifient déjà.
  if (environment !== undefined) {
    // `modules` vide comme un vrai Kernel (jamais absent) : ce décor n'a aucun
    // module d'identité, c'est ce que le refus doit constater.
    rt.kernel = { environment, modules: {} } as unknown as typeof rt.kernel;
  }
  // Comme `WebsocketContext`, qui lie son écouteur au contexte de la poignée de
  // main : chaque trame est traitée SOUS ce contexte — c'est ce qui rend
  // observable un `allow` qui le lirait au lieu de ses arguments.
  wire.feedServer =
    context === undefined
      ? (raw) => rt.feed(raw)
      : (raw) => RequestContext.run(context, () => rt.feed(raw));
  return rt;
}

// ── Identités de test ──────────────────────────────────────────────────────
const mkToken = (
  type: string,
  authenticated: boolean,
  roles: string[],
  scopes: string[],
): IRealtimeToken => ({
  type,
  getUserIdentifier: () => type,
  isAuthenticated: () => authenticated,
  getRoles: () => roles,
  getScopes: () => scopes,
  getAttribute: () => undefined,
});

const TOKENS = {
  anon: mkToken("anonymous", false, ["ROLE_ANONYMOUS"], []),
  user: mkToken("session", true, ["ROLE_USER"], []),
  // Les DEUX échelles, comme la fixture réelle du dépôt : les canaux du
  // PROCESSUS (syslog, orm, cluster…) exigent la PLATEFORME, pas
  // l'organisation — un `ROLE_ADMIN` seul ne doit pas les obtenir.
  admin: mkToken("session", true, ["ROLE_NODEFONY_ADMIN", "ROLE_ADMIN"], []),
  service: mkToken("jwt", true, ["ROLE_USER"], ["metrics:read"]),
} as const;

// Firewall factice : pas de zone HTTP (api.request non testé ici), hiérarchie
// ROLE_ADMIN ⊇ ROLE_USER (le RoleHierarchyWalker réel fait ça au boot).
const hasRole = (roles: readonly string[], required: string): boolean =>
  roles.includes(required) ||
  (required === "ROLE_USER" && roles.includes("ROLE_ADMIN"));
const firewall: IFrameAuthorizerFirewall = {
  matchPath: () => null,
  hasRole,
};

// Authenticator de test : renvoie le token courant du scénario (configuré avant
// le handshake). Le controller le pose sur le peer → le verrou le lit en O(1).
let currentToken: IRealtimeToken = TOKENS.anon;
const testAuth: IRealtimeAuthenticator = {
  name: "matrix-auth",
  supports: () => true,
  authenticate: async () => currentToken,
};

/** Une trame descendante telle que le SERVEUR l'a émise, capturée sur le câble. */
interface IWireFrame {
  method?: string;
  params?: unknown;
}

/**
 * Configure le hub (token + verrou) AVANT le handshake, puis connecte un pair.
 *
 * Rend AUSSI la frame `realtime:welcome` telle que le SERVEUR l'a émise : le
 * client n'en garde qu'une partie (le mode d'exécution part dans un module
 * global, jamais sur une propriété), et vérifier ce que le serveur PROMET est
 * plus fort que vérifier ce que le client a bien voulu en retenir.
 */
async function connectAs(
  token: IRealtimeToken,
  environment?: string,
  opts: { Rt?: FeedableRtClass; context?: RequestContextPayload } = {},
): Promise<{
  client: NodefonySocket;
  welcome: Partial<IRealtimeWelcome>;
  server: IFeedableRt;
  frames: IWireFrame[];
}> {
  const hub = getRealtimeHub();
  hub.clear();
  currentToken = token;
  hub.useAuthenticator({ pattern: /.*/ }, testAuth);
  hub.setFrameAuthorizer(
    buildFrameAuthorizer(firewall, {
      channelResolver: hub,
      systemRules: DEFAULT_SYSTEM_RULES,
    }),
    {
      // La sonde MUETTE, posée comme `@nodefony/security` la pose : même
      // fabrique, mêmes arguments, sans rapporteur d'audit. C'est elle que le
      // `realtime:welcome` interroge pour n'annoncer que l'obtenable — sans
      // elle, l'annonce reste entière et le banc du welcome ci-dessous tombe.
      silentProbe: buildFrameAuthorizer(firewall, {
        channelResolver: hub,
        systemRules: DEFAULT_SYSTEM_RULES,
      }),
    },
  );
  const wire = new LoopbackWire();
  // Écoute du câble AVANT le handshake : le welcome est la toute première frame
  // descendante, l'installer après la connexion la manquerait.
  let welcome: Partial<IRealtimeWelcome> = {};
  const frames: IWireFrame[] = [];
  const deliver = wire.deliverToClient.bind(wire);
  wire.deliverToClient = (raw: string): void => {
    try {
      const f = JSON.parse(raw) as IWireFrame;
      frames.push(f);
      if (f.method === "realtime:welcome") welcome = f.params ?? {};
    } catch {
      /* frame illisible : le banc du protocole s'en occupe, pas celui-ci */
    }
    deliver(raw);
  };
  const server = makeServer(wire, environment, opts.Rt, opts.context);
  const transport = new LoopbackClientTransport(wire);
  const client = new NodefonySocket(
    { url: "ws://loopback/realtime", autoReconnect: false },
    () => transport,
  );
  await client.connect();
  await flush();
  await flush();
  return { client, welcome, server, frames };
}

// ── La matrice : canal × prédicat d'autorisation attendu ──────────────────
interface ChannelCase {
  readonly channel: string;
  readonly kind: string;
  readonly allow: (t: IRealtimeToken) => boolean;
}
const CHANNELS: readonly ChannelCase[] = [
  { channel: "chat:public", kind: "libre", allow: () => true },
  {
    channel: "members:area",
    kind: "authentifié",
    allow: (t) => t.isAuthenticated(),
  },
  {
    channel: "team:feed",
    kind: "ROLE_USER",
    allow: (t) => hasRole(t.getRoles(), "ROLE_USER"),
  },
  {
    channel: "admin:metrics",
    kind: "ROLE_ADMIN",
    allow: (t) => hasRole(t.getRoles(), "ROLE_ADMIN"),
  },
  {
    channel: "api:flux",
    kind: "scope",
    allow: (t) => t.getScopes().includes("metrics:read"),
  },
  {
    channel: "nodefony:syslog",
    kind: "système(ROLE_ADMIN)",
    allow: (t) => hasRole(t.getRoles(), "ROLE_ADMIN"),
  },
];

describe("MATRICE E2E — protection des canaux (subscribe × identité)", () => {
  beforeEach(() => getRealtimeHub().clear());

  for (const [tokenName, token] of Object.entries(TOKENS)) {
    for (const c of CHANNELS) {
      const expected = c.allow(token);
      const verdict = expected ? "ABONNÉ" : "REFUSÉ";
      it(`${tokenName} × ${c.channel} (${c.kind}) → ${verdict}`, async () => {
        const { client } = await connectAs(token);
        const ticks: unknown[] = [];
        const denials: Array<{ channel: string; reason: string }> = [];
        client.on(c.channel, (p) => ticks.push(p));
        client.onDenied((d) => denials.push(d));
        client.subscribe(c.channel);
        await flush();
        await flush();
        if (expected) {
          expect(ticks, "tick attendu (abonné)").to.deep.equal([
            { ok: true, channel: c.channel },
          ]);
          expect(denials, "aucun refus attendu").to.have.length(0);
        } else {
          expect(ticks, "aucun tick (non abonné)").to.have.length(0);
          expect(denials, "refus observable attendu").to.deep.equal([
            { channel: c.channel, reason: "forbidden" },
          ]);
        }
        client.disconnect();
      });
    }
  }
});

describe("MATRICE E2E — canal inbound protégé (push client→serveur)", () => {
  beforeEach(() => getRealtimeHub().clear());

  it("user pousse sur ops:command (ROLE_ADMIN) → REFUSÉ (denied, pas de reply)", async () => {
    const { client } = await connectAs(TOKENS.user);
    const replies: unknown[] = [];
    const denials: Array<{ channel: string; reason: string }> = [];
    client.on("ops:command", (p) => replies.push(p));
    client.onDenied((d) => denials.push(d));
    client.emit("ops:command", { do: "x" });
    await flush();
    await flush();
    expect(replies, "pas de reply (frame droppée)").to.have.length(0);
    expect(denials).to.deep.equal([
      { channel: "ops:command", reason: "forbidden" },
    ]);
    client.disconnect();
  });

  it("admin pousse sur ops:command → AUTORISÉ (reply reçu, aucun refus)", async () => {
    const { client } = await connectAs(TOKENS.admin);
    const replies: unknown[] = [];
    const denials: unknown[] = [];
    client.on("ops:command", (p) => replies.push(p));
    client.onDenied((d) => denials.push(d));
    client.emit("ops:command", { do: "x" });
    await flush();
    await flush();
    expect(replies).to.deep.equal([{ executed: true, params: { do: "x" } }]);
    expect(denials).to.have.length(0);
    client.disconnect();
  });
});

describe("MATRICE E2E — actions RPC fermées par défaut", () => {
  beforeEach(() => getRealtimeHub().clear());

  it("anonyme × orders:quote (aucune politique déclarée) → REFUSÉ", async () => {
    // Le cœur de la correction : l'auteur n'a RIEN écrit, et pourtant l'action
    // n'est pas ouverte à un inconnu. Avant, le verrou laissait passer tout ce
    // qu'aucune politique ne couvrait — une action applicative était publique.
    const { client } = await connectAs(TOKENS.anon);
    const denials: Array<{ channel: string; reason: string }> = [];
    client.onDenied((d) => denials.push(d));
    client.emit("orders:quote", {});
    await flush();
    await flush();
    expect(denials).to.deep.equal([
      { channel: "orders:quote", reason: "forbidden" },
    ]);
    client.disconnect();
  });

  it("utilisateur authentifié × orders:quote → AUTORISÉ (le défaut n'exige QUE l'authentification)", async () => {
    // Le défaut ferme la porte à un inconnu, il ne verrouille pas l'application :
    // sans quoi il serait contourné en masse par des politiques permissives.
    const { client } = await connectAs(TOKENS.user);
    const denials: unknown[] = [];
    client.onDenied((d) => denials.push(d));
    client.emit("orders:quote", {});
    await flush();
    await flush();
    expect(denials).to.have.length(0);
    client.disconnect();
  });

  it("anonyme × legacy:run (action déclarée par OVERRIDE, sans politique possible) → REFUSÉ", async () => {
    // L'override `realtimeActions()` ne peut pas porter de politique : le défaut
    // fermé doit donc lui être appliqué par le controller, sinon le trou reste
    // entier pour tout code qui n'utilise pas le décorateur (c'est le cas de
    // Studio, dont `nodefony:scaffold:run` lance un générateur de code).
    const { client } = await connectAs(TOKENS.anon);
    const denials: Array<{ channel: string; reason: string }> = [];
    client.onDenied((d) => denials.push(d));
    client.emit("legacy:run", {});
    await flush();
    await flush();
    expect(denials).to.deep.equal([
      { channel: "legacy:run", reason: "forbidden" },
    ]);
    client.disconnect();
  });

  it("anonyme × catalog:browse (ouverture EXPLICITE) → AUTORISÉ", async () => {
    // Prouve que c'est un DÉFAUT et non un verrou inconditionnel : une action
    // publique reste possible, à condition de l'écrire.
    //
    // ⚠️ Le nom compte : le plancher système capture TOUTE méthode contenant
    // `:health` ou `:stats` (`frameAuthorizer.ts`, `matchSystemPolicy`), quelle
    // que soit la politique déclarée — une action `public:health` reste donc
    // réservée. C'est voulu (namespaces d'observabilité), mais invisible depuis
    // le site de déclaration : d'où ce cas nommé hors de ces suffixes.
    const { client } = await connectAs(TOKENS.anon);
    const denials: unknown[] = [];
    client.onDenied((d) => denials.push(d));
    client.emit("catalog:browse", {});
    await flush();
    await flush();
    expect(denials).to.have.length(0);
    client.disconnect();
  });
});

describe("MATRICE E2E — refus observable (contrat client)", () => {
  beforeEach(() => getRealtimeHub().clear());

  it("un refus émet AUSSI une notice (onNotice) en plus du seam ciblé (onDenied)", async () => {
    const { client } = await connectAs(TOKENS.user);
    const notices: Array<{ level: string; message: string }> = [];
    client.onNotice((n) => notices.push(n));
    client.subscribe("admin:metrics");
    await flush();
    await flush();
    expect(notices).to.have.length(1);
    expect(notices[0]!.level).to.equal("error");
    // Zero Trust : le message ne révèle jamais le rôle/scope manquant.
    expect(notices[0]!.message).to.not.match(/ROLE_|scope/i);
    client.disconnect();
  });

  it("un canal AUTORISÉ ne produit AUCUN refus ni notice", async () => {
    const { client } = await connectAs(TOKENS.user);
    const denials: unknown[] = [];
    const notices: unknown[] = [];
    client.onDenied((d) => denials.push(d));
    client.onNotice((n) => notices.push(n));
    client.subscribe("team:feed"); // ROLE_USER → OK
    await flush();
    await flush();
    expect(denials).to.have.length(0);
    expect(notices).to.have.length(0);
    client.disconnect();
  });

  it("canal LIBRE non déclaré (ni décorateur ni override) → PASSE l'autorisation, puis 'unknown' faute de producteur", async () => {
    // Les deux étapes sont distinctes, et ce cas les sépare : l'AUTORISATION
    // laisse passer (canal applicatif libre — aucune politique ne le couvre),
    // et c'est la RÉSOLUTION qui échoue (`createRealtimeChannel` de base rend
    // `null` : personne ne produit ce nom). Le client l'apprend par un motif
    // distinct de `forbidden`, parce que le geste à faire n'est pas le même :
    // relire le nom du canal, pas demander un droit.
    //
    // Ce cas gravait auparavant le SILENCE (`denials` vide) : un abonnement sans
    // réponse est indiscernable d'un canal calme, et on cherchait le défaut chez
    // le producteur alors qu'il était dans le nom.
    const { client } = await connectAs(TOKENS.user);
    const ticks: unknown[] = [];
    const denials: unknown[] = [];
    client.on("random:unknown", (p) => ticks.push(p));
    client.onDenied((d) => denials.push(d));
    client.subscribe("random:unknown");
    await flush();
    await flush();
    expect(denials).to.deep.equal([
      { channel: "random:unknown", reason: "unknown" },
    ]);
    expect(ticks).to.have.length(0); // aucun provider démarré
    client.disconnect();
  });
});

/**
 * E2E — le DÉTAIL d'un refus traverse le contrôleur, et s'arrête à la production.
 *
 * `deniedDetail` est éprouvée en unitaire dans les deux sens, mais une fonction
 * pure ne prouve pas sa JONCTION : rien ne disait que le contrôleur l'appelle,
 * ni qu'il lui passe le mode du kernel, ni que le détail survit au transport
 * jusqu'au client. La matrice ci-dessus ne pouvait pas le voir — elle monte le
 * contrôleur SANS kernel, donc `environment` y vaut `undefined`, donc le détail
 * est absent par construction et ses trente-trois cas restent verts quoi qu'on
 * fasse ici. C'est exactement la forme d'angle mort qui laisse croire qu'une
 * capacité est couverte.
 */
describe("E2E — le détail d'un refus, de bout en bout", () => {
  beforeEach(() => getRealtimeHub().clear());

  it("en développement : le refus dit POURQUOI, en plus du motif générique", async () => {
    const { client } = await connectAs(TOKENS.anon, "development");
    const denials: Array<{
      channel: string;
      reason: string;
      detail?: string;
    }> = [];
    client.onDenied((d) => denials.push(d));
    client.subscribe("admin:metrics");
    await flush();
    await flush();
    expect(denials, "un refus attendu").to.have.length(1);
    // Le motif reste générique — c'est lui qui interdit l'oracle, et il ne
    // change pas d'un mode à l'autre.
    expect(denials[0]!.reason).to.equal("forbidden");
    // Le détail, lui, nomme ce qu'il faut regarder. On n'assène pas sa
    // formulation exacte (elle se réécrit), mais il doit être là et parler du
    // canal refusé — un détail qui ne nomme pas sa cause ne sert à rien.
    expect(denials[0]!.detail, "le détail est dit en développement").to.be.a(
      "string",
    );
    expect(denials[0]!.detail).to.contain("admin:metrics");
    // …et il dit le GESTE, pas seulement le diagnostic : sans identité à
    // présenter, il n'y a RIEN à vérifier dans les rôles du jeton. Ce décor
    // monte un kernel sans module d'identité — le geste est donc celui-là, et
    // surtout pas une commande que cette application n'a pas.
    expect(
      denials[0]!.detail,
      "le refus dit comment obtenir une identité",
    ).to.contain("identité");
    expect(denials[0]!.detail).to.contain("@nodefony/security");
    client.disconnect();
  });

  it("en production : le refus est le MÊME, sans le détail", async () => {
    const { client } = await connectAs(TOKENS.anon, "production");
    const denials: Array<{
      channel: string;
      reason: string;
      detail?: string;
    }> = [];
    client.onDenied((d) => denials.push(d));
    client.subscribe("admin:metrics");
    await flush();
    await flush();
    expect(denials, "un refus attendu").to.have.length(1);
    expect(denials[0]!.reason).to.equal("forbidden");
    // La même phrase qui aide un développeur renseignerait un attaquant : elle
    // ne franchit pas la production. Une absence vaut production, jamais
    // l'inverse.
    expect(denials[0]!.detail, "aucun détail en production").to.equal(
      undefined,
    );
    client.disconnect();
  });

  it("un canal sans producteur rend `unknown` — et dit quoi vérifier (dev)", async () => {
    // L'autre moitié du refus, et la plus fréquente en développement : le canal
    // n'est pas gardé, il n'existe simplement pas. Le motif le distingue déjà ;
    // le détail donne le geste — orthographe, controller chargé, `dist/` bâti.
    const { client } = await connectAs(TOKENS.admin, "development");
    const denials: Array<{
      channel: string;
      reason: string;
      detail?: string;
    }> = [];
    client.onDenied((d) => denials.push(d));
    client.subscribe("canal:qui:nexiste:pas");
    await flush();
    await flush();
    expect(denials, "un refus attendu").to.have.length(1);
    expect(denials[0]!.reason).to.equal("unknown");
    expect(denials[0]!.detail).to.contain("canal:qui:nexiste:pas");
    client.disconnect();
  });
});

/**
 * MATRICE E2E « ce que le welcome ANNONCE » — la toute PREMIÈRE frame.
 *
 * 🔴 Elle n'était éprouvée dans aucun banc de bout en bout identité par
 * identité, alors qu'elle porte tout ce dont un client se sert pour décider quoi
 * afficher et à quoi s'abonner. La conséquence était mesurable : le welcome
 * annonçait les MÊMES canaux à un anonyme et à un administrateur, quand le
 * produit refuse par ailleurs de dire POURQUOI un canal est refusé
 * (`RealtimeDeniedReason` est générique par construction, pour ne pas devenir un
 * oracle). Il donnait la carte en gardant la serrure.
 *
 * Ce banc vérifie la JONCTION : vrai client ↔ vrai contrôleur ↔ vrai verrou.
 */
describe("MATRICE E2E — ce que le welcome ANNONCE (channels × identité)", () => {
  beforeEach(() => getRealtimeHub().clear());

  for (const [tokenName, token] of Object.entries(TOKENS)) {
    it(`${tokenName} : n'apprend l'existence QUE des canaux qu'il pourrait obtenir`, async () => {
      const { client } = await connectAs(token);
      const obtenables = CHANNELS.filter((c) => c.allow(token))
        .map((c) => c.channel)
        .sort();
      // `serverChannels` est `readonly string[] | null` : le `null` compte, il
      // signifie « aucun welcome reçu » — l'étaler sans le nommer masquerait
      // exactement le cas où le banc ne prouve rien.
      expect(client.serverChannels, "welcome reçu").to.not.equal(null);
      expect([...(client.serverChannels ?? [])].sort()).to.deep.equal(
        obtenables,
      );
    });

    it(`${tokenName} : le bloc identity porte les rôles et scopes de CE jeton`, async () => {
      const { client } = await connectAs(token);
      expect(client.identity?.type).to.equal(token.type);
      expect(client.identity?.authenticated).to.equal(token.isAuthenticated());
      expect(client.identity?.userIdentifier).to.equal(
        token.getUserIdentifier(),
      );
      expect(client.identity?.roles).to.deep.equal(token.getRoles());
      expect(client.identity?.scopes).to.deep.equal(token.getScopes());
    });
  }

  it("un anonyme n'apprend AUCUN nom de canal sensible", async () => {
    const { client } = await connectAs(TOKENS.anon);
    // Nommés un par un, et pas déduits de `CHANNELS` : un cas qui recalcule son
    // attendu avec la même expression que le produit passe quoi qu'il arrive.
    for (const secret of [
      "members:area",
      "team:feed",
      "admin:metrics",
      "api:flux",
      "nodefony:syslog",
    ]) {
      expect(client.serverChannels, secret).to.not.include(secret);
    }
    expect(client.serverChannels).to.include("chat:public");
  });

  it("l'administrateur, lui, les voit — le filtre ne referme pas tout", async () => {
    const { client } = await connectAs(TOKENS.admin);
    expect(client.serverChannels).to.include("admin:metrics");
    expect(client.serverChannels).to.include("nodefony:syslog");
    expect(client.serverChannels).to.not.include("api:flux"); // scope, pas rôle
  });

  it("le mode d'exécution est annoncé hors production, et ABSENT en production", async () => {
    const dev = await connectAs(TOKENS.anon, "development");
    expect(dev.welcome.env).to.equal("development");
    const prod = await connectAs(TOKENS.anon, "production");
    expect(prod.welcome).to.not.have.property("env");
  });

  /**
   * 🔴 Le verrou et la sonde sont DEUX closures — la duplication est rendue
   * inévitable par le rapporteur d'audit, que la sonde ne doit pas tirer. Deux
   * copies d'une même règle divergent au premier ajout, et chacune passe ses
   * propres tests : celle-ci les confronte canal par canal, identité par
   * identité. Si elle tombe, c'est que l'annonce et le refus ne disent plus la
   * même chose — la faute la plus coûteuse possible ici.
   *
   * L'invariant ne vaut QUE pour les politiques SANS `allow` : le welcome ne
   * joue jamais `allow` (il se décide au `subscribe`, canal par canal — banc
   * « admission par l'identité » plus bas). Le test le vérifie au lieu de le
   * supposer : un canal à `allow` glissé dans `CHANNELS` le fait tomber.
   */
  it("la sonde du welcome et le verrou de subscribe rendent le MÊME verdict (politiques sans allow)", async () => {
    // 🔴 Le décor d'abord : `hub.clear()` vide le registre des politiques, qui
    // n'est peuplé qu'au MONTAGE du contrôleur. Sans cette connexion, aucun
    // canal n'a de politique, tout est libre, et la comparaison serait verte
    // pour la mauvaise raison — elle a d'ailleurs commencé par l'être.
    await connectAs(TOKENS.anon);
    const hub = getRealtimeHub();
    for (const c of CHANNELS) {
      expect(
        hub.resolveChannelAdmission(c.channel),
        `${c.channel} : hors du périmètre de l'invariant (allow)`,
      ).to.equal(null);
    }
    const verrou = buildFrameAuthorizer(firewall, {
      channelResolver: hub,
      systemRules: DEFAULT_SYSTEM_RULES,
    });
    for (const [tokenName, token] of Object.entries(TOKENS)) {
      for (const c of CHANNELS) {
        const parLeVerrou = verrou(
          { method: "subscribe", params: { channel: c.channel } },
          token,
        );
        expect(parLeVerrou, `${tokenName} × ${c.channel}`).to.equal(
          c.allow(token),
        );
      }
    }
  });
});

// ── #622 — l'admission par l'IDENTITÉ, de bout en bout ─────────────────────
//
// Le canal personnel `user:<id>` : une politique de MOTIF portant `allow`, que
// le contrôleur déclare comme une application le ferait. Les unitaires
// (`channelAdmissionQueue`, `frameAdmission`) prouvent la mécanique ; ce banc
// prouve la JONCTION avec le vrai client et le vrai verrou de sécurité — et
// chaque verdict se lit sur la TRAME émise, jamais sur ce que le client en a
// retenu (il recopie l'identité champ par champ et masquerait une fuite).

/** Appels d'`allow` depuis le dernier `beforeEach` : la preuve du « une fois ». */
let allowCalls = 0;
/** La règle du canal personnel, telle qu'une application l'écrit (S10 bis). */
const byIdentity: ChannelAllowFunction = (channel, who) =>
  channel === `user:${who.id}`;
/**
 * Une règle FAUTIVE : elle lit le contexte de requête au lieu de ses arguments.
 * Sur la socket elle tombe juste (la trame est traitée sous le contexte de la
 * poignée de main) ; à l'émission d'un webhook il n'y a pas de contexte, et elle
 * refuse tout, sans un mot (S10 bis point 1).
 */
const readsRequestContext: ChannelAllowFunction = (channel) => {
  const user = RequestContext.getUser();
  const id =
    typeof user === "object" && user !== null && "id" in user
      ? String(user.id)
      : null;
  return channel === `user:${id}`;
};
let admissionRule: ChannelAllowFunction = byIdentity;
const countedAllow: ChannelAllowFunction = (channel, who) => {
  allowCalls += 1;
  return admissionRule(channel, who);
};

class AdmitRt extends RealtimeController {
  readonly received: Record<string, number> = {};
  constructor(ctx: ContextType) {
    super("admit-rt", ctx);
  }

  // La politique du MOTIF : le producteur décoré ne sert que le nom exact, les
  // canaux `user:<id>` sont servis par la fabrique dynamique ci-dessous.
  @RealtimeChannel("user:*", { allow: countedAllow })
  userChannels(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { ok: true, channel });
    return () => {};
  }

  // Plus spécifique que le motif, SANS `allow` : elle le remplace en entier.
  @RealtimeChannel("user:public", { authenticated: false })
  userPublic(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { ok: true, channel });
    return () => {};
  }

  override createRealtimeChannel(
    channel: string,
    publish: RealtimePublish,
  ): (() => void) | null {
    if (!channel.startsWith("user:")) return null;
    publish(channel, { ok: true, channel });
    return () => {};
  }

  override realtimeInbound(): Record<string, RealtimeInboundHandler> {
    const count =
      (name: string): RealtimeInboundHandler =>
      () => {
        this.received[name] = (this.received[name] ?? 0) + 1;
      };
    return { "user:42": count("user:42"), "user:43": count("user:43") };
  }

  feed(raw: string | null): void {
    this.handleRealtime(raw);
  }
}

/** Un compte LOCAL : `id` stable, login différent — `allow` doit lire `who.id`. */
const accountToken = (id: string): IRealtimeToken => {
  const who: ISubscriberIdentity = Object.freeze({
    type: "session",
    authenticated: true,
    id,
    userIdentifier: `login-${id}`,
    roles: Object.freeze(["ROLE_USER"]),
    scopes: Object.freeze([]),
    issuer: null,
    account: true,
  });
  return {
    ...mkToken("session", true, ["ROLE_USER"], []),
    getUserIdentifier: () => who.userIdentifier,
    getIdentity: () => who,
  };
};
const ACCOUNTS = { u42: accountToken("42"), u43: accountToken("43") } as const;

const fieldOf = (f: IWireFrame, key: string): unknown =>
  typeof f.params === "object" && f.params !== null && key in f.params
    ? Reflect.get(f.params, key)
    : undefined;
const acksOn = (frames: readonly IWireFrame[]): unknown[] =>
  frames
    .filter((f) => f.method === "realtime:subscribed")
    .map((f) => fieldOf(f, "channel"));
const deniedOn = (frames: readonly IWireFrame[]): unknown[][] =>
  frames
    .filter((f) => f.method === "realtime:denied")
    .map((f) => [fieldOf(f, "channel"), fieldOf(f, "reason")]);

function asAdmitRt(server: IFeedableRt): AdmitRt {
  if (!(server instanceof AdmitRt)) throw new Error("banc : AdmitRt attendu");
  return server;
}

async function subscribeAs(
  token: IRealtimeToken,
  channel: string,
  context?: RequestContextPayload,
) {
  const s = await connectAs(token, undefined, {
    Rt: AdmitRt,
    ...(context === undefined ? {} : { context }),
  });
  const ticks: unknown[] = [];
  s.client.on(channel, (p) => ticks.push(p));
  s.client.subscribe(channel);
  await flush();
  await flush();
  return { ...s, ticks };
}

/** Le contexte que `WebsocketContext` aurait ouvert pour la poignée de main de `id`. */
const handshakeContext = (id: string): RequestContextPayload => ({
  requestId: `handshake-${id}`,
  user: { id },
});

/**
 * Le verdict d'`allow` tel que l'émission d'un webhook le demanderait : la
 * MÊME règle, résolue par le hub, appelée hors de toute connexion et de tout
 * contexte de requête.
 */
async function emissionVerdict(
  channel: string,
  who: ISubscriberIdentity,
): Promise<boolean> {
  expect(RequestContext.get(), "aucun contexte à l'émission").to.equal(
    undefined,
  );
  const rule = getRealtimeHub().resolveChannelAdmission(channel);
  if (rule === null) throw new Error(`banc : aucune règle pour ${channel}`);
  return rule.allow(channel, who);
}

describe("#622 — admission par l'identité de bout en bout (motif user:*)", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    allowCalls = 0;
    admissionRule = byIdentity;
  });

  const MATRIX: ReadonlyArray<{
    readonly label: string;
    readonly token: IRealtimeToken;
    readonly channel: string;
    readonly granted: boolean;
    /** Appels d'`allow` attendus : un refus d'office ne le consulte pas. */
    readonly calls: number;
  }> = [
    {
      label: "42",
      token: ACCOUNTS.u42,
      channel: "user:42",
      granted: true,
      calls: 1,
    },
    {
      label: "43",
      token: ACCOUNTS.u43,
      channel: "user:42",
      granted: false,
      calls: 1,
    },
    // Le login n'est pas l'identifiant : un e-mail change, `id` non.
    {
      label: "42 par son login",
      token: ACCOUNTS.u42,
      channel: "user:login-42",
      granted: false,
      calls: 1,
    },
    // L'anonyme est refusé d'office : la politique ne dit pas `anonymous: true`.
    {
      label: "anonyme",
      token: ANONYMOUS_REALTIME_TOKEN,
      channel: "user:42",
      granted: false,
      calls: 0,
    },
    // Un authentificateur sans `getIdentity` n'entre sur aucun canal à `allow`.
    {
      label: "jeton sans getIdentity",
      token: TOKENS.user,
      channel: "user:42",
      granted: false,
      calls: 0,
    },
  ];

  for (const c of MATRIX) {
    const verdict = c.granted
      ? "realtime:subscribed"
      : "realtime:denied forbidden";
    it(`${c.label} × ${c.channel} → ${verdict} (allow appelé ${c.calls} fois)`, async () => {
      const { client, frames, ticks } = await subscribeAs(c.token, c.channel);
      if (c.granted) {
        expect(acksOn(frames)).to.deep.equal([c.channel]);
        expect(ticks).to.deep.equal([{ ok: true, channel: c.channel }]);
        expect(deniedOn(frames)).to.deep.equal([]);
      } else {
        expect(acksOn(frames)).to.deep.equal([]);
        expect(ticks).to.deep.equal([]);
        expect(deniedOn(frames)).to.deep.equal([[c.channel, "forbidden"]]);
      }
      expect(allowCalls).to.equal(c.calls);
      client.disconnect();
    });
  }

  it("allow appelé UNE fois pour l'abonnement, puis N trames entrantes passent sans lui", async () => {
    const { client, server, frames } = await subscribeAs(
      ACCOUNTS.u42,
      "user:42",
    );
    for (let n = 0; n < 5; n++) client.emit("user:42", { n });
    await flush();
    await flush();
    expect(asAdmitRt(server).received["user:42"]).to.equal(5);
    expect(allowCalls, "jamais par trame").to.equal(1);
    expect(deniedOn(frames)).to.deep.equal([]);
    client.disconnect();
  });

  it("trame entrante sur un canal à allow SANS abonnement : refusée, allow jamais consulté", async () => {
    const { client, server, frames } = await connectAs(
      ACCOUNTS.u42,
      undefined,
      {
        Rt: AdmitRt,
      },
    );
    client.emit("user:42", { n: 1 });
    await flush();
    await flush();
    expect(asAdmitRt(server).received["user:42"]).to.equal(undefined);
    expect(deniedOn(frames)).to.deep.equal([["user:42", "forbidden"]]);
    expect(allowCalls).to.equal(0);
    client.disconnect();
  });

  it("abonné à SON canal, la trame vers celui d'un autre reste refusée", async () => {
    const { client, server, frames } = await subscribeAs(
      ACCOUNTS.u42,
      "user:42",
    );
    client.emit("user:43", { n: 1 });
    await flush();
    await flush();
    expect(asAdmitRt(server).received["user:43"]).to.equal(undefined);
    expect(deniedOn(frames)).to.deep.equal([["user:43", "forbidden"]]);
    client.disconnect();
  });

  it("une politique plus spécifique SANS allow ouvre le canal, même à l'anonyme", async () => {
    const { client, frames } = await subscribeAs(
      ANONYMOUS_REALTIME_TOKEN,
      "user:public",
    );
    expect(acksOn(frames)).to.deep.equal(["user:public"]);
    expect(allowCalls).to.equal(0);
    client.disconnect();
  });

  /**
   * L'invariant « l'accueil et le `subscribe` rendent le MÊME verdict » (banc du
   * welcome ci-dessus) ne vaut que pour les politiques SANS `allow` — c'est
   * pourquoi `CHANNELS` n'en porte aucune. Le welcome n'annonce que ce que le
   * verrou laisse passer ; `allow` se joue au `subscribe`, canal par canal. Le
   * consulter à la poignée de main coûterait un appel par canal déclaré et par
   * connexion — pour annoncer un MOTIF, dont aucun nom concret n'est connu.
   */
  it("le welcome annonce le motif sur le seul verdict du verrou — allow n'est jamais joué à la poignée de main", async () => {
    const { client, welcome, frames } = await connectAs(
      ACCOUNTS.u43,
      undefined,
      {
        Rt: AdmitRt,
      },
    );
    expect(welcome.channels).to.include("user:*");
    expect(allowCalls, "aucun appel à la poignée de main").to.equal(0);
    client.subscribe("user:42");
    await flush();
    await flush();
    expect(deniedOn(frames)).to.deep.equal([["user:42", "forbidden"]]);
    client.disconnect();
  });

  it("le MÊME allow rend le même verdict sur la socket et à l'émission d'un webhook (S10 bis)", async () => {
    for (const [id, token, granted] of [
      ["42", ACCOUNTS.u42, true],
      ["43", ACCOUNTS.u43, false],
    ] as const) {
      const s = await subscribeAs(token, "user:42", handshakeContext(id));
      const onSocket = acksOn(s.frames).includes("user:42");
      s.client.disconnect();
      const who = token.getIdentity?.();
      if (who === undefined) throw new Error("banc : identité attendue");
      expect(onSocket, `socket ${id}`).to.equal(granted);
      expect(await emissionVerdict("user:42", who), `émission ${id}`).to.equal(
        onSocket,
      );
    }
  });

  it("contrôle : un allow qui lit le contexte de requête diverge — le test ci-dessus le refuserait", async () => {
    admissionRule = readsRequestContext;
    const s = await subscribeAs(
      ACCOUNTS.u42,
      "user:42",
      handshakeContext("42"),
    );
    const onSocket = acksOn(s.frames).includes("user:42");
    s.client.disconnect();
    const who = ACCOUNTS.u42.getIdentity?.();
    if (who === undefined) throw new Error("banc : identité attendue");
    expect(
      onSocket,
      "la socket l'admet, sous le contexte de la poignée de main",
    ).to.equal(true);
    expect(
      await emissionVerdict("user:42", who),
      "l'émission le refuse",
    ).to.equal(false);
  });
});

// ── #622 — poignée de main bornée : le client REVIENT après le 1013 ────────

/** Transport qui relève les codes de fermeture reçus du serveur. */
class RecordingTransport extends LoopbackClientTransport {
  constructor(
    wire: LoopbackWire,
    private readonly codes: number[],
  ) {
    super(wire);
  }
  override onClose(cb: (code: number, reason: string) => void): void {
    super.onClose((code, reason) => {
      this.codes.push(code);
      cb(code, reason);
    });
  }
}

async function until(cond: () => boolean, budgetMs = 1000): Promise<void> {
  const end = Date.now() + budgetMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error("banc : condition jamais atteinte");
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe("#622 — authenticate bloqué : 1013, puis le vrai client revient (ADR-0021 §S11)", () => {
  beforeEach(() => getRealtimeHub().clear());

  it("1ʳᵉ poignée de main sans réponse → 1013 ; le client se reconnecte SEUL et reçoit son welcome", async () => {
    const hub = getRealtimeHub();
    hub.admissionBudget.authenticateTimeoutMs = 15;
    let attempts = 0;
    hub.useAuthenticator(
      { pattern: /.*/ },
      {
        name: "slow_db",
        supports: () => true,
        // La base ne répond jamais à la première demande, puis répond.
        authenticate: () => {
          attempts += 1;
          return attempts === 1
            ? new Promise<IRealtimeToken>(() => {})
            : Promise.resolve(TOKENS.user);
        },
      },
    );
    const codes: number[] = [];
    let wires = 0;
    const client = new NodefonySocket(
      {
        url: "ws://loopback/realtime",
        autoReconnect: true,
        reconnectDelay: 1,
        reconnectDelayMax: 1,
      },
      () => {
        wires += 1;
        const wire = new LoopbackWire();
        makeServer(wire);
        return new RecordingTransport(wire, codes);
      },
    );
    await client.connect();
    await until(() => client.identity !== null);
    expect(codes, "fermé en 1013, une fois").to.deep.equal([1013]);
    expect(attempts, "une seconde poignée de main").to.equal(2);
    expect(wires, "une nouvelle connexion, ouverte par le client").to.equal(2);
    expect(client.identity?.userIdentifier).to.equal(
      TOKENS.user.getUserIdentifier(),
    );
    expect(hub.probe().authenticateTimedOutTotal).to.equal(1);
    client.disconnect();
  });
});
