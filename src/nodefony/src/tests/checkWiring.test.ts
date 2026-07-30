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

  it("un segment `:param` est monté LITTÉRAL — le contrôle le traduit", () => {
    const dir = make({
      "nodefony/controllers/AuthorController.ts": `
export class AuthorController extends Controller {
  @Get("/api/authors/:handle")
  fiche(handle: string) { return { handle }; }
}`,
      "index.ts": `import { AuthorController } from "./nodefony/controllers/AuthorController";
@controllers([AuthorController])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 1, JSON.stringify(r.findings));
    assert.strictEqual(r.findings[0].kind, "route-colon-param");
    // Le message porte le GESTE — le chemin corrigé, pas seulement le constat.
    assert.match(r.findings[0].message, /"\/api\/authors\/\{handle\}"/u);
  });

  it("la forme `{param}` du framework → rien à signaler", () => {
    const dir = make({
      "nodefony/controllers/AuthorController.ts": `
export class AuthorController extends Controller {
  @Get("/api/authors/{handle}")
  fiche(@Param("handle") handle: string) { return { handle }; }
}`,
      "index.ts": `import { AuthorController } from "./nodefony/controllers/AuthorController";
@controllers([AuthorController])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });

  it("un deux-points qui n'est PAS un segment n'accuse personne", () => {
    // `http://`, `C:/`, une heure — le `/` exigé devant les deux-points les
    // écarte. Un contrôle qui crie sur ces cas est un contrôle qu'on désactive.
    const dir = make({
      "nodefony/controllers/ProxyController.ts": `
export class ProxyController extends Controller {
  @Get("/proxy")
  amont() { return { cible: "http://amont.local/v1", a: "12:30" }; }
}`,
      "index.ts": `import { ProxyController } from "./nodefony/controllers/ProxyController";
@controllers([ProxyController])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });

  it("la forme `path:` de @route est lue AUSSI", () => {
    const dir = make({
      "nodefony/controllers/AuthorController.ts": `
export class AuthorController extends Controller {
  @route("author-fiche", { path: "/api/authors/:handle", method: "GET" })
  fiche(handle: string) { return { handle }; }
}`,
      "index.ts": `import { AuthorController } from "./nodefony/controllers/AuthorController";
@controllers([AuthorController])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 1, JSON.stringify(r.findings));
    assert.strictEqual(r.findings[0].kind, "route-colon-param");
  });

  it("le routage react-router n'est PAS accusé (`:id` y est juste)", () => {
    // Vécu : la première version lisait `path:` partout et rendait les cinq
    // routes du frontend de Studio fautives. Le contrôle aurait fait corriger
    // du code correct — le pire mode de défaillance d'un contrôle.
    const dir = make({
      "src/App.tsx": `
const routes = [
  { path: "modules/:name", element: <ModulePage /> },
  { path: "users/:id", element: <UserPage /> },
];`,
      "index.ts": `class App extends Module {}`,
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

/*
 *   Le service est le seul cas où « quelqu'un te nomme » ne prouve RIEN.
 *
 *   Une entité orpheline n'est nommée nulle part — c'est ce qui la trahit. Un
 *   service non déclaré, lui, est presque toujours nommé : le controller le
 *   reçoit en paramètre de constructeur, et le framework l'auto-résout depuis le
 *   registre des classes (`injector.ts`, résolution par `design:paramtypes`).
 *   L'application RÉPOND — mesuré, HTTP 200 — et le service n'existe pour
 *   personne d'autre : hors ordre de démarrage, hors rapport de boot, hors
 *   introspection, construit à la première requête au lieu du boot.
 *
 *   D'où un critère différent pour ce seul manquement : une DÉCLARATION, pas une
 *   mention.
 */
const SERVICE = `
import { Service, injectable } from "nodefony";
@injectable()
export class DiscountService extends Service {
  constructor() { super("discount"); }
}
`;

describe("check — câblage d'un service", () => {
  const made: string[] = [];
  const make = (files: Record<string, string>): string => {
    const dir = target(files);
    made.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const d of made) rmSync(d, { recursive: true, force: true });
  });

  it("déclaré dans @services([…]) → rien à signaler", () => {
    const dir = make({
      "nodefony/services/DiscountService.ts": SERVICE,
      "index.ts": `import { DiscountService } from "./nodefony/services/DiscountService";
@services([DiscountService])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
    assert.strictEqual(r.scanned, 1);
  });

  it("NOMMÉ par un controller mais jamais déclaré → manquement", () => {
    // Le cas réel, relevé au banc : l'agent injecte proprement le service dans
    // son controller, l'endpoint répond juste, et rien n'a été déclaré. Si ce
    // test passait au vert, le contrôle serait aveugle à son unique cible.
    const dir = make({
      "nodefony/services/DiscountService.ts": SERVICE,
      "nodefony/controllers/HelloController.ts": `
import { DiscountService } from "../services/DiscountService";
export class HelloController extends Controller {
  constructor(context: ContextType, discountService: DiscountService) { super("hello", context); }
}`,
      "index.ts": `import { HelloController } from "./nodefony/controllers/HelloController";
@controllers([HelloController])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    const service = r.findings.filter((f) => f.kind === "orphan-service");
    assert.strictEqual(service.length, 1, JSON.stringify(r.findings));
    assert.match(service[0].message, /@services\(\[DiscountService\]\)/u);
  });

  it("enregistré à la MAIN → rien à signaler", () => {
    // La règle est « quelqu'un te déclare », pas « tu passes par le décorateur ».
    // Les modules du framework posent une partie de leurs services en impératif ;
    // les tenir pour orphelins accuserait le cœur de violer sa propre convention.
    const dir = make({
      "nodefony/services/DiscountService.ts": SERVICE,
      "index.ts": `import { DiscountService } from "./nodefony/services/DiscountService";
class App extends Module {
  async onKernelBoot() { this.addService(DiscountService); return this; }
}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });

  it("une base abstraite n'est pas un service à enregistrer", () => {
    const dir = make({
      "nodefony/services/BaseService.ts": `
import { Service, injectable } from "nodefony";
@injectable()
export abstract class BaseService extends Service {}`,
      "index.ts": `class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
    assert.strictEqual(r.scanned, 0);
  });
});
