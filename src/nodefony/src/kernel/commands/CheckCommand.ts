import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import {
  attachLive,
  collectCheckReport,
  parseCheckArgv,
  renderCheckReport,
  runCheckCommand,
} from "../checks/runCheck";
import { collectLiveReport, liveNotRun } from "../checks/live";
import { readTargetProvision } from "../checks/gating";
import type { GateConfig } from "../moduleGating";
import type Kernel from "../Kernel";
import type { IAdminBrokerLike } from "../inspect/adminSubjects";
import { localOperatorCaller } from "../adminPlane/adminCaller";

const options: OptionsCommandInterface = {
  helpGroup: "COMPRENDRE",
  // Lancée depuis le menu, cette commande BOOTE (le fast-path standalone ne
  // vaut que pour une invocation directe) : sa sortie serait noyée sous le
  // journal de cycle de vie.
  quietBoot: true,
  showBanner: false,
  // `onPostReady`, et pas `onReady` : le plan d'administration est monté PAR un
  // écouteur de `onReady`, tandis que l'action d'une commande INTÉGRÉE est
  // branchée avant qu'un seul module n'existe. À `onReady`, `--live`
  // n'interrogerait qu'un registre vide et conclurait « aucun ORM chargé » sur
  // une application qui en porte un. Aucun port ne s'ouvre pour autant : le
  // profil console est respecté par `Kernel.initServers`.
  kernelEvent: "onPostReady",
};

/**
 * Commande `nodefony doctor` — contrôle la cohérence des paquets de l'application.
 *
 * Elle répond à une question qu'aucun test applicatif ne pose : **ce que mes
 * modules importent, est-ce qu'ils le déclarent ?** Tant qu'on développe, la
 * réponse n'a aucune importance — npm hisse tout à la racine du projet, donc un
 * import non déclaré se résout quand même. Elle en prend le jour où le module
 * part ailleurs : l'installation n'amène pas ce qui n'est pas déclaré, et un
 * outil de construction ne peut pas ordonner ce qu'on ne lui a pas dit.
 *
 * **Exécutée en « standalone » (zéro boot).** L'enregistrement ici sert au help
 * (`nodefony --help`) ; l'exécution réelle est interceptée par le fast-path de
 * {@link CliKernel.start} AVANT toute construction de Kernel — le contrôle ne
 * lit que des fichiers. Le `generate()` ci-dessous n'est qu'un FILET.
 *
 * Un projet déclare ses exceptions dans son `package.json`, clé
 * `nodefony.check` (`typeCycles`, `typesUnreachable`) : un cycle de types
 * légitime existe, et un contrôle qu'on ne peut pas satisfaire est un contrôle
 * qu'on apprend à ignorer.
 *
 * @example
 * ```bash
 * nodefony doctor          # sortie lisible, sort en erreur si un manquement
 * nodefony doctor --json   # même chose, exploitable par un script de CI
 * nodefony doctor --strict # un contrôle SAUTÉ échoue aussi (défaut sous `CI`)
 * nodefony doctor --live   # DEMANDE en plus à l'application (boot, 0 port)
 * nodefony doctor --env production   # ce qui manquera LÀ-BAS, depuis ce poste
 * nodefony check           # alias historique — même commande
 * ```
 */
class Check extends Command {
  constructor(cli: CliKernel) {
    super(
      "doctor",
      "Diagnostic statique du projet : câblage, dépendances, bilan du dernier démarrage",
      cli as CliKernel,
      options,
    );
    // `doctor` est le nom PRINCIPAL : c'est le mot qu'on tape quand quelque
    // chose ne va pas, celui que les autres écosystèmes ont installé
    // (`brew doctor`, `flutter doctor`), et celui qu'un agent trouve en
    // cherchant à diagnostiquer. « check » ne dit pas ce qu'il vérifie ; il
    // reste en ALIAS, parce qu'il a voyagé et qu'un nom qui a servi ne se
    // retire pas sans prévenir.
    this.alias("check");
    this.addOption("--json", "Machine-readable output");
    this.addOption(
      "--strict",
      "Un contrôle SAUTÉ fait échouer (actif d'office si `CI` est posé)",
    );
    this.addOption(
      "--no-strict",
      "Tolère un contrôle sauté même en intégration continue",
    );
    this.addOption(
      "--live",
      "Demande aussi à l'application démarrée (migrations, cohérence des zones)",
    );
    this.addOption(
      "--no-live",
      "S'en tient aux fichiers : aucun démarrage, même si un script le demande",
    );
    this.addOption(
      "--env <name>",
      "Dit ce qui manquera dans CET environnement (ex. production), depuis ce poste",
      // SUGGESTIONS, pas contraintes : un environnement de déploiement est une
      // chaîne libre (`preprod`, `qa`, `recette`). Ce que la complétion propose
      // couvre les cas courants ; ce que la commande ACCEPTE reste ouvert, et
      // seule une faute de frappe manifeste est refusée.
      ["production", "development", "preprod", "staging"],
    );
    this.addOption(
      "--cwd <path>",
      "Start directory (the app root is resolved from it)",
    );
  }

  override async generate(opts?: {
    json?: boolean;
    strict?: boolean;
    noStrict?: boolean;
    live?: boolean;
    env?: string;
    cwd?: string;
  }): Promise<this> {
    const argv: string[] = [];
    if (opts?.json) argv.push("--json");
    if (opts?.strict) argv.push("--strict");
    if (opts?.noStrict) argv.push("--no-strict");
    if (opts?.live) argv.push("--live");
    if (opts?.env) argv.push("--env", opts.env);
    if (opts?.cwd) argv.push("--cwd", opts.cwd);

    // Sans `--live`, rien n'a changé : la lecture pure suffit, et c'est elle
    // qui répond sur une application qui ne démarre plus.
    if (!opts?.live) {
      await this.terminate(await runCheckCommand(argv));
      return this;
    }

    const parsed = parseCheckArgv(argv);
    if ("error" in parsed) {
      await this.terminate(await runCheckCommand(argv));
      return this;
    }
    const debut = Date.now();
    const report = await collectCheckReport(parsed.cwd, parsed.targetEnv);
    const complet = attachLive(
      report,
      await this.readLive(parsed.cwd, parsed.targetEnv),
    );
    await this.terminate(
      renderCheckReport(complet, parsed, Date.now() - debut),
    );
    return this;
  }

  /**
   * Interroge l'application que ce processus vient de démarrer.
   *
   * 🔴 **Ne lève jamais.** Le rapport statique est celui dont on a besoin quand
   * l'application va mal : une exception ici l'emporterait tout entier, au pire
   * moment. Un étage 2 impossible devient donc un état d'exécution lisible —
   * ce qui a manqué, et le geste qui le rendrait possible.
   *
   * @returns ce que l'application a dit, ou la raison de son silence
   */
  private async readLive(
    start: string,
    targetEnv: string | null,
  ): Promise<ReturnType<typeof liveNotRun>> {
    const broker = this.kernel?.container?.get("adminBroker") as
      IAdminBrokerLike | undefined;
    if (!broker)
      return liveNotRun(
        "l'application a démarré, mais sans plan d'administration : aucun " +
          "producteur ne peut être interrogé",
        "vérifie que `@nodefony/framework` est bien chargé",
      );
    try {
      // L'identité est ANNONCÉE, pas contournée : certains producteurs graduent
      // leur réponse selon les rôles, et un appelant anonyme obtiendrait une
      // vue amputée. Qui lance cette commande possède déjà le processus.
      const kernel = this.kernel as Kernel | null;
      return await collectLiveReport(broker, localOperatorCaller(), {
        targetEnv,
        manifest: kernel?.options?.modules,
        config: kernel?.options as GateConfig,
        // 🔴 Le boot cible part dans un PROCESSUS À PART, et jamais ici :
        // poser `NODE_ENV=production` dans celui-ci ferait basculer tout le
        // diagnostic — catalogue, fraîcheur, jusqu'à la lecture des sources.
        // Vécu, et le rapport était faux sans le dire.
        readTarget: readTargetProvision({
          execPath: process.execPath,
          // Le binaire qui tourne, pas un chemin reconstruit : c'est le seul
          // qui soit sûrement celui que l'utilisateur vient de lancer.
          binPath: process.argv[1] ?? "",
          cwd: kernel?.path ?? start,
          env: process.env,
        }),
      });
    } catch (e) {
      return liveNotRun(
        `l'interrogation de l'application a échoué — ${(e as Error).message}`,
      );
    }
  }
}

export default Check;
