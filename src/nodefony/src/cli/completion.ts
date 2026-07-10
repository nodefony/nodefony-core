import { writeFile } from "node:fs/promises";
import { mkdirSync, readFileSync, writeSync } from "node:fs";
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
  await writeFile(file, JSON.stringify(manifest, null, 1), "utf8");
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
 * - commande déjà validée → ses options + les options globales ;
 * - sinon → noms + alias de toutes les commandes.
 */
export function computeCompletions(
  manifest: ICliManifest,
  words: string[],
): string[] {
  const validated = words.slice(0, -1);
  for (const w of validated) {
    if (w.startsWith("-")) continue;
    const cmd = manifest.commands.find(
      (c) => c.name === w || c.aliases.includes(w),
    );
    if (cmd) {
      return [...cmd.options, ...manifest.globalOptions];
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

/**
 * Fast-path `nodefony completion [shell]` — imprime le script à sourcer.
 *
 * @returns exit code (`EX_OK`, ou `EX_USAGE` si shell inconnu et indétectable).
 */
export function runCompletionCommand(argv: string[]): number {
  const arg = argv
    .slice(2)
    .filter((a) => !a.startsWith("-"))
    .at(1); // [0] = "completion"
  const shell =
    arg && (COMPLETION_SHELLS as readonly string[]).includes(arg)
      ? (arg as CompletionShell)
      : detectShell();
  if (!shell) {
    writeSync(
      2,
      `usage: nodefony completion <${COMPLETION_SHELLS.join("|")}>\n`,
    );
    return SysExit.USAGE;
  }
  writeSync(1, renderCompletionScript(shell));
  return SysExit.OK;
}

/**
 * Fast-path `nodefony __complete -- <mots>` — imprime un candidat par ligne.
 *
 * Manifest cache absent (projet jamais booté, hors projet) → `fallback` (built-ins
 * construits en mémoire par le CliKernel, sans boot). Sort TOUJOURS `EX_OK` : le
 * pire résultat d'une complétion est une liste vide, jamais une erreur dans le TAB.
 */
export function runCompleteQuery(
  argv: string[],
  fallback: () => ICliManifest,
): number {
  try {
    const sep = argv.indexOf("--");
    const words = sep >= 0 ? argv.slice(sep + 1) : [];
    const manifest = readCliManifest(process.cwd()) ?? fallback();
    const candidates = computeCompletions(manifest, words);
    if (candidates.length > 0) {
      writeSync(1, candidates.join("\n") + "\n");
    }
  } catch {
    /* liste vide — jamais d'erreur dans le TAB */
  }
  return SysExit.OK;
}
