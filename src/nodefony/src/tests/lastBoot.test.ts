/**
 * Le bilan du dernier démarrage — écriture, lecture, et ce que `check` en dit.
 *
 * Ce que ces tests protègent vraiment : une application qui ne démarre plus est
 * précisément celle sur laquelle on ne peut RIEN exécuter, et une application
 * qui démarre amputée ne se signale plus après sa première seconde de vie.
 * Chaque garantie ici est de dernier recours — si le bilan ment, s'il manque,
 * ou s'il fait tomber le contrôle qui le lit, il ne reste rien.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import { assert } from "chai";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  writeLastBoot,
  readLastBoot,
  formatAge,
  LAST_BOOT_FILE,
  type ILastBoot,
} from "../kernel/checks/lastBoot";
import { runCheckCommand } from "../kernel/checks/runCheck";

const ok = (over: Partial<ILastBoot> = {}): ILastBoot => ({
  status: "ok",
  timestamp: "2026-07-30T18:00:00.000Z",
  environment: "development",
  pid: 4242,
  node: "v26.5.0",
  ...over,
});

const failed = (over: Partial<ILastBoot> = {}): ILastBoot =>
  ok({
    status: "failed",
    phase: "onBoot",
    error: { name: "nodefonyError", message: "Cannot find package 'redis'" },
    ...over,
  });

/** Capture la sortie standard : `check` ÉCRIT son rapport, il ne le retourne pas. */
function capture(run: () => number): { out: string; code: number } {
  const chunks: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((s: string) => {
    chunks.push(String(s));
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: run(), out: chunks.join("") };
  } finally {
    process.stdout.write = write;
  }
}

describe("last-boot — le bilan du dernier démarrage", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nf-lb-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("écrit puis relit le bilan à l'identique", () => {
    const e = failed({
      error: { name: "E", message: "m", exitCode: 78, stack: "at x" },
    });
    writeLastBoot(dir, e);
    assert.isTrue(existsSync(path.join(dir, LAST_BOOT_FILE)));
    assert.deepEqual(readLastBoot(dir), e);
  });

  it("crée `var/` s'il manque — un conteneur frais n'a pas ce dossier", () => {
    writeLastBoot(dir, ok());
    assert.isTrue(existsSync(path.join(dir, "var")));
  });

  it("rend null quand aucun démarrage n'a été consigné", () => {
    assert.isNull(readLastBoot(dir));
  });

  it("rend null sur un fichier CORROMPU, sans throw", () => {
    // Le contrôle vient diagnostiquer une application cassée : il ne peut pas
    // se permettre de tomber sur son propre bilan.
    mkdirSync(path.join(dir, "var"), { recursive: true });
    writeFileSync(path.join(dir, LAST_BOOT_FILE), "{ pas du json");
    assert.isNull(readLastBoot(dir));
  });

  it("rend null sur un JSON valide dont le `status` n'est pas reconnu", () => {
    mkdirSync(path.join(dir, "var"), { recursive: true });
    writeFileSync(
      path.join(dir, LAST_BOOT_FILE),
      '{"status":"peut-etre","timestamp":"x"}',
    );
    assert.isNull(readLastBoot(dir));
  });

  it("n'explose pas quand le chemin est inécrivable", () => {
    // Un disque plein ne doit pas transformer un démarrage diagnosticable en
    // une seconde erreur qui masque la première.
    const impossible = path.join(dir, "fichier-pas-dossier");
    writeFileSync(impossible, "je suis un fichier");
    writeLastBoot(path.join(impossible, "sous"), ok());
  });

  describe("formatAge — l'âge décide de la conduite à tenir", () => {
    const t0 = Date.parse("2026-07-30T18:00:00.000Z");
    const at = (ms: number) => formatAge("2026-07-30T18:00:00.000Z", t0 + ms);

    it("moins d'une minute, puis minutes / heures / jours", () => {
      assert.equal(at(30_000), "il y a moins d'une minute");
      assert.equal(at(5 * 60_000), "il y a 5 minutes");
      assert.equal(at(3 * 3_600_000), "il y a 3 heures");
      assert.equal(at(3 * 86_400_000), "il y a 3 jours");
    });

    it("accorde le singulier", () => {
      assert.equal(at(60_000), "il y a 1 minute");
      assert.equal(at(86_400_000), "il y a 1 jour");
    });

    it("une date illisible se DIT, elle ne se devine pas", () => {
      assert.equal(formatAge("pas une date", t0), "date illisible");
    });
  });

  describe("`check` NOMME la cause sans exécuter l'application", () => {
    let cwd = "";

    beforeEach(() => {
      cwd = process.cwd();
      writeFileSync(path.join(dir, "package.json"), '{"name":"app-cassee"}');
      process.chdir(dir);
    });

    afterEach(() => {
      process.chdir(cwd);
    });

    it("démarrage ÉCHOUÉ : phase, cause, âge — sans peser sur le code de sortie", () => {
      writeLastBoot(
        dir,
        failed({
          error: {
            name: "nodefonyError",
            message: "Cannot find package 'redis'",
            exitCode: 78,
          },
        }),
      );
      const { out, code } = capture(() => runCheckCommand([]));
      assert.include(out, "Le dernier démarrage a ÉCHOUÉ");
      assert.include(out, "onBoot");
      assert.include(out, "Cannot find package 'redis'");
      assert.include(out, "78");
      // Un fait d'exécution passé ne rend pas le CODE fautif : le contrôle
      // rapporte, il ne condamne pas — sinon on apprend à l'ignorer.
      assert.equal(code, 0);
    });

    it("⭐ démarrage ABOUTI mais AMPUTÉ : signalé — c'est le cas que personne ne voit", () => {
      writeLastBoot(
        dir,
        ok({
          bricksSkipped: [
            { module: "redis", reason: "ECONNREFUSED", phase: "lifecycle" },
          ],
          warnings: 3,
        }),
      );
      const { out, code } = capture(() => runCheckCommand([]));
      assert.include(out, "abouti mais il MANQUE des briques");
      assert.include(out, "redis");
      assert.include(out, "ECONNREFUSED");
      assert.include(out, "3 avertissement");
      assert.equal(code, 0);
    });

    it("un profil serveur qui finit SANS serveur est nommé", () => {
      writeLastBoot(dir, ok({ healthy: false }));
      const { out } = capture(() => runCheckCommand([]));
      assert.include(out, "SANS aucun serveur en écoute");
    });

    it("les briques écartées VOLONTAIREMENT sont distinguées des pannes", () => {
      writeLastBoot(
        dir,
        ok({
          bricksSkipped: [{ module: "redis", reason: "ECONNREFUSED" }],
          bricksGated: [
            {
              module: "studio",
              reason: "policy dev, environnement production",
            },
          ],
        }),
      );
      const { out } = capture(() => runCheckCommand([]));
      assert.include(out, "écartée(s) VOLONTAIREMENT");
      assert.include(out, "studio");
    });

    it("la remédiation suggérée par le bilan est reprise", () => {
      writeLastBoot(
        dir,
        ok({
          bricksSkipped: [{ module: "http", reason: "Cannot find module" }],
          remediation: "npm run clean && npm run build",
        }),
      );
      const { out } = capture(() => runCheckCommand([]));
      assert.include(out, "npm run clean && npm run build");
    });

    it("un démarrage SAIN ne dit rien — le bruit finit par masquer le signal", () => {
      writeLastBoot(
        dir,
        ok({ healthy: true, warnings: 2, modulesLoaded: ["http"] }),
      );
      const { out } = capture(() => runCheckCommand([]));
      assert.notInclude(out, "MANQUE des briques");
      assert.notInclude(out, "a ÉCHOUÉ");
    });

    it("aucun bilan du tout : silence", () => {
      const { out } = capture(() => runCheckCommand([]));
      assert.notInclude(out, "dernier démarrage");
    });

    it("`--json` porte le bilan, pour un agent qui le lit au `jq`", () => {
      writeLastBoot(dir, failed());
      const { out } = capture(() => runCheckCommand(["--json"]));
      const parsed = JSON.parse(out) as { lastBoot: ILastBoot | null };
      assert.equal(parsed.lastBoot?.status, "failed");
      assert.equal(
        parsed.lastBoot?.error?.message,
        "Cannot find package 'redis'",
      );
    });
  });

  describe("la cible est l'APPLICATION, pas le dossier où l'on a tapé", () => {
    /**
     * Le défaut que ces tests ferment : `check` lisait tout depuis
     * `process.cwd()`. Lancé une seule fois depuis un sous-dossier — et c'est
     * le cas courant, on est dans le module qu'on développe — il ne trouvait ni
     * le manifeste ni le bilan du dernier démarrage, et concluait « rien à
     * signaler ». Un outil de diagnostic silencieux et rassurant à tort.
     */
    let sub = "";

    beforeEach(() => {
      // Ce qui FAIT une application Nodefony pour `findProjectRoot`.
      writeFileSync(path.join(dir, "nodefony.config.ts"), "export default {};");
      writeFileSync(path.join(dir, "package.json"), '{"name":"mon-app"}');
      sub = path.join(dir, "modules", "blog");
      mkdirSync(sub, { recursive: true });
    });

    it("⭐ lancé dans `modules/blog`, il trouve le bilan de l'app", () => {
      writeLastBoot(dir, failed());
      const { out } = capture(() => runCheckCommand(["--cwd", sub]));
      assert.include(out, "Le dernier démarrage a ÉCHOUÉ");
      assert.include(out, "Cannot find package 'redis'");
    });

    it("il DIT sur quoi il a porté quand ce n'est pas là où on a tapé", () => {
      // Sans cette ligne, un rapport vide se lit « mon module va bien » alors
      // qu'il parle de l'application entière — et inversement.
      const { out } = capture(() => runCheckCommand(["--cwd", sub]));
      assert.include(out, "application :");
      assert.include(out, "lancé depuis");
    });

    it("`--json` porte la racine retenue", () => {
      const { out } = capture(() =>
        runCheckCommand(["check", "--cwd", sub, "--json"]),
      );
      const parsed = JSON.parse(out) as { root: string };
      assert.equal(path.resolve(parsed.root), path.resolve(dir));
    });

    it("depuis la racine, aucune annonce — il n'y a rien à signaler", () => {
      const { out } = capture(() => runCheckCommand(["--cwd", dir]));
      assert.notInclude(out, "lancé depuis");
    });

    it("une option inconnue se DIT, elle ne s'ignore pas (EX_USAGE)", () => {
      const err: string[] = [];
      const write = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((s: string) => {
        err.push(String(s));
        return true;
      }) as typeof process.stderr.write;
      try {
        assert.equal(runCheckCommand(["check", "--jsno"]), 64);
      } finally {
        process.stderr.write = write;
      }
      assert.include(err.join(""), "option inconnue");
    });
  });

  describe("hors de tout projet, le dossier de départ reste la cible", () => {
    it("un dossier de paquets sans `nodefony.config.ts` se contrôle tel quel", () => {
      // Ce dépôt-ci comme n'importe quel dossier de travail : le repli n'est
      // pas un cas dégradé, c'est un usage.
      writeLastBoot(dir, failed());
      const { out } = capture(() => runCheckCommand(["--cwd", dir]));
      assert.include(out, "Le dernier démarrage a ÉCHOUÉ");
      assert.notInclude(out, "lancé depuis");
    });
  });
});
