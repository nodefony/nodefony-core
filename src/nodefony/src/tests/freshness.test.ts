import { afterAll } from "vitest";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  utimesSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkAgentTokens,
  checkFreshness,
  nodeBelowEngines,
} from "../kernel/checks/freshness";

// Le jetable du test, le test le supprime : scripts/test/vitest/tmp-guard.ts fait échouer
// la passe sur tout dossier laissé dans le dossier temporaire.
const aSupprimer: string[] = [];
const temporaire = (dossier: string): string => {
  aSupprimer.push(dossier);
  return dossier;
};
afterAll(() => {
  for (const dossier of aSupprimer)
    rmSync(dossier, { recursive: true, force: true });
});

/**
 * Ce qui tourne n'est pas ce qui est écrit — le contrôle qui le dit AVANT.
 *
 * Le runtime charge `dist/`. Une source plus récente que le build est donc du
 * code qui ne s'exécute pas, et c'est la cause perdue la plus fréquente du
 * framework : la route existe, elle compile, elle répond 404. Le noyau la
 * devinait déjà — mais seulement APRÈS un échec de démarrage.
 */
describe("doctor — fraîcheur du build et plancher de Node", () => {
  const app = (): string => {
    const racine = temporaire(
      mkdtempSync(path.join(os.tmpdir(), "nf-freshness-")),
    );
    mkdirSync(path.join(racine, "nodefony"), { recursive: true });
    writeFileSync(path.join(racine, "package.json"), JSON.stringify({}));
    return racine;
  };

  /** Pose une date de modification EXPLICITE — sinon les deux se valent. */
  const dater = (fichier: string, secondes: number): void =>
    utimesSync(fichier, secondes, secondes);

  it("🔴 une source plus récente que le build est signalée, et le geste donné", () => {
    const racine = app();
    const dist = path.join(racine, "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(dist, "index.js"), "//");
    dater(path.join(dist, "index.js"), 1_000);
    const source = path.join(racine, "nodefony", "Widget.ts");
    writeFileSync(source, "export const a = 1;");
    dater(source, 2_000);

    const r = checkFreshness(racine);
    assert.deepEqual(
      r.findings.map((f) => f.kind),
      ["dist-stale"],
    );
    assert.match(r.findings[0]!.message, /npm run build/);
    // Le message NOMME le fichier fautif : sur cinquante sources, il faut
    // savoir laquelle a bougé.
    assert.match(r.findings[0]!.message, /nodefony/);
  });

  it("un build plus récent que les sources ne dit RIEN", () => {
    // L'inverse n'est pas symétrique : un cache de build peut restaurer un
    // artefact au mtime neuf. On n'accuse que dans le sens qui reste vrai.
    const racine = app();
    const dist = path.join(racine, "dist");
    mkdirSync(dist, { recursive: true });
    const source = path.join(racine, "nodefony", "Widget.ts");
    writeFileSync(source, "export const a = 1;");
    dater(source, 1_000);
    writeFileSync(path.join(dist, "index.js"), "//");
    dater(path.join(dist, "index.js"), 2_000);

    assert.deepEqual(checkFreshness(racine).findings, []);
  });

  it("🔴 une application jamais construite est signalée", () => {
    const racine = app();
    writeFileSync(
      path.join(racine, "nodefony", "Widget.ts"),
      "export const a = 1;",
    );
    assert.deepEqual(
      checkFreshness(racine).findings.map((f) => f.kind),
      ["dist-missing"],
    );
  });

  it("un dossier SANS source ni build n'est pas comparable — et le DIT", () => {
    // Le silence d'un contrôle qui n'a rien pu regarder ne vaut pas quitus.
    const racine = temporaire(mkdtempSync(path.join(os.tmpdir(), "nf-vide-")));
    const r = checkFreshness(racine);
    assert.deepEqual(r.findings, []);
    assert.equal(r.notComparable, true);
  });

  it("🔴 un Node en deçà du plancher déclaré est signalé", () => {
    const racine = app();
    writeFileSync(
      path.join(racine, "package.json"),
      JSON.stringify({ engines: { node: ">=24" } }),
    );
    const r = checkFreshness(racine, "v20.11.0");
    assert.ok(r.findings.some((f) => f.kind === "node-below-engines"));
  });

  it("un Node conforme ne dit rien", () => {
    const racine = app();
    writeFileSync(
      path.join(racine, "package.json"),
      JSON.stringify({ engines: { node: ">=24" } }),
    );
    assert.equal(
      checkFreshness(racine, "v26.0.0").findings.filter(
        (f) => f.kind === "node-below-engines",
      ).length,
      0,
    );
  });

  it("la version se lit sur la GRAMMAIRE, pas sur un format supposé", () => {
    // Le plancher s'écrit de plusieurs façons ; aucune ne doit faire taire
    // le contrôle en silence.
    assert.equal(nodeBelowEngines({ node: ">=24" }, "v22.12.0"), ">=24");
    assert.equal(nodeBelowEngines({ node: "^24.1.0" }, "v24.0.0"), "^24.1.0");
    assert.equal(nodeBelowEngines({ node: "24.x" }, "v26.1.0"), "24.x");
    assert.equal(nodeBelowEngines({ node: ">=24" }, "v26.11.1"), null);
    assert.equal(nodeBelowEngines({ node: "récent" }, "v20.0.0"), null);
    assert.equal(nodeBelowEngines(undefined, "v20.0.0"), null);
    assert.equal(nodeBelowEngines(null, "v20.0.0"), null);
  });

  it("🔴 un plancher en COURS de série (>=24.14.0) se lit en entier, pas sur la majeure", () => {
    // Le cas qui a motivé la comparaison complète : le watch du superviseur
    // exige l'option `ignore` de `fs.watch`, apparue en 24.14.
    const engines = { node: ">=24.14.0" };
    assert.equal(nodeBelowEngines(engines, "v24.10.0"), ">=24.14.0");
    assert.equal(nodeBelowEngines(engines, "v24.14.0"), null);
    assert.equal(nodeBelowEngines(engines, "v26.0.0"), null);
    const racine = app();
    writeFileSync(
      path.join(racine, "package.json"),
      JSON.stringify({ engines }),
    );
    const r = checkFreshness(racine, "v24.13.1");
    const f = r.findings.find((x) => x.kind === "node-below-engines");
    assert.ok(f, "un Node 24.13 doit être signalé sous un plancher 24.14");
    assert.match(f.message, />=24\.14\.0/);
  });
});

/**
 * 🔴 Ce que la fraîcheur DÉSIGNAIT, et ce qu'elle comptait à tort.
 *
 * Elle nommait la racine explorée (« `src` est plus récent que le build »),
 * ce qui n'apprend rien sur cinquante sources — et elle comptait les tests,
 * qui n'entrent dans aucun build : écrire un test réclamait un `npm run
 * build`. Un geste inutile réclamé par un diagnostic est un diagnostic qu'on
 * apprend à ignorer.
 */
describe("doctor — la fraîcheur désigne un FICHIER, et ignore ce qui n'est pas bâti", () => {
  const app = (): string => {
    const racine = temporaire(
      mkdtempSync(path.join(os.tmpdir(), "nf-fresh2-")),
    );
    mkdirSync(path.join(racine, "dist"), { recursive: true });
    writeFileSync(path.join(racine, "package.json"), JSON.stringify({}));
    writeFileSync(path.join(racine, "dist", "index.js"), "//");
    utimesSync(path.join(racine, "dist", "index.js"), 1_000, 1_000);
    return racine;
  };

  /** Écrit une source datée APRÈS le build, et rend son chemin absolu. */
  const posterApresLeBuild = (racine: string, rel: string): string => {
    const cible = path.join(racine, ...rel.split("/"));
    mkdirSync(path.dirname(cible), { recursive: true });
    writeFileSync(cible, "export const a = 1;");
    utimesSync(cible, 2_000, 2_000);
    return cible;
  };

  it("⭐ le message nomme le FICHIER qui a bougé, pas la racine explorée", () => {
    const racine = app();
    posterApresLeBuild(racine, "nodefony/controller/WidgetController.ts");
    const r = checkFreshness(racine);
    assert.deepEqual(
      r.findings.map((f) => f.kind),
      ["dist-stale"],
    );
    assert.match(r.findings[0]!.message, /WidgetController\.ts/);
    assert.equal(
      r.findings[0]!.file,
      "nodefony/controller/WidgetController.ts",
    );
  });

  it("🔴 un RÉPERTOIRE nommé `*.ts` ne fait pas tomber le contrôle", () => {
    // La lecture ne demande plus au disque « est-ce un fichier ? » avant
    // d'ouvrir : entre la question et l'ouverture, la réponse peut changer
    // (CodeQL js/file-system-race), et c'était une syscall par fichier exploré.
    // C'est l'ÉCHEC DE LECTURE qui trie désormais — un répertoire lève EISDIR.
    const racine = app();
    const faux = path.join(racine, "nodefony", "Piege.ts");
    mkdirSync(faux, { recursive: true });
    utimesSync(faux, 2_000, 2_000);
    assert.deepEqual(checkFreshness(racine).findings, []);
  });

  it("🔴 un `*.test.ts` récent ne périme AUCUN build", () => {
    const racine = app();
    posterApresLeBuild(racine, "nodefony/Widget.test.ts");
    assert.deepEqual(checkFreshness(racine).findings, []);
  });

  it("🔴 ni un fichier sous `tests/`", () => {
    const racine = app();
    posterApresLeBuild(racine, "src/tests/decor.ts");
    assert.deepEqual(checkFreshness(racine).findings, []);
  });

  it("…mais une vraie source à côté d'eux, si", () => {
    const racine = app();
    posterApresLeBuild(racine, "nodefony/Widget.test.ts");
    posterApresLeBuild(racine, "nodefony/Widget.ts");
    const r = checkFreshness(racine);
    assert.deepEqual(
      r.findings.map((f) => f.kind),
      ["dist-stale"],
    );
    assert.equal(r.findings[0]!.file, "nodefony/Widget.ts");
  });
});

/**
 * Un jeton MCP périmé chez un agent ne casse rien qu'on voie : la porte sert
 * l'agent en anonyme. `doctor` le dit, et donne la commande qui le renouvelle.
 */
describe("checkAgentTokens — le jeton MCP posé chez un agent", () => {
  const NOW = 1_000_000;
  const PORTE = "http://localhost:5151/nodefony/mcp";
  const jeton = (charge: Record<string, unknown>): string =>
    `x.${Buffer.from(JSON.stringify(charge)).toString("base64url")}.y`;
  // Un projet où Claude Code porte `token` ; un foyer VIDE, pour ne jamais
  // lire la configuration de l'agent de la machine qui lance le test.
  const decor = (token: string | null) => {
    const root = temporaire(mkdtempSync(path.join(os.tmpdir(), "nf-jeton-")));
    const home = temporaire(mkdtempSync(path.join(os.tmpdir(), "nf-foyer-")));
    mkdirSync(path.join(root, ".claude"), { recursive: true });
    writeFileSync(
      path.join(root, ".claude", "settings.local.json"),
      JSON.stringify({ env: token === null ? {} : { NF_MCP_TOKEN: token } }),
    );
    return { root, ctx: { home, env: {} } };
  };

  it("jeton EXPIRÉ → constat, avec la commande qui le renouvelle", () => {
    const { root, ctx } = decor(jeton({ exp: NOW - 600, aud: PORTE }));
    const findings = checkAgentTokens(root, NOW, ctx);
    assert.deepEqual(
      findings.map((f) => f.kind),
      ["agent-token-stale"],
    );
    assert.match(findings[0]!.message, /EXPIRÉ/u);
    assert.match(findings[0]!.message, /nodefony security:mcp:token --write/u);
    assert.equal(
      findings[0]!.file,
      path.posix.join(".claude", "settings.local.json"),
    );
  });

  it("jeton d'une AUTRE porte → constat, même loin de son échéance", () => {
    const autre = "http://localhost:6161/nodefony/mcp";
    const { root, ctx } = decor(jeton({ exp: NOW + 86_400, aud: autre }));
    const findings = checkAgentTokens(root, NOW, ctx);
    assert.equal(findings.length, 1);
    assert.match(findings[0]!.message, /autre audience/u);
  });

  it("jeton valide pour cette porte → rien", () => {
    const { root, ctx } = decor(jeton({ exp: NOW + 86_400, aud: PORTE }));
    assert.deepEqual(checkAgentTokens(root, NOW, ctx), []);
  });

  it("aucun jeton posé → rien : une porte anonyme est un choix", () => {
    const { root, ctx } = decor(null);
    assert.deepEqual(checkAgentTokens(root, NOW, ctx), []);
  });

  it("jeton du DOSSIER de l'utilisateur → rien : il peut servir une autre application", () => {
    const { root, ctx } = decor(null);
    mkdirSync(path.join(ctx.home, ".codex"), { recursive: true });
    writeFileSync(
      path.join(ctx.home, ".codex", ".env"),
      `NF_MCP_TOKEN=${jeton({ exp: NOW - 600, aud: PORTE })}\n`,
    );
    assert.deepEqual(checkAgentTokens(root, NOW, ctx), []);
  });
});
