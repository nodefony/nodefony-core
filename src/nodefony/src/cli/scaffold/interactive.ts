import { anchorEventLoop } from "../prompts";
import { ask } from "../ask";
import type { IQuestion } from "../question";
import type {
  IQuestionFooterInput,
  IQuestionFooterOutput,
} from "../questionFooter";
import {
  capAllows,
  flagFor,
  type IScaffoldQuestion,
  type IScaffoldTypeSpec,
} from "./spec";
import { composeEntityFields, type TAskQuestion } from "./entityFieldsDialog";
import {
  hydrateQuestion,
  type IScaffoldCaps,
  type IScaffoldContext,
  type TScaffoldAnswers,
} from "./engine";

/**
 * Front INTERACTIF du scaffold. Ne décide RIEN : il pose ce que la spec
 * déclare, `engine.resolveAnswers` reste le juge.
 *
 * UN rendu : le moteur de question du cœur (`cli/question.ts`), monté au pied
 * du terminal. Il en avait deux — `@inquirer/prompts` en vrai terminal, un
 * readline nu ailleurs — qui recopiaient la validation de la spec, et dont le
 * second faisait répondre « 2,5,7 » à un choix multiple. Une question de spec
 * se PROJETTE désormais sur une question du moteur ({@link scaffoldQuestion}),
 * fonction pure : le terminal, la bande du superviseur et Studio lisent la
 * même donnée.
 *
 * Clavier et terminal injectables → testable sur des flux factices, PAR
 * OCTETS (aucun TTY requis).
 */

/** Le dialogue : un clavier et un terminal (ceux du processus par défaut). */
interface IDialogStreams {
  readonly input: IQuestionFooterInput;
  readonly output: IQuestionFooterOutput;
}

/**
 * Projette une question de spec sur une question du moteur — sans rien
 * perdre de ce qui la valide (`pattern`) ni de ce qui l'explique (`note`).
 *
 * `list` se lit en deux formes : AVEC des choix, des cases à cocher — rien
 * coché d'avance, câbler un agent écrit dans la configuration d'un autre
 * outil ; SANS choix, des valeurs libres gardées ENTIÈRES (`"siteId,createdAt"`
 * est un index de deux colonnes, et le dialogue en accepte plusieurs).
 *
 * @param spec - la question de la spec, déjà hydratée par le projet.
 * @returns la question du moteur ; sa clé et son drapeau sont ceux de la spec.
 */
export function scaffoldQuestion(spec: IScaffoldQuestion): IQuestion {
  const base = {
    key: spec.key,
    message: spec.label,
    flag: flagFor(spec),
    ...(spec.note !== undefined ? { note: spec.note } : {}),
  };
  const valid = {
    ...(spec.pattern !== undefined ? { pattern: spec.pattern } : {}),
    ...(spec.patternHint !== undefined
      ? { patternHint: spec.patternHint }
      : {}),
  };
  if (spec.type === "boolean") {
    return { ...base, kind: "confirm", default: spec.default === true };
  }
  if (spec.type === "choice" && spec.choices) {
    const def = String(spec.default);
    return {
      ...base,
      kind: "select",
      default: def,
      // Le DÉFAUT se lit dans le libellé, pas seulement à la position du
      // curseur : une fois qu'on a bougé, plus rien ne dit lequel il était.
      choices: spec.choices.map((c) => ({
        value: c.value,
        label: c.value === def ? `${c.label} (défaut)` : c.label,
        ...(c.hint !== undefined ? { hint: c.hint } : {}),
      })),
    };
  }
  if (spec.type === "list" && spec.choices) {
    return {
      ...base,
      kind: "checkbox",
      choices: spec.choices.map((c) => ({
        value: c.value,
        label: c.label,
        ...(c.hint !== undefined ? { hint: c.hint } : {}),
      })),
    };
  }
  if (spec.type === "list") {
    const def = Array.isArray(spec.default)
      ? spec.default.filter((v) => v !== "")
      : typeof spec.default === "string" && spec.default !== ""
        ? [spec.default]
        : [];
    return { ...base, ...valid, kind: "list", default: def };
  }
  const def = String(spec.default);
  return {
    ...base,
    ...valid,
    kind: "input",
    ...(def !== "" ? { default: def } : {}),
  };
}

/**
 * Pose une question de spec par la porte unique — le terminal est acquis :
 * l'appelant a déjà constaté qu'il y en a un.
 */
function askScaffold(
  spec: IScaffoldQuestion,
  streams: IDialogStreams,
): Promise<string | boolean | string[]> {
  return ask(scaffoldQuestion(spec), {
    terminal: true,
    input: streams.input,
    output: streams.output,
    // Des flux injectés (banc) ne reçoivent jamais de couleur.
    ...(streams.output === process.stdout ? {} : { color: false }),
  });
}

/**
 * Confirmation — pour le récap final avant génération (Entrée = oui).
 *
 * @param question - la question posée.
 * @param input - le clavier.
 * @param output - le terminal.
 * @returns la réponse.
 * @throws {QuestionCancelledError} si la personne annule.
 */
export function confirm(
  question: string,
  input: IQuestionFooterInput = process.stdin,
  output: IQuestionFooterOutput = process.stdout,
): Promise<boolean> {
  return ask(
    { kind: "confirm", key: "yes", message: question, default: true },
    {
      terminal: true,
      input,
      output,
      ...(output === process.stdout ? {} : { color: false }),
    },
  );
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
  input: IQuestionFooterInput = process.stdin,
  output: IQuestionFooterOutput = process.stdout,
  context: IScaffoldContext | null = null,
): Promise<TScaffoldAnswers> {
  // ⭐ Ancre l'event loop le temps du DIALOGUE, pas seulement de chaque
  // question : `create app` est servi sans démarrer quoi que ce soit, et entre
  // deux questions rien d'autre ne retient Node. Cf `cli/prompts.ts`.
  const releaseAnchor = anchorEventLoop();
  const streams: IDialogStreams = { input, output };
  const answers: TScaffoldAnswers = { ...partial };
  const askOne: TAskQuestion = (question) => askScaffold(question, streams);
  try {
    for (const q of spec.questions) {
      if (answers[q.key] !== undefined) {
        continue;
      }
      // Capacité absente de l'environnement : `link` sans checkout, la clé
      // primaire sur une application MongoDB. Une question qui ne décide rien
      // ici n'a pas à être posée.
      if (!capAllows(q, caps)) {
        continue;
      }
      // Dépend d'une réponse précédente : la question ne se pose que si ce
      // qu'elle règle sera effectivement généré (`database` n'a de service à
      // choisir qu'en preset complete).
      if (q.askWhen && String(answers[q.askWhen.key]) !== q.askWhen.equals) {
        continue;
      }
      // Réglage avancé : on ne l'impose pas au dialogue (défaut sûr, option dédiée).
      if (q.advanced) {
        continue;
      }
      if (q.compose === "entityFields") {
        // La cible d'une relation : les entités du projet, plus celle qu'on
        // est en train de créer (une relation vers soi est légitime).
        const entity = String(answers.name ?? "");
        const known = context ? Object.values(context.entities).flat() : [];
        const targets = [...new Set([...known, ...(entity ? [entity] : [])])];
        answers[q.key] = await composeEntityFields(
          askOne,
          output,
          targets,
          entity,
        );
        continue;
      }
      answers[q.key] = await askOne(hydrateQuestion(q, context));
    }
  } finally {
    releaseAnchor();
  }
  return answers;
}
