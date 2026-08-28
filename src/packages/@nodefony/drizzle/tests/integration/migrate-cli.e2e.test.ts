import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Les commandes de migration, éprouvées sur un BOOT RÉEL.
 *
 * ## Pourquoi ce banc existe alors que tout est déjà testé unitairement
 *
 * Le corps d'un verbe ne casse jamais. Ce qui casse, c'est le MONTAGE : la
 * commande enregistrée ou non, la résolution du connecteur, la lecture de la
 * configuration, le code de sortie qui se perd entre le verbe et le processus,
 * le journal du démarrage qui se déverse dans un flux censé être pur. Rien de
 * tout cela n'est visible depuis un appel de fonction.
 *
 * Deux contrats partent chez l'utilisateur et ne se rattrapent pas :
 *
 * - **le code de sortie**, qui finit dans un `&&`, un travail de déploiement ou
 *   une passe d'intégration continue écrite par quelqu'un d'autre ;
 * - **la pureté du flux `--json`**, sans laquelle un `| jq` casse sur la
 *   première ligne de journal — et un agent conclut à une panne de la commande.
 *
 * ## Ce que ce banc coûte, et pourquoi il est fermé par défaut
 *
 * Chaque cas démarre un kernel complet (quelques secondes). Il est donc derrière
 * `NF_RUN_CLI_BOOT=1`, et le rapport de couverture du dépôt le NOMME quand il
 * n'a pas tourné — un saut silencieux ressemble trop à un succès.
 *
 * ```bash
 * NF_RUN_CLI_BOOT=1 npx vitest run tests/integration/migrate-cli.e2e.test.ts
 * ```
 *
 * ⚠️ Exige un `npm run build` préalable : c'est le paquet BÂTI que le kernel
 * charge, pas les sources — mesurer les sources ici prouverait autre chose que
 * ce que l'utilisateur exécute.
 */

const ACTIF = process.env.NF_RUN_CLI_BOOT === "1";
const suite = ACTIF ? describe : describe.skip;

/** Racine du dépôt — il est lui-même une application Nodefony. */
const ROOT = path.resolve(import.meta.dirname, "../../../../../..");

/**
 * Le décor dans lequel les migrations veulent dire quelque chose.
 *
 * Deux variables, et chacune répare une confusion découverte en exécutant :
 *
 * - **`NODE_ENV=production`** donne le mode `none` : le démarrage ne fabrique
 *   plus le schéma. En développement (`auto`), c'est lui qui crée les tables,
 *   et `migrate` refuse alors à juste titre sur une base pourtant créée à
 *   l'instant — le refus est exact, mais il n'apprend rien sur les migrations.
 * - **`NF_STORE=memory`** empêche l'application de démarrage de lire la base.
 *   Sans elle, l'application meurt au démarrage sur `no such table: User`
 *   AVANT que la commande ne s'exécute : sur une base pas encore migrée, le
 *   code applicatif qui provisionne l'annuaire tape une table qui n'existe pas
 *   encore. C'est un vrai trou de la chaîne — un exemplaire devrait attendre
 *   sa migration, pas mourir en boucle —, mais il vit dans le gabarit
 *   d'application (ticket #101), pas dans les commandes éprouvées ici.
 */
const DECOR_MIGRATIONS = {
  NODE_ENV: "production",
  NF_STORE: "memory",
} as const;

interface IRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Lance la ligne de commande et rend ce que le processus a VRAIMENT produit.
 *
 * Le code de sortie est lu sur le processus, jamais déduit d'une valeur de
 * retour : c'est précisément là que les codes se perdent.
 */
async function cli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<IRun> {
  try {
    const { stdout, stderr } = await run("npx", ["nodefony", ...args], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof err.code === "number" ? err.code : -1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

/**
 * Extrait l'objet JSON d'une sortie standard.
 *
 * ⚠️ On ne « cherche pas la ligne qui ressemble à du JSON » : ce serait
 * accepter la pollution qu'on prétend interdire. La sortie standard entière
 * doit se parser — c'est ça, un flux pur.
 */
function parse(stdout: string): Record<string, unknown> {
  const brut = stdout.trim();
  // `npx` écrit ses propres avis quand il lance un binaire du projet ; ils
  // partent avant que le processus n'existe. On les retire par la GAUCHE, en
  // exigeant que tout ce qui suit la première accolade se parse d'un bloc.
  const debut = brut.indexOf("{");
  assert.notEqual(debut, -1, `aucun objet JSON dans la sortie :\n${brut}`);
  const objet = brut.slice(debut);
  return JSON.parse(objet) as Record<string, unknown>;
}

suite("orm:migrate* — boot réel", () => {
  it("`orm:migrate:status --json` rend un flux parsable et un code de la grille", async () => {
    const r = await cli(["orm:migrate:status", "--json"]);
    const doc = parse(r.stdout);
    assert.equal(doc.formatVersion, 1);
    assert.equal(doc.connector, "default");
    assert.ok(
      [
        "up-to-date",
        "pending",
        "drift",
        "failed",
        "adopt",
        "divergent",
      ].includes(String(doc.verdict)),
      `verdict hors énumération gelée : ${String(doc.verdict)}`,
    );
    assert.ok([0, 1, 2].includes(r.code), `code hors grille : ${r.code}`);
    // Le code du processus est celui que la charge utile annonce : sans quoi
    // une passe d'intégration continue et un tableau de bord se contrediraient.
    assert.equal(
      r.code,
      doc.exitCode,
      "le processus ne rend pas son propre verdict",
    );
    // Le spécifique du pilote reste sous `driver`.
    assert.ok(!("dialect" in doc), "`dialect` a fui au premier niveau");
    const driver = doc.driver as Record<string, unknown>;
    assert.equal(driver.kind, "sql");
    assert.ok(typeof driver.dialect === "string");
  }, 120_000);

  it("un connecteur inconnu s'arrête sur 2, en nommant ceux qui existent", async () => {
    const r = await cli([
      "orm:migrate:status",
      "--connector",
      "nawak",
      "--json",
    ]);
    assert.equal(r.code, 2);
    const doc = parse(r.stdout);
    const error = doc.error as Record<string, unknown>;
    assert.equal(error.code, "NF_MIGRATE_UNKNOWN_CONNECTOR");
    assert.match(String(error.summary), /nawak/);
    // Le geste suivant est toujours donné, y compris sur un arrêt.
    const actions = error.nextActions as { command: string }[];
    assert.ok(
      actions.length > 0,
      "un arrêt sans geste laisse l'utilisateur seul",
    );
  }, 120_000);

  it("🔴 `orm:reset` refuse hors développement — liste BLANCHE, pas liste noire", async () => {
    // `staging` n'est pas `production` : une garde écrite « si production »
    // laisserait passer celui-ci, et c'est exactement là que l'accident arrive.
    for (const env of ["production", "staging"]) {
      const r = await cli(["orm:reset", "--yes", "--json"], { NODE_ENV: env });
      assert.equal(
        r.code,
        2,
        `environnement « ${env} » : la garde n'a pas mordu`,
      );
      const error = (parse(r.stdout).error ?? {}) as Record<string, unknown>;
      assert.equal(error.code, "NF_MIGRATE_NOT_DEVELOPMENT", env);
    }
  }, 180_000);

  it("`orm:migrate --dry-run` valide comme la vraie et n'écrit RIEN", async () => {
    // Une base neuve dans un dossier temporaire : rien à adopter, tout en
    // attente. C'est le seul état où l'essai va au bout.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-migrate-"));
    const base = path.join(dir, "essai.db");
    try {
      const r = await cli(["orm:migrate", "--dry-run", "--json"], {
        NF_DATABASE_URL: `sqlite:${base}`,
        ...DECOR_MIGRATIONS,
      });
      const doc = parse(r.stdout);
      assert.equal(doc.dryRun, true);
      const statements = doc.statements as { sql: string[] }[];
      assert.ok(statements.length > 0, "aucun SQL montré par l'essai");
      assert.ok(
        statements.some((s) => s.sql.some((q) => /CREATE TABLE/i.test(q))),
        "l'essai n'affiche pas le SQL qui serait exécuté",
      );
      // 🔴 LA garantie : après un essai, la base n'a rien reçu. Un fichier
      // SQLite peut exister (la connexion le crée) mais il doit être VIDE.
      const apres = await cli(["orm:migrate:status", "--json"], {
        NF_DATABASE_URL: `sqlite:${base}`,
        ...DECOR_MIGRATIONS,
      });
      const etat = parse(apres.stdout);
      assert.equal(
        etat.verdict,
        "pending",
        "l'essai a modifié la base — ce n'est plus un essai",
      );
      const sources = etat.sources as { applied: number }[];
      assert.ok(
        sources.every((s) => s.applied === 0),
        "des migrations ont été enregistrées par un essai",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it("sur une base NEUVE, migrate applique puis rend 0 et devient à jour", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-migrate-"));
    const base = path.join(dir, "neuve.db");
    const env = { NF_DATABASE_URL: `sqlite:${base}`, ...DECOR_MIGRATIONS };
    try {
      const avant = await cli(["orm:migrate:status", "--json"], env);
      assert.equal(parse(avant.stdout).verdict, "pending");
      assert.equal(avant.code, 1, "une base en retard doit rendre 1");

      const applique = await cli(["orm:migrate", "--json"], env);
      assert.equal(applique.code, 0, applique.stderr.slice(-800));
      assert.equal(parse(applique.stdout).verdict, "up-to-date");

      // Idempotence : rejouer ne change rien et reste à 0.
      const rejoue = await cli(["orm:migrate", "--json"], env);
      assert.equal(rejoue.code, 0);
      assert.equal(parse(rejoue.stdout).verdict, "up-to-date");

      const apres = await cli(["orm:migrate:status", "--json"], env);
      assert.equal(apres.code, 0, "une base à jour doit rendre 0");
      const doc = parse(apres.stdout);
      const sources = doc.sources as { name: string; applied: number }[];
      const framework = sources.find((s) => s.name === "framework");
      assert.ok(
        framework && framework.applied > 0,
        "aucune migration du framework enregistrée",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it("🔴 le journal du démarrage ne fuit JAMAIS dans le flux `--json`", async () => {
    // Le cas qui casse un `| jq` : une seule ligne de journal sur la sortie
    // standard suffit. Elle doit partir sur la sortie d'erreur, où elle reste
    // lisible sans polluer les données.
    const r = await cli(["orm:migrate:status", "--json"]);
    const lignes = r.stdout
      .split("\n")
      .filter((l) => l.trim().length > 0 && !l.startsWith("npm "));
    assert.equal(
      lignes.length,
      1,
      `la sortie standard porte ${lignes.length} lignes au lieu d'une :\n${r.stdout}`,
    );
    assert.doesNotThrow(() => JSON.parse(lignes[0] as string));
  }, 120_000);
});
