import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Container, Event } from "nodefony";
import type { Module } from "nodefony";
import AuditService from "../../nodefony/service/auditService";
import { Firewall } from "../../nodefony/service/firewall";
import { AnonymousAuthenticator } from "../../nodefony/src/authenticator/AnonymousAuthenticator";
import {
  createAuditBridge,
  SECURITY_AUDIT_CHANNEL,
  type IAuditBatch,
  type IAuditEventSource,
} from "../../nodefony/src/audit/auditBridge";
import {
  buildFrameAuthorizer,
  DEFAULT_SYSTEM_RULES,
  type IFrameAuthorizerFirewall,
} from "../../nodefony/src/realtime/frameAuthorizer";
import type { IRealtimeToken } from "../../nodefony/src/realtime/realtimeContracts";
import type { IAuditEvent } from "../../nodefony/contracts/IAuditEvent";

/**
 * Stream WS live du journal d'audit (P6.14 — Lot 4). Trois surfaces :
 *  - `createAuditBridge` : coalescing borné + cleanup (calque createSyslogBridge).
 *  - garde `security:audit` : plancher ROLE_NODEFONY_ADMIN (un cran au-dessus du
 *    plancher d'observabilité générique) → un admin applicatif ne lit pas l'audit.
 *  - câblage RÉEL : le firewall enregistre le canal système sur le hub (lazy).
 */

const ev = (action: string): IAuditEvent => ({
  id: action,
  ts: 0,
  category: "auth",
  action,
  outcome: "failure",
  actor: null,
});

/** Faux AuditService : compte les abonnés (prouve le détache au dispose) + emit. */
function makeSource(): IAuditEventSource & {
  emit: (e: IAuditEvent) => void;
  size: () => number;
} {
  const listeners = new Set<(e: IAuditEvent) => void>();
  return {
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    emit(e) {
      listeners.forEach((l) => l(e));
    },
    size: () => listeners.size,
  };
}

// ════════════════════════════════════════════════════════════════════════════
describe("createAuditBridge — coalescing + cleanup", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesce N événements en 1 batch après flushMs", () => {
    const src = makeSource();
    const batches: IAuditBatch[] = [];
    const dispose = createAuditBridge(
      src,
      (_ch, p) => batches.push(p as IAuditBatch),
      SECURITY_AUDIT_CHANNEL,
      { flushMs: 200 },
    );
    src.emit(ev("a"));
    src.emit(ev("b"));
    expect(batches.length).to.equal(0); // accumulé, pas encore flush
    vi.advanceTimersByTime(200);
    expect(batches.length).to.equal(1);
    expect(batches[0]!.events.map((e) => e.action)).to.deep.equal(["a", "b"]);
    expect(batches[0]!.dropped).to.equal(0);
    dispose();
  });

  it("cap maxBatch : garde les + récents, compte les omis (dropped)", () => {
    const src = makeSource();
    const batches: IAuditBatch[] = [];
    const dispose = createAuditBridge(
      src,
      (_ch, p) => batches.push(p as IAuditBatch),
      SECURITY_AUDIT_CHANNEL,
      { flushMs: 100, maxBatch: 2 },
    );
    src.emit(ev("a"));
    src.emit(ev("b"));
    src.emit(ev("c")); // écrase "a"
    vi.advanceTimersByTime(100);
    expect(batches[0]!.events.map((e) => e.action)).to.deep.equal(["b", "c"]);
    expect(batches[0]!.dropped).to.equal(1);
    dispose();
  });

  it("dispose : détache la source ET désarme le timer (0 flush après)", () => {
    const src = makeSource();
    const batches: IAuditBatch[] = [];
    const dispose = createAuditBridge(
      src,
      (_ch, p) => batches.push(p as IAuditBatch),
      SECURITY_AUDIT_CHANNEL,
      { flushMs: 200 },
    );
    expect(src.size()).to.equal(1); // abonné
    src.emit(ev("a"));
    dispose();
    expect(src.size()).to.equal(0); // détaché
    vi.advanceTimersByTime(500);
    expect(batches.length).to.equal(0); // timer désarmé → rien ne sort
  });

  it("au repos (aucun événement) : 0 timer armé, 0 publish", () => {
    const src = makeSource();
    const batches: IAuditBatch[] = [];
    const dispose = createAuditBridge(
      src,
      (_ch, p) => batches.push(p as IAuditBatch),
      SECURITY_AUDIT_CHANNEL,
    );
    vi.advanceTimersByTime(5000);
    expect(batches.length).to.equal(0);
    dispose();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("frameAuthorizer — security:audit gardé ROLE_NODEFONY_ADMIN", () => {
  // hasRole = inclusion EXACTE (pas de hiérarchie) → prouve que ROLE_ADMIN simple
  // ne suffit pas : le plancher security: exige ROLE_NODEFONY_ADMIN strict.
  const fw: IFrameAuthorizerFirewall = {
    matchPath: () => null,
    hasRole: (roles, required) => roles.includes(required),
  };
  const authorize = buildFrameAuthorizer(fw, {
    systemRules: DEFAULT_SYSTEM_RULES,
  });
  const sub = (channel: string) => ({
    method: "subscribe",
    params: { channel },
  });
  const token = (roles: string[]): IRealtimeToken => ({
    type: "session",
    getUserIdentifier: () => "x",
    isAuthenticated: () => roles.length > 0 && roles[0] !== "ROLE_ANONYMOUS",
    getRoles: () => roles,
    getScopes: () => [],
    getAttribute: () => undefined,
  });

  it("anonyme → REFUSÉ", () => {
    expect(
      authorize(sub(SECURITY_AUDIT_CHANNEL), token(["ROLE_ANONYMOUS"])),
    ).to.equal(false);
  });
  it("ROLE_ADMIN simple → REFUSÉ (plancher super-admin)", () => {
    expect(
      authorize(sub(SECURITY_AUDIT_CHANNEL), token(["ROLE_ADMIN"])),
    ).to.equal(false);
  });
  it("ROLE_NODEFONY_ADMIN → AUTORISÉ", () => {
    expect(
      authorize(sub(SECURITY_AUDIT_CHANNEL), token(["ROLE_NODEFONY_ADMIN"])),
    ).to.equal(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("Firewall ⇄ realtime — security:audit enregistré + live (câblage réel)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeKernel(container: Container): { boot: () => void } {
    const cbs: Array<() => void> = [];
    container.set("kernel", {
      container,
      once(ev2: string, cb: () => void) {
        if (ev2 === "onBoot") cbs.push(cb);
      },
      registerStoreResolution() {},
    });
    return { boot: () => cbs.forEach((cb) => cb()) };
  }
  const mod = (c: Container, options: Record<string, unknown>): Module =>
    ({
      container: c,
      notificationsCenter: new Event(),
      options,
    }) as unknown as Module;

  it("le firewall enregistre security:audit sur le hub ; la factory diffuse en live, puis se détache", () => {
    const container = new Container();
    const { boot } = makeKernel(container);
    const audit = new AuditService(
      mod(container, { audit: { enabled: true } }),
    );
    container.set("auditService", audit);
    // realtimeService mock : capte la factory de canal système.
    let auditFactory:
      | ((
          ch: string,
          publish: (ch: string, payload: unknown) => void,
        ) => (() => void) | null)
      | null = null;
    container.set("realtimeService", {
      useAuthenticator() {},
      setFrameAuthorizer() {},
      registerSystemChannel(
        ch: string,
        f: (
          ch: string,
          publish: (ch: string, payload: unknown) => void,
        ) => (() => void) | null,
      ) {
        if (ch === SECURITY_AUDIT_CHANNEL) auditFactory = f;
      },
    });
    const firewall = new Firewall(
      mod(container, {
        areas: {
          "nodefony-admin": {
            pattern: "^/rt",
            security: true,
            stateless: false,
            mode: "first",
            authenticators: ["anonymous"],
            realtime: true,
          },
        },
      }),
    );
    firewall.registerAuthenticator(new AnonymousAuthenticator());
    boot(); // #wireRealtime → registerSystemChannel(security:audit, …)

    expect(auditFactory, "factory security:audit enregistrée").to.be.a(
      "function",
    );

    // 1ᵉʳ auditeur s'abonne → la factory crée le pont (lazy).
    const published: Array<{ ch: string; p: IAuditBatch }> = [];
    const dispose = auditFactory!(SECURITY_AUDIT_CHANNEL, (ch, p) =>
      published.push({ ch, p: p as IAuditBatch }),
    );
    // Un refus part dans le journal → coalescé → diffusé.
    audit.record(ev("auth.denied"));
    vi.advanceTimersByTime(300);
    expect(published.length).to.equal(1);
    expect(published[0]!.ch).to.equal(SECURITY_AUDIT_CHANNEL);
    expect(published[0]!.p.events[0]!.action).to.equal("auth.denied");

    // Dernier désabonné → dispose → plus aucune diffusion.
    dispose();
    audit.record(ev("auth.failure"));
    vi.advanceTimersByTime(300);
    expect(published.length).to.equal(1); // inchangé
  });
});
