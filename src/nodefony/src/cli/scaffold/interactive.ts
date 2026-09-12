import readline from "node:readline/promises";
import { anchorEventLoop, chargePrompts, type IPrompts } from "../prompts";
import clc from "../../colors";
import type { Readable, Writable } from "node:stream";
import type { IScaffoldTypeSpec } from "./spec";
import type {
  IScaffoldCaps,
  IScaffoldContext,
  TScaffoldAnswers,
} from "./engine";

/**
 * Front INTERACTIF du scaffold. Ne décide RIEN : il pose ce que la spec
 * déclare, `engine.resolveAnswers` reste le juge.
 *
 * DEUX rendus, et le second n'est pas un luxe. Dans un vrai terminal, les
 * questions passent par `@inquirer/prompts` — listes déroulantes et cases à
 * cocher. Partout ailleurs (flux injectés d'un banc, entrée redirigée, absence
 * de la bibliothèque), le `node:readline/promises` natif reprend la main et la
 * génération aboutit.
 *
 * 🔴 Le readline nu était le rendu UNIQUE, et sa raison était juste quand elle
 * a été écrite : `create app` est servi sans rien avoir installé. Elle ne l'est
 * plus — `@inquirer/prompts` est une dépendance de `nodefony`, dont
 * `create-nodefony` dépend, donc la bibliothèque est déjà sur le disque au
 * moment où les questions se posent. Ce qu'il en coûtait : le choix des agents,
 * qui est MULTIPLE, se répondait en composant « 2,5,7 » — le seul endroit du
 * produit où l'on demande une syntaxe pour répondre à une question fermée, sans
 * voir ce qui est coché ni pouvoir se corriger.
 *
 * Streams injectables → testable avec des flux factices (aucun TTY requis).
 */

/** Largeur de repli de la note — la même que le rapport de `doctor`. */
const NOTE_WIDTH = 76;

/**
 * Écrit la note d'une question, repliée, juste avant ses choix.
 *
 * Elle est DEVANT et non en bas : lue après la liste, elle arrive une fois que
 * le lecteur a déjà tranché. Sa place est celle du doute, pas celle du regret.
 *
 * @param out - le flux où le dialogue s'écrit.
 * @param note - la note de la spec, ou rien.
 */
function writeNote(out: Writable, note: string | undefined): void {
  if (!note) return;
  let line = "";
  for (const word of note.split(/\s+/u)) {
    if (line !== "" && `${line} ${word}`.length > NOTE_WIDTH) {
      out.write(`${clc.blackBright(`  ${line}`)}\n`);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  if (line !== "") out.write(`${clc.blackBright(`  ${line}`)}\n`);
}

/**
 * Le rendu RICHE, quand le terminal le permet — sinon `null`, sans un mot.
 *
 * Trois conditions, et chacune a coûté quelque chose ailleurs :
 *
 * 1. **les flux sont ceux du process** — un banc injecte des flux factices, et
 *    une bibliothèque qui attend un terminal s'y bloque au lieu de rendre la
 *    main. Le critère est l'IDENTITÉ des flux, jamais une devinette ;
 * 2. **l'entrée est un terminal** — `echo "" | npm create nodefony` doit
 *    générer, pas attendre une flèche du clavier ;
 * 3. **la bibliothèque répond** — elle est une dépendance de `nodefony`, mais
 *    une installation amputée ne doit pas empêcher de créer une application.
 *
 * @param input - le flux d'entrée demandé par l'appelant.
 * @param output - le flux de sortie demandé par l'appelant.
 * @returns les questions riches, ou `null` pour retomber sur le readline natif.
 */
export async function loadRichPrompts(
  input: Readable,
  output: Writable,
): Promise<IPrompts | null> {
  if (input !== process.stdin || output !== process.stdout) return null;
  if (!process.stdin.isTTY || process.env.NF_NO_TTY) return null;
  try {
    return await chargePrompts();
  } catch {
    return null;
  }
}

/**
 * Une question rendue par `@inquirer/prompts` — la voie normale d'un terminal.
 *
 * Le DÉFAUT est marqué dans le libellé et non seulement par la position du
 * curseur : une fois qu'on a bougé, plus rien ne dit lequel il était. Le `hint`
 * de la spec devient la `description` d'inquirer, affichée sous la liste — il
 * cesse d'allonger chaque ligne, et le choix redevient lisible.
 *
 * @param prompts - la porte ancrée (jamais `@inquirer/prompts` en direct).
 * @param spec - la question, déjà hydratée par le projet.
 * @returns la réponse, dans le type que la spec déclare.
 */
export async function askRich(
  prompts: IPrompts,
  spec: IScaffoldTypeSpec["questions"][number],
): Promise<string | boolean | string[]> {
  if (spec.type === "boolean") {
    return prompts.confirm({
      message: spec.label,
      default: spec.default === true,
    });
  }
  if (spec.type === "list" && spec.choices) {
    writeNote(process.stdout, spec.note);
    // Des cases à cocher, et RIEN de coché : câbler un agent écrit dans la
    // configuration d'un autre outil — la garde est que ce soit un geste.
    const picked = await prompts.checkbox({
      message: spec.label,
      choices: spec.choices.map((c) => ({
        name: c.label,
        value: c.value,
        description: c.hint,
      })),
    });
    return picked.map(String);
  }
  if (spec.type === "choice" && spec.choices) {
    writeNote(process.stdout, spec.note);
    const def = String(spec.default);
    return prompts.select<string>({
      message: spec.label,
      choices: spec.choices.map((c) => ({
        name:
          c.value === def
            ? `${c.label}  ${clc.blackBright("(défaut)")}`
            : c.label,
        value: c.value,
        description: c.hint,
      })),
      default: def,
    });
  }
  const value = await prompts.input({
    message: spec.label,
    default: String(spec.default),
  });
  const trimmed = value.trim();
  // La validation reste celle de la spec : une réponse qui ne la satisfait pas
  // est REPOSÉE, comme dans le readline — sinon le rendu riche serait le seul
  // à laisser passer un nom d'application invalide.
  if (spec.pattern && !new RegExp(spec.pattern, "u").test(trimmed)) {
    process.stdout.write(
      `  → ${spec.patternHint ?? `doit matcher ${spec.pattern}`}\n`,
    );
    return askRich(prompts, spec);
  }
  return trimmed === "" ? String(spec.default) : trimmed;
}

/** Rend une question au format `label [défaut]` et normalise la réponse. */
async function ask(
  rl: readline.Interface,
  out: Writable,
  spec: IScaffoldTypeSpec["questions"][number],
): Promise<string | boolean | string[]> {
  if (spec.type === "boolean") {
    const def = spec.default === true;
    const raw = await rl.question(`${spec.label} ${def ? "[O/n]" : "[o/N]"} `);
    const t = raw.trim().toLowerCase();
    if (t === "") {
      return def;
    }
    return t === "o" || t === "y" || t === "oui" || t === "yes";
  }
  if (spec.type === "list" && spec.choices) {
    // Multi-choix : plusieurs numéros séparés par une virgule, et surtout le
    // VIDE comme réponse pleine — « aucun » est un choix, pas une hésitation.
    // C'est ce qui permet à une question d'écriture chez un tiers d'exister
    // sans jamais rien cocher par défaut.
    out.write(`${spec.label}\n`);
    writeNote(out, spec.note);
    spec.choices.forEach((c, i) => {
      out.write(`  ${i + 1}) ${c.label}${c.hint ? ` — ${c.hint}` : ""}\n`);
    });
    for (;;) {
      const raw = await rl.question(
        `Numéros séparés par une virgule [aucun] : `,
      );
      const t = raw.trim();
      if (t === "") return [];
      const nums = t
        .split(/[\s,]+/u)
        .filter(Boolean)
        .map((n) => Number.parseInt(n, 10));
      const valid = nums.every(
        (n) => Number.isInteger(n) && n >= 1 && n <= spec.choices!.length,
      );
      if (valid) {
        // Un TABLEAU, jamais une chaîne à virgules : le moteur garde chaque
        // valeur d'une question `list` ENTIÈRE et ne re-découpe rien — « a,b »
        // y deviendrait UNE valeur nommée « a,b », que personne ne verrait.
        return [...new Set(nums)].map((n) => spec.choices![n - 1].value);
      }
      out.write(
        `  → numéros entre 1 et ${spec.choices.length}, ou ENTRÉE pour aucun\n`,
      );
    }
  }
  if (spec.type === "choice" && spec.choices) {
    out.write(`${spec.label} :\n`);
    writeNote(out, spec.note);
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
  // ⭐ Ancre l'event loop le temps des questions : `create app` est servi sans
  // démarrer quoi que ce soit, donc l'attente d'une frappe est la seule chose
  // qui reste — et Node ne compte que les handles. Cf `cli/prompts.ts`.
  const releaseAnchor = anchorEventLoop();
  const rl = readline.createInterface({ input, output });
  try {
    const raw = await rl.question(`${question} [O/n] `);
    const t = raw.trim().toLowerCase();
    return t === "" || t === "o" || t === "y" || t === "oui" || t === "yes";
  } finally {
    rl.close();
    releaseAnchor();
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
  // ⭐ Ancre l'event loop le temps des questions : `create app` est servi sans
  // démarrer quoi que ce soit, donc l'attente d'une frappe est la seule chose
  // qui reste — et Node ne compte que les handles. Cf `cli/prompts.ts`.
  const releaseAnchor = anchorEventLoop();
  const rich = await loadRichPrompts(input, output);
  // Le readline n'est ouvert que s'il sert : ouvrir une interface sur
  // `process.stdin` pendant qu'inquirer le pilote lui vole ses frappes.
  const rl = rich ? null : readline.createInterface({ input, output });
  const answers: TScaffoldAnswers = { ...partial };
  try {
    for (const q of spec.questions) {
      if (answers[q.key] !== undefined) {
        continue;
      }
      if (q.askIf === "hasCheckout" && !caps.hasCheckout) {
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
      const question = hydrate(q, context);
      answers[q.key] = rich
        ? await askRich(rich, question)
        : await ask(rl!, output, question);
    }
  } finally {
    rl?.close();
    releaseAnchor();
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
