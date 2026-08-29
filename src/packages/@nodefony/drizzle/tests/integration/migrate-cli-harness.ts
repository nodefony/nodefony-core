import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SqlDialect } from "../../nodefony/config/config";
import {
  HISTORY_TABLE,
  openMigrationDriver,
} from "../../nodefony/src/migrator/index";

const run = promisify(execFile);

/**
 * Décor partagé des bancs de commandes de migration, sur un BOOT RÉEL.
 *
 * ## Pourquoi ce fichier existe séparément des bancs
 *
 * Deux bancs exercent les mêmes commandes sous deux angles — les contrats de
 * sortie d'un côté, les réglages et leurs cas limites de l'autre. Recopier le
 * décor de l'un dans l'autre le ferait diverger : deux définitions de « base
 * vierge », deux façons de lancer la ligne de commande, et le jour où l'une est
 * corrigée l'autre continue de prouver l'ancien comportement. Le décor est donc
 * ici, et une seule fois.
 *
 * ## Ce que ce décor garantit
 *
 * - la ligne de commande est lancée comme un exploitant la lance, dans un
 *   PROCESSUS : c'est là, et nulle part ailleurs, que se perdent le code de
 *   sortie et la pureté du flux `--json` ;
 * - chaque cas part d'une base réellement VIERGE, et la libère quoi qu'il
 *   arrive ;
 * - chaque dialecte a sa propre façon d'être vierge, imposée par ce que le
 *   serveur permet — un schéma jetable en PostgreSQL, une suppression de tables
 *   en MySQL (l'utilisateur du décor n'a pas le droit de créer une base).
 *
 * 🔴 `assertDialecte` garde tous ces bancs : un décor mal posé fait retomber la
 * commande sur sqlite, et un cas « PostgreSQL » passerait sans avoir jamais
 * parlé à PostgreSQL.
 *
 * ⚠️ Exige un `npm run build` préalable : c'est le paquet BÂTI que le kernel
 * charge, pas les sources — mesurer les sources prouverait autre chose que ce
 * que l'utilisateur exécute.
 */
export const ACTIF = process.env.NF_RUN_CLI_BOOT === "1";

export const PG_URL = process.env.NF_PG_URL;
export const MYSQL_URL = process.env.NF_MYSQL_URL;

/** Racine du dépôt — il est lui-même une application Nodefony. */
export const ROOT = path.resolve(import.meta.dirname, "../../../../../..");

/** Dossier des migrations livrées par ce paquet. */
export const MIGRATIONS = path.resolve(import.meta.dirname, "../../migrations");

/**
 * Le décor dans lequel les migrations veulent dire quelque chose.
 *
 * Deux variables, et chacune répare une confusion découverte en exécutant :
 *
 * - **`NODE_ENV=production`** donne le mode `none` : le démarrage ne fabrique
 *   plus le schéma. En développement (`auto`), c'est lui qui crée les tables,
 *   et `migrate` refuse alors à juste titre sur une base pourtant créée à
 *   l'instant — le refus est exact, mais il n'apprend rien sur les migrations.
 *   C'est aussi ce qui garantit que le rattrapage additif ne vient PAS reposer
 *   la colonne que le cas « divergent » retire à la main.
 * - **`NF_STORE=memory`** empêche l'application de démarrage de lire la base.
 *   Sans elle, l'application meurt au démarrage sur `no such table: User`
 *   AVANT que la commande ne s'exécute : sur une base pas encore migrée, le
 *   code applicatif qui provisionne l'annuaire tape une table qui n'existe pas
 *   encore. C'est un vrai trou de la chaîne — un exemplaire devrait attendre
 *   sa migration, pas mourir en boucle —, mais il vit dans le gabarit
 *   d'application (ticket #101), pas dans les commandes éprouvées ici.
 */
export const DECOR_MIGRATIONS = {
  NODE_ENV: "production",
  NF_STORE: "memory",
} as const;

export interface IRun {
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
export async function cli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<IRun> {
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
export function parse(stdout: string): Record<string, unknown> {
  const brut = stdout.trim();
  // `npx` écrit ses propres avis quand il lance un binaire du projet ; ils
  // partent avant que le processus n'existe. On les retire par la GAUCHE, en
  // exigeant que tout ce qui suit la première accolade se parse d'un bloc.
  const debut = brut.indexOf("{");
  assert.notEqual(debut, -1, `aucun objet JSON dans la sortie :\n${brut}`);
  const objet = brut.slice(debut);
  return JSON.parse(objet) as Record<string, unknown>;
}

/**
 * Cite un identifiant SQL dans la grammaire du dialecte.
 *
 * @param dialect - dialecte cible.
 * @param nom - identifiant à citer.
 * @returns l'identifiant cité.
 */
export function citer(dialect: SqlDialect, nom: string): string {
  return dialect === "mysql" ? `\`${nom}\`` : `"${nom}"`;
}

/**
 * Tables créées par les migrations livrées pour ce dialecte.
 *
 * **Dérivée de la SOURCE, jamais écrite à la main** : une liste figée serait
 * juste le jour où on l'écrit, puis muette à la migration suivante — et le banc
 * laisserait derrière lui des tables qui fausseraient son voisin, sans que rien
 * ne le signale.
 *
 * @param dialect - dialecte dont on lit le jeu de migrations.
 * @returns les noms de tables, sans doublon.
 */
export async function tablesLivrees(dialect: SqlDialect): Promise<string[]> {
  const dir = path.join(MIGRATIONS, dialect);
  const fichiers = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql"));
  const noms = new Set<string>();
  for (const fichier of fichiers) {
    const sql = await fs.readFile(path.join(dir, fichier), "utf8");
    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?/gi,
    )) {
      noms.add(m[1] as string);
    }
  }
  return [...noms];
}

/** Une base vierge, prête à recevoir les migrations d'un cas. */
export interface IBase {
  /** URL à poser dans `NF_DATABASE_URL`. */
  url: string;
  /** Exécute du DDL d'administration SUR cette base (l'`ALTER` fait à la main). */
  sql(statements: string[]): Promise<void>;
  /** Rend la base à son état d'avant — appelé quoi qu'il arrive. */
  liberer(): Promise<void>;
}

/** Un dialecte à exercer, et la façon de lui fournir une base vierge. */
export interface ICible {
  dialect: SqlDialect;
  /**
   * Suffixe du `describe`.
   *
   * Parenthésé (`(postgres)`) parce que c'est la forme que le rapporteur de
   * gates du dépôt cherche pour prouver qu'un dialecte a bien été exercé.
   */
  label: string;
  actif: boolean;
  neuve(): Promise<IBase>;
}

/**
 * Ouvre un pilote d'administration sur une cible et y joue du DDL.
 *
 * @param cible - dialecte et coordonnées de connexion.
 * @param statements - DDL à exécuter dans l'ordre.
 */
export async function execSur(
  cible: { dialect: SqlDialect; url?: string; filename?: string },
  statements: string[],
): Promise<void> {
  const pilote = await openMigrationDriver(cible);
  try {
    for (const statement of statements) {
      await pilote.exec(statement);
    }
  } finally {
    await pilote.close();
  }
}

/**
 * URL PostgreSQL ancrée sur le schéma du banc.
 *
 * @param base - URL du serveur.
 * @param schema - schéma à poser en `search_path`.
 * @returns l'URL, `options` compris.
 */
export function urlSchema(base: string, schema: string): string {
  const url = new URL(base);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

/**
 * Les trois dialectes, chacun avec sa façon de rendre une base VIERGE.
 *
 * @param schemaPg - schéma PostgreSQL dédié à l'appelant. Jamais `public` : les
 *   autres suites y travaillent, et ce décor applique TOUT le jeu de migrations
 *   du framework — il écraserait leurs tables. Deux bancs qui partageraient le
 *   même schéma rendraient un verdict qui dépend de leur ordre d'exécution.
 * @returns les cibles, celles sans serveur déclaré étant marquées inactives.
 */
export function ciblesPour(schemaPg: string): ICible[] {
  return [
    {
      dialect: "sqlite",
      label: "(sqlite)",
      actif: true,
      neuve: async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-migrate-cli-"));
        const filename = path.join(dir, "banc.db");
        return {
          url: `sqlite:${filename}`,
          sql: (statements) =>
            execSur({ dialect: "sqlite", filename }, statements),
          liberer: () => fs.rm(dir, { recursive: true, force: true }),
        };
      },
    },
    {
      dialect: "postgres",
      label: "(postgres)",
      actif: Boolean(PG_URL),
      // Un schéma dédié, détruit et recréé : c'est une base parfaitement vierge
      // sans toucher à `public`, où travaillent les autres suites.
      neuve: async () => {
        const serveur = PG_URL as string;
        const recreer = [
          `DROP SCHEMA IF EXISTS ${schemaPg} CASCADE`,
          `CREATE SCHEMA ${schemaPg}`,
        ];
        await execSur({ dialect: "postgres", url: serveur }, recreer);
        const url = urlSchema(serveur, schemaPg);
        return {
          url,
          sql: (statements) =>
            execSur({ dialect: "postgres", url }, statements),
          liberer: () =>
            execSur({ dialect: "postgres", url: serveur }, [
              `DROP SCHEMA IF EXISTS ${schemaPg} CASCADE`,
            ]),
        };
      },
    },
    {
      dialect: "mysql",
      label: "(mysql)",
      actif: Boolean(MYSQL_URL),
      // 🔴 Pas de schéma dédié ici, et ce n'est PAS un choix : l'utilisateur
      // applicatif du décor n'a pas le droit de créer une base (`ERROR 1044`,
      // constaté). L'isolation se fait donc par SUPPRESSION des tables que les
      // migrations livrées créent — la même règle, une autre implémentation,
      // imposée par ce que le serveur permet.
      neuve: async () => {
        const url = MYSQL_URL as string;
        const tables = [...(await tablesLivrees("mysql")), HISTORY_TABLE];
        const vider = [
          "SET FOREIGN_KEY_CHECKS = 0",
          ...tables.map((t) => `DROP TABLE IF EXISTS \`${t}\``),
          "SET FOREIGN_KEY_CHECKS = 1",
        ];
        await execSur({ dialect: "mysql", url }, vider);
        return {
          url,
          sql: (statements) => execSur({ dialect: "mysql", url }, statements),
          liberer: () => execSur({ dialect: "mysql", url }, vider),
        };
      },
    },
  ];
}

/**
 * Déroule un cas sur une base vierge, et la libère quoi qu'il arrive.
 *
 * @param cible - dialecte exercé.
 * @param corps - le cas, qui reçoit la base et l'environnement à passer au CLI.
 */
export async function surBaseNeuve(
  cible: ICible,
  corps: (base: IBase, env: NodeJS.ProcessEnv) => Promise<void>,
): Promise<void> {
  const base = await cible.neuve();
  try {
    await corps(base, { ...DECOR_MIGRATIONS, NF_DATABASE_URL: base.url });
  } finally {
    await base.liberer();
  }
}

/**
 * Vérifie qu'une sortie décrit bien le dialecte que le cas croit exercer.
 *
 * 🔴 C'est la garde de tout ce banc : un décor mal posé fait retomber la
 * commande sur la base par défaut, et le cas « PostgreSQL » passerait sans avoir
 * jamais parlé à PostgreSQL.
 *
 * @param doc - charge utile `--json` d'une commande.
 * @param dialect - dialecte attendu.
 */
export function assertDialecte(
  doc: Record<string, unknown>,
  dialect: SqlDialect,
) {
  const driver = doc.driver as Record<string, unknown> | undefined;
  assert.equal(
    driver?.dialect,
    dialect,
    `la commande a servi « ${String(driver?.dialect)} » au lieu de « ${dialect} » — décor non appliqué`,
  );
}
