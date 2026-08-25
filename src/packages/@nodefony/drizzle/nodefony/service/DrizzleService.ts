import fs from "node:fs";
import path from "node:path";
import { Service, BootConfigurationError } from "nodefony";
import type { Container, Event, Kernel, Module } from "nodefony";
import { queryFlowMonitor, resolveOrmFlowEnabled } from "@nodefony/orm-core";
import { DrizzleOrm } from "../src/orm-core/index";
import type {
  IDrizzleConfig,
  IDrizzleConnectorConfig,
} from "../interfaces/IDrizzleConfig";

const serviceName = "drizzle";

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
    const kernel = this.kernel as Kernel | null;
    const root = kernel?.path ?? process.cwd();
    // `.path` d'un FileClass est un `PathOrFileDescriptor` → narrowing string
    // (path.resolve n'accepte pas le descripteur numérique).
    const varPath = kernel?.varDir?.path;
    const base =
      typeof varPath === "string" ? varPath : path.resolve(root, "var");
    const file =
      name === "default" ? "nodefony-drizzle.db" : `nodefony-${name}.db`;
    return path.resolve(base, "databases", file);
  }

  /** Connecte un connecteur (crée le dossier de la base SQLite si nécessaire). */
  async #connectOne(name: string, cfg: IDrizzleConnectorConfig): Promise<void> {
    const dialect = cfg.dialect ?? "sqlite";
    let filename: string | undefined;
    if (dialect === "sqlite") {
      // `filename` optionnel (schéma pur) → résolu ici via le kernel si omis.
      filename = cfg.filename ?? this.#defaultFilename(name);
      if (filename !== ":memory:") {
        fs.mkdirSync(path.dirname(filename), { recursive: true });
      }
    }
    const orm = new DrizzleOrm(name, { dialect, filename, url: cfg.url });
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
    this.log(`Drizzle ORM "${name}" connected (${dialect}: ${target})`, "INFO");
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
