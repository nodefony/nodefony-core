import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import { SysExit } from "../../cli/sysexits";
import {
  INSPECT_SUBJECTS,
  readAdminSubject,
  type IAdminBrokerLike,
  type InspectFailure,
} from "../inspect/adminSubjects";
import { localOperatorCaller } from "../adminPlane/adminCaller";

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
  helpGroup: "COMPRENDRE",
  // Le journal de cycle de vie n'est pas la sortie de cette commande : elle LIT
  // un état et le rend. Appliqué par le CLI à la commande demandée SEULE.
  quietBoot: true,
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
  // Ne devrait pas arriver depuis une commande locale (l'opérateur porte le
  // rôle) ; s'il arrive, c'est une faute de configuration du plan, pas une
  // faute d'usage — donc `NOPERM`, qui se distingue d'un mauvais argument.
  forbidden: SysExit.NOPERM,
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
 * 🔴 **La réponse dépend du MODE, et c'est pour cela qu'elle l'annonce.** Les
 * modules `policy:"dev"` ne sont pas chargés en production : la MÊME application
 * rend 136 routes en production et 354 en développement. Un nombre lu sans son
 * mode ne veut rien dire — mesuré, un agent a rapporté le compte d'une app en
 * marche pendant qu'un contrôle mesurait la même app bootée à froid dans l'autre
 * mode, et les deux avaient raison. L'environnement est donc écrit à côté du
 * total en rendu humain, et sur la sortie d'ERREUR en `--json` — jamais dans le
 * flux, qui doit rester parsable tel quel.
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
    // OPTIONNEL : déclaré `<sujet>`, commander refusait la commande avant
    // qu'elle existe (« missing required argument 'sujet' »). Réclamé en TTY par
    // `askArgument`, qui propose la LISTE des sujets — on ne demande pas de
    // deviner un mot dans une énumération qu'on connaît.
    // `.choices(...)` DÉRIVÉ du registre, jamais recopié : il sert deux fois —
    // l'aide rend les sujets en sous-ligne sous la commande, et la complétion
    // shell les propose au TAB. Une liste écrite à la main divergerait au
    // premier sujet ajouté.
    this.addArgument(
      "[sujet]",
      `sujet : ${Object.keys(INSPECT_SUBJECTS).join(" | ")}`,
    ).choices(Object.keys(INSPECT_SUBJECTS));
    this.addArgument("[cible]", "paramètre du sujet (ex : le nom d'un module)");
    this.addOption("-j, --json", "sortie JSON (scriptable)");

    // ⚠️ POSÉ DANS LE CONSTRUCTEUR, ET PAS AILLEURS : le syslog est branché au
    // tout début de `Kernel.start()`, donc avant le moindre hook de cycle de
    // vie. Un silence demandé depuis `generate()` arriverait trop tard, et le
    // boot aurait déjà écrit sur la sortie standard — un `| jq` casserait sur
    // la première ligne de log. Les erreurs (sévérité ≤ 3) partent sur la
    // sortie d'erreur : elles restent visibles sans polluer le flux JSON.
    // Le constructeur tourne pour TOUTES les commandes, d'où la garde sur argv.
  }

  override async generate(
    subjectArg?: string,
    target?: string,
    opts: { json?: boolean } = {},
  ): Promise<this> {
    let subject: string;
    try {
      subject = await this.askArgument(subjectArg, {
        name: "sujet",
        message: "Que veux-tu inspecter ?",
        choices: Object.keys(INSPECT_SUBJECTS),
        // `--json` va vers un script : y poser une question romprait le flux
        // que l'appelant s'apprête à parser.
        ...(opts.json ? { isTTY: false } : {}),
      });
    } catch (e) {
      this.log((e as Error).message, "ERROR");
      process.exitCode = 1;
      return this;
    }
    const broker = this.kernel?.container?.get("adminBroker") as
      IAdminBrokerLike | undefined;
    // Qui lance cette commande possède déjà le processus : l'identité est
    // ÉNONCÉE, plus fabriquée au fond de la lecture.
    const read = await readAdminSubject(
      broker,
      subject,
      localOperatorCaller(),
      target,
    );

    if (!read.ok) {
      // Le message de la lecture est déjà rédigé pour un humain ; on ajoute
      // seulement la forme d'appel, que seule cette porte connaît.
      const hint =
        read.reason === "missing-target"
          ? ` : nodefony inspect ${subject} <${INSPECT_SUBJECTS[subject]?.param}>`
          : "";
      // La CAUSE d'une panne de handler n'est écrite QU'ICI : cette commande
      // tourne sur la machine de celui qui la lance, qui possède déjà le
      // processus et ses journaux. Les portes distantes (MCP) ne la publient
      // pas — un message d'exception porte ce que le code avait sous la main.
      const pourquoi = read.cause ? ` — ${read.cause}` : "";
      this.log(`${read.message}${pourquoi}${hint}`, "ERROR");
      // Le producteur joint souvent DE QUOI corriger l'appel (les valeurs
      // acceptées, le plan d'une page). Le taire laisse deviner ; le rendre
      // coûte une ligne.
      if (read.body !== undefined && read.body !== null) {
        this.log(JSON.stringify(read.body, null, 2), "ERROR");
      }
      await this.terminate(EXIT_BY_FAILURE[read.reason]);
      return this;
    }

    if (opts.json) {
      // Le CONTEXTE part sur la sortie d'erreur, jamais dans le flux : un
      // consommateur fait `| jq '.[]'`, envelopper la donnée le casserait.
      // Même doctrine que le journal — la sortie EST le résultat, le reste
      // RACONTE. Sans cette ligne, deux mesures du même sujet dans deux modes
      // se contredisent sans que rien ne dise pourquoi.
      process.stderr.write(`environnement : ${this.environnement()}\n`);
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
  /**
   * Le mode MOTEUR sous lequel cette lecture a été faite.
   *
   * Sans kernel — cas qui ne devrait pas se produire ici, la commande booted —
   * on le DIT plutôt que de deviner : une valeur inventée serait pire que pas
   * de valeur, puisqu'elle serait crue.
   *
   * @returns le nom de l'environnement, ou `"inconnu"`
   */
  private environnement(): string {
    return this.kernel?.environment ?? "inconnu";
  }

  private renderHuman(subject: string, payload: unknown): void {
    if (Array.isArray(payload)) {
      if (payload.length === 0) {
        // 🔴 La SORTIE d'une commande ne passe pas par le journal.
        //
        // Ces deux lignes étaient des `this.log(…, "INFO")`. Tant que le boot
        // déversait son propre journal, la confusion ne se voyait pas ; le jour
        // où cette commande a boché en silence (`quietBoot`), INFO est tombé —
        // et la réponse avec. Un filtre de journal ne doit jamais pouvoir
        // effacer ce qu'on est venu chercher : le journal RACONTE l'exécution,
        // la sortie EST le résultat.
        // Le mode est ici PLUS important que partout ailleurs : « aucune
        // route » en production, alors qu'il y en a en développement, est la
        // réponse qui trompe le plus.
        process.stdout.write(
          `${subject} : aucun (environnement : ${this.environnement()})\n`,
        );
        return;
      }
      // `console.table` respecte la sortie standard et aligne seul.
      console.table(payload);
      process.stdout.write(
        `${payload.length} ${subject} (environnement : ${this.environnement()})\n`,
      );
      return;
    }
    console.dir(payload, { depth: 4, colors: true });
  }
}

export default Inspect;
