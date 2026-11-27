/**
 * Trois questions posées par la porte PUBLIQUE `ask()` du paquet bâti, dans la
 * console qui lance ce script — le banc node-pty (ConPTY sous Windows) le
 * pilote au clavier. Aucune base, aucun kernel : ce qui est jugé, c'est la
 * console et la porte, rien d'autre.
 *
 * Argument : le chemin de `dist/node/index.js`. Sortie : une ligne
 * `RÉSULTAT {…}` (le secret n'y figure que par sa LONGUEUR) et le code de
 * `exitCodeOfQuestions` — 130 si une question est annulée.
 */
import { pathToFileURL } from "node:url";

const { ask, askSecretTwice, exitCodeOfQuestions } = await import(
  pathToFileURL(process.argv[2]).href
);

process.exitCode = await exitCodeOfQuestions(async () => {
  const name = await ask({
    kind: "input",
    key: "name",
    message: "Nom du compte",
    required: true,
  });
  const password = await askSecretTwice(
    {
      kind: "secret",
      key: "password",
      message: `Mot de passe de « ${name} »`,
      required: true,
    },
    "Confirme le mot de passe",
  );
  const roles = await ask({
    kind: "checkbox",
    key: "roles",
    message: "Rôles",
    choices: [
      { value: "ROLE_USER", label: "ROLE_USER", checked: true },
      { value: "ROLE_ADMIN", label: "ROLE_ADMIN" },
    ],
  });
  process.stdout.write(
    `\nRÉSULTAT ${JSON.stringify({ name, length: password.length, roles })}\n`,
  );
  return 0;
});
