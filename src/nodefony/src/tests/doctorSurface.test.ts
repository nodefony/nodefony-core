/**
 * `doctor` — la surface ouverte, et les entités écrites pour un autre moteur.
 *
 * Deux angles morts silencieux : une route de mise au point qui reste ouverte
 * parce que personne n'a jamais la liste sous les yeux, et une entité écartée
 * SANS un mot par l'outil de migration — la table n'est jamais créée, et la
 * première requête répond 500 sans que rien dans le code ne montre la cause.
 *
 * Les décors s'écrivent sur disque parce que le contrôle lit des SOURCES : le
 * simuler en mémoire éprouverait autre chose que ce que l'utilisateur exécute.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import { assert } from "chai";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  balancedBlock,
  checkSurface,
  connectorDialect,
  coversEverything,
  publicAreas,
  toPortablePath,
} from "../kernel/checks/surface";
import { collectDoctorReport } from "../kernel/checks/runDoctor";

let racine = "";

/** Écrit un fichier, dossiers parents compris. */
const poser = (relatif: string, contenu: string): string => {
  const cible = path.join(racine, relatif);
  mkdirSync(path.dirname(cible), { recursive: true });
  writeFileSync(cible, contenu, "utf8");
  return cible;
};

const controler = (env: Record<string, string | undefined> = {}) =>
  checkSurface({ roots: [racine], cwd: racine, projectRoot: racine, env });

beforeEach(() => {
  racine = mkdtempSync(path.join(tmpdir(), "nf-surface-"));
});

afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

describe("balancedBlock — compter les accolades, pas les deviner", () => {
  it("un bloc imbriqué est rendu ENTIER", () => {
    const source = "areas: { a: { b: { c: 1 } }, d: 2 }";
    const bloc = balancedBlock(source, source.indexOf("{"));
    assert.include(bloc, "d: 2");
  });

  it("des accolades qui ne se referment pas ne lèvent pas", () => {
    assert.equal(balancedBlock("{ a: 1", 0), "");
  });
});

describe("publicAreas — les zones ouvertes du manifeste", () => {
  it("🔴 une zone imbriquée n'échappe PAS au relevé", () => {
    // Une expression régulière se serait arrêtée au premier `}` — celui des
    // authentificateurs — et la moitié des zones serait devenue invisible. Un
    // contrôle de surface qui ne voit qu'une partie de la surface est pire
    // qu'aucun.
    const zones = publicAreas(`
      areas: {
        api: {
          pattern: "^/api",
          authenticators: { jwt: { enabled: true } },
          security: true,
        },
        vitrine: {
          pattern: "^/public",
          authenticators: { anonymous: { enabled: true } },
          security: false,
        },
      },
    `);
    assert.deepEqual(zones, [{ pattern: "^/public" }]);
  });

  it("un commentaire qui CITE une zone ouverte n'en crée pas une", () => {
    // Un contrôle qui accuse sa propre documentation est un contrôle qu'on
    // désactive : toute application fraîche naîtrait avec un avertissement.
    const zones = publicAreas(`
      areas: {
        // Contre-exemple à NE PAS suivre : security: false, pattern: "^/"
        api: { pattern: "^/api", security: true },
      },
    `);
    assert.lengthOf(zones, 0);
  });

  it("sans bloc areas, il n'y a rien à relever", () => {
    assert.lengthOf(publicAreas("export default {}"), 0);
  });
});

describe("connectorDialect — d'où vient le dialecte, et on le DIT", () => {
  it("l'infrastructure déclarée gagne — c'est l'hébergeur qui la pose", () => {
    const r = connectorDialect('dialect: "sqlite"', {
      NF_DATABASE_URL: "postgres://app@base/app",
    });
    assert.equal(r.dialect, "postgres");
    assert.equal(r.from, "NF_DATABASE_URL");
  });

  it("à défaut, ce que le manifeste écrit", () => {
    const r = connectorDialect(
      'connectors: { default: { dialect: "mysql" } }',
      {},
    );
    assert.equal(r.dialect, "mysql");
    assert.equal(r.from, "nodefony.config.ts");
  });

  it("à défaut encore, le défaut du connecteur — et la provenance le dit", () => {
    const r = connectorDialect("export default {}", {});
    assert.equal(r.dialect, "sqlite");
    // Sans provenance, un manquement affirmant « le connecteur est sqlite »
    // serait incompréhensible sur une application qui n'a jamais écrit ce mot.
    assert.equal(r.from, "défaut du connecteur");
  });
});

describe("checkSurface — l'inventaire et les deux verdicts", () => {
  it("relève une route ouverte d'un contrôleur, et la NOMME", () => {
    poser(
      "nodefony/controller/DebugController.ts",
      `@controller("/debug")
       class DebugController extends Controller {
         @BypassFirewall
         dumpSession(): void {}
       }`,
    );
    const r = controler();
    const ouverte = r.openings.find((o) => o.kind === "bypass-firewall");
    assert.equal(ouverte?.what, "dumpSession");
    // Un inventaire n'est pas un verdict : ces gestes sont légitimes.
    assert.lengthOf(r.findings, 0);
  });

  it("une ouverture posée sur la CLASSE dit qu'elle vaut pour tout", () => {
    poser(
      "nodefony/controller/OpenController.ts",
      `@controller("/open")
       @BypassFirewall
       class OpenController extends Controller {}`,
    );
    const r = controler();
    assert.include(
      r.openings.find((o) => o.kind === "bypass-firewall")?.what ?? "",
      "toutes ses routes",
    );
  });

  it("une route programmatique compte, même sans décorateur", () => {
    // Les contrôleurs d'authentification du framework posent leurs routes
    // ainsi : n'accepter que le décorateur les ferait disparaître de
    // l'inventaire — donc exactement ceux qu'on veut voir listés.
    poser(
      "nodefony/controller/AuthController.ts",
      `class AuthController extends Controller {}
       Router.createRoute("login", { path: "/login", bypassFirewall: true });`,
    );
    const r = controler();
    assert.lengthOf(
      r.openings.filter((o) => o.kind === "bypass-option"),
      1,
    );
  });

  it("🔴 un fichier qui n'est pas un contrôleur ne compte pas", () => {
    // Le code qui PARLE d'une ouverture n'en est pas une. C'est ainsi que ce
    // contrôle s'est accusé lui-même au premier essai.
    poser(
      "src/doc.ts",
      `export const AIDE = "pose @BypassFirewall sur ta sonde de vivacité";`,
    );
    assert.lengthOf(controler().openings, 0);
  });

  it("🔴 une zone publique qui couvre TOUT est un manquement, elle", () => {
    poser(
      "nodefony.config.ts",
      `export default { areas: { tout: { pattern: "^/", security: false } } };`,
    );
    const r = controler();
    assert.lengthOf(r.findings, 1);
    assert.equal(r.findings[0]?.kind, "public-area-covers-all");
  });

  it("une zone publique BORNÉE reste un inventaire, pas un verdict", () => {
    poser(
      "nodefony.config.ts",
      `export default { areas: { web: { pattern: "^/public", security: false } } };`,
    );
    const r = controler();
    assert.lengthOf(r.findings, 0);
    assert.lengthOf(
      r.openings.filter((o) => o.kind === "public-area"),
      1,
    );
  });

  it("🔴 une entité écrite pour un AUTRE moteur est signalée, avec les deux noms", () => {
    poser(
      "nodefony/entity/Facture.ts",
      `import { pgTable, text } from "drizzle-orm/pg-core";
       export const facture = pgTable("facture", { id: text("id") });`,
    );
    const r = controler();
    assert.lengthOf(r.findings, 1);
    assert.equal(r.findings[0]?.kind, "entity-other-dialect");
    assert.include(r.findings[0]?.message ?? "", "postgres");
    assert.include(r.findings[0]?.message ?? "", "sqlite");
  });

  it("la MÊME entité sous son propre dialecte reste muette", () => {
    poser(
      "nodefony/entity/Facture.ts",
      `import { pgTable } from "drizzle-orm/pg-core";`,
    );
    const r = controler({ NF_DATABASE_URL: "postgres://app@base/app" });
    assert.lengthOf(r.findings, 0);
  });

  it("une entité MULTI-moteur ne lève rien — elle porte le bon aussi", () => {
    poser(
      "nodefony/entity/User.ts",
      `import { sqliteTable } from "drizzle-orm/sqlite-core";
       import { pgTable } from "drizzle-orm/pg-core";`,
    );
    assert.lengthOf(controler().findings, 0);
  });

  it("🔴 hors de `nodefony/entity`, un import des trois moteurs est LÉGITIME", () => {
    // L'adaptateur ORM lui-même importe les trois : l'accuser ferait crier le
    // contrôle sur le code dont c'est précisément le travail.
    poser(
      "src/orm/adapter.ts",
      `import { pgTable } from "drizzle-orm/pg-core";
       import { mysqlTable } from "drizzle-orm/mysql-core";`,
    );
    assert.lengthOf(controler().findings, 0);
  });

  it("une divergence DÉCLARÉE par le projet est tolérée, sans devenir invisible", () => {
    poser(
      "nodefony/entity/bench-pg.ts",
      `import { pgTable } from "drizzle-orm/pg-core";`,
    );
    const r = checkSurface({
      roots: [racine],
      cwd: racine,
      projectRoot: racine,
      env: {},
      dialectExceptions: ["entity/bench-pg.ts"],
    });
    assert.lengthOf(r.findings, 0);
    // Toujours COMPTÉE : une exception dispense du verdict, pas du relevé.
    assert.equal(r.entitiesScanned, 1);
  });

  it("🔴 l'exception mord AUSSI quand les chemins sont écrits à la Windows", () => {
    // Le cas qui a rendu la forge Windows rouge pendant que la même passe
    // était verte ailleurs. `path.relative` rend `nodefony\entity\x.ts` sous
    // Windows ; l'exception, elle, vient de la configuration du projet et
    // s'écrit en `/` — elle ne mordait donc jamais, et une divergence
    // pourtant DÉCLARÉE était accusée.
    //
    // La grammaire est INJECTÉE (`path.win32.sep`) : sans cela, ce cas ne
    // serait vérifiable que sous Windows, c'est-à-dire nulle part ici.
    assert.equal(
      toPortablePath("nodefony\\entity\\bench-pg.ts", path.win32.sep),
      "nodefony/entity/bench-pg.ts",
    );
    // Et l'inverse : une exception écrite avec la grammaire d'un poste
    // Windows doit mordre sur un dépôt POSIX.
    assert.equal(
      toPortablePath("entity\\bench-pg.ts", path.posix.sep),
      "entity/bench-pg.ts",
      "un `\\` résiduel doit tomber même quand ce n'est pas le séparateur du poste",
    );
    // Un chemin déjà portable ne bouge pas.
    assert.equal(toPortablePath("entity/bench-pg.ts"), "entity/bench-pg.ts");
  });

  it("les tests ne sont pas du code servi — ils ne comptent pas", () => {
    poser(
      "tests/fixtures/OpenController.ts",
      `@controller("/x") class X extends Controller { @BypassFirewall go() {} }`,
    );
    poser(
      "nodefony/controller/A.test.ts",
      `@controller("/y") class Y extends Controller { @BypassFirewall go() {} }`,
    );
    assert.lengthOf(controler().openings, 0);
  });
});

/**
 * 🔴 La CHAÎNE, pas la brique : d'où `collectDoctorReport` tire l'environnement.
 *
 * Les cas ci-dessus INJECTENT l'environnement — c'est par là que le défaut est
 * passé. Le produit, lui, ne lisait que `process.env`, quand le gabarit
 * PRESCRIT de poser `NF_DATABASE_URL` dans `.env.local`. Résultat : une
 * application Postgres voyait chacune de ses entités accusée, et sortait en
 * erreur. Ces cas passent donc par le vrai point d'entrée, avec des fichiers
 * sur disque et un `process.env` qui, lui, ne dit rien.
 */
describe("collectDoctorReport — le dialecte vient de l'app, pas du terminal", () => {
  /** Une application minimale : un manifeste, un paquet, une entité Postgres. */
  const appPostgres = (): void => {
    poser("package.json", '{"name":"app-pg","version":"1.0.0"}');
    poser("nodefony.config.ts", "export default {};");
    poser(
      "nodefony/entity/Facture.ts",
      `import { pgTable, text } from "drizzle-orm/pg-core";
       export const factures = pgTable("factures", { id: text("id") });`,
    );
  };

  it("⭐ `.env.local` pose le dialecte — aucune entité n'est accusée", async () => {
    appPostgres();
    poser(
      ".env.local",
      "NF_DATABASE_URL=postgres://app:x@localhost:5432/app\n",
    );
    const report = await collectDoctorReport(racine);
    assert.equal(report.surface.dialect, "postgres");
    assert.deepStrictEqual(
      report.surface.findings.filter((f) => f.kind === "entity-other-dialect"),
      [],
      "l'application déclare postgres : ses entités postgres sont à leur place",
    );
  });

  it("sans cette déclaration, la MÊME entité est bien relevée — la cascade a mordu", async () => {
    appPostgres();
    const report = await collectDoctorReport(racine);
    assert.equal(report.surface.dialect, "sqlite");
    assert.lengthOf(
      report.surface.findings.filter((f) => f.kind === "entity-other-dialect"),
      1,
    );
  });

  /**
   * 🔴 L'EXCEPTION aussi est une chaîne, et elle a cassé sans un mot.
   *
   * `checkSurface` reçoit `dialectExceptions` en argument, et un cas l'éprouve
   * — la BRIQUE. Mais entre le manifeste de l'application et cet argument il y
   * a `readExceptions`, et personne ne parcourait ce trajet. Le retrait de
   * l'alias `check` de la commande a renommé la clé lue en `nodefony.doctor` :
   * le produit et le manifeste du dépôt ont suivi, le gabarit posé par le banc
   * devkit non. Une exception écrite sous un nom que personne ne lit ne se
   * signale JAMAIS — elle laisse simplement le contrôle accuser, et la forge
   * est restée rouge sur les quatre plateformes.
   */
  it("⭐ la CHAÎNE : l'exception déclarée dans le manifeste fait taire le contrôle", async () => {
    appPostgres();
    poser(
      "package.json",
      JSON.stringify({
        name: "app-pg",
        version: "1.0.0",
        nodefony: { doctor: { entityDialect: ["entity/Facture.ts"] } },
      }),
    );
    const report = await collectDoctorReport(racine);
    assert.equal(report.surface.dialect, "sqlite");
    assert.deepStrictEqual(
      report.surface.findings.filter((f) => f.kind === "entity-other-dialect"),
      [],
      "le projet a DÉCLARÉ que cette divergence est voulue",
    );
  });

  it("…et sous un AUTRE nom de clé, l'exception ne vaut rien — c'est ce qui a mordu", async () => {
    appPostgres();
    poser(
      "package.json",
      JSON.stringify({
        name: "app-pg",
        version: "1.0.0",
        // L'ancien nom, celui que le banc posait encore.
        nodefony: { check: { entityDialect: ["entity/Facture.ts"] } },
      }),
    );
    const report = await collectDoctorReport(racine);
    assert.lengthOf(
      report.surface.findings.filter((f) => f.kind === "entity-other-dialect"),
      1,
      "une clé que `readExceptions` ne lit pas n'excuse rien, et ne le dit pas",
    );
  });

  it("`.env` committé compte aussi, et `.env.local` prime sur lui", async () => {
    appPostgres();
    poser(".env", "NF_DATABASE_URL=mysql://app@localhost:3306/app\n");
    let report = await collectDoctorReport(racine);
    assert.equal(report.surface.dialect, "mysql");
    poser(".env.local", "NF_DATABASE_URL=postgres://app@localhost:5432/app\n");
    report = await collectDoctorReport(racine);
    assert.equal(report.surface.dialect, "postgres", "`.env.local` prime");
  });
});

/**
 * 🔴 « Cette zone couvre-t-elle TOUT ? » — une question qui se CONSTATE.
 *
 * Elle se répondait sur une liste de quatre chaînes écrite à la main. Cette
 * liste disait le contraire du produit dans les deux sens : elle condamnait
 * `^/api`, qui ne couvre que `/api…`, et ignorait `^/.*`, `.*` et `^`, qui
 * ouvrent réellement toute l'application. Le motif est désormais compilé et
 * éprouvé comme le firewall le fait.
 */
describe("coversEverything — le motif est ÉPROUVÉ, pas reconnu", () => {
  it("les motifs qui laissent tout passer sont vus, liste ou pas", () => {
    for (const motif of ["^/", "/", "^", ".*", "^.*$", "^/.*", "^/.*$"]) {
      assert.isTrue(coversEverything(motif), `« ${motif} » couvre tout`);
    }
  });

  it("🔴 `^/api` ne couvre PAS tout — l'accuser était un verdict faux", () => {
    for (const motif of ["^/api", "^/api/", "^/admin", "^/nodefony"]) {
      assert.isFalse(coversEverything(motif), `« ${motif} » est borné`);
    }
  });

  it("un motif que le firewall refuserait n'est pas jugé ici", () => {
    assert.isFalse(coversEverything("^/(["));
  });

  it("⭐ la CHAÎNE : `^/.*` remonte jusqu'au manquement", () => {
    poser(
      "nodefony.config.ts",
      `export default { security: { areas: { tout: { pattern: "^/.*", security: false } } } };`,
    );
    const r = controler();
    assert.equal(r.findings[0]?.kind, "public-area-covers-all");
  });

  it("…et une zone bornée reste un simple INVENTAIRE", () => {
    poser(
      "nodefony.config.ts",
      `export default { security: { areas: { api: { pattern: "^/api", security: false } } } };`,
    );
    const r = controler();
    assert.lengthOf(
      r.findings,
      0,
      "une zone publique bornée n'est pas un verdict",
    );
    assert.equal(r.openings[0]?.kind, "public-area");
  });
});

describe("connectorDialect — la provenance nomme la variable RÉELLEMENT lue", () => {
  it("🔴 l'alias de plateforme ne s'annonce pas sous le nom préfixé", () => {
    const r = connectorDialect("export default {}", {
      DATABASE_URL: "mysql://app@base/app",
    });
    assert.equal(r.dialect, "mysql");
    assert.equal(
      r.from,
      "DATABASE_URL",
      "envoyer corriger `NF_DATABASE_URL`, absente du poste, ne mène nulle part",
    );
  });

  it("la forme préfixée garde la priorité, et le dit", () => {
    const r = connectorDialect("export default {}", {
      NF_DATABASE_URL: "postgres://app@base/app",
      DATABASE_URL: "mysql://app@base/app",
    });
    assert.equal(r.dialect, "postgres");
    assert.equal(r.from, "NF_DATABASE_URL");
  });
});
