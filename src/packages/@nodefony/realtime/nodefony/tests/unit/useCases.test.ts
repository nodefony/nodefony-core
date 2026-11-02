import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { RealtimeController } from "../../src/server/RealtimeController";
import { RealtimeChannel } from "../../decorators/realtimeDecorators";
import { getRealtimeHub } from "../../src/server/RealtimeHub";
import { createRealtimeHarness } from "../../testing/index";
import type { IRealtimeHarness } from "../../testing/index";
import { createTestIdentity } from "@nodefony/security/testing";
import {
  ArenaRealtime,
  positions,
  tick,
} from "../fixtures/use-cases/gameMoves";
import { MatchRealtime, players } from "../fixtures/use-cases/matchmaking";
import {
  RoomRealtime,
  exclude,
  guests,
} from "../fixtures/use-cases/privateRoom";
import { SensorRealtime } from "../fixtures/use-cases/sensors";
import { TaskRealtime, owners } from "../fixtures/use-cases/agentTask";
import { notifyInvoicePaid } from "../fixtures/use-cases/userNotifications";

/**
 * #700 — les exemples de `docs/cas-d-usage.md` sont EXÉCUTÉS ici. Chacun vit
 * une seule fois, sous `tests/fixtures/use-cases/` ; le dernier bloc compare la
 * page à ces fichiers, pour qu'un exemple corrigé d'un côté ne diverge pas de
 * l'autre en silence.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "..", "fixtures", "use-cases");
const pagePath = path.join(here, "..", "..", "..", "docs", "cas-d-usage.md");

let open: IRealtimeHarness<RealtimeController>[] = [];

async function connect<C extends RealtimeController>(
  make: (ctx: ConstructorParameters<typeof RealtimeController>[1]) => C,
  user: string,
  roles: string[] = ["ROLE_USER"],
): Promise<IRealtimeHarness<C>> {
  const h = createRealtimeHarness(make, {
    identity: createTestIdentity({ identifier: user, roles }),
    resetHub: open.length === 0,
  });
  await h.connect();
  open.push(h);
  return h;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const closedOf = (h: IRealtimeHarness<RealtimeController>): unknown[] =>
  h.received.filter((f) => f.method === "realtime:closed").map((f) => f.params);

afterEach(() => {
  for (const h of open) h.close();
  open = [];
  positions.clear();
  players.clear();
  guests.clear();
  owners.clear();
  getRealtimeHub().clear();
});

describe("#700 — cas d'usage du temps réel, exécutés", () => {
  it("jeu : seule la dernière position compte, diffusée au rythme du serveur", async () => {
    const h = await connect((ctx) => new ArenaRealtime(ctx), "alice", [
      "ROLE_PLAYER",
    ]);
    await h.subscribe("game:state");
    for (let x = 0; x < 60; x++) await h.notify("game:move", { x, y: 1 });
    await h.notify("game:move", { x: "pas un nombre", y: 1 });
    expect(h.messages("game:state")).to.have.length(0);
    tick();
    expect(h.messages("game:state")).to.deep.equal([
      { alice: { x: 59, y: 1 } },
    ]);
  });

  it("recherche de partie : abonné d'office, et l'appartenance survit à la reconnexion", async () => {
    const h = await connect((ctx) => new MatchRealtime(ctx), "alice");
    await h.notify("match:find");
    await flush();
    expect(h.subscriptions()).to.deep.equal(["match:42"]);
    // La reconnexion rejoue `subscribe` : `allow` lit l'appartenance écrite par `find`.
    h.close();
    const again = await connect((ctx) => new MatchRealtime(ctx), "alice");
    await again.subscribe("match:42");
    expect(again.denials()).to.have.length(0);
    const stranger = await connect((ctx) => new MatchRealtime(ctx), "mallory");
    await stranger.subscribe("match:42");
    expect(stranger.denials()).to.have.length(1);
  });

  it("salon privé : `allow` admet l'invité ; exclure coupe ET empêche de revenir", async () => {
    guests.set("room:7", new Set(["alice", "bob"]));
    const bob = await connect((ctx) => new RoomRealtime(ctx), "bob");
    await bob.subscribe("room:7");
    await flush();
    expect(bob.subscriptions()).to.deep.equal(["room:7"]);
    exclude("room:7", "bob");
    expect(closedOf(bob)).to.deep.equal([
      { channel: "room:7", reason: "evicted" },
    ]);
    await bob.subscribe("room:7");
    await flush();
    expect(bob.denials()).to.have.length(1);
  });

  it("sonde : une mesure valide part vers le tableau, une mesure malformée nulle part", async () => {
    const screen = await connect((ctx) => new SensorRealtime(ctx), "ops", [
      "ROLE_SUPERVISOR",
    ]);
    await screen.subscribe("sensor:dashboard");
    const probe = await connect((ctx) => new SensorRealtime(ctx), "probe-1");
    await probe.notify("sensor:reading", { probe: "four-3", value: 812 });
    await probe.notify("sensor:reading", { probe: "four-3" });
    expect(screen.messages("sensor:dashboard")).to.deep.equal([
      { probe: "four-3", value: 812 },
    ]);
  });

  it("notification privée : `publishToUser` n'atteint que la personne visée", async () => {
    const alice = await connect((ctx) => new SensorRealtime(ctx), "alice");
    const bob = await connect((ctx) => new SensorRealtime(ctx), "bob");
    await alice.subscribe("user:alice");
    await bob.subscribe("user:bob");
    notifyInvoicePaid("alice", "F-2026-001");
    expect(alice.messages("user:alice")).to.deep.equal([
      { kind: "invoice:paid", invoice: "F-2026-001" },
    ]);
    expect(bob.messages("user:bob")).to.have.length(0);
  });

  it("tâche d'agent : le demandeur suit sa progression, puis reçoit `ended`", async () => {
    const h = await connect((ctx) => new TaskRealtime(ctx), "alice");
    await h.notify("task:start");
    for (let i = 0; i < 10; i++) await flush();
    const [task] = h.subscriptions();
    expect(task).toMatch(/^task:/);
    expect(h.messages("task:start")).to.deep.equal([{ task }]);
    expect(h.messages(task ?? "")).to.deep.equal([
      { step: "lecture" },
      { step: "analyse" },
      { step: "rédaction" },
    ]);
    expect(closedOf(h)).to.deep.equal([{ channel: task, reason: "ended" }]);
  });
});

describe("#700 — un motif décoré pose la POLITIQUE, jamais la fabrique", () => {
  // Le skill livré montrait `@RealtimeChannel("room:*", { allow })` seul : la
  // politique couvre toute la famille, mais une fabrique décorée n'est trouvée
  // que par son nom EXACT — `room:42` n'en a pas. Sans `createRealtimeChannel`,
  // l'abonnement est refusé, et un test qui ne s'abonne jamais reste vert.
  class PolicyOnly extends RealtimeController {
    constructor(ctx: ConstructorParameters<typeof RealtimeController>[1]) {
      super("PolicyOnly", ctx);
    }
    @RealtimeChannel("room:*", { allow: () => true })
    room(): () => void {
      return () => {};
    }
  }
  class WithFactory extends PolicyOnly {
    override createRealtimeChannel(channel: string): (() => void) | null {
      return channel.startsWith("room:") ? () => {} : null;
    }
  }

  it("sans fabrique, `room:42` est refusé `unknown`", async () => {
    const h = await connect((ctx) => new PolicyOnly(ctx), "alice");
    await h.subscribe("room:42");
    await flush();
    expect(h.subscriptions()).to.deep.equal([]);
    expect(h.denials().map((d) => d.reason)).to.deep.equal(["unknown"]);
  });

  it("avec `createRealtimeChannel`, `room:42` est servi et `allow` tranche", async () => {
    const h = await connect((ctx) => new WithFactory(ctx), "alice");
    await h.subscribe("room:42");
    await flush();
    expect(h.subscriptions()).to.deep.equal(["room:42"]);
  });
});

describe("#700 — la page montre exactement les exemples exécutés", () => {
  // Fins de ligne normalisées : un poste Windows extrait la page en CRLF.
  const lf = (text: string): string => text.replaceAll("\r\n", "\n");
  const page = lf(readFileSync(pagePath, "utf8"));
  const names: string[] = [];
  const shown = new Map<string, string>();
  // Le formateur pose une ligne vide entre le marqueur et le bloc.
  for (const m of page.matchAll(
    /<!-- example: ([\w-]+\.ts) -->\n\n?```ts\n([\s\S]*?)```/g,
  )) {
    const [, name, body] = m;
    if (name === undefined || body === undefined) continue;
    names.push(name);
    shown.set(name, body);
  }
  const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith(".ts"));

  it("chaque exemple exécuté figure une fois dans la page, et la page n'en montre pas d'autre", () => {
    expect(names.sort()).to.deep.equal([...fixtures].sort());
  });

  it.each(fixtures)(
    "%s : le bloc de la page est le fichier exécuté",
    (name) => {
      const source = lf(
        readFileSync(path.join(fixturesDir, name), "utf8"),
      ).replaceAll('"../../../../index"', '"@nodefony/realtime"');
      expect(shown.get(name)).toBe(source);
    },
  );
});
