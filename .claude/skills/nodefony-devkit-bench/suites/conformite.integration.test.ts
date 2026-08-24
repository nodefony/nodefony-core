import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DrizzleOrm } from "@nodefony/drizzle";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import {
  inspect,
  routesParChemin,
  type ModuleInspecte,
  type RouteInspectee,
  type ServiceInspecte,
} from "./harness";

/**
 * ÉTAGE 2 — INTÉGRATION : l'application BOOTE en entier, et n'ouvre aucun port.
 *
 * C'est l'étage qui manquait. Entre « l'application se charge » (imports,
 * décorateurs) et « le serveur répond » (HTTP réel), il y a tout le câblage :
 * les services enregistrés au conteneur, les routes montées par le Router, les
 * modules du manifeste effectivement chargés, la config résolue. Un défaut y
 * survit à l'étage 1 — le fichier compile — et n'apparaît à l'étage 3 que sous
 * la forme d'un 404 ou d'un 500 dont la cause est à trois couches de là.
 *
 * Deux familles, et elles ne se recouvrent pas :
 *
 *  1. INTROSPECTION — `nodefony inspect`, qui boote l'application complète en
 *     profil console (aucun serveur monté) et rend son état. C'est la porte
 *     publique du framework : on l'appelle, on ne la réimplémente pas.
 *  2. COUCHE DONNÉE — une vraie base SQLite en mémoire, le patron exact des
 *     tests que `create entity` génère. Elle éprouve ce que l'introspection ne
 *     peut pas voir : que le schéma déclaré produit une table, et que le
 *     contrat d'entrée refuse ce qu'il doit refuser.
 */

const APP = process.cwd();

/**
 * Le boot est PAYÉ UNE FOIS pour toute la famille introspection.
 *
 * Chaque `nodefony inspect` est un démarrage complet (une à deux secondes) :
 * un appel par cas ferait de cet étage le plus lent des trois, pour rendre
 * exactement le même état.
 */
let routes: RouteInspectee[];
let services: ServiceInspecte[];
let modules: ModuleInspecte[];

beforeAll(() => {
  routes = inspect<RouteInspectee[]>("routes");
  services = inspect<ServiceInspecte[]>("services");
  modules = inspect<ModuleInspecte[]>("modules");
}, 240_000);

describe("intégration — l'application boote et se laisse lire", () => {
  it("elle rend des routes, des services et des modules (garde anti-suite creuse)", () => {
    // Sans ce cas, une introspection qui rendrait des tableaux vides laisserait
    // TOUS les suivants verts : chacun d'eux filtre une liste, et filtrer le
    // vide ne trouve jamais de coupable.
    expect(routes.length).toBeGreaterThan(10);
    expect(services.length).toBeGreaterThan(5);
    expect(modules.length).toBeGreaterThan(1);
  });

  it("le module de l'application est chargé", () => {
    expect(modules.map((m) => m.name)).toContain("app");
  });

  it("tout module déclaré au manifeste est effectivement chargé", () => {
    // Le manifeste `modules` de `nodefony.config.ts` est déclaratif et GATABLE
    // (`policy`, `when`). Un nom mal orthographié n'est pas une erreur : le
    // module est simplement absent, en silence. On compare donc ce qui est
    // écrit à ce qui est monté.
    const cfg = readFileSync(path.join(APP, "nodefony.config.ts"), "utf8");
    const bloc = cfg.match(/modules\s*:\s*\[([\s\S]*?)\]/);
    if (bloc === null) return;
    // Deux formes, et DEUX SEULEMENT : `use("@nodefony/x", { … })` et l'entrée
    // nue `"@nodefony/x",`. Ramasser toutes les chaînes du bloc attrape les
    // VALEURS de configuration passées à `use` — au premier run, le
    // `driver: "cluster"` du backplane a été compté comme un module absent, et
    // l'assertion accusait le manifeste d'un manquement inventé.
    const declares = [
      ...bloc[1].matchAll(/use\(\s*["']([^"']+)["']/g),
      ...bloc[1].matchAll(/^\s*["']([^"']+)["']\s*,/gm),
    ].map((m) => m[1]);
    // L'introspection rend DEUX identités par module : la `key` courte
    // (`drizzle`) et le `name` du paquet (`@nodefony/drizzle`). Le manifeste
    // écrit l'une ou l'autre selon la ligne ; comparer à une seule fabrique un
    // manquant pour chaque module correctement chargé — six d'un coup au
    // premier run.
    const charges = new Set<string>();
    for (const m of modules) {
      if (typeof m.key === "string") charges.add(m.key);
      if (typeof m.name === "string") {
        charges.add(m.name);
        charges.add(m.name.replace(/^@nodefony\//, ""));
      }
    }
    const manquants = declares.filter((n) => !charges.has(n));
    expect(manquants).toEqual([]);
  });
});

describe("intégration — le conteneur a bien enregistré ce que l'app déclare", () => {
  it("chaque service du dossier `nodefony/service/` est RÉSOLU au conteneur", () => {
    // L'étage 1 vérifie qu'il est DÉCLARÉ dans `index.ts` ; celui-ci vérifie
    // qu'il est ENREGISTRÉ après un boot réel. Les deux échouent séparément :
    // une classe déclarée mais dont le décorateur `@injectable` manque passe le
    // premier contrôle et rate celui-ci.
    const dir = path.join(APP, "nodefony", "service");
    if (!existsSync(dir)) return;
    // Le critère est le DÉCORATEUR : `create entity` écrit aussi des
    // `*Service.ts` qui ne sont pas des services du conteneur — leur controller
    // les instancie. Les exiger ici accuserait le générateur de ne pas
    // enregistrer ce qui n'a rien à y faire.
    const classes = readdirSync(dir)
      .filter((f) => f.endsWith("Service.ts"))
      .filter((f) =>
        /@injectable\s*\(/.test(readFileSync(path.join(dir, f), "utf8")),
      )
      .map((f) => f.replace(/\.ts$/, ""));
    const enregistrees = new Set(services.map((s) => s.class));
    const absents = classes.filter((c) => !enregistrees.has(c));
    expect(absents).toEqual([]);
  });

  it("aucun service enregistré deux fois sous le même nom", () => {
    // Deux services de même nom : le second écrase le premier au conteneur, et
    // l'injection rend un objet qui n'est pas celui qu'on croit.
    const vus = new Map<string, string[]>();
    for (const s of services) {
      const liste = vus.get(s.name);
      if (liste === undefined) vus.set(s.name, [s.class]);
      else liste.push(s.class);
    }
    const collisions = [...vus.entries()]
      .filter(([, v]) => v.length > 1)
      .map(([n, v]) => `${n} → ${v.join(" vs ")}`);
    expect(collisions).toEqual([]);
  });
});

describe("intégration — le Router a monté ce que les controllers déclarent", () => {
  it("chaque controller de l'application porte au moins une route", () => {
    const dir = path.join(APP, "nodefony", "controllers");
    if (!existsSync(dir)) return;
    // Le fichier ne suffit pas : un controller qu'on a cessé de déclarer reste
    // sur le disque, et il est NORMAL qu'il ne porte aucune route. Ce qu'on
    // éprouve est le contraire — un controller DÉCLARÉ dans `@controllers([…])`
    // dont le Router n'a monté aucune route : là, l'application annonce une
    // surface qu'elle ne sert pas, et répond 404 sur sa propre documentation.
    const index = readFileSync(path.join(APP, "index.ts"), "utf8");
    // Le bloc du DÉCORATEUR, pas le fichier entier : la ligne `import` cite le
    // controller sans le déclarer. Un controller importé mais retiré de
    // `@controllers([…])` est exactement le cas normal qu'on ne doit pas punir
    // — vécu ici, où le banc retire du câblage les ressources d'un autre
    // dialecte et laisse leurs imports.
    const bloc = index.match(/@controllers\s*\(\s*\[([\s\S]*?)\]/);
    const declares = bloc === null ? "" : bloc[1];
    const classes = readdirSync(dir)
      .filter((f) => f.endsWith("Controller.ts"))
      .map((f) => f.replace(/\.ts$/, ""))
      .filter((c) => new RegExp(`\\b${c}\\b`).test(declares));
    const montes = new Set(routes.map((r) => r.controller));
    const muets = classes.filter((c) => !montes.has(c));
    expect(muets).toEqual([]);
  });

  it("aucune collision méthode + chemin (WebSocket exclu)", () => {
    // Une même méthode HTTP sur un même chemin, déclarée deux fois : le Router
    // en sert UNE, et laquelle dépend de l'ordre d'enregistrement. Le WebSocket
    // est écarté parce qu'il coexiste LÉGITIMEMENT avec les méthodes HTTP du
    // même chemin — c'est la co-citoyenneté HTTP+WS du framework, pas un
    // doublon.
    const vus = new Map<string, string[]>();
    for (const r of routes) {
      for (const m of r.methods) {
        if (m === "WEBSOCKET") continue;
        const cle = `${m} ${r.path} @${r.host ?? "*"}`;
        const liste = vus.get(cle);
        const qui = `${r.module}/${r.controller}.${r.action}`;
        if (liste === undefined) vus.set(cle, [qui]);
        else liste.push(qui);
      }
    }
    const collisions = [...vus.entries()]
      .filter(([, v]) => v.length > 1)
      .map(([c, v]) => `${c} → ${v.join(" vs ")}`);
    expect(collisions).toEqual([]);
  });

  it("aucune route de l'application ne CONTOURNE le firewall", () => {
    // `bypassFirewall` est une porte dérobée légitime pour quelques routes du
    // cœur (les probes, la négociation). Une route générée pour une application
    // n'a aucune raison de la prendre : si un gabarit se met à la poser, toutes
    // les applications naissent avec un trou.
    const propres = new Set(["framework", "studio", "devkit", "security"]);
    const coupables = routes
      .filter((r) => r.bypassFirewall && !propres.has(r.module))
      .map((r) => `${r.module} ${r.methods.join(",")} ${r.path}`);
    expect(coupables).toEqual([]);
  });

  it("une ressource générée expose le CRUD REST COMPLET", () => {
    // `create entity --controller rest` promet six portes. Il en manque une et
    // l'application répond 404 sur une opération que sa propre documentation
    // annonce — le genre de trou qu'aucune assertion de chaîne ne voit, parce
    // que le fichier contient bien le mot « delete ».
    const parChemin = routesParChemin(routes.filter((r) => r.module === "app"));
    const collections = [...parChemin.entries()].filter(
      ([chemin, liste]) =>
        !chemin.includes("{") &&
        liste.some((r) => r.methods.includes("POST")) &&
        liste.some((r) => r.methods.includes("GET")),
    );
    if (collections.length === 0) return;
    const [chemin] = collections[0];
    const surCollection = new Set(
      (parChemin.get(chemin) ?? []).flatMap((r) => r.methods),
    );
    const surItem = new Set(
      (parChemin.get(`${chemin}/{id}`) ?? []).flatMap((r) => r.methods),
    );
    expect([...surCollection]).toEqual(expect.arrayContaining(["GET", "POST"]));
    expect([...surItem]).toEqual(
      expect.arrayContaining(["GET", "PATCH", "DELETE"]),
    );
  });
});

describe("intégration — la couche donnée, sur une vraie base", () => {
  /**
   * Une entité de l'application, découverte plutôt que supposée.
   *
   * Écrire « Post » en dur coupleraient ces suites au décor du banc : une
   * application témoin générée autrement les rendrait rouges sans qu'aucun
   * défaut n'existe.
   */
  const dirEntites = path.join(APP, "nodefony", "entity");
  const entites = existsSync(dirEntites)
    ? readdirSync(dirEntites)
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".schema.ts"))
        .map((f) => f.replace(/\.ts$/, ""))
    : [];

  const ORM = "conformite-integration";
  let orm: DrizzleOrm | null = null;
  let nomEntite: string | null = null;

  beforeAll(async () => {
    if (entites.length === 0) return;
    // TOUTES les entités sont enregistrées, pas seulement celle qu'on exerce :
    // l'ORM résout les relations déclarées au moment de se connecter et lève si
    // l'une pointe une entité qu'il ne connaît pas. C'est le comportement
    // voulu, et le reproduire ici est ce qui rend ce cas fidèle au boot réel.
    const chargees: Array<{ nom: string; entity: Record<string, unknown> }> =
      [];
    for (const nom of entites) {
      const fichier = path.join(dirEntites, `${nom}.ts`);
      const mod = (await import(fichier)) as Record<string, unknown>;
      const entity = mod[`${nom}Entity`] as Record<string, unknown> | undefined;
      if (entity === undefined) continue;
      // Les entités d'un AUTRE dialecte ne sont pas jouables sur SQLite : leurs
      // types (`uuid`, `numeric`) n'y existent pas, et l'ORM refuse de se
      // connecter — « its schema is not a sqlite table ».
      //
      // Le dialecte ne se lit PAS sur l'entité : il n'y a pas de champ pour ça.
      // Il se lit dans la fabrique de table du schéma — `sqliteTable(` contre
      // `pgTable(`. Vécu : un filtre sur `entity.dialect` ne mord pas, la
      // connexion lève dans le `beforeAll`, et vitest marque les trois cas
      // SKIPPÉS — un skip qui se lit comme un vert.
      if (!/\bsqliteTable\s*\(/.test(readFileSync(fichier, "utf8"))) continue;
      entityRegistry.register({ ...entity, connector: ORM } as never);
      chargees.push({ nom, entity });
    }
    if (chargees.length === 0) return;
    nomEntite = String(chargees[0].entity.name ?? chargees[0].nom);
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
  }, 120_000);

  afterAll(async () => {
    if (orm !== null) await orm.disconnect();
    for (const nom of entites) entityRegistry.unregister(nom, ORM);
    ormRegistry.unregister(ORM);
  });

  it("la couche donnée a bien été montée (garde anti-skip silencieux)", () => {
    // Ce cas existe parce qu'un `beforeAll` qui lève ne rougit PAS les cas
    // qu'il précède : vitest les marque skippés, et un skip compte vert dans un
    // rapport lu vite. Si l'application a des entités sqlite, l'ORM DOIT être
    // debout — sinon on l'énonce ici, une fois, en rouge.
    const sqlite = entites.filter((nom) =>
      /\bsqliteTable\s*\(/.test(
        readFileSync(path.join(dirEntites, `${nom}.ts`), "utf8"),
      ),
    );
    if (sqlite.length === 0) return;
    expect(
      orm,
      `${sqlite.length} entité(s) sqlite déclarées, ORM non connecté`,
    ).not.toBeNull();
  });

  it("le schéma déclaré produit une table interrogeable", async () => {
    if (orm === null || nomEntite === null) return;
    const repo = orm.getRepository<Record<string, unknown>>(nomEntite);
    // Compter sur une table qui n'existe pas lève : ce cas prouve que le DDL
    // dérivé de l'entité a réellement été appliqué.
    await expect(repo.count()).resolves.toBeTypeOf("number");
  });

  it("le contrat d'entrée de chaque entité refuse un corps vide", async () => {
    // Un schéma qui accepte `{}` laisse créer un enregistrement sans aucun de
    // ses champs requis : le 422 promis par la ressource ne se produit jamais,
    // et la base se remplit de lignes vides.
    const laxistes: string[] = [];
    for (const nom of entites) {
      const f = path.join(dirEntites, `${nom}.schema.ts`);
      if (!existsSync(f)) continue;
      const mod = (await import(f)) as Record<string, unknown>;
      const schema = mod[`create${nom}Schema`] as
        { parse: (v: unknown) => unknown } | undefined;
      if (schema === undefined) continue;
      try {
        schema.parse({});
        laxistes.push(nom);
      } catch {
        // refus attendu
      }
    }
    expect(laxistes).toEqual([]);
  });

  it("le contrat d'entrée RETIRE les champs inconnus (anti-promotion)", async () => {
    // Le cas d'attaque : poster `{ …, role: "admin" }`. Un schéma permissif le
    // laisse passer jusqu'à la couche donnée, où il peut atterrir dans une
    // colonne homonyme.
    if (entites.length === 0) return;
    for (const nom of entites) {
      const f = path.join(dirEntites, `${nom}.schema.ts`);
      if (!existsSync(f)) continue;
      const mod = (await import(f)) as Record<string, unknown>;
      const schema = mod[`create${nom}Schema`] as
        | { safeParse: (v: unknown) => { success: boolean; data?: unknown } }
        | undefined;
      if (schema === undefined) continue;
      const r = schema.safeParse({ __intrus__: "x" });
      if (r.success && r.data !== undefined) {
        expect(r.data).not.toHaveProperty("__intrus__");
      }
    }
  });
});
