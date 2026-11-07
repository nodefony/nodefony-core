## D'où ça vient

Nodefony est publié depuis **2017**, en JavaScript, et a mûri jusqu'à sa version 7 : des
applications réelles tournent encore dessus. Fin 2023, plutôt que de le migrer par petits pas, le
choix a été fait d'une **réécriture complète en TypeScript**, fichier par fichier, en gardant les
concepts et en jetant tout le reste.

Pourquoi une réécriture et pas une migration progressive ? Parce qu'un framework ne se contente pas
d'exécuter du code : il **contraint** celui qu'on écrit contre lui. Une couche de types posée après
coup sur du JavaScript décrit ce que le code fait ; elle ne garantit rien. Les partis pris de cette
réécriture sont donc structurels, et chacun ferme une porte :

| Décision                                 | Ce qu'elle rend impossible                                    |
| ---------------------------------------- | ------------------------------------------------------------- |
| TypeScript **strict**, zéro `@ts-ignore` | qu'un contrat se dégrade en silence entre deux modules        |
| **ESM** exclusivement                    | la double résolution CommonJS/ESM et ses pièges de chargement |
| Décorateurs plutôt que convention        | qu'une route existe sans être déclarée là où on la lit        |
| Configuration **validée** au boot        | qu'une clé mal orthographiée soit ignorée sans un mot         |
| Un processus = une instance, par défaut  | une supervision imposée ; l'échelle revient à l'orchestrateur |

La version 10 est l'aboutissement de cette réécriture. Ce n'est pas un portage : c'est le même
projet, repensé pour ce que Node.js et TypeScript sont devenus.
