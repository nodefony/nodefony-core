import readline from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { IScaffoldTypeSpec } from "./spec";
import type {
  IScaffoldCaps,
  IScaffoldContext,
  TScaffoldAnswers,
} from "./engine";

/**
 * Front INTERACTIF du scaffold — rend les questions de la spec en
 * `node:readline/promises` (natif, zéro dépendance). Ne décide RIEN :
 * il pose ce que la spec déclare, `engine.resolveAnswers` reste le juge.
 *
 * Streams injectables → testable avec des flux factices (aucun TTY requis).
 */

/** Rend une question au format `label [défaut]` et normalise la réponse. */
async function ask(
  rl: readline.Interface,
  out: Writable,
  spec: IScaffoldTypeSpec["questions"][number],
): Promise<string | boolean> {
  if (spec.type === "boolean") {
    const def = spec.default === true;
    const raw = await rl.question(`${spec.label} ${def ? "[O/n]" : "[o/N]"} `);
    const t = raw.trim().toLowerCase();
    if (t === "") {
      return def;
    }
    return t === "o" || t === "y" || t === "oui" || t === "yes";
  }
  if (spec.type === "choice" && spec.choices) {
    out.write(`${spec.label} :\n`);
    spec.choices.forEach((c, i) => {
      out.write(`  ${i + 1}) ${c.label}${c.hint ? ` — ${c.hint}` : ""}\n`);
    });
    const defIndex = spec.choices.findIndex((c) => c.value === spec.default);
    for (;;) {
      const raw = await rl.question(`Choix [${defIndex + 1}] : `);
      const t = raw.trim();
      if (t === "") {
        return String(spec.default);
      }
      const n = Number.parseInt(t, 10);
      if (Number.isInteger(n) && n >= 1 && n <= spec.choices.length) {
        return spec.choices[n - 1].value;
      }
      out.write(`  → réponse entre 1 et ${spec.choices.length}\n`);
    }
  }
  // string : boucle jusqu'à satisfaire le pattern (le vide prend le défaut s'il en a un).
  for (;;) {
    const raw = await rl.question(`${spec.label} : `);
    const t = raw.trim();
    const value = t === "" ? String(spec.default) : t;
    if (!spec.pattern || new RegExp(spec.pattern, "u").test(value)) {
      return value;
    }
    out.write(`  → ${spec.patternHint ?? `doit matcher ${spec.pattern}`}\n`);
  }
}

/** Confirmation simple `[O/n]` — pour le récap final avant génération. */
export async function confirm(
  question: string,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const raw = await rl.question(`${question} [O/n] `);
    const t = raw.trim().toLowerCase();
    return t === "" || t === "o" || t === "y" || t === "oui" || t === "yes";
  } finally {
    rl.close();
  }
}

/**
 * Pose les questions de la spec NON déjà répondues (les flags argv gagnent —
 * on ne redemande jamais ce que l'utilisateur a déjà dit) et retourne les
 * réponses fusionnées. Les questions `askIf` non satisfaites sont sautées.
 */
export async function askMissing(
  spec: IScaffoldTypeSpec,
  partial: TScaffoldAnswers,
  caps: IScaffoldCaps,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
  context: IScaffoldContext | null = null,
): Promise<TScaffoldAnswers> {
  const rl = readline.createInterface({ input, output });
  const answers: TScaffoldAnswers = { ...partial };
  try {
    for (const q of spec.questions) {
      if (answers[q.key] !== undefined) {
        continue;
      }
      if (q.askIf === "hasCheckout" && !caps.hasCheckout) {
        continue;
      }
      // Réglage avancé : on ne l'impose pas au dialogue (défaut sûr, option dédiée).
      if (q.advanced) {
        continue;
      }
      answers[q.key] = await ask(rl, output, hydrate(q, context));
    }
  } finally {
    rl.close();
  }
  return answers;
}

/**
 * Remplace les réponses possibles d'une question par celles du PROJET RÉEL.
 *
 * Une question marquée `optionsFrom` n'a pas ses choix dans la spec : ils
 * dépendent de ce que l'application déclare. Sans cette hydratation, le dialogue
 * demande un nom de connecteur en texte libre — et une faute de frappe ne se
 * voit qu'au démarrage suivant.
 *
 * Sans contexte (hors projet), ou si le projet n'a rien à proposer, la question
 * est rendue telle quelle : mieux vaut un champ libre qu'une liste vide dont on
 * ne peut rien choisir.
 */
function hydrate(
  question: IScaffoldTypeSpec["questions"][number],
  context: IScaffoldContext | null,
): IScaffoldTypeSpec["questions"][number] {
  if (!question.optionsFrom || !context) return question;
  const values =
    question.optionsFrom === "connectors"
      ? context.connectors.map((c) => ({
          value: c.name,
          label: c.name,
          hint: c.dialect,
        }))
      : Object.values(context.entities)
          .flat()
          .map((name) => ({ value: name, label: name }));
  if (values.length === 0) return question;
  return { ...question, type: "choice", choices: values };
}
