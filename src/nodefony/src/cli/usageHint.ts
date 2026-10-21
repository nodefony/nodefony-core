/**
 * Ce qu'on dit APRÈS un refus d'usage : l'extrait de la doc de la commande.
 *
 * Commander répond une ligne (`error: unknown option '-y'`, `error: missing
 * required argument 'type'`), et c'est tout : celui qui l'a tapée — très
 * souvent un agent — ne sait ni la forme attendue, ni où la lire, et devine la
 * suite. Vécu (banc devkit, tâche 0) : sur 36 tours, 6 gestes en échec, dont 4
 * dus à un refus qui ne disait pas la bonne forme. Le seul refus qui nommait le
 * geste exact a remis l'agent sur la voie en un tour.
 *
 * Pourquoi un EXTRAIT et pas l'aide complète : l'aide d'une commande fait
 * souvent plus d'un écran, et elle repousserait l'erreur elle-même hors de vue
 * (`showHelpAfterError` est désactivé pour cette raison). On rend donc la ligne
 * d'usage, les options réelles, un exemple qui marche, et le chemin vers le
 * détail — tous lus sur la déclaration de la commande, jamais recopiés.
 */

/** La commande refusée, telle que l'indice a besoin de la connaître. */
export interface IUsageHintCommand {
  /** Nom tapé (`orm:generate`). */
  name: string;
  /** Ligne d'usage rendue par Commander (`[options] <name>`). */
  usage: string;
  /** Les options DÉCLARÉES, sous leur forme d'usage (`--name <nom>`). */
  flags: readonly string[];
  /** Les exemples déclarés par la commande, lignes complètes (`nodefony …`). */
  examples: readonly string[];
}

/**
 * Les codes d'erreur Commander qui sont un MAUVAIS USAGE — sortie 64
 * (`EX_USAGE`, sysexits.h), jamais un échec logiciel. `unknownCommand` n'y est
 * pas : sans commande résolue, il n'y a pas de doc à extraire, et le chemin
 * d'une commande de module le traite à part.
 */
export const USAGE_ERROR_CODES: ReadonlySet<string> = new Set([
  "commander.unknownOption",
  "commander.missingArgument",
  "commander.excessArguments",
  "commander.optionMissingArgument",
  "commander.missingMandatoryOptionValue",
  "commander.invalidArgument",
  "commander.conflictingOption",
]);

/** Options qu'un utilisateur transporte d'une commande à l'autre par réflexe. */
const CONFIRM_FLAGS = new Set(["-y", "--yes"]);

/** Au-delà, l'extrait redevient une aide complète — elle est à `--help`. */
const MAX_EXAMPLES = 2;

/**
 * Compose l'extrait de doc à écrire après un refus d'usage de Commander.
 *
 * @param code - le code de l'erreur Commander (`commander.missingArgument`…).
 * @param message - son message (`error: unknown option '-y'`).
 * @param command - la commande visée, ou `null` si on ne la connaît pas.
 * @returns les lignes à écrire sur la sortie d'erreur, ou `null` si le code
 *   n'est pas un mauvais usage ou que la commande est inconnue.
 */
export function usageHint(
  code: string,
  message: string,
  command: IUsageHintCommand | null,
): string | null {
  if (!command || !USAGE_ERROR_CODES.has(code)) return null;
  const lines: string[] = [];
  if (code === "commander.unknownOption") {
    const option = /unknown option '([^']+)'/u.exec(message)?.[1] ?? "";
    if (CONFIRM_FLAGS.has(option)) {
      lines.push(
        `  ${option} n'est pas une option universelle : « ${command.name} » ne la déclare pas.`,
      );
    }
  }
  const usage = command.usage.trim();
  lines.push(
    `  usage   : nodefony ${command.name}${usage === "" ? "" : ` ${usage}`}`,
  );
  lines.push(
    command.flags.length > 0
      ? `  options : ${command.flags.join(" · ")}`
      : `  options : aucune — « ${command.name} » n'en accepte pas.`,
  );
  const examples = command.examples.slice(0, MAX_EXAMPLES);
  examples.forEach((example, rank) => {
    lines.push(`  ${rank === 0 ? "exemple :" : "         "} ${example}`);
  });
  lines.push(`  détail  : nodefony ${command.name} --help`);
  return lines.join("\n");
}
