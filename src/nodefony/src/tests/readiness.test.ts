/**
 * `check` — la famille « ce qui empêchera l'application de DÉMARRER ».
 *
 * Ce que ces tests protègent : les quatre causes qui font qu'une application ne
 * se lance pas ET dont le message natif arrive trop loin de la cause — variable
 * requise absente, module du manifeste non installé, dépendance non installée,
 * port tenu par un tiers.
 *
 * Deux d'entre eux gardent une propriété plus importante que les règles
 * elles-mêmes : ne JAMAIS accuser une situation normale (le serveur de
 * développement tient ses propres ports), et ne jamais laisser une ignorance
 * passer pour un contrôle réussi (catalogue de variables illisible).
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import { assert } from "chai";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkReadiness, declaredModules } from "../kernel/checks/readiness";

const kinds = (f: { kind: string }[]): string[] => f.map((x) => x.kind);

describe("manifeste — lecture textuelle des briques déclarées", () => {
  it('relève chaque `use("…")`, dédoublonné', () => {
    const noms = declaredModules(`
      export default defineConfig({
        modules: [use("@nodefony/http"), use("@nodefony/framework", {}), use("@nodefony/http")],
      });
    `);
    assert.deepEqual(noms, ["@nodefony/http", "@nodefony/framework"]);
  });

  it("ignore ce qui est COMMENTÉ — un exemple n'est pas une déclaration", () => {
    const noms = declaredModules(`
      // use("@nodefony/studio"),
      /* use("@nodefony/redis") */
      use("@nodefony/http"),
    `);
    assert.deepEqual(noms, ["@nodefony/http"]);
  });

  it("ignore un nom NON littéral au lieu de le deviner", () => {
    assert.deepEqual(declaredModules(`use(nomVariable), use("@a/b")`), [
      "@a/b",
    ]);
  });
});

describe("check — état d'installation et environnement", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nf-ready-"));
    mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const app = (pkg: object, manifeste = ""): void => {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
    writeFileSync(path.join(dir, "nodefony.config.ts"), manifeste);
  };
  const installe = (nom: string): void => {
    mkdirSync(path.join(dir, "node_modules", nom), { recursive: true });
  };

  it("NOMME le module du manifeste qui n'est pas installé", async () => {
    app({ name: "a" }, `modules: [use("@nodefony/http"), use("@acme/blog")]`);
    installe("@nodefony/http");
    const r = await checkReadiness({ projectRoot: dir });
    assert.deepEqual(kinds(r.findings), ["module-not-installed"]);
    assert.include(r.findings[0].message, "@acme/blog");
    // Le geste qui répare, pas seulement le constat.
    assert.include(r.findings[0].message, "npm install @acme/blog");
    // Et la CONSÉQUENCE doit être vraie. Ce message a longtemps annoncé « le
    // démarrage échouera à l'import » : mesuré sur une application réelle, le
    // Kernel écarte le module en fail-soft, les ports s'ouvrent, et le bilan
    // dit « BOOT dégradé ». Un diagnostic qui envoie chercher un crash
    // inexistant coûte plus cher que pas de diagnostic du tout.
    assert.notInclude(
      r.findings[0].message,
      "échouera",
      "le boot ne s'arrête PAS sur un module absent (fail-soft) — ne pas annoncer un crash",
    );
    assert.include(
      r.findings[0].message,
      "AMPUTÉE",
      "le message doit nommer la vraie conséquence : l'app démarre sans ce module",
    );
  });

  it("accepte un module LOCAL non encore lié (`modules/<nom>`)", async () => {
    // Ce que produit `nodefony create module` avant le `npm install` qui pose le
    // lien : l'accuser ferait échouer le contrôle juste après le scaffold.
    app({ name: "a" }, `modules: [use("@app/blog")]`);
    mkdirSync(path.join(dir, "modules", "blog"), { recursive: true });
    const r = await checkReadiness({ projectRoot: dir });
    assert.deepEqual(kinds(r.findings), []);
  });

  it("NOMME la dépendance déclarée mais absente de node_modules", async () => {
    app({ name: "a", dependencies: { drizzle: "^1", presente: "^1" } });
    installe("presente");
    const r = await checkReadiness({ projectRoot: dir });
    assert.deepEqual(kinds(r.findings), ["dep-not-installed"]);
    assert.include(r.findings[0].message, "drizzle");
  });

  it("se TAIT quand `node_modules` n'existe pas du tout", async () => {
    // Cent lignes pour dire « npm install » n'apprennent rien à personne.
    rmSync(path.join(dir, "node_modules"), { recursive: true, force: true });
    app({ name: "a", dependencies: { drizzle: "^1", autre: "^1" } });
    const r = await checkReadiness({ projectRoot: dir });
    assert.deepEqual(kinds(r.findings), []);
  });

  it("🔴 NE PAS accuser NOTRE serveur qui tient ses propres ports", async () => {
    // L'état sain le plus courant en développement. Un contrôle qui crie ici est
    // un contrôle qu'on apprend à ignorer — et il emporte les vrais signaux.
    app({ name: "a" });
    const r = await checkReadiness({
      projectRoot: dir,
      probe: { probed: [5151, 5152], busy: [5151, 5152], ownedByUs: true },
    });
    assert.deepEqual(kinds(r.findings), []);
  });

  it("NOMME le port tenu par un TIERS, avec les deux gestes", async () => {
    app({ name: "a" });
    const r = await checkReadiness({
      projectRoot: dir,
      probe: { probed: [5151, 5152], busy: [5151], ownedByUs: false },
    });
    assert.deepEqual(kinds(r.findings), ["port-busy"]);
    assert.include(r.findings[0].message, "5151");
    assert.include(r.findings[0].message, "EADDRINUSE");
    assert.include(r.findings[0].message, "nodefony status");
  });

  it("⭐ DIT que les variables n'ont pas pu être contrôlées", async () => {
    // Le catalogue se lit dans le `dist/` de l'app : sur une app non construite
    // il est illisible, et le silence de la règle ne vaut PAS quitus. Une
    // ignorance qui se tait se lit comme un contrôle réussi.
    app({ name: "a" });
    const r = await checkReadiness({ projectRoot: dir });
    assert.isTrue(r.catalogUnreadable);
  });

  it("ne sonde aucun port quand aucune sonde n'est fournie", async () => {
    app({ name: "a" });
    const r = await checkReadiness({ projectRoot: dir });
    assert.deepEqual(r.portsProbed, []);
  });
});
