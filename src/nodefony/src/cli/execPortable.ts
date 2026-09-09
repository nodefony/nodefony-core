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
 * @param command - ce qu'on s'apprête à lancer.
 * @param plateforme - le système, injectable pour l'épreuve.
 * @param grammar - `path.win32` ou `path.posix`, idem.
 * @returns la valeur à donner à l'option `shell` de `spawn`/`spawnSync`.
 */
export function needsShell(
  command: string,
  plateforme: NodeJS.Platform = process.platform,
  grammar: Pick<typeof path, "isAbsolute"> = path,
): boolean {
  if (plateforme !== "win32") return false;
  return !grammar.isAbsolute(command) || /\.(cmd|bat)$/iu.test(command);
}

/**
 * Ce qu'il faut donner à `spawn`/`spawnSync` pour lancer `command args…` sur
 * ce système — SANS jamais confier des arguments à un shell.
 *
 * ## Le défaut que `needsShell` seul a laissé passer
 *
 * `spawnSync("npm", ["install"], { shell: true })` est la forme que Node
 * déprécie (DEP0190, avertissement à l'exécution depuis Node 26) : les
 * arguments n'y sont pas échappés, seulement concaténés. Et Nodefony relaie
 * chaque avertissement du process dans son journal, avec sa pile — si bien que
 * sous Windows, chaque `npm …` lancé par `nodefony create app` imprimait une
 * stack trace dans le transcript d'une commande qui avait réussi. Constaté sur
 * l'intégration continue, jamais sur un poste de ce projet.
 *
 * ## Le geste
 *
 * Reproduire ce que Node fait lui-même derrière `shell: true` sous Windows —
 * `cmd.exe /d /s /c "<ligne>"`, ligne transmise VERBATIM — mais en le faisant
 * NOUS, avec les arguments quotés, et sans l'option `shell`. Ailleurs, la
 * commande se lance telle quelle. Un seul point de code pour les trois
 * systèmes ; l'appelant recopie les trois champs et n'a rien à décider.
 */
export interface IPortableSpawn {
  /** Le programme à lancer : la commande, ou `cmd.exe` quand elle est un script batch. */
  file: string;
  /** Ses arguments, prêts pour `spawn` — jamais à retoucher. */
  args: string[];
  /** À recopier dans les options de `spawn` : `cmd.exe` reçoit sa ligne verbatim. */
  windowsVerbatimArguments: boolean;
}

/**
 * Un argument tel que `cmd.exe` le transmettra intact au script batch.
 *
 * Les blancs et les métacaractères de `cmd.exe` exigent des guillemets ; un
 * guillemet ou un saut de ligne DANS l'argument n'a pas de forme sûre — on
 * refuse plutôt que de concaténer, ce qui est exactement le défaut fermé ici.
 */
function quoteForCmd(arg: string): string {
  // Les guillemets N'ARRÊTENT PAS l'expansion : `cmd.exe` remplace `%NOM%` par
  // la valeur de la variable au parsing de la ligne, y compris entre guillemets,
  // et par du vide si elle n'existe pas. Citer ne protège que des
  // métacaractères. `%%` n'échappe rien hors d'un fichier batch. Aucune forme
  // sûre n'existe donc pour `%NOM%` — on refuse, comme pour le guillemet, plutôt
  // que de laisser partir un argument qui n'est pas celui qu'on a écrit.
  // Un pour-cent ISOLÉ (« remise-20% ») ne déclenche rien : il reste accepté.
  if (/[\r\n"]/u.test(arg) || /%[^%\r\n]+%/u.test(arg)) {
    throw new Error(
      `[nodefony] argument impossible à transmettre à cmd.exe : ${JSON.stringify(arg)}`,
    );
  }
  return /[\s&|<>^()%!]/u.test(arg) || arg === "" ? `"${arg}"` : arg;
}

/**
 * Compose la commande portable — voir {@link IPortableSpawn}.
 *
 * La plateforme, la grammaire de chemins et l'interpréteur sont INJECTÉS pour
 * la même raison que dans {@link needsShell} : la branche Windows s'éprouve
 * depuis n'importe quel poste.
 *
 * @param command - ce qu'on s'apprête à lancer (`npm`, `npx`, un chemin).
 * @param args - ses arguments, un par élément.
 * @param platform - le système, injectable pour l'épreuve.
 * @param grammar - `path.win32` ou `path.posix`, idem.
 * @param comSpec - l'interpréteur Windows (`%ComSpec%`), idem.
 * @returns les trois champs à donner à `spawn`/`spawnSync`.
 */
export function portableSpawn(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  grammar: Pick<typeof path, "isAbsolute"> = path,
  comSpec: string | undefined = process.env.ComSpec,
): IPortableSpawn {
  if (!needsShell(command, platform, grammar)) {
    return { file: command, args: [...args], windowsVerbatimArguments: false };
  }
  const line = [command, ...args].map(quoteForCmd).join(" ");
  return {
    // Un `%ComSpec%` vide vaut absent : `cmd.exe` se résout par le PATH.
    file: comSpec || "cmd.exe",
    args: ["/d", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
  };
}
