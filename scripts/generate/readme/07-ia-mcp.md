## L'IA : ton application, ouverte aux agents

**Un agent d'IA atteint une application par une porte standard : le Model Context Protocol
(MCP).** Il demande quels outils elle offre, reçoit pour chacun un nom, une description et un
schéma d'entrée, puis les appelle. `@nodefony/ai` donne cette porte à ton application et tient
le protocole à ta place — versions, erreurs, autorisation, progression, annulation. Tu écris
une fonction ; elle devient un outil, que Claude, ChatGPT, Copilot ou l'agent d'un client savent
appeler.

| Ce qu'il te faut                     | Ce que Nodefony fournit                                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ouvrir une porte MCP**             | `npx nodefony create controller mcp --kind mcp` génère la porte, deux outils d'exemple et leur test. MCP révision `2026-07-28`, clients plus anciens acceptés                                             |
| **Suivre un outil long**             | Sur la même requête HTTP, la réponse passe en **flux SSE** : l'agent reçoit l'avancement (`notifications/progress`), puis le résultat — et peut annuler en route, l'outil s'arrête proprement             |
| **Servir un agent sans serveur**     | Le transport **stdio** : `npx nodefony ai:stdio`, pour une intégration continue ou un agent qui lance lui-même son serveur. Les mêmes outils, la même fonction                                            |
| **Ouvrir en production**             | `--expose oauth` : jeton exigé, serveur d'autorisation annoncé (RFC 9728), un scope par outil — un appelant ne voit que ce qu'il peut appeler. `--expose mixte` : des outils publics, les autres réservés |
| **Agir au nom de quelqu'un**         | `actsForUser` : l'outil s'exécute avec le compte de l'appelant, sous les mêmes règles qu'une route protégée                                                                                               |
| **Dire ce que fait l'outil**         | Chaque outil annonce s'il lit ou s'il modifie, pour que l'agent sache quand demander confirmation ; le test généré refuse un outil qui ne le dit pas                                                      |
| **Des outils dans chaque module**    | Un module déclare les siens par `getMcpTools()` ; une porte les ramasse tous, sans registre à tenir                                                                                                       |
| **Développer avec un agent de code** | `@nodefony/devkit` ouvre en développement la porte `/nodefony/mcp` : l'agent interroge l'application qui tourne — carte, santé, routes, trafic, profil d'une route — au lieu de deviner                   |

`@nodefony/ai` ne monte aucune route tant que tu n'ouvres pas de porte ; paquet **expérimental**, il suit la spécification MCP et peut évoluer en version mineure, toujours annoncé au journal des versions.

→ [Le module IA](https://nodefony.github.io/nodefony-core/docs/modules/ai/) ·
[La boîte à outils MCP](https://nodefony.github.io/nodefony-core/docs/modules/ai/mcp/)
