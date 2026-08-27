/**
 * Suite de l'audit `external` — écrite pour le faire ÉCHOUER, pas pour l'accompagner.
 *
 * L'audit précédent vivait dans un skill et ne reconnaissait qu'une écriture de config.
 * La migration rolldown en a introduit une seconde : il a cessé de lire quoi que ce soit
 * et n'a rien signalé pendant des semaines. Un contrôle muet est pire qu'absent — on le
 * croit vert. Chaque cas ci-dessous fabrique un dépôt minuscule et vérifie que l'audit
 * MORD, ou qu'il se tait à bon escient.
 *
 * Les cas marqués « PIÈGE » sont ceux où une implémentation plausible passe à côté.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditRepo,
  readExternals,
  usesAutoExternals,
  importedByServerCode,
  bundledThirdParties,
} from "./check-externals.mjs";

const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/**
 * Fabrique un dépôt jetable contenant un seul module sous `src/modules/<nom>`.
 *
 * @param opts.config - contenu de `rolldown.config.ts`
 * @param opts.pkg - manifeste (dependencies / peerDependencies)
 * @param opts.sources - map `chemin relatif au module` → contenu
 * @param opts.dist - paquets tiers à simuler dans `dist/node_modules/`
 */
function repo({ config, pkg, sources = {}, dist = [] }) {
  const root = mkdtempSync(path.join(tmpdir(), "nf-ext-"));
  roots.push(root);
  const dir = path.join(root, "src", "modules", "demo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "rolldown.config.ts"), config);
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "@nodefony/demo", ...pkg }),
  );
  for (const [rel, body] of Object.entries(sources)) {
    const f = path.join(dir, rel);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, body);
  }
  for (const p of dist) {
    const d = path.join(dir, "dist", "node_modules", p);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "index.js"), "// bundlé");
  }
  return { root, module: () => auditRepo(root).report[0], audit: () => auditRepo(root) };
}

const INLINE = (...deps) =>
  `import { defineNodefonyRolldownConfig } from "nodefony/bundler";\nexport default defineNodefonyRolldownConfig({\n  external: [${deps.map((d) => `"${d}"`).join(", ")}],\n});\n`;
const LEGACY = (...deps) =>
  `const external: string[] = [${deps.map((d) => `"${d}"`).join(", ")}];\nexport default { external };\n`;

describe("lecture de la liste external — les DEUX écritures", () => {
  it("reconnaît la forme inline de defineNodefonyRolldownConfig", () => {
    expect([...readExternals(INLINE("zod", "tslib"))]).to.deep.equal(["zod", "tslib"]);
  });

  // PIÈGE : c'est la seule forme que l'ancien audit lisait. Le core l'emploie encore.
  it("reconnaît la forme historique `const external: string[]`", () => {
    expect([...readExternals(LEGACY("nodefony"))]).to.deep.equal(["nodefony"]);
  });

  it("rend un ensemble VIDE sur une config sans external — jamais une exception", () => {
    expect([...readExternals("export default {};")]).to.deep.equal([]);
  });

  it("repère `externalDeps: true`, qui rend l'audit de dérive sans objet", () => {
    expect(usesAutoExternals(INLINE().replace("external: []", "externalDeps: true"))).to.equal(true);
    expect(usesAutoExternals(INLINE("zod"))).to.equal(false);
  });
});

describe("détection de l'import côté serveur", () => {
  const sources = {
    "index.ts": 'import { z } from "zod";\n',
    "nodefony/side.ts": 'import "reflect-metadata";\n',
    "nodefony/sub/deep.ts": 'const m = await import("lighthouse");\n',
    "nodefony/tests/only.ts": 'import vite from "vite";\n',
    "nodefony/x.test.ts": 'import chai from "chai";\n',
  };
  const r = () => repo({ config: INLINE(), pkg: {}, sources });

  it("voit un import nommé", () => {
    expect(importedByServerCode(r().root, "src/modules/demo", "zod")).to.equal("index.ts");
  });

  // PIÈGE VÉCU : chercher `from "x"` rate l'import à effet de bord — précisément la
  // forme de `reflect-metadata`, celle qui est réellement avalée dans ce dépôt.
  it("voit un import à EFFET DE BORD, sans liaison", () => {
    expect(importedByServerCode(r().root, "src/modules/demo", "reflect-metadata")).to.equal(
      "nodefony/side.ts",
    );
  });

  it("voit un import dynamique", () => {
    expect(importedByServerCode(r().root, "src/modules/demo", "lighthouse")).to.equal(
      "nodefony/sub/deep.ts",
    );
  });

  // PIÈGE : le bundler exclut `tests/` et `*.test.ts` — les compter ferait crier
  // l'audit sur des dépendances qui n'entrent jamais dans le paquet.
  it("IGNORE les sources que le bundler n'emporte pas (tests)", () => {
    expect(importedByServerCode(r().root, "src/modules/demo", "vite")).to.equal(null);
    expect(importedByServerCode(r().root, "src/modules/demo", "chai")).to.equal(null);
  });

  it("ne confond pas un préfixe avec un paquet (`zod-form` ≠ `zod`)", () => {
    const f = repo({ config: INLINE(), pkg: {}, sources: { "index.ts": 'import x from "zod-form";\n' } });
    expect(importedByServerCode(f.root, "src/modules/demo", "zod")).to.equal(null);
  });
});

describe("verdict d'ensemble", () => {
  it("VERT : la dépendance importée est bien externalisée", () => {
    const f = repo({
      config: INLINE("zod"),
      pkg: { peerDependencies: { zod: "^4.4.3" } },
      sources: { "index.ts": 'import { z } from "zod";\n' },
    });
    expect(f.audit().faults).to.equal(0);
  });

  // Le cas RÉEL : `zod` importé par le module `test` et absent de sa liste external.
  it("ROUGE : dépendance importée et absente de external → défaut nommé", () => {
    const f = repo({
      config: INLINE("tslib"),
      pkg: { peerDependencies: { zod: "^4.4.3" } },
      sources: { "index.ts": 'import { z } from "zod";\n' },
    });
    const { faults, report } = f.audit();
    expect(faults).to.equal(1);
    expect(report[0].drift).to.deep.include({
      dep: "zod",
      importedAt: "index.ts",
      severity: "fault",
    });
  });

  // PIÈGE : un module à frontend déclare `vite`/`react` que le bundler serveur ne suit
  // jamais. Les compter comme défauts noierait le vrai signal — 20 lignes de bruit.
  it("INFO, pas défaut : dépendance déclarée mais jamais importée côté serveur", () => {
    const f = repo({
      config: INLINE(),
      pkg: { peerDependencies: { vite: "^7.0.0" } },
      sources: { "index.ts": "export const rien = 1;\n" },
    });
    expect(f.audit().faults).to.equal(0);
    expect(f.module().drift[0]).to.include({ dep: "vite", severity: "info" });
  });

  it("ROUGE par la PREUVE : un tiers recopié dans dist, même si la config semble correcte", () => {
    const f = repo({
      config: INLINE("zod"),
      pkg: { peerDependencies: { zod: "^4.4.3" } },
      sources: { "index.ts": 'import { z } from "zod";\n' },
      dist: ["zod"],
    });
    expect(f.audit().faults).to.equal(1);
    expect(f.module().bundled).to.deep.equal(["zod"]);
  });

  it("la preuve nomme aussi un paquet SCOPÉ (`@scope/nom`)", () => {
    const f = repo({ config: INLINE(), pkg: {}, dist: ["@acme/lib"] });
    expect(f.module().bundled).to.deep.equal(["@acme/lib"]);
  });

  // PIÈGE : sans dist, l'absence de preuve n'est pas une preuve d'absence.
  it("DIT qu'un module sans dist n'est pas prouvé, au lieu de le compter vert", () => {
    const f = repo({ config: INLINE(), pkg: {} });
    expect(f.module().distExists).to.equal(false);
    expect(f.module().bundled).to.deep.equal([]);
  });

  it("`externalDeps: true` → aucune dérive calculée", () => {
    const f = repo({
      config: 'export default defineNodefonyRolldownConfig({ externalDeps: true });\n',
      pkg: { peerDependencies: { zod: "^4.4.3" } },
      sources: { "index.ts": 'import { z } from "zod";\n' },
    });
    expect(f.module().auto).to.equal(true);
    expect(f.audit().faults).to.equal(0);
  });
});
