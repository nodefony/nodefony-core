---
adr: 18
title: Décorateurs — plus aucune métadonnée de type, routes typées par schéma, décorateurs de paramètre gardés
lang: fr
navTitle: Décorateurs et métadonnées de type
date: 2026-10-19
status: accepted
deciders: [Christophe CAMENSULI]
tags: [decorateurs, typescript, injection, routeur, validation, compatibilite]
---

# ADR-0018 — Décorateurs : plus aucune métadonnée de type, routes typées par schéma, décorateurs de paramètre gardés

📍 [Documentation](../index.md) › [Décisions d'architecture](README.md) › **ADR-0018**

## Statut

Accepté (2026-10-19), ticket #500. Après la 10.0.0, tout ce que cette décision garde est couvert
par la [politique de compatibilité](../guides/compatibilite.md) : le retirer exigera une
dépréciation pendant toute la série 10.

## Contexte

Nodefony compile en décorateurs **historiques** de TypeScript (`experimentalDecorators` +
`emitDecoratorMetadata` + `reflect-metadata`). Deux mécanismes n'existent que dans ce mode :

- les **décorateurs de paramètre** — `@Body`, `@Query`, `@Param`, `@Headers`, `@Cookie`,
  `@Session`, `@CurrentUser`, `@Req`, `@Res`, `@UploadedFile(s)` côté routeur
  (`routerDecorators.ts#paramDecoratorFactory`), `@inject("nom")` côté injection
  (`kernelDecorator.ts#inject`) ;
- les **types émis** (`design:paramtypes`, `design:type`), lus par l'injecteur pour
  l'auto-injection par type (`injector.ts#Injector.dependencyNamesOf`,
  `injector.ts#Injector._instantiateWithStack`) et par `@Inject` de propriété
  (`kernelDecorator.ts#Inject`).

On supposait que le mode historique allait céder la place au standard, et qu'il fallait
préparer la bascule avant de figer la 10.0. L'audit du 2026-10-19 (sauvegardé en commentaire de
#500) établit l'inverse, sources brutes à l'appui :

1. **Le standard recule.** TC39 a rétrogradé `Decorators` et `Decorator Metadata` à l'étape 2.7
   le 2026-05-19 : aucun moteur ne les livre, SpiderMonkey a arrêté son implémentation, et le
   comité n'exclut pas de rouvrir la conception.
2. **Notre chaîne ne sait pas compiler le standard.** oxc (rolldown, vitest) n'abaisse pas les
   décorateurs standard (`oxc-project/oxc#9170`, ouvert) : un build en mode standard recrache
   la syntaxe `@`, que Node refuse.
3. **Le mode historique est durable.** TypeScript s'est engagé à le garder « for the foreseeable
   future » (5.0), ne l'a pas mis dans les dépréciations de 6.0, et tsgo (7) le supporte.
4. **Ce qui est condamné à coup sûr est étroit** : les décorateurs de paramètre (la proposition
   standard qui les couvrirait est à l'étape 1, muette) et les types émis (TypeScript a dit
   qu'il n'en mettrait jamais dans les métadonnées standard).

Et un défaut existe **aujourd'hui**, indépendamment de toute norme : l'auto-injection par type
injecte silencieusement de travers. Un type importé en `import type`, ou un import élidé par le
bundler, devient `Object` dans `design:paramtypes`, sans une erreur — d'où l'expression
`Module;` « NE PAS SUPPRIMER » dans `server-http.ts#ServerHttp`. C'est oxc, pas tsc, qui émet
ces métadonnées dans le `dist`, et il se replie lui aussi sur `Object` quand il ne calcule pas
le type.

## Décision

**Principe : ne parier ni sur l'arrivée du standard, ni sur la disparition du mode historique.**
On retire avant la 10.0 ce qui est défectueux dès aujourd'hui, on ajoute la forme d'avenir là où
elle apporte quelque chose tout de suite, et on garde le reste.

1. **Plus aucune métadonnée de type — avant 10.0, rupture sans dépréciation.**
   - L'injecteur ne lit plus `design:paramtypes` (`Injector.dependencyNamesOf`,
     `Injector._declaredDependencies`, `Injector._instantiateWithStack`). Une dépendance de
     constructeur se déclare par son nom ; un paramètre non nommé reçoit un argument
     positionnel, comme aujourd'hui un paramètre dont le type n'est pas enregistré.
   - `@Inject` de propriété est retiré, avec `Injector._applyPropertyInjection` et la clé
     `inject:properties` : interne, jamais exporté par `nodefony`, aucun usage, et il lisait
     `design:type` quand on omettait le nom.
   - `emitDecoratorMetadata` passe à `false` dans tout ce qui compile du code Nodefony :
     tsconfigs du dépôt et des gabarits d'application et de module, configuration oxc partagée
     de vitest (`scripts/test/vitest/oxc.ts`) et blocs oxc écrits en ligne (configs vitest de
     `devkit` et `ai`, gabarits `vitest*.config.ts.tpl`, scripts de banc des skills
     `nodefony-devkit-bench` et `nodefony-documentation`). **Exception nommée** : les tsconfigs
     d'application Angular (`src/modules/test-frontend-angular/frontend/tsconfig.app.json`,
     gabarit `templates/shared/ng-app-tsconfig/`), que le compilateur Angular exige à `true`.
     Le gabarit `tsconfig.json.tpl` d'application dit en commentaire de remettre le drapeau à
     `true` si une bibliothèque tierce de l'application lit `design:*` (TypeORM, tsyringe,
     class-transformer…). L'expression `Module;` disparaît. Une garde refuse toute
     réapparition de `design:` dans les sources, `frontend/` exclu.
   - `experimentalDecorators` reste à `true` : ce drapeau choisit le mode de compilation, il
     ne porte plus de contrat.

2. **Routes typées et validées par un schéma — un AJOUT, non cassant.**
   - Les options de `@route`, `@Get`, `@Post`… acceptent
     `schema: { params, query, body, headers }`. Chaque entrée est un
     [Standard Schema](https://standardschema.dev) (interface `~standard`) : Zod, déjà
     dépendance du cœur, l'implémente. L'interface est **recopiée** dans le framework (types
     seuls, ce que la spécification autorise) plutôt que prise en dépendance, sans quoi
     `RouteInput` fuirait dans les `.d.ts` publiés vers un type introuvable chez l'installeur.
   - Le Resolver valide **avant** l'action, en lisant les MÊMES sources que les décorateurs de
     paramètre — y compris le corps et la query portés par le pont WebSocket `api.request`
     (`routerDecorators.ts#resolveParamArg`). La validation est synchrone par défaut ; elle ne
     passe en asynchrone que si le validateur rend une promesse.
   - Un échec lève **une** erreur de validation que le rendu d'erreur reconnaît
     (`error-renderer.ts`, même correspondance `issues → fields` que pour `ZodError`) : un seul
     format de 422.
   - Une action à schéma reçoit **un seul argument**, `input`, typé `RouteInput<S>`. `input`
     porte **toujours** les quatre apports — `params`, `query`, `body`, `headers` : validés et
     typés par le schéma quand il en déclare un, servis bruts et typés large sinon. Une action
     à schéma ne reçoit jamais les variables de route positionnelles. Le décorateur vérifie la
     signature : un `input` qui diverge du schéma est une erreur de compilation.
   - Schéma et décorateurs de paramètre sont **exclusifs** sur une même action. Les mélanger
     lève une erreur au démarrage, calculée à l'enregistrement du contrôleur
     (`Router.setController`) et non à la première requête, qui nomme la route.
   - L'option de route `bodyStream: true` remplace `@Body({ stream: true })` pour une action à
     schéma ; `bodyStream` et `schema.body` ensemble sont une erreur de démarrage.
   - Sans schéma, rien ne change, et rien n'est alloué de plus.

3. **Gardés en 10.0, sans dépréciation** : les décorateurs de paramètre du routeur et
   `reflect-metadata`, qui stocke les métadonnées de nos propres décorateurs. Les déprécier
   sans échéance connue ne produirait que du bruit, et le mode qui les porte est durable.
   **Mais le décorateur `@inject("nom")` est renommé `@Inject("nom")` avant la 10.0** : `inject`
   est réservé à la future fonction d'injection (point 5), qui ne pourrait plus prendre ce nom
   sans majeure une fois la 10.0 publiée. Même partage qu'Angular, qui a `@Inject(token)`
   décorateur et `inject(token)` fonction.

4. **Les gabarits génèrent la forme d'avenir là où elle existe.** Une route générée qui lit un
   corps, une query, un paramètre d'URL ou l'utilisateur déclare un schéma et lit `this.user` ;
   elle n'émet aucun décorateur de paramètre. Une application née en 10.0 aura donc moins à
   migrer le jour où il faudra sortir des décorateurs de paramètre.

5. **La suite a des déclencheurs nommés, pas une date.** Une ADR qui remplacera celle-ci est
   ouverte dès que l'un de ces faits survient :
   - oxc livre `#9170` et une application veut compiler en mode standard ;
   - TypeScript annonce la fin de `experimentalDecorators` ;
   - la proposition des décorateurs de paramètre atteint l'étape 3 — ils survivraient alors en
     standard, et la cible ci-dessous serait à reconsidérer ;
   - l'objectif « exécuter par `node` sans build » est retenu (il impose de retirer toute
     syntaxe `@`, décorateurs standard compris).

   La cible connue à ce jour, établie par l'audit : `inject(token)` comme **fonction** dans un
   initialiseur de champ, résolue pendant la construction (modèle Angular) ; décorateurs de
   classe et de méthode **bi-modes** (une fonction, deux signatures) ; métadonnées en `WeakMap`
   sur le modèle de `orm-core` (`metadataStore.ts`), `reflect-metadata` retiré ; décorateurs de
   paramètre retirés au profit du schéma et des accesseurs `this.body`, `this.query`,
   `this.files`, `this.user`. Comme la 10.0 sera publiée, ce retrait passera par une
   dépréciation pendant une majeure. Pour les routes, le remplaçant existera déjà (point 2) ;
   pour l'injection, il arrivera avec l'ADR suivante, sous le nom que le point 3 réserve.

## Conséquences

- **Changement de comportement du point 1.** `Injector._instantiateWithStack` servait un
  paramètre SANS nom déclaré dont le type était enregistré ; sans types émis, ce paramètre
  reçoit l'argument positionnel suivant, ou `undefined` s'il n'en reste pas, sans erreur
  nommée. Les arguments positionnels placés après la dernière dépendance nommée restent
  transmis, comme aujourd'hui. Un test vu rouge avant le retrait fixe la règle : un
  constructeur `(m: Module, dep: Enregistre)` sans nom, instancié avec `[m]`, reçoit
  `dep === undefined` ; `(m, @Inject("X") x, extra)` instancié avec `[m, extra]` garde l'ordre.
- Une application qui comptait sur l'auto-injection par type reçoit donc un argument
  positionnel ou `undefined` : un défaut visible à l'usage, plus un `Object` silencieux. Aucun
  site du dépôt n'en dépend selon l'audit (recherche textuelle, à confirmer par la suite de
  tests une fois la lecture retirée).
- Le tri des services au démarrage (`serviceOrder.ts`) reste en place ; il ne lit plus que les
  noms déclarés. Les tests qui posent `design:paramtypes` ou testent l'injection de propriété
  (`Injector`, `serviceOrder`, `injector.attack`, `services.attack`, `checkWiring`) sont
  réécrits ou retirés, et les TSDoc, `CLAUDE.md` et `MEMORY.md` qui citent `@Inject` de
  propriété ou l'auto-injection sont corrigés.
- Le schéma devient le contrat lisible d'une route. La console d'administration
  (`PlaygroundAdminApi`) lit aujourd'hui les métadonnées des décorateurs de paramètre : elle
  doit apprendre à lire le schéma, sans quoi une route à schéma s'y affiche sans paramètres.
- `#501` (typer la résolution des services par leur nom) n'est pas bloqué : la clé du registre
  reste le nom.
- Travail : deux tickets, gabarits et documentation compris dans chacun — retrait des
  métadonnées de type et renommage de `@inject` (≈ 1,75 j), schéma de route (≈ 3 j).

## Alternatives écartées

- **Tout faire avant la 10.0** (la cible du point 5, ≈ 8,5 j) : refonte de l'ordre de démarrage
  (la fonction `inject()` supprime la déclaration statique des dépendances) et réécriture de
  chaque contrôleur, pour une rupture dont personne ne connaît l'échéance.
- **Statu quo** : laisse l'injection silencieusement fausse, et aucune validation déclarative.
- **`inject()` en fonction dès la 10.0** : ses bénéfices valent dès aujourd'hui (typé par le
  jeton, disponible dans le constructeur, aucun décorateur de paramètre), mais la fonction
  supprime la déclaration statique des dépendances et impose de passer le démarrage de
  `@services` d'un tri topologique à une initialisation dans l'ordre de construction : une
  refonte du cœur du démarrage qu'on ne paie pas avant une échéance connue.
- **`context.metadata` / `Symbol.metadata`** pour stocker les métadonnées : rétrogradé avec la
  proposition mère, et exige un polyfill posé avant toute classe décorée.
- **Parier sur les décorateurs de paramètre standard** : proposition à l'étape 1, sans activité
  depuis 2023.

## Sources (lues le 2026-10-19)

- Registre TC39 : <https://raw.githubusercontent.com/tc39/proposals/main/README.md> (section
  `Stage 2.7`).
- Plénière TC39 du 2026-05-19, « Decorators for Stage 2.7 » :
  <https://raw.githubusercontent.com/tc39/notes/HEAD/meetings/2026-05/may-19.md>.
- Décorateurs de paramètre : <https://github.com/tc39/proposal-class-method-parameter-decorators>.
- oxc, décorateurs standard : <https://github.com/oxc-project/oxc/issues/9170>.
- TypeScript 5.0 (`experimentalDecorators` conservé) et `microsoft/TypeScript#57533` (pas de
  types dans les métadonnées standard).
- Standard Schema : <https://raw.githubusercontent.com/standard-schema/standard-schema/main/packages/spec/README.md>.
- Audit complet : commentaire de #500.
