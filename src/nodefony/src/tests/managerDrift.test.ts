import { afterEach, assert, describe, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkManagerDrift,
  declaredPackageManager,
} from "../kernel/checks/managerDrift";
import { checkReadiness } from "../kernel/checks/readiness";

// #294 — une app passée de npm à pnpm/bun (ou l'inverse) SANS régénération :
// chaque outil ignore les fichiers des autres, sans un mot, et la panne
// n'arrive qu'au démarrage. `doctor` doit la nommer avant.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

/** Projet sur disque : `files` = chemin relatif → contenu (objet = JSON). */
const project = (files: Record<string, string | object>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nf-drift-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  return root;
};

/** App avec un module local `@app/blog` sous `modules/*`. */
const withModule = (
  pkg: object,
  extra: Record<string, string | object> = {},
): string =>
  project({
    "package.json": { name: "app", workspaces: ["modules/*"], ...pkg },
    "modules/blog/package.json": { name: "@app/blog" },
    ...extra,
  });

const messages = (root: string, configured?: "npm" | "pnpm"): string[] =>
  checkManagerDrift({ projectRoot: root, configured: configured ?? null }).map(
    (f) => f.message,
  );

describe("doctor — le projet contredit son gestionnaire de paquets", () => {
  it("projet npm cohérent : silence", () => {
    const root = withModule(
      { overrides: { a: "1" } },
      {
        "package-lock.json": "",
        "node_modules/.package-lock.json": "",
      },
    );
    assert.deepEqual(messages(root), []);
  });

  it("sans verrou ni config, rien à juger — jamais l'outil qui lance doctor", () => {
    const root = withModule({ overrides: { a: "1" } });
    assert.deepEqual(messages(root), []);
  });

  it("passé à pnpm : module non lié, packages absent, overrides et allowScripts ignorés", () => {
    const root = withModule(
      { overrides: { a: "1" }, allowScripts: { b: false } },
      { "pnpm-lock.yaml": "" },
    );
    const all = messages(root).join("\n");
    assert.include(all, `"@app/blog": "workspace:*"`);
    assert.include(all, "pnpm ne lit pas le champ workspaces");
    assert.include(all, "pnpm ignore les `overrides`");
    assert.include(all, "ERR_PNPM_IGNORED_BUILDS");
  });

  it("pnpm bien réglé (yaml + workspace:*) : silence", () => {
    const root = withModule(
      { dependencies: { "@app/blog": "workspace:*" } },
      {
        "pnpm-lock.yaml": "",
        "pnpm-workspace.yaml":
          'packages:\n  - "modules/*"\nallowBuilds:\n  x: false\n',
        "node_modules/.modules.yaml": "",
      },
    );
    assert.deepEqual(messages(root), []);
  });

  it("bun : le module non déclaré est nommé", () => {
    const root = withModule({}, { "bun.lock": "" });
    assert.match(
      messages(root).join("\n"),
      /bun ne lie à la racine.*@app\/blog/u,
    );
  });

  it("retour à npm avec un workspace:* : l'installation s'arrêterait", () => {
    const root = withModule(
      { dependencies: { "@app/blog": "workspace:*" } },
      { "package-lock.json": "" },
    );
    assert.match(messages(root).join("\n"), /workspace:, que npm refuse/u);
  });

  it("yarn ≥ 2 (.yarnrc.yml) accepte workspace: — yarn 1 non", () => {
    const pkg = { dependencies: { "@app/blog": "workspace:*" } };
    const berry = withModule(pkg, { "yarn.lock": "", ".yarnrc.yml": "" });
    assert.deepEqual(messages(berry), []);
    const classic = withModule(pkg, { "yarn.lock": "" });
    assert.match(messages(classic).join("\n"), /que yarn refuse/u);
  });

  it("yarn ignore overrides, npm ignore resolutions", () => {
    const yarn = project({
      "package.json": { overrides: { a: "1" } },
      "yarn.lock": "",
    });
    assert.match(messages(yarn).join("\n"), /yarn ignore `overrides`/u);
    const npm = project({
      "package.json": { resolutions: { a: "1" } },
      "package-lock.json": "",
    });
    assert.match(messages(npm).join("\n"), /npm ignore `resolutions`/u);
  });

  it("deux verrous, node_modules d'un autre outil, config contre verrou", () => {
    const twoLocks = project({
      "package.json": {},
      "package-lock.json": "",
      "pnpm-lock.yaml": "",
      "node_modules/.package-lock.json": "",
    });
    const all = messages(twoLocks).join("\n");
    assert.include(all, "deux gestionnaires ont laissé leur verrou");
    assert.include(all, "node_modules a été installé par npm");
    const configured = project({
      "package.json": {},
      "package-lock.json": "",
    });
    assert.match(
      messages(configured, "pnpm").join("\n"),
      /la configuration désigne pnpm, mais le verrou est celui de npm/u,
    );
  });

  it("le `packageManager` de la config se lit dans le manifeste", () => {
    assert.equal(
      declaredPackageManager(`defineConfig(() => ({ packageManager: "bun" }))`),
      "bun",
    );
    assert.isNull(declaredPackageManager(`packageManager: "cargo"`));
  });

  it("readiness le rapporte, et parle le gestionnaire du projet", async () => {
    const root = withModule(
      { dependencies: { zod: "^4" } },
      {
        "pnpm-lock.yaml": "",
        "nodefony.config.ts": "export default {}",
        "node_modules/.modules.yaml": "",
      },
    );
    const r = await checkReadiness({ projectRoot: root });
    const drift = r.findings.filter((f) => f.kind === "package-manager");
    assert.isNotEmpty(drift);
    const missing = r.findings.find((f) => f.kind === "dep-not-installed");
    assert.match(missing?.message ?? "", /: pnpm install$/u);
  });
});
