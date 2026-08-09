import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { SysExit } from "../../cli/sysexits";
import {
  INSPECT_SUBJECTS,
  readAdminSubject,
  type IAdminBrokerLike,
  type InspectFailure,
} from "../inspect/adminSubjects";

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

/**
 * Traduit un échec de lecture en code de sortie POSIX.
 *
 * La lecture (`readAdminSubject`) dit POURQUOI ; c'est à chaque porte de le
 * dire dans son vocabulaire — un code `sysexits` ici, un code JSON-RPC pour le
 * serveur MCP. La table des sujets, elle, n'est écrite qu'une fois.
 */
const EXIT_BY_FAILURE: Record<InspectFailure, number> = {
  "unknown-subject": SysExit.USAGE,
  "missing-target": SysExit.USAGE,
  "producer-missing": SysExit.UNAVAILABLE,
  "endpoint-missing": SysExit.UNAVAILABLE,
  "handler-failed": SysExit.SOFTWARE,
  "not-found": SysExit.NOINPUT,
};

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
    this.addArgument(
      "<sujet>",
      `sujet : ${Object.keys(INSPECT_SUBJECTS).join(" | ")}`,
    );
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
    const broker = this.kernel?.container?.get("adminBroker") as
      IAdminBrokerLike | undefined;
    const read = await readAdminSubject(broker, subject, target);

    if (!read.ok) {
      // Le message de la lecture est déjà rédigé pour un humain ; on ajoute
      // seulement la forme d'appel, que seule cette porte connaît.
      const hint =
        read.reason === "missing-target"
          ? ` : nodefony inspect ${subject} <${INSPECT_SUBJECTS[subject]?.param}>`
          : "";
      this.log(`${read.message}${hint}`, "ERROR");
      await this.terminate(EXIT_BY_FAILURE[read.reason]);
      return this;
    }

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(read.data, null, 2)}\n`);
    } else {
      this.renderHuman(subject, read.data);
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
