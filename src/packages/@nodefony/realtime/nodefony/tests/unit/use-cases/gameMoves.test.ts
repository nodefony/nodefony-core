import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRealtimeHub } from "../../../../index";
import { createRealtimeHarness } from "../../../testing/index";
import type { IRealtimeHarness } from "../../../testing/index";
import {
  createTestFrameAuthorizer,
  createTestIdentity,
} from "@nodefony/security/testing";
import { createTestModule } from "nodefony/testing";
import {
  ArenaRealtime,
  ArenaService,
} from "../../fixtures/use-cases/gameMoves";

const open: IRealtimeHarness<ArenaRealtime>[] = [];
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
let arena: ArenaService;

async function connect(
  user: string,
  roles: string[],
): Promise<IRealtimeHarness<ArenaRealtime>> {
  // Le service passé à la main, comme l'injecteur le fait en production.
  const h = createRealtimeHarness((ctx) => new ArenaRealtime(ctx, arena), {
    identity: createTestIdentity({ identifier: user, roles }),
    // Le VRAI verrou du pare-feu : sans lui, `roles` n'est jugé par personne.
    frameAuthorizer: createTestFrameAuthorizer(getRealtimeHub()),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

describe("jeu — le serveur calcule les positions et les diffuse à son rythme", () => {
  // Le moteur ne tourne que quand le test avance l'horloge.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    arena = new ArenaService(createTestModule());
  });
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
    vi.useRealTimers();
  });

  it("soixante commandes, un seul état diffusé : celui que le serveur a calculé", async () => {
    const alice = await connect("alice", ["ROLE_PLAYER"]);
    await alice.subscribe("game:state");
    for (let i = 0; i < 59; i++) {
      await alice.notify("game:steer", { dx: 0, dy: 1 });
    }
    await alice.notify("game:steer", { dx: 1, dy: 0 }); // la dernière gagne
    await alice.notify("game:steer", { dx: "pas un nombre", dy: 0 });
    expect(alice.messages("game:state")).toHaveLength(0); // rien avant le pas
    vi.advanceTimersByTime(ArenaService.TICK_MS);
    expect(alice.messages("game:state")).toEqual([
      { alice: { x: 510, y: 500 } },
    ]);
  });

  it("une direction hors bornes ne téléporte personne", async () => {
    const mallory = await connect("mallory", ["ROLE_PLAYER"]);
    await mallory.subscribe("game:state");
    await mallory.notify("game:steer", { dx: 9999, dy: -9999 });
    vi.advanceTimersByTime(ArenaService.TICK_MS);
    // Un pas, à la vitesse du serveur : la triche ne passe pas par la socket.
    expect(arena.position("mallory")).toEqual({ x: 510, y: 490 });
  });

  it("le premier abonné démarre le moteur, le dernier l'arrête", async () => {
    const alice = await connect("alice", ["ROLE_PLAYER"]);
    await alice.notify("game:steer", { dx: 1, dy: 0 });
    vi.advanceTimersByTime(ArenaService.TICK_MS * 3);
    expect(arena.position("alice")).toBeUndefined(); // personne n'écoute : aucun pas

    await alice.subscribe("game:state");
    vi.advanceTimersByTime(ArenaService.TICK_MS * 3);
    expect(alice.messages("game:state")).toHaveLength(3);
    expect(arena.position("alice")).toEqual({ x: 530, y: 500 });

    await alice.unsubscribe("game:state");
    await flush();
    vi.advanceTimersByTime(ArenaService.TICK_MS * 3);
    expect(arena.position("alice")).toEqual({ x: 530, y: 500 }); // moteur arrêté
  });

  it("personne ne bouge : le serveur se tait", async () => {
    const alice = await connect("alice", ["ROLE_PLAYER"]);
    await alice.subscribe("game:state");
    await alice.notify("game:steer", { dx: 0, dy: 0 });
    vi.advanceTimersByTime(ArenaService.TICK_MS * 5);
    // Une arrivée au centre, puis rien : aucun état répété pour ne rien dire.
    expect(alice.messages("game:state")).toEqual([
      { alice: { x: 500, y: 500 } },
    ]);
  });

  it("sans ROLE_PLAYER, ni l'état ni les commandes", async () => {
    const watcher = await connect("watcher", ["ROLE_USER"]);
    await watcher.subscribe("game:state");
    await watcher.notify("game:steer", { dx: 1, dy: 1 });
    await flush();
    vi.advanceTimersByTime(ArenaService.TICK_MS);
    expect(watcher.denials().map((d) => d.channel)).toContain("game:state");
    expect(arena.position("watcher")).toBeUndefined();
  });
});
