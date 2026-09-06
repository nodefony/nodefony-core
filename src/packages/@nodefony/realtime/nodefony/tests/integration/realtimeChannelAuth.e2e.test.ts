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
import type { RealtimePublish } from "../../interfaces/IRealtimeController.js";
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
import { RealtimeClient } from "../../../../../../nodefony/src/client/realtime/RealtimeClient.js";
import {
  TransportState,
  type IRealtimeTransport,
} from "../../../../../../nodefony/src/realtime/IRealtimeTransport.js";

/**
 * MATRICE E2E « protection des canaux » — VRAI {@link RealtimeClient} ↔ VRAI
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

function makeServer(wire: LoopbackWire, environment?: string): AuthRt {
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
    connection: conn,
    once: () => {},
    request: { headers: {}, url: "/realtime" },
    cookies: {},
    url: "/realtime",
    remoteAddress: "127.0.0.1",
    origin: "",
  };
  const rt = new AuthRt(ctx as unknown as ContextType);
  // Le mode d'exécution du kernel décide si un refus dit POURQUOI. Les autres
  // scénarios de ce fichier montent le contrôleur sans kernel : `environment`
  // y vaut `undefined`, qui vaut production — leurs refus restent donc nus, et
  // c'est ce qu'ils vérifient déjà.
  if (environment !== undefined) {
    rt.kernel = { environment } as unknown as typeof rt.kernel;
  }
  wire.feedServer = (raw) => rt.feed(raw);
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
  admin: mkToken("session", true, ["ROLE_ADMIN"], []),
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
): Promise<{ client: RealtimeClient; welcome: Partial<IRealtimeWelcome> }> {
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
  const deliver = wire.deliverToClient.bind(wire);
  wire.deliverToClient = (raw: string): void => {
    try {
      const f = JSON.parse(raw) as { method?: string; params?: unknown };
      if (f.method === "realtime:welcome")
        welcome = (f.params ?? {}) as Partial<IRealtimeWelcome>;
    } catch {
      /* frame illisible : le banc du protocole s'en occupe, pas celui-ci */
    }
    deliver(raw);
  };
  makeServer(wire, environment);
  const transport = new LoopbackClientTransport(wire);
  const client = new RealtimeClient(
    { url: "ws://loopback/realtime", autoReconnect: false },
    () => transport,
  );
  await client.connect();
  await flush();
  await flush();
  return { client, welcome };
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
   */
  it("la sonde du welcome et le verrou de subscribe rendent le MÊME verdict", async () => {
    // 🔴 Le décor d'abord : `hub.clear()` vide le registre des politiques, qui
    // n'est peuplé qu'au MONTAGE du contrôleur. Sans cette connexion, aucun
    // canal n'a de politique, tout est libre, et la comparaison serait verte
    // pour la mauvaise raison — elle a d'ailleurs commencé par l'être.
    await connectAs(TOKENS.anon);
    const hub = getRealtimeHub();
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
