/**
 * Lancer un exécutable de l'écosystème npm, sur les trois systèmes — RENVOI.
 *
 * La règle elle-même a QUITTÉ ce fichier : elle vit désormais dans le framework
 * (`src/nodefony/src/cli/execPortable.ts`, publiée sous `needsShell`), parce
 * que ce n'est pas le banc qui la subit, c'est l'utilisateur. Écrite ici et
 * seulement ici, elle rendait l'outil de mesure portable pendant que le produit
 * ne l'était pas : `nodefony create module` n'exécutait pas son `npm install`
 * sous Windows, le workspace n'était jamais lié, et le module — pourtant écrit,
 * construit et déclaré au manifeste — devenait introuvable au boot. Le seul
 * symptôme était 404 sur toutes ses routes.
 *
 * Ce module reste comme point d'entrée pour que les appelants du banc n'aient
 * rien à changer, et pour qu'il n'existe jamais deux versions de la règle.
 *
 * ## Portée
 *
 * Tout ce qui, dans ce banc, lance un exécutable npm passe par ici — y compris
 * `bench-schema.mjs` et `bench-discoverability.mjs`, qui gardaient le défaut
 * parce qu'ils lancent de vrais agents et ne tournent pas en intégration
 * continue. Rien ne les éprouve encore sous Windows ; les brancher ne coûtait
 * rien, la règle étant désormais publiée et éprouvée par le framework.
 */
export { needsShell } from "nodefony";
