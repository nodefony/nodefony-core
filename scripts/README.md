<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs — ne pas éditer : `npm run skills:doc`. -->

# `scripts/` — l'outillage du dépôt

Chaque script du dépôt, rangé par **nature** ; chaque dossier porte son propre `README.md` :
ce que fait chaque script, comment le lancer, et **qui le lance** (commande npm, hook git, étape
de forge, autre script). Tout est extrait du source — l'en-tête du script (`@usage`, `@option`,
`@env`, `@requires`, `@output`) est la seule place où sa documentation s'écrit.
`npm run skills:check` refuse un script sans `@usage`, un dossier sans description et un README périmé.

| Dossier | Contenu | Scripts |
| --- | --- | --- |
| [`lib/`](lib/README.md) | Helpers transverses, importés par les scripts des autres dossiers. | 4 |
| [`gates/`](gates/README.md) | Gardes de commit et de forge : chacune refuse un état précis du dépôt. | 12 |
| [`scaffold/`](scaffold/README.md) | Contrôles et mise en forme des gabarits d'application. | 3 |
| [`deps/`](deps/README.md) | Inventaire et garde des dépendances, gabarits compris. | 3 |
| [`deps/lib/`](deps/lib/README.md) | Helpers propres à l'inventaire des dépendances. | 1 |
| [`test/`](test/README.md) | Orchestration des suites de test et de la couverture. | 3 |
| [`test/lib/`](test/lib/README.md) | Helpers de l'orchestrateur de tests : verdicts sur les conteneurs d'infra, remise à zéro de MongoDB. | 2 |
| [`test/vitest/`](test/vitest/README.md) | Socles partagés par TOUTES les configs vitest du dépôt — garde des dossiers temporaires, gates d'infrastructure, décorateurs oxc, cache de transformation — et la config des suites lancées depuis la racine. Importés par les configs, jamais lancés à la main. | 5 |
| [`generate/`](generate/README.md) | Génération d'artefacts : graphe symbolique, page de manuel, catalogue d'environnement, logo. | 7 |
| [`site/`](site/README.md) | Rendu du site de documentation publié et de ses pages annexes. | 8 |
| [`site/lib/`](site/lib/README.md) | Helpers propres au rendu du site de documentation. | 2 |
| [`repo/`](repo/README.md) | Hygiène de l'arbre de travail : verrous, rangement de tmp/, commit sans verrou orphelin. | 7 |
| [`ci/`](ci/README.md) | Ce que la forge lance ou éprouve sur elle-même. | 4 |
| [`release/`](release/README.md) | Chaîne de publication du produit. | 24 |
