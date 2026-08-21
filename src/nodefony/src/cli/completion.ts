import { writeFile, rename } from "node:fs/promises";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  writeSync,
  rmSync,
  readdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { SysExit } from "./sysexits";
import type { Command as CommanderCommand } from "commander";

/**
 * Complétion shell du CLI Nodefony (`nodefony completion <shell>` + requête
 * `nodefony __complete -- <mots>`).
 *
 * Contrainte d'archi : les commandes de MODULE ne sont connues qu'après le chargement
 * du manifeste `config.modules` (`onPreRegister`) — booter le kernel à chaque TAB est
 * exclu (secondes). Solution : un **manifest cache** (`node_modules/.cache/nodefony/
 * cli-manifest.json`) écrit à chaque boot DEV (commandes built-in + modules, extraites
 * de commander), lu par le fast-path standalone `__complete` en millisecondes. Hors
 * projet / manifest absent → fallback built-ins (fourni par l'appelant, sans boot).
 *
 * Pur outillage process (même famille que status/stop) : AUCUN boot kernel côté
 * requête ; `__complete` sort TOUJOURS en `EX_OK` (une complétion qui échoue doit
 * rendre une liste vide, jamais polluer le TAB du shell).
 */

/** Une commande du manifest de complétion. */
export interface ICliManifestCommand {
  name: string;
  aliases: string[];
  description: string;
  /** Flags candidats (`-w`, `--workers`, …) — sans leurs placeholders `<arg>`. */
  options: string[];
  /**
   * Choix des arguments POSITIONNELS, par position (`args[0]` = 1er argument).
   * Rempli depuis les `.choices()` déclarés à commander (ex. `create <type>` →
   * `[["app"]]`) ; `[]` = argument libre (rien à proposer). Absent sur les
   * manifests cache antérieurs → traité comme libre (compat lecture).
   */
  args?: string[][];
}

/** Manifest de complétion (cache par projet). */
export interface ICliManifest {
  version: string;
  /** Flags globaux du programme (`-d`, `--debug`, …). */
  globalOptions: string[];
  commands: ICliManifestCommand[];
}

/** Chemin du manifest cache — même dossier que le pidfile superviseur. */
export function cliManifestFile(cwd: string): string {
  return path.join(
    cwd,
    "node_modules",
    ".cache",
    "nodefony",
    "cli-manifest.json",
  );
}

/** Extrait les flags candidats d'une chaîne commander (`"-w, --workers <number>"`). */
export function extractFlags(flags: string): string[] {
  return flags.split(/[\s,]+/).filter((t) => t.startsWith("-") && t !== "--");
}

/**
 * Construit le manifest depuis l'état COURANT de commander — appelé après que les
 * modules ont posé leurs commandes (`onPreRegister`) pour un manifest complet, ou
 * avec les seuls built-ins pour le fallback sans boot.
 */
export function buildCliManifest(
  commander: CommanderCommand,
  version: string,
): ICliManifest {
  const commands: ICliManifestCommand[] = [];
  for (const cmd of commander.commands) {
    const name = cmd.name();
    // `__complete` (si jamais enregistrée) et les commandes cachées n'ont rien à
    // faire dans la complétion utilisateur.
    if (name.startsWith("__")) continue;
    commands.push({
      name,
      aliases: cmd.aliases?.() ?? [],
      description: cmd.description(),
      options: (cmd.options ?? []).flatMap((o) => extractFlags(o.flags)),
      // `.choices()` d'un argument positionnel → candidats au TAB (vécu :
      // `nodefony create <TAB>` ne proposait jamais `app`).
      args: (cmd.registeredArguments ?? []).map((a) => a.argChoices ?? []),
    });
  }
  return {
    version,
    globalOptions: (commander.options ?? []).flatMap((o) =>
      extractFlags(o.flags),
    ),
    commands,
  };
}

/**
 * Écrit le manifest cache (mkdir -p + write async). Best-effort : l'appelant décide
 * du fire-and-forget — un échec (FS read-only, pas de node_modules) ne doit JAMAIS
 * impacter le boot.
 */
export async function writeCliManifest(
  commander: CommanderCommand,
  cwd: string,
  version: string,
): Promise<void> {
  const file = cliManifestFile(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  const manifest = buildCliManifest(commander, version);
  // 🔴 **Écriture ATOMIQUE — le seul mode correct pour un cache.** Un
  // `writeFile` direct OUVRE et TRONQUE le fichier avant d'écrire : appelé en
  // fire-and-forget (c'est le contrat, pour ne rien coûter au boot), il laisse
  // un fichier de **0 octet** dès que le process sort avant la fin de
  // l'écriture — le cas NOMINAL d'une commande CLI courte. Constaté : après un
  // `nodefony inspect`, le manifest tombait à 0 octet, et chaque commande
  // détruisait ainsi le cache que la précédente avait écrit. Conséquences
  // visibles très loin d'ici : le menu perdait toutes les commandes de module,
  // et la complétion proposait des noms de commandes au lieu des options.
  //
  // Un fichier vide est PIRE qu'un fichier absent : il écrase une donnée
  // valide. Passer par un temporaire puis `rename` (atomique sur le même
  // volume) rend l'échec inoffensif — un process tué laisse l'ancien manifest
  // INTACT. Le `pid` dans le nom évite que deux boots concurrents se marchent
  // dessus.
  // Balayage des temporaires ORPHELINS avant d'en créer un.
  //
  // Le `catch` plus bas ne couvre que l'échec d'écriture ; le cas NOMINAL n'y
  // passe jamais. L'appel est fire-and-forget (contrat : ne rien coûter au
  // boot), donc le process sort volontiers PENDANT le `writeFile` — le fichier
  // vide existe déjà, et aucun `catch` ne tournera jamais pour lui. Constaté
  // sur un vrai dossier de cache : deux résidus de 0 octet, un par commande
  // interrompue. Inoffensifs (ils ne sont jamais LUS), mais ils s'accumulent
  // dans le `node_modules` de chaque utilisateur.
  //
  // Le PID du nom sert ici une seconde fois : il dit si le propriétaire vit
  // encore. On n'efface QUE les morts — arracher le temporaire d'un process
  // vivant lui volerait son écriture en cours.
  nettoyerTemporairesOrphelins(file);

  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(manifest, null, 1), "utf8");
    await rename(tmp, file);
  } catch (e) {
    // Best-effort de bout en bout : on ne laisse pas de résidu, et on ne
    // remonte rien (l'appelant est fire-and-forget par contrat).
    try {
      rmSync(tmp, { force: true });
    } catch {
      // Le temporaire survivra ; il ne sera jamais LU (nom distinct).
    }
    throw e;
  }
}

/**
 * Efface les temporaires d'écriture dont le process propriétaire est mort.
 *
 * Best-effort de bout en bout : un dossier illisible, un fichier déjà repris
 * par quelqu'un d'autre, une permission refusée — rien de tout cela ne doit
 * empêcher d'écrire le manifest, qui est le vrai travail.
 *
 * @param file - chemin du manifest ; ses temporaires en dérivent
 */
function nettoyerTemporairesOrphelins(file: string): void {
  try {
    const dossier = path.dirname(file);
    const base = `${path.basename(file)}.`;
    for (const entree of readdirSync(dossier)) {
      if (!entree.startsWith(base) || !entree.endsWith(".tmp")) continue;
      const pid = Number.parseInt(
        entree.slice(base.length, -".tmp".length),
        10,
      );
      if (!Number.isInteger(pid) || pid <= 0) continue;
      if (pid === process.pid) continue;
      try {
        // Signal 0 : ne tue rien, demande seulement si le process existe.
        process.kill(pid, 0);
        continue; // vivant — son temporaire lui appartient
      } catch {
        // Mort (ESRCH) — ou hors de notre portée (EPERM), auquel cas il vit et
        // `rmSync` échouera sans conséquence.
      }
      rmSync(path.join(dossier, entree), { force: true });
    }
  } catch {
    // Le balayage est un confort : son échec ne doit jamais coûter le manifest.
  }
}

/** Lit le manifest cache — `null` si absent ou corrompu (jamais de throw). */
export function readCliManifest(cwd: string): ICliManifest | null {
  try {
    const raw = readFileSync(cliManifestFile(cwd), "utf8");
    const parsed = JSON.parse(raw) as ICliManifest;
    return Array.isArray(parsed.commands) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Calcule les candidats de complétion pour les mots tapés.
 *
 * Protocole : `words` = tous les mots APRÈS le nom du binaire, dernier mot inclus
 * même vide (les scripts shell le transmettent tel quel). Le DERNIER mot est celui
 * en cours de frappe → la sélection de commande ne regarde que les mots VALIDÉS
 * (`slice(0, -1)`), et le shell filtre les candidats par le préfixe courant.
 *
 * - commande déjà validée → les CHOIX de l'argument positionnel en cours (s'il
 *   en déclare, ex. `create` → `app`) + ses options + les options globales ;
 * - sinon → noms + alias de toutes les commandes.
 */
export function computeCompletions(
  manifest: ICliManifest,
  words: string[],
): string[] {
  const validated = words.slice(0, -1);
  for (let i = 0; i < validated.length; i++) {
    const w = validated[i];
    if (w.startsWith("-")) continue;
    const cmd = manifest.commands.find(
      (c) => c.name === w || c.aliases.includes(w),
    );
    if (cmd) {
      // Position de l'argument en cours de frappe = mots validés APRÈS la
      // commande, hors flags et hors valeur d'option (heuristique : un mot
      // qui suit immédiatement un flag est sa valeur — `--preset minimal`).
      const after = validated.slice(i + 1);
      let pos = 0;
      for (let j = 0; j < after.length; j++) {
        if (after[j].startsWith("-")) continue;
        if (j > 0 && after[j - 1].startsWith("-")) continue;
        pos++;
      }
      const choices = cmd.args?.[pos] ?? [];
      return [...choices, ...cmd.options, ...manifest.globalOptions];
    }
  }
  return manifest.commands.flatMap((c) => [c.name, ...c.aliases]);
}

/** Shells supportés par `nodefony completion <shell>`. */
export const COMPLETION_SHELLS = ["bash", "zsh", "fish"] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

/**
 * Rend le script de complétion à sourcer pour un shell. Le script est STABLE (il
 * délègue tout au binaire via `__complete`) : les commandes de module apparaissent
 * sans jamais regénérer le script — seule la donnée (manifest cache) bouge.
 */
export function renderCompletionScript(shell: CompletionShell): string {
  // Résolution du binaire AU TAB (pas au source du script) : priorité au binaire DU
  // PROJET (`./node_modules/.bin` — sa complétion suit la version + le manifest local),
  // puis global, puis `npx --no-install` en dernier recours (plus lent, mais la
  // complétion marche même sans PATH). NB : `npx nodefony <TAB>` lui-même complète
  // via npx (structurel) — la complétion s'attache au MOT `nodefony`.
  switch (shell) {
    case "zsh":
      return `#compdef nodefony
# Complétion zsh Nodefony — installation :
#   nodefony completion zsh > "\${fpath[1]}/_nodefony"   (puis: exec zsh)
# ou directe dans ~/.zshrc :
#   source <(nodefony completion zsh)
# ⚠️ La complétion s'applique au MOT \`nodefony\` en 1ʳᵉ position — PAS à
# \`npx nodefony\` (le shell complète alors npx). Pour un usage projet :
#   export PATH="$PWD/node_modules/.bin:$PATH"
# Le système de complétion doit être chargé (compdef) — auto-init sinon.
if ! whence compdef >/dev/null 2>&1; then
  autoload -Uz compinit && compinit
fi
_nodefony_bin() {
  if [ -x ./node_modules/.bin/nodefony ]; then
    echo ./node_modules/.bin/nodefony
  elif command -v nodefony >/dev/null 2>&1; then
    echo nodefony
  else
    echo npx --no-install nodefony
  fi
}
_nodefony() {
  local -a candidates
  # \${words[@]:1} : tous les mots APRÈS le nom du binaire, mot en frappe inclus
  # (offset d'expansion 0-based — :1 saute uniquement "nodefony").
  candidates=("\${(@f)$(\${=$(_nodefony_bin)} __complete -- "\${words[@]:1}" 2>/dev/null)}")
  (( \${#candidates} )) && compadd -a candidates
}
compdef _nodefony nodefony
`;
    case "bash":
      return `# Complétion bash Nodefony — installation :
#   nodefony completion bash > /etc/bash_completion.d/nodefony
# ou directe dans ~/.bashrc :
#   source <(nodefony completion bash)
# ⚠️ S'applique au MOT \`nodefony\` en 1ʳᵉ position — PAS à \`npx nodefony\`.
# Usage projet : export PATH="$PWD/node_modules/.bin:$PATH"
_nodefony_bin() {
  if [ -x ./node_modules/.bin/nodefony ]; then
    echo ./node_modules/.bin/nodefony
  elif command -v nodefony >/dev/null 2>&1; then
    echo nodefony
  else
    echo npx --no-install nodefony
  fi
}
_nodefony_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local candidates
  candidates="$($(_nodefony_bin) __complete -- "\${COMP_WORDS[@]:1}" 2>/dev/null)"
  COMPREPLY=($(compgen -W "$candidates" -- "$cur"))
}
complete -F _nodefony_completions nodefony
`;
    case "fish":
      return `# Complétion fish Nodefony — installation :
#   nodefony completion fish > ~/.config/fish/completions/nodefony.fish
function __nodefony_bin
  if test -x ./node_modules/.bin/nodefony
    echo ./node_modules/.bin/nodefony
  else if command -sq nodefony
    echo nodefony
  else
    echo npx --no-install nodefony
  end
end
complete -c nodefony -f -a "(eval (__nodefony_bin) __complete -- (commandline -opc)[2..-1] 2>/dev/null)"
`;
  }
}

/** Détecte le shell courant depuis `$SHELL` (fallback interactif du sous-commande nu). */
export function detectShell(): CompletionShell | null {
  const sh = path.basename(process.env.SHELL ?? "");
  return (COMPLETION_SHELLS as readonly string[]).includes(sh)
    ? (sh as CompletionShell)
    : null;
}

// ─── Installation (`completion install` / `uninstall`) ──────────────────────────
// Pattern `conda init` : le script vit dans un fichier stable (`~/.config/nodefony/`)
// et le rc ne porte qu'un BLOC MARQUÉ de 3 lignes qui le source — idempotent (re-run
// = remplacement du bloc, jamais de duplication), réversible (`uninstall`). fish n'a
// pas besoin de rc : son dossier `completions/` autocharge (mécanisme natif).

const BLOCK_BEGIN = "# >>> nodefony completion >>>";
const BLOCK_END = "# <<< nodefony completion <<<";

/** Cibles d'installation d'un shell : fichier script + rc à marquer (`null` = aucun). */
export function completionInstallTargets(
  shell: CompletionShell,
  home: string,
): { scriptFile: string; rcFile: string | null } {
  switch (shell) {
    case "zsh":
      return {
        scriptFile: path.join(home, ".config", "nodefony", "completion.zsh"),
        rcFile: path.join(home, ".zshrc"),
      };
    case "bash":
      return {
        scriptFile: path.join(home, ".config", "nodefony", "completion.bash"),
        rcFile: path.join(home, ".bashrc"),
      };
    case "fish":
      return {
        scriptFile: path.join(
          home,
          ".config",
          "fish",
          "completions",
          "nodefony.fish",
        ),
        rcFile: null,
      };
  }
}

/** Retire le bloc marqué (avec ses marqueurs) d'un contenu rc — no-op si absent. */
export function removeBlock(content: string): string {
  const begin = content.indexOf(BLOCK_BEGIN);
  if (begin < 0) return content;
  const end = content.indexOf(BLOCK_END, begin);
  if (end < 0) return content; // marqueur ouvrant orphelin — ne pas charcuter le rc
  const after = end + BLOCK_END.length;
  // Bords normalisés (\n multiples absorbés) → remove(upsert(x)) est stable et
  // upsert reste idempotent au CARACTÈRE près (pas d'accumulation de lignes vides).
  const head = content.slice(0, begin).replace(/\n+$/, "");
  const tail = content.slice(after).replace(/^\n+/, "");
  if (head.length === 0) return tail;
  return tail.length > 0 ? `${head}\n${tail}` : `${head}\n`;
}

/** Insère (ou remplace) le bloc marqué sourçant `scriptFile` — idempotent. */
export function upsertBlock(content: string, scriptFile: string): string {
  const cleaned = removeBlock(content).replace(/\n+$/, "");
  const block = `${BLOCK_BEGIN}\n[ -f "${scriptFile}" ] && source "${scriptFile}"\n${BLOCK_END}\n`;
  return cleaned.length > 0 ? `${cleaned}\n\n${block}` : block;
}

/**
 * Installe la complétion pour un shell : écrit le script (mkdir -p) et, si le shell
 * en a besoin, upsert le bloc marqué dans son rc (créé s'il n'existe pas).
 *
 * @returns les chemins touchés (pour le rapport utilisateur).
 */
export function installCompletion(
  shell: CompletionShell,
  home: string,
): { scriptFile: string; rcFile: string | null } {
  const targets = completionInstallTargets(shell, home);
  mkdirSync(path.dirname(targets.scriptFile), { recursive: true });
  writeFileSync(targets.scriptFile, renderCompletionScript(shell), "utf8");
  if (targets.rcFile) {
    let rc = "";
    try {
      rc = readFileSync(targets.rcFile, "utf8");
    } catch {
      /* rc inexistant → créé */
    }
    writeFileSync(targets.rcFile, upsertBlock(rc, targets.scriptFile), "utf8");
  }
  return targets;
}

/** Désinstalle : retire le bloc du rc et supprime le fichier script. */
export function uninstallCompletion(
  shell: CompletionShell,
  home: string,
): { scriptFile: string; rcFile: string | null } {
  const targets = completionInstallTargets(shell, home);
  rmSync(targets.scriptFile, { force: true });
  if (targets.rcFile) {
    try {
      const rc = readFileSync(targets.rcFile, "utf8");
      writeFileSync(targets.rcFile, removeBlock(rc), "utf8");
    } catch {
      /* rc absent — rien à retirer */
    }
  }
  return targets;
}

/** Consigne de rechargement par shell (affichée après install). */
function reloadHint(shell: CompletionShell): string {
  if (shell === "fish") return "ouvre un nouveau shell fish";
  return `exec ${shell}`;
}

/**
 * Fast-path `nodefony completion [install|uninstall] [shell]` — imprime le script,
 * ou l'installe/désinstalle dans le rc du shell (bloc marqué idempotent).
 *
 * @returns exit code (`EX_OK`, ou `EX_USAGE` si shell inconnu et indétectable).
 */
export function runCompletionCommand(argv: string[]): number {
  const positionals = argv.slice(2).filter((a) => !a.startsWith("-"));
  // positionals[0] = "completion" ; ensuite [action] [shell] ou [shell].
  const action =
    positionals[1] === "install" || positionals[1] === "uninstall"
      ? positionals[1]
      : null;
  const arg = positionals[action ? 2 : 1];
  const shell =
    arg && (COMPLETION_SHELLS as readonly string[]).includes(arg)
      ? (arg as CompletionShell)
      : detectShell();
  if (
    !shell ||
    (arg && !(COMPLETION_SHELLS as readonly string[]).includes(arg))
  ) {
    writeSync(
      2,
      `usage: nodefony completion [install|uninstall] <${COMPLETION_SHELLS.join("|")}>\n`,
    );
    return SysExit.USAGE;
  }
  const home = os.homedir();
  if (action === "install") {
    const { scriptFile, rcFile } = installCompletion(shell, home);
    writeSync(1, `✓ script  : ${scriptFile}\n`);
    if (rcFile) {
      writeSync(
        1,
        `✓ rc      : ${rcFile} (bloc « nodefony completion », idempotent)\n`,
      );
    }
    writeSync(
      1,
      `→ recharge : ${reloadHint(shell)}\n` +
        `→ retirer  : nodefony completion uninstall ${shell}\n` +
        `⚠️ complète \`nodefony …\` (pas \`npx nodefony\`) — usage projet :\n` +
        `   export PATH="$PWD/node_modules/.bin:$PATH"\n`,
    );
    return SysExit.OK;
  }
  if (action === "uninstall") {
    const { scriptFile, rcFile } = uninstallCompletion(shell, home);
    writeSync(1, `✓ retiré : ${scriptFile}\n`);
    if (rcFile) {
      writeSync(1, `✓ rc     : ${rcFile} (bloc retiré)\n`);
    }
    return SysExit.OK;
  }
  writeSync(1, renderCompletionScript(shell));
  return SysExit.OK;
}

/**
 * Fusionne les commandes du **code courant** (built-ins, construits en mémoire) avec
 * celles que seul le manifest cache connaît (les commandes de MODULE, posées à
 * `onPreRegister` — impossible de les lister sans booter).
 *
 * Pourquoi cette asymétrie : le cache est écrit au boot dev et n'est jamais invalidé
 * (sa clé est la version du paquet, identique d'un build à l'autre en développement).
 * S'il faisait autorité sur les built-ins, la complétion resterait figée sur l'état du
 * dernier boot — un `create` enrichi d'un nouveau type ne le proposerait jamais (vécu).
 * Le binaire, lui, est toujours à jour par construction : il EST le code courant.
 *
 * Un module retiré peut donc survivre dans la liste jusqu'au prochain boot dev — un
 * candidat en trop au TAB, sans conséquence, corrigé au boot suivant.
 */
export function mergeManifests(
  builtins: ICliManifest,
  cached: ICliManifest | null,
): ICliManifest {
  if (!cached) return builtins;
  const known = new Set<string>();
  for (const c of builtins.commands) {
    known.add(c.name);
    for (const a of c.aliases) known.add(a);
  }
  const moduleCommands = cached.commands.filter((c) => !known.has(c.name));
  return {
    ...builtins,
    commands: [...builtins.commands, ...moduleCommands],
  };
}

/**
 * Fast-path `nodefony __complete -- <mots>` — imprime un candidat par ligne.
 *
 * Source : built-ins du binaire courant (`builtins`, construits en mémoire par le
 * CliKernel, sans boot) + commandes de module lues dans le manifest cache. Sort
 * TOUJOURS `EX_OK` : le pire résultat d'une complétion est une liste vide, jamais une
 * erreur dans le TAB.
 */
export function runCompleteQuery(
  argv: string[],
  builtins: () => ICliManifest,
): number {
  try {
    const sep = argv.indexOf("--");
    const words = sep >= 0 ? argv.slice(sep + 1) : [];
    const manifest = mergeManifests(builtins(), readCliManifest(process.cwd()));
    const candidates = computeCompletions(manifest, words);
    if (candidates.length > 0) {
      writeSync(1, candidates.join("\n") + "\n");
    }
  } catch {
    /* liste vide — jamais d'erreur dans le TAB */
  }
  return SysExit.OK;
}
