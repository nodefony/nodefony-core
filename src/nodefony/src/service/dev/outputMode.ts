/**
 * Le rendu du démarrage — `human`, `plain` ou `json` — et la façon de le choisir.
 *
 * Module minuscule et sans dépendance : le noyau le lit dès le splash (avant
 * qu'une commande n'ait pris la main), le superviseur de développement et la
 * commande `development` aussi. Une seule règle, lue par les trois.
 */

/** Les trois rendus du bilan de démarrage. */
export type StartupOutputMode = "human" | "plain" | "json";

import type { IBootNotice } from "../../kernel/bootReport";

/** Valeurs admises, dans l'ordre où l'aide les cite. */
export const OUTPUT_MODES: readonly StartupOutputMode[] = [
  "human",
  "plain",
  "json",
];

/**
 * Variable posée par le superviseur de développement sur un serveur RELANCÉ
 * après une modification — jamais au premier lancement. Sa valeur est le
 * numéro du rechargement (`"1"`, `"2"`…) : le serveur y lit qu'il doit dire ce
 * qui a changé, et la ligne d'état en affiche le compte.
 */
export const DEV_RELOAD_ENV = "NF_DEV_RELOAD";

/**
 * Lit `--output <mode>` (ou `--output=<mode>`) sur la ligne de commande.
 *
 * Lu sur `argv` et non sur les options analysées : le rendu se décide avant
 * que Commander n'ait rendu la main — le splash s'affiche avant tout hook.
 *
 * @param argv - `process.argv` ou son équivalent de test.
 * @returns la valeur demandée, ou `undefined`.
 */
export function readOutputFlag(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] ?? "";
    if (word === "--output") return argv[i + 1] ?? "";
    if (word.startsWith("--output=")) return word.slice("--output=".length);
  }
  return undefined;
}

/**
 * Choisit le rendu, du plus explicite au constaté.
 *
 * `--output` l'emporte, puis `NF_OUTPUT`, puis la CAPACITÉ du terminal :
 * `stdout` relié à un terminal ⇒ `human`, sinon ⇒ `plain`. On ne devine jamais
 * « c'est une IA » : les variables qu'un agent pose ne sont pas une norme, un
 * agent peut avoir un pseudo-terminal, et un humain peut hériter de ces
 * variables. `TERM` ne dit rien non plus — il reste posé hors terminal.
 *
 * @param flag - valeur de `--output`, si elle a été donnée.
 * @param env - l'environnement, injecté.
 * @param isTerminal - `stdout` est-il un terminal (constaté par l'appelant) ?
 * @returns le rendu à produire.
 * @throws RangeError Quand `--output` ou `NF_OUTPUT` porte une valeur
 *   inconnue — une valeur acceptée puis ignorée apprendrait qu'elle a un sens.
 */
export function resolveOutputMode(
  flag: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  isTerminal: boolean,
): StartupOutputMode {
  for (const [source, value] of [
    ["--output", flag],
    ["NF_OUTPUT", env.NF_OUTPUT],
  ] as const) {
    if (value === undefined) continue;
    if ((OUTPUT_MODES as readonly string[]).includes(value)) {
      return value as StartupOutputMode;
    }
    throw new RangeError(
      `${source}=${value || "(vide)"} inconnu — valeurs admises : ${OUTPUT_MODES.join(", ")}`,
    );
  }
  return isTerminal ? "human" : "plain";
}

/**
 * `--debug` (ou `-d`) est-il demandé ? Lu sur `argv`, pour la même raison que
 * {@link readOutputFlag} : le noyau en dépend dès le splash, et le superviseur
 * ne passe jamais par Commander.
 *
 * @param argv - `process.argv` ou son équivalent de test.
 * @returns `true` si le journal complet est demandé.
 */
export function isDebugRequested(argv: readonly string[]): boolean {
  return argv.includes("-d") || argv.includes("--debug");
}

/** Ce que demande l'interrupteur du plein écran. */
export interface IDevUiRequest {
  /** Le plein écran est demandé (il reste soumis à la sonde du terminal). */
  fullscreen: boolean;
  /** Une valeur de `NF_DEV_UI` qui n'est ni `1` ni `0` — à nommer, pas à taire. */
  invalid: string | null;
}

/**
 * Le plein écran de `nodefony development` est-il demandé ? `--ui` /
 * `--no-ui` l'emportent sur `NF_DEV_UI` (`1` ou `0`). Sans demande : non —
 * le plein écran reste opt-in tant que sa preuve n'est pas faite sur les
 * trois plateformes (#537). Lu sur `argv`, comme {@link isDebugRequested} :
 * le superviseur ne passe jamais par Commander.
 *
 * @param argv - `process.argv` ou son équivalent de test.
 * @param env - l'environnement.
 * @returns la demande, et la valeur invalide s'il y en a une.
 */
export function readDevUiRequest(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): IDevUiRequest {
  const raw = env.NF_DEV_UI;
  const invalid =
    raw === undefined || raw === "" || raw === "0" || raw === "1" ? null : raw;
  if (argv.includes("--no-ui")) return { fullscreen: false, invalid };
  if (argv.includes("--ui")) return { fullscreen: true, invalid };
  return { fullscreen: raw === "1", invalid };
}

/** Ce que demande l'interrupteur de la souris en plein écran. */
export interface IDevMouseRequest {
  /** La capture de la souris est demandée (sélection dessinée par nous). */
  capture: boolean;
  /** Une valeur de `NF_DEV_MOUSE` qui n'est ni `1` ni `0` — à nommer, pas à taire. */
  invalid: string | null;
}

/**
 * La capture de la souris est-elle demandée en plein écran ? `--mouse` /
 * `--no-mouse` l'emportent sur `NF_DEV_MOUSE` (`1` ou `0`). Sans demande :
 * non — la souris reste au terminal (mode 1007 seul) tant que la capture
 * n'est pas prouvée dans les terminaux réels (#537). Lu sur `argv`, comme
 * {@link readDevUiRequest}.
 *
 * @param argv - `process.argv` ou son équivalent de test.
 * @param env - l'environnement.
 * @returns la demande, et la valeur invalide s'il y en a une.
 */
export function readDevMouseRequest(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): IDevMouseRequest {
  const raw = env.NF_DEV_MOUSE;
  const invalid =
    raw === undefined || raw === "" || raw === "0" || raw === "1" ? null : raw;
  if (argv.includes("--no-mouse")) return { capture: false, invalid };
  if (argv.includes("--mouse")) return { capture: true, invalid };
  return { capture: raw === "1", invalid };
}

/** Première version de Node dont la console Windows rapporte la souris en mode brut. */
const WINDOWS_MOUSE_NODE: readonly [number, number] = [24, 2];

/**
 * Pourquoi la capture de la souris est refusée sur cette plateforme, ou
 * `null` si rien ne s'y oppose.
 *
 * ⚠️ C'est une DÉDUCTION, assumée : sous Windows, la console ne rapporte la
 * souris à un programme en mode brut que depuis libuv 1.51
 * (`UV_TTY_MODE_RAW_VT`), soit Node 24.2 dans la branche du plancher (la
 * branche 22 l'a reçue en 22.17, mais `engines` exige 24). La constater exigerait d'activer les modes
 * 1000+ — et sur un Node plus ancien, cette activation ferait AUSSI perdre la
 * molette du mode 1007 (les modes de suivi l'emportent sur lui). Le plancher
 * `engines` (24.0) laisse passer 24.0 et 24.1 : on le dit plutôt que de
 * risquer une molette muette.
 *
 * @param platform - `process.platform`.
 * @param nodeVersion - `process.versions.node`.
 * @returns la raison du refus, à afficher, ou `null`.
 */
export function mouseCaptureBlocker(
  platform: string,
  nodeVersion: string,
): string | null {
  if (platform !== "win32") return null;
  const [major = 0, minor = 0] = nodeVersion
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const [needMajor, needMinor] = WINDOWS_MOUSE_NODE;
  if (major > needMajor || (major === needMajor && minor >= needMinor)) {
    return null;
  }
  return `la console Windows ne rapporte la souris qu'à partir de Node ${needMajor}.${needMinor} (Node ${nodeVersion} ici)`;
}

/**
 * Efface l'écran VISIBLE et ramène le curseur en haut — l'historique du
 * terminal reste intact : on doit pouvoir remonter dans ce qui a précédé.
 * (`ED 2` + `CUP`, rendus aussi par l'émulation de libuv sous Windows.)
 */
export const CLEAR_SCREEN = "\x1b[2J\x1b[H";

/**
 * Remet le terminal à zéro, historique COMPRIS (`ED 3`) — le geste du menu de
 * `nodefony`, qui lance une commande sur une page vierge. À ne pas confondre
 * avec {@link CLEAR_SCREEN} : le serveur de développement, lui, garde
 * l'historique.
 */
export const RESET_SCREEN = "\x1b[2J\x1b[3J\x1b[H";

/**
 * Variable posée par le superviseur quand le BUILD qui précède le démarrage a
 * eu un problème (le serveur démarre alors sur un `dist` possiblement
 * périmé) : sa valeur est le verdict. Le serveur en fait un point d'attention
 * — c'est ce qui le garde visible en haut du bilan, même une fois l'écran
 * remis à zéro.
 */
export const DEV_BUILD_ISSUE_ENV = "NF_DEV_BUILD_ISSUE";

/**
 * Le point d'attention d'un build de démarrage en échec.
 *
 * @param verdict - le verdict du superviseur.
 * @returns le point à déclarer au bilan.
 */
export function devBuildIssueNotice(verdict: string): IBootNotice {
  return {
    code: "DEV_BUILD_INCOMPLETE",
    level: "warning",
    message: verdict,
    fix: "corrige l'erreur puis sauvegarde — sortie complète : npm run build",
  };
}

/**
 * Numéro du rechargement courant, lu dans {@link DEV_RELOAD_ENV} — `0` au
 * premier démarrage.
 *
 * @param env - l'environnement.
 * @returns le numéro, ou `0`.
 */
export function reloadCount(
  env: Readonly<Record<string, string | undefined>>,
): number {
  const n = Number(env[DEV_RELOAD_ENV] ?? 0);
  return Number.isInteger(n) && n > 0 ? n : 0;
}
