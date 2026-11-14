/**
 * Ce qu'un fichier d'exemple EXÉCUTÉ devient quand on le MONTRE — dans une page
 * de `docs/` (`useCases.test.ts`) ou dans un skill livré (`skillExcerpts.test.ts`).
 * Une seule réécriture pour les deux lecteurs : deux copies de cette règle
 * diraient tôt ou tard deux choses différentes du même fichier.
 */

/**
 * Ce qu'un import du dépôt devient dans la page : la forme qu'écrit une
 * application, qui pose le test à côté de son contrôleur.
 *
 * @param source - le texte du fichier d'exemple
 * @returns le texte aux imports réécrits
 */
export function asShown(source: string): string {
  return source
    .replaceAll('"../../../../index"', '"@nodefony/realtime"')
    .replaceAll('"../../../testing/index"', '"@nodefony/realtime/testing"')
    .replaceAll(/"\.\.\/\.\.\/fixtures\/use-cases\/([\w-]+)"/g, '"./$1"')
    .replaceAll(
      /"\.\.\/\.\.\/fixtures\/(entity|service)\/([\w-]+)"/g,
      '"../$1/$2"',
    );
}

/**
 * Une liste d'import mise sur une ligne : le chemin réécrit est plus court, et le
 * formateur replie dans la page ce qu'il déplie dans le fichier.
 *
 * @param source - un texte qui contient des imports
 * @returns le texte, chaque liste d'import sur une ligne
 */
export function flatImports(source: string): string {
  return source.replaceAll(
    /import (type )?\{([^}]*)\}/g,
    (_match, kind: string | undefined, names: string) =>
      `import ${kind ?? ""}{ ${names
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n !== "")
        .join(", ")} }`,
  );
}

/** Fins de ligne normalisées : un poste Windows extrait la page en CRLF. */
export function lf(text: string): string {
  return text.replaceAll("\r\n", "\n");
}
