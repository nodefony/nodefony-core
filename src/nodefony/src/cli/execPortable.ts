import path from "node:path";

/**
 * Lancer un exécutable de l'écosystème npm, sur les trois systèmes.
 *
 * ## Le défaut, et pourquoi il ne se voit jamais sur un poste de développement
 *
 * Sous Windows, `npm`, `npx`, `prettier` et compagnie ne sont pas des exécutables :
 * ce sont des scripts `.cmd`. Depuis le correctif de CVE-2024-27980, Node REFUSE
 * d'exécuter un `.cmd` sans `shell: true` — et il ne le dit pas en ces termes : il
 * rend `spawnSync npm ENOENT`, qui se lit « npm n'est pas installé ». Sur une
 * machine où npm vient de tourner, c'est un message qui envoie chercher très loin
 * de la cause.
 *
 * Ce que cela coûtait EN PRODUIT, et pas seulement en outillage : `nodefony create
 * module` installe le workspace npm qu'il vient d'écrire — c'est ce `npm install`
 * qui crée le lien sans lequel le Kernel ne peut pas importer le module par son
 * nom. Sous Windows il ne s'exécutait pas ; le module était écrit, construit,
 * déclaré au manifeste — et introuvable au boot. L'application démarrait sans lui
 * (fail-soft) et TOUTES ses routes rendaient 404.
 *
 * ## Une seule implémentation, dans le FRAMEWORK
 *
 * La règle a d'abord été écrite dans le banc qui mesure le framework, jamais dans
 * le framework lui-même — si bien que l'outil de mesure était portable et que le
 * produit ne l'était pas. C'est l'utilisateur qui subit la règle : c'est donc ici
 * qu'elle vit, et le banc l'importe.
 */

/**
 * Faut-il passer par le shell pour lancer cette commande ?
 *
 * Vrai sous Windows dans DEUX cas, et une première version n'en voyait qu'un :
 *
 *  1. la commande est cherchée dans le `PATH` (`npm`, `npx`) — elle s'y résout en
 *     `.cmd` ;
 *  2. la commande est un chemin ABSOLU qui désigne un script batch
 *     (`…\node_modules\.bin\oxlint.cmd`).
 *
 * « Absolu donc exécutable réel » est une inférence, pas un constat : ce qui empêche
 * Node de lancer la chose n'est pas l'endroit où elle est, c'est ce qu'elle EST.
 *
 * Ailleurs que sous Windows, `shell: true` est à éviter : il rouvre l'interprétation
 * des métacaractères sur des arguments qui viennent parfois d'un décor.
 *
 * La plateforme et la grammaire de chemins sont INJECTÉES, et ce n'est pas de la
 * coquetterie : une fonction qui lit `process.platform` ne peut être éprouvée que
 * sur la plateforme qu'elle décrit — c'est-à-dire jamais, sur les postes de ce
 * projet. Injectées, les deux branches se vérifient partout.
 *
 * @param commande - ce qu'on s'apprête à lancer.
 * @param plateforme - le système, injectable pour l'épreuve.
 * @param grammaire - `path.win32` ou `path.posix`, idem.
 * @returns la valeur à donner à l'option `shell` de `spawn`/`spawnSync`.
 */
export function besoinDeShell(
  commande: string,
  plateforme: NodeJS.Platform = process.platform,
  grammaire: Pick<typeof path, "isAbsolute"> = path,
): boolean {
  if (plateforme !== "win32") return false;
  return !grammaire.isAbsolute(commande) || /\.(cmd|bat)$/iu.test(commande);
}
