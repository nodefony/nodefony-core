## Qualité du code

```bash
npm run typecheck    # tsgo — le bundler ne type-check PAS : gate séparé, obligatoire
npm run doctor        # cohérence du projet : config, modules déclarés, wiring
npm run lint         # oxlint — garde-fous en warn, non-intrusif
npm run format       # prettier — le style, c'est lui qui décide
```

Le lint et le typecheck sont **deux gates distincts**, et c'est volontaire :
`tsgo` juge les TYPES, `oxlint` juge tout ce qu'un type ne dit pas — code mort,
promesse mal formée, import Node sans son préfixe. Aucun des deux ne remplace
l'autre.

`oxlint` s'appuie sur le même analyseur que le bundler (`rolldown`) : un seul
lecteur de ta syntaxe, donc aucun risque que l'un accepte ce que l'autre refuse.
Il n'a **pas** besoin du paquet `typescript` — celui-ci ne reste dans les
dépendances que pour ton éditeur.

Les règles sont dans `.oxlintrc.json`, commentées par leur intention. Deux
familles ne pardonnent pas : le code mort (il finit par mentir) et le préfixe
`node:` sur les modules du runtime (sans lui, un paquet npm homonyme peut prendre
la place d'un module natif). Le reste avertit sans bloquer.
