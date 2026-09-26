---
name: nodefony-add-service
description: >
  Crée un service injectable dans une application Nodefony par `nodefony create service`, et le
  fait entrer dans le conteneur — la moitié qu'on oublie. Porte la distinction entre le nom de la
  CLASSE et le nom de l'INSTANCE, les deux façons d'obtenir un service depuis un autre
  (`@inject` au constructeur ou `container.get` à l'usage), le choix de sa durée de vie
  (un exemplaire pour l'application, ou un par requête), et le défaut mesuré qu'un service
  écrit à la main produit : une classe qui compile, dont les tests passent, et que le conteneur
  ignore. À charger AVANT d'écrire une classe de service ou d'appeler un service depuis un autre.
  Déclencheurs : "crée un service", "un service métier", "logique métier partagée", "injecter une
  dépendance", "container.get", "@injectable", "@services", "appeler un service depuis un autre",
  "mon service est undefined", "le conteneur ne trouve pas mon service", "un service par
  requête", "un état propre à chaque requête", "scope request".
---

# add-service — un service que le conteneur connaît

> 🧭 **Tu es arrivé ici directement ? Charge aussi `nodefony-dev`** — il porte la conduite
> commune (par où commencer, comment prouver que c'est fait) et les pièges qui coûtent une heure,
> serveur comme front. Cette page-ci ne couvre QUE son geste.
>
> Et si une réponse te manque, elle est probablement INSTALLÉE : `rg` ne descend pas dans
> `node_modules`, donc 70 pages de documentation y paraissent absentes. Une commande les lit, avec
> la ligne exacte :
> `node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs <termes>`.

> ⚖️ **La confiance n'exclut pas le contrôle.** Un service qui compile n'est pas un service
> enregistré. Le seul juge est l'application en marche.

## Le geste

```bash
npx nodefony create service Billing
```

Produit la classe `@injectable()` `extends Service`, son interface, **et** l'inscrit dans le
`@services([…])` de la cible — en le créant s'il n'existe pas.

Pour qu'il en appelle un autre :

```bash
npx nodefony create service Invoice --inject Billing
```

La commande **refuse avant d'écrire** si le service visé n'existe pas, et liste alors ceux de la
cible. Elle refuse aussi de s'auto-injecter.

## Pourquoi ne pas l'écrire à la main — c'est mesuré

Lâché dans une application fraîche sans accès aux sources du framework, un agent produit une
classe à méthodes `static`. **Elle compile, elle marche, et elle reste invisible au conteneur.**
Le vérificateur le dit (`orphan-service`), mais seulement si on le lance :

```
Billing porte @injectable mais n'est déclaré nulle part — sans @services([Billing])
sur le module, il n'entre pas dans l'ordre de démarrage, échappe au rapport de boot
et à l'introspection, et n'est construit qu'à la première requête qui le réclame
```

## Deux noms, et ils ne servent pas à la même chose

C'est le piège n°1, et il ne produit aucune erreur — juste un `null` :

```ts
@injectable()                            // ← nomme la CLASSE : @inject("BillingService")
export class BillingService extends Service {
  constructor() {
    super("billing", ...);               // ← nomme l'INSTANCE : container.get("billing")
  }
}
```

## Choisir sa durée de vie — un seul exemplaire, ou un par requête

Chaque requête a son propre conteneur (un scope, calque posé sur celui de l'application et jeté à
la fin ; en WebSocket, à la fin de la connexion). La portée décide où vit l'exemplaire :

| `@injectable(…)`                         | Exemplaires                             | Pour                                                      |
| ---------------------------------------- | --------------------------------------- | --------------------------------------------------------- |
| `()` ou `("nom")` — défaut `singleton`   | un pour toute l'application             | cache, pool, client : ce qui doit être unique             |
| `({ scope: "transient" })`               | un par résolution                       | un objet jetable sans état partagé                        |
| `({ name: "tenant", scope: "request" })` | un par requête, créé si elle le demande | ce qui naît et meurt avec la requête (`clean()` à la fin) |

Un service `request` reçoit le scope au constructeur (`super("tenant", scope, false)`, même nom
qu'au décorateur) ; `create service` n'en génère pas, il s'écrit à la main. Un singleton qui en
dépend est refusé au démarrage. Pour **lire** une donnée de la requête depuis un singleton, pas
besoin de portée : `RequestContext.getScope()` ou `RequestContext.get()` au moment de l'appel.
Détail : `node_modules/nodefony/docs/service.md`.

## Obtenir un service depuis un autre — deux voies, un choix

| Voie                           | Quand                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `@inject("X")` au constructeur | **par défaut** — la dépendance est déclarée, l'ordre de démarrage la respecte |
| `container.get("x")` à l'usage | quand la dépendance est facultative, tardive, ou choisie à l'exécution        |

`create service --inject` pose la première. Le second est visible partout dans les exemples, et
c'est pour cela qu'il est sur-employé : **déclarer vaut mieux que chercher.**

## Prouver

```bash
npx nodefony doctor                # « porte @injectable mais n'est déclaré nulle part »
npx nodefony inspect services     # ce que le conteneur porte VRAIMENT au démarrage
npm test
```

`inspect services` est le seul juge : ni la compilation ni les tests ne voient un service absent
du conteneur — les tests l'instancient eux-mêmes.

## Voisins

| Besoin                         | Skill                           |
| ------------------------------ | ------------------------------- |
| Une ressource complète stockée | `nodefony-add-crud`             |
| Réserver une route             | `nodefony-protect-route`        |
| Un flux temps réel             | `nodefony-add-realtime-channel` |
