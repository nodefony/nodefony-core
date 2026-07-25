import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { SysExit } from "../../cli/sysexits";
import type {
  IAdminApi,
  IAdminEndpoint,
  IAdminRequest,
} from "../../types/IAdminApi";

/**
 * `kernelEvent: "onPostReady"` — et pas `onReady`, malgré les apparences.
 *
 * Le plan d'administration est monté PAR un écouteur de `onReady`
 * (`Framework.onKernelReady`). Or l'action d'une commande intégrée est branchée
 * avant que le moindre module n'existe : à `onReady`, elle passerait donc AVANT
 * celui qui peuple le registre, et ne trouverait rien à inspecter. La phase
 * suivante est la première où le registre est garanti complet.
 *
 * Aucun serveur n'écoute pour autant : le profil console (`servers: false`, le
 * défaut) est respecté par `Kernel.initServers`.
 */
const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onPostReady",
};

/** Un sujet inspectable : où le lire dans le plan d'administration. */
interface IInspectSubject {
  /** Producteur d'administration (`kernel`, `framework`, `orm`…). */
  namespace: string;
  /** Chemin de l'endpoint, tel que le producteur le déclare. */
  path: string;
  /** Ce que le sujet montre, en une ligne (affiché par `inspect --help`). */
  summary: string;
  /** Nom du paramètre attendu, quand le chemin en porte un (`module/{name}`). */
  param?: string;
}

/**
 * Sujets exposés, et l'endpoint d'administration qui les sert.
 *
 * **Aucune donnée n'est calculée ici.** Chaque sujet pointe le producteur qui
 * répond déjà en HTTP : la commande et l'API d'administration rendent le même
 * objet, parce que c'est le même code qui le produit. Une table de
 * correspondance peut se périmer ; une réimplémentation, elle, diverge en
 * silence — et c'est le CLI qu'on croirait sur parole.
 */
const SUBJECTS: Record<string, IInspectSubject> = {
  routes: {
    namespace: "framework",
    path: "routes",
    summary: "toutes les routes (chemin, méthodes, controller, action)",
  },
  modules: {
    namespace: "kernel",
    path: "modules",
    summary: "modules chargés, avec leur version",
  },
  services: {
    namespace: "kernel",
    path: "services",
    summary: "services enregistrés, et le module qui les porte",
  },
  config: {
    namespace: "kernel",
    path: "config",
    summary: "config effective de chaque module (+ schéma, + provenance)",
  },
  module: {
    namespace: "kernel",
    path: "module/{name}",
    summary: "un module en détail (config, services, dépendances)",
    param: "name",
  },
  stores: {
    namespace: "kernel",
    path: "stores",
    summary: "où sont réellement écrites les données (sessions, cache…)",
  },
  entities: {
    namespace: "orm",
    path: "entities",
    summary: "entités déclarées à l'ORM",
  },
  graph: {
    namespace: "orm",
    path: "graph",
    summary: "graphe des entités et de leurs relations",
  },
};

/**
 * Extrait la donnée d'une réponse d'administration.
 *
 * Un handler rend soit la donnée, soit une enveloppe `{status, body}` (pour
 * porter un 404). Même discrimination que le pont HTTP : enveloppe **si et
 * seulement si** `body` est présent AVEC `status` ou `headers` — un objet
 * métier qui posséderait un champ `body` n'est pas une enveloppe.
 */
function unwrap(result: unknown): { status: number; data: unknown } {
  if (
    result !== null &&
    typeof result === "object" &&
    "body" in result &&
    ("status" in result || "headers" in result)
  ) {
    const envelope = result as { status?: number; body: unknown };
    return { status: envelope.status ?? 200, data: envelope.body };
  }
  return { status: 200, data: result };
}

/**
 * `nodefony inspect <sujet> [--json]` — lit l'état RÉEL de l'application, sans
 * serveur ni session.
 *
 * Pourquoi cette commande existe : l'état d'une application (ses routes, ses
 * services, sa configuration effective) est déjà exposé par le plan
 * d'administration — mais derrière HTTP, un rôle d'administrateur et un serveur
 * qui tourne. Trois obstacles pour qui travaille dans un terminal, et zéro pour
 * qui lit le code : on répond donc en devinant à partir des sources, alors que
 * la vérité est calculable en une seconde.
 *
 * Le contrôle d'accès du plan d'administration protège le RÉSEAU. Ici, il n'y a
 * pas de réseau : celui qui lance la commande a déjà le disque et la
 * configuration. La redaction, elle, s'applique quand même — elle vit DANS les
 * producteurs, pas dans le transport, donc un secret n'est pas plus lisible par
 * cette porte que par l'autre.
 *
 * @example
 * ```bash
 * nodefony inspect routes --json | jq '.[] | select(.methods[] == "POST")'
 * nodefony inspect module http --json
 * ```
 */
class Inspect extends Command {
  constructor(cli: CliKernel) {
    super(
      "inspect",
      "Inspecte l'état réel de l'app (routes, modules, services, config…) — sans serveur",
      cli as CliKernel,
      options,
    );
    this.addArgument("<sujet>", `sujet : ${Object.keys(SUBJECTS).join(" | ")}`);
    this.addArgument("[cible]", "paramètre du sujet (ex : le nom d'un module)");
    this.addOption("-j, --json", "sortie JSON (scriptable)");

    // ⚠️ POSÉ DANS LE CONSTRUCTEUR, ET PAS AILLEURS : le syslog est branché au
    // tout début de `Kernel.start()`, donc avant le moindre hook de cycle de
    // vie. Un silence demandé depuis `generate()` arriverait trop tard, et le
    // boot aurait déjà écrit sur la sortie standard — un `| jq` casserait sur
    // la première ligne de log. Les erreurs (sévérité ≤ 3) partent sur la
    // sortie d'erreur : elles restent visibles sans polluer le flux JSON.
    // Le constructeur tourne pour TOUTES les commandes, d'où la garde sur argv.
    if (process.argv.includes("--json") || process.argv.includes("-j")) {
      (cli as CliKernel).quietBoot = true;
    }
  }

  override async generate(
    subject: string,
    target?: string,
    opts: { json?: boolean } = {},
  ): Promise<this> {
    const spec = SUBJECTS[subject];
    if (!spec) {
      this.log(
        `sujet inconnu « ${subject} » — attendus : ${Object.keys(SUBJECTS).join(", ")}`,
        "ERROR",
      );
      await this.terminate(SysExit.USAGE);
      return this;
    }
    if (spec.param && !target) {
      this.log(
        `« ${subject} » attend un argument : nodefony inspect ${subject} <${spec.param}>`,
        "ERROR",
      );
      await this.terminate(SysExit.USAGE);
      return this;
    }

    const broker = this.kernel?.container?.get("adminBroker") as
      { list(): readonly IAdminApi[] } | undefined;
    const producer = broker
      ?.list()
      .find((api) => api.adminNamespace === spec.namespace);
    if (!producer) {
      // Un producteur peut légitimement manquer : `orm` n'existe que si un
      // pilote a démarré. On le DIT, avec ce qu'il faudrait installer.
      this.log(
        `« ${subject} » est servi par le module « ${spec.namespace} », qui n'est pas chargé dans cette app`,
        "ERROR",
      );
      await this.terminate(SysExit.UNAVAILABLE);
      return this;
    }
    const endpoint = producer
      .adminEndpoints()
      .find((candidate: IAdminEndpoint) => candidate.path === spec.path);
    if (!endpoint) {
      this.log(
        `endpoint « ${spec.namespace}/${spec.path} » introuvable — version de module incompatible ?`,
        "ERROR",
      );
      await this.terminate(SysExit.UNAVAILABLE);
      return this;
    }

    const request: IAdminRequest = {
      params: spec.param && target ? { [spec.param]: target } : {},
      query: {},
      body: null,
      user: null,
      // Le rôle d'administrateur est ANNONCÉ, pas contourné : certains
      // producteurs graduent leur réponse selon les rôles, et une commande
      // locale qui se présenterait en anonyme rendrait une vue amputée — elle
      // mentirait par omission face à la même donnée lue en HTTP.
      roles: ["ROLE_NODEFONY_ADMIN"],
    };

    let payload: unknown;
    let status = 200;
    try {
      const result = await endpoint.handler(request);
      ({ status, data: payload } = unwrap(result));
    } catch (error) {
      this.log(`inspection impossible : ${(error as Error).message}`, "ERROR");
      await this.terminate(SysExit.SOFTWARE);
      return this;
    }

    if (status >= 400) {
      this.log(`« ${target ?? subject} » introuvable (${status})`, "ERROR");
      await this.terminate(SysExit.NOINPUT);
      return this;
    }

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      this.renderHuman(subject, payload);
    }
    await this.terminate(SysExit.OK);
    return this;
  }

  /**
   * Rendu lisible par défaut — un tableau de lignes devient un tableau.
   *
   * Volontairement sommaire : le format qui compte est `--json`, celui qu'on
   * enchaîne. Le rendu humain sert à répondre « qu'est-ce qu'il y a là-dedans »
   * sans ouvrir un autre outil, pas à remplacer la console d'administration.
   */
  private renderHuman(subject: string, payload: unknown): void {
    if (Array.isArray(payload)) {
      if (payload.length === 0) {
        this.log(`${subject} : aucun`, "INFO");
        return;
      }
      // `console.table` respecte la sortie standard et aligne seul.
      console.table(payload);
      this.log(`${payload.length} ${subject}`, "INFO");
      return;
    }
    console.dir(payload, { depth: 4, colors: true });
  }
}

export default Inspect;
