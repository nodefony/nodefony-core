import fs from "node:fs";
import path from "node:path";
import type { Kernel } from "nodefony";
import { ormRegistry } from "@nodefony/orm-core";
import { parseDatabaseUrl, sqliteFilenameFromUrl } from "nodefony";
import type {
  DdlMode,
  DivergenceMode,
  MigrationCheckMode,
  SqlDialect,
} from "../../config/config";
import type { IDrizzleConfig } from "../../interfaces/IDrizzleConfig";
import { resolveConnectorTarget } from "../connectorTarget";
import { DrizzleMigrator } from "./DrizzleMigrator";
import { defaultMigrationSources } from "./paths";
import type { IMigrationTarget } from "./drivers/index";

/**
 * Résolution du décor d'une commande de migration : QUI possède le connecteur,
 * OÙ se trouve sa base, QUEL mode de schéma s'applique.
 *
 * **Pourquoi un fichier à part, et pourquoi il ne fait aucune entrée-sortie** :
 * ces règles sont lues par cinq commandes, par le démarrage du module et par la
 * sonde de disponibilité. Une seule d'entre elles recopiée ailleurs
 * divergerait — et une divergence de mode `ddl` entre le démarrage et la ligne
 * de commande, c'est une base que l'un croit à jour et que l'autre migre.
 *
 * Les fonctions de décision sont **pures** : on leur INJECTE l'environnement
 * constaté au lieu de le lire ici. C'est ce qui les rend éprouvables sans
 * kernel, sans base et sans variable d'environnement à poser.
 */

// 🔴 Définie dans `types.ts`, un module FEUILLE, et seulement ré-exportée ici.
// `DrizzleMigrator` la lit au TOP-LEVEL (une phrase de refus la cite) et ce
// fichier importe `DrizzleMigrator` : la définir ici formait un cycle dont
// l'ordre d'évaluation décidait du sort — `ReferenceError: Cannot access
// 'MIGRATE_URL_ENV' before initialization` dès que `resolve` était chargé en
// premier, ce que fait `check:migrations`. Un cycle ne casse que sous un
// ordre, donc il passe les tests qui entrent par l'autre bout.
import { MIGRATE_URL_ENV } from "./types";
export { MIGRATE_URL_ENV };

/** L'environnement tel qu'on le CONSTATE — jamais déduit à l'intérieur. */
export interface IMigrationEnv {
  /** Mode moteur normalisé du kernel : `development` ou `production`. */
  runtime: "development" | "production";
  /** `NODE_ENV` brut — seul porteur de la valeur `test`. */
  nodeEnv?: string | undefined;
}

/**
 * Constate l'environnement depuis le kernel et le processus.
 *
 * @param kernel - kernel courant, ou `null` hors application.
 * @returns l'environnement constaté, prêt à être injecté aux règles pures.
 */
export function readMigrationEnv(kernel: Kernel | null): IMigrationEnv {
  return {
    runtime: kernel?.resolveRuntimeEnv() ?? "production",
    nodeEnv: process.env.NODE_ENV,
  };
}

/**
 * L'effacement d'une base est-il ACCEPTÉ dans cet environnement ?
 *
 * **Liste blanche, jamais liste noire** : seul `development` passe. Un
 * `staging`, un `test`, un environnement que personne n'a pensé à nommer sont
 * refusés — c'est exactement ce qu'une garde écrite « si production » laisserait
 * passer, et c'est là que l'accident se produit.
 *
 * Écrite ici parce qu'elle a DEUX lecteurs qui doivent dire la même chose :
 * `orm:reset`, qui refuse ; et le rendu des migrations, qui ne doit pas proposer
 * un geste que l'autre va rejeter. Deux copies de cette règle divergeraient, et
 * la sortie promettrait alors une commande impossible.
 *
 * @param env - environnement constaté.
 * @returns `true` si `orm:reset` est recevable.
 */
export function resetAllowed(env: IMigrationEnv): boolean {
  return env.runtime === "development" && env.nodeEnv !== "test";
}

/**
 * `orm:generate --apply` est-il recevable dans cet environnement ?
 *
 * Écrire une migration et l'appliquer dans le même souffle suppose qu'on relit
 * le SQL produit entre les deux — ce que personne ne fait sur un serveur.
 * Ailleurs qu'en développement, la migration a été écrite, relue et versionnée
 * en amont : `orm:migrate` l'applique, et lui seul. Aucun drapeau ne lève ce
 * refus, pour la même raison que {@link resetAllowed} n'en a pas.
 *
 * Même forme que `resetAllowed`, et c'est voulu : les deux disent « geste de
 * développement », et deux rédactions de la même condition finiraient par
 * diverger sans que rien ne le signale.
 *
 * @param env - environnement constaté.
 * @returns `true` si l'enchaînement est recevable.
 */
export function generateApplyAllowed(env: IMigrationEnv): boolean {
  return env.runtime === "development" && env.nodeEnv !== "test";
}

/**
 * Le mode de schéma qui s'applique à un connecteur.
 *
 * Règle des défauts, et son pourquoi : **appliquer des migrations au démarrage
 * n'est jamais un défaut**. C'est la norme unanime des outils de migration, et
 * elle tient à un fait simple — au démarrage, plusieurs exemplaires partent en
 * même temps. `migrate` est donc toujours un choix écrit, jamais une déduction.
 *
 * - développement et test → `auto` : le schéma suit le code, sans rien taper ;
 * - tout le reste → `none` : personne ne touche au schéma au démarrage, un
 *   travail externe applique les migrations avant que le trafic n'arrive.
 *
 * 🔴 **Une application qui VERSIONNE des migrations bascule en `migrate`, même
 * en développement.** Deux fabricants du même schéma ne s'accordent pas, et
 * rien ne le signale tant qu'on ne les fait pas se rencontrer : le DDL dérivé
 * pose une contrainte d'unicité INLINE et anonyme (`content text NOT NULL
 * UNIQUE`), là où le générateur de migrations raisonne sur un index NOMMÉ
 * (`messages_content_unique`). La migration suivante émet alors un
 * `DROP INDEX` d'un index qui n'a jamais existé, échoue sur `no such index`,
 * inscrit son marqueur — et la réparation ne peut rien y faire, puisque le
 * fichier est inapplicable. Vécu sur un agent tiers : trente-cinq minutes de
 * `repair`/`baseline`/`reset`, deux bases détruites, la boucle brisée à la main.
 * La condition est délibérément « l'application EN A », pas « elle en a en
 * attente » : dès la première migration écrite, le schéma leur appartient.
 * Elle est bornée au développement RÉEL, jamais à `NODE_ENV=test` : une suite
 * lance un exemplaire par worker, et appliquer des migrations depuis plusieurs
 * processus au démarrage est précisément ce que la règle ci-dessus refuse.
 * Un `ddl` écrit dans la configuration gagne toujours — c'est un choix, pas une
 * déduction.
 *
 * @param explicit - valeur écrite dans la configuration du connecteur, si elle l'est.
 * @param env - environnement constaté.
 * @param appHasMigrations - l'application versionne au moins une migration.
 * @returns le mode effectif.
 */
export function resolveDdlMode(
  explicit: DdlMode | undefined,
  env: IMigrationEnv,
  appHasMigrations = false,
): DdlMode {
  if (explicit) {
    return explicit;
  }
  if (env.runtime === "development" || env.nodeEnv === "test") {
    // La bascule ne vaut PAS sous `NODE_ENV=test` : une suite lance N
    // exemplaires en parallèle (un par worker), et c'est très exactement le
    // cas que la doctrine ci-dessus interdit. Les bases de test sont d'ailleurs
    // éphémères — elles partent vides, donc les deux fabricants ne s'y
    // rencontrent jamais.
    return appHasMigrations && env.nodeEnv !== "test" ? "migrate" : "auto";
  }
  return "none";
}

/**
 * L'application versionne-t-elle au moins une migration ?
 *
 * Lecture SYNCHRONE et bornée à un `readdirSync` par connecteur au démarrage —
 * hors de tout chemin de requête. Elle doit l'être : le mode de schéma se
 * décide avant la connexion, et le rendre asynchrone propagerait un `await`
 * dans toute la chaîne de résolution pour une réponse qui ne change jamais
 * pendant la vie du processus.
 *
 * Un dossier absent, illisible ou vide répond `false` — l'application n'a alors
 * rien à appliquer, et `auto` reste le bon défaut de démarrage rapide.
 *
 * @param dir - dossier de migrations de l'application ({@link appMigrationsDir}).
 * @returns `true` si au moins un fichier `.sql` y est versionné, à un niveau
 *   ou sous un sous-dossier de dialecte (`migrations/postgres/0001_x.sql`).
 */
export function appVersionsMigrations(dir: string | undefined): boolean {
  if (!dir) {
    return false;
  }
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".sql")) {
        return true;
      }
      if (entry.isDirectory() && entry.name !== "meta") {
        const nested = fs.readdirSync(path.join(dir, entry.name));
        if (nested.some((name) => name.endsWith(".sql"))) {
          return true;
        }
      }
    }
  } catch {
    // Dossier absent ou illisible : l'application ne versionne rien.
    return false;
  }
  return false;
}

/**
 * La conduite de la sonde de disponibilité face à un schéma en retard.
 *
 * En production, un exemplaire dont le schéma est en retard ne doit pas
 * recevoir de trafic : il répondrait des erreurs de colonne inconnue à des
 * utilisateurs réels. Ailleurs, le retenir gênerait plus qu'il n'aiderait — un
 * avertissement suffit.
 *
 * @param explicit - valeur écrite dans `migrations.check`, si elle l'est.
 * @param env - environnement constaté.
 * @returns la conduite effective.
 */
export function resolveCheckMode(
  explicit: MigrationCheckMode | undefined,
  env: IMigrationEnv,
): MigrationCheckMode {
  if (explicit) {
    return explicit;
  }
  return env.runtime === "production" ? "fail" : "warn";
}

/**
 * En schéma `auto`, faut-il ÉNONCER au démarrage les migrations enregistrées
 * que personne n'a appliquées ?
 *
 * Oui en développement, sauf conduite `off` — c'est ce conseil qui évite de
 * conclure à une base incohérente devant une colonne inconnue. Jamais sur une
 * base `:memory:` : elle repart VIDE à chaque démarrage, son historique aussi,
 * si bien que tout y paraît « à appliquer » à chaque fois — un avertissement
 * permanent qui n'apprend rien (vécu : le connecteur de banc `mediasoup`,
 * une fois déclaré, réclamait à chaque démarrage les migrations du framework
 * et de l'application, qui ne le concernent pas).
 *
 * @param check - conduite résolue ({@link resolveCheckMode}).
 * @param env - environnement constaté.
 * @param filename - fichier sqlite du connecteur, s'il en a un.
 * @returns `true` si le conseil doit être rendu.
 */
export function adviseMigrations(
  check: MigrationCheckMode,
  env: IMigrationEnv,
  filename: string | undefined,
): boolean {
  return (
    check !== "off" && env.runtime === "development" && filename !== ":memory:"
  );
}

/** Ce qu'un connecteur est, du point de vue des migrations. */
export type IConnectorResolution =
  | {
      /** Le connecteur existe et son propriétaire sait migrer. */
      kind: "ready";
      connector: string;
      dialect: SqlDialect;
      target: IMigrationTarget;
      /** `true` quand la cible vient de {@link MIGRATE_URL_ENV}. */
      fromMigrateUrl: boolean;
      ddl: DdlMode;
    }
  | {
      /**
       * Le connecteur est enregistré, mais la commande ne peut pas travailler
       * dessus. Deux causes bien distinctes, et il ne faut JAMAIS les
       * confondre — `sqlLike` les sépare.
       */
      kind: "unsupported";
      connector: string;
      /** Ce qui porte ce connecteur, tel que l'ORM se décrit lui-même. */
      owner: string;
      /**
       * Sa base est-elle une base SQL ?
       *
       * `true` — c'est un connecteur SQL qui n'est simplement pas déclaré dans
       * la configuration du module : la commande n'a pas ses coordonnées de
       * connexion. Lui répondre « ne porte pas de migrations » serait FAUX, et
       * un message faux publié est appris par les scripts qui le lisent.
       *
       * `false` — sa base résorbe l'écart entre le code et le schéma autrement
       * (index synchronisés plutôt que fichiers versionnés) : il n'y a rien à
       * migrer ici, aujourd'hui.
       */
      sqlLike: boolean;
      /** Base sous-jacente telle que l'ORM la nomme (`mongodb`, `sqlite`…). */
      driver: string;
    }
  | {
      /**
       * La variable de migration désigne une AUTRE base que le connecteur.
       *
       * Refuser est le seul comportement sûr : on ne peut ni appliquer du SQL
       * d'un dialecte avec le pilote d'un autre, ni deviner laquelle des deux
       * bases l'exploitant visait. L'ignorer produisait un faux succès de
       * déploiement — la pire sortie possible d'une commande de migration.
       */
      kind: "url-mismatch";
      connector: string;
      /** Dialecte du connecteur déclaré. */
      dialect: SqlDialect;
      /** Dialecte que désigne la variable, ou `null` si elle est illisible. */
      urlDialect: SqlDialect | null;
    }
  | {
      /** Aucun connecteur de ce nom, nulle part. */
      kind: "unknown";
      connector: string;
      /** Tous les noms qui existent, tous ORM confondus, triés. */
      known: string[];
    };

/**
 * Décrit ce qui porte un connecteur, pour le nommer dans un refus.
 *
 * Un message qui dit seulement « ce connecteur ne porte pas de migrations »
 * laisse l'utilisateur sans recours : il ne sait ni ce que c'est, ni où
 * regarder. On nomme donc la classe qui le sert et la base qu'elle adresse.
 *
 * @param name - nom du connecteur dans le registre.
 * @returns une description courte (`mongoose (mongodb)`), ou le nom de classe seul.
 */
function describeOwner(name: string): { label: string; driver: string } {
  let orm: { describeConnection?: () => { driver?: string } } | undefined;
  try {
    orm = ormRegistry.get(name) as unknown as {
      describeConnection?: () => { driver?: string };
    };
  } catch {
    return { label: "un ORM inconnu", driver: "" };
  }
  const klass = (orm as { constructor?: { name?: string } })?.constructor?.name;
  let driver = "";
  try {
    driver = orm?.describeConnection?.().driver ?? "";
  } catch {
    driver = "";
  }
  const label =
    klass && driver
      ? `${klass} (${driver})`
      : klass || driver || "un ORM inconnu";
  return { label, driver };
}

/**
 * Bases SQL connues — celles dont le schéma se fait par migrations versionnées.
 *
 * La liste est CONSTATÉE sur ce que l'ORM dit de lui-même (`describeConnection`),
 * jamais déduite d'un test d'instance : à la frontière npm, deux copies du même
 * paquet font échouer `instanceof` sans un mot, et le repli serait ici un
 * message FAUX. Un nom absent de cette liste ne provoque aucune casse : il fait
 * seulement dire « pas de migrations pour cette base », ce qui reste vrai tant
 * qu'aucun applicateur ne la sert.
 */
const SQL_DRIVERS = new Set([
  "sqlite",
  "sqlite3",
  "postgres",
  "postgresql",
  "mysql",
  "mariadb",
]);

/**
 * Tous les noms de connecteurs qui existent, tous ORM confondus.
 *
 * L'union du registre et de la configuration : le registre porte ce qui est
 * connecté, la configuration ce qui est déclaré. Un connecteur déclaré mais non
 * connecté doit apparaître dans la liste — sinon un utilisateur qui a fait une
 * faute de frappe se voit répondre que son connecteur n'existe pas ET ne le
 * voit pas dans la liste, alors qu'il est bien écrit dans son fichier.
 *
 * @param config - configuration validée du module drizzle.
 * @returns les noms, triés, sans doublon.
 */
export function knownConnectors(config: IDrizzleConfig): string[] {
  const names = new Set<string>(ormRegistry.list());
  for (const name of Object.keys(config.connectors ?? {})) {
    names.add(name);
  }
  return [...names].sort();
}

/**
 * Résout un nom de connecteur en l'une des **trois** réponses possibles.
 *
 * Ces trois réponses sont un contrat, pas un détail d'implémentation : le jour
 * où un second ORM apporte ses propres migrations, c'est `unsupported` qui doit
 * cesser de sortir pour ses connecteurs — et rien d'autre ne bouge. Répondre
 * « ne porte pas de migrations » à un connecteur qui en porterait serait un
 * message FAUX, appris par les scripts qui le lisent.
 *
 * La propriété se **constate** sur la configuration du module, jamais par un
 * test d'instance : à la frontière npm, deux copies du même paquet font échouer
 * `instanceof` sans un mot.
 *
 * @param connector - nom demandé.
 * @param config - configuration validée du module drizzle.
 * @param env - environnement constaté.
 * @param kernel - kernel courant, indispensable au chemin SQLite par défaut.
 * @param options - `allowMigrateUrl` autorise {@link MIGRATE_URL_ENV} à primer.
 * @returns la réponse, discriminée par `kind`.
 */
export function resolveConnector(
  connector: string,
  config: IDrizzleConfig,
  env: IMigrationEnv,
  kernel: Kernel | null,
  options: { allowMigrateUrl?: boolean } = {},
): IConnectorResolution {
  const declared = config.connectors?.[connector];
  if (!declared) {
    if (ormRegistry.has(connector)) {
      const owner = describeOwner(connector);
      return {
        kind: "unsupported",
        connector,
        owner: owner.label,
        sqlLike: SQL_DRIVERS.has(owner.driver.toLowerCase()),
        driver: owner.driver,
      };
    }
    return { kind: "unknown", connector, known: knownConnectors(config) };
  }
  // 🔴 JAMAIS `declared.filename` nu : il est optionnel, et le chemin par
  // défaut dépend du kernel. Une lecture naïve rend `undefined`, le pilote
  // SQLite retombe sur une base EN MÉMOIRE, et la commande décrit alors une
  // base que l'application n'utilise pas — en rendant le code du succès.
  const base = resolveConnectorTarget(kernel, connector, declared);
  const dialect: SqlDialect = base.dialect;
  const migrateUrl = options.allowMigrateUrl
    ? process.env[MIGRATE_URL_ENV]
    : undefined;

  // 🔴 La variable du moindre privilège est SUIVIE, ou REFUSÉE — jamais jetée.
  //
  // Elle a été ignorée en silence dès que le connecteur était sqlite. Le
  // scénario que ça produit est le pire de toute la chaîne : un travail de
  // déploiement pose l'URL de la base de production avec son compte de
  // migration, le connecteur résolu se trouve être sqlite (la variable du
  // trafic n'est pas passée à CE conteneur — cas ordinaire, puisqu'un job de
  // migration n'a pas besoin d'elle), et la commande migre alors une base
  // locale éphémère en rendant « ✓ appliqué » et le code du SUCCÈS. Les
  // exemplaires démarrent ensuite sur une base jamais migrée.
  //
  // Un dialecte qui ne concorde pas est donc une ERREUR D'USAGE, pas un cas à
  // absorber : on ne peut ni appliquer du SQL PostgreSQL avec un pilote sqlite,
  // ni deviner laquelle des deux bases l'exploitant visait.
  if (migrateUrl) {
    const vise = describeMigrateUrl(migrateUrl);
    if (vise === null || vise !== dialect) {
      return {
        kind: "url-mismatch",
        connector,
        dialect,
        urlDialect: vise,
      };
    }
  }
  const parsedUrl = migrateUrl ? parseDatabaseUrl(migrateUrl) : null;
  const fromMigrateUrl = parsedUrl !== null;
  const target: IMigrationTarget = {
    dialect,
    filename:
      fromMigrateUrl && dialect === "sqlite"
        ? sqliteFilenameFromUrl(parsedUrl.url)
        : base.filename,
    url: fromMigrateUrl && dialect !== "sqlite" ? parsedUrl.url : base.url,
  };
  return {
    kind: "ready",
    connector,
    dialect,
    target,
    fromMigrateUrl,
    // La MÊME bascule qu'au démarrage (`DrizzleService.#connectOne`) : une
    // ligne de commande qui annoncerait `auto` là où le boot applique les
    // migrations expliquerait un état qui n'existe pas.
    ddl: resolveDdlMode(
      declared.ddl,
      env,
      appVersionsMigrations(appMigrationsDir(kernel, config.migrations.dir)),
    ),
  };
}

/**
 * Dialecte que désigne une URL de migration, ou `null` si elle n'en désigne aucun.
 *
 * Ne jette jamais : une URL illisible est un cas d'usage à REFUSER avec une
 * phrase, pas une exception qui remonte en pile d'appels au milieu d'un
 * déploiement.
 *
 * @param url - valeur brute de la variable.
 * @returns le dialecte SQL visé, ou `null` (URL invalide, ou base non SQL).
 */
function describeMigrateUrl(url: string): SqlDialect | null {
  try {
    const vue = parseDatabaseUrl(url);
    return vue.family === "sql" ? vue.dialect : null;
  } catch {
    return null;
  }
}

/**
 * Dossier de migrations de l'application, résolu depuis la racine que le kernel
 * connaît.
 *
 * Jamais depuis le répertoire courant du processus : un espace de travail en a
 * plusieurs, et la commande serait juste ou fausse selon l'endroit d'où on la
 * tape — le pire des comportements, parce qu'il marche une fois sur deux.
 *
 * @param kernel - kernel courant.
 * @param dir - valeur de `migrations.dir` (relative, ou absolue si l'app le veut).
 * @returns le chemin absolu, ou `undefined` sans kernel.
 */
export function appMigrationsDir(
  kernel: Kernel | null,
  dir: string,
): string | undefined {
  const root = typeof kernel?.path === "string" ? kernel.path : undefined;
  if (!root) {
    return undefined;
  }
  return path.isAbsolute(dir) ? dir : path.resolve(root, dir);
}

/**
 * Construit l'applicateur d'un connecteur résolu.
 *
 * @param resolution - réponse `ready` de {@link resolveConnector}.
 * @param config - configuration validée du module drizzle.
 * @param kernel - kernel courant (racine de l'application).
 * @returns l'applicateur, sources du framework et de l'application chargées.
 */
export async function buildMigrator(
  resolution: Extract<IConnectorResolution, { kind: "ready" }>,
  config: IDrizzleConfig,
  kernel: Kernel | null,
): Promise<DrizzleMigrator> {
  const appDir = appMigrationsDir(kernel, config.migrations.dir);
  const sources = await defaultMigrationSources(appDir, {
    framework: config.frameworkEntities !== false,
  });
  return new DrizzleMigrator({
    connector: resolution.connector,
    ...resolution.target,
    sources,
    lockTimeoutMs: config.migrations.lockTimeoutMs,
  });
}

/** Conduite face à la divergence, telle que la configuration la déclare. */
export function resolveDivergenceMode(config: IDrizzleConfig): DivergenceMode {
  return config.migrations.divergence;
}
