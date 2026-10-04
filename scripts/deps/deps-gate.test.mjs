/**
 * Suite de bout en bout de la garde des dépendances — écrite pour la faire
 * ÉCHOUER, jamais pour l'accompagner.
 *
 * Ce que ces cas gardent : les quatre façons dont `check-deps-latest` rendait un
 * vert sans avoir rien pu voir. Chacune a été constatée sur le dépôt avant
 * correction ; aucune n'avait d'instance vivante, ce qui est précisément ce qui
 * les rendait invisibles — un contrôle ne se juge pas sur les défauts qu'il
 * trouve, mais sur ceux qu'il laisserait passer.
 *
 * Le décor est un dépôt FABRIQUÉ (dossier jetable, `git init`, manifestes et
 * verrou écrits à la main) et un registre INJOIGNABLE : c'est le pire cas, celui
 * où la garde était le plus tentée d'absoudre. Le script n'y accède que par ses
 * deux points d'injection `NF_DEPS_ROOT` et `NF_DEPS_REGISTRY`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "check-deps-latest.mjs",
);

let base;

/** Monte un dépôt jetable ; `fichiers` est une carte chemin → contenu. */
function decor(nom, fichiers) {
  const dir = path.join(base, nom);
  for (const [rel, contenu] of Object.entries(fichiers)) {
    const cible = path.join(dir, rel);
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.writeFileSync(cible, contenu);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

/** Lance la garde sur un décor. Le registre est injoignable À DESSEIN. */
function lancer(dir, args = []) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      NF_DEPS_ROOT: dir,
      // Port réservé par la norme : la connexion échoue tout de suite, sans
      // dépendre d'un serveur à démarrer ni d'un délai d'attente.
      NF_DEPS_REGISTRY: "http://127.0.0.1:9",
    },
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const manifeste = (extra) =>
  JSON.stringify({ name: "faux", version: "1.0.0", ...extra }, null, 2);

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "nf-deps-gate-"));
});
afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("la garde des dépendances mord là où elle était muette", () => {
  it("DÉDOUBLÉ — une version exacte dominée par une plage fait deux copies", () => {
    // `^4.4.3` et `4.6.1` se concilient sur le papier : 4.6.1 satisfait les deux.
    // Mais le verrou porte DÉJÀ deux exemplaires possédés — npm ne redescend pas
    // une copie posée. L'ancienne règle rendait « conciliable », donc vert.
    const dir = decor("dedouble", {
      "package.json": manifeste({ dependencies: { zod: "^4.4.3" } }),
      "pkg/a/package.json": manifeste({ dependencies: { zod: "4.6.1" } }),
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/zod": { version: "4.7.0" },
          "pkg/a/node_modules/zod": { version: "4.6.1" },
        },
      }),
    });
    const r = lancer(dir, ["--gate"]);
    expect(r.out + r.err).toContain("DÉDOUBLÉ");
    expect(r.code).toBe(1);
  });

  it("une copie rangée sous un TIERS ne nous est pas imputée", () => {
    // Le contre-cas, et il compte autant : un contrôle qui crie sur du sain
    // finit désarmé. `chromium-bidi` embarque sa propre copie, ce n'est pas
    // notre arbre qui est dédoublé.
    const dir = decor("tiers", {
      "package.json": manifeste({ dependencies: { zod: "^4.4.3" } }),
      "pkg/a/package.json": manifeste({ dependencies: { zod: "^4.5.0" } }),
      "package-lock.json": JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/zod": { version: "4.7.0" },
          "node_modules/chromium-bidi/node_modules/zod": { version: "3.25.76" },
        },
      }),
    });
    const r = lancer(dir, ["--gate"]);
    expect(r.out + r.err).not.toContain("DÉDOUBLÉ");
    expect(r.code).toBe(0);
  });

  it("--json ne désarme plus --gate, et le document porte le verdict", () => {
    // Le trou : la sortie JSON s'imprimait puis quittait en 0 AVANT le calcul du
    // verdict. `--json --gate` absolvait donc n'importe quoi.
    const dir = decor("json", {
      "package.json": manifeste({ dependencies: { truc: "^3.0.0" } }),
      "pkg/a/package.json": manifeste({ dependencies: { truc: "^4.0.0" } }),
    });
    const lisible = lancer(dir, ["--gate"]);
    expect(lisible.code).toBe(1);

    const r = lancer(dir, ["--json", "--gate"]);
    expect(r.code).toBe(1);
    const doc = JSON.parse(r.out);
    expect(doc.divergent.map((d) => d.severity)).toContain("INCONCILIABLE");
  });

  it("la disjonction est prouvée SANS registre — hors ligne ne veut pas dire absous", () => {
    // Registre injoignable et paquet absent du verrou : aucune candidate. La
    // garde rendait alors « on ne conclut à rien », donc verte — plus clémente
    // hors ligne qu'en ligne, l'inverse de ce qu'elle promet.
    const dir = decor("horsligne", {
      "package.json": manifeste({ dependencies: { truc: ">=1.0.0 <2.0.0" } }),
      "pkg/a/package.json": manifeste({
        dependencies: { truc: ">=2.0.0 <3.0.0" },
      }),
    });
    const r = lancer(dir, ["--gate"]);
    expect(r.out + r.err).toContain("INCONCILIABLE");
    expect(r.code).toBe(1);
  });

  it("un manifeste illisible est NOMMÉ et rend la garde rouge", () => {
    // Il était avalé par un `catch` muet, tout en restant compté dans le nombre
    // de manifestes annoncé : le périmètre était amputé sans que rien le dise.
    const dir = decor("illisible", {
      "package.json": manifeste({ dependencies: { truc: "^1.0.0" } }),
      "pkg/a/package.json": "{ ceci n'est pas du JSON",
    });
    const r = lancer(dir, ["--gate"]);
    expect(r.err).toContain("illisible");
    expect(r.err).toContain(path.join("pkg", "a", "package.json"));
    expect(r.code).toBe(1);
  });

  it("un GABARIT de scaffold non-JSON reste toléré", () => {
    // La contrepartie : ces fichiers portent des jetons d'interpolation à la
    // place des valeurs, et c'est normal.
    const dir = decor("gabarit", {
      "package.json": manifeste({ dependencies: { truc: "^1.0.0" } }),
      "src/cli/scaffold/package.json": '{ "name": "{{ it.nom }}" ',
    });
    const r = lancer(dir, ["--gate"]);
    expect(r.code).toBe(0);
  });

  it("une entrée du catalogue suivie d'un commentaire n'est plus perdue", () => {
    // La regex exigeait une fin de ligne nue : un commentaire faisait disparaître
    // l'entrée du contrôle, sans un mot. Ici `truc` doit entrer en collision avec
    // la racine — s'il est perdu, la garde reste verte et le test tombe.
    const dir = decor("catalogue", {
      "package.json": manifeste({ dependencies: { truc: "^3.0.0" } }),
      "src/nodefony/src/cli/scaffold/versions.ts":
        'export const SCAFFOLD_VERSIONS = {\n  "truc": "^4.0.0", // épinglé exprès\n};\n',
    });
    const r = lancer(dir, ["--gate"]);
    expect(r.out + r.err).toContain("INCONCILIABLE");
    expect(r.code).toBe(1);
  });

  it("une entrée du catalogue mise en commentaire n'est PAS récoltée", () => {
    // `//truc: "^9"` devenait un paquet nommé `//truc`, que le registre ne
    // connaît évidemment pas.
    const dir = decor("commentee", {
      "package.json": manifeste({ dependencies: { truc: "^3.0.0" } }),
      "src/nodefony/src/cli/scaffold/versions.ts":
        'export const SCAFFOLD_VERSIONS = {\n  //"truc": "^4.0.0",\n};\n',
    });
    const r = lancer(dir, ["--gate"]);
    expect(r.out + r.err).not.toContain("//truc");
    expect(r.code).toBe(0);
  });

  it("un overrides qui contredit une dépendance directe est vu", () => {
    // `npm install` refuserait l'arbre (EOVERRIDE) ; la garde ne lisait pas ce
    // champ, donc ne voyait rien.
    const dir = decor("overrides", {
      "package.json": manifeste({
        dependencies: { truc: "^3.0.0" },
        overrides: { truc: "^4.0.0" },
      }),
    });
    const r = lancer(dir, ["--gate"]);
    expect(r.out + r.err).toContain("INCONCILIABLE");
    expect(r.code).toBe(1);
  });
});
