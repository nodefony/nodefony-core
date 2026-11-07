## Développer le framework lui-même

<!-- @if core -->
Pour travailler sur le framework, c'est ce dépôt qu'on clone :

```bash
git clone https://github.com/nodefony/nodefony-core.git
cd nodefony-core
npm install && npm run build
npm run dev
```

Une application peut alors suivre ce checkout plutôt que npm : `nodefony create app <nom> --link`
lie ses dépendances `nodefony`/`@nodefony/*` en `file:` — tu modifies le framework, tu le rebâtis,
l'application le voit.
<!-- @end -->

<!-- @if app -->
Si cette app a été générée avec `--link`, les dépendances `nodefony`/`@nodefony/*`
pointent en `file:` vers un checkout local de `nodefony-core` : tu modifies le
framework, tu rebuilds le checkout, ton app le voit. Ne publie pas ce
`package.json` tel quel — après la release npm, régénère sans `--link`
(versions `^<%= it.nodefonyVersion %>`).
<!-- @end -->
