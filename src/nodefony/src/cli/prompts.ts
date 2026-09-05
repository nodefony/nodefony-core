/**
 * La porte UNIQUE par laquelle une commande pose une question.
 *
 * ⭐ Elle existe pour une raison qu'aucune commande ne peut résoudre seule :
 * **attendre une réponse humaine ne retient pas Node.**
 *
 * Une question est une promesse en attente. Node ne compte pas les promesses —
 * il compte les HANDLES actifs (sockets, timers, serveurs). Une commande qui
 * boote une application en a des dizaines, si bien que la question tient sans
 * que personne n'y pense. Une commande « standalone » — celles que le CLI sert
 * sans démarrer quoi que ce soit, précisément pour être rapides — n'en a
 * AUCUN : l'attente d'une frappe est alors la seule chose qui reste, et Node
 * conclut qu'il n'a plus rien à faire. Le process s'arrête **au milieu de la
 * question**, sans erreur, avec un code de sortie nul, en laissant tout au plus
 * un `Detected unsettled top-level await`.
 *
 * Le symptôme se lit « la commande meurt toute seule » et se diagnostique comme
 * un délai d'attente qui n'existe pas. Il ne se manifeste que là où l'on a
 * travaillé à ne rien démarrer, donc il frappe les commandes les plus soignées,
 * et jamais celles qui bootent — ce qui achève de brouiller la piste.
 *
 * D'où cette porte : elle pose un handle le temps de la question, et le retire
 * ensuite. Une commande n'a pas à y penser ; elle n'a même pas à savoir que le
 * problème existe. La règle vit ici, une fois — l'écrire dans chaque commande
 * garantirait qu'elle manque un jour dans la dernière écrite.
 *
 * ⚠️ Ne JAMAIS importer `@inquirer/prompts` directement dans une commande.
 * C'est ce qui recrée le défaut, en silence, dans un endroit qu'on ne relira
 * pas.
 */

/**
 * Retient l'event loop, et rend de quoi le relâcher.
 *
 * Un intervalle **non `unref()`** est le handle le plus léger qui fasse
 * l'affaire : il ne consomme rien (son échéance est hors de portée), il ne
 * réveille jamais le process, et il compte comme travail en cours pour Node.
 * L'intervalle est volontairement énorme — ce n'est pas un timer, c'est une
 * ancre.
 *
 * @returns la fonction qui relâche l'ancre ; l'appeler deux fois est sans effet.
 */
export function anchorEventLoop(): () => void {
  // ~12,4 jours : au-delà, Node ramène le délai à 1 ms et le timer se
  // déclencherait en boucle. La borne est celle d'un entier 32 bits signé.
  const timer = setInterval(() => {}, 2_147_483_647);
  return () => clearInterval(timer);
}

/**
 * Exécute une interaction utilisateur en retenant l'event loop.
 *
 * ⚠️ L'ancre se relâche dans un `finally` : une question interrompue (Ctrl+C,
 * flux fermé, refus) doit rendre la main comme une question aboutie, sinon on
 * troque une commande qui meurt trop tôt contre une commande qui ne rend jamais
 * la main — le défaut symétrique, et plus pénible encore.
 *
 * @param interaction - ce qui pose la ou les questions.
 * @returns ce que l'interaction rend.
 */
export async function request<T>(interaction: () => Promise<T>): Promise<T> {
  const relache = anchorEventLoop();
  try {
    return await interaction();
  } finally {
    relache();
  }
}

/** Les questions servies par cette porte — le sous-ensemble réellement utilisé. */
export interface IPrompts {
  confirm: (config: { message: string; default?: boolean }) => Promise<boolean>;
  select: <T>(config: {
    message: string;
    choices: readonly unknown[];
    default?: T;
  }) => Promise<T>;
  checkbox: (config: {
    message: string;
    choices: readonly unknown[];
  }) => Promise<unknown[]>;
  input: (config: { message: string; default?: string }) => Promise<string>;
}

/**
 * Charge les prompts — import DYNAMIQUE, et c'est délibéré.
 *
 * Le paquet pèse ; une commande non interactive (`--json`, un script de forge)
 * ne doit pas le payer. Le chargement est idempotent : Node met le module en
 * cache, les appels suivants ne coûtent rien.
 *
 * @returns les questions disponibles.
 */
export async function chargePrompts(): Promise<
  IPrompts & Record<string, unknown>
> {
  const brut = (await import("@inquirer/prompts")) as unknown as IPrompts &
    Record<string, unknown>;
  // ⭐ Les questions sortent DÉJÀ ancrées. C'est la seule forme qui tienne :
  // demander à chaque appelant d'envelopper son appel, c'est garantir que le
  // dernier écrit ne le fera pas — et le défaut ne se voit pas en relisant le
  // code, seulement en tapant la commande dans un vrai terminal.
  //
  // ⚠️ Le module est préservé ENTIER : il ne porte pas que des questions
  // (`Separator` compose une liste de choix). N'en réexporter que les quatre
  // fonctions enveloppées faisait disparaître le reste — un menu construit
  // depuis une `Separator` devenue `undefined`, et l'on aurait cherché la faute
  // dans le menu.
  return {
    ...brut,
    confirm: (config) => request(() => brut.confirm(config)),
    select: (config) => request(() => brut.select(config)),
    checkbox: (config) => request(() => brut.checkbox(config)),
    input: (config) => request(() => brut.input(config)),
  };
}

/**
 * Interface `readline` ANCRÉE — même garantie, pour le front natif du scaffold.
 *
 * Le scaffold de `create app` ne passe pas par `@inquirer/prompts` : il pose ses
 * questions en `node:readline/promises`, sans aucune dépendance. Le besoin est
 * pourtant identique, et l'exposition la même — `create app` est servi sans rien
 * démarrer. Fournir la fabrique ICI évite d'écrire l'ancre à la main là-bas :
 * une règle qu'on doit se rappeler d'appliquer est une règle qui manquera un
 * jour.
 *
 * @param input - flux d'entrée (injectable pour les bancs).
 * @param output - flux de sortie.
 * @returns l'interface, et la fermeture qui relâche AUSSI l'ancre.
 */
export async function ouvreReadline(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<{
  rl: import("node:readline/promises").Interface;
  close: () => void;
}> {
  const readline = await import("node:readline/promises");
  const relache = anchorEventLoop();
  const rl = readline.createInterface({ input, output });
  return {
    rl,
    close: () => {
      rl.close();
      relache();
    },
  };
}
