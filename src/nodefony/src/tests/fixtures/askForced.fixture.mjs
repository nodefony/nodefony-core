/**
 * Une question posée comme `Command.askArgument` et le dialogue du scaffold la
 * posent : l'appelant a constaté `canAsk()`, puis passe `terminal: true`.
 * Lancée depuis l'invite du superviseur, elle doit prendre le RELAIS — pas le
 * pied de terminal, dont le clavier est fermé.
 *
 * Argument : le chemin de la porte (`cli/ask.ts`, ou le paquet bâti).
 * Sortie : `RÉSULTAT {…}` et le code de `exitCodeOfQuestions`.
 */
import { pathToFileURL } from "node:url";

const { ask, canAsk, exitCodeOfQuestions } = await import(
  pathToFileURL(process.argv[2]).href
);

process.exitCode = await exitCodeOfQuestions(async () => {
  if (!canAsk()) throw new Error("personne pour répondre");
  const name = await ask(
    {
      kind: "input",
      key: "identifier",
      message: "Identifiant",
      required: true,
    },
    { terminal: true },
  );
  process.stdout.write(`RÉSULTAT ${JSON.stringify({ name })}\n`);
  return 0;
});
