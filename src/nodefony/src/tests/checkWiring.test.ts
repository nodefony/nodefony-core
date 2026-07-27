/*
 *   Contrôle de câblage — ce que la COPIE casse, et que la compilation ne voit pas.
 *
 *   Le générateur pose le fichier ET sa déclaration. Écrit à la main — parce
 *   qu'une entité voisine était plus courte à copier qu'une commande à lire — le
 *   fichier arrive seul : il compile, son propre test passe, et la table n'est
 *   jamais créée. Ce banc vérifie que le manquement est VU, et surtout qu'il
 *   n'est pas vu là où il n'y en a pas : un contrôle bruyant est un contrôle
 *   qu'on désactive.
 */

import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkWiring } from "../kernel/checks/wiring";

/** Décor minimal d'une cible Nodefony : `index.ts` + `nodefony/`. */
function target(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nf-wiring-"));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

const ENTITY = `
import { defineEntity } from "@nodefony/orm-core";
export const postTable = sqliteTable("posts", {});
export const PostEntity = defineEntity({ name: "Post", module: "app", schema: postTable });
`;

const CONTROLLER = `
export class PostController extends ResourceController {}
`;

describe("check — câblage d'une entité", () => {
  const made: string[] = [];
  const make = (files: Record<string, string>): string => {
    const dir = target(files);
    made.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const d of made) rmSync(d, { recursive: true, force: true });
  });

  it("déclarée dans @entities([…]) → rien à signaler", () => {
    const dir = make({
      "nodefony/entity/Post.ts": ENTITY,
      "index.ts": `import { PostEntity } from "./nodefony/entity/Post";
@entities([PostEntity])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
    assert.strictEqual(r.scanned, 1);
  });

  it("écrite à la main, jamais déclarée → manquement NOMMÉ", () => {
    const dir = make({
      "nodefony/entity/Post.ts": ENTITY,
      "index.ts": `class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 1);
    assert.strictEqual(r.findings[0].kind, "orphan-entity");
    // Le message doit porter le geste, pas seulement le constat.
    assert.match(r.findings[0].message, /@entities\(\[PostEntity\]\)/u);
    assert.strictEqual(
      r.findings[0].file,
      path.join("nodefony", "entity", "Post.ts"),
    );
  });

  it("référencée par son SEUL test → toujours un manquement", () => {
    // Le piège que ce contrôle doit éviter : `create entity` génère un test qui
    // importe l'entité pour l'enregistrer en mémoire. Le compter comme un
    // câblage rendrait le contrôle aveugle au cas qu'il cherche.
    const dir = make({
      "nodefony/entity/Post.ts": ENTITY,
      "index.ts": `class App extends Module {}`,
      "tests/post.test.ts": `import { PostEntity } from "../nodefony/entity/Post";
entityRegistry.register(PostEntity);`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 1);
    assert.strictEqual(r.findings[0].kind, "orphan-entity");
  });

  it("enregistrée IMPÉRATIVEMENT → rien à signaler", () => {
    // Un module du framework enregistre ses entités par code quand leur schéma
    // dépend du runtime. C'est un câblage valide : le contrôle demande qu'un
    // symbole soit référencé, pas qu'il passe par un décorateur.
    const dir = make({
      "nodefony/entity/Post.ts": ENTITY,
      "src/registerStores.ts": `import { PostEntity } from "../nodefony/entity/Post";
entityRegistry.register(PostEntity);`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });

  it("un nom du framework dépossède son module — et le dit", () => {
    const dir = make({
      "nodefony/entity/User.ts": ENTITY.replace('name: "Post"', 'name: "User"'),
      "index.ts": `import { PostEntity } from "./nodefony/entity/User";
@entities([PostEntity])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 1);
    assert.strictEqual(r.findings[0].kind, "reserved-entity");
    assert.match(r.findings[0].message, /ne démarrera plus/u);
  });

  it("un controller non déclaré répondrait 404 — il est signalé", () => {
    const dir = make({
      "nodefony/controllers/PostController.ts": CONTROLLER,
      "index.ts": `class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 1);
    assert.strictEqual(r.findings[0].kind, "orphan-controller");
    assert.match(r.findings[0].message, /404/u);
  });

  it("déclaré dans @controllers([…]) → rien à signaler", () => {
    const dir = make({
      "nodefony/controllers/PostController.ts": CONTROLLER,
      "index.ts": `import { PostController } from "./nodefony/controllers/PostController";
@controllers([PostController])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });

  it("un canal temps réel exige que la brique soit DÉCLARÉE", () => {
    // Le code compile dès que le paquet traîne dans node_modules, hissé par une
    // transitive. Mais absent du manifeste, le module n'est jamais chargé : le
    // canal n'existe pas, et rien ne le dit. C'est la garde que le générateur
    // pose avant d'écrire, et que la copie manuelle contourne.
    const dir = make({
      "nodefony/controllers/ChatController.ts": `
export class ChatController extends RealtimeController {}`,
      "index.ts": `import { ChatController } from "./nodefony/controllers/ChatController";
@controllers([ChatController])
class App extends Module {}`,
      "nodefony.config.ts": `use("@nodefony/framework", {});`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir, projectRoot: dir });
    assert.strictEqual(r.findings.length, 1, JSON.stringify(r.findings));
    assert.strictEqual(r.findings[0].kind, "missing-brick");
    assert.match(r.findings[0].message, /@nodefony\/realtime/u);
  });

  it("la même classe, la brique déclarée → rien à signaler", () => {
    const dir = make({
      "nodefony/controllers/ChatController.ts": `
export class ChatController extends RealtimeController {}`,
      "index.ts": `import { ChatController } from "./nodefony/controllers/ChatController";
@controllers([ChatController])
class App extends Module {}`,
      "nodefony.config.ts": `use("@nodefony/realtime", {});`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir, projectRoot: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });

  it("sans racine de projet, le contrôle des briques est SAUTÉ (pas deviné)", () => {
    // Une cible analysée seule ne peut rien conclure : le manifeste vit ailleurs.
    // Conclure à l'absence serait accuser sur une information qu'on n'a pas.
    const dir = make({
      "nodefony/controllers/ChatController.ts": `
export class ChatController extends RealtimeController {}`,
      "index.ts": `import { ChatController } from "./nodefony/controllers/ChatController";
@controllers([ChatController])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });

  it("une cible sans nodefony/ n'est pas analysée (et n'accuse personne)", () => {
    const dir = make({ "index.ts": "export const x = 1;" });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.scanned, 0);
    assert.strictEqual(r.findings.length, 0);
  });
});
