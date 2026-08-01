import { Command, CliKernel, type OptionsCommandInterface } from "nodefony";
import type DevkitService from "../service/DevkitService";
import type { IDevkitCard } from "../interfaces/IDevkitService";

/**
 * `onReady` : les services sont construits, AUCUN serveur n'écoute. La carte se
 * lit dans l'état du kernel — ouvrir un port pour la rendre serait payer un
 * démarrage complet pour une réponse qui n'en dépend pas.
 */
const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onReady",
};

/**
 * `nodefony devkit:card [-j]` — qui répond, et où aller ensuite.
 *
 * ## Pourquoi une commande, alors que la route existe
 *
 * La route HTTP vit sous `/nodefony`, que le pare-feu d'une application réelle
 * couvre : un agent qui code ne s'authentifie pas, et n'a pas de navigateur. La
 * porte qu'il a déjà, c'est le terminal. Même source (le service), deux rendus —
 * ajouter une porte n'ajoute jamais une vérité.
 *
 * ⚠️ Le module est `policy: "dev"` : hors développement il n'est pas chargé, donc
 * cette commande **n'existe pas**. C'est voulu — et c'est pour ça qu'elle
 * s'invoque `NODE_ENV=development npx nodefony devkit:card` depuis un terminal
 * qui n'aurait pas posé la variable.
 */
class CardCommand extends Command {
  constructor(cli: CliKernel) {
    super(
      "devkit:card",
      "Imprime la carte de visite de l application",
      cli,
      options,
    );
    this.addOption("-j, --json", "sortie JSON brute (scriptable, `| jq`)");
  }

  override async generate(opts: { json?: boolean }): Promise<this> {
    // Le service par sa CLÉ de conteneur — celle du `super("devkit", …)`, pas le
    // nom de sa classe.
    const svc = this.kernel?.container?.get("devkit") as
      DevkitService | undefined;
    if (!svc) {
      // Absent = le module n'est pas chargé (policy `dev` hors développement),
      // ou son service a échoué au boot. On le dit, on ne devine pas.
      this.log(
        "service « devkit » non enregistré — module non chargé (policy dev) ?",
        "ERROR",
      );
      return this;
    }
    const card = svc.getCard();
    if (opts.json) {
      // La carte TELLE QUELLE, pas enveloppée : la sortie est faite pour être
      // redirigée dans `jq`. Un `{ message: "<json échappé>" }` obligerait à
      // désérialiser deux fois.
      process.stdout.write(`${JSON.stringify(card, null, 2)}\n`);
      return this;
    }
    process.stdout.write(CardCommand.format(card));
    return this;
  }

  /**
   * Rend la carte pour un HUMAIN (ou un agent qui lit un terminal).
   *
   * Statique et PURE : elle ne touche ni au kernel ni au service, donc elle
   * s'éprouve seule. Sortie sur `stdout` plutôt que par le journal — une carte
   * de visite n'est pas un événement de log, et le préfixe horodaté rendrait le
   * copier-coller inutilisable.
   */
  static format(card: IDevkitCard): string {
    const lignes = [
      `${card.app.name} ${card.app.version} — ${card.app.environment} (nodefony ${card.nodefony.version})`,
      "",
      `Modules chargés (${card.modules.length}) : ${card.modules.join(", ")}`,
      "",
      "Où aller :",
      ...card.portes.map((p) => `  ${p.ou}\n      ${p.titre} — ${p.pourquoi}`),
      "",
      "Quoi lancer :",
      ...card.verbes.map((v) => `  ${v.commande}\n      ${v.pourquoi}`),
      "",
    ];
    return lignes.join("\n");
  }
}

export default CardCommand;
