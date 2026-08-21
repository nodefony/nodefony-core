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
  // Le journal de cycle de vie n'est PAS la sortie d'une commande. Sans ceci,
  // ta commande rend d'abord trente lignes de boot (`MODULE ADD`, stores
  // résolus, certificats) et sa réponse arrive en dernier, sous un mur que
  // personne n'a demandé. Seuls NOTICE et INFO tombent : `EMERGENCY..ERROR`
  // restent visibles, et `-d/--debug` rétablit tout.
  // À RETIRER si ta commande LANCE quelque chose dont le journal EST la sortie
  // (un serveur, une migration qu'on regarde se dérouler).
  quietBoot: true,
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
    //
    // 🔴 Garde les crochets `[…]`, même pour un argument INDISPENSABLE. Déclaré
    // `<obligatoire>`, Commander refuse la commande AVANT qu'elle existe
    // (« error: missing required argument ») — y compris quand l'utilisateur
    // l'a CHOISIE dans `nodefony menu`, où l'on ne peut taper aucun argument.
    // Réclame-le plutôt avec `askArgument` (voir `generate` ci-dessous) : il
    // demande en terminal, et hors terminal il échoue en montrant la ligne à
    // taper — jamais une question qui pend dans un pipeline.
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
<% } else { %>    // Un argument dont tu ne peux pas te passer se DEMANDE, il ne se refuse pas :
    //   const cible = await this.askArgument(who, {
    //     name: "who",
    //     message: "Qui saluer ?",
    //     // choices: ["monde", "toi"],  // → une liste plutôt qu'une saisie
    //   });
    // En terminal il pose la question ; sans terminal (CI, script) il échoue
    // avec la ligne exacte à taper. Ici l'argument a un défaut, donc rien à
    // demander.
    const message = `Bonjour, ${who ?? "monde"} !`;
<% } %>    // 🔴 La SORTIE va sur la sortie standard, JAMAIS dans le journal.
    // `this.log(message, "INFO")` semble marcher — jusqu'au jour où un filtre
    // de journal (`quietBoot` ci-dessus, `--json`, une commande lancée depuis
    // le menu) coupe INFO : la réponse disparaît avec lui. Le journal RACONTE
    // l'exécution, la sortie EST le résultat ; `this.log` reste pour ce qui
    // relève du récit (avertissements, erreurs, détail sous `--debug`).
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ message })}\n`);
    } else {
      process.stdout.write(`${message}\n`);
    }
    return this;
  }
}

export default <%= it.nameClass %>;
