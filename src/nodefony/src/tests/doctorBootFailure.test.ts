/**
 * `doctor --live` quand l'application NE DÉMARRE PAS — le cas pour lequel
 * l'outil existe.
 *
 * `--live` sort du fast-path standalone : il demande un boot. Tant que l'échec
 * de ce boot n'était pas rattrapé, celui qui tapait `--live` parce que « ça ne
 * démarre plus » recevait une pile brute et RIEN d'autre — donc strictement
 * moins qu'avec `doctor` nu. Ce qui est protégé ici : l'étage 1 est rendu
 * quoi qu'il arrive, et l'étage 2 devient un état d'exécution lisible.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import { assert } from "chai";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isDoctorCommand,
  runCheckWithoutLive,
  wantsLiveDoctor,
} from "../kernel/checks/runCheck";

describe("wantsLiveDoctor — UNE règle pour deux lecteurs", () => {
  it("reconnaît `doctor` et son alias historique `check`", () => {
    assert.isTrue(isDoctorCommand("doctor"));
    assert.isTrue(isDoctorCommand("check"));
    assert.isFalse(isDoctorCommand("inspect"));
    assert.isFalse(isDoctorCommand(null));
  });

  it("`doctor --live` demande l'étage 2 ; `doctor` nu ne le demande pas", () => {
    assert.isTrue(
      wantsLiveDoctor("doctor", ["node", "nodefony", "doctor", "--live"]),
    );
    assert.isTrue(
      wantsLiveDoctor("check", ["node", "nodefony", "check", "--live"]),
    );
    assert.isFalse(wantsLiveDoctor("doctor", ["node", "nodefony", "doctor"]));
  });

  it("🔴 `--no-live` REPREND le drapeau — une lecture naïve d'argv l'ignorait", () => {
    assert.isFalse(
      wantsLiveDoctor("doctor", [
        "node",
        "nodefony",
        "doctor",
        "--live",
        "--no-live",
      ]),
      "`--no-live` doit désarmer le boot, sinon le fast-path est perdu pour rien",
    );
  });

  it("une autre commande ne devient jamais `doctor` par la grâce d'un `--live`", () => {
    assert.isFalse(
      wantsLiveDoctor("dev", ["node", "nodefony", "dev", "--live"]),
    );
  });

  it("un argv REFUSÉ, ou `--help`, ne boote pas : le fast-path doit répondre", () => {
    assert.isFalse(
      wantsLiveDoctor("doctor", [
        "node",
        "nodefony",
        "doctor",
        "--live",
        "--oups",
      ]),
    );
    assert.isFalse(
      wantsLiveDoctor("doctor", [
        "node",
        "nodefony",
        "doctor",
        "--live",
        "--help",
      ]),
    );
  });
});

describe("runCheckWithoutLive — le rapport reste dû quand le boot est mort", () => {
  let dir: string;
  /** Ce que la commande a écrit sur la sortie standard. */
  let sortie: string;
  let write: typeof process.stdout.write;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nf-boot-dead-"));
    writeFileSync(path.join(dir, "package.json"), '{"name":"app-morte"}');
    sortie = "";
    write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      sortie += String(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = write;
    rmSync(dir, { recursive: true, force: true });
  });

  const lancer = (argv: string[]) =>
    runCheckWithoutLive(
      argv,
      "l'application n'a pas démarré — connecteur injoignable",
      "corrige la cause ci-dessus, puis relance `nodefony doctor --live`",
    );

  it("⭐ rend l'étage 1 ENTIER — un rapport, pas une pile", async () => {
    await lancer(["doctor", "--live", "--cwd", dir]);
    assert.include(sortie, "ÉTAT", "le tableau des familles doit être rendu");
    assert.include(sortie, "Dépendances");
  });

  it("⭐ l'étage 2 est INDISPONIBLE, avec la cause ET le geste", async () => {
    await lancer(["doctor", "--live", "--cwd", dir]);
    assert.include(sortie, "n'a pas démarré — connecteur injoignable");
    assert.include(sortie, "relance");
    assert.notInclude(
      sortie,
      "non demandé",
      "l'étage 2 a bien été demandé : le dire « non demandé » serait un mensonge",
    );
  });

  it("le JSON porte la même chose, et la commande garde SON code de sortie", async () => {
    const code = await lancer(["doctor", "--live", "--json", "--cwd", dir]);
    const report = JSON.parse(sortie) as {
      live: { execution: Record<string, { ran: boolean; reason?: string }> };
    };
    const familles = Object.values(report.live.execution);
    assert.isNotEmpty(familles);
    for (const e of familles) {
      assert.isFalse(e.ran);
      assert.include(e.reason ?? "", "n'a pas démarré");
    }
    assert.oneOf(code, [0, 1]);
  });

  it("un argv REFUSÉ reste un refus d'usage (64), jamais un rapport", async () => {
    const err = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      assert.equal(await lancer(["doctor", "--live", "--oups"]), 64);
    } finally {
      process.stderr.write = err;
    }
  });
});
