/**
 * `nodefony env` — la valeur effective que l'état du projet CONTREDIT.
 *
 * Une variable posée au bon endroit, avec la bonne provenance, peut rendre
 * l'application inexploitable : `NF_DATABASE_URL` sur un moteur que les
 * entités ne parlent pas est acceptée sans un mot, puis l'outil de migration
 * écarte les tables et la première requête répond 500. Le constat existait
 * dans le vérificateur ; ce qui manquait était de le servir là où l'on REGARDE
 * après avoir configuré.
 *
 * Le décor s'écrit sur disque parce que le contrôle lit des SOURCES et une
 * CASCADE `.env` : le simuler en mémoire éprouverait autre chose que ce que
 * l'utilisateur exécute.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import { assert } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  configInconsistencies,
  declaredDialectExceptions,
  wiringTargets,
} from "../kernel/checks/projectScope";
import { buildProjectEnvReport } from "../cli/env";

let racine = "";

/** Écrit un fichier, dossiers parents compris. */
const poser = (relatif: string, contenu: string): void => {
  const cible = path.join(racine, relatif);
  mkdirSync(path.dirname(cible), { recursive: true });
  writeFileSync(cible, contenu, "utf8");
};

/** Une entité Drizzle écrite pour le moteur donné. */
const entite = (dialecte: "sqlite" | "pg"): string =>
  `import { ${dialecte}Table, text } from "drizzle-orm/${
    dialecte === "pg" ? "pg-core" : "sqlite-core"
  }";\n` +
  `export const article = ${dialecte}Table("article", { id: text("id") });\n`;

beforeEach(() => {
  racine = mkdtempSync(path.join(tmpdir(), "nf-scope-"));
  poser("package.json", JSON.stringify({ name: "decor" }));
});

afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

describe("configInconsistencies — la base configurée et les entités", () => {
  it("signale une entité écrite pour un AUTRE moteur que le connecteur", () => {
    poser(".env", "NF_DATABASE_URL=postgres://app:pwd@db:5432/app\n");
    poser("nodefony/entity/Article.ts", entite("sqlite"));

    const constats = configInconsistencies({
      cwd: racine,
      projectRoot: racine,
    });

    assert.lengthOf(
      constats,
      1,
      "une entité sqlite face à un connecteur postgres",
    );
    assert.equal(constats[0]?.name, "NF_DATABASE_URL");
    assert.include(constats[0]?.message ?? "", "Article.ts");
    assert.include(constats[0]?.message ?? "", "postgres");
  });

  it("reste MUET quand le moteur et les entités concordent", () => {
    poser(".env", "NF_DATABASE_URL=postgres://app:pwd@db:5432/app\n");
    poser("nodefony/entity/Article.ts", entite("pg"));

    assert.isEmpty(
      configInconsistencies({ cwd: racine, projectRoot: racine }),
      "un état cohérent n'a rien à dire — une commande qui avertit à tort apprend à passer outre",
    );
  });

  it("respecte une divergence ASSUMÉE, déclarée dans le manifeste", () => {
    poser(
      "package.json",
      JSON.stringify({
        name: "decor",
        nodefony: { doctor: { entityDialect: ["nodefony/entity"] } },
      }),
    );
    poser(".env", "NF_DATABASE_URL=postgres://app:pwd@db:5432/app\n");
    poser("nodefony/entity/Article.ts", entite("sqlite"));

    assert.isEmpty(
      configInconsistencies({ cwd: racine, projectRoot: racine }),
      "avertir là où le vérificateur se tait donnerait deux verdicts contradictoires",
    );
  });

  it("lit la CASCADE, pas seulement l'environnement du terminal", () => {
    // `process.env` ne porte pas `NF_DATABASE_URL` ici : si le constat tombe,
    // c'est bien que le `.env` du projet a été lu. Sans cela, une application
    // Postgres verrait CHAQUE entité accusée du mauvais moteur.
    assert.isUndefined(
      process.env.NF_DATABASE_URL,
      "décor : la variable ne doit pas venir du terminal",
    );
    poser(".env", "NF_DATABASE_URL=postgres://app:pwd@db:5432/app\n");
    poser("nodefony/entity/Article.ts", entite("sqlite"));

    assert.lengthOf(
      configInconsistencies({ cwd: racine, projectRoot: racine }),
      1,
    );
  });

  it("sans URL, le dialecte ÉCRIT au manifeste fait foi — et le constat le nomme", () => {
    poser(
      "nodefony.config.ts",
      `export default { connectors: { main: { dialect: "postgres" } } };\n`,
    );
    poser("nodefony/entity/Article.ts", entite("sqlite"));

    const constats = configInconsistencies({
      cwd: racine,
      projectRoot: racine,
      env: {},
    });

    assert.lengthOf(constats, 1);
    assert.equal(constats[0]?.name, "nodefony.config.ts");
  });

  it("en direct : le dialecte se juge sur l'environnement DU SERVEUR, pas sur le disque", async () => {
    // Le disque dit Postgres ; le serveur a démarré sur SQLite. Juger sur le
    // disque accuserait une entité que le serveur sert très bien.
    poser(".env", "NF_DATABASE_URL=postgres://app:pwd@db:5432/app\n");
    poser("nodefony/entity/Article.ts", entite("sqlite"));
    const server = { NF_DATABASE_URL: "sqlite:./var/app.db" };

    assert.isEmpty(
      configInconsistencies({ cwd: racine, projectRoot: racine, env: server }),
    );
    const live = await buildProjectEnvReport(racine, racine, null, server);
    assert.isEmpty(live.inconsistencies);
    // Le témoin : la voie de la CLI, elle, lit le disque et accuse.
    const disk = await buildProjectEnvReport(racine, racine);
    assert.lengthOf(disk.inconsistencies, 1);
  });

  it("ne parcourt pas les sources à la recherche de routes : < 150 ms sur 1 500 fichiers", () => {
    // Opt-in (`NF_RUN_PERF=1`) : un seuil de temps ne se juge pas dans la suite.
    // Le décor grossit ce que l'ANCIEN calcul payait — le scan de sécurité
    // entier, commentaires retirés fichier par fichier — et que ce verdict
    // n'exige pas : il ne lit que le manifeste et `nodefony/entity/**`.
    const body =
      `// ${"commentaire ".repeat(400)}\nexport const x = 1;\n`.repeat(20);
    for (let i = 0; i < 1500; i++) poser(`src/lot${i % 30}/f${i}.ts`, body);
    poser(".env", "NF_DATABASE_URL=postgres://app:pwd@db:5432/app\n");
    poser("nodefony/entity/Article.ts", entite("sqlite"));
    const t0 = performance.now();
    const found = configInconsistencies({ cwd: racine, projectRoot: racine });
    const ms = performance.now() - t0;
    assert.lengthOf(found, 1);
    assert.isBelow(ms, 150, `${ms.toFixed(1)} ms`);
  });
});

describe("le périmètre d'un projet", () => {
  it("porte la racine ET chacun de ses modules", () => {
    mkdirSync(path.join(racine, "modules", "blog"), { recursive: true });
    mkdirSync(path.join(racine, "modules", "shop"), { recursive: true });

    const cibles = wiringTargets(racine).map((c) => path.relative(racine, c));

    assert.include(cibles, "");
    assert.include(cibles, path.join("modules", "blog"));
    assert.include(cibles, path.join("modules", "shop"));
  });

  it("rend une liste VIDE d'exceptions quand le manifeste n'en déclare pas", () => {
    assert.isEmpty(declaredDialectExceptions(racine));
  });
});
