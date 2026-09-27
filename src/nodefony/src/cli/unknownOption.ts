/**
 * Ce qu'on dit APRÈS le refus d'une option inconnue.
 *
 * Commander répond `error: unknown option '-y'`, et c'est tout : celui qui l'a
 * tapée ne sait ni ce que la commande accepte, ni où le lire. Vécu (banc
 * devkit, tâche 0) : un agent qui venait d'employer `create … -y` a retapé
 * `orm:generate --apply -y`, reçu cette seule ligne, et a dû deviner la suite
 * — un tour perdu par commande qu'il essaie. `-y` n'est pas une option
 * universelle, et rien ne le lui disait.
 *
 * Pourquoi un indice et pas l'aide complète : l'aide d'une commande fait
 * souvent plus d'un écran, et elle repousserait l'erreur elle-même hors de vue
 * (`showHelpAfterError` est désactivé pour cette raison). On nomme donc les
 * options réelles en une ligne, et le chemin vers le détail.
 */

/** La commande refusée, telle que l'indice a besoin de la connaître. */
export interface IUnknownOptionCommand {
  /** Nom tapé (`orm:generate`). */
  name: string;
  /** Les options DÉCLARÉES, sous leur forme d'usage (`--name <nom>`). */
  flags: readonly string[];
}

/** Options qu'un utilisateur transporte d'une commande à l'autre par réflexe. */
const CONFIRM_FLAGS = new Set(["-y", "--yes"]);

/**
 * Compose l'indice à afficher après une option refusée par Commander.
 *
 * @param message - le message de l'erreur Commander (`error: unknown option '-y'`).
 * @param command - la commande visée, ou `null` si on ne la connaît pas.
 * @returns les lignes à écrire sur la sortie d'erreur, ou `null` s'il n'y a
 *   rien d'utile à ajouter.
 */
export function unknownOptionHint(
  message: string,
  command: IUnknownOptionCommand | null,
): string | null {
  const match = /unknown option '([^']+)'/u.exec(message);
  if (!match || !command) return null;
  const option = match[1] ?? "";
  const lines: string[] = [];
  if (CONFIRM_FLAGS.has(option)) {
    lines.push(
      `  ${option} n'est pas une option universelle : « ${command.name} » ne la déclare pas.`,
    );
  }
  lines.push(
    command.flags.length > 0
      ? `  options de « ${command.name} » : ${command.flags.join(" · ")}`
      : `  « ${command.name} » n'accepte aucune option.`,
  );
  lines.push(`  détail : nodefony ${command.name} --help`);
  return lines.join("\n");
}
