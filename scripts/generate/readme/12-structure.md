## Structure du projet

- `nodefony.config.ts` — LA config de l'app : uniquement les ÉCARTS aux défauts du framework.
  Pour savoir ce qu'on a le droit d'y écrire : `npx nodefony inspect schema <module>` —
  chaque clé, son type, son défaut, sa valeur actuelle et ce qu'elle fait.
- `env.ts` — catalogue **typé** des variables d'environnement (seul lecteur de `process.env`, validé au boot)
<% if (it.complete) { %>- `.env` — TES valeurs de poste (clés de dev, URL de la base) — **jamais commité**. Sa notice,
  commitée, est `.env.example`. Un coéquipier qui clone : `cp .env.example .env`, décommente
  ce qu'il lui faut, puis `npx nodefony security:secrets --write` pour ses propres clés.
  En production, aucun fichier : l'orchestrateur ou le gestionnaire de secrets fournit tout.
<% } %>- `index.ts` — point d'entrée : la classe `App` (module racine) + ses controllers<% if (it.front) { %> + l'entry frontend (`registerEntry`)<% } %>
- `nodefony/controllers/` — tes controllers (`@controller` + `@route`, HTTP **et** WS)
<% if (it.front) { %>- `frontend/src/` — ton app <%= it.frontend %>, servie par Vite (HMR dev, build prod)
<% } %>- `tests/` — tests vitest : unitaires (`npm test`) + e2e réel (`npm run test:e2e`)
- `AGENTS.md` — instructions pour un agent IA, 100 % généré (régénéré par `create`) ; tes notes vivent dans sa zone préservée
<% if (it.complete) { %>- `compose.yaml` — infra de dev docker : Redis<% if (it.db) { %>, <%= it.db.label %><% } %>, Loki/Grafana (profil)
<% } %>- `rolldown.config.ts` — build : 3 lignes, délègue tout au socle publié `nodefony/bundler`
- `.oxlintrc.json` — lint non-intrusif (warn) ; le style est délégué à Prettier
- `vitest.config.ts` — tests unitaires ; porte le bloc `oxc` décorateurs (OBLIGATOIRE, commenté)
- `vitest.e2e.config.ts` — tests e2e, config séparée : `npm test` ne montre que ce qu'il exécute
- `var/` — données locales (sqlite, logs fichiers), gitignoré
