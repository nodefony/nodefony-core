/**
 * La garde des drapeaux — une seule implémentation pour les trois bancs.
 *
 * Le défaut qu'elle ferme : tant qu'un banc ignore ce qu'il ne comprend pas,
 * une faute de frappe déroule le catalogue entier. Vécu — un `--help` qui
 * n'existait pas a lancé de vrais agents, et de l'argent réel, avant qu'on s'en
 * aperçoive.
 *
 * Le défaut qu'elle ferme AUSSI, et c'est le second : écrite à la main dans un
 * seul banc, cette garde a immédiatement recalé `--setup-only`, un drapeau que
 * le même fichier documentait et traitait — la liste blanche et le code qui lit
 * les drapeaux avaient déjà divergé le jour de leur naissance. Deux copies
 * divergent en silence ; trois copies écrites à trois moments divergent trois
 * fois. D'où ce module, et d'où son auto-contrôle.
 *
 * @module
 */

/**
 * Refuse tout drapeau que le banc ne connaît pas, et sert `--help`.
 *
 * Ne rend la main que si la ligne de commande est comprise en entier. Sinon,
 * elle termine le processus : `0` après avoir imprimé l'aide, `64` (usage,
 * convention `sysexits`) sur un drapeau inconnu.
 *
 * @param {object} opts
 * @param {string[]} opts.args - `process.argv.slice(2)`.
 * @param {string[]} opts.connus - tous les drapeaux acceptés, tirets compris.
 * @param {string[]} [opts.aValeur] - ceux qui sont suivis d'une valeur ; ce qui
 *   les suit n'est jamais jugé comme un drapeau (un chemin, un nombre négatif).
 * @param {string} opts.usage - le texte imprimé par `--help` et sur refus.
 * @param {string} [opts.avertissement] - ce que le banc dépense, dit à qui se
 *   trompe : c'est la phrase qui fait relire la commande plutôt que la relancer.
 * @returns {void} ou ne rend jamais la main.
 */
export const garderDrapeaux = ({
  args,
  connus,
  aValeur = [],
  usage,
  avertissement = "Rien n'a été lancé.",
}) => {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage);
    process.exit(0);
  }
  const blanche = new Set([...connus, "--help", "-h"]);
  const inconnus = args.filter(
    (a, i) =>
      a.startsWith("-") &&
      !blanche.has(a) &&
      // `--task=18` autant que `--task 18` : le nom est ce qui précède le `=`.
      !blanche.has(a.split("=")[0]) &&
      // Une VALEUR négative, ou un chemin qui suit un drapeau à valeur, n'est
      // pas un drapeau : on ne juge que ce qui COMMENCE un argument.
      !(i > 0 && aValeur.includes(args[i - 1])),
  );
  if (inconnus.length > 0) {
    console.error(
      `Drapeau inconnu : ${inconnus.join(", ")}\n\n${usage}\n\n${avertissement}`,
    );
    process.exit(64);
  }
};
