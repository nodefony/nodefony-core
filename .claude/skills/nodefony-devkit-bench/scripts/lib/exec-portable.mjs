/**
 * Lancer un exécutable de l'écosystème npm, sur les trois systèmes.
 *
 * ## Le défaut, et pourquoi il ne se voit qu'en CI
 *
 * Sous Windows, `npm`, `npx`, `prettier` et compagnie ne sont pas des
 * exécutables : ce sont des scripts `.cmd`. Depuis le correctif de
 * CVE-2024-27980, Node REFUSE d'exécuter un `.cmd` sans `shell: true` — et il
 * ne le dit pas en ces termes : il rend `spawnSync npm ENOENT`, qui se lit
 * « npm n'est pas installé ». Sur un runner où npm vient de faire tourner
 * `npm ci`, c'est un message qui envoie chercher très loin de la cause.
 *
 * Constaté au premier passage Windows du banc du code généré : linux ×2 et
 * macOS verts, Windows rouge à la première étape, sur le décor. Aucune machine
 * de développement du projet ne pouvait le montrer.
 *
 * ## Une seule implémentation
 *
 * Deux helpers d'exécution portaient la règle séparément (`sh` dans
 * `isolation.mjs`, `run` dans `verify-generated.mjs`). Deux copies d'une règle
 * de portabilité divergent en silence — chacune passe ses propres contrôles, et
 * la seconde se découvre un an plus tard sur le même message trompeur.
 *
 * ## Ce que ce fichier ne couvre PAS
 *
 * `bench-schema.mjs` et `bench-discoverability.mjs` ont leurs propres helpers et
 * lancent de vrais agents : ils ne tournent pas en intégration continue, donc
 * rien ne les éprouve sous Windows. Le défaut y est présent ; il est nommé ici
 * plutôt que corrigé à l'aveugle.
 */
import path from "node:path";

/**
 * Faut-il passer par le shell pour lancer cette commande ?
 *
 * Vrai sous Windows dans DEUX cas, et la première version n'en voyait qu'un :
 *
 *  1. la commande est cherchée dans le `PATH` (`npm`, `npx`) — elle s'y résout
 *    en `.cmd` ;
 *  2. la commande est un chemin ABSOLU qui désigne un script batch
 *    (`…\node_modules\.bin\oxlint.cmd`).
 *
 * « Absolu donc exécutable réel » était une inférence, pas un constat : ce qui
 * empêche Node de lancer la chose n'est pas l'endroit où elle est, c'est ce
 * qu'elle EST. Le passage Windows suivant l'a montré aussitôt — le décor se
 * montait, six étapes passaient, et le lint tombait sur `code null` en visant un
 * `oxlint.cmd` parfaitement absolu.
 *
 * Ailleurs que sous Windows, `shell: true` est à éviter : il rouvre
 * l'interprétation des métacaractères sur des arguments qui viennent parfois
 * d'un décor.
 *
 * La plateforme et la grammaire de chemins sont INJECTÉES, et ce n'est pas de
 * la coquetterie : une fonction qui lit `process.platform` ne peut être
 * éprouvée que sur la plateforme qu'elle décrit — c'est-à-dire jamais, sur les
 * postes de ce projet. Injectées, les deux branches se vérifient partout, et
 * l'auto-contrôle qui les exerce tourne dans la passe de tout le monde.
 *
 * @param {string} commande - ce qu'on s'apprête à lancer.
 * @param {NodeJS.Platform} [plateforme] - le système, injectable pour l'épreuve.
 * @param {typeof path} [grammaire] - `path.win32` ou `path.posix`, idem.
 * @returns {boolean} la valeur à donner à l'option `shell`.
 */
export function besoinDeShell(
  commande,
  plateforme = process.platform,
  grammaire = path,
) {
  if (plateforme !== "win32") return false;
  return !grammaire.isAbsolute(commande) || /\.(cmd|bat)$/i.test(commande);
}
