import path from "node:path";
import type { Kernel } from "nodefony";
import { ormRegistry } from "@nodefony/orm-core";
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

/**
 * URL de connexion réservée au **travail de migration**.
 *
 * Elle porte le compte qui a le droit de modifier le schéma — un compte que les
 * exemplaires qui servent le trafic n'ont pas, et ne doivent pas avoir. C'est
 * tout son intérêt : le secret est monté dans le travail de migration
 * seulement.
 *
 * **Qui la lit, exactement** : les commandes `orm:migrate`,
 * `orm:migrate:status`, `orm:migrate:baseline` et `orm:migrate:repair`.
 * Personne d'autre — ni le démarrage de l'application, ni `orm:reset`, ni un
 * store. Une variable de privilège élevé qui fuiterait dans le chemin ordinaire
 * annulerait le moindre privilège qu'elle sert à installer.
 *
 * ⚠️ Elle doit désigner une connexion **directe** au serveur. Un répartiteur de
 * connexions en mode transaction (PgBouncer `transaction`) casse les verrous
 * consultatifs de session — et le verrou de l'applicateur en est un.
 */
export const MIGRATE_URL_ENV = "NF_MIGRATE_DATABASE_URL";

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
 * @param explicit - valeur écrite dans la configuration du connecteur, si elle l'est.
 * @param env - environnement constaté.
 * @returns le mode effectif.
 */
export function resolveDdlMode(
  explicit: DdlMode | undefined,
  env: IMigrationEnv,
): DdlMode {
  if (explicit) {
    return explicit;
  }
  return env.runtime === "development" || env.nodeEnv === "test"
    ? "auto"
    : "none";
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
  const fromMigrateUrl = Boolean(migrateUrl) && dialect !== "sqlite";
  const target: IMigrationTarget = {
    dialect,
    filename: base.filename,
    url: fromMigrateUrl ? migrateUrl : base.url,
  };
  return {
    kind: "ready",
    connector,
    dialect,
    target,
    fromMigrateUrl,
    ddl: resolveDdlMode(declared.ddl, env),
  };
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
  const sources = await defaultMigrationSources(appDir);
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
