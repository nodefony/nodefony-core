## Tests — `npm test` est ton PREMIER diagnostic

```bash
npm test             # unitaires : l'app se CHARGE (imports, décorateurs, config) — < 1 s
npm run test:e2e     # build + boot RÉEL (production --detach --wait) + HTTP + WS + probes
```

<% if (it.db && !it.mongo) { %>> **Les e2e ont besoin de DEUX bases de plus**, sur ton serveur
> <%= it.db.label %> : `<%= it.db.databaseE2e %>` (la suite ne touche jamais
> celle du développement) et `<%= it.db.databaseScratch %>` (la base vierge que
> la suite de migrations salit puis remet à zéro). Le compose les crée à sa
> PREMIÈRE initialisation — sur une infra déjà montée, `docker compose down -v`
> les fera naître, ou crée-les à la main. Elles ne se fabriquent pas toutes
> seules au moment des tests : `CREATE DATABASE` est un privilège
> d'administration, que ton compte applicatif n'a pas — et ne doit pas avoir.

<% } %>**Réflexe** : quelque chose semble cassé → `npm test` AVANT de relire du code ou
de redémarrer. En une seconde il prouve que l'app s'importe, que les décorateurs
compilent et que la config valide — ou te donne le fichier exact qui casse.

Le rapport est **franc** : les e2e ont leur propre config (`vitest.e2e.config.ts`),
`npm test` n'affiche jamais de tests « skipped » qui semblent verts sans avoir
rien prouvé. Le test e2e utilise le lancement détaché natif du framework :
`--wait` ne rend la main que quand la readiness est sondée (aucun `sleep`
arbitraire), et `nodefony stop` arrête proprement. Le client WebSocket est le
`WebSocket` **natif** de Node — zéro dépendance de test.
