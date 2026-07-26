/// <reference types="node" />
import { expect } from "chai";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { ViteProcessSupervisor } from "../../service/ViteProcessSupervisor";

/**
 * Arrêt du superviseur Vite quand le `kill` du child ÉCHOUE.
 *
 * Chemin rare mais réel : le process Vite est déjà mort (ESRCH), ou il n'appartient
 * plus à cette session — `child.kill()` lève au lieu de rendre `false`. Le `catch`
 * appelle alors le nettoyage AVANT que le minuteur SIGKILL de secours existe :
 * ce que fait ce nettoyage du minuteur, et de son propre écouteur `exit`, décide
 * si l'arrêt se termine proprement ou s'il emporte le kernel avec lui.
 */

/** Child factice dont le `kill` lève, comme un process déjà disparu. */
class DeadChild extends EventEmitter {
  killed = false;
  kill(): boolean {
    throw new Error("ESRCH: no such process");
  }
}

/** Accès aux champs privés que le test doit poser — sans passer par `any`. */
interface SupervisorInternals {
  child: ChildProcess | null;
  state: string;
}

function makeSupervisor(child: DeadChild): ViteProcessSupervisor {
  const sup = new ViteProcessSupervisor({
    devHost: "127.0.0.1",
    devPort: 5173,
    startupTimeoutMs: 1000,
    pipeLogs: false,
    cwd: process.cwd(),
    logger: { info: () => {}, error: () => {} },
  });
  const internals = sup as unknown as SupervisorInternals;
  internals.child = child as unknown as ChildProcess;
  internals.state = "ready"; // sinon `stop()` sort tout de suite
  return sup;
}

describe("Vite — arrêt quand le kill du child lève", () => {
  it("l'arrêt aboutit au lieu de lever (le minuteur SIGKILL n'est plus lu en zone morte)", async () => {
    const sup = makeSupervisor(new DeadChild());
    // Avant correction : ReferenceError « Cannot access 'sigKillTimer' before
    // initialization » — le `catch` lisait un `const` déclaré plus bas.
    await sup.stop();
    expect(sup.status().state).to.equal("stopped");
  });

  it("l'écouteur `exit` est retiré — un exit tardif ne rejoue pas le nettoyage", async () => {
    const child = new DeadChild();
    const sup = makeSupervisor(child);
    await sup.stop();

    // Le `catch` a déjà tout nettoyé : plus personne n'attend cet `exit`.
    expect(child.listenerCount("exit")).to.equal(0);

    // Et s'il arrive quand même (course), l'état reste celui d'un arrêt fini.
    child.emit("exit", 0, null);
    expect(sup.status().state).to.equal("stopped");
  });
});
