import { expect } from "vitest";
import {
  RevocationWatch,
  REVOCATION_REVALIDATE_MS,
} from "../runtime/RevocationWatch";

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
