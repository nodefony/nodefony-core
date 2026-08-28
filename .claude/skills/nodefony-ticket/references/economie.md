# Le ticket comme instrument d'économie — le détail

> Chargé à la demande depuis `SKILL.md` §3. Le SKILL porte la règle et le test qui départage ; cette
> page porte le catalogue, les exemples et les cas limites.
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place.

## Pourquoi ce n'est pas une préférence de style

Mesuré sur les transcripts de ce dépôt : **~72 % du coût d'une session est de la relecture de
contexte, ~10 % la production**. Ce qu'un agent écrit ne coûte presque rien. Ce qui coûte, c'est
retrouver où regarder — et le coût croît **quadratiquement** avec la durée d'une session, puisque
chaque tour relit tout l'historique.

Un ticket est le seul artefact qui puisse **transporter du contexte à travers le temps sans être
relu à chaque tour**. Il est écrit une fois, il est lu une fois au moment de prendre le travail, et
tout ce qu'il énonce précisément est une exploration que personne ne repaiera. C'est ce qui en fait
un instrument d'économie, et pas seulement une description.

Le corollaire est brutal : **un ticket vague ne coûte pas « un peu moins » — il coûte une session
entière**, celle où quelqu'un rouvre les fichiers, refait les recherches et retrouve les décisions
déjà prises. Écrire trois lignes précises au moment où le contexte est chaud vaut une demi-journée
plus tard.

## Les six choses qui achètent du temps

Chacune remplace une exploration. Le test est toujours le même : **qu'est-ce que celui qui prend ce
ticket devrait chercher, et que je sais déjà ?**

### 1. Les chemins EXACTS des fichiers à toucher

Pas « dans le module drizzle » : `src/packages/@nodefony/drizzle/nodefony/entity/colKit.ts`. Un
chemin non écrit, c'est une recherche multi-modules à chaque reprise du ticket — et une chance de se
tromper de fichier quand deux portent le même nom.

Quand le fichier n'existe pas encore, dire **où il naîtra** et à côté de quoi : « un frère de
`DrizzleRepository.ts`, même dossier ».

### 2. Les commandes prêtes à coller

La ligne, telle qu'on la tape — jamais « lancer les tests ». Trois familles :

```bash
# le décor à monter
docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony

# la suite qui prouve
cd src/packages/@nodefony/drizzle && npx vitest run tests/integration/ddl-checks.test.ts

# le gate qui doit mordre
npm run test:all -- --dialects
```

Une commande écrite est une commande qu'on ne recompose pas, et surtout qu'on ne se trompe pas en
recomposant : un port oublié, un profil docker approximatif, et le banc se skippe **en silence**.

### 3. Le décor requis, NOMMÉ

Sans lui, un test se skippe et **un skip compte comme vert**. C'est le défaut le plus coûteux du
dépôt, parce qu'il produit un faux succès : on croit avoir prouvé, on ferme le ticket, et la
régression sort en production.

Nommer : les variables (`NF_PG_URL`, `NF_MYSQL_URL`, `NF_MONGO_TEST_URI`), les conteneurs, les
interrupteurs de coût (`NF_RUN_PERF`, `NF_RUN_DB_OUTAGE`). Source unique : `vitest.gates.ts`.

### 4. Les pièges DÉJÀ CONNUS

Un piège non écrit se redécouvre au prix d'une demi-session — et parfois d'un défaut publié. Les
sources : le document de conception du chantier, les `CLAUDE.md` / `MEMORY.md` des modules touchés,
et `docs/session-retros/RETEX.md`.

Écrire le piège **avec sa conséquence**, sinon il se lit comme une précaution optionnelle :

> `GET_LOCK` est global au serveur MySQL — sans qualification par `DATABASE()`, deux applications
> sans rapport se sérialisent en silence.

### 5. Ce qu'il ne faut PAS faire, ni explorer

C'est ce qui manque le plus souvent, et ce qui coûte le plus cher. Les fausses pistes déjà écartées,
**avec le motif** : sans lui, la piste sera reprise, explorée, et abandonnée une seconde fois.

> Pas d'interface d'applicateur partagée dans `orm-core` : les invariants de sûreté ne sont pas
> communs entre SQL et MongoDB — une interface qui recouvrirait les deux mentirait.

Y appartiennent aussi les gestes **interdits** : `syncIndexes()` de mongoose supprime les index non
déclarés ; `git stash` ne stashe rien sur un fichier déjà commité.

### 6. Ce qui existe déjà et qu'on doit RÉUTILISER

Un patron, un utilitaire, un banc voisin à copier. Sans ce pointeur, on réimplémente **à côté** — et
deux implémentations d'une même règle divergent en silence, chacune passant ses propres tests.

> Le patron est `tests/integration/ddl-indexes.test.ts` : entité de sonde, ORM en mémoire,
> introspection du catalogue. Le copier plutôt que d'inventer un décor.

## Le revers — ce qui se relit à chaque reprise

Un ticket est relu à chaque fois qu'on le prend, qu'on l'estime, qu'on le trie. **Ce qui n'aide pas
à agir se paie à chaque lecture.** Trois formes à couper sans hésiter :

| À couper                                      | Pourquoi                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Une justification **déjà tranchée ailleurs**  | La décision vit dans le document de conception ou dans le parent. La recopier crée un second exemplaire qui divergera. |
| Une **redite d'un autre ticket** de la grappe | Le lecteur la lit deux fois et doute d'avoir compris la différence entre les deux.                                     |
| Le **contexte que le parent porte déjà**      | Un enfant doit être autonome sur son GESTE, pas sur l'histoire du chantier.                                            |

**Le test qui départage, en une question** : _cette phrase évite-t-elle une exploration, ou la
raconte-t-elle ?_ La première mérite d'être écrite. La seconde se coupe.

## Un avant / après

**Avant** — 2 lignes, et une demi-session pour celui qui le prend :

> Ajouter un type énuméré au kit de colonnes pour pouvoir poser des contraintes. Vérifier que ça
> marche sur les trois dialectes.

**Après** — 12 lignes, et le travail commence tout de suite :

> Le kit de colonnes (`src/packages/@nodefony/drizzle/nodefony/entity/colKit.ts`) ne connaît aucun
> type énuméré : `FrameworkColKind` liste `text | json | bool | epochMs | int | dateMs`. Ajouter le
> `kind`, et l'appliquer à `idempotencyEntity.ts` (`state`, union `"if" | "done"`).
>
> Le patron d'émission existe : `buildSqliteTable` / `buildPgTable` / `buildMysqlTable` posent déjà
> les index par le rappel `extraConfig` — les contraintes passent par le même canal.
>
> ⚠️ Le prédicat se compose en `sql.raw` intégral : un paramètre lié n'a pas de sens dans une
> définition de table, et le serveur le refuserait.
> ⚠️ Ne PAS utiliser un type `ENUM` natif PostgreSQL : c'est un objet séparé de la table, absent des
> deux autres dialectes et invisible du DDL dérivé.
>
> Décor : `docker compose -f docker/docker-compose.yml --profile postgres up -d postgres`, puis
> `NF_PG_URL=… NF_MYSQL_URL=… npx vitest run` dans le module.

La différence de coût n'est pas dans l'écriture — les deux ont été écrits par quelqu'un qui savait.
Elle est dans la lecture, et elle se compte en heures.

## La limite : un ticket n'est pas un manuel

Ce qui précède ne dit **pas** « écrire long ». Un ticket qui recopie un tutoriel coûte à chaque
relecture ce qu'il prétend faire gagner. La borne :

- **Ce que le ticket doit porter** : ce que seul son auteur sait — parce qu'il vient de le lire,
  de le mesurer, ou de le décider.
- **Ce vers quoi il doit POINTER** : ce qui vit déjà ailleurs et se retrouve d'un chemin — une page
  de documentation, un `MEMORY.md`, un banc voisin.

Un pointeur exact coûte une ligne et vaut un paragraphe. C'est presque toujours la bonne réponse.
