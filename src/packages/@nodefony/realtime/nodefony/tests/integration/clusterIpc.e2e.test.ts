/**
 * E2E cluster IPC : la pile realtime distribuée prouvée bout-en-bout SANS infra
 * Redis — juste `node:child_process.fork` + `ClusterRelay` côté master.
 *
 * Topologie reproduite :
 *
 *   master (ce test)                worker A (fork)               worker B (fork)
 *   ────────────────                ────────────────                ────────────────
 *   ClusterRelay         <-- IPC --> ClusterBackplane               ClusterBackplane
 *     • route CLUSTER_RT_KIND       • processIpcTransport          • processIpcTransport
 *     • anti-echo de routage          (process.send/on)              (process.send/on)
 *     • rebroadcast aux AUTRES      • anti-echo originId           • anti-echo originId
 *                                   • RealtimeHub singleton         • RealtimeHub singleton
 *                                     (getRealtimeHub per-process)    (per-process)
 *
 * Cette suite verrouille la promesse « Socket distribuée cluster prête prod »
 * SANS Redis. Elle prouve :
 *  1. fan-out cross-process : publish hubA → sink hubB livré
 *  2. fan-out N>2 workers : publish hubA → sinks hubB ET hubC livrés
 *  3. anti-écho ceinture+bretelles dans des VRAIS process : A ne reçoit que son
 *     fan-out local, jamais le rebound via le backplane (compteur strict)
 *  4. canal NON broadcast (instance-local) : publish A → B ne reçoit RIEN
 *  5. publish duplex : A publish→B reçoit, puis B publish→A reçoit
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fork, type ChildProcess, type Serializable } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ClusterRelay, type IRelayWorker, CLUSTER_RT_KIND } from "nodefony";
import {
  openTab as openScreenTab,
  screenOf,
  settledOn,
  viewsOf,
} from "../helpers/presenceScreen.js";

const WORKER_PATH = fileURLToPath(
  new URL("./clusterIpcWorker.ts", import.meta.url),
);

// e2e LOURD : fork de N workers (tsx) → sensible à la contention CPU. Dans le
// gate par défaut (`npm test`, 30+ workspaces en parallèle), le boot worker peut
// dépasser le ready timeout → faux négatif. Opt-in (doctrine perf/e2e opt-in,
// cf feedback_perf_tests_optin). Lancer : `NF_RUN_CLUSTER_E2E=1 npm test`.
const NF_RUN_CLUSTER_E2E = process.env.NF_RUN_CLUSTER_E2E === "1";

interface AnyMsg {
  cmd?: string;
  op?: string;
  channel?: string;
  payload?: unknown;
  pid?: number;
  subs?: Record<string, number>;
  kind?: unknown;
  /** `compte → raisons` des `realtime:closed` reçus (commande `closed`, #623). */
  closed?: unknown;
  /** Présence lue sur un worker (commande `presence`, #760). */
  members?: Record<string, number>;
  unnamed?: number;
  partial?: boolean | null;
  probe?: { endedTotal: number; forgottenTotal: number } | null;
  /** Onglet de navigateur d'un instantané poussé à l'écran (`browser-view`, #760). */
  tab?: string;
  ready?: boolean;
  count?: number;
}

interface ForkedWorker {
  child: ChildProcess;
  pid: number;
  events: AnyMsg[];
  awaitEvent: (
    predicate: (e: AnyMsg) => boolean,
    timeoutMs?: number,
  ) => Promise<AnyMsg>;
}

/** Texte d'une charge `{ text }` (une charge est un objet : ADR-0021 S1). */
function textOf(payload: unknown): unknown {
  return typeof payload === "object" && payload !== null && "text" in payload
    ? payload.text
    : undefined;
}

function spawnWorker(): Promise<ForkedWorker> {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER_PATH, [], {
      execArgv: ["--import", "tsx"],
      stdio: "inherit",
      env: {
        ...process.env,
        // Pas de tâches collatérales : on n'instancie pas le kernel ici.
        NF_CLUSTER: "0",
      },
    });
    const events: AnyMsg[] = [];
    const onMsg = (raw: unknown) => {
      const m = raw as AnyMsg;
      // On n'archive PAS les enveloppes realtime : elles sont consommées par le
      // ClusterRelay, et leur réception côté master est purement transport.
      if (m && typeof m === "object" && m.kind === CLUSTER_RT_KIND) return;
      events.push(m);
    };
    child.on("message", onMsg);
    child.on("error", reject);

    const tReady = setTimeout(
      () => reject(new Error("worker fork: ready timeout")),
      5000,
    );
    const onReady = (raw: unknown) => {
      const m = raw as AnyMsg;
      if (m?.cmd !== "ready") return;
      clearTimeout(tReady);
      child.off("message", onReady);
      const w: ForkedWorker = {
        child,
        pid: m.pid as number,
        events,
        awaitEvent(predicate, timeoutMs = 3000) {
          return new Promise<AnyMsg>((res, rej) => {
            const existing = events.find(predicate);
            if (existing) return res(existing);
            const t = setTimeout(
              () => rej(new Error("awaitEvent: timeout")),
              timeoutMs,
            );
            const onMore = (raw: unknown) => {
              const mm = raw as AnyMsg;
              if (mm && typeof mm === "object" && mm.kind === CLUSTER_RT_KIND)
                return;
              if (predicate(mm)) {
                clearTimeout(t);
                child.off("message", onMore);
                res(mm);
              }
            };
            child.on("message", onMore);
          });
        },
      };
      resolve(w);
    };
    child.on("message", onReady);
  });
}

function asRelayWorker(w: ForkedWorker): IRelayWorker {
  return {
    id: w.pid,
    send(msg) {
      // `IRelayWorker.send` est typé `unknown` (contrat générique du relay), alors que
      // l'IPC Node exige un `Serializable`. Les messages du relay realtime sont des
      // objets JSON purs (structuredClone-ables) → narrowing explicite assumé.
      // Robustesse : worker en cours de drain → on ignore l'EPIPE.
      try {
        w.child.send(msg as Serializable);
      } catch {
        /* worker fermé entre-temps */
      }
    },
    onMessage(cb) {
      w.child.on("message", (raw) => cb(raw));
    },
  };
}

async function killWorker(w: ForkedWorker): Promise<void> {
  return new Promise((resolve) => {
    if (w.child.exitCode !== null || w.child.signalCode !== null) {
      return resolve();
    }
    const done = () => resolve();
    w.child.once("exit", done);
    try {
      w.child.send({ cmd: "quit" });
    } catch {
      /* déjà mort */
    }
    setTimeout(() => {
      try {
        w.child.kill("SIGKILL");
      } catch {
        /* idem */
      }
      done();
    }, 1500);
  });
}

describe.skipIf(!NF_RUN_CLUSTER_E2E)(
  "e2e cluster IPC (Hub + ClusterBackplane + ClusterRelay)",
  () => {
    let workers: ForkedWorker[] = [];
    let relay: ClusterRelay;

    beforeEach(() => {
      relay = new ClusterRelay();
      workers = [];
    });

    afterEach(async () => {
      await Promise.all(workers.map(killWorker));
      relay.clear();
    });

    async function spawnN(n: number): Promise<ForkedWorker[]> {
      const list = await Promise.all(
        Array.from({ length: n }, () => spawnWorker()),
      );
      for (const w of list) relay.attach(asRelayWorker(w));
      workers.push(...list);
      return list;
    }

    async function subscribeAll(
      list: ForkedWorker[],
      channel: string,
    ): Promise<void> {
      for (const w of list) w.child.send({ cmd: "subscribe", channel });
      await Promise.all(
        list.map((w) =>
          w.awaitEvent(
            (e) =>
              e.cmd === "ack" && e.op === "subscribe" && e.channel === channel,
          ),
        ),
      );
    }

    it("fan-out cross-process : publish worker A → worker B reçoit", async () => {
      const [a, b] = await spawnN(2);
      await subscribeAll([a!, b!], "chat:room-1");

      a!.child.send({
        cmd: "publish",
        channel: "chat:room-1",
        payload: { text: "hello-from-A" },
      });

      const got = await b!.awaitEvent(
        (e) => e.cmd === "got" && e.channel === "chat:room-1",
      );
      expect(got.payload).toEqual({ text: "hello-from-A" });
      expect(got.pid).toBe(b!.pid);
      expect(b!.pid).not.toBe(a!.pid); // vraiment 2 process distincts
      expect(relay.relayedTotal).toBe(1);
    });

    it("fan-out N>2 workers : publish A → B et C reçoivent (rebroadcast multi)", async () => {
      const [a, b, c] = await spawnN(3);
      await subscribeAll([a!, b!, c!], "presence:zone-A");

      a!.child.send({
        cmd: "publish",
        channel: "presence:zone-A",
        payload: { user: "alice", at: 42 },
      });

      const [gb, gc] = await Promise.all([
        b!.awaitEvent(
          (e) => e.cmd === "got" && e.channel === "presence:zone-A",
        ),
        c!.awaitEvent(
          (e) => e.cmd === "got" && e.channel === "presence:zone-A",
        ),
      ]);
      expect(gb.payload).toEqual({ user: "alice", at: 42 });
      expect(gc.payload).toEqual({ user: "alice", at: 42 });
      expect(relay.relayedTotal).toBe(1);
    });

    it("anti-écho strict : worker A ne reçoit son propre publish QUE via fan-out local (jamais rebound backplane)", async () => {
      const [a, b] = await spawnN(2);
      await subscribeAll([a!, b!], "chat:room-1");

      a!.child.send({
        cmd: "publish",
        channel: "chat:room-1",
        payload: { text: "echo-test" },
      });
      // attend que B reçoive — preuve que le rebroadcast a eu lieu
      await b!.awaitEvent(
        (e) => e.cmd === "got" && e.channel === "chat:room-1",
      );
      // laisse une fenêtre pour qu'un éventuel echo cross-process arrive
      await new Promise((r) => setTimeout(r, 150));

      // Demande les stats à A : il a publié → fan-out local = 1, anti-écho cross-process = 0
      a!.child.send({ cmd: "stats" });
      const stats = await a!.awaitEvent((e) => e.cmd === "stats");
      expect(stats.subs).toEqual({ "chat:room-1": 1 });
    });

    it("publish duplex : A→B puis B→A, chacun reçoit l'autre exactement 1 fois", async () => {
      const [a, b] = await spawnN(2);
      await subscribeAll([a!, b!], "chat:duplex");

      a!.child.send({
        cmd: "publish",
        channel: "chat:duplex",
        payload: { text: "ping" },
      });
      await b!.awaitEvent(
        (e) =>
          e.cmd === "got" &&
          e.channel === "chat:duplex" &&
          textOf(e.payload) === "ping",
      );

      b!.child.send({
        cmd: "publish",
        channel: "chat:duplex",
        payload: { text: "pong" },
      });
      await a!.awaitEvent(
        (e) =>
          e.cmd === "got" &&
          e.channel === "chat:duplex" &&
          textOf(e.payload) === "pong",
      );
      await new Promise((r) => setTimeout(r, 100));

      a!.child.send({ cmd: "stats" });
      b!.child.send({ cmd: "stats" });
      const [sa, sb] = await Promise.all([
        a!.awaitEvent((e) => e.cmd === "stats"),
        b!.awaitEvent((e) => e.cmd === "stats"),
      ]);
      // A a publié "ping" (fan-out local) + reçu "pong" de B = 2 livraisons
      expect(sa.subs).toEqual({ "chat:duplex": 2 });
      // B a reçu "ping" de A + publié "pong" (fan-out local) = 2 livraisons
      expect(sb.subs).toEqual({ "chat:duplex": 2 });
      expect(relay.relayedTotal).toBe(2);
    });

    it("#623 — éjecter un compte puis terminer un canal, donnés sur A, atteignent les connexions servies par B", async () => {
      const [a, b] = await spawnN(2);
      const memberOn = async (w: ForkedWorker, user: string): Promise<void> => {
        // `awaitEvent` relit les événements déjà reçus : sans purge, l'ack du
        // membre précédent répondrait pour celui-ci, encore en vol.
        w.events.length = 0;
        w.child.send({ cmd: "member", channel: "room:ipc", user });
        await w.awaitEvent(
          (e) => e.cmd === "ack" && e.op === "member" && e.pid === w.pid,
        );
      };
      await memberOn(b!, "alice");
      await memberOn(b!, "alice");
      await memberOn(b!, "bob");
      /** Les fins reçues par les connexions de B, relues jusqu'à `expected`. */
      const closedOnB = async (
        expected: Record<string, string[]>,
      ): Promise<unknown> => {
        const end = Date.now() + 3000;
        for (;;) {
          b!.events.length = 0;
          b!.child.send({ cmd: "closed" });
          const got = await b!.awaitEvent((e) => e.cmd === "closed");
          if (
            JSON.stringify(got.closed) === JSON.stringify(expected) ||
            Date.now() > end
          )
            return got.closed;
          await new Promise((r) => setTimeout(r, 20));
        }
      };

      a!.child.send({ cmd: "evict-user", channel: "room:ipc", user: "alice" });
      const evicted = { alice: ["evicted", "evicted"] };
      expect(await closedOnB(evicted)).toEqual(evicted);

      a!.child.send({ cmd: "close-channel", channel: "room:ipc" });
      const ended = { alice: ["evicted", "evicted"], bob: ["ended"] };
      expect(await closedOnB(ended)).toEqual(ended);
    });

    /** Pose un présent sur `w` (`user` absent = anonyme) et attend son acquittement. */
    async function presenceMember(
      w: ForkedWorker,
      channel: string,
      user?: string,
    ): Promise<void> {
      w.events.length = 0;
      w.child.send({ cmd: "presence-member", channel, user: user ?? "" });
      await w.awaitEvent((e) => e.cmd === "ack" && e.op === "presence-member");
    }

    /** Relit la présence de `channel` sur `w` jusqu'à `done` (ou l'échéance). */
    async function presenceOn(
      w: ForkedWorker,
      channel: string,
      done: (e: AnyMsg) => boolean,
      timeoutMs = 3000,
    ): Promise<AnyMsg> {
      const end = Date.now() + timeoutMs;
      for (;;) {
        w.events.length = 0;
        w.child.send({ cmd: "presence", channel });
        const got = await w.awaitEvent((e) => e.cmd === "presence");
        if (done(got) || Date.now() > end) return got;
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    const same = (a: unknown, b: unknown): boolean =>
      JSON.stringify(a) === JSON.stringify(b);

    it("#760 — présence entre deux PROCESSUS : une identité dans deux onglets sur deux workers = UN présent ; l'anonyme compte dans `unnamed`", async () => {
      const [a, b] = await spawnN(2);
      await presenceMember(a!, "pres:1", "alice");
      await presenceMember(a!, "pres:1");
      await presenceMember(b!, "pres:1", "alice");
      await presenceMember(b!, "pres:1", "bob");
      const want = { alice: 2, bob: 1 };
      const onB = await presenceOn(
        b!,
        "pres:1",
        (e) => same(e.members, want) && e.unnamed === 1 && e.partial === false,
      );
      expect(onB).to.deep.include({
        members: want,
        unnamed: 1,
        partial: false,
      });
      const onA = await presenceOn(a!, "pres:1", (e) => same(e.members, want));
      expect(onA.members).toEqual(want);
    });

    it("🔴 #760 — arrêt propre de A (séquence de `Kernel.terminate`) : ses présents quittent B par la preuve de vie FINALE, pas par l'oubli", async () => {
      const [a, b] = await spawnN(2);
      await presenceMember(a!, "pres:1", "alice");
      await presenceMember(a!, "pres:1");
      await presenceMember(b!, "pres:1", "bob");
      await presenceOn(b!, "pres:1", (e) =>
        same(e.members, { alice: 1, bob: 1 }),
      );
      const exited = new Promise((r) => a!.child.once("exit", r));
      a!.child.send({ cmd: "presence-terminate" });
      await exited;
      // Bien avant le délai d'oubli (15 s) : seule la fin annoncée l'explique.
      const after = await presenceOn(
        b!,
        "pres:1",
        (e) => same(e.members, { bob: 1 }) && e.unnamed === 0,
      );
      expect(after).to.deep.include({ members: { bob: 1 }, unnamed: 0 });
      expect(after.probe).to.deep.include({ endedTotal: 1, forgottenTotal: 0 });
    });

    it("🔴 #760 — A vivant et calme n'est jamais oublié ; A tué (SIGKILL) disparaît de B au délai d'oubli", async () => {
      const [a, b] = await spawnN(2);
      await presenceMember(a!, "pres:1", "alice");
      await presenceMember(b!, "pres:1", "bob");
      await presenceOn(b!, "pres:1", (e) =>
        same(e.members, { alice: 1, bob: 1 }),
      );
      // Calme au-delà du délai d'oubli (3 × 5 s) : seules les preuves de vie passent.
      await new Promise((r) => setTimeout(r, 20_000));
      const calm = await presenceOn(b!, "pres:1", () => true);
      expect(calm.members).toEqual({ alice: 1, bob: 1 });
      expect(calm.probe?.forgottenTotal).toBe(0);

      const exited = new Promise((r) => a!.child.once("exit", r));
      a!.child.kill("SIGKILL");
      await exited;
      const after = await presenceOn(
        b!,
        "pres:1",
        (e) => same(e.members, { bob: 1 }),
        25_000,
      );
      expect(after.members).toEqual({ bob: 1 });
      expect(after.probe).to.deep.include({ forgottenTotal: 1, endedTotal: 0 });
    }, 60_000);

    /** Onglet de navigateur affichant `pres:screen` (aide commune aux bancs IPC et Redis). */
    const openTab = (w: ForkedWorker, tab: string, user?: string) =>
      openScreenTab(w, tab, "pres:screen", user);

    it("#760 — l'ÉCRAN : un onglet sur A est affiché par l'onglet de Bob sur B ; une identité dans deux onglets sur deux pods = UN présent ; l'anonyme dans `unnamed`", async () => {
      const [a, b] = await spawnN(2);
      await openTab(a!, "a-alice", "alice");
      await openTab(a!, "a-anon");
      await openTab(b!, "b-alice", "alice");
      await openTab(b!, "b-bob", "bob");
      const want = { alice: 2, bob: 1 };
      for (const [w, tab] of [
        [b!, "b-bob"],
        [b!, "b-alice"],
        [a!, "a-alice"],
        [a!, "a-anon"],
      ] as const) {
        const screen = await screenOf(w, tab, settledOn(want, 1));
        expect(screen, tab).to.deep.include({
          ready: true,
          partial: false,
          count: 2,
          unnamed: 1,
          members: want,
        });
      }
    });

    it("🔴 #760 — l'ÉCRAN : arrêt propre de A → Alice quitte l'écran de Bob par la fin annoncée, sans oubli", async () => {
      const [a, b] = await spawnN(2);
      await openTab(a!, "a-alice", "alice");
      await openTab(b!, "b-bob", "bob");
      await screenOf(b!, "b-bob", settledOn({ alice: 1, bob: 1 }));
      const exited = new Promise((r) => a!.child.once("exit", r));
      a!.child.send({ cmd: "presence-terminate" });
      await exited;
      const screen = await screenOf(b!, "b-bob", settledOn({ bob: 1 }));
      expect(screen).to.deep.include({
        ready: true,
        partial: false,
        members: { bob: 1 },
      });
      // La fin annoncée l'explique, pas l'oubli (délai de 15 s).
      const probe = await presenceOn(b!, "pres:screen", () => true);
      expect(probe.probe).to.deep.include({ endedTotal: 1, forgottenTotal: 0 });
    });

    it("🔴 #760 — l'ÉCRAN : A vivant et calme ne quitte jamais l'écran de Bob ; A tué (SIGKILL) en sort au délai d'oubli", async () => {
      const [a, b] = await spawnN(2);
      await openTab(a!, "a-alice", "alice");
      await openTab(b!, "b-bob", "bob");
      const both = settledOn({ alice: 1, bob: 1 });
      expect(await screenOf(b!, "b-bob", both)).to.deep.include({
        ready: true,
        partial: false,
        members: { alice: 1, bob: 1 },
      });
      const mark = b!.events.length;
      // Calme au-delà du délai d'oubli (3 × 5 s) : seules les preuves de vie passent.
      await new Promise((r) => setTimeout(r, 20_000));
      // Témoin : aucun instantané poussé pendant le calme n'a retiré Alice.
      for (const view of viewsOf(b!, "b-bob", mark))
        expect(view.members, "poussé pendant le calme").to.have.property(
          "alice",
        );
      expect(both(await screenOf(b!, "b-bob", () => true))).toBe(true);

      const exited = new Promise((r) => a!.child.once("exit", r));
      a!.child.kill("SIGKILL");
      await exited;
      const screen = await screenOf(b!, "b-bob", settledOn({ bob: 1 }), 25_000);
      expect(screen).to.deep.include({ partial: false, members: { bob: 1 } });
      const probe = await presenceOn(b!, "pres:screen", () => true);
      expect(probe.probe).to.deep.include({ forgottenTotal: 1, endedTotal: 0 });
    }, 60_000);

    it("#760 — l'ÉCRAN : la connexion de Bob tombe → sa vue se FIGE (`partial`, Alice gardée), puis se refonde à la reconnexion", async () => {
      const [a, b] = await spawnN(2);
      await openTab(a!, "a-alice", "alice");
      await openTab(b!, "b-bob", "bob");
      const both = settledOn({ alice: 1, bob: 1 });
      await screenOf(b!, "b-bob", both);
      // Réseau coupé : aucune reconnexion tant que `resume` n'est pas donné, donc
      // ce que l'écran montre ici ne peut venir que de la CHUTE.
      b!.child.send({ cmd: "presence-browser-drop", tab: "b-bob" });
      const frozen = await screenOf(b!, "b-bob", (e) => e.partial === true);
      expect(frozen, "vue figée à la chute").to.deep.include({
        ready: true,
        partial: true,
        members: { alice: 1, bob: 1 },
      });
      const mark = b!.events.length;
      b!.child.send({ cmd: "presence-browser-resume", tab: "b-bob" });
      const refounded = await screenOf(
        b!,
        "b-bob",
        (e) => both(e) && viewsOf(b!, "b-bob", mark).length > 0,
      );
      expect(refounded, "refondée au retour").to.deep.include({
        ready: true,
        partial: false,
        members: { alice: 1, bob: 1 },
      });
      // L'écran d'Alice, sur l'autre pod, revoit Bob.
      expect(both(await screenOf(a!, "a-alice", both))).toBe(true);
    });

    it("canal NON déclaré broadcast : reste instance-local (B ne reçoit pas)", async () => {
      const [a, b] = await spawnN(2);
      // Subscribe SANS markBroadcast — le subscribe le marque par défaut dans le
      // worker, donc on contourne en envoyant un publish "à vide" sur un canal
      // que SEUL A subscribe → B n'a aucun sink et le canal n'est pas broadcast
      // pour A (mais le worker auto-mark à la subscribe — donc on s'appuie sur le
      // fait que B n'a PAS subscribed, donc 0 fan-out local côté B).
      a!.child.send({ cmd: "subscribe", channel: "syslog:local-A" });
      await a!.awaitEvent(
        (e) =>
          e.cmd === "ack" &&
          e.op === "subscribe" &&
          e.channel === "syslog:local-A",
      );
      a!.child.send({
        cmd: "publish",
        channel: "syslog:local-A",
        payload: { line: 42 },
      });
      await a!.awaitEvent((e) => e.cmd === "ack" && e.op === "publish");
      // Fenêtre pour qu'un éventuel ingress traverse l'IPC (il devrait, le canal
      // est broadcast côté A) ; mais B n'a pas de sink → 0 livraison côté B.
      await new Promise((r) => setTimeout(r, 150));

      b!.child.send({ cmd: "stats" });
      const stats = await b!.awaitEvent((e) => e.cmd === "stats");
      expect(stats.subs).toEqual({});
    });
  },
);
