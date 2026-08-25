/**
 * Lancer un exécutable de l'écosystème npm, sur les trois systèmes — RENVOI.
 *
 * La règle elle-même a QUITTÉ ce fichier : elle vit désormais dans le framework
 * (`src/nodefony/src/cli/execPortable.ts`, publiée sous `besoinDeShell`), parce
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
 * ## Ce que ce renvoi ne couvre PAS
 *
 * `bench-schema.mjs` et `bench-discoverability.mjs` ont leurs propres helpers et
 * lancent de vrais agents : ils ne tournent pas en intégration continue, donc
 * rien ne les éprouve sous Windows. Le défaut y est présent ; il est nommé ici
 * plutôt que corrigé à l'aveugle.
 */
export { besoinDeShell } from "nodefony";
