/**
 * Unit — `nodefony upgrade` remet une application au niveau de ses paquets, et
 * `nodefony doctor` dit quand elle ne l'est pas.
 *
 * Après `npm install nodefony@<neuve>`, le bloc framework d'`AGENTS.md` décrit
 * encore l'ancienne version : rien ne casse, aucun test ne le voit, et un agent
 * lit une porte périmée. Ce qui est éprouvé ici : le bloc est réécrit — et lui
 * SEUL, le texte de l'utilisateur autour ne bouge pas —, la simulation n'écrit
 * rien, une absence n'est pas comblée d'office, un monorepo n'est jamais touché,
 * et le diagnostic statique nomme le geste qui répare.
 */
import { describe, it, afterAll } from "vitest";
import assert from "node:assert";
import path from "node:path";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { version } from "../../package.json";
import { refreshAgentsGuide, runScaffold } from "../cli/scaffold/engine";
import {
  isUpgradePending,
  parseUpgradeArgv,
  type IUpgradeReport,
} from "../cli/upgrade";
import { checkAgentsGuide } from "../kernel/checks/freshness";
import { manPagePath, parseManArgv } from "../cli/man";

// Le jetable du test, le test le supprime : scripts/test/vitest/tmp-guard.ts
// fait échouer la passe sur tout dossier laissé dans le dossier temporaire.
const aSupprimer: string[] = [];
afterAll(() => {
  for (const dossier of aSupprimer)
    rmSync(dossier, { recursive: true, force: true });
});

const START = "<!-- nodefony:start -->";
const END = "<!-- nodefony:end -->";
const AVANT = "# Mon application\n\nIntroduction écrite par l'équipe.\n\n";
const APRES = "\n\n## Notes de l'équipe\n\nTexte maison, hors marqueurs.\n";

/** Une application dont l'`AGENTS.md` porte un bloc d'une AUTRE version. */
function appPerimee(
  agents:
    | string
    | null = `${AVANT}${START}\nbloc de la version précédente\n${END}${APRES}`,
): string {
  const racine = mkdtempSync(path.join(tmpdir(), "nf-upgrade-"));
  aSupprimer.push(racine);
  writeFileSync(
    path.join(racine, "package.json"),
    JSON.stringify({ name: "demo", dependencies: {} }),
  );
  if (agents !== null) writeFileSync(path.join(racine, "AGENTS.md"), agents);
  return racine;
}

const lire = (racine: string): string =>
  readFileSync(path.join(racine, "AGENTS.md"), "utf8");

describe("refreshAgentsGuide — le bloc framework d'AGENTS.md", () => {
  /*
   *   Une application NEUVE est à jour, par définition. Le preset `complete`
   *   dépend de `@nodefony/frontend` pour Studio sans avoir d'interface à lui :
   *   la régénération concluait « a un front » de cette seule dépendance, et
   *   `doctor` déclarait périmé l'`AGENTS.md` de toute application à peine
   *   créée (vu sur 10.0.0-beta.3, app fraîche, aucun geste entre les deux).
   */
  it.each(["none", "react"] as const)(
    "app complete tout juste créée (front %s) → bloc inchangé",
    (frontend) => {
      const racine = mkdtempSync(path.join(tmpdir(), "nf-upgrade-new-"));
      aSupprimer.push(racine);
      const dest = path.join(racine, "app");
      runScaffold(
        {
          type: "app",
          answers: { name: "fresh", preset: "complete", frontend },
          dir: dest,
          force: false,
        },
        version,
      );
      assert.strictEqual(
        refreshAgentsGuide(dest, version, true).status,
        "unchanged",
      );
      assert.deepStrictEqual(checkAgentsGuide(dest, version), []);
    },
  );

  /*
   *   `npm create nodefony -- chat --dir .` : l'application s'appelle `chat`,
   *   son dossier non. `create front` rendait le bloc avec le nom du DOSSIER,
   *   `doctor` le jugeait avec le nom du MANIFESTE — et déclarait périmé, juste
   *   après le générateur, un bloc que personne n'avait touché (#652, tâche 0
   *   jouée par Codex sur 10.0.0-beta.4).
   */
  it("app dont le dossier ne porte pas le nom, puis create front → bloc inchangé", () => {
    const racine = mkdtempSync(path.join(tmpdir(), "nf-upgrade-front-"));
    aSupprimer.push(racine);
    const dest = path.join(racine, "dossier-du-poste");
    runScaffold(
      {
        type: "app",
        answers: { name: "chat", preset: "complete", frontend: "none" },
        dir: dest,
        force: false,
      },
      version,
    );
    runScaffold(
      {
        type: "front",
        answers: { name: "chat", frontend: "react", route: "/demo" },
        dir: dest,
        force: false,
      },
      version,
    );
    assert.ok(
      lire(dest).includes("nodefony/react"),
      "le bloc ne nomme pas le moteur front ajouté",
    );
    assert.strictEqual(
      refreshAgentsGuide(dest, version, true).status,
      "unchanged",
    );
    assert.deepStrictEqual(checkAgentsGuide(dest, version), []);
  });

  it("réécrit le bloc périmé, et lui seul", () => {
    const racine = appPerimee();
    assert.strictEqual(refreshAgentsGuide(racine, version).status, "updated");
    const apres = lire(racine);
    assert.ok(
      apres.startsWith(`${AVANT}${START}`),
      "le texte AVANT le bloc a bougé",
    );
    assert.ok(
      apres.endsWith(`${END}${APRES}`),
      "le texte APRÈS le bloc a bougé",
    );
    assert.ok(
      !apres.includes("bloc de la version précédente"),
      "l'ancien bloc est resté",
    );
  });

  it("une seconde passe ne trouve plus rien à faire", () => {
    const racine = appPerimee();
    refreshAgentsGuide(racine, version);
    const une = lire(racine);
    assert.strictEqual(refreshAgentsGuide(racine, version).status, "unchanged");
    assert.strictEqual(lire(racine), une);
  });

  it("en simulation, juge sans écrire", () => {
    const racine = appPerimee();
    const avant = lire(racine);
    assert.strictEqual(
      refreshAgentsGuide(racine, version, true).status,
      "updated",
    );
    assert.strictEqual(lire(racine), avant);
  });

  it("ne recrée pas un AGENTS.md absent — son absence peut être un choix", () => {
    const racine = appPerimee(null);
    assert.strictEqual(refreshAgentsGuide(racine, version).status, "absent");
    assert.ok(!existsSync(path.join(racine, "AGENTS.md")));
  });

  it("ne touche jamais l'AGENTS.md d'un monorepo de paquets, écrit à la main", () => {
    const racine = appPerimee();
    writeFileSync(
      path.join(racine, "package.json"),
      JSON.stringify({ name: "depot", workspaces: ["packages/@depot/*"] }),
    );
    const avant = lire(racine);
    assert.strictEqual(refreshAgentsGuide(racine, version).status, "skipped");
    assert.strictEqual(lire(racine), avant);
  });
});

describe("doctor — fraîcheur de la documentation des agents", () => {
  it("signale un bloc périmé en nommant `nodefony upgrade`", () => {
    const findings = checkAgentsGuide(appPerimee(), version);
    const bloc = findings.find((f) => f.kind === "agents-guide-stale");
    assert.ok(bloc, JSON.stringify(findings));
    assert.match(bloc.message, /nodefony upgrade/);
  });

  it("se tait sur un bloc à jour", () => {
    const racine = appPerimee();
    refreshAgentsGuide(racine, version);
    assert.deepStrictEqual(
      checkAgentsGuide(racine, version).filter(
        (f) => f.kind === "agents-guide-stale",
      ),
      [],
    );
  });
});

describe("isUpgradePending — ce que `--check` compte", () => {
  const base: IUpgradeReport = {
    version,
    dryRun: true,
    agents: { status: "unchanged", file: "AGENTS.md" },
    skills: {
      directory: ".agents/skills",
      skills: [],
      orphelins: [],
      preserves: [],
    },
    contributions: [],
  };
  const contribution = {
    packageName: "@nodefony/security",
    written: [],
    kept: [],
    updated: [],
    outdated: [],
    modified: [],
    error: null,
  };

  it("à jour : rien à faire", () => {
    assert.strictEqual(isUpgradePending(base), false);
  });
  it("bloc périmé : en retard", () => {
    assert.strictEqual(
      isUpgradePending({
        ...base,
        agents: { status: "updated", file: "AGENTS.md" },
      }),
      true,
    );
  });
  it("copie intacte à rafraîchir : en retard", () => {
    assert.strictEqual(
      isUpgradePending({
        ...base,
        contributions: [{ ...contribution, updated: ["a"] }],
      }),
      true,
    );
  });
  it("copie RETOUCHÉE, AGENTS.md absent : pas en retard — rien ne se tranche sans humain", () => {
    assert.strictEqual(
      isUpgradePending({
        ...base,
        agents: { status: "absent", file: "AGENTS.md" },
        contributions: [{ ...contribution, kept: ["a"], modified: ["a"] }],
      }),
      false,
    );
  });
});

describe("lignes de commande", () => {
  it("upgrade sert --help et refuse une option inconnue", () => {
    const aide = parseUpgradeArgv(["node", "nodefony", "upgrade", "--help"]);
    assert.ok(!("error" in aide) && aide.help);
    const refus = parseUpgradeArgv(["node", "nodefony", "upgrade", "--force"]);
    assert.ok("error" in refus);
  });
  it("man rend le chemin d'une page qui existe dans le paquet", () => {
    const opts = parseManArgv(["node", "nodefony", "man", "--path"]);
    assert.ok(!("error" in opts) && opts.path);
    assert.ok(existsSync(manPagePath()), manPagePath());
    assert.ok("error" in parseManArgv(["node", "nodefony", "man", "--bogus"]));
  });
});
