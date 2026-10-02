import { setSourceMapsSupport } from "node:module";

/**
 * Traduit les piles d'appels du serveur de développement vers les sources `.ts`.
 *
 * En développement, le serveur exécute le `dist/` de l'application, bâti avec
 * ses maps (`APP_DEV_BUILD_ARGS`). À appeler AVANT l'import de l'application :
 * Node n'analyse les maps que des fichiers chargés après l'activation. Ce
 * support couvre les deux chemins du mode développement : l'enfant du
 * superviseur et `--no-watch`. Le coût (résolution à la lecture de
 * `error.stack`) n'est payé qu'en développement : le mode production n'appelle
 * jamais cette fonction.
 *
 * Fichier sans autre dépendance que `node:module` : il s'exécute tel quel sous
 * Node, ce qui permet de l'éprouver dans un vrai process.
 */
export function enableDevSourceMaps(): void {
  setSourceMapsSupport(true);
}
