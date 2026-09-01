import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openMigrationDriver } from "../../nodefony/src/migrator/index";
import type { SqlDialect } from "../../nodefony/config/config";
import {
  ACTIF,
  ciblesPour,
  cli,
  citer,
  assertDialecte,
  parse,
  surBaseNeuve,
  ROOT,
  type IBase,
  type ICible,
} from "./migrate-cli-harness";
import { appendMigration } from "./migrator-fixtures";

/**
 * **Faire évoluer l'utilisateur**, sur les trois moteurs, base PEUPLÉE.
 *
 * ## Pourquoi ce banc existe
 *
 * Ajouter un champ à l'utilisateur, en retirer un, changer un type : c'est le
 * geste le plus courant d'une application vivante, et le seul qui s'exécute sur
 * des comptes RÉELS. Une table vide ne prouve rien — tous les cas intéressants
 * (le remplissage des lignes existantes, le refus sur des valeurs nulles, la
 * survie d'une donnée à un changement de type) n'existent que sur des lignes
 * déjà là. Le banc peuple donc systématiquement, dont **un compte venu d'un
 * fournisseur externe** : sans mot de passe local, et avec ses `socialProviders`
 * — la ligne qui casse quand on suppose que tout compte a un mot de passe.
 *
 * ## Ce que seuls TROIS moteurs révèlent
 *
 * Un banc sqlite prouve la règle, jamais le moteur. Mesuré ici, et c'est le
 * résultat le plus important de ce fichier : **ajouter une colonne obligatoire
 * sans valeur par défaut** est REFUSÉ par sqlite (« Cannot add a NOT NULL column
 * with default value NULL ») et par PostgreSQL (« contains null values »), mais
 * ACCEPTÉ par MySQL/MariaDB — qui remplit silencieusement les lignes existantes
 * de chaînes vides, en mode strict compris. La même migration ne fait donc pas
 * la même chose selon le serveur : là où deux moteurs protègent, le troisième
 * fabrique des données factices sans un mot. Un banc qui accepterait « l'un ou
 * l'autre » masquerait exactement ce qu'il faut voir ; chaque dialecte porte
 * donc son attente propre.
 *
 * ## Coût, et pourquoi il est fermé par défaut
 *
 * Chaque cas démarre des kernels complets sur une base neuve. Il est derrière
 * `NF_RUN_CLI_BOOT=1`, et le rapport de couverture du dépôt le NOMME quand il
 * n'a pas tourné.
 *
 * ```bash
 * NF_RUN_CLI_BOOT=1 \
 *   NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony \
 *   NF_MYSQL_URL=mysql://nodefony:nodefony-dev@127.0.0.1:3306/nodefony \
 *   npx vitest run tests/integration/user-migrations.e2e.test.ts
 * ```
 */

/**
 * Ce qui n'est PAS portable d'un moteur à l'autre, écrit une fois.
 *
 * Composer ces valeurs à la volée reviendrait à écrire trois fois la même
 * grammaire dans les cas, et à la faire diverger au premier ajout.
 */
const GRAMMAIRE: Record<
  SqlDialect,
  {
    /** Type d'une colonne texte ajoutée. */
    texte: string;
    vrai: string;
    faux: string;
    /** Un horodatage, dans la représentation que la table attend. */
    date: string;
    /** Un tableau JSON littéral. */
    json: (valeur: string) => string;
  }
> = {
  sqlite: {
    texte: "text",
    vrai: "1",
    faux: "0",
    // `createdAt`/`updatedAt` sont des `integer` (millisecondes) en sqlite.
    date: "1767225600000",
    json: (valeur) => `'${valeur}'`,
  },
  postgres: {
    texte: "text",
    vrai: "true",
    faux: "false",
    date: "'2026-01-01 00:00:00+00'",
    json: (valeur) => `'${valeur}'`,
  },
  mysql: {
    texte: "varchar(255)",
    vrai: "true",
    faux: "false",
    date: "'2026-01-01 00:00:00'",
    json: (valeur) => `'${valeur}'`,
  },
};

/** Les trois comptes du décor — le dernier vient d'un fournisseur externe. */
const COMPTES = [
  { id: "u-alice", identifier: "alice@exemple.test", externe: false },
  { id: "u-bob", identifier: "bob@exemple.test", externe: false },
  { id: "u-carol", identifier: "carol@exemple.test", externe: true },
] as const;

/**
 * Ouvre un pilote de lecture sur la base d'un cas.
 *
 * `IBase` sait exécuter du DDL mais pas RENDRE des lignes — et c'est justement
 * ce qu'il faut ici : la survie d'une donnée ne se déduit pas d'un code de
 * sortie, elle se relit.
 *
 * @param cible - dialecte exercé.
 * @param base - la base du cas.
 * @param sql - la requête à jouer.
 * @returns les lignes rendues.
 */
async function lire(
  cible: ICible,
  base: IBase,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const coords = base.url.startsWith("sqlite:")
    ? { dialect: cible.dialect, filename: base.url.slice("sqlite:".length) }
    : { dialect: cible.dialect, url: base.url };
  const pilote = await openMigrationDriver(coords);
  try {
    return await pilote.query(sql);
  } finally {
    await pilote.close();
  }
}

/**
 * Copie la chaîne de migrations du dépôt dans un dossier jetable.
 *
 * Le dépôt EST une application Nodefony : sa chaîne est donc la vraie — celle
 * du framework, puis la sienne, qui porte la table `User`. On la copie plutôt
 * que de la fabriquer, parce qu'une chaîne inventée ne prouverait que
 * l'applicateur ; et on copie plutôt que de l'utiliser en place, parce que les
 * cas y AJOUTENT des migrations d'évolution.
 *
 * @returns la racine de la copie (celle qui contient `<dialecte>/`).
 */
async function chaineJetable(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-user-migr-"));
  await fs.cp(path.join(ROOT, "migrations"), dir, { recursive: true });
  return dir;
}

/**
 * Pose trois comptes dans la table `User`.
 *
 * @param cible - dialecte exercé.
 * @param base - la base du cas, déjà migrée.
 */
async function peupler(cible: ICible, base: IBase): Promise<void> {
  const g = GRAMMAIRE[cible.dialect];
  const q = (nom: string): string => citer(cible.dialect, nom);
  const colonnes = [
    "id",
    "identifier",
    "password",
    "roles",
    "enabled",
    "locked",
    "socialProviders",
    "metadata",
    "createdAt",
    "updatedAt",
  ]
    .map(q)
    .join(", ");
  const lignes = COMPTES.map((compte) => {
    // Le compte externe n'a PAS de mot de passe local, et porte son fournisseur.
    const password = compte.externe ? "NULL" : `'empreinte-${compte.id}'`;
    const providers = compte.externe
      ? g.json('[{"provider":"github","subject":"42"}]')
      : g.json("[]");
    return (
      `('${compte.id}', '${compte.identifier}', ${password}, ` +
      `${g.json('["ROLE_USER"]')}, ${g.vrai}, ${g.faux}, ` +
      `${providers}, ${g.json("{}")}, ${g.date}, ${g.date})`
    );
  }).join(", ");
  await base.sql([`INSERT INTO ${q("User")} (${colonnes}) VALUES ${lignes}`]);
}

/** Nombre de comptes en base — la preuve qu'aucune donnée n'a disparu. */
async function combienDeComptes(cible: ICible, base: IBase): Promise<number> {
  const q = citer(cible.dialect, "User");
  const rows = await lire(cible, base, `SELECT COUNT(*) AS n FROM ${q}`);
  return Number(rows[0]?.n ?? -1);
}

const CIBLES = ciblesPour("nf_user_migrations");

for (const cible of CIBLES) {
  const cas = ACTIF && cible.actif ? describe : describe.skip;
  const g = GRAMMAIRE[cible.dialect];
  const q = (nom: string): string => citer(cible.dialect, nom);

  cas(`migrations de l'utilisateur — base peuplée ${cible.label}`, () => {
    it("rejeu depuis ZÉRO : la chaîne du framework, puis celle de l'application", async () => {
      const chaine = await chaineJetable();
      try {
        await surBaseNeuve(
          cible,
          async (base, env) => {
            const applique = await cli(["orm:migrate", "--json"], env);
            assert.equal(applique.code, 0, applique.stderr.slice(-800));
            const doc = parse(applique.stdout);
            assertDialecte(doc, cible.dialect);
            assert.equal(doc.verdict, "up-to-date");

            // Les DEUX chaînes ont tourné : celle du framework, et celle de
            // l'application — c'est cette dernière qui porte `User` depuis que
            // l'entité appartient à l'app.
            const sources = doc.sources as { name: string; applied: number }[];
            for (const nom of ["framework", "app"]) {
              const source = sources.find((s) => s.name === nom);
              assert.ok(source, `source « ${nom} » absente du rapport`);
              assert.ok(
                source.applied > 0,
                `la chaîne « ${nom} » n'a appliqué aucune migration`,
              );
            }

            // La table de l'utilisateur existe VRAIMENT — un verdict ne le dit pas.
            await peupler(cible, base);
            assert.equal(await combienDeComptes(cible, base), COMPTES.length);
          },
          chaine,
        );
      } finally {
        await fs.rm(chaine, { recursive: true, force: true });
      }
    }, 300_000);

    it("ajout d'un champ FACULTATIF, puis d'un champ à VALEUR PAR DÉFAUT", async () => {
      const chaine = await chaineJetable();
      try {
        await surBaseNeuve(
          cible,
          async (base, env) => {
            assert.equal((await cli(["orm:migrate", "--json"], env)).code, 0);
            await peupler(cible, base);

            await appendMigration(chaine, cible.dialect, {
              tag: "9001_champ_facultatif",
              statements: [
                `ALTER TABLE ${q("User")} ADD COLUMN ${q("surnom")} ${g.texte}`,
              ],
            });
            await appendMigration(chaine, cible.dialect, {
              tag: "9002_champ_avec_defaut",
              statements: [
                `ALTER TABLE ${q("User")} ADD COLUMN ${q("langue")} ${g.texte} NOT NULL DEFAULT 'fr'`,
              ],
            });

            const r = await cli(["orm:migrate", "--json"], env);
            assert.equal(r.code, 0, r.stderr.slice(-800));
            assert.equal(parse(r.stdout).verdict, "up-to-date");

            // Le champ facultatif laisse les lignes existantes VIDES ; celui à
            // valeur par défaut les REMPLIT. C'est toute la différence entre les
            // deux gestes, et elle ne se voit qu'en relisant les comptes.
            const rows = await lire(
              cible,
              base,
              `SELECT ${q("id")}, ${q("surnom")}, ${q("langue")} FROM ${q("User")} ORDER BY ${q("id")}`,
            );
            assert.equal(rows.length, COMPTES.length);
            for (const row of rows) {
              assert.equal(row.surnom ?? null, null);
              assert.equal(row.langue, "fr");
            }
          },
          chaine,
        );
      } finally {
        await fs.rm(chaine, { recursive: true, force: true });
      }
    }, 300_000);

    it("ajout d'un champ OBLIGATOIRE sans défaut : le moteur décide, et ils ne disent pas la même chose", async () => {
      const chaine = await chaineJetable();
      try {
        await surBaseNeuve(
          cible,
          async (base, env) => {
            assert.equal((await cli(["orm:migrate", "--json"], env)).code, 0);
            await peupler(cible, base);

            await appendMigration(chaine, cible.dialect, {
              tag: "9003_champ_obligatoire",
              statements: [
                `ALTER TABLE ${q("User")} ADD COLUMN ${q("service")} ${g.texte} NOT NULL`,
              ],
            });
            const r = await cli(["orm:migrate", "--json"], env);

            if (cible.dialect === "mysql") {
              // 🔴 MySQL/MariaDB ACCEPTE, et remplit les lignes existantes de
              // chaînes vides — en mode strict compris. Le champ est déclaré
              // obligatoire et il ne porte que du vide : aucune erreur, aucune
              // alerte, des données factices. C'est le contraire d'un détail,
              // et c'est pour cela que ce banc tourne sur trois moteurs.
              assert.equal(r.code, 0, r.stderr.slice(-800));
              const rows = await lire(
                cible,
                base,
                `SELECT ${q("service")} FROM ${q("User")}`,
              );
              assert.equal(rows.length, COMPTES.length);
              for (const row of rows) {
                assert.equal(
                  row.service,
                  "",
                  "MySQL est censé remplir de vide — s'il refuse désormais, c'est ce banc qu'il faut recaler",
                );
              }
            } else {
              // sqlite et PostgreSQL REFUSENT : il y a des lignes, elles n'ont
              // pas de valeur pour cette colonne, et rien ne permet d'en inventer.
              assert.notEqual(
                r.code,
                0,
                "un champ obligatoire sans défaut doit être refusé sur une table peuplée",
              );
              const dit = `${r.stdout}${r.stderr}`;
              assert.match(
                dit,
                /contains null values|NOT NULL column with default value NULL/u,
                `le refus ne dit pas ce qui cloche :\n${dit.slice(-800)}`,
              );
              // Les comptes sont intacts : un refus ne coûte pas de données.
              assert.equal(await combienDeComptes(cible, base), COMPTES.length);
            }
          },
          chaine,
        );
      } finally {
        await fs.rm(chaine, { recursive: true, force: true });
      }
    }, 300_000);

    it("RETRAIT d'un champ : la garde mord, puis `--allow-destructive` applique — comptes intacts", async () => {
      const chaine = await chaineJetable();
      try {
        await surBaseNeuve(
          cible,
          async (base, env) => {
            assert.equal((await cli(["orm:migrate", "--json"], env)).code, 0);
            await peupler(cible, base);
            await base.sql([
              `ALTER TABLE ${q("User")} ADD COLUMN ${q("service")} ${g.texte}`,
            ]);

            await appendMigration(chaine, cible.dialect, {
              tag: "9004_retrait_champ",
              statements: [
                `ALTER TABLE ${q("User")} DROP COLUMN ${q("service")}`,
              ],
            });

            // 1. Sans le drapeau : REFUS. C'est la garde vue mordre.
            const refuse = await cli(["orm:migrate", "--json"], env);
            assert.notEqual(
              refuse.code,
              0,
              "une suppression de colonne doit être refusée sans `--allow-destructive`",
            );
            assert.match(
              `${refuse.stdout}${refuse.stderr}`,
              /destruct/iu,
              "le refus doit nommer ce qu'il protège",
            );
            // Rien n'a été appliqué : la colonne est encore là.
            await lire(cible, base, `SELECT ${q("service")} FROM ${q("User")}`);

            // 2. Avec le drapeau : l'exploitant ASSUME, la migration passe.
            const assume = await cli(
              ["orm:migrate", "--allow-destructive", "--json"],
              env,
            );
            assert.equal(assume.code, 0, assume.stderr.slice(-800));
            assert.equal(parse(assume.stdout).verdict, "up-to-date");

            // La colonne a disparu, les COMPTES non.
            await assert.rejects(
              () =>
                lire(cible, base, `SELECT ${q("service")} FROM ${q("User")}`),
              "la colonne devait être supprimée",
            );
            assert.equal(await combienDeComptes(cible, base), COMPTES.length);
          },
          chaine,
        );
      } finally {
        await fs.rm(chaine, { recursive: true, force: true });
      }
    }, 300_000);
  });
}
