import fs from "node:fs";
import path from "node:path";
import { Service, BootConfigurationError } from "nodefony";
import type { Container, Event, Kernel, Module } from "nodefony";
import { queryFlowMonitor, resolveOrmFlowEnabled } from "@nodefony/orm-core";
import { DrizzleOrm } from "../src/orm-core/index";
import { defaultConnectorFilename } from "../src/connectorTarget";
import { DrizzleMigrator } from "../src/migrator/DrizzleMigrator";
import { defaultMigrationSources } from "../src/migrator/paths";
import {
  appMigrationsDir,
  readMigrationEnv,
  resetAllowed,
  resolveCheckMode,
  resolveDdlMode,
} from "../src/migrator/resolve";
import { buildReport, meaningOf, isAheadOnly } from "../src/migrator/explain";
import { describeDivergence } from "../src/migrator/divergence";
import {
  dataLoss,
  renderDestructive,
  scanDestructive,
  summarizeDestructive,
} from "../src/migrator/destructive";
import type { DdlMode } from "../config/config";
import type {
  IDrizzleConfig,
  IDrizzleConnectorConfig,
} from "../interfaces/IDrizzleConfig";

const serviceName = "drizzle";

/**
 * Période de re-vérification du schéma quand la mise en service est retenue.
 *
 * C'est ce minuteur, et lui seul, qui donne au processus sa propriété la plus
 * précieuse : **il redevient disponible TOUT SEUL** dès que les migrations sont
 * appliquées par ailleurs — aucun redéploiement, aucune intervention. Sans lui,
 * un exemplaire retenu le resterait jusqu'à ce qu'on pense à le relancer.
 *
 * Quinze secondes : assez court pour qu'un déploiement ne perde pas de temps,
 * assez long pour être invisible (une requête sur une table minuscule). Le
 * minuteur n'existe QUE lorsque le schéma n'est pas dérivé du code — en
 * développement, il n'est jamais créé.
 */
const READINESS_POLL_MS = 15_000;

/**
 * Ce que chaque mode veut dire, en clair, dans le journal de démarrage.
 *
 * Une ligne de journal qui dit `ddl: none` n'apprend rien à qui n'a pas lu la
 * documentation — et personne ne la lit AVANT l'incident. La phrase, elle,
 * suffit.
 */
const DDL_EXPLAINED: Record<DdlMode, string> = {
  auto: "(dérivé du code au démarrage — développement ; les colonnes manquantes qui acceptent le vide sont ajoutées)",
  migrate:
    "(migrations appliquées au démarrage, sous verrou — un seul exemplaire assumé)",
  none: "(personne ne touche au schéma ici — un travail externe lance « nodefony orm:migrate »)",
};

/** Nom du contributeur de disponibilité, tel qu'il apparaît au diagnostic. */
function readinessName(connector: string): string {
  return `drizzle:schema:${connector}`;
}

/** URL de connexion sans credentials — un log de boot ne porte jamais de secret. */
function redactUrl(url?: string): string {
  if (!url) {
    return "no url";
  }
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "invalid url";
  }
}

/**
 * Service bootable du module `@nodefony/drizzle`.
 *
 * Au boot du kernel (`onBoot`), instancie un {@link DrizzleOrm} (adapter
 * orm-core) **par connecteur** déclaré dans la config et le connecte ; chaque
 * ORM s'auto-enregistre dans le `ormRegistry` (accessible ensuite via DI ou
 * `OrmRegistry.get(name)`). Ferme proprement les connexions à `onTerminate`.
 *
 * C'est le point d'entrée « ORM par défaut » de l'app : il rend Drizzle utilisable
 * sans logique métier — les entités (`@entity`) ciblant un connecteur sont
 * compilées à la connexion (aucune au départ = base connectée mais vide).
 */
class DrizzleService extends Service {
  module: Module;
  /** ORM connectés, indexés par nom de connecteur. */
  readonly #orms = new Map<string, DrizzleOrm>();

  /**
   * Minuteurs de re-vérification du schéma, par connecteur.
   *
   * `null` tant que personne n'en a besoin — c'est le cas de TOUT le
   * développement, où le schéma est dérivé du code : aucun objet alloué, aucun
   * minuteur armé, aucune requête périodique. Ils ne naissent que pour les
   * connecteurs dont le schéma appartient aux migrations.
   */
  #watchers: Map<string, NodeJS.Timeout> | null = null;

  constructor(module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options ?? {},
    );
    this.module = module;

    // Connexion au boot (après chargement des modules/entités), fermeture au
    // shutdown. `module.hookKernel` et non `kernel.once` : le hook hérite ainsi
    // du nom et de la criticité du module. Posé à la main, il n'aurait aucun tag
    // — donc « critique » par défaut, et un journal qui ne nomme personne.
    this.module.hookKernel("onBoot", async () => {
      // Sonde de flux ORM : OFF en prod (coût nul hot path), ON sinon. Override
      // NF_ORM_FLOW. Calcul factorisé en orm-core (C5).
      queryFlowMonitor.setEnabled(resolveOrmFlowEnabled(this.kernel));
      await this.connectAll().catch((e: Error) => {
        this.log(e, "ERROR");
        throw e;
      });
    });
    this.kernel?.once("onTerminate", async () => {
      // Les minuteurs d'abord : un tour qui partirait pendant la fermeture
      // parlerait au nom d'une connexion en train de disparaître.
      this.#stopWatchers();
      await this.disconnectAll().catch(() => {
        /* shutdown — silencieux */
      });
    });
  }

  /** Config validée (Zod) exposée par le Module (`this.module.config`). */
  #config(): IDrizzleConfig {
    return this.module.config as IDrizzleConfig;
  }

  /** Connecte tous les connecteurs déclarés en config (validée Zod). */
  async connectAll(): Promise<void> {
    const connectors = this.#config()?.connectors ?? {};
    for (const [name, cfg] of Object.entries(connectors)) {
      await this.#connectOne(name, cfg);
    }
  }

  /**
   * Chemin SQLite par défaut d'un connecteur, résolu AU BOOT (kernel présent —
   * jamais au top-level d'un import) : `<app>/var/databases/nodefony-<x>.db`.
   *
   * Sous `kernel.varDir` (= `<app>/var`) = la base COMMUNE des données runtime
   * persistées (stores fichier + bases SQLite, lot 1 « varDir ») → un seul
   * répertoire à sauvegarder/gitignorer, et « où sont mes données » a une réponse
   * unique. Fallback `<root>/var` si le kernel n'a pas encore matérialisé `varDir`.
   */
  #defaultFilename(name: string): string {
    // Règle PARTAGÉE avec les commandes de migration (`connectorTarget.ts`) :
    // deux implémentations du même chemin se mettraient à désigner deux bases
    // différentes sans que rien ne le signale — et une commande qui migre une
    // autre base que celle de l'application rend « appliqué » pour rien.
    return defaultConnectorFilename(this.kernel as Kernel | null, name);
  }

  /** Connecte un connecteur (crée le dossier de la base SQLite si nécessaire). */
  async #connectOne(name: string, cfg: IDrizzleConnectorConfig): Promise<void> {
    const dialect = cfg.dialect ?? "sqlite";
    const ddl = resolveDdlMode(
      cfg.ddl,
      readMigrationEnv(this.kernel as Kernel | null),
    );
    let filename: string | undefined;
    if (dialect === "sqlite") {
      // `filename` optionnel (schéma pur) → résolu ici via le kernel si omis.
      filename = cfg.filename ?? this.#defaultFilename(name);
      if (filename !== ":memory:") {
        fs.mkdirSync(path.dirname(filename), { recursive: true });
      }
    }
    // 🔴 Le schéma n'est dérivé du code QUE en mode `auto`. Ailleurs il
    // appartient aux migrations, et une création dérivée qui passerait
    // par-dessus fabriquerait exactement la divergence que les migrations
    // existent pour empêcher : une table sans trace dans l'historique, dont
    // plus personne ne sait d'où elle vient.
    const orm = new DrizzleOrm(name, {
      dialect,
      filename,
      url: cfg.url,
      deriveSchema: ddl === "auto",
      // L'état des migrations se lit dans la CONFIGURATION (fichiers, mode de
      // schéma, coordonnées) : l'ORM, lui, ne connaît que sa connexion. Le
      // lecteur est donc posé ici, par le seul objet qui détienne les deux.
      //
      // Il rend la MÊME charge utile que `orm:migrate:status --json` — un
      // producteur, deux portes. L'écran de la console d'administration et la
      // ligne de commande ne peuvent donc pas se contredire.
      migrationStatus: async () => {
        const { migrationStatusFor } = await import("../src/migrator/status");
        const result = await migrationStatusFor(
          name,
          this.#config(),
          this.kernel as Kernel | null,
        );
        return result.ok ? result.report : result.failure;
      },
      migrationPlan: async () => {
        const { migrationPlanFor } = await import("../src/migrator/status");
        const result = await migrationPlanFor(
          name,
          this.#config(),
          this.kernel as Kernel | null,
        );
        return result.ok ? result.plan : result.failure;
      },
      // 🔴 Le refus hors développement vit dans `applyMigrationsFor`, pas ici
      // et surtout pas dans l'écran : une garde posée dans une interface ne
      // protège que celui qui la regarde.
      applyMigrations: async () => {
        const { applyMigrationsFor } = await import("../src/migrator/status");
        const result = await applyMigrationsFor(
          name,
          this.#config(),
          this.kernel as Kernel | null,
        );
        return result.ok ? result.run : result.failure;
      },
    });
    const target = dialect === "sqlite" ? filename : redactUrl(cfg.url);
    try {
      await orm.connect();
    } catch (e) {
      // Échec de connexion d'un connecteur CONFIGURÉ = erreur de CONFIGURATION
      // → boot fatal, dev ET prod (jamais un serveur « vivant » aux briques
      // durables mortes — session/users/tokens dépendent de cet ORM ; vécu :
      // login impossible avec la cause noyée dans un WARNING fail-soft).
      const cause = e instanceof Error ? e.message : String(e);
      throw new BootConfigurationError(
        `Drizzle : le connecteur "${name}" (${dialect}: ${target}) n'a pas pu ` +
          `se connecter — corriger la configuration (infra déclarée ` +
          `NF_DATABASE_URL/connectors, base démarrée ?, entités portées sur ce ` +
          `dialecte ?) ou la retirer. Cause : ${cause}`,
        { cause: e },
      );
    }
    this.#orms.set(name, orm);
    // 🔴 LE JOURNAL DIT LE MODE, ET CE QUE LE MODE IMPLIQUE.
    //
    // « connected » ne suffit pas : la question que se pose l'exploitant à
    // 3 heures du matin n'est pas « suis-je connecté » mais « qui fabrique mon
    // schéma, et est-il à jour ». Une ligne qui tait le mode laisse croire au
    // comportement de développement partout.
    this.log(
      `Drizzle « ${name} » connecté (${dialect}: ${target}) — schéma : ` +
        `${ddl} ${DDL_EXPLAINED[ddl]}`,
      "INFO",
    );
    await this.#applySchemaPolicy(name, ddl, cfg, dialect, filename);
  }

  /**
   * Fait ce que le mode de schéma demande, et l'ÉNONCE.
   *
   * - `auto` : le schéma vient d'être dérivé du code, il n'y a rien de plus à
   *   faire et rien à surveiller ;
   * - `migrate` : les migrations sont appliquées ici, sous verrou ;
   * - `none` : personne ne touche au schéma, on se contente de constater.
   *
   * Dans les deux derniers cas, l'état est publié à la sonde de disponibilité
   * puis re-vérifié périodiquement.
   *
   * **Aucune de ces situations ne tue le processus.** Un schéma en retard est un
   * état EXTÉRIEUR au processus : le redémarrer ne répare rien, et un
   * redéploiement forcé coûterait plus cher que d'attendre. Le processus reste
   * donc vivant, refuse le trafic, dit pourquoi — et repart tout seul.
   */
  async #applySchemaPolicy(
    name: string,
    ddl: DdlMode,
    cfg: IDrizzleConnectorConfig,
    dialect: string,
    filename: string | undefined,
  ): Promise<void> {
    if (ddl === "auto") {
      return;
    }
    const kernel = this.kernel as Kernel | null;
    const config = this.#config();
    const check = resolveCheckMode(
      config.migrations?.check,
      readMigrationEnv(kernel),
    );
    const target = { dialect, filename, url: cfg.url } as {
      dialect: "sqlite" | "postgres" | "mysql";
      filename?: string;
      url?: string;
    };
    const sources = await defaultMigrationSources(
      appMigrationsDir(kernel, config.migrations?.dir ?? "migrations"),
      { framework: config.frameworkEntities !== false },
    );
    const migrator = new DrizzleMigrator({
      connector: name,
      ...target,
      sources,
      lockTimeoutMs: config.migrations?.lockTimeoutMs,
    });

    if (ddl === "migrate") {
      try {
        // 🔴 GARDE DESTRUCTIF — plus strict ici que sur la ligne de commande, et
        // sans drapeau pour le lever.
        //
        // Un exemplaire qui redémarre ne doit JAMAIS supprimer une colonne tout
        // seul : personne ne regarde à ce moment-là, et un redémarrage peut
        // survenir pour n'importe quelle raison (mise à l'échelle, éviction,
        // panne d'un nœud). Assumer une suppression est une décision humaine,
        // elle se prend en tapant la commande — jamais en relançant un
        // processus.
        const prevu = await migrator.status();
        const losses = dataLoss(scanDestructive(prevu.pending));
        if (losses.length > 0) {
          this.log(
            `${summarizeDestructive(losses, name)}\n` +
              `  Le démarrage N'APPLIQUE PAS ces migrations : un exemplaire qui ` +
              `redémarre ne supprime jamais de données de lui-même.\n` +
              renderDestructive(losses, true) +
              `  À faire, une fois la décision prise : ` +
              `nodefony orm:migrate --connector ${name} --allow-destructive`,
            "CRITIC",
          );
          await this.#publishReadiness(name, migrator, ddl, check);
          this.#watch(name, migrator, ddl, check);
          return;
        }
        const run = await migrator.migrate();
        if (run.applied.length > 0) {
          this.log(
            `Drizzle « ${name} » : ${run.applied.length} migration(s) ` +
              `appliquée(s) au démarrage — ` +
              run.applied.map((a) => `${a.source}/${a.tag}`).join(", "),
            "INFO",
          );
        }
      } catch (e) {
        // On N'ARRÊTE PAS le démarrage : le processus doit pouvoir devenir
        // disponible tout seul si quelqu'un applique les migrations depuis
        // l'extérieur. Mais il ne sert pas de trafic en attendant, et il dit
        // pourquoi, avec le geste.
        this.log(
          `Drizzle « ${name} » : les migrations n'ont pas pu être appliquées au ` +
            `démarrage — ${(e as Error).message}\n` +
            `  Le processus reste vivant mais NE reçoit PAS de trafic. Il ` +
            `redeviendra disponible seul dès que le schéma sera à jour.\n` +
            `  Diagnostic : nodefony orm:migrate:status --connector ${name} --json`,
          "CRITIC",
        );
      }
    }

    await this.#publishReadiness(name, migrator, ddl, check);
    this.#watch(name, migrator, ddl, check);
  }

  /**
   * Calcule l'état du schéma et le publie à la sonde de disponibilité.
   *
   * Le verdict est **déjà calculé** quand la sonde le lit : `/readyz` ne fait
   * qu'une comparaison d'entier, sans `await` ni allocation. C'est ce qui la
   * rend insensible à une base qui tombe — une sonde qui interrogerait la base
   * tomberait avec elle, et l'orchestrateur conclurait que le processus est mort
   * alors que c'est la base qui l'est.
   *
   * ⚠️ Elle ne touche JAMAIS `/livez`. Un schéma en retard n'est pas un
   * processus malade : le tuer et le relancer ne changerait rien, et ferait
   * boucler l'orchestrateur sur des redémarrages inutiles.
   */
  async #publishReadiness(
    name: string,
    migrator: DrizzleMigrator,
    ddl: DdlMode,
    check: "fail" | "warn" | "off",
  ): Promise<void> {
    if (check === "off") {
      return;
    }
    const kernel = this.kernel as Kernel | null;
    if (!kernel) {
      return;
    }
    try {
      const plan = await migrator.status();
      // La troisième source ne se paie que lorsque les deux premières n'ont
      // plus rien à dire (cf `describeDivergence`) : c'est exactement le moment
      // où elle apprend quelque chose que personne d'autre ne voit. Elle rend
      // ce qui diverge, NOMMÉ — la phrase publiée à la sonde dit donc quelle
      // table manque, et non plus seulement qu'il en manque une.
      const mode = this.#config().migrations?.divergence ?? "report";
      const report = buildReport(plan, {
        ddl,
        // `off` : rien n'est calculé. Cf le même choix dans `migrateShared`.
        divergence: mode === "off" ? null : await describeDivergence(plan),
        divergenceMode: mode,
        canReset: resetAllowed(readMigrationEnv(kernel)),
      });
      // Une base EN AVANCE sur ce code n'est pas une anomalie : c'est l'état
      // normal d'une mise à jour progressive et d'un retour arrière. Le verdict
      // reste `drift` — le fait est juste — mais la sonde ne doit pas en
      // déduire une rétention : elle sortirait du service tous les anciens
      // exemplaires dès la fin du travail de migration, avant que le premier
      // nouveau soit prêt. La règle est écrite UNE fois, à côté du verdict
      // qu'elle nuance (`isAheadOnly`).
      const enAvance = isAheadOnly(plan);
      const ok = report.exitCode === 0 || enAvance;
      // L'état est PUBLIÉ dans les deux conduites ; seule `fail` le rend
      // opposable au trafic. En `warn`, se taire faisait perdre bien plus que
      // la rétention : le noyau garde vivant un exemplaire dont un contributeur
      // signale un état externe, et sans inscription il n'y en avait plus —
      // un module qui tombait sur une table absente redevenait fatal, et la
      // commande qui répare inatteignable. Publier sans bloquer sépare les deux.
      kernel.setReadiness(
        readinessName(name),
        ok,
        report.summary,
        check === "fail",
      );
      if (enAvance) {
        // Ni CRITIC ni geste à taper : il n'y a rien à réparer, et l'action que
        // le rapport propose pour un fichier absent (`git checkout`) n'a aucun
        // sens dans un exemplaire déployé — elle enverrait chercher un dépôt
        // git dans un conteneur.
        this.log(
          `Drizzle « ${name} » : la base porte ${plan.missing.length} migration(s) ` +
            `que ce code ne connaît pas — elle est EN AVANCE. C'est attendu ` +
            `pendant un déploiement progressif ou après un retour arrière ; ` +
            `rien à appliquer, le processus peut servir.`,
          "INFO",
        );
      } else if (!ok) {
        this.log(
          `Drizzle « ${name} » : ${report.summary}\n` +
            `  ${meaningOf(report.verdict)}\n` +
            (check === "fail"
              ? `  → le trafic est RETENU (/readyz répond 503) jusqu'à ce que ce soit réglé ; ` +
                `/livez reste vert, ce processus n'est pas malade.\n`
              : `  → le trafic passe quand même (migrations.check: "warn").\n`) +
            report.nextActions
              .map((a) => `  À faire : ${a.command}`)
              .join("\n"),
          check === "fail" ? "CRITIC" : "WARNING",
        );
      } else if (check === "fail") {
        this.log(
          `Drizzle « ${name} » : schéma à jour — le processus peut servir.`,
          "INFO",
        );
      }
    } catch (e) {
      // La base ne répond pas : ce n'est PAS « schéma en retard », et il ne faut
      // pas le prétendre. On retient quand même la mise en service — un
      // processus qui ne sait pas dans quel état est son schéma ne doit pas
      // servir — mais on dit la vraie cause.
      const cause = (e as Error).message;
      if (check === "fail") {
        kernel.setReadiness(
          readinessName(name),
          false,
          `état du schéma inconnu : ${cause}`,
        );
      }
      this.log(
        `Drizzle « ${name} » : impossible de lire l'état du schéma — ${cause}\n` +
          `  Ce n'est pas un schéma en retard : la base n'a pas répondu. ` +
          `Nouvelle tentative dans ${Math.round(READINESS_POLL_MS / 1000)} s.\n` +
          `  Diagnostic : nodefony orm:migrate:status --connector ${name} --json`,
        "CRITIC",
      );
    }
  }

  /**
   * Arme la re-vérification périodique — le mécanisme qui rend le processus
   * capable de redevenir disponible sans qu'on y touche.
   */
  #watch(
    name: string,
    migrator: DrizzleMigrator,
    ddl: DdlMode,
    check: "fail" | "warn" | "off",
  ): void {
    if (check === "off") {
      return;
    }
    if (this.#watchers === null) {
      this.#watchers = new Map();
    }
    const timer = setInterval(() => {
      void this.#publishReadiness(name, migrator, ddl, check).catch(
        () => undefined,
      );
    }, READINESS_POLL_MS);
    // `unref` : ce minuteur ne doit JAMAIS retenir le processus en vie. Un
    // travail one-shot qui ne se termine pas à cause d'une surveillance est un
    // travail qui bloque un déploiement.
    timer.unref();
    this.#watchers.set(name, timer);
  }

  /** Éteint toutes les surveillances et libère le registre. */
  #stopWatchers(): void {
    if (this.#watchers === null) {
      return;
    }
    const kernel = this.kernel as Kernel | null;
    for (const [name, timer] of this.#watchers) {
      clearInterval(timer);
      // La voix de ce contributeur ne compte plus : un module qui s'arrête ne
      // doit pas retenir la mise en service pour l'éternité.
      kernel?.clearReadiness(readinessName(name));
    }
    this.#watchers.clear();
    this.#watchers = null;
  }

  /** Ferme toutes les connexions. */
  async disconnectAll(): Promise<void> {
    for (const orm of this.#orms.values()) {
      await orm.disconnect();
    }
    this.#orms.clear();
  }

  /** Retourne l'ORM Drizzle d'un connecteur (défaut : `"default"`). */
  getOrm(name = "default"): DrizzleOrm | undefined {
    return this.#orms.get(name);
  }
}

export default DrizzleService;
