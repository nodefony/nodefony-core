import { expect } from "vitest";
import {
  RevocationWatch,
  REVOCATION_REVALIDATE_MS,
} from "../runtime/RevocationWatch";
import type { TokenStatus } from "../realtime/tokenStatus";

/**
 * Le registre des connexions longues à identité révocable — partagé par le hub
 * WebSocket et les flux SSE. Ce qu'il doit tenir : rien au repos, un tick qui
 * ferme ce qui est mort et seulement ça, fail-closed, et jamais deux fermetures.
 */

interface IEntry {
  valid: boolean | "throw" | undefined;
  revoked: number;
}

function watch(): RevocationWatch<IEntry> {
  return new RevocationWatch<IEntry>({
    isValid: (e) => {
      if (e.valid === "throw") throw new Error("store injoignable");
      return e.valid;
    },
    revoke: (e) => {
      e.revoked++;
    },
  });
}

const entry = (valid: IEntry["valid"]): IEntry => ({ valid, revoked: 0 });

describe("RevocationWatch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ferme une identité morte, garde une identité vivante", async () => {
    const w = watch();
    const dead = entry(false);
    const alive = entry(true);
    w.register(dead);
    w.register(alive);
    await w.revalidate();
    expect(dead.revoked).to.equal(1);
    expect(alive.revoked).to.equal(0);
    expect(w.size).to.equal(1);
    w.unregister(alive);
  });

  it("rien à re-valider (`undefined`) : l'entrée reste", async () => {
    const w = watch();
    const e = entry(undefined);
    w.register(e);
    await w.revalidate();
    expect(e.revoked).to.equal(0);
    w.unregister(e);
  });

  it("fail-closed : une re-validation qui lève ferme la connexion", async () => {
    const w = watch();
    const e = entry("throw");
    w.register(e);
    await w.revalidate();
    expect(e.revoked).to.equal(1);
  });

  it("une connexion révoquée sort du registre : jamais refermée au tick suivant", async () => {
    const w = watch();
    const e = entry(false);
    w.register(e);
    await w.revalidate();
    await w.revalidate();
    expect(e.revoked).to.equal(1);
    expect(w.size).to.equal(0);
  });

  it("le tick part toutes les REVOCATION_REVALIDATE_MS, et s'arrête quand le registre se vide", async () => {
    vi.useFakeTimers();
    const w = watch();
    expect(vi.getTimerCount(), "aucun minuteur au repos").to.equal(0);
    const e = entry(true);
    w.register(e);
    expect(vi.getTimerCount()).to.equal(1);
    e.valid = false;
    await vi.advanceTimersByTimeAsync(REVOCATION_REVALIDATE_MS - 1);
    expect(e.revoked, "pas avant la fenêtre").to.equal(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(e.revoked, "fermée dans la fenêtre").to.equal(1);
    expect(vi.getTimerCount(), "registre vide → minuteur arrêté").to.equal(0);
  });

  it("🔴 une passe plus longue que la période ne se chevauche jamais avec la suivante", async () => {
    vi.useFakeTimers();
    let calls = 0;
    let release: (valid: boolean) => void = () => {};
    const w = new RevocationWatch<string>({
      isValid: () => {
        calls++;
        return new Promise<boolean>((resolve) => {
          release = resolve;
        });
      },
      revoke: () => {},
    });
    w.register("lente");
    // Trois périodes s'écoulent pendant que la relecture de la première passe attend.
    await vi.advanceTimersByTimeAsync(REVOCATION_REVALIDATE_MS * 3);
    expect(calls, "une seule relecture en vol").to.equal(1);
    const manual = w.revalidate();
    expect(calls, "un appel direct rejoint la passe en cours").to.equal(1);
    release(true);
    await manual;
    await vi.advanceTimersByTimeAsync(REVOCATION_REVALIDATE_MS);
    expect(calls, "la passe finie, le tick suivant relit").to.equal(2);
    release(true);
    await vi.advanceTimersByTimeAsync(0);
    w.unregister("lente");
  });

  it("une revoke qui lève n'interrompt pas la passe", async () => {
    const closed: string[] = [];
    const w = new RevocationWatch<string>({
      isValid: () => false,
      revoke: (name) => {
        if (name === "a") throw new Error("déjà fermée");
        closed.push(name);
      },
    });
    w.register("a");
    w.register("b");
    await w.revalidate();
    expect(closed).to.deep.equal(["b"]);
    expect(w.size).to.equal(0);
  });
});

describe("RevocationWatch.refreshIdentity — droits changés (#591)", () => {
  interface IConn {
    who: string;
    refreshed: number;
    revoked: number;
  }
  const conn = (who: string): IConn => ({ who, refreshed: 0, revoked: 0 });

  it("🔴 ferme TOUT DE SUITE les connexions de l'identité, par `refresh`, et elles seules", () => {
    const w = new RevocationWatch<IConn>({
      isValid: () => true,
      revoke: (c) => void c.revoked++,
      identityOf: (c) => c.who,
      refresh: (c) => void c.refreshed++,
    });
    const a = conn("boss");
    const b = conn("boss");
    const other = conn("alice");
    for (const c of [a, b, other]) w.register(c);
    expect(w.refreshIdentity("boss")).to.equal(2);
    expect([a.refreshed, b.refreshed, other.refreshed]).to.deep.equal([
      1, 1, 0,
    ]);
    expect(a.revoked, "refresh, pas revoke : l'identité est vivante").to.equal(
      0,
    );
    expect(w.size, "retirées du registre").to.equal(1);
    expect(w.refreshIdentity("boss"), "jamais deux fermetures").to.equal(0);
    w.unregister(other);
  });

  it("sans `refresh`, c'est `revoke` qui ferme ; sans `identityOf`, rien", () => {
    const withRevoke = new RevocationWatch<IConn>({
      isValid: () => true,
      revoke: (c) => void c.revoked++,
      identityOf: (c) => c.who,
    });
    const a = conn("boss");
    withRevoke.register(a);
    withRevoke.refreshIdentity("boss");
    expect(a.revoked).to.equal(1);

    const blind = new RevocationWatch<IConn>({
      isValid: () => true,
      revoke: (c) => void c.revoked++,
    });
    const b = conn("boss");
    blind.register(b);
    expect(blind.refreshIdentity("boss")).to.equal(0);
    blind.unregister(b);
  });
});

describe("RevocationWatch — la cause voyage jusqu'à revoke (ADR-0021 §S11)", () => {
  type Entry = { name: string; status?: TokenStatus; valid?: boolean };
  function run(entries: Entry[], statusThrows = false) {
    const revoked: Array<[string, string]> = [];
    const watch = new RevocationWatch<Entry>({
      isValid: (e) => e.valid,
      status: (e) => {
        if (statusThrows) throw new Error("store down");
        return e.status;
      },
      revoke: (e, status) => revoked.push([e.name, status]),
    });
    for (const e of entries) watch.register(e);
    return { watch, revoked };
  }

  it("`expired` et `revoked` arrivent tels quels ; `active` garde l'entrée", async () => {
    const { watch, revoked } = run([
      { name: "a", status: "expired" },
      { name: "b", status: "revoked" },
      { name: "c", status: "active" },
    ]);
    await watch.revalidate();
    expect(revoked).to.deep.equal([
      ["a", "expired"],
      ["b", "revoked"],
    ]);
    expect(watch.size).to.equal(1);
  });

  it("sans cause, `isValid` décide : son `false` vaut `revoked`", async () => {
    const { watch, revoked } = run([{ name: "s", valid: false }]);
    await watch.revalidate();
    expect(revoked).to.deep.equal([["s", "revoked"]]);
  });

  it("fail-closed : une cause qui lève vaut `revoked`", async () => {
    const { watch, revoked } = run([{ name: "x", status: "active" }], true);
    await watch.revalidate();
    expect(revoked).to.deep.equal([["x", "revoked"]]);
  });
});
