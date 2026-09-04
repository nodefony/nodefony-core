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
  readLastBoots,
  formatAge,
  LAST_BOOT_FILE,
  LAST_BOOT_CONSOLE_FILE,
  lastBootFileFor,
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
/**
 * ⚠️ La LARGEUR est posée, elle n'est PAS héritée du terminal.
 *
 * `runCheckCommand` lit `process.stdout.columns` : sans cette pose, chaque
 * machine rend un document différent, et une assertion `include` sur une phrase
 * devient un tirage au sort. Vécu — « SANS aucun serveur en écoute » passait sur
 * un terminal large et tombait en intégration continue, où la phrase est REPLIÉE
 * en deux lignes : au-delà de 72 colonnes elle tient, en deçà elle se coupe.
 *
 * 100 plutôt que 80 : au-dessus de la borne haute du rendu (96), donc la même
 * mise en page quelle que soit l'évolution de cette borne.
 */
const LARGEUR_DE_TEST = 100;

async function capture(
  run: () => number | Promise<number>,
): Promise<{ out: string; code: number }> {
  const chunks: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  const colonnes = process.stdout.columns;
  process.stdout.columns = LARGEUR_DE_TEST;
  process.stdout.write = ((s: string) => {
    chunks.push(String(s));
    return true;
  }) as typeof process.stdout.write;
  try {
    return { code: await run(), out: chunks.join("") };
  } finally {
    process.stdout.write = write;
    process.stdout.columns = colonnes;
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

  it("écrit puis relit le bilan à l'identique", async () => {
    const e = failed({
      error: { name: "E", message: "m", exitCode: 78, stack: "at x" },
    });
    writeLastBoot(dir, e);
    assert.isTrue(existsSync(path.join(dir, LAST_BOOT_FILE)));
    assert.deepEqual(readLastBoot(dir), e);
  });

  it("crée `var/` s'il manque — un conteneur frais n'a pas ce dossier", async () => {
    writeLastBoot(dir, ok());
    assert.isTrue(existsSync(path.join(dir, "var")));
  });

  it("rend null quand aucun démarrage n'a été consigné", async () => {
    assert.isNull(readLastBoot(dir));
  });

  it("rend null sur un fichier CORROMPU, sans throw", async () => {
    // Le contrôle vient diagnostiquer une application cassée : il ne peut pas
    // se permettre de tomber sur son propre bilan.
    mkdirSync(path.join(dir, "var"), { recursive: true });
    writeFileSync(path.join(dir, LAST_BOOT_FILE), "{ pas du json");
    assert.isNull(readLastBoot(dir));
  });

  it("rend null sur un JSON valide dont le `status` n'est pas reconnu", async () => {
    mkdirSync(path.join(dir, "var"), { recursive: true });
    writeFileSync(
      path.join(dir, LAST_BOOT_FILE),
      '{"status":"peut-etre","timestamp":"x"}',
    );
    assert.isNull(readLastBoot(dir));
  });

  it("n'explose pas quand le chemin est inécrivable", async () => {
    // Un disque plein ne doit pas transformer un démarrage diagnosticable en
    // une seconde erreur qui masque la première.
    const impossible = path.join(dir, "fichier-pas-dossier");
    writeFileSync(impossible, "je suis un fichier");
    writeLastBoot(path.join(impossible, "sous"), ok());
  });

  describe("formatAge — l'âge décide de la conduite à tenir", () => {
    const t0 = Date.parse("2026-07-30T18:00:00.000Z");
    const at = (ms: number) => formatAge("2026-07-30T18:00:00.000Z", t0 + ms);

    it("moins d'une minute, puis minutes / heures / jours", async () => {
      assert.equal(at(30_000), "il y a moins d'une minute");
      assert.equal(at(5 * 60_000), "il y a 5 minutes");
      assert.equal(at(3 * 3_600_000), "il y a 3 heures");
      assert.equal(at(3 * 86_400_000), "il y a 3 jours");
    });

    it("accorde le singulier", async () => {
      assert.equal(at(60_000), "il y a 1 minute");
      assert.equal(at(86_400_000), "il y a 1 jour");
    });

    it("une date illisible se DIT, elle ne se devine pas", async () => {
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

    it("démarrage ÉCHOUÉ : phase, cause, âge — sans peser sur le code de sortie", async () => {
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
      // `--no-strict` est ÉNONCÉ : sans lui, ce test hérite de `CI` (posé sur
      // toute forge), qui arme `--strict` et fait rendre 1 pour les contrôles
      // SAUTÉS de ce décor hors application — un code qui ne dit alors plus
      // rien du bilan de démarrage, seul objet de cette assertion.
      const { out, code } = await capture(() =>
        runCheckCommand(["--no-strict"]),
      );
      assert.include(out, "Le dernier démarrage a ÉCHOUÉ");
      assert.include(out, "onBoot");
      assert.include(out, "Cannot find package 'redis'");
      assert.include(out, "78");
      // Un fait d'exécution passé ne rend pas le CODE fautif : le contrôle
      // rapporte, il ne condamne pas — sinon on apprend à l'ignorer.
      assert.equal(code, 0);
    });

    it("⭐ démarrage ABOUTI mais AMPUTÉ : signalé — c'est le cas que personne ne voit", async () => {
      writeLastBoot(
        dir,
        ok({
          bricksSkipped: [
            { module: "redis", reason: "ECONNREFUSED", phase: "lifecycle" },
          ],
          warnings: 3,
        }),
      );
      const { out, code } = await capture(() =>
        runCheckCommand(["--no-strict"]),
      );
      assert.include(out, "abouti mais il MANQUE des briques");
      assert.include(out, "redis");
      assert.include(out, "ECONNREFUSED");
      assert.include(out, "3 avertissement");
      assert.equal(code, 0);
    });

    it("un profil serveur qui finit SANS serveur est nommé", async () => {
      writeLastBoot(dir, ok({ healthy: false }));
      const { out } = await capture(() => runCheckCommand([]));
      assert.include(out, "SANS aucun serveur en écoute");
    });

    it("les briques écartées VOLONTAIREMENT sont distinguées des pannes", async () => {
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
      const { out } = await capture(() => runCheckCommand([]));
      // « écartées exprès » : la nuance qui évite de chercher une panne là où
      // le gating a fait son travail. Les parenthèses de repli « (s) » ont
      // disparu du rendu — un rapport lu par quelqu'un accorde ses pluriels.
      assert.include(out, "écartées exprès");
      assert.include(out, "studio");
    });

    it("la remédiation suggérée par le bilan est reprise", async () => {
      writeLastBoot(
        dir,
        ok({
          bricksSkipped: [{ module: "http", reason: "Cannot find module" }],
          remediation: "npm run clean && npm run build",
        }),
      );
      const { out } = await capture(() => runCheckCommand([]));
      assert.include(out, "npm run clean && npm run build");
    });

    it("un démarrage SAIN ne dit rien — le bruit finit par masquer le signal", async () => {
      writeLastBoot(
        dir,
        ok({ healthy: true, warnings: 2, modulesLoaded: ["http"] }),
      );
      const { out } = await capture(() => runCheckCommand([]));
      assert.notInclude(out, "MANQUE des briques");
      assert.notInclude(out, "a ÉCHOUÉ");
    });

    it("aucun bilan du tout : silence", async () => {
      const { out } = await capture(() => runCheckCommand([]));
      assert.notInclude(out, "dernier démarrage");
    });

    it("`--json` porte le bilan, pour un agent qui le lit au `jq`", async () => {
      writeLastBoot(dir, failed());
      const { out } = await capture(() => runCheckCommand(["--json"]));
      // Un TABLEAU : serveur et console ont chacun leur bilan, et le premier
      // ne doit plus être écrasé par un `nodefony inspect` lancé pour le lire.
      const parsed = JSON.parse(out) as { lastBoots: ILastBoot[] };
      assert.lengthOf(parsed.lastBoots, 1);
      assert.equal(parsed.lastBoots[0]?.status, "failed");
      assert.equal(
        parsed.lastBoots[0]?.error?.message,
        "Cannot find package 'redis'",
      );
    });

    describe("QUI a démarré — le bilan ne désigne plus le mauvais coupable", () => {
      it("🔴 un démarrage CONSOLE n'écrase PAS le bilan du serveur", () => {
        // LE défaut : un `nodefony inspect` lancé POUR diagnostiquer une panne de
        // serveur écrasait la preuve qu'il venait chercher. Le profil décide du
        // fichier — c'est la seule forme qui rend l'écrasement impossible.
        writeLastBoot(
          dir,
          failed({
            profile: "server",
            command: "development",
            error: { name: "nodefonyError", message: "le serveur est mort" },
          }),
        );
        writeLastBoot(
          dir,
          failed({
            profile: "console",
            command: "inspect",
            error: { name: "nodefonyError", message: "pas de NF_DATABASE_URL" },
          }),
        );

        const serveur = readLastBoot(dir);
        assert.equal(
          serveur?.error?.message,
          "le serveur est mort",
          "le bilan du serveur a été écrasé par une commande console",
        );
        assert.isTrue(existsSync(path.join(dir, LAST_BOOT_CONSOLE_FILE)));

        // Les deux sont lisibles, serveur d'ABORD : celui qui lance `doctor` sur
        // une application qui ne répond plus cherche le serveur.
        const tous = readLastBoots(dir);
        assert.deepEqual(
          tous.map((b) => b.profile),
          ["server", "console"],
        );
      });

      it("un bilan SANS profil (écrit avant ce champ) reste celui du serveur", () => {
        // Compatibilité : le fichier historique n'a pas de `profile`, et il
        // décrivait bien un serveur. Le classer ailleurs le rendrait invisible.
        assert.equal(lastBootFileFor(undefined), LAST_BOOT_FILE);
        assert.equal(lastBootFileFor("server"), LAST_BOOT_FILE);
        assert.equal(lastBootFileFor("cluster"), LAST_BOOT_FILE);
        assert.equal(lastBootFileFor("console"), LAST_BOOT_CONSOLE_FILE);
      });

      it("le rapport NOMME la commande et son profil", async () => {
        writeLastBoot(
          dir,
          failed({ profile: "console", command: "orm:migrate" }),
        );
        const { out } = await capture(() => runCheckCommand([]));
        assert.include(out, "nodefony orm:migrate");
        assert.include(out, "console");
      });

      it("🔴 les messages CRITIC sont DITS, pas seulement comptés", async () => {
        // `errors: 1` sans un mot était le cas le plus frustrant du bilan : un
        // firewall qui se déclare invalide au boot loggue CRITIC et laisse le
        // boot continuer. Le lecteur savait qu'il s'était passé quelque chose.
        writeLastBoot(
          dir,
          ok({
            errors: 1,
            criticals: [
              "security : zone `admin` invalide, aucun pare-feu posé",
            ],
          }),
        );
        const { out } = await capture(() => runCheckCommand([]));
        assert.include(out, "zone");
        assert.include(out, "aucun pare-feu posé");
      });
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

    it("⭐ lancé dans `modules/blog`, il trouve le bilan de l'app", async () => {
      writeLastBoot(dir, failed());
      const { out } = await capture(() => runCheckCommand(["--cwd", sub]));
      assert.include(out, "Le dernier démarrage a ÉCHOUÉ");
      assert.include(out, "Cannot find package 'redis'");
    });

    it("il DIT sur quoi il a porté quand ce n'est pas là où on a tapé", async () => {
      // Sans cette ligne, un rapport vide se lit « mon module va bien » alors
      // qu'il parle de l'application entière — et inversement.
      //
      // On vérifie l'INTENTION, pas une formulation : l'en-tête doit nommer la
      // racine réellement auscultée ET le dossier d'où l'on a tapé. Assertion
      // sur les deux chemins — un libellé se réécrit, un chemin absent est un
      // vrai défaut.
      const { out } = await capture(() => runCheckCommand(["--cwd", sub]));
      assert.include(out, dir);
      assert.include(out, "lancé depuis");
      assert.include(out, sub);
    });

    it("`--json` porte la racine retenue", async () => {
      const { out } = await capture(() =>
        runCheckCommand(["check", "--cwd", sub, "--json"]),
      );
      const parsed = JSON.parse(out) as { root: string };
      assert.equal(path.resolve(parsed.root), path.resolve(dir));
    });

    it("depuis la racine, aucune annonce — il n'y a rien à signaler", async () => {
      const { out } = await capture(() => runCheckCommand(["--cwd", dir]));
      assert.notInclude(out, "lancé depuis");
    });

    it("une option inconnue se DIT, elle ne s'ignore pas (EX_USAGE)", async () => {
      const err: string[] = [];
      const write = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((s: string) => {
        err.push(String(s));
        return true;
      }) as typeof process.stderr.write;
      try {
        assert.equal(await runCheckCommand(["check", "--jsno"]), 64);
      } finally {
        process.stderr.write = write;
      }
      assert.include(err.join(""), "option inconnue");
    });
  });

  describe("hors de tout projet, le dossier de départ reste la cible", () => {
    it("un dossier de paquets sans `nodefony.config.ts` se contrôle tel quel", async () => {
      // Ce dépôt-ci comme n'importe quel dossier de travail : le repli n'est
      // pas un cas dégradé, c'est un usage.
      writeLastBoot(dir, failed());
      const { out } = await capture(() => runCheckCommand(["--cwd", dir]));
      assert.include(out, "Le dernier démarrage a ÉCHOUÉ");
      assert.notInclude(out, "lancé depuis");
    });
  });
});
