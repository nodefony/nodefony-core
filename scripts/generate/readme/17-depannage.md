## Quand ça casse

Dans l'ordre — chaque étape isole un étage, du moins cher au plus cher :

1. **`npm test`** — l'app se charge-t-elle ? Import cassé, décorateur, config
   invalide : le fichier fautif est nommé.
2. **`npm run typecheck`** — un vert vitest ne type-check RIEN (les types sont
   effacés à la transpilation) ; `tsgo` attrape ce que le build laisse passer.
3. **`npx nodefony status`** — un serveur tourne-t-il déjà ? (port occupé,
   vieux process détaché). `npx nodefony stop` arrête proprement. Si le port est
   tenu par une AUTRE application Nodefony, `status` la nomme :
   `npx nodefony stop <nom>` l'arrête sans changer de dossier.
4. **Rebuild** — comportement fantôme après un gros changement : `npm run build`
   puis relance (le serveur charge `dist/`, pas tes sources).
<% if (it.complete && it.dialect === "sqlite") { %>
### `npm install` s'arrête sur « gyp ERR! find Python »

Ton manifeste porte ceci, et il faut l'y laisser :

```json
"allowScripts": { "better-sqlite3": false }
```

`better-sqlite3` (le pilote SQLite, tiré par `@nodefony/drizzle`) livre ses
binaires **déjà compilés** et demande à npm de ne pas le recompiler. npm oublie
cette demande dès qu'un `package-lock.json` existe — donc dès ton premier
`npm install` — et lance alors `node-gyp rebuild`, qui exige Python et un
compilateur C++ ([npm/cli#9837](https://github.com/npm/cli/issues/9837)). La
ligne ci-dessus le lui interdit explicitement, ce qu'il respecte dans toutes
les versions.

Si tu l'as retirée et que l'installation casse : remets-la, supprime
`node_modules`, relance `npm install`. Rien à compiler, SQLite fonctionne.
<% } %>
