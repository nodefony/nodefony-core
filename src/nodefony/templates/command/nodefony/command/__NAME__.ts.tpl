<% if (it.readState) { %>import { parseArgs } from "node:util";
import {
  Command,
  CliKernel,
  type ICommandResult,
  type OptionsCommandInterface,
} from "nodefony";
<% } else { %>import { Command, CliKernel, type OptionsCommandInterface } from "nodefony";
<% } %><% if (it.service) { %>import <%= it.service.pascal %> from "../service/<%= it.service.pascal %>";
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
  // 🔴 TA COMMANDE LIT OU ÉCRIT DES DONNÉES ? Elle doit le DÉCLARER :
  //
  //   import { CONSOLE_DATA_RUN_PROFILE } from "nodefony";
  //   runProfile: CONSOLE_DATA_RUN_PROFILE,
  //
  // Sans cette ligne, le framework enregistre l'ORM mais NE SE CONNECTE PAS —
  // et c'est voulu : une commande qui n'a pas besoin de base ne doit pas
  // échouer parce qu'aucune base ne tourne (`nodefony inspect`, `build`, et le
  // premier `npm run build` d'une application fraîche). Les stockages durables
  // (jetons, audit, comptes) basculent alors en MÉMOIRE le temps du run, avec
  // un avertissement qui le dit.
  //
  // Concrètement, la question à se poser : « si aucune base ne tourne, ma
  // commande a-t-elle encore un sens ? » Oui → laisse tel quel. Non → déclare.
  // Une commande qui déclare et dont la base est injoignable échoue FRANCHEMENT,
  // ce qui est le comportement voulu : mieux vaut un refus net qu'un compte
  // créé dans une mémoire qui disparaît à la fin du process.
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
  // Des invocations COMPLÈTES qui marchent. Sous une erreur d'usage (option
  // inconnue, argument en trop), le CLI écrit les deux premières avec la ligne
  // d'usage — c'est ce qui remet sur la voie celui qui vient de se tromper, un
  // agent surtout. `--help` les montre toutes. Garde-les VRAIES : à chaque
  // option ou argument ajouté, ajoute l'exemple qui l'emploie.
  examples: [
    "nodefony <%= it.commandName %>",
    "nodefony <%= it.commandName %> Alice --json",
  ],
};

<% if (it.readState) { %>/**
 * Lit la ligne tapée dans l'invite, avec les MÊMES options que celles déclarées
 * au constructeur : à chaque option ajoutée là-bas, l'ajouter ici — sinon le
 * direct la refuse et la commande retombe, juste, en sous-processus.
 *
 * @returns les valeurs lues, ou `null` sur une option inconnue (`--help` compris).
 */
function parseLine(args: readonly string[]) {
  try {
    return parseArgs({
      args: [...args],
      options: { json: { type: "boolean", short: "j" } },
      allowPositionals: true,
      strict: true,
    });
  } catch {
    return null;
  }
}

<% } %>/**
 * <%= it.description %> — `nodefony <%= it.commandName %> [who]`.
 *
 * Convention Nodefony : `<module>:<action>`. La commande vit AVEC le module qui
 * la porte (elle disparaît si le module n'est pas chargé) et parle au même
 * service que les controllers — une seule logique, deux portes d'entrée.
<% if (it.readState) { %> *
 * SERVIE EN DIRECT : tapée dans l'invite de `nodefony development`, elle est
 * exécutée par le SERVEUR qui tourne ({@link <%= it.nameClass %>.readState}) —
 * quelques millisecondes, sur l'état réellement chargé —, au lieu d'un
 * sous-processus qui redémarre l'application. La CLI, elle, passe par
 * `generate` ; les deux appellent le MÊME producteur (`produce`), donc
 * elles ne peuvent pas rendre deux réponses différentes.
<% } %><% if (!it.service) { %> *
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

<% if (it.readState) { %>  override async generate(
    who: string | undefined,
    opts: { json?: boolean },
  ): Promise<this> {
    // La CLI imprime EXACTEMENT ce que l'invite reçoit : les parts du
    // producteur, rien de plus. Une réponse ajoutée ici n'existerait qu'en CLI.
    // 🔴 La SORTIE va sur la sortie standard, JAMAIS dans le journal : un filtre
    // de journal (`quietBoot`, `--json`, le menu) la ferait disparaître.
    const result = await this.produce(who, opts.json === true);
    const stream = result.code === 0 ? process.stdout : process.stderr;
    for (const part of result.parts) {
      if ("text" in part) stream.write(part.text);
    }
    await this.terminate(result.code);
    return this;
  }

  /**
   * Servie EN DIRECT à l'invite de `nodefony development` : le SERVEUR qui
   * tourne l'appelle à la place d'un sous-processus.
   *
   * 🔴 Trois règles, parce que ce code tourne DANS le serveur vivant :
   * - **LIRE, jamais écrire.** Une écriture (base, fichier, état d'un service)
   *   partirait dans l'application qu'on est en train de développer. Une
   *   commande qui écrit retire cette méthode : elle part en sous-processus.
   * - **Rendre la main VITE.** La boucle du serveur est partagée avec les
   *   requêtes HTTP et WebSocket : un calcul SYNCHRONE long les fige toutes.
   *   Ce qui attend une E/S l'attend en asynchrone.
   * - **Rien sur la sortie standard**, pas de `terminate`, pas de
   *   `process.exitCode` : on RENVOIE parts et code, l'invite les affiche.
   *
   * Un second argument est disponible au besoin (`IReadStateContext`) :
   * `columns` (largeur de l'onglet), `signal` (Ctrl+C), `progress(…)`.
   *
   * @param args - les arguments tapés après le nom de la commande.
   * @returns la réponse, ou `null` pour ce que le direct ne sert pas (aide,
   *   option inconnue, argument de trop) : la commande part alors en
   *   sous-processus, où la CLI répond comme d'habitude.
   */
  override async readState(
    args: readonly string[],
  ): Promise<ICommandResult | null> {
    const parsed = parseLine(args);
    if (parsed === null || parsed.positionals.length > 1) return null;
    return this.produce(parsed.positionals[0], parsed.values.json === true);
  }

  /** Le producteur UNIQUE : ce que rendent la CLI et l'invite. */
  private async produce(
    who: string | undefined,
    json: boolean,
  ): Promise<ICommandResult> {
<% if (it.service) { %>    // Le service par sa CLÉ de conteneur — celle du `super("<%= it.service.key %>", …)`.
    const svc = this.kernel?.container?.get("<%= it.service.key %>");
    if (!(svc instanceof <%= it.service.pascal %>)) {
      // 69 = service indisponible (sysexits). On le dit, on ne devine pas.
      return {
        code: 69,
        parts: [{ text: "service « <%= it.service.key %> » non enregistré\n" }],
      };
    }
    // Remplace cet appel par le tien — une LECTURE (voir `readState`).
    const result: unknown = await Promise.resolve(
      svc.<%= it.service.method %>(),
    );
    const message =
      typeof result === "string" ? result : JSON.stringify(result, null, 2);
    if (who) {
      this.log(`argument reçu : ${who}`, "DEBUG");
    }
<% } else { %>    const message = `Bonjour, ${who ?? "monde"} !`;
<% } %>    return {
      code: 0,
      parts: [
        json
          ? {
              text: `${JSON.stringify({ message })}\n`,
              mediaType: "application/json",
            }
          : { text: `${message}\n` },
      ],
    };
  }
}
<% } else { %>
  override async generate(
    who: string | undefined,
    opts: { json?: boolean },
  ): Promise<this> {
<% if (it.service) { %>    // On demande le service par sa CLÉ de conteneur — celle du `super("<%= it.service.key %>", …)`
    // du service, pas le nom de sa classe. (Depuis le DI, `@Inject("<%= it.service.pascal %>")`
    // mènerait à la même instance ; mais hors injection, c'est la clé qui sert.)
    // `instanceof` plutôt qu'une conversion : le conteneur rend `unknown`, et la
    // garde VÉRIFIE ce que la conversion ne ferait que déclarer.
    const svc = this.kernel?.container?.get("<%= it.service.key %>");
    if (!(svc instanceof <%= it.service.pascal %>)) {
      // Absent = le module n'est pas chargé, ou son service a échoué au boot (le
      // kernel l'aura annoncé : « boot DÉGRADÉ »). On le dit, on ne devine pas.
      this.log("service « <%= it.service.key %> » non enregistré", "ERROR");
      return this;
    }
    // Remplace cet appel par le tien : ce que ces lignes MONTRENT, c'est comment
    // on obtient le service — le reste est de la mise en forme.
    // `Promise.resolve` : la méthode peut être synchrone ou asynchrone, le même
    // appel convient aux deux.
    const result: unknown = await Promise.resolve(
      svc.<%= it.service.method %>(),
    );
    const message =
      typeof result === "string" ? result : JSON.stringify(result, null, 2);
    if (who) {
      this.log(`argument reçu : ${who}`, "DEBUG");
    }
<% } else { %>    // Un argument dont tu ne peux pas te passer se DEMANDE, il ne se refuse pas :
    //   let cible: string;
    //   try {
    //     cible = await this.askArgument(who, {
    //       name: "who",
    //       message: "Qui saluer ?",
    //       // choices: ["monde", "toi"],  // → une liste plutôt qu'une saisie
    //     });
    //   } catch (e) {
    //     this.refuseMissingArgument(e);
    //     return this;
    //   }
    // En terminal il pose la question. Sans terminal (CI, script, onglet de
    // l'invite du serveur de développement) il lève : `refuseMissingArgument`
    // écrit alors la ligne exacte à taper ET l'aide de la commande (usage,
    // options, exemples), puis sort en 1. Ici l'argument a un défaut, donc
    // rien à demander.
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

    // ── ENCHAÎNER sur une autre commande ────────────────────────────────────
    //
    // Quand le geste suivant appartient à une AUTRE commande (souvent d'un
    // autre module), ne le réimplémente pas : APPELLE-la. Un process neuf,
    // comme le fait le menu — commander ne connaît pas toujours la cible au
    // moment où l'on décide.
    //
    //   const { spawnSync } = await import("node:child_process");
    //   spawnSync(process.execPath, [process.argv[1]!, "autre:commande", "--write"], {
    //     stdio: "inherit",                                   // (3)
    //     cwd: this.kernel?.path ?? process.cwd(),             // (2)
    //     env: { ...process.env, NODE_ENV: "development" },    // (1)
    //   });
    //
    // 🔴 TROIS choses ne suivent PAS toutes seules d'un process à l'autre, et
    // chacune a déjà produit un échec quand elle manquait :
    //   (1) l'ENVIRONNEMENT — un enfant ne reçoit QUE ce qu'on lui donne.
    //       Sans le report, il part sans PATH ; et si la cible n'existe qu'en
    //       développement (module `policy: "dev"`), pose `NODE_ENV`, sinon
    //       elle échouera sur une ressource que l'application ne sert pas ;
    //   (2) le RÉPERTOIRE — ce qui s'écrit doit l'être dans le PROJET, pas là
    //       où la commande a été tapée ;
    //   (3) le TERMINAL — `stdio: "inherit"` le transmet. Sans lui, l'enfant
    //       voit `isTTY` faux, ne peut poser aucune question, et échoue.
    //
    // Et n'enchaîne PAS sous `--json` ni `--dry-run` : le premier part vers un
    // script qu'une question romprait, le second ne doit rien produire. Isole
    // cette décision dans une fonction PURE — le `spawn` est de la plomberie,
    // la décision est ce qui peut être faux, et c'est elle qui se teste.
    return this;
  }
}
<% } %>
export default <%= it.nameClass %>;
