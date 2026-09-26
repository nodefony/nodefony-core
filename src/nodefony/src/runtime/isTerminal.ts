/**
 * Dit si un flux de sortie est relié à un terminal.
 *
 * `@types/node` déclare `isTTY: boolean` sur `process.stdout`/`stderr`, mais la
 * propriété vaut `undefined` dès que la sortie est redirigée (tube, fichier,
 * intégration continue) : le type ment, et toute garde écrite contre lui passe
 * pour inutile au lint typé. L'élargissement vit donc ici, en UN seul endroit.
 *
 * @param stream - le flux à interroger (`process.stdout`, `process.stderr`…).
 * @returns `true` seulement si le flux se déclare terminal.
 */
export function isTerminal(stream: { isTTY?: boolean } | undefined): boolean {
  return stream?.isTTY ?? false;
}
