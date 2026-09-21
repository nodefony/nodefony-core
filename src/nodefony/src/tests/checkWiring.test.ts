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
import type { IWiringFinding } from "../kernel/checks/wiring";

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

  // Le contrat d'entrée doit exiger ce que la BASE exige. Sinon la validation
  // laisse passer, et c'est le moteur qui refuse : un 500 là où l'application
  // devait rendre un 422 nommant le champ. Mesuré au banc le 18/09 — un agent a
  // ajouté un slug en notNull() et l'a laissé optional() au contrat ; typecheck,
  // tests et doctor étaient tous verts.
  const ENTITE_SLUG = [
    'import { defineEntity } from "@nodefony/orm-core";',
    'import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";',
    'export const posts = sqliteTable("posts", {',
    '  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),',
    '  title: text("title").notNull(),',
    '  slug: text("slug").notNull(),',
    '  views: integer("views").notNull().default(0),',
    '  body: text("body"),',
    '  createdAt: integer("created_at").notNull().$defaultFn(() => new Date()),',
    "});",
    'export const PostEntity = defineEntity({ name: "Post", table: posts });',
  ].join("\n");

  const contratAvec = (slugFacultatif: boolean): string =>
    [
      'import { z } from "zod";',
      "export const createPostSchema = z.object({",
      "  title: z.string().min(1),",
      `  slug: z.string().min(1)${slugFacultatif ? ".optional()" : ""},`,
      "  body: z.string().optional(),",
      "});",
      "export const updatePostSchema = createPostSchema.partial();",
    ].join("\n");

  const DECLARE = [
    'import { PostEntity } from "./nodefony/entity/Post";',
    "@entities([PostEntity])",
    "class App extends Module {}",
  ].join("\n");

  const desaccords = (dir: string): IWiringFinding[] =>
    checkWiring({ roots: [dir], cwd: dir }).findings.filter(
      (x) => x.kind === "champ-facultatif-que-la-base-exige",
    );

  it("un champ que la base EXIGE et que le contrat rend facultatif → signalé", () => {
    const dir = make({
      "nodefony/entity/Post.ts": ENTITE_SLUG,
      "nodefony/entity/Post.schema.ts": contratAvec(true),
      "index.ts": DECLARE,
    });
    const f = desaccords(dir);
    assert.strictEqual(f.length, 1, JSON.stringify(f));
    assert.ok(f[0]?.message.includes("slug"), f[0]?.message);
    // Le fichier NOMMÉ est le contrat, pas l'entité : c'est lui qu'on corrige.
    assert.ok(f[0]?.file.endsWith("Post.schema.ts"), f[0]?.file);
  });

  it("le MÊME champ rendu obligatoire au contrat → plus rien à signaler", () => {
    const dir = make({
      "nodefony/entity/Post.ts": ENTITE_SLUG,
      "nodefony/entity/Post.schema.ts": contratAvec(false),
      "index.ts": DECLARE,
    });
    assert.deepStrictEqual(desaccords(dir), []);
  });

  it("une colonne à DÉFAUT reste légitimement facultative", () => {
    // views porte un default(0), createdAt un defaultFn : leur absence à
    // l'entrée est normale. Sans cette exclusion, le contrôle accuserait tout
    // gabarit du framework. Le nom qui commence par un dollar compte : un motif
    // de suffixe écrit sans lui tronque la chaîne avant, et rend la colonne
    // « exigée » alors qu'elle porte un défaut.
    const dir = make({
      "nodefony/entity/Post.ts": ENTITE_SLUG,
      "nodefony/entity/Post.schema.ts": [
        'import { z } from "zod";',
        "export const createPostSchema = z.object({",
        "  title: z.string().min(1),",
        "  slug: z.string().min(1),",
        "  views: z.number().optional(),",
        "  createdAt: z.date().optional(),",
        "});",
      ].join("\n"),
      "index.ts": DECLARE,
    });
    assert.deepStrictEqual(desaccords(dir), []);
  });

  it("sans fichier de contrat VOISIN, rien n'est reproché", () => {
    const dir = make({
      "nodefony/entity/Post.ts": ENTITE_SLUG,
      "index.ts": DECLARE,
    });
    assert.deepStrictEqual(desaccords(dir), []);
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
      "nodefony/entity/Session.ts": ENTITY.replace(
        'name: "Post"',
        'name: "session"',
      ),
      "index.ts": `import { PostEntity } from "./nodefony/entity/Session";
@entities([PostEntity])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 1);
    assert.strictEqual(r.findings[0].kind, "reserved-entity");
    assert.match(r.findings[0].message, /ne démarrera plus/u);
  });

  it("l'entité `User` de l'application n'est PAS une dépossession", () => {
    // L'identité est du domaine : le framework ne livre plus cette table, et
    // une application qui la déclare fait exactement ce qu'on attend d'elle.
    // Tant que ce contrôle criait, il apprenait à ignorer ses propres alertes.
    const dir = make({
      "nodefony/entity/User.ts": ENTITY.replace('name: "Post"', 'name: "User"'),
      "index.ts": `import { PostEntity } from "./nodefony/entity/User";
@entities([PostEntity])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
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

  it("la réponse écrite à la main est nommée — les TROIS façons d'en sortir", () => {
    // Les trois motifs viennent de runs RÉELS du banc de découvrabilité, sur la
    // tâche « servir une page sans desserrer la politique de contenu » : un
    // agent a casté, un autre a posé Content-Type lui-même. Aucun test de leur
    // application ne l'a vu — le corps arrivait bien.
    const dir = make({
      "nodefony/controllers/WidgetController.ts": `
export class WidgetController extends Controller {
  @Get("/widget")
  page() {
    const r = this.response as any;
    r.setHeader("Content-Type", "text/html; charset=utf-8");
    this.response.end("<h1>ok</h1>");
  }
}`,
      "index.ts": `import { WidgetController } from "./nodefony/controllers/WidgetController";
@controllers([WidgetController])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    const dits = r.findings.filter((f) => f.kind === "reponse-a-la-main");
    assert.strictEqual(dits.length, 3, JSON.stringify(r.findings));
    assert.match(dits.map((f) => f.message).join("\n"), /setContextHtml/u);
  });

  it("un controller qui emploie les façades n'est PAS accusé", () => {
    // L'échantillon vertueux se copie du produit : un en-tête MÉTIER reste
    // légitime, seul Content-Type est visé. Un contrôle qui crie dessus est un
    // contrôle qu'on désactive.
    const dir = make({
      "nodefony/controllers/PageController.ts": `
export class PageController extends Controller {
  @Get("/page")
  page() {
    this.setContextHtml();
    this.response?.setHeader("X-Total-Count", "12");
    return this.render("<h1>ok</h1>");
  }
  @Get("/api/page")
  json() { return this.renderJson({ ok: true }); }
}`,
      "index.ts": `import { PageController } from "./nodefony/controllers/PageController";
@controllers([PageController])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });

  it("le manquement CITÉ EN COMMENTAIRE ne s'accuse pas lui-même", () => {
    // La mise en garde qu'on écrit dans un TSDoc porte le motif interdit : sans
    // le retrait des commentaires, documenter la règle la déclencherait.
    const dir = make({
      "nodefony/controllers/DocController.ts": `
/**
 * Ne fais JAMAIS \`const r = this.response as any\` ni
 * \`setHeader("Content-Type", …)\` : emploie this.render(html).
 */
export class DocController extends Controller {
  @Get("/doc")
  page() { this.setContextHtml(); return this.render("<h1>ok</h1>"); }
}`,
      "index.ts": `import { DocController } from "./nodefony/controllers/DocController";
@controllers([DocController])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });

  it("hors d'un controller, poser un en-tête ne regarde personne", () => {
    const dir = make({
      "nodefony/service/ProxyService.ts": `
export class ProxyService extends Service {
  amont(res: ServerResponse) { res.setHeader("Content-Type", "application/json"); }
}`,
      "index.ts": `class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
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

  /*
   *   La garde EXPLIQUÉE ne s'accuse pas, la garde POSÉE s'accuse toujours.
   *
   *   Les deux cas dans le même test, et c'est délibéré : séparés, on ne
   *   saurait pas si le silence du second vient du nettoyage ou d'un contrôle
   *   qui a cessé de mordre. Le premier décor est celui du contrôleur que le
   *   générateur écrit — il commente `@IsGranted` pour l'enseigner, sans
   *   jamais l'employer, et faisait sortir `npm run verify` en 1 sur une
   *   application qui venait de naître.
   */
  it("@IsGranted commenté n'accuse rien ; posé, il exige toujours sa brique", () => {
    const manifesteSansSecurite = `use("@nodefony/framework", {});`;

    const commente = make({
      "nodefony/controllers/HelloController.ts": `
/**
 * Pour réserver cette route : pose @IsGranted("ROLE_USER") sur la méthode.
 */
export class HelloController extends Controller {
  // décommente @IsGranted("ROLE_ADMIN") pour la fermer
  hello() {}
}`,
      "index.ts": `import { HelloController } from "./nodefony/controllers/HelloController";
@controllers([HelloController])
class App extends Module {}`,
      "nodefony.config.ts": manifesteSansSecurite,
    });
    const silence = checkWiring({
      roots: [commente],
      cwd: commente,
      projectRoot: commente,
    });
    assert.strictEqual(
      silence.findings.length,
      0,
      JSON.stringify(silence.findings),
    );

    const pose = make({
      "nodefony/controllers/HelloController.ts": `
export class HelloController extends Controller {
  @IsGranted("ROLE_ADMIN")
  hello() {}
}`,
      "index.ts": `import { HelloController } from "./nodefony/controllers/HelloController";
@controllers([HelloController])
class App extends Module {}`,
      "nodefony.config.ts": manifesteSansSecurite,
    });
    const mord = checkWiring({
      roots: [pose],
      cwd: pose,
      projectRoot: pose,
    });
    assert.strictEqual(mord.findings.length, 1, JSON.stringify(mord.findings));
    assert.strictEqual(mord.findings[0].kind, "missing-brick");
    assert.match(mord.findings[0].message, /@nodefony\/security/u);
  });

  /*
   *   Une brique CITÉE en commentaire ne compte pas non plus comme déclarée —
   *   le nettoyage vaut dans les deux sens. Sans lui, « décommente ceci pour
   *   activer @nodefony/security » suffirait à faire taire la garde sur une
   *   application qui ne charge rien.
   */
  it("une brique nommée dans un commentaire du manifeste ne vaut pas déclaration", () => {
    const dir = make({
      "nodefony/controllers/AdminController.ts": `
export class AdminController extends Controller {
  @IsGranted("ROLE_ADMIN")
  index() {}
}`,
      "index.ts": `import { AdminController } from "./nodefony/controllers/AdminController";
@controllers([AdminController])
class App extends Module {}`,
      "nodefony.config.ts": `
// décommente pour activer : use("@nodefony/security", {})
use("@nodefony/framework", {});`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir, projectRoot: dir });
    assert.strictEqual(r.findings.length, 1, JSON.stringify(r.findings));
    assert.strictEqual(r.findings[0].kind, "missing-brick");
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

/*
 *   Un hook de cycle de vie au nom VOISIN — écrit, compilé, jamais appelé.
 *
 *   `Module.setEvents()` attache chaque hook sous un `if (this.onKernelX)` :
 *   `onKernelBooted` n'entre dans aucun de ces `if`. La méthode existe, elle
 *   compile, elle se lit — et l'initialisation qu'elle porte n'a jamais lieu.
 *   Le symptôme arrive très loin de sa cause, et aucun test unitaire ne le voit.
 */
describe("check — un hook de module au nom inconnu", () => {
  const made: string[] = [];
  const make = (files: Record<string, string>): string => {
    const dir = target(files);
    made.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const d of made) rmSync(d, { recursive: true, force: true });
  });

  it("nom voisin sur un Module → signalé", () => {
    const dir = make({
      "nodefony/entity/Post.ts": ENTITY,
      "index.ts": `import { PostEntity } from "./nodefony/entity/Post";
@entities([PostEntity])
class App extends Module {
  async onKernelBooted(): Promise<this> {
    return this;
  }
}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    const f = r.findings.filter((x) => x.kind === "hook-lifecycle-inconnu");
    assert.strictEqual(f.length, 1, JSON.stringify(r.findings));
    assert.match(f[0].message, /onKernelBooted/u);
  });

  it("les trois hooks légitimes → rien à signaler", () => {
    const dir = make({
      "nodefony/entity/Post.ts": ENTITY,
      "index.ts": `import { PostEntity } from "./nodefony/entity/Post";
@entities([PostEntity])
class App extends Module {
  async onKernelRegister(): Promise<this> { return this; }
  async onKernelBoot(): Promise<this> { return this; }
  override async onKernelReady(): Promise<this> { return this; }
}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });

  /*
   *   Le faux positif à écarter : `onKernelStart` est le hook d'une COMMAND,
   *   pas d'un module. Un fichier qui ne déclare aucun `extends Module` n'a
   *   rien à voir avec cette règle — l'accuser apprendrait à la contourner.
   */
  it("une Command et son onKernelStart → épargnées", () => {
    const dir = make({
      "nodefony/entity/Post.ts": ENTITY,
      "nodefony/command/MyCommand.ts": `export class MyCommand extends Command {
  override async onKernelStart(): Promise<void> {}
}`,
      "index.ts": `import { PostEntity } from "./nodefony/entity/Post";
@entities([PostEntity])
class App extends Module {}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    const f = r.findings.filter((x) => x.kind === "hook-lifecycle-inconnu");
    assert.strictEqual(f.length, 0, JSON.stringify(r.findings));
  });

  it("un APPEL au bon hook ne s'accuse pas lui-même", () => {
    const dir = make({
      "nodefony/entity/Post.ts": ENTITY,
      "index.ts": `import { PostEntity } from "./nodefony/entity/Post";
@entities([PostEntity])
class App extends Module {
  async onKernelBoot(): Promise<this> {
    await this.onKernelReady();
    return this;
  }
}`,
    });
    const r = checkWiring({ roots: [dir], cwd: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });
});

/*
 *   Une zone de firewall qui ÉNUMÈRE des routes au lieu de couvrir un espace.
 *
 *   Mode d'échec MESURÉ (banc de découvrabilité, tâche 17) : sommés de protéger
 *   deux routes d'un même espace, 3 agents sur 4 écrivent la liste des routes du
 *   jour dans le `pattern`. Les deux routes refusent bien l'anonyme, les tests
 *   passent, la revue passe — et la troisième route de l'espace, ajoutée plus
 *   tard, est publique. Le contrôle lit la FORME parce qu'il ne PEUT pas
 *   interroger les routes : celle qui paiera n'existe pas encore.
 */
describe("check — une zone de firewall énumère des routes", () => {
  const made: string[] = [];
  const make = (files: Record<string, string>): string => {
    const dir = target(files);
    made.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const d of made) rmSync(d, { recursive: true, force: true });
  });

  /** Manifeste minimal portant le bloc `areas` — le reste ne compte pas ici. */
  const manifeste = (areas: string): Record<string, string> => ({
    "nodefony.config.ts": `export default defineConfig((ctx) => ({
  security: {
    areas: {
${areas}
    },
  },
}));`,
    "index.ts": `class App extends Module {}`,
  });

  it("énumère les routes du jour → signalé, avec le préfixe à employer", () => {
    const dir = make(
      manifeste(`      compte: {
        pattern: "^/api/account/(profile|invoices)",
        authenticators: ["session"],
      },`),
    );
    const r = checkWiring({ roots: [dir], cwd: dir, projectRoot: dir });
    const f = r.findings.filter((x) => x.kind === "firewall-area-enumere");
    assert.strictEqual(f.length, 1, JSON.stringify(r.findings));
    assert.match(f[0].message, /\^\/api\/account"/u);
    assert.strictEqual(f[0].file, "nodefony.config.ts");
  });

  it("couvre le préfixe → rien à signaler", () => {
    const dir = make(
      manifeste(`      compte: {
        pattern: "^/api/account",
        authenticators: ["session"],
      },`),
    );
    const r = checkWiring({ roots: [dir], cwd: dir, projectRoot: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });

  /*
   *   Une zone qui OUVRE inverse le raisonnement de la règle. Énumérer y est le
   *   geste JUSTE — c'est même celui que le gabarit d'application recommande en
   *   toutes lettres : `"anonymous"` sur un pattern large ouvrirait TOUT
   *   l'espace, soit exactement le trou que la zone fermée vient de boucher.
   *   Signaler ici, c'est condamner ce qu'on prescrit — et le conseil rendu
   *   (« écris `^/api` ») OUVRIRAIT l'espace entier à l'anonyme.
   */
  it("zone qui OUVRE (anonymous) et énumère → épargnée", () => {
    const dir = make(
      manifeste(`      demo: {
        pattern: "^/api/(hello|echo|live)(/|$)",
        authenticators: ["session", "anonymous"],
      },
      main: {
        pattern: "^/api",
        authenticators: ["session"],
      },`),
    );
    const r = checkWiring({ roots: [dir], cwd: dir, projectRoot: dir });
    const f = r.findings.filter((x) => x.kind === "firewall-area-enumere");
    assert.strictEqual(f.length, 0, JSON.stringify(r.findings));
  });

  it("zone qui FERME et énumère, à côté d'une zone ouverte → signalée", () => {
    const dir = make(
      manifeste(`      demo: {
        pattern: "^/api/(hello|echo)(/|$)",
        authenticators: ["session", "anonymous"],
      },
      compte: {
        pattern: "^/api/account/(profile|invoices)",
        authenticators: ["session"],
      },`),
    );
    const r = checkWiring({ roots: [dir], cwd: dir, projectRoot: dir });
    const f = r.findings.filter((x) => x.kind === "firewall-area-enumere");
    assert.strictEqual(f.length, 1, JSON.stringify(r.findings));
    assert.match(f[0].message, /\^\/api\/account"/u);
  });

  it("ancre de fin → signalé : la zone ne couvre aucune route sœur", () => {
    const dir = make(
      manifeste(`      compte: {
        pattern: "^/api/account/profile$",
        authenticators: ["session"],
      },`),
    );
    const r = checkWiring({ roots: [dir], cwd: dir, projectRoot: dir });
    const f = r.findings.filter((x) => x.kind === "firewall-area-enumere");
    assert.strictEqual(f.length, 1, JSON.stringify(r.findings));
  });

  /*
   *   Le faux positif qui rendrait le contrôle nuisible : une alternance EN TÊTE
   *   ne liste pas des routes, elle désigne deux ESPACES. La recaler
   *   apprendrait à contourner le contrôle plutôt qu'à écrire juste.
   */
  it("alternance de deux espaces en tête → épargnée", () => {
    const dir = make(
      manifeste(`      publique: {
        pattern: "^/(api|admin)",
        authenticators: ["session", "anonymous"],
      },`),
    );
    const r = checkWiring({ roots: [dir], cwd: dir, projectRoot: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });

  /*
   *   Le contrôle ne doit pas mordre sur sa PROPRE documentation : le gabarit
   *   d'application explique le piège en citant le contre-exemple. Sans le
   *   retrait des commentaires, toute application fraîche naîtrait avec un
   *   avertissement portant sur du texte explicatif.
   */
  it("le contre-exemple cité en COMMENTAIRE n'accuse personne", () => {
    const dir = make(
      manifeste(`      /**
       * jamais pattern: "^/api/account/(profile|invoices)" — voir la doc.
       */
      compte: {
        pattern: "^/api/account",
        authenticators: ["session"],
      },`),
    );
    const r = checkWiring({ roots: [dir], cwd: dir, projectRoot: dir });
    assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  });
});

describe("check — l'ORDRE des magasins, jugé À FROID", () => {
  /**
   * Décor d'un projet : un manifeste, et des paquets factices dans son
   * `node_modules` — c'est là que le contrôle lit les déclarations, sans jamais
   * résoudre ni importer quoi que ce soit.
   */
  function projet(ordre: string[]): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nf-store-order-"));
    writeFileSync(
      path.join(dir, "nodefony.config.ts"),
      `export default defineConfig(() => ({\n  modules: [\n${ordre
        .map((m) => `    ${JSON.stringify(m)},`)
        .join("\n")}\n  ],\n}));\n`,
    );
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "p" }),
    );
    const poser = (nom: string, nodefony: Record<string, unknown>): void => {
      const d = path.join(dir, "node_modules", ...nom.split("/"));
      mkdirSync(d, { recursive: true });
      writeFileSync(
        path.join(d, "package.json"),
        JSON.stringify({ name: nom, nodefony }),
      );
    };
    poser("@acme/orm", { storeKind: "durable", stores: ["session", "tokens"] });
    poser("@acme/cache", { storeKind: "cache", stores: ["session"] });
    poser("@acme/security", { consumesStores: true });
    poser("@acme/http", {});
    return dir;
  }

  const fautes = (dir: string): IWiringFinding[] =>
    checkWiring({ roots: [dir], cwd: dir, projectRoot: dir }).findings.filter(
      (f) => f.kind === "store-order",
    );

  it("🔴 signale un ORM déclaré APRÈS son consommateur, et nomme le remède", () => {
    const dir = projet(["@acme/http", "@acme/security", "@acme/orm"]);
    try {
      const f = fautes(dir);
      assert.strictEqual(f.length, 1, JSON.stringify(f));
      const msg = f[0]!.message;
      assert.ok(msg.includes("@acme/orm"), msg);
      assert.ok(msg.includes("@acme/security"), msg);
      assert.ok(msg.includes("Remède"), msg);
      // Le doctor SIGNALE — il n'a rien refusé, et le dire ferait chercher un
      // démarrage qui n'a pas eu lieu.
      assert.ok(!msg.includes("refusé"), msg);
      // Le fichier désigné doit être celui qu'on ÉDITE pour corriger.
      assert.strictEqual(f[0]!.file, "nodefony.config.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("se tait sur l'ordre juste", () => {
    const dir = projet(["@acme/orm", "@acme/http", "@acme/security"]);
    try {
      assert.deepEqual(fautes(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("se tait sur un fournisseur de CACHE déclaré après — Redis y vit, et y fonctionne", () => {
    const dir = projet(["@acme/orm", "@acme/security", "@acme/cache"]);
    try {
      assert.deepEqual(fautes(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("se tait quand la racine du projet n'est pas fournie — rien à lire, rien à dire", () => {
    const dir = projet(["@acme/security", "@acme/orm"]);
    try {
      assert.deepEqual(
        checkWiring({ roots: [dir], cwd: dir }).findings.filter(
          (f) => f.kind === "store-order",
        ),
        [],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
