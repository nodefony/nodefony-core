/**
 * Rend les sorties texte d'un `spawnSync`, vides quand le processus n'a pas pu être lancé.
 *
 * `@types/node` déclare `stdout`/`stderr: string` sur le résultat d'un
 * `spawnSync(…, { encoding })`, mais les deux valent `undefined` quand le
 * lancement échoue (`ENOENT` : exécutable absent, `.cmd` refusé sous Windows) —
 * seul `error` est alors posé. Le type ment, et toute garde écrite contre lui
 * passe pour inutile au lint typé. L'élargissement vit donc ici, en UN seul
 * endroit.
 *
 * @param result - le résultat du `spawnSync` (lancé avec un `encoding`).
 * @returns les deux sorties, `""` pour celle qui n'existe pas.
 */
export function spawnedOutput(result: {
  stdout?: string | null;
  stderr?: string | null;
}): { stdout: string; stderr: string } {
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
