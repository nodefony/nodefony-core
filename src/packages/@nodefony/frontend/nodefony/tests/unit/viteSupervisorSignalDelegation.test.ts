/// <reference types="node" />
import { expect } from "chai";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { TreeSignalOutcome } from "nodefony";

/**
 * `stopDev()` délègue le kill d'arbre à `signalProcessGroup` — jamais `child.kill()`.
 *
 * Sous Windows il n'existe pas de groupe de process : `child.kill()` n'atteint que
 * Vite lui-même, ses descendants (le service esbuild) survivent. Le cœur possède
 * l'implémentation UNIQUE du kill d'arbre portable (`signalProcessGroup`,
 * `src/nodefony/src/service/dev/devProcess.ts`, groupe POSIX `-pid` ou
 * `taskkill /PID <pid> /T /F` sous Windows) — `ViteProcessSupervisor.signalTree()`
 * doit l'APPELER, jamais en recopier la logique (une copie diverge en silence,
 * exactement le défaut déjà corrigé côté `DevSupervisor`).
 *
 * On espionne `signalProcessGroup` via `vi.mock("nodefony", …)` — pur/injecté
 * plutôt que de lire `process.platform` : un test qui lit la plateforme ne peut
 * éprouver qu'une seule plateforme. `FakeChild.kill()` lève délibérément : si
 * `signalTree` retombait sur l'ancien chemin direct (régression), le test le
 * verrait immédiatement au lieu de rester silencieusement vert.
 */

const spy = vi.hoisted(() => ({
  calls: [] as Array<{ pid: number; signal: NodeJS.Signals }>,
  outcome: "group" as TreeSignalOutcome,
}));

vi.mock("nodefony", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    signalProcessGroup: (
      pid: number,
      signal: NodeJS.Signals,
    ): TreeSignalOutcome => {
      spy.calls.push({ pid, signal });
      return spy.outcome;
    },
  };
});

const { ViteProcessSupervisor } =
  await import("../../service/ViteProcessSupervisor");

/** Child factice avec un `pid` réel — le chemin qu'emprunte TOUJOURS un vrai Vite. */
class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  /**
   * Ne doit JAMAIS être appelé : dès que `pid` est un `number`, `signalTree` doit
   * déléguer directement à `signalProcessGroup`, pas retomber sur `child.kill()`.
   * Lever ici rend une régression de délégation visible au lieu de silencieuse.
   */
  kill(): boolean {
    throw new Error(
      "child.kill() appelé directement — la délégation à signalProcessGroup a été contournée",
    );
  }
}

/** Accès au champ privé `child`/`state` que le test doit poser — sans `any`. */
interface SupervisorInternals {
  child: ChildProcess | null;
  state: string;
}

function makeSupervisor(
  child: FakeChild,
): InstanceType<typeof ViteProcessSupervisor> {
  const sup = new ViteProcessSupervisor({
    devHost: "127.0.0.1",
    devPort: 5173,
    startupTimeoutMs: 1000,
    pipeLogs: false,
    cwd: process.cwd(),
    logger: { info: () => {}, error: () => {} },
    healthCheckIntervalMs: 0,
  });
  const internals = sup as unknown as SupervisorInternals;
  internals.child = child as unknown as ChildProcess;
  internals.state = "ready"; // sinon `stop()` sort tout de suite (no-op)
  return sup;
}

describe("ViteProcessSupervisor — délégation du kill d'arbre à signalProcessGroup", () => {
  beforeEach(() => {
    spy.calls.length = 0;
    spy.outcome = "group";
  });

  it("SIGINT du stop() passe par signalProcessGroup(pid, signal) — jamais child.kill()", async () => {
    const child = new FakeChild();
    const sup = makeSupervisor(child);

    const stopPromise = sup.stop();
    // Synchrone : `doStop()` appelle `signalTree` avant tout `await`.
    expect(spy.calls).to.have.lengthOf(1);
    expect(spy.calls[0]).to.deep.equal({ pid: 4242, signal: "SIGINT" });

    // Le mock ne tue rien pour de vrai : simuler l'exit pour dénouer l'attente.
    child.emit("exit", 0, "SIGINT");
    await stopPromise;
    expect(sup.status().state).to.equal("stopped");
  });

  it("verdict 'gone' conclut l'arrêt sans attendre un exit qui ne viendra jamais", async () => {
    spy.outcome = "gone";
    const child = new FakeChild();
    const sup = makeSupervisor(child);

    await sup.stop(); // ne doit PAS pendre : aucun exit n'est émis
    expect(sup.status().state).to.equal("stopped");
    expect(spy.calls).to.have.lengthOf(1);
  });

  it("le SIGKILL de secours (child survivant au SIGINT) délègue aussi à signalProcessGroup", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const sup = makeSupervisor(child);

      const stopPromise = sup.stop();
      expect(spy.calls).to.have.lengthOf(1); // SIGINT envoyé, child "survit" (pas d'exit)

      await vi.advanceTimersByTimeAsync(3_000); // minuteur de secours du doStop()
      expect(spy.calls).to.have.lengthOf(2);
      expect(spy.calls[1]).to.deep.equal({ pid: 4242, signal: "SIGKILL" });

      child.emit("exit", null, "SIGKILL");
      await stopPromise;
      expect(sup.status().state).to.equal("stopped");
    } finally {
      vi.useRealTimers();
    }
  });
});
