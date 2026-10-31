import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import "reflect-metadata";
import type { ISubscriberIdentity } from "nodefony";
import type { ContextType } from "@nodefony/http";
import {
  ADMISSION_GRANTED,
  AdmissionBudget,
} from "../../src/server/admissionBudget";
import {
  ConnectionAdmission,
  type IAdmissionHost,
  type IChannelAdmissionRule,
} from "../../src/server/connectionAdmission";
import { RealtimeController } from "../../src/server/RealtimeController";
import { getRealtimeHub } from "../../src/server/RealtimeHub";
import { realtimeConfigSchema } from "../../config/config";
import type { RealtimePublish } from "../../interfaces/IRealtimeController";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken";

// ── Décor ──────────────────────────────────────────────────────────────────

function identity(id: string | null): ISubscriberIdentity {
  return Object.freeze({
    type: id === null ? "anonymous" : "session",
    authenticated: id !== null,
    id,
    userIdentifier: id ?? "anonymous",
    roles: Object.freeze(id === null ? ["ROLE_ANONYMOUS"] : ["ROLE_USER"]),
    scopes: Object.freeze([]),
    issuer: null,
    account: id !== null,
  });
}
const ALICE = identity("acc-alice");
const BOB = identity("acc-bob");
const ANON = identity(null);

interface IDenial {
  channel: string;
  reason: string;
  detail: string | undefined;
  retryAfterMs: number | undefined;
}

function recorder() {
  const opened: string[] = [];
  const denied: IDenial[] = [];
  const warns: string[] = [];
  const host: IAdmissionHost = {
    open: (channel) => opened.push(channel),
    deny: (channel, reason, detail, retryAfterMs) =>
      denied.push({ channel, reason, detail, retryAfterMs }),
    warn: (message) => warns.push(message),
  };
  return { host, opened, denied, warns };
}

const rule = (
  allow: IChannelAdmissionRule["allow"],
  anonymous = false,
): IChannelAdmissionRule => ({ allow, anonymous });

/** Promesse que le test tranche quand il veut. */
function deferred() {
  let settle: (value: unknown) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const promise = new Promise<boolean>((resolve, reject) => {
    settle = (value) => resolve(value === true);
    fail = reject;
  });
  return { promise, settle, fail };
}

/** Vide la file des microtâches (verdict → rappel `then` → suite). */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function fakeClock(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
}

afterEach(() => {
  vi.useRealTimers();
});

// ── Budget de l'exemplaire ────────────────────────────────────────────────

describe("#622 — budget des admissions de l'exemplaire", () => {
  it("défauts validés par l'auteur : délai 5000, 8 en vol par connexion, 512 par exemplaire", () => {
    const budget = new AdmissionBudget();
    assert.equal(budget.timeoutMs, 5000);
    assert.equal(budget.maxPerConnection, 8);
    for (let i = 0; i < 512; i++)
      assert.equal(budget.acquire(), ADMISSION_GRANTED);
    assert.equal(budget.acquire(), 0, "513ᵉ : plafond global, délai inconnu");
    assert.equal(budget.saturatedTotal, 1);
  });

  it("release rend la place ; jamais de compte négatif qui ouvrirait le plafond", () => {
    const budget = new AdmissionBudget();
    budget.configure({
      authenticateTimeoutMs: 10_000,
      allowTimeoutMs: 100,
      maxPendingAllowsPerConnection: 1,
      maxPendingAllowsTotal: 1,
    });
    assert.equal(budget.acquire(), ADMISSION_GRANTED);
    assert.equal(budget.acquire(), 0);
    budget.release();
    budget.release();
    budget.release();
    assert.equal(budget.pending, 0);
    assert.equal(budget.acquire(), ADMISSION_GRANTED);
    assert.equal(budget.acquire(), 0, "une seule place, malgré trois release");
  });

  it("coupe-circuit : 50 délais en 5 s l'ouvrent 5 s, avec le délai restant à annoncer", () => {
    fakeClock();
    const budget = new AdmissionBudget();
    vi.advanceTimersByTime(1000);
    for (let i = 0; i < 49; i++) budget.recordTimeout(performance.now());
    assert.equal(budget.acquire(), ADMISSION_GRANTED, "49 : encore fermé");
    budget.release();
    budget.recordTimeout(performance.now());
    assert.equal(budget.acquire(), 5000);
    assert.equal(budget.retryAfter(performance.now()), 5000);
    vi.advanceTimersByTime(4999);
    assert.equal(budget.acquire(), 1);
    vi.advanceTimersByTime(1);
    assert.equal(
      budget.acquire(),
      ADMISSION_GRANTED,
      "fenêtre écoulée : refermé",
    );
    assert.equal(budget.retryAfter(performance.now()), undefined);
    assert.equal(budget.timedOutTotal, 50);
    assert.equal(budget.saturatedTotal, 2);
  });

  it("coupe-circuit : la fenêtre s'ouvre au PREMIER délai — 5 s plus tard, elle repart de zéro", () => {
    fakeClock();
    const budget = new AdmissionBudget();
    vi.advanceTimersByTime(1000);
    for (let i = 0; i < 49; i++) budget.recordTimeout(performance.now());
    vi.advanceTimersByTime(5000);
    budget.recordTimeout(performance.now());
    assert.equal(
      budget.acquire(),
      ADMISSION_GRANTED,
      "fenêtre [1000, 6000[ close",
    );
  });

  it("coupe-circuit : une rafale n'est pas coupée en deux par une fenêtre ancrée au démarrage", () => {
    fakeClock();
    const budget = new AdmissionBudget();
    vi.advanceTimersByTime(4990);
    for (let i = 0; i < 25; i++) budget.recordTimeout(performance.now());
    vi.advanceTimersByTime(20);
    for (let i = 0; i < 25; i++) budget.recordTimeout(performance.now());
    assert.equal(
      budget.acquire(),
      5000,
      "50 délais en 20 ms ouvrent le coupe-circuit",
    );
  });

  it("un avertissement par cause et par fenêtre de 10 s", () => {
    fakeClock();
    const budget = new AdmissionBudget();
    const now = (): number => performance.now();
    assert.equal(budget.shouldWarn("timeout", now()), true);
    assert.equal(budget.shouldWarn("timeout", now()), false);
    assert.equal(budget.shouldWarn("throw", now()), true, "cause distincte");
    vi.advanceTimersByTime(9999);
    assert.equal(budget.shouldWarn("timeout", now()), false);
    vi.advanceTimersByTime(1);
    assert.equal(budget.shouldWarn("timeout", now()), true);
  });

  it("reset remet compteurs, coupe-circuit et bornes aux défauts", () => {
    fakeClock();
    const budget = new AdmissionBudget();
    budget.configure({
      authenticateTimeoutMs: 10_000,
      allowTimeoutMs: 10,
      maxPendingAllowsPerConnection: 1,
      maxPendingAllowsTotal: 1,
    });
    budget.acquire();
    for (let i = 0; i < 50; i++) budget.recordTimeout(performance.now());
    budget.recordQueueExpired();
    budget.reset();
    assert.equal(budget.pending, 0);
    assert.equal(budget.timedOutTotal, 0);
    assert.equal(budget.saturatedTotal, 0);
    assert.equal(budget.timeoutMs, 5000);
    assert.equal(budget.maxPerConnection, 8);
    assert.equal(budget.acquire(), ADMISSION_GRANTED, "coupe-circuit refermé");
  });
});

// ── File d'une connexion ──────────────────────────────────────────────────

function queue(
  who: ISubscriberIdentity = ALICE,
  limits: Partial<{
    timeout: number;
    perConnection: number;
    total: number;
  }> = {},
  explain = true,
) {
  const budget = new AdmissionBudget();
  budget.configure({
    authenticateTimeoutMs: 10_000,
    allowTimeoutMs: limits.timeout ?? 1000,
    maxPendingAllowsPerConnection: limits.perConnection ?? 8,
    maxPendingAllowsTotal: limits.total ?? 512,
  });
  const rec = recorder();
  const admission = new ConnectionAdmission(rec.host, budget, who, explain);
  return { ...rec, budget, admission };
}

describe("#622 — règle synchrone : ni minuteur, ni promesse, ni entrée d'attente", () => {
  beforeEach(fakeClock);

  it("`true` ouvre aussitôt ; `allow` reçoit le canal et l'identité gelée, par référence", () => {
    const { admission, opened, budget } = queue();
    const calls: Array<[string, ISubscriberIdentity]> = [];
    admission.request(
      "user:acc-alice",
      rule((channel, who) => {
        calls.push([channel, who]);
        return true;
      }),
    );
    assert.deepEqual(opened, ["user:acc-alice"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.[0], "user:acc-alice");
    assert.equal(calls[0]?.[1], ALICE);
    assert.equal(vi.getTimerCount(), 0, "aucun minuteur");
    assert.equal(admission.unsettled, 0, "aucune entrée d'attente");
    assert.equal(budget.pending, 0, "place rendue");
  });

  for (const [label, value] of [
    ["false", false],
    ["1", 1],
    ['"yes"', "yes"],
    ["undefined", undefined],
    ["un objet", {}],
  ] as const) {
    it(`rendre ${label} REFUSE : seul \`true\` admet`, () => {
      const { admission, opened, denied } = queue();
      admission.request(
        "room:1",
        rule(() => value as unknown as boolean),
      );
      assert.deepEqual(opened, []);
      assert.equal(denied.length, 1);
      assert.equal(denied[0]?.reason, "forbidden");
      assert.equal(denied[0]?.retryAfterMs, undefined);
    });
  }

  it("une règle qui LÈVE refuse (fail-closed), le message en détail, un seul journal par fenêtre", () => {
    const { admission, denied, warns, budget } = queue();
    const boom = rule(() => {
      throw new Error("base injoignable");
    });
    admission.request("room:1", boom);
    admission.request("room:2", boom);
    assert.deepEqual(
      denied.map((d) => d.reason),
      ["forbidden", "forbidden"],
    );
    assert.match(denied[0]?.detail ?? "", /base injoignable/);
    assert.equal(warns.length, 1);
    assert.match(warns[0] ?? "", /room:1.*base injoignable/);
    assert.equal(budget.pending, 0);
  });

  it("anonyme refusé d'office, SANS appeler allow", () => {
    const { admission, denied } = queue(ANON);
    let called = 0;
    admission.request(
      "user:null",
      rule(() => {
        called += 1;
        return true;
      }),
    );
    assert.equal(called, 0);
    assert.equal(denied[0]?.reason, "forbidden");
    assert.match(denied[0]?.detail ?? "", /anonymous: true/);
  });

  it("`anonymous: true` présente l'anonyme à allow (`who.id === null`)", () => {
    const { admission, opened } = queue(ANON);
    const seen: Array<string | null> = [];
    admission.request(
      "support:1",
      rule((_channel, who) => {
        seen.push(who.id);
        return true;
      }, true),
    );
    assert.deepEqual(seen, [null]);
    assert.deepEqual(opened, ["support:1"]);
  });

  it("production : aucun détail rédigé, et le message d'erreur n'est pas lu hors journal", () => {
    const { admission, denied, warns } = queue(ALICE, {}, false);
    let reads = 0;
    const error = {
      get message(): string {
        reads += 1;
        return "secret";
      },
    };
    const boom = rule(() => {
      throw Object.setPrototypeOf(error, Error.prototype);
    });
    admission.request("room:1", boom);
    assert.equal(reads, 1, "lu une fois, pour le journal de la fenêtre");
    admission.request("room:2", boom);
    assert.equal(reads, 1, "fenêtre consommée : plus lu");
    admission.request(
      "room:3",
      rule(() => false),
    );
    assert.equal(warns.length, 1);
    assert.deepEqual(
      denied.map((d) => d.detail),
      [undefined, undefined, undefined],
    );
  });
});

describe("#622 — règle asynchrone : délai, file, plafonds", () => {
  beforeEach(fakeClock);

  it("promesse → `true` : ouvert à la résolution ; le minuteur est coupé", async () => {
    const { admission, opened, budget } = queue();
    const d = deferred();
    admission.request(
      "room:1",
      rule(() => d.promise),
    );
    assert.equal(vi.getTimerCount(), 1);
    assert.equal(budget.pending, 1);
    d.settle(true);
    await flush();
    assert.deepEqual(opened, ["room:1"]);
    assert.equal(vi.getTimerCount(), 0);
    assert.equal(budget.pending, 0);
    assert.equal(admission.unsettled, 0);
  });

  it("promesse rejetée → forbidden, raison en détail", async () => {
    const { admission, denied } = queue();
    admission.request(
      "room:1",
      rule(() => Promise.reject(new Error("timeout sql"))),
    );
    await flush();
    assert.equal(denied[0]?.reason, "forbidden");
    assert.match(denied[0]?.detail ?? "", /timeout sql/);
  });

  it("délai dépassé → unavailable à l'échéance EXACTE ; le verdict tardif est ignoré", async () => {
    const { admission, opened, denied, budget } = queue(ALICE, {
      timeout: 1000,
    });
    const d = deferred();
    admission.request(
      "room:1",
      rule(() => d.promise),
    );
    vi.advanceTimersByTime(999);
    assert.equal(denied.length, 0);
    vi.advanceTimersByTime(1);
    assert.equal(denied.length, 1);
    assert.equal(denied[0]?.reason, "unavailable");
    assert.match(denied[0]?.detail ?? "", /1000 ms/);
    assert.equal(budget.timedOutTotal, 1);
    assert.equal(budget.pending, 0, "place rendue au dépassement");
    d.settle(true);
    await flush();
    assert.deepEqual(opened, [], "un verdict après le délai n'admet jamais");
    assert.equal(denied.length, 1);
  });

  it("au-delà de N en vol, les demandes ATTENDENT leur tour, dans l'ordre — aucune refusée", async () => {
    const { admission, opened, denied } = queue(ALICE, { perConnection: 2 });
    const pending = new Map<string, ReturnType<typeof deferred>>();
    const calls: string[] = [];
    const slow = rule((channel) => {
      calls.push(channel);
      const d = deferred();
      pending.set(channel, d);
      return d.promise;
    });
    for (const ch of ["a", "b", "c", "d"]) admission.request(ch, slow);
    assert.deepEqual(calls, ["a", "b"]);
    assert.equal(admission.unsettled, 4);
    pending.get("b")?.settle(true);
    await flush();
    assert.deepEqual(calls, ["a", "b", "c"], "une place libérée → la suivante");
    pending.get("a")?.settle(true);
    await flush();
    assert.deepEqual(calls, ["a", "b", "c", "d"]);
    pending.get("d")?.settle(true);
    pending.get("c")?.settle(true);
    await flush();
    assert.deepEqual(opened, ["b", "a", "d", "c"]);
    assert.equal(denied.length, 0);
    assert.equal(admission.unsettled, 0);
    assert.equal(vi.getTimerCount(), 0);
  });

  it("l'ordre d'arrivée tient même pour un canal au nom numérique (une Map, pas un objet)", () => {
    const { admission } = queue(ALICE, { perConnection: 1 });
    const calls: string[] = [];
    const slow = rule((channel) => {
      calls.push(channel);
      return new Promise<boolean>(() => {});
    });
    admission.request("b", slow);
    admission.request("42", slow);
    admission.request("a", slow);
    vi.advanceTimersByTime(1000);
    assert.deepEqual(calls, ["b"], "seule la première a appelé");
    assert.equal(admission.unsettled, 0, "toutes tranchées à l'échéance");
  });

  it("le délai court depuis la RÉCEPTION, file comprise — pas depuis l'appel", async () => {
    const { admission, denied } = queue(ALICE, {
      timeout: 1000,
      perConnection: 1,
    });
    const first = deferred();
    let bCalledAt = -1;
    admission.request(
      "a",
      rule(() => first.promise),
    );
    vi.advanceTimersByTime(600);
    admission.request(
      "b",
      rule(() => {
        bCalledAt = performance.now();
        return new Promise<boolean>(() => {});
      }),
    );
    vi.advanceTimersByTime(300);
    first.settle(true);
    await flush();
    assert.ok(bCalledAt > 0, "b appelé quand a se libère");
    vi.advanceTimersByTime(699);
    assert.equal(denied.length, 0);
    vi.advanceTimersByTime(1);
    assert.deepEqual(
      denied.map((d) => [d.channel, d.reason]),
      [["b", "unavailable"]],
      "échéance de b = réception (600) + 1000, et non appel (900) + 1000",
    );
  });

  it("une demande échue DANS la file : unavailable, allow jamais appelé, comptée saturée", () => {
    const { admission, denied, budget } = queue(ALICE, {
      timeout: 1000,
      perConnection: 1,
    });
    const calls: string[] = [];
    const never = rule((channel) => {
      calls.push(channel);
      return new Promise<boolean>(() => {});
    });
    admission.request("a", never);
    admission.request("b", never);
    vi.advanceTimersByTime(1000);
    assert.deepEqual(calls, ["a"]);
    assert.deepEqual(
      denied.map((d) => [d.channel, d.reason]),
      [
        ["a", "unavailable"],
        ["b", "unavailable"],
      ],
    );
    assert.match(denied[1]?.detail ?? "", /en attente/);
    assert.equal(budget.timedOutTotal, 1, "un appel dépassé");
    assert.equal(budget.saturatedTotal, 1, "une demande sans appel");
  });

  it("plafond GLOBAL partagé entre connexions → unavailable sans appel, sans délai annoncé", async () => {
    const budget = new AdmissionBudget();
    budget.configure({
      authenticateTimeoutMs: 10_000,
      allowTimeoutMs: 1000,
      maxPendingAllowsPerConnection: 8,
      maxPendingAllowsTotal: 1,
    });
    const r1 = recorder();
    const r2 = recorder();
    const c1 = new ConnectionAdmission(r1.host, budget, ALICE, true);
    const c2 = new ConnectionAdmission(r2.host, budget, BOB, true);
    const d = deferred();
    let calls = 0;
    c1.request(
      "a",
      rule(() => d.promise),
    );
    c2.request(
      "b",
      rule(() => {
        calls += 1;
        return true;
      }),
    );
    assert.equal(calls, 0);
    assert.deepEqual(r2.denied[0]?.reason, "unavailable");
    assert.equal(r2.denied[0]?.retryAfterMs, undefined);
    assert.match(r2.denied[0]?.detail ?? "", /maxPendingAllowsTotal/);
    assert.equal(budget.saturatedTotal, 1);
    d.settle(true);
    await flush();
    c2.request(
      "b",
      rule(() => true),
    );
    assert.deepEqual(
      r2.opened,
      ["b"],
      "place rendue : la connexion suivante passe",
    );
  });

  it("coupe-circuit : 50 délais ouvrent 5 s sans appeler allow, et le délai est annoncé", () => {
    const { admission, denied, budget } = queue(ALICE, {
      timeout: 100,
      perConnection: 64,
    });
    const never = rule(() => new Promise<boolean>(() => {}));
    for (let i = 0; i < 50; i++) admission.request(`room:${i}`, never);
    vi.advanceTimersByTime(100);
    assert.equal(budget.timedOutTotal, 50);
    assert.equal(denied[48]?.retryAfterMs, undefined, "49ᵉ : encore fermé");
    assert.equal(denied[49]?.retryAfterMs, 5000, "50ᵉ : ouvre et l'annonce");
    let calls = 0;
    const counted = rule(() => {
      calls += 1;
      return true;
    });
    admission.request("room:x", counted);
    assert.equal(calls, 0);
    assert.equal(denied.at(-1)?.retryAfterMs, 5000);
    vi.advanceTimersByTime(5000);
    admission.request("room:y", counted);
    assert.equal(calls, 1, "fenêtre écoulée : allow rappelé");
  });

  it("un seul journal de délai par fenêtre, qui nomme canal, durée et exemplaire", () => {
    const { admission, warns } = queue(ALICE, { timeout: 100 });
    const never = rule(() => new Promise<boolean>(() => {}));
    admission.request("room:1", never);
    admission.request("room:2", never);
    vi.advanceTimersByTime(100);
    assert.equal(warns.length, 1);
    assert.match(warns[0] ?? "", /room:2.*100 ms.*exemplaire/);
  });

  it("un rejeu de 256 subscribe contre un allow lent : 256 admis, aucun refus, jamais plus de N en vol", async () => {
    const { admission, opened, denied } = queue(ALICE, {
      timeout: 5000,
      perConnection: 8,
    });
    let inFlight = 0;
    let peak = 0;
    const slow = rule(
      () =>
        new Promise<boolean>((resolve) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          setTimeout(() => {
            inFlight -= 1;
            resolve(true);
          }, 10);
        }),
    );
    for (let i = 0; i < 256; i++) admission.request(`room:${i}`, slow);
    await vi.advanceTimersByTimeAsync(10 * 33);
    assert.equal(opened.length, 256);
    assert.equal(denied.length, 0);
    assert.equal(peak, 8);
    assert.equal(vi.getTimerCount(), 0);
  });
});

describe("#622 — annulation, ranimation, fermeture", () => {
  beforeEach(fakeClock);

  it("unsubscribe pendant l'attente : verdict `true` jeté, aucune réponse, place rendue", async () => {
    const { admission, opened, denied, budget } = queue();
    const d = deferred();
    admission.request(
      "room:1",
      rule(() => d.promise),
    );
    admission.cancel("room:1");
    d.settle(true);
    await flush();
    assert.deepEqual(opened, []);
    assert.deepEqual(denied, []);
    assert.equal(budget.pending, 0);
  });

  it("subscribe de nouveau pendant l'attente : la demande est RANIMÉE, allow appelé une fois", async () => {
    const { admission, opened } = queue();
    const d = deferred();
    let calls = 0;
    const r = rule(() => {
      calls += 1;
      return d.promise;
    });
    admission.request("room:1", r);
    admission.cancel("room:1");
    assert.equal(admission.revive("room:1"), true);
    assert.equal(admission.revive("room:other"), false);
    d.settle(true);
    await flush();
    assert.equal(calls, 1);
    assert.deepEqual(opened, ["room:1"]);
  });

  it("une demande annulée DANS la file n'appelle jamais allow", async () => {
    const { admission, opened } = queue(ALICE, { perConnection: 1 });
    const first = deferred();
    const calls: string[] = [];
    const r = rule((channel) => {
      calls.push(channel);
      return channel === "a" ? first.promise : true;
    });
    admission.request("a", r);
    admission.request("b", r);
    admission.request("c", r);
    admission.cancel("b");
    first.settle(true);
    await flush();
    assert.deepEqual(calls, ["a", "c"]);
    assert.deepEqual(opened, ["a", "c"]);
    assert.equal(admission.unsettled, 0);
  });

  it("fermeture pendant l'attente : minuteur coupé, places rendues, verdict jeté, file arrêtée", async () => {
    const { admission, opened, denied, budget } = queue(ALICE, {
      perConnection: 1,
    });
    const d = deferred();
    let calls = 0;
    const r = rule(() => {
      calls += 1;
      return d.promise;
    });
    admission.request("a", r);
    admission.request("b", r);
    admission.close();
    assert.equal(vi.getTimerCount(), 0);
    assert.equal(budget.pending, 0);
    assert.equal(admission.unsettled, 0);
    d.settle(true);
    await flush();
    vi.advanceTimersByTime(5000);
    assert.equal(calls, 1, "b ne part jamais");
    assert.deepEqual(opened, []);
    assert.deepEqual(denied, []);
  });

  it("une ouverture qui LÈVE après un verdict asynchrone est journalisée, jamais un rejet non géré", async () => {
    const budget = new AdmissionBudget();
    const warns: string[] = [];
    const admission = new ConnectionAdmission(
      {
        open: () => {
          throw new Error("fabrique cassée");
        },
        deny: () => {},
        warn: (m) => warns.push(m),
      },
      budget,
      ALICE,
      true,
    );
    admission.request(
      "room:1",
      rule(() => Promise.resolve(true)),
    );
    await flush();
    assert.match(warns[0] ?? "", /room:1.*fabrique cassée/);
  });

  it("deux allow concurrents d'une classe qui mémorise `who` ne se croisent pas", async () => {
    // Une instance sert tous les abonnés EN MÊME TEMPS : chaque appel reçoit
    // SON identité, et son verdict revient à SA connexion, même résolus dans
    // l'ordre inverse.
    class RecordingAdmission {
      readonly seen: ISubscriberIdentity[] = [];
      readonly resolvers: Array<() => void> = [];
      allow(channel: string, who: ISubscriberIdentity): Promise<boolean> {
        this.seen.push(who);
        return new Promise((resolve) => {
          this.resolvers.push(() => resolve(channel === `user:${who.id}`));
        });
      }
    }
    const instance = new RecordingAdmission();
    const r = rule(instance.allow.bind(instance));
    const budget = new AdmissionBudget();
    const ra = recorder();
    const rb = recorder();
    new ConnectionAdmission(ra.host, budget, ALICE, true).request(
      "user:acc-alice",
      r,
    );
    const bob = new ConnectionAdmission(rb.host, budget, BOB, true);
    bob.request("user:acc-alice", r);
    bob.request("user:acc-bob", r);
    for (const resolve of instance.resolvers.slice().reverse()) resolve();
    await flush();
    assert.deepEqual(instance.seen, [ALICE, BOB, BOB]);
    assert.deepEqual(ra.opened, ["user:acc-alice"]);
    assert.deepEqual(rb.opened, ["user:acc-bob"]);
    assert.deepEqual(
      rb.denied.map((d) => [d.channel, d.reason]),
      [["user:acc-alice", "forbidden"]],
    );
  });
});

// ── Branchement au contrôleur ─────────────────────────────────────────────

const OPEN = 1;

function makeCtx() {
  const sent: Array<Record<string, unknown>> = [];
  let onFinish: (() => void) | null = null;
  const ctx = {
    type: "websocket",
    connection: {
      readyState: OPEN,
      send: (data: string, cb?: (err?: Error) => void) => {
        sent.push(JSON.parse(data));
        cb?.();
      },
      close: () => {},
    },
    once: (event: string, fn: () => void) => {
      if (event === "onFinish") onFinish = fn;
    },
    request: { headers: {}, url: "/realtime" },
    cookies: {},
    url: "/realtime",
    remoteAddress: "127.0.0.1",
    origin: "",
  };
  return { ctx, sent, fireFinish: () => onFinish?.() };
}

class AdmitRt extends RealtimeController {
  channelCalls: string[] = [];
  constructor(ctx: unknown) {
    super("admit-rt", ctx as ContextType);
  }
  override createRealtimeChannel(
    channel: string,
    _publish: RealtimePublish,
  ): (() => void) | null {
    this.channelCalls.push(channel);
    return () => {};
  }
  feed(message: string | null): void {
    this.handleRealtime(message);
  }
  subscribe(channel: string): void {
    this.feed(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "subscribe",
        params: { channel },
      }),
    );
  }
  unsubscribe(channel: string): void {
    this.feed(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "unsubscribe",
        params: { channel },
      }),
    );
  }
}

function tokenWith(
  who: ISubscriberIdentity | null,
  reads: { count: number } = { count: 0 },
): IRealtimeToken {
  const base: IRealtimeToken = {
    type: "session",
    getUserIdentifier: () => who?.userIdentifier ?? "anonymous",
    isAuthenticated: () => who?.authenticated ?? true,
    getRoles: () => ["ROLE_USER"],
    getScopes: () => [],
    getAttribute: () => undefined,
  };
  if (who === null) return base;
  return {
    ...base,
    getIdentity: () => {
      reads.count += 1;
      return who;
    },
  };
}

async function connect(token: IRealtimeToken, env?: string) {
  getRealtimeHub().useAuthenticator(
    { pattern: "/realtime" },
    { name: "fixe", supports: () => true, authenticate: async () => token },
  );
  const h = makeCtx();
  const rt = new AdmitRt(h.ctx);
  if (env !== undefined) {
    Object.defineProperty(rt, "kernel", { value: { environment: env } });
  }
  rt.feed(null);
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { ...h, rt };
}

const acks = (sent: Array<Record<string, unknown>>): unknown[] =>
  sent
    .filter((f) => f.method === "realtime:subscribed")
    .map((f) => (f.params as { channel: string }).channel);
const denials = (sent: Array<Record<string, unknown>>) =>
  sent
    .filter((f) => f.method === "realtime:denied")
    .map((f) => f.params as Record<string, unknown>);

describe("#622 — admission au subscribe, dans le contrôleur", () => {
  beforeEach(() => getRealtimeHub().clear());

  it("canal à allow synchrone : ouvert et acquitté ; canal SANS allow : l'identité n'est même pas lue", async () => {
    const reads = { count: 0 };
    getRealtimeHub().registerChannelPolicy("user:*", {
      allow: (channel, who) => channel === `user:${who.id}`,
    });
    const { rt, sent } = await connect(tokenWith(ALICE, reads));
    // Le `welcome` l'a lue à la poignée de main ; on compte à partir d'ici.
    reads.count = 0;
    rt.subscribe("tick");
    assert.equal(reads.count, 0, "aucun coût pour un canal sans allow");
    rt.subscribe("user:acc-alice");
    rt.subscribe("user:acc-bob");
    assert.deepEqual(acks(sent), ["tick", "user:acc-alice"]);
    assert.deepEqual(rt.channelCalls, ["tick", "user:acc-alice"]);
    assert.deepEqual(
      denials(sent).map((d) => [d.channel, d.reason]),
      [["user:acc-bob", "forbidden"]],
    );
    assert.equal(reads.count, 1, "identité lue UNE fois par connexion");
  });

  it("une politique plus spécifique SANS allow ouvre le canal (elle remplace celle du motif)", async () => {
    let calls = 0;
    getRealtimeHub().registerChannelPolicy("room:*", {
      allow: () => {
        calls += 1;
        return false;
      },
    });
    getRealtimeHub().registerChannelPolicy("room:lobby", {
      authenticated: false,
    });
    const { rt, sent } = await connect(tokenWith(ALICE));
    rt.subscribe("room:lobby");
    assert.deepEqual(acks(sent), ["room:lobby"]);
    assert.equal(calls, 0);
  });

  it("jeton sans getIdentity : forbidden, allow jamais appelé", async () => {
    let calls = 0;
    getRealtimeHub().registerChannelPolicy("user:*", {
      allow: () => {
        calls += 1;
        return true;
      },
    });
    const { rt, sent } = await connect(tokenWith(null), "development");
    rt.subscribe("user:acc-alice");
    assert.equal(calls, 0);
    const [denied] = denials(sent);
    assert.equal(denied?.reason, "forbidden");
    assert.match(String(denied?.detail), /getIdentity/);
  });

  it("le détail ne part qu'hors production — et jamais sans mode connu", async () => {
    getRealtimeHub().registerChannelPolicy("user:*", { allow: () => false });
    for (const [env, hasDetail] of [
      ["development", true],
      ["production", false],
      [undefined, false],
    ] as const) {
      const { rt, sent } = await connect(tokenWith(ALICE), env);
      rt.subscribe("user:acc-alice");
      const [denied] = denials(sent);
      assert.equal(denied?.reason, "forbidden");
      assert.equal("detail" in (denied ?? {}), hasDetail, `mode ${env}`);
    }
  });

  it("unsubscribe pendant l'attente, sans retour : verdict `true` jeté, aucun abonnement ni réponse", async () => {
    const d = deferred();
    getRealtimeHub().registerChannelPolicy("room:*", {
      allow: () => d.promise,
    });
    const { rt, sent } = await connect(tokenWith(ALICE));
    rt.subscribe("room:1");
    rt.unsubscribe("room:1");
    const before = sent.length;
    d.settle(true);
    await flush();
    assert.equal(sent.length, before);
    assert.deepEqual(rt.channelCalls, []);
  });

  it("production : le contrôleur ne fait rédiger aucun détail (message d'erreur lu pour le seul journal)", async () => {
    let reads = 0;
    const error = Object.setPrototypeOf(
      {
        get message(): string {
          reads += 1;
          return "secret";
        },
      },
      Error.prototype,
    );
    getRealtimeHub().registerChannelPolicy("room:*", {
      allow: () => {
        throw error;
      },
    });
    const { rt } = await connect(tokenWith(ALICE), "production");
    rt.subscribe("room:1");
    rt.subscribe("room:2");
    assert.equal(reads, 1);
  });

  it("unsubscribe pendant l'attente : pas d'abonnement ; subscribe de nouveau : ranimé, un seul appel", async () => {
    const d = deferred();
    let calls = 0;
    getRealtimeHub().registerChannelPolicy("room:*", {
      allow: () => {
        calls += 1;
        return d.promise;
      },
    });
    const { rt, sent } = await connect(tokenWith(ALICE));
    rt.subscribe("room:1");
    rt.unsubscribe("room:1");
    rt.subscribe("room:1");
    rt.subscribe("room:1");
    d.settle(true);
    await flush();
    assert.equal(calls, 1);
    assert.deepEqual(acks(sent), ["room:1"]);
    rt.unsubscribe("room:1");
    assert.equal(getRealtimeHub().subscriberCount("room:1"), 0);
  });

  it("les demandes en attente comptent dans le plafond de canaux (la file est bornée)", async () => {
    getRealtimeHub().setMaxChannelsPerConnection(2);
    getRealtimeHub().registerChannelPolicy("room:*", {
      allow: () => new Promise<boolean>(() => {}),
    });
    const { rt, sent } = await connect(tokenWith(ALICE));
    rt.subscribe("room:1");
    rt.subscribe("room:2");
    rt.subscribe("tick");
    assert.deepEqual(
      denials(sent).map((d) => [d.channel, d.reason]),
      [["tick", "limit"]],
    );
  });

  it("fermeture pendant l'attente : places du budget rendues, verdict tardif sans effet", async () => {
    const d = deferred();
    getRealtimeHub().registerChannelPolicy("room:*", {
      allow: () => d.promise,
    });
    const { rt, sent, fireFinish } = await connect(tokenWith(ALICE));
    rt.subscribe("room:1");
    assert.equal(getRealtimeHub().admissionBudget.pending, 1);
    fireFinish();
    assert.equal(getRealtimeHub().admissionBudget.pending, 0);
    const before = sent.length;
    d.settle(true);
    await flush();
    assert.equal(sent.length, before);
    assert.deepEqual(rt.channelCalls, []);
  });

  it("la sonde expose allowTimedOutTotal et allowSaturatedTotal ; clear() les remet à zéro", () => {
    const hub = getRealtimeHub();
    hub.setAdmissionLimits({
      authenticateTimeoutMs: 10_000,
      allowTimeoutMs: 100,
      maxPendingAllowsPerConnection: 1,
      maxPendingAllowsTotal: 1,
    });
    hub.admissionBudget.acquire();
    hub.admissionBudget.acquire();
    hub.admissionBudget.recordTimeout(performance.now());
    const probe = hub.probe();
    assert.equal(probe.allowTimedOutTotal, 1);
    assert.equal(probe.allowSaturatedTotal, 1);
    hub.clear();
    const after = hub.probe();
    assert.equal(after.allowTimedOutTotal, 0);
    assert.equal(after.allowSaturatedTotal, 0);
    assert.equal(hub.admissionBudget.timeoutMs, 5000);
  });
});

describe("#622 — configuration des admissions", () => {
  it("défauts : allowTimeoutMs 5000, maxPendingAllowsPerConnection 8, maxPendingAllowsTotal 512", () => {
    const cfg = realtimeConfigSchema.parse({});
    assert.equal(cfg.allowTimeoutMs, 5000);
    assert.equal(cfg.maxPendingAllowsPerConnection, 8);
    assert.equal(cfg.maxPendingAllowsTotal, 512);
  });

  for (const [key, value] of [
    ["allowTimeoutMs", 0],
    ["allowTimeoutMs", 1.5],
    ["allowTimeoutMs", 2_147_483_648],
    ["maxPendingAllowsPerConnection", 0],
    ["maxPendingAllowsTotal", -1],
  ] as const) {
    it(`refuse ${key} = ${value}`, () => {
      assert.equal(
        realtimeConfigSchema.safeParse({ [key]: value }).success,
        false,
      );
    });
  }
});
