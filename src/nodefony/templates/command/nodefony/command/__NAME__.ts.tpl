import { Command, CliKernel, type OptionsCommandInterface } from "nodefony";
<% if (it.service) { %>import type <%= it.service.pascal %> from "../service/<%= it.service.pascal %>";
<% } %>
/**
 * `kernelEvent` = point d'ARRÊT du boot : le kernel s'arrête à cette phase, et
 * c'est là que la commande s'exécute.
 *
 * - `onReady` (défaut) — services prêts, AUCUN serveur en écoute : une commande
 *   qui lit ou écrit des données n'a pas à ouvrir un port.
 * - `onRegister` — modules enregistrés, services pas encore construits (léger).
 * - `onPostReady` — serveurs HTTP/WS en écoute. Seulement si la commande doit
 *   parler à ses propres serveurs.
 */
const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "<%= it.phase %>",
};

/**
 * <%= it.description %> — `nodefony <%= it.commandName %> [who]`.
 *
 * Convention Nodefony : `<module>:<action>`. La commande vit AVEC le module qui
 * la porte (elle disparaît si le module n'est pas chargé) et parle au même
 * service que les controllers — une seule logique, deux portes d'entrée.
<% if (!it.service) { %> *
 * Pour atteindre un service depuis ici : `this.kernel?.container?.get("<clé>")`,
 * où la clé est celle du `super("<clé>", …)` du service — jamais le nom de sa
 * classe.
<% } %> */
class <%= it.nameClass %> extends Command {
  constructor(cli: CliKernel) {
    super("<%= it.commandName %>", "<%= it.description %>", cli, options);
    // Argument POSITIONNEL optionnel : sans déclaration, Commander refuse le mot
    // (« too many arguments ») — un argument non déclaré n'existe pas.
    this.addArgument("[who]", "qui saluer (défaut : monde)");
    this.addOption("-j, --json", "sortie JSON (scriptable)");
  }

  override async generate(
    who: string | undefined,
    opts: { json?: boolean },
  ): Promise<this> {
<% if (it.service) { %>    // On demande le service par sa CLÉ de conteneur — celle du `super("<%= it.service.key %>", …)`
    // du service, pas le nom de sa classe. (Depuis le DI, `@inject("<%= it.service.pascal %>")`
    // mènerait à la même instance ; mais hors injection, c'est la clé qui sert.)
    const svc = this.kernel?.container?.get("<%= it.service.key %>") as <%= it.service.pascal %> | undefined;
    if (!svc) {
      // Absent = le module n'est pas chargé, ou son service a échoué au boot (le
      // kernel l'aura annoncé : « boot DÉGRADÉ »). On le dit, on ne devine pas.
      this.log("service « <%= it.service.key %> » non enregistré", "ERROR");
      return this;
    }
    // Remplace cet appel par le tien : ce que ces lignes MONTRENT, c'est comment
    // on obtient le service — le reste est de la mise en forme.
    const resultat = await svc.<%= it.service.method %>();
    const message =
      typeof resultat === "string" ? resultat : JSON.stringify(resultat, null, 2);
    if (who) {
      this.log(`argument reçu : ${who}`, "DEBUG");
    }
<% } else { %>    const message = `Bonjour, ${who ?? "monde"} !`;
<% } %>    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ message })}\n`);
    } else {
      this.log(message, "INFO");
    }
    return this;
  }
}

export default <%= it.nameClass %>;
