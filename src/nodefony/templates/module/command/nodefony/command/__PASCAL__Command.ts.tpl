import { Command, CliKernel, type OptionsCommandInterface } from "nodefony";
<% if (it.service) { %>import type <%= it.pascal %>Service from "../service/<%= it.pascal %>Service";
<% } %>
/**
 * `kernelEvent: "onReady"` = point d'arrêt du boot : la commande s'exécute quand
 * les services sont prêts, MAIS avant que le moindre serveur n'écoute. Une
 * commande d'introspection n'a aucune raison d'ouvrir un port.
 */
const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onReady",
};

/**
 * `nodefony <%= it.name %>:hello [nom]` — commande CLI du module.
 *
 * Convention Nodefony : `<module>:<action>`. La commande vit AVEC le module qui
 * la porte (elle disparaît si le module n'est pas chargé) et parle au même
 * service que les controllers — une seule logique, deux portes d'entrée.
 */
class <%= it.pascal %>Command extends Command {
  constructor(cli: CliKernel) {
    super("<%= it.name %>:hello", "Salue depuis le module <%= it.name %>", cli, options);
    // Argument POSITIONNEL optionnel : sans déclaration, Commander refuse le mot
    // (« too many arguments ») — un argument non déclaré n'existe pas.
    this.addArgument("[who]", "qui saluer (défaut : monde)");
    this.addOption("-j, --json", "sortie JSON (scriptable)");
  }

  override async generate(
    who: string | undefined,
    opts: { json?: boolean },
  ): Promise<this> {
<% if (it.service) { %>    const svc = this.kernel?.container?.get("<%= it.name %>") as
      | <%= it.pascal %>Service
      | undefined;
    if (!svc) {
      this.log("service « <%= it.name %> » non enregistré", "ERROR");
      return this;
    }
    const message = svc.greet(who);
<% } else { %>    const message = `Bonjour, ${who ?? "monde"} !`;
<% } %>    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ message })}\n`);
    } else {
      this.log(message, "INFO");
    }
    return this;
  }
}

export default <%= it.pascal %>Command;
