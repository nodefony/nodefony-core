/**
 * Le presse-papiers du plein écran (#537) : où envoyer le texte sélectionné
 * à la souris, et comment le dire honnêtement.
 *
 * La route se choisit sur le CONTEXTE, pas sur une liste fixe :
 * - **session distante** (`SSH_CONNECTION`, `SSH_TTY`, `SSH_CLIENT`) : un
 *   `pbcopy` ou un `xclip` copierait sur la machine DISTANTE, sans erreur —
 *   seule la séquence OSC 52, que le terminal LOCAL interprète, atteint le
 *   bon presse-papiers ;
 * - **tmux** (`TMUX`) : `tmux load-buffer -w -` remplit le tampon de tmux, qui
 *   relaie au terminal quand `set-clipboard` le permet ;
 * - **poste** : `pbcopy`, `wl-copy` (Wayland), `xclip` / `xsel` (X11),
 *   `powershell.exe Set-Clipboard` (Windows, et WSL) — jamais `clip.exe`, qui
 *   casse l'Unicode — puis OSC 52 en dernier recours.
 *
 * Chaque outil est ESSAYÉ : sa présence se constate à l'exécution (absent,
 * code non nul, délai dépassé ⇒ le suivant). « Copié » n'est dit que sur le
 * code 0 d'un outil ; une séquence OSC 52 n'a aucun accusé de réception (VTE
 * l'ignore, iTerm2 et xterm la bloquent par défaut) : elle est dite
 * « envoyée au terminal — non confirmée ».
 */
import { spawn as nodeSpawn } from "node:child_process";

/** Une manière de copier : un outil du système, ou la séquence OSC 52. */
export type ClipboardRoute =
  | {
      readonly kind: "command";
      /** Le nom montré dans la barre. */
      readonly label: string;
      readonly command: string;
      readonly args: readonly string[];
      /**
       * Les arguments qui écrivent AUSSI la sélection primaire (X11, Wayland)
       * — le collage au clic du milieu des autres applications. Best effort.
       */
      readonly primaryArgs?: readonly string[];
    }
  | { readonly kind: "osc52" };

/** Ce qu'a donné une copie. */
export type CopyOutcome =
  | { readonly status: "copied"; readonly via: string }
  | { readonly status: "sent" }
  | { readonly status: "too-long" }
  | { readonly status: "failed" };

/** Un processus fils, vu par l'exécuteur — injectable en test. */
export interface IClipboardChild {
  readonly stdin: {
    end(chunk: string): unknown;
    on(event: "error", listener: (error: Error) => void): unknown;
  } | null;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
  kill(): unknown;
}

/** Lance un outil — `child_process.spawn` par défaut. */
export type ClipboardSpawn = (
  command: string,
  args: readonly string[],
) => IClipboardChild;

/** Ce dont l'exécuteur a besoin. */
export interface IClipboardDeps {
  /** Écrit une séquence sur le terminal du développeur (sa sortie standard). */
  writeTerminal: (sequence: string) => void;
  spawn?: ClipboardSpawn;
  /** Délai au-delà duquel un outil est abandonné (défaut 2 s). */
  timeoutMs?: number;
}

/** Délai d'un outil de presse-papiers : au-delà, le suivant. */
const TOOL_TIMEOUT_MS = 2000;

/**
 * Plafond d'une séquence OSC 52, en octets base64 : au-delà, des terminaux
 * la tronquent ou la refusent, et GNU screen l'affiche en clair.
 */
export const OSC52_MAX_BYTES = 100 * 1024;

/** PowerShell lit son entrée en UTF-8 avant de la confier au presse-papiers. */
const POWERSHELL_SCRIPT =
  "[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())";

/**
 * Les routes à essayer, dans l'ordre, pour un environnement donné.
 *
 * @param env - l'environnement du superviseur.
 * @returns les routes, de la plus sûre à la dernière chance.
 */
export function chooseClipboardRoutes(
  env: Readonly<Record<string, string | undefined>>,
): ClipboardRoute[] {
  const routes: ClipboardRoute[] = [];
  if (env.TMUX) {
    routes.push({
      kind: "command",
      label: "tampon tmux",
      command: "tmux",
      args: ["load-buffer", "-w", "-"],
    });
  }
  if (env.SSH_CONNECTION || env.SSH_TTY || env.SSH_CLIENT) {
    routes.push({ kind: "osc52" });
    return routes;
  }
  routes.push({
    kind: "command",
    label: "pbcopy",
    command: "pbcopy",
    args: [],
  });
  if (env.WAYLAND_DISPLAY) {
    routes.push({
      kind: "command",
      label: "wl-copy",
      command: "wl-copy",
      args: [],
      primaryArgs: ["--primary"],
    });
  }
  if (env.DISPLAY) {
    routes.push(
      {
        kind: "command",
        label: "xclip",
        command: "xclip",
        args: ["-selection", "clipboard"],
        primaryArgs: ["-selection", "primary"],
      },
      {
        kind: "command",
        label: "xsel",
        command: "xsel",
        args: ["--clipboard", "--input"],
        primaryArgs: ["--primary", "--input"],
      },
    );
  }
  routes.push(
    {
      kind: "command",
      label: "PowerShell",
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", POWERSHELL_SCRIPT],
    },
    { kind: "osc52" },
  );
  return routes;
}

/**
 * La séquence OSC 52 qui confie un texte au presse-papiers du terminal.
 *
 * @param text - le texte, encodé en UTF-8 AVANT base64.
 * @returns la séquence, ou `null` au-delà de {@link OSC52_MAX_BYTES}.
 */
export function osc52Sequence(text: string): string | null {
  const payload = Buffer.from(text, "utf8").toString("base64");
  return payload.length > OSC52_MAX_BYTES ? null : `\x1b]52;c;${payload}\x07`;
}

/** Le `spawn` du système, sans fenêtre sous Windows, sortie ignorée. */
const defaultSpawn: ClipboardSpawn = (command, args) =>
  nodeSpawn(command, [...args], {
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true,
  });

/**
 * Confie un texte à un outil : vrai sur le code 0, faux sur absence, échec
 * ou délai dépassé (l'outil est alors tué).
 */
function runTool(
  spawn: ClipboardSpawn,
  command: string,
  args: readonly string[],
  text: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let child: IClipboardChild;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      done(false);
      child.kill();
    }, timeoutMs);
    try {
      child = spawn(command, args);
    } catch {
      done(false);
      return;
    }
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
    // Un outil qui meurt avant d'avoir lu : EPIPE sur son entrée, pas une exception.
    child.stdin?.on("error", () => {});
    child.stdin?.end(text);
  });
}

/**
 * Copie un texte en essayant les routes dans l'ordre.
 *
 * @param text - le texte sélectionné.
 * @param routes - cf {@link chooseClipboardRoutes}.
 * @param deps - le terminal, et l'exécuteur à injecter en test.
 * @returns le premier succès, ou ce qui a empêché la copie.
 */
export async function copyToClipboard(
  text: string,
  routes: readonly ClipboardRoute[],
  deps: IClipboardDeps,
): Promise<CopyOutcome> {
  const spawn = deps.spawn ?? defaultSpawn;
  const timeoutMs = deps.timeoutMs ?? TOOL_TIMEOUT_MS;
  let tooLong = false;
  for (const route of routes) {
    if (route.kind === "osc52") {
      const sequence = osc52Sequence(text);
      if (sequence === null) {
        tooLong = true;
        continue;
      }
      deps.writeTerminal(sequence);
      return { status: "sent" };
    }
    if (await runTool(spawn, route.command, route.args, text, timeoutMs)) {
      if (route.primaryArgs) {
        void runTool(spawn, route.command, route.primaryArgs, text, timeoutMs);
      }
      return { status: "copied", via: route.label };
    }
  }
  return tooLong ? { status: "too-long" } : { status: "failed" };
}

/**
 * Le message de la barre pour une copie — jamais « copié » sans preuve.
 *
 * @param outcome - ce qu'a donné la copie.
 * @returns le message.
 */
export function describeCopy(outcome: CopyOutcome): string {
  switch (outcome.status) {
    case "copied":
      return `copié (${outcome.via})`;
    case "sent":
      return "envoyé au terminal (OSC 52) — non confirmé";
    case "too-long":
      return "trop long pour le terminal — rien copié";
    case "failed":
      return "copie impossible — aucun presse-papiers trouvé";
  }
}
