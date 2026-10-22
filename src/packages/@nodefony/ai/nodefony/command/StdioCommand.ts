import {
  Command,
  CliKernel,
  Syslog,
  STDERR_LOG_SINK,
  localOperatorCaller,
  type OptionsCommandInterface,
} from "nodefony";
import { defineMcpGate } from "../mcp/gate";
import { serveMcpStdio } from "../mcp/stdio";

const options: OptionsCommandInterface = {
  helpGroup: "AGENTS ET OUTILLAGE",
  showBanner: false,
  // `onPostReady`, pas `onReady` : la commande tient la main jusqu'à la fin de
  // l'entrée. Branchée à `onReady`, elle passerait avant l'écouteur qui peuple
  // le plan d'administration (`Framework.onKernelReady`), et les outils qui le
  // lisent ne trouveraient rien. Aucun port ne s'ouvre pour autant : le profil
  // console n'ouvre pas de serveur.
  kernelEvent: "onPostReady",
  // La sortie standard EST le protocole : le journal de boot n'y a pas sa
  // place. Seules les sévérités EMERGENCY..ERROR restent, sur la sortie
  // d'erreur.
  quietBoot: true,
  examples: ["nodefony ai:stdio", "nodefony ai:stdio 2> mcp-stdio.log"],
};

/**
 * Ce que l'agent lit en arrivant : ce process n'est PAS le serveur de
 * l'application, et ce qui en découle.
 */
const STDIO_INSTRUCTIONS =
  "Outils de cette application Nodefony, servis par un process lancé pour toi " +
  "(transport stdio). Ils répondent depuis le code tel qu'il a démarré — sans " +
  "rechargement à chaud — et ce process ne sert aucune requête : ce qui " +
  "mesure le trafic réel exige l'application démarrée et sa porte HTTP.";

/**
 * Sert le MCP de l'application sur l'entrée et la sortie standard —
 * `nodefony ai:stdio`.
 *
 * Pour le client qui lance lui-même son serveur MCP et lui parle par stdio
 * (agent de CI, interface en ligne de commande, agent cloud `"type": "local"`) :
 * rien n'y écoute sur `localhost`, la route `/nodefony/mcp` lui est hors
 * d'atteinte.
 *
 * Servi dans TOUS les environnements : les outils des modules chargés, avec la
 * posture de l'OPÉRATEUR LOCAL — celle de toute commande du CLI
 * (`localOperatorCaller`, qui dit pourquoi). Qui lance la commande a déjà un
 * terminal dans l'application : `nodefony inspect` lui rend les mêmes données.
 * Ce rôle n'ouvre que l'administration du framework (`admin:read`/`admin:write`
 * se traduisent en lui, `rolesFromScopes`) ; un outil à scope APPLICATIF, un
 * outil `requiresAuth` ou `actsForUser` reste retenu — il exige un jeton, donc
 * une porte HTTP protégée. Les outils `nodefony_*` n'y paraissent que lorsque
 * `@nodefony/devkit` est chargé (développement).
 *
 * Limite : le code servi est celui du boot, sans rechargement à chaud — la
 * porte HTTP de développement reste celle qui suit les sources.
 */
class StdioCommand extends Command {
  constructor(cli: CliKernel) {
    super(
      "ai:stdio",
      "sert le MCP de l'app en stdio, sans serveur",
      cli,
      options,
    );
  }

  override async generate(): Promise<this> {
    const stdout = process.stdout;
    // Le protocole écrit par la fonction d'ORIGINE, capturée (liée à la
    // sortie standard) avant le détournement ci-dessous, et rendue à la fin.
    const original = stdout.write.bind(stdout);
    const protocolWrite: (chunk: string) => boolean = original;
    // 🔴 Une seule ligne étrangère sur la sortie standard, et le client
    // déclare le serveur en échec. Le journal part sur la sortie d'erreur, et
    // toute autre écriture — un `console.log` dans l'outil d'un module tiers —
    // y est détournée : son auteur la voit encore, le protocole n'en sait rien.
    Syslog.setLogSink(STDERR_LOG_SINK);
    stdout.write = process.stderr.write.bind(process.stderr);
    // Le client qui ferme sa lecture le premier rend l'écriture `EPIPE` : la
    // fin d'une conversation, pas une panne du serveur.
    const onOutputError = (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") {
        this.log(`MCP stdio — sortie standard : ${error.message}`, "ERROR");
      }
    };
    stdout.on("error", onOutputError);

    try {
      await serveMcpStdio(
        defineMcpGate({
          tools: "modules",
          instructions: STDIO_INSTRUCTIONS,
          // La MÊME règle que toute commande locale — jamais un rôle recopié.
          unprotectedRoles: [...localOperatorCaller().roles],
        }),
        {
          input: process.stdin,
          write: (line) => {
            protocolWrite(line);
          },
          runtime: {
            modules: this.kernel?.modules,
            log: (message, severity) => this.log(message, severity),
          },
        },
      );
    } finally {
      stdout.write = original;
      stdout.removeListener("error", onOutputError);
    }
    return this;
  }
}

export default StdioCommand;
