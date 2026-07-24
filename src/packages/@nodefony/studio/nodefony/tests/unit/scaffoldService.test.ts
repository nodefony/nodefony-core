/// <reference types="node" />
/**
 * Unit — pilotage du générateur de code depuis Studio (`ScaffoldService`).
 *
 * Ce chemin n'avait AUCUN test : `destination.ts` (la validation des chemins)
 * était couvert dans le core, mais pas son consommateur — celui qui décide
 * quand refuser, où écrire, et ce qu'il rend au formulaire.
 *
 * Ce qui est verrouillé ici :
 *  - le refus HORS développement, prononcé côté serveur (un endpoint qui écrit
 *    sur le disque et lance npm n'a rien à faire ailleurs) ;
 *  - la simulation : elle passe par le vrai moteur, ne touche pas au disque, et
 *    distingue ce qui serait créé de ce qui serait réécrit ;
 *  - un refus du moteur reste un refus en simulation (sinon la préview
 *    promettrait un scaffold que l'exécution refuserait) ;
 *  - la destination d'une app : recomposée sous une racine autorisée, jamais
 *    prise telle quelle dans la demande du client.
 *
 * Le service est instancié SANS kernel booté : on lui fournit un module
 * factice. C'est suffisant — tout ce qui est testé ici est synchrone et local.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import { expect } from "chai";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runScaffold } from "nodefony";
import ScaffoldService from "../../service/ScaffoldService";

/**
 * Module factice : le service ne lit du module que `kernel` (environnement,
 * chemin, version) et les briques de `Service` (conteneur, événements,
 * options). Un vrai boot n'apporterait rien et coûterait un serveur.
 */
function fakeModule(projectDir: string, environment: string) {
  const noop = () => undefined;
  return {
    kernel: { environment, path: projectDir, version: "10.0.0" },
    container: { get: () => undefined, set: noop },
    notificationsCenter: { on: noop, fire: noop, removeListener: noop },
    options: {},
    log: noop,
  } as unknown as ConstructorParameters<typeof ScaffoldService>[0];
}

describe("ScaffoldService — pilotage du générateur depuis Studio", () => {
  let tmp: string;
  /** Une app réelle, générée par le moteur : le décor de tout scaffold in-project. */
  let project: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "nf-studio-scaffold-"));
    project = path.join(tmp, "host");
    runScaffold(
      {
        type: "app",
        answers: { name: "host", preset: "minimal", frontend: "none" },
        dir: project,
        force: false,
      },
      "10.0.0",
    );
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const service = (environment = "development") =>
    new ScaffoldService(fakeModule(project, environment));

  it("hors développement, le service refuse — côté serveur", () => {
    const svc = service("production");
    expect(svc.enabled).to.equal(false);
    expect(() => svc.preview("controller", { name: "blog" })).to.throw(
      /development-only/u,
    );
    expect(() => svc.start("controller", { name: "blog" }, [])).to.throw(
      /development-only/u,
    );
  });

  it("la simulation rend le plan sans toucher au disque", () => {
    const svc = service();
    const before = readFileSync(path.join(project, "index.ts"), "utf8");
    const plan = svc.preview("controller", { name: "blog", kind: "hello" });

    expect(plan.dest).to.equal(project);
    const rel = plan.changes.map((c) => path.relative(project, c.path));
    expect(rel).to.include("nodefony/controllers/BlogController.ts");
    expect(rel).to.include("index.ts");
    // Rien n'a bougé : c'est TOUT l'intérêt d'une préview.
    expect(readFileSync(path.join(project, "index.ts"), "utf8")).to.equal(
      before,
    );
    expect(
      existsSync(
        path.join(project, "nodefony", "controllers", "BlogController.ts"),
      ),
    ).to.equal(false);
  });

  it("le plan distingue ce qui naît de ce qui est RÉÉCRIT, et montre l'avant", () => {
    const svc = service();
    const plan = svc.preview("controller", { name: "blog", kind: "hello" });

    const created = plan.changes.filter((c) => c.kind === "create");
    const rewritten = plan.changes.filter((c) => c.kind === "overwrite");
    expect(created.map((c) => path.basename(c.path))).to.include(
      "BlogController.ts",
    );
    // `index.ts` existe : le câblage le réécrit — le seul cas où l'utilisateur
    // a besoin de voir AVANT de valider.
    expect(rewritten.map((c) => path.basename(c.path))).to.deep.equal([
      "index.ts",
    ]);
    expect(rewritten[0].previous).to.be.a("string");
    expect(rewritten[0].previous).to.not.include("BlogController");
    expect(rewritten[0].content).to.include("BlogController");
  });

  it("un scaffold qui sera refusé est refusé DÈS la simulation", () => {
    const svc = service();
    // Un premier controller, pour de vrai.
    runScaffold(
      {
        type: "controller",
        answers: { name: "blog", kind: "hello" },
        dir: project,
        force: false,
      },
      "10.0.0",
    );
    expect(() => svc.preview("controller", { name: "blog" })).to.throw(
      /déjà référencé/u,
    );
  });

  it("une app ne naît que sous une racine autorisée", () => {
    const svc = service();
    // Racine inconnue : la destination n'est pas composable → refus, et aucun
    // chemin du client n'a été utilisé tel quel.
    expect(() =>
      svc.preview("app", { name: "ailleurs", root: "/etc", subPath: "" }),
    ).to.throw();
    // Racine par défaut (le parent du projet) : la destination est recomposée.
    const roots = svc.roots();
    expect(roots).to.not.be.empty;
    const plan = svc.preview("app", {
      name: "voisine",
      root: roots[0].id,
      subPath: "",
      preset: "minimal",
      frontend: "none",
    });
    // Chemin RÉEL : la destination est résolue par `realpath` (le contrôle
    // anti-lien-symbolique) — sur macOS, `/var` mène à `/private/var`.
    expect(plan.dest).to.equal(
      path.join(realpathSync(roots[0].path), "voisine"),
    );
    expect(plan.changes.every((c) => c.kind === "create")).to.equal(true);
    expect(existsSync(plan.dest)).to.equal(false);
  });

  it("les cibles proposées au formulaire sont celles du projet réel", () => {
    const svc = service();
    const targets = svc.targets();
    expect(targets.map((t) => t.kind)).to.include("app");
    expect(targets[0].dir).to.equal(project);
  });
});
