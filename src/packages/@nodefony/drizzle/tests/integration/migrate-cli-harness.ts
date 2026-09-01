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

/**
 * Le binaire du framework, atteint par son CHEMIN — jamais par `npx`.
 *
 * 🔴 `npx nodefony` ne résout pas partout. Sur le runner d'intégration continue
 * il rend « sh: 1: nodefony: not found » et un code 127 : la commande ne
 * s'exécute pas du tout, la sortie est vide, et TOUTES les assertions du banc
 * tombent ensuite en cascade sur des causes qui n'ont rien à voir — « aucun
 * objet JSON dans la sortie », « la garde n'a pas mordu ». On accuse alors le
 * produit pour une commande qui n'a jamais démarré.
 *
 * Le défaut était invisible : ce step ne tournait pas, un step antérieur du même
 * job échouant avant lui.
 *
 * Invoquer le script par `process.execPath` supprime la résolution : c'est ce
 * que fait déjà le banc du code généré. C'est aussi ce qui tient sous Windows,
 * où le point d'entrée d'un paquet est un `.cmd` que Node refuse de lancer sans
 * shell.
 */
const BIN = path.join(ROOT, "src", "nodefony", "bin", "nodefony");

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
    const { stdout, stderr } = await run(process.execPath, [BIN, ...args], {
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
 * Tables créées par un ou plusieurs jeux de migrations.
 *
 * **Dérivée de la SOURCE, jamais écrite à la main** : une liste figée serait
 * juste le jour où on l'écrit, puis muette à la migration suivante — et le banc
 * laisserait derrière lui des tables qui fausseraient son voisin, sans que rien
 * ne le signale.
 *
 * 🔴 Elle prend PLUSIEURS dossiers parce qu'une table peut venir du paquet ou
 * de l'application : l'entité `User` a quitté les migrations du framework pour
 * rejoindre celles de l'application, et un décor qui n'aurait interrogé que le
 * paquet aurait cessé de la nettoyer — sans une ligne de moins dans le code, et
 * sans que rien ne le dise avant le cas suivant.
 *
 * @param dirs - dossiers de migrations à lire ; un dossier absent est ignoré.
 * @returns les noms de tables, sans doublon.
 */
export async function tablesDeMigrations(dirs: string[]): Promise<string[]> {
  const noms = new Set<string>();
  for (const dir of dirs) {
    let fichiers: string[];
    try {
      fichiers = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql"));
    } catch {
      // Ce jeu de migrations n'existe pas pour ce dialecte : il n'a rien créé.
      continue;
    }
    for (const fichier of fichiers) {
      const sql = await fs.readFile(path.join(dir, fichier), "utf8");
      for (const m of sql.matchAll(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?/gi,
      )) {
        noms.add(m[1] as string);
      }
    }
  }
  return [...noms];
}

/**
 * Tables créées par les migrations livrées par le PAQUET pour ce dialecte.
 *
 * @param dialect - dialecte dont on lit le jeu de migrations.
 * @returns les noms de tables, sans doublon.
 */
export async function tablesLivrees(dialect: SqlDialect): Promise<string[]> {
  return tablesDeMigrations([path.join(MIGRATIONS, dialect)]);
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
        // Les DEUX jeux : celui du paquet, et celui de l'application témoin —
        // dont l'entité `User`, qui n'appartient plus au framework.
        const tables = [
          ...(await tablesDeMigrations([
            path.join(MIGRATIONS, "mysql"),
            dossierMigrations("mysql"),
          ])),
          HISTORY_TABLE,
        ];
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
 * Les tables que la base porte VRAIMENT, au moment où on demande.
 *
 * Interrogé sur le CATALOGUE du serveur, jamais déduit de ce que le banc croit
 * avoir créé : c'est toute la différence entre constater un décor et le
 * supposer. Un `SELECT` par dialecte — les trois catalogues ne se lisent pas de
 * la même façon, et il n'existe pas de forme portable.
 *
 * @param base - la base du cas.
 * @param dialect - dialecte exercé.
 * @returns les noms de tables, triés ; une liste vide si la lecture échoue.
 */
export async function tablesEnBase(
  base: IBase,
  dialect: SqlDialect,
): Promise<string[]> {
  const requete =
    dialect === "sqlite"
      ? "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      : dialect === "postgres"
        ? "SELECT table_name AS name FROM information_schema.tables " +
          "WHERE table_schema = current_schema() ORDER BY 1"
        : "SELECT table_name AS name FROM information_schema.tables " +
          "WHERE table_schema = DATABASE() ORDER BY 1";
  try {
    const pilote = await openMigrationDriver(
      dialect === "sqlite"
        ? { dialect, filename: base.url.replace(/^sqlite:/, "") }
        : { dialect, url: base.url },
    );
    try {
      const lignes = await pilote.query<Record<string, unknown>>(requete);
      // MySQL rend « TABLE_NAME » sur certaines collations de catalogue : lire
      // la première valeur de la ligne évite de parier sur la casse d'une clé.
      return lignes
        .map((l) => String(Object.values(l)[0] ?? ""))
        .filter((n) => n.length > 0);
    } finally {
      await pilote.close();
    }
  } catch {
    // Un diagnostic ne doit JAMAIS masquer l'échec qu'il documente : s'il ne
    // peut pas lire, il le dit et se tait.
    return [];
  }
}

/**
 * Dossier où la commande écrit les migrations de l'APPLICATION, pour un dialecte.
 *
 * Composé ICI, une fois : les bancs le nettoient, le lisent et l'affichent, et
 * une seconde composition ailleurs se serait mise à désigner un autre dossier
 * le jour où la convention change. Assemblé par `path.join`, jamais écrit en
 * littéral — une assertion de chemin qui accepte « l'un ou l'autre séparateur »
 * ne prouve rien sous Windows.
 *
 * @param dialect - dialecte exercé.
 * @param racine - dossier de migrations de l'application ; par défaut celui du
 *   dépôt. Un banc qui écrit ses propres migrations passe ici un abri
 *   temporaire, pour ne jamais toucher aux migrations COMMITÉES du dépôt.
 * @returns le chemin absolu du dossier de sortie.
 */
export function dossierMigrations(
  dialect: SqlDialect,
  racine: string = path.join(ROOT, "migrations"),
): string {
  return path.join(racine, dialect);
}

/**
 * Ce que le dossier de sortie contient — fichiers écrits et journal.
 *
 * @param outDir - dossier des migrations du cas.
 * @returns une ligne par fichier, et les entrées du journal.
 */
export async function etatDuDossier(outDir: string): Promise<string> {
  let fichiers: string[];
  try {
    fichiers = (await fs.readdir(outDir)).sort();
  } catch {
    return "  (dossier de sortie absent)";
  }
  let journal = "  (pas de journal)";
  try {
    const brut = await fs.readFile(
      path.join(outDir, "meta", "_journal.json"),
      "utf8",
    );
    const doc = JSON.parse(brut) as { entries?: { tag?: string }[] };
    journal = `  journal : ${(doc.entries ?? [])
      .map((e) => e.tag ?? "?")
      .join(", ")}`;
  } catch {
    /* le journal manque ou n'est pas lisible : la ligne par défaut le dit */
  }
  return `  fichiers : ${fichiers.join(", ") || "(aucun)"}\n${journal}`;
}

/**
 * Déroule un cas sur une base vierge, et la libère quoi qu'il arrive.
 *
 * ## Pourquoi l'échec est enrichi ICI
 *
 * Un cas de ce banc tombe parfois sans se reproduire : mesuré, **six passes
 * consécutives vertes** après deux rouges la veille, à décor identique.
 * Re-tirer coûte cinq minutes et ne rend rien ; ce qui manque au rouge n'est pas
 * une répétition de plus, c'est l'ÉTAT dans lequel il est survenu — les tables
 * que la base portait, les migrations déjà écrites. Sans eux, il faut deviner si
 * c'est le produit ou le décor, et c'est exactement ce qui a fait passer deux
 * défauts réels pour du bruit pendant huit jours.
 *
 * L'enrichissement se fait au point UNIQUE par lequel tous les cas passent :
 * posé dans chaque assertion, il serait oublié à la première qu'on ajoute.
 *
 * @param cible - dialecte exercé.
 * @param corps - le cas, qui reçoit la base et l'environnement à passer au CLI.
 * @param racineMigrations - dossier de migrations d'application à imposer à la
 *   commande, s'il ne faut pas écrire dans celui du dépôt.
 */
export async function surBaseNeuve(
  cible: ICible,
  corps: (base: IBase, env: NodeJS.ProcessEnv) => Promise<void>,
  racineMigrations?: string,
): Promise<void> {
  const base = await cible.neuve();
  const env: NodeJS.ProcessEnv = {
    ...DECOR_MIGRATIONS,
    NF_DATABASE_URL: base.url,
  };
  if (racineMigrations !== undefined) {
    // Override générique de configuration (ADR-0006 D3) : `NF__<MODULE>__…`
    // est appliqué APRÈS le merge de l'application et AVANT la validation du
    // schéma. C'est le mécanisme du PRODUIT — le banc ne s'en invente pas un
    // second, qui divergerait de celui que les utilisateurs ont.
    env.NF__DRIZZLE__MIGRATIONS__DIR = racineMigrations;
  }
  try {
    await corps(base, env);
  } catch (cause) {
    const tables = await tablesEnBase(base, cible.dialect);
    const dossier = await etatDuDossier(
      dossierMigrations(cible.dialect, racineMigrations),
    );
    const etat =
      `\n\n── état AU MOMENT DE L'ÉCHEC (${cible.dialect}) ──\n` +
      `  tables en base : ${tables.join(", ") || "(aucune)"}\n` +
      `${dossier}`;
    if (cause instanceof Error) {
      cause.message += etat;
      throw cause;
    }
    throw new Error(`${String(cause)}${etat}`, { cause });
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
