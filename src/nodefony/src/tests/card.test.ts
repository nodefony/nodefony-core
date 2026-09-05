/**
 * La carte de visite — composition, rendu, et lecture À FROID.
 *
 * Ce que ces tests protègent : la carte est la PREMIÈRE chose que lance qui
 * arrive dans une application inconnue. Elle doit donc répondre dans les
 * situations où tout le reste est fermé — application non construite, terminal
 * sans `NODE_ENV`, briques installées mais rien de chargé. Deux régressions
 * possibles sont couvertes ici et nulle part ailleurs : une carte qui exige un
 * boot (elle redeviendrait muette au moment exact où elle sert), et une carte
 * lue à froid qui présenterait des modules INSTALLÉS comme des modules CHARGÉS
 * (elle ferait croire que le gating `policy`/`when` a déjà eu lieu).
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import { assert } from "chai";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCard, renderCard } from "../cli/cardReport";
import { parseCardArgv, readColdCardInput, runCardCommand } from "../cli/card";
import { SysExit } from "../cli/sysexits";

const baseInput = {
  appName: "mon-app",
  appVersion: "1.2.3",
  nodefonyVersion: "10.0.0",
  environment: "development",
  modules: ["http", "framework"],
};

describe("carte de visite — composition (pure)", () => {
  it("trie les modules et déclare `runtime` par défaut", () => {
    const card = buildCard({ ...baseInput, modules: ["studio", "http"] });
    assert.deepEqual(card.modules, ["http", "studio"]);
    assert.strictEqual(card.source, "runtime");
  });

  it("n'ouvre la console d'administration que si `studio` est là", () => {
    const sans = buildCard(baseInput);
    assert.isUndefined(sans.doors.find((p) => p.where === "/nodefony"));
    const avec = buildCard({ ...baseInput, modules: ["http", "studio"] });
    assert.isDefined(avec.doors.find((p) => p.where === "/nodefony"));
  });

  it("cite toujours `AGENTS.md` en PREMIÈRE porte", () => {
    // Un lecteur qui s'arrête au premier item doit tomber sur les instructions
    // de l'application, pas sur un catalogue générique.
    assert.strictEqual(buildCard(baseInput).doors[0]?.where, "AGENTS.md");
  });

  it("préfixe toutes les commandes par `npx`", () => {
    // `nodefony` nu rend 127 : le binaire vit dans les node_modules de l'app.
    for (const verbe of buildCard(baseInput).verbs) {
      assert.match(verbe.command, /^(npx nodefony|npm) /u, verbe.command);
    }
  });
});

describe("carte de visite — rendu", () => {
  it("dit « chargés » quand l'application tournait", () => {
    const texte = renderCard(buildCard({ ...baseInput, source: "runtime" }));
    assert.include(texte, "Modules chargés (2)");
    assert.notInclude(texte, "installés ≠ chargés");
  });

  it("dit « installés » ET pose la réserve quand rien n'a démarré", () => {
    // Le point du test : sans cette mention, une carte lue à froid se ferait
    // passer pour la vérité runtime.
    const texte = renderCard(buildCard({ ...baseInput, source: "static" }));
    assert.include(texte, "Modules installés (2)");
    assert.include(texte, "installés ≠ chargés");
    assert.include(texte, "npx nodefony inspect modules");
  });
});

describe("carte de visite — lecture à froid", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "nodefony-card-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const app = (pkg: Record<string, unknown>): void => {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
    writeFileSync(path.join(dir, "nodefony.config.ts"), "export default {};\n");
  };

  it("lit nom, version et briques d'une application NI installée NI construite", () => {
    app({
      name: "app-froide",
      version: "1.2.3",
      dependencies: { "@nodefony/http": "^10.0.0", "@nodefony/studio": "^10" },
    });
    const input = readColdCardInput(dir, "10.0.0");
    assert.isNotNull(input);
    assert.strictEqual(input?.appName, "app-froide");
    assert.strictEqual(input?.appVersion, "1.2.3");
    assert.strictEqual(input?.source, "static");
    assert.sameMembers(input?.modules ?? [], ["http", "studio"]);
  });

  it("prend la version du framework INSTALLÉ, pas la plage déclarée", () => {
    app({ name: "a", version: "1.0.0", dependencies: { nodefony: "^10.0.0" } });
    const nm = path.join(dir, "node_modules", "nodefony");
    mkdirSync(nm, { recursive: true });
    writeFileSync(
      path.join(nm, "package.json"),
      JSON.stringify({ name: "nodefony", version: "10.4.2" }),
    );
    assert.strictEqual(
      readColdCardInput(dir, "10.0.0")?.nodefonyVersion,
      "10.4.2",
    );
  });

  it("voit les briques LIÉES par npm, absentes des dépendances déclarées", () => {
    // Le cas d'un dépôt en espaces de travail (ou d'une app `create app --link`) :
    // lire les seules deps y rendait « 0 module ».
    app({ name: "a", version: "1.0.0" });
    mkdirSync(path.join(dir, "node_modules", "@nodefony", "realtime"), {
      recursive: true,
    });
    assert.include(readColdCardInput(dir, "10.0.0")?.modules ?? [], "realtime");
  });

  it("voit les modules LOCAUX de l'application (`modules/<nom>`)", () => {
    app({ name: "a", version: "1.0.0" });
    mkdirSync(path.join(dir, "modules", "blog"), { recursive: true });
    assert.include(readColdCardInput(dir, "10.0.0")?.modules ?? [], "blog");
  });

  it("rend `null` sur un package.json illisible plutôt que d'inventer", () => {
    writeFileSync(path.join(dir, "package.json"), "{ pas du json");
    assert.isNull(readColdCardInput(dir, "10.0.0"));
  });
});

describe("carte de visite — ligne de commande", () => {
  it("reconnaît l'alias historique `devkit:card`", () => {
    // Le nom sous lequel la carte a d'abord existé est écrit dans les AGENTS.md
    // déjà générés : le rompre casserait les applications en place.
    const parsed = parseCardArgv(["node", "nodefony", "devkit:card", "--json"]);
    assert.deepInclude(parsed, { json: true });
  });

  it("refuse une option inconnue au lieu de l'ignorer", () => {
    const parsed = parseCardArgv(["node", "nodefony", "card", "--verbeux"]);
    assert.property(parsed, "error");
  });

  it("sort en NOINPUT hors de tout projet, avec le geste à faire", () => {
    const vide = mkdtempSync(path.join(tmpdir(), "nodefony-nocard-"));
    const errs: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => {
      errs.push(String(s));
      return true;
    }) as typeof process.stderr.write;
    try {
      const code = runCardCommand(
        ["node", "nodefony", "card", "--cwd", vide],
        "10.0.0",
      );
      assert.strictEqual(code, SysExit.NOINPUT);
      assert.include(errs.join(""), "create app");
    } finally {
      process.stderr.write = write;
      rmSync(vide, { recursive: true, force: true });
    }
  });
});
