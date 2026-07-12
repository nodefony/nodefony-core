import readline from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { IScaffoldTypeSpec } from "./spec";
import type { IScaffoldCaps, TScaffoldAnswers } from "./engine";

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
      answers[q.key] = await ask(rl, output, q);
    }
  } finally {
    rl.close();
  }
  return answers;
}
