/**
 * La sonde de GROUPE de processus (`isProcessGroupAlive`, `waitGroupDead`) :
 * le chef d'un groupe peut mourir pendant que ses descendants vivent — c'est
 * ce que l'arrêt du build doit attendre, pas la sortie du chef.
 */
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isProcessGroupAlive, waitGroupDead } from "../service/dev/devProcess";

const errno = (code: string): Error => Object.assign(new Error(code), { code });

describe("isProcessGroupAlive — sonde injectée", () => {
  it("POSIX : interroge le GROUPE (-pgid) ; ESRCH = mort, EPERM = vivant", () => {
    const asked: number[] = [];
    const alive = isProcessGroupAlive(42, {
      platform: "linux",
      probe: (pid) => {
        asked.push(pid);
      },
    });
    expect(alive).to.equal(true);
    expect(asked).to.deep.equal([-42]);
    const throwing = (code: string) => (): void => {
      throw errno(code);
    };
    expect(
      isProcessGroupAlive(42, { platform: "linux", probe: throwing("ESRCH") }),
    ).to.equal(false);
    expect(
      isProcessGroupAlive(42, { platform: "linux", probe: throwing("EPERM") }),
    ).to.equal(true);
  });

  it("Windows : pas de groupes, le pid seul (l'arbre part d'un coup par taskkill /T /F)", () => {
    const asked: number[] = [];
    isProcessGroupAlive(42, {
      platform: "win32",
      probe: (pid) => {
        asked.push(pid);
      },
    });
    expect(asked).to.deep.equal([42]);
  });

  it("waitGroupDead rend false à l'échéance tant qu'un membre répond", async () => {
    expect(
      await waitGroupDead(42, 60, { platform: "linux", probe: () => {} }),
    ).to.equal(false);
  });
});

describe.skipIf(process.platform === "win32")(
  "isProcessGroupAlive — groupe réel (POSIX)",
  () => {
    it("le chef mort, le groupe VIT encore ; tué en groupe, il meurt", async () => {
      // Le chef lance un petit-enfant puis attend : tuer le chef seul laisse
      // le petit-enfant dans le groupe — le cas de `npm exec` devant turbo.
      const leader = spawn("sh", ["-c", "sleep 30 & echo prêt; wait"], {
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const pgid = leader.pid as number;
      // « prêt » n'arrive qu'une fois le petit-enfant lancé — pas un délai deviné.
      await new Promise((resolve) => leader.stdout?.once("data", resolve));
      const exited = new Promise((resolve) => leader.once("exit", resolve));
      process.kill(pgid, "SIGKILL"); // le chef seul
      await exited;
      expect(isProcessGroupAlive(pgid)).to.equal(true);
      process.kill(-pgid, "SIGKILL"); // tout le groupe
      expect(await waitGroupDead(pgid, 2000)).to.equal(true);
    });
  },
);
