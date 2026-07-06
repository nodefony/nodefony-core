/// <reference types="node" />
import { expect } from "chai";
import { vi } from "vitest";
import MemorySessionStorage from "../../src/session/storage/MemorySessionStorage.js";
import type { ISerializedSession } from "../../interfaces/ISession.js";

/**
 * Store de sessions **en mémoire** (repli volatil, dev/charge/CI) — contrat
 * {@link import("../../interfaces/ISession").ISessionStorage} : CRUD, comptage,
 * énumération, et l'invariant de sécurité `createdAt` (borne absolute) PRÉSERVÉ
 * aux ré-écritures (un autosave ne doit jamais repousser l'absolute).
 */

function makeStorage(idle = 3600, absolute = 0): MemorySessionStorage {
  const manager = {
    options: {
      idleTimeoutS: idle,
      absoluteTimeoutS: absolute,
      store: "memory",
    },
    log: () => undefined,
  };
  return new MemorySessionStorage(
    manager as unknown as ConstructorParameters<typeof MemorySessionStorage>[0],
  );
}

const blob = (user = ""): ISerializedSession =>
  ({ Attributes: {}, metaBag: {}, flashBag: {}, user }) as ISerializedSession;

describe("MemorySessionStorage — CRUD + horodatages", () => {
  it("write + start round-trip (start d'une session absente → {})", async () => {
    const s = makeStorage();
    expect(await s.start("nope")).to.deep.equal({});
    await s.write("sid", blob("alice"));
    expect((await s.start("sid")).user).to.equal("alice");
  });

  it("start renvoie une COPIE (le consommateur ne mute pas le store)", async () => {
    const s = makeStorage();
    await s.write("sid", blob("alice"));
    const read = await s.start("sid");
    read.user = "mallory"; // mutation locale
    expect((await s.start("sid")).user, "store intact").to.equal("alice");
  });

  it("write pose createdAt à la création + updatedAt à chaque écriture", async () => {
    vi.useFakeTimers();
    try {
      const s = makeStorage();
      await s.write("sid", blob("alice"));
      const first = await s.start("sid");
      const created = (first.createdAt as Date).getTime();
      vi.advanceTimersByTime(5_000);
      await s.write("sid", blob("alice")); // ré-écriture (autosave)
      const second = await s.start("sid");
      // INVARIANT ABSOLUTE : createdAt inchangé malgré la ré-écriture.
      expect((second.createdAt as Date).getTime(), "createdAt figé").to.equal(
        created,
      );
      // updatedAt suit l'écriture (borne idle glissante).
      expect(
        (second.updatedAt as Date).getTime(),
        "updatedAt rafraîchi",
      ).to.equal(created + 5_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("touch rafraîchit updatedAt SANS toucher createdAt", async () => {
    vi.useFakeTimers();
    try {
      const s = makeStorage();
      await s.write("sid", blob("alice"));
      const created = ((await s.start("sid")).createdAt as Date).getTime();
      vi.advanceTimersByTime(3_000);
      await s.touch("sid");
      const after = await s.start("sid");
      expect((after.createdAt as Date).getTime()).to.equal(created);
      expect((after.updatedAt as Date).getTime()).to.equal(created + 3_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("touch d'une session absente = no-op (pas de throw, rien créé)", async () => {
    const s = makeStorage();
    await s.touch("ghost");
    expect(await s.start("ghost")).to.deep.equal({});
  });

  it("destroy retire la session (idempotent)", async () => {
    const s = makeStorage();
    await s.write("sid", blob("alice"));
    expect(await s.destroy("sid")).to.equal(true);
    expect(await s.start("sid")).to.deep.equal({});
    expect(await s.destroy("sid"), "2e destroy ne throw pas").to.equal(true);
  });

  it("open compte les sessions présentes ; close → true", async () => {
    const s = makeStorage();
    await s.write("a", blob("alice"));
    await s.write("b", blob("bob"));
    expect(await s.open()).to.equal(2);
    expect(s.close()).to.equal(true);
  });
});
