/**
 * L'aide de l'invite en panneau à rubriques (#538, D9, D10) : la première
 * rubrique dit ce que l'invite sait faire (commandes du superviseur, gestes),
 * les suivantes RENDENT l'aide du CLI — le même rangement que `nodefony
 * --help` (`groupCommands`), lu dans le manifeste des commandes, jamais une
 * seconde liste.
 *
 * Pur : le manifeste et les gestes sont passés par l'appelant.
 */
import type { ICliManifest } from "../../cli/completion";
import { groupCommands } from "../../cli/helpReport";
import type { IGesture } from "./devBand";
import type { IPanelPage, IPanelSpec, PanelRow } from "./devPanel";
import {
  CLI_PROMPT_COMMAND,
  PROMPT_COMMAND_PREFIX,
  PROMPT_SHELL_PREFIX,
  SHELL_PROMPT_LINE,
  SUPERVISOR_VERBS,
  TERM_PROMPT_COMMAND,
} from "./promptAction";

/** L'identifiant de l'onglet de l'aide : rouvrir l'aide le rafraîchit. */
export const HELP_PANEL_ID = "help";

/**
 * L'aide complète, en rubriques.
 *
 * @param input - les gestes de l'écran (`screenGestures`) et le manifeste
 *   des commandes du CLI (`readCliManifest`), `null` s'il n'est pas écrit.
 * @returns le panneau.
 */
export function buildHelpPanel(input: {
  readonly gestures: readonly IGesture[];
  readonly manifest: ICliManifest | null;
}): IPanelSpec {
  const prompt: PanelRow[] = [
    { kind: "heading", text: "Commandes de l'invite" },
  ];
  for (const verb of SUPERVISOR_VERBS) {
    prompt.push({
      kind: "entry",
      key: [verb.id, ...verb.aliases]
        .map((name) => `${PROMPT_COMMAND_PREFIX}${name}`)
        .join(" · "),
      value: verb.does,
    });
  }
  prompt.push({
    kind: "entry",
    key: CLI_PROMPT_COMMAND.usage,
    value: CLI_PROMPT_COMMAND.does,
  });
  prompt.push({
    kind: "entry",
    key: SHELL_PROMPT_LINE.usage,
    value: SHELL_PROMPT_LINE.does,
  });
  prompt.push({
    kind: "entry",
    key: TERM_PROMPT_COMMAND.usage,
    value: TERM_PROMPT_COMMAND.does,
  });
  prompt.push({
    kind: "text",
    text: `Pendant « ${TERM_PROMPT_COMMAND.usage} », Ctrl+C va au programme. Sous Windows, la console le livre à tous ceux qui la partagent : le serveur peut s'arrêter avec lui.`,
  });
  prompt.push({
    kind: "text",
    text: `Une commande commence par « ${PROMPT_COMMAND_PREFIX} », une ligne du shell par « ${PROMPT_SHELL_PREFIX} » ; une saisie sans l'un ni l'autre n'en est pas une.`,
  });
  prompt.push({ kind: "heading", text: "Gestes" });
  for (const gesture of input.gestures) {
    prompt.push({ kind: "entry", key: gesture.keys, value: gesture.does });
  }
  const pages: IPanelPage[] = [{ title: "Invite", rows: prompt }];
  pages.push(...cliPages(input.manifest));
  return { id: HELP_PANEL_ID, label: "aide", pages };
}

/**
 * Les rubriques du CLI : un groupe d'intention par rubrique, dans l'ordre de
 * `groupCommands`. Le manifeste ne dit pas quel module porte une commande :
 * une commande de module sans groupe tombe sous « Autres », comme dans la
 * page de manuel.
 */
function cliPages(manifest: ICliManifest | null): IPanelPage[] {
  if (manifest === null || manifest.commands.length === 0) {
    return [
      {
        title: "CLI",
        rows: [
          {
            kind: "text",
            text: "La liste des commandes n'est pas encore écrite : elle l'est à chaque commande nodefony (node_modules/.cache/nodefony/cli-manifest.json).",
          },
        ],
      },
    ];
  }
  // Ce qu'une commande accepte en premier argument (`inspect <sujet>`).
  const accepts = new Map<string, readonly string[]>();
  for (const command of manifest.commands) {
    const first = command.args?.[0];
    if (first !== undefined && first.length > 0) {
      accepts.set(command.name, first);
    }
  }
  const pages: IPanelPage[] = [];
  for (const group of groupCommands(
    manifest.commands.map((c) => ({
      name: c.name,
      aliases: c.aliases,
      description: c.description,
      ...(c.group === undefined ? {} : { group: c.group }),
    })),
  )) {
    const rows: PanelRow[] = [];
    for (const command of group.commands) {
      rows.push({
        kind: "entry",
        key: [command.name, ...command.aliases].join(" · "),
        value: command.description,
      });
      const values = accepts.get(command.name);
      if (values !== undefined) {
        rows.push({ kind: "entry", key: "", value: `→ ${values.join(", ")}` });
      }
    }
    pages.push({ title: sentenceCase(group.title), rows });
  }
  return pages;
}

/** `GÉNÉRER ET CONSTRUIRE` → `Générer et construire`. */
function sentenceCase(title: string): string {
  const lower = title.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
