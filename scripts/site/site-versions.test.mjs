/**
 * Éprouve l'agencement des versions du site et le dossier de sortie neuf.
 *
 * Ce qu'il garde : la racine décrit la version PUBLIÉE et un push sur `dev` ne
 * la change pas ; chaque archive garde son dossier ; le sélecteur mène à la
 * même page dans l'autre version ; un générateur ne vide que ce qu'il a rendu.
 */
import { describe, expect, it, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import {
  compareVersions,
  isVersionDir,
  manifestFor,
  planVersions,
  relativeDir,
  versionSwitchScript,
  versionTarget,
} from "./lib/site-versions.mjs";
import { prepareOutDir } from "./lib/out-dir.mjs";
import { REPO_ROOT } from "../lib/repo-root.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-site-versions-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("versions du site", () => {
  it("ordonne les préversions selon semver", () => {
    const v = ["10.0.0", "10.0.0-beta.10", "10.0.0-beta.2", "10.0.0-alpha.9"];
    expect([...v].sort(compareVersions)).toEqual([
      "10.0.0-alpha.9",
      "10.0.0-beta.2",
      "10.0.0-beta.10",
      "10.0.0",
    ]);
  });

  it("refuse un nom d'archive qui sortirait du site", () => {
    expect(isVersionDir("10.0.0-beta.4")).toBe(true);
    for (const bad of ["..", "../x", "10.0.0/..", "v10.0.0", "next", ""])
      expect(isVersionDir(bad)).toBe(false);
    expect(() =>
      planVersions({ published: "1.0.0", archives: ["../x"], hasNext: false }),
    ).toThrow(/invalide/);
  });

  it("met la version publiée à la racine, next d'abord, archives récentes ensuite", () => {
    const plan = planVersions({
      published: "10.0.0-beta.4",
      archives: ["10.0.0-beta.2", "10.0.0-beta.4", "10.0.0-beta.3"],
      hasNext: true,
    });
    expect(plan.map((e) => [e.id, e.dir])).toEqual([
      ["next", "next"],
      ["10.0.0-beta.4", ""],
      ["10.0.0-beta.3", "10.0.0-beta.3"],
      ["10.0.0-beta.2", "10.0.0-beta.2"],
    ]);
  });

  it("écrit des liens relatifs au dossier qui reçoit le manifeste", () => {
    expect(relativeDir("", "next")).toBe("next/");
    expect(relativeDir("next", "")).toBe("../");
    expect(relativeDir("next", "1.0.0")).toBe("../1.0.0/");
    expect(relativeDir("1.0.0", "1.0.0")).toBe("./");
    const plan = planVersions({
      published: "2.0.0",
      archives: ["2.0.0", "1.0.0"],
      hasNext: true,
    });
    // L'archive de la version publiée n'est pas listée, mais elle sait où elle est.
    const m = manifestFor(plan, "2.0.0");
    expect(m.current).toBe("2.0.0");
    expect(m.versions.find((v) => v.id === "2.0.0").href).toBe("../");
    expect(manifestFor(plan, "").versions.map((v) => v.href)).toEqual([
      "next/",
      "./",
      "1.0.0/",
    ]);
  });

  it("mène à la même page dans l'autre version, sous le sous-chemin publié", () => {
    const site = "https://nodefony.github.io/nodefony-core/";
    const t = versionTarget(
      `${site}next/docs/guides/routage/#params`,
      `${site}next/`,
      "../1.0.0/",
    );
    expect(t.page).toBe(`${site}1.0.0/docs/guides/routage/#params`);
    expect(t.home).toBe(`${site}1.0.0/`);
    expect(versionTarget(`${site}docs/`, site, "next/").page).toBe(
      `${site}next/docs/`,
    );
  });

  it("le script servi embarque la fonction éprouvée, et se lit", () => {
    const s = versionSwitchScript("../../");
    expect(s).toContain(versionTarget.toString());
    const js = /<script>([\s\S]*)<\/script>/.exec(s)[1];
    // Compilé sans être exécuté : une erreur de syntaxe dans la page ne se
    // verrait nulle part ailleurs — le sélecteur serait juste absent.
    expect(() => new vm.Script(js)).not.toThrow();
  });
});

describe("dossier de sortie", () => {
  it("crée, vide un rendu précédent, refuse un dossier étranger", () => {
    const d = path.join(tmp, "out");
    expect(prepareOutDir(d, "sig.json")).toBe("created");
    expect(prepareOutDir(d, "sig.json")).toBe("empty");
    fs.writeFileSync(path.join(d, "sig.json"), "{}");
    fs.writeFileSync(path.join(d, "perimee.html"), "x");
    expect(prepareOutDir(d, "sig.json")).toBe("cleared");
    expect(fs.readdirSync(d)).toEqual([]);
    fs.writeFileSync(path.join(d, "a-moi.txt"), "x");
    expect(() => prepareOutDir(d, "sig.json")).toThrow(/refusé/);
    expect(fs.existsSync(path.join(d, "a-moi.txt"))).toBe(true);
  });

  it("refuse un dossier qui contient le dépôt", () => {
    // Une signature qu'aucun dossier ne porte : même la garde débranchée, rien
    // ne serait vidé — le test échoue, il ne peut pas détruire.
    const noSig = "nf-signature-introuvable-605";
    expect(() =>
      prepareOutDir(path.dirname(REPO_ROOT), noSig, { protect: REPO_ROOT }),
    ).toThrow(/contient/);
    expect(() =>
      prepareOutDir(REPO_ROOT, noSig, { protect: REPO_ROOT }),
    ).toThrow(/contient/);
  });
});

describe("assemblage", () => {
  const page = (dir, rel, body) => {
    fs.mkdirSync(path.join(dir, rel), { recursive: true });
    fs.writeFileSync(path.join(dir, rel, "index.html"), body);
  };
  const assemble = (...a) =>
    execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts", "site", "assemble-site.mjs"), ...a],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe" },
    );

  it("garde les archives d'une release à l'autre, sans toucher la racine", () => {
    const pub = path.join(tmp, "pub");
    const next = path.join(tmp, "next");
    const arch = path.join(tmp, "archives");
    page(pub, "", "racine");
    page(pub, "docs", "doc publiée");
    page(next, "", "dev");
    page(arch, "1.0.0", "archive 1");
    page(arch, "1.1.0", "archive 2");
    const out = path.join(tmp, "site");
    assemble(
      "--published",
      pub,
      "--next",
      next,
      "--archives",
      arch,
      "--out",
      out,
      "--version",
      "1.1.0",
    );
    const read = (...p) => fs.readFileSync(path.join(out, ...p), "utf8");
    expect(read("index.html")).toBe("racine");
    expect(read("next", "index.html")).toBe("dev");
    expect(read("1.0.0", "index.html")).toBe("archive 1");
    expect(read("1.1.0", "index.html")).toBe("archive 2");
    const ids = JSON.parse(read("versions.json")).versions.map((v) => v.id);
    expect(ids).toEqual(["next", "1.1.0", "1.0.0"]);
    for (const d of ["next", "1.0.0", "1.1.0"])
      expect(fs.existsSync(path.join(out, d, "versions.json"))).toBe(true);
  });

  it("le contrôle des liens refuse un lien qui sort du dossier contrôlé", () => {
    // Le bandeau de `next/` remonte vers la racine : sur `next` SEUL, il sort.
    const site = path.join(tmp, "liens");
    page(site, "", '<a href="docs/">doc</a>');
    page(site, "docs", '<a href="../../">hors du site</a>');
    // Le fichier visé existe sur le disque : seule la garde le refuse.
    fs.writeFileSync(path.join(tmp, "index.html"), "hors du site");
    const check = () =>
      execFileSync(
        process.execPath,
        [path.join(REPO_ROOT, "scripts", "site", "check-site-links.mjs"), site],
        { encoding: "utf8", stdio: "pipe" },
      );
    expect(check).toThrow(/1 lien/);
    fs.writeFileSync(
      path.join(site, "docs", "index.html"),
      '<a href="../">ok</a>',
    );
    expect(check()).toContain("0 cassé");
  });

  it("refuse une archive dont le nom n'est pas une version", () => {
    const pub = path.join(tmp, "pub2");
    const arch = path.join(tmp, "archives2");
    page(pub, "", "racine");
    page(arch, "pas-une-version", "x");
    expect(() =>
      assemble(
        "--published",
        pub,
        "--archives",
        arch,
        "--out",
        path.join(tmp, "site2"),
        "--version",
        "1.0.0",
      ),
    ).toThrow(/nom invalide/);
  });
});
