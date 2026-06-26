import { expect } from "chai";
import type { IIdempotencyStore } from "nodefony";
import { scheduleIdempotencyGc } from "../../src/idempotencyGc.js";

// Faux store d'idempotence minimal (contrat IIdempotencyStore). `gc` ajoutable
// pour simuler un store SQL (drizzle) vs un store à TTL natif (redis/memory).
function fakeStore(extra: Partial<IIdempotencyStore> = {}): IIdempotencyStore {
  return {
    begin: () => ({ state: "fresh" }),
    complete: () => {},
    abort: () => {},
    size: 0,
    ...extra,
  };
}

// Régression du « gc orphelin » : avant le fix, DrizzleIdempotencyStore.gc()
// existait mais n'était JAMAIS appelé (clés SQL expirées accumulées). Ces tests
// prouvent que le framework arme désormais un balayage SSI le store expose gc().
describe("scheduleIdempotencyGc — arme le gc SSI le store l'expose", () => {
  it("store SANS gc (redis TTL natif / memory purge passive) → null (rien à planifier)", () => {
    const armed = scheduleIdempotencyGc(fakeStore(), {
      intervalS: 600,
      jitter: false,
      onError: () => {},
    });
    expect(armed).to.equal(null);
  });

  it("store AVEC gc (drizzle SQL) → scheduler armé, runNow() APPELLE gc()", async () => {
    let calls = 0;
    const store = fakeStore({
      gc: async () => {
        calls++;
        return 0;
      },
    });
    const log: string[] = [];
    const armed = scheduleIdempotencyGc(store, {
      intervalS: 600,
      jitter: false,
      onError: () => {},
      log: (m) => log.push(m),
    });
    expect(armed).to.not.equal(null);
    expect(armed!.armed).to.equal(true);
    expect(log.join(" ")).to.contain("armed");
    await armed!.runNow();
    expect(calls).to.equal(1); // LE trou fermé : gc() est enfin DÉCLENCHÉ
    armed!.stop();
  });

  it("gc() reste lié à son store (this préservé via bind)", async () => {
    let seenThis: unknown = null;
    const store = fakeStore({
      gc(this: unknown) {
        seenThis = this;
        return Promise.resolve(0);
      },
    });
    const armed = scheduleIdempotencyGc(store, {
      intervalS: 600,
      jitter: false,
      onError: () => {},
    });
    await armed!.runNow();
    expect(seenThis).to.equal(store);
    armed!.stop();
  });

  it("intervalS:0 → scheduler créé mais DÉSARMÉ (délégation cron/k8s)", () => {
    const log: string[] = [];
    const armed = scheduleIdempotencyGc(fakeStore({ gc: async () => 0 }), {
      intervalS: 0,
      jitter: false,
      onError: () => {},
      log: (m) => log.push(m),
    });
    expect(armed!.armed).to.equal(false);
    expect(log.join(" ")).to.contain("disarmed");
  });
});
