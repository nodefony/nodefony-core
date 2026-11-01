import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "reflect-metadata";
import type { ContextType } from "@nodefony/http";
import type { ChannelAllowFunction, ISubscriberIdentity } from "nodefony";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import { RealtimeChannel } from "../../decorators/realtimeDecorators.js";
import type { RealtimePublish } from "../../interfaces/IRealtimeController.js";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken.js";
import { NodefonySocket } from "../../../../../../nodefony/src/client/realtime/NodefonySocket.js";
import { TransportState } from "../../../../../../nodefony/src/realtime/IRealtimeTransport.js";
import { LoopbackClientTransport, LoopbackWire } from "../helpers/loopback.js";

/**
 * BANC #622 — la tempête de reconnexion contre une base BLOQUÉE (S-rt-41,
 * S-rt-65 ; ADR-0021 §S10 bis « Gardé par »).
 *
 * Un atelier perd le réseau ; au retour, 300 passerelles se reconnectent dans
 * la même seconde et rejouent les abonnements des 10 000 machines qu'elles
 * relaient. La base qui répond à `allow` est bloquée : aucun verdict ne revient.
 *
 * Ce que le banc prouve : le nombre d'appels d'`allow` est BORNÉ par les
 * plafonds du serveur, pas par le nombre de clients — et la tempête s'ÉTEINT
 * (le client abandonne après trois réessais). Vrai client, vrai contrôleur,
 * vrai budget, défauts de production ; le temps est simulé (minuteurs
 * factices), le verdict est un COMPTE : il ne dépend pas de la machine.
 *
 * Ce qui borne, et que ce banc fait tomber s'il manque (vu rouge) : le plafond
 * GLOBAL d'appels en vol (`maxPendingAllowsTotal`) et le plafond de réessais du
 * client (trois). Ce qui ne borne PAS le total contre une base bloquée, et que
 * les unitaires gardent (`channelAdmissionQueue.test.ts`) : le plafond par
 * connexion (il protège les AUTRES connexions, S-rt-70) et le coupe-circuit —
 * neutralisé, il fait même MOINS d'appels ici, le client épuisant ses réessais
 * plus vite sur des refus de saturation.
 */

const GATEWAYS = 300;
const CLIENTS = 10_000;
/** Défauts de production (`config.ts`), posés tels quels. */
const LIMITS = {
  authenticateTimeoutMs: 10_000,
  allowTimeoutMs: 5000,
  maxPendingAllowsPerConnection: 8,
  maxPendingAllowsTotal: 512,
} as const;
/** Horizon simulé : bien au-delà de l'extinction attendue (< 1 min). */
const HORIZON_MS = 120_000;
const STEP_MS = 100;

/** Appels d'`allow` et leur dernier instant (temps simulé). */
let allowCalls = 0;
let lastCallAt = 0;
/** La base bloquée : la promesse ne se résout jamais. */
const blockedDatabase: ChannelAllowFunction = () => {
  allowCalls += 1;
  lastCallAt = performance.now();
  return new Promise<boolean>(() => {});
};

class PlantRt extends RealtimeController {
  constructor(ctx: ContextType) {
    super("plant-rt", ctx);
  }

  @RealtimeChannel("plant:*", { allow: blockedDatabase })
  plantPolicy(channel: string, publish: RealtimePublish): () => void {
    publish(channel, { ok: true });
    return () => {};
  }

  override createRealtimeChannel(
    channel: string,
    publish: RealtimePublish,
  ): (() => void) | null {
    if (!channel.startsWith("plant:")) return null;
    publish(channel, { ok: true });
    return () => {};
  }

  feed(raw: string | Uint8Array | null): void {
    this.handleRealtime(raw);
  }
}

function mount(wire: LoopbackWire): void {
  const conn = {
    get readyState() {
      return wire.serverConnOpen ? TransportState.OPEN : TransportState.CLOSED;
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
    outboundTracer: () => null,
    connection: conn,
    once: () => {},
    request: { headers: {}, url: "/realtime" },
    cookies: {},
    url: "/realtime",
    remoteAddress: "127.0.0.1",
    origin: "",
  };
  const rt = new PlantRt(ctx as unknown as ContextType);
  wire.feedServer = (raw) => rt.feed(raw);
}

const gatewayIdentity: ISubscriberIdentity = Object.freeze({
  type: "jwt",
  authenticated: true,
  id: "gateway",
  userIdentifier: "gateway",
  roles: Object.freeze(["ROLE_USER"]),
  scopes: Object.freeze([]),
  issuer: null,
  account: true,
});
const gatewayToken: IRealtimeToken = {
  type: "jwt",
  getUserIdentifier: () => "gateway",
  isAuthenticated: () => true,
  getRoles: () => ["ROLE_USER"],
  getScopes: () => [],
  getAttribute: () => undefined,
  getIdentity: () => gatewayIdentity,
};

describe("#622 — banc : 300 passerelles, 10 000 clients, base bloquée", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "clearImmediate",
        "performance",
        "Date",
      ],
    });
    const hub = getRealtimeHub();
    hub.clear();
    hub.setAdmissionLimits(LIMITS);
    hub.useAuthenticator(
      { pattern: /.*/ },
      {
        name: "gateway",
        supports: () => true,
        authenticate: () => Promise.resolve(gatewayToken),
      },
    );
    allowCalls = 0;
    lastCallAt = 0;
    // La gigue du client tire `Math.random` : une graine fixe rend le chiffre
    // publié REJOUABLE à l'identique (générateur congruentiel, Numerical Recipes).
    let seed = 622;
    vi.spyOn(Math, "random").mockImplementation(() => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 2 ** 32;
    });
  });

  afterEach(() => {
    getRealtimeHub().clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it(
    "le nombre d'appels d'allow est borné par les plafonds du serveur, et la tempête s'éteint",
    { timeout: 120_000 },
    async () => {
      const hub = getRealtimeHub();
      const clients: NodefonySocket[] = [];
      for (let g = 0; g < GATEWAYS; g++) {
        clients.push(
          new NodefonySocket(
            { url: "ws://loopback/realtime", autoReconnect: false },
            () => {
              const wire = new LoopbackWire();
              mount(wire);
              return new LoopbackClientTransport(wire);
            },
          ),
        );
      }
      await Promise.all(clients.map((c) => c.connect()));
      expect(
        clients.every((c) => c.identity !== null),
        "300 welcome",
      ).to.equal(true);

      // Le retour du réseau : chaque passerelle rejoue ses abonnements d'un
      // coup — 10 000 au total, ~33 par passerelle.
      const t0 = performance.now();
      for (let n = 0; n < CLIENTS; n++) {
        clients[n % GATEWAYS]!.subscribe(`plant:${n}`);
      }

      let peakPending = 0;
      for (let t = 0; t < HORIZON_MS; t += STEP_MS) {
        await vi.advanceTimersByTimeAsync(STEP_MS);
        peakPending = Math.max(peakPending, hub.admissionBudget.pending);
      }

      const probe = hub.probe();
      const quietFor = performance.now() - lastCallAt;
      // Borne du BUDGET : une place du plafond global sert au plus un appel
      // par délai (le verdict ne revient jamais, la place se libère au
      // dépassement). Elle ne dépend PAS du nombre de clients.
      const budgetBound =
        LIMITS.maxPendingAllowsTotal *
        (Math.floor(HORIZON_MS / LIMITS.allowTimeoutMs) + 1);
      // Borne du CLIENT : un essai et trois réessais au plus par abonnement.
      const clientBound = CLIENTS * 4;

      console.log(
        `[storm] ${GATEWAYS} passerelles · ${CLIENTS} abonnements · base bloquée · ` +
          `${HORIZON_MS / 1000} s simulées → ${allowCalls} appels d'allow ` +
          `(borne budget ${budgetBound}, borne client ${clientBound}) · ` +
          `pic en vol ${peakPending}/${LIMITS.maxPendingAllowsTotal} · ` +
          `dépassements ${probe.allowTimedOutTotal} · refus par saturation ${probe.allowSaturatedTotal} · ` +
          `dernier appel à ${Math.round((lastCallAt - t0) / 1000)} s`,
      );

      expect(allowCalls, "la base a bien été sollicitée").to.be.greaterThan(0);
      expect(
        peakPending,
        "jamais plus que le plafond global en vol",
      ).to.be.at.most(LIMITS.maxPendingAllowsTotal);
      expect(allowCalls, "borne du budget").to.be.at.most(budgetBound);
      expect(allowCalls, "borne du client").to.be.at.most(clientBound);
      expect(
        quietFor,
        "la tempête s'éteint : plus aucun appel pendant la dernière minute",
      ).to.be.at.least(60_000);

      for (const c of clients) c.disconnect();
    },
  );
});
