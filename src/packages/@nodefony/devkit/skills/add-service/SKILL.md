---
name: add-service
description: >
  Crée un service injectable dans une application Nodefony par `nodefony create service`, et le
  fait entrer dans le conteneur — la moitié qu'on oublie. Porte la distinction entre le nom de la
  CLASSE et le nom de l'INSTANCE, les deux façons d'obtenir un service depuis un autre
  (`@inject` au constructeur ou `container.get` à l'usage), et le défaut mesuré qu'un service
  écrit à la main produit : une classe qui compile, dont les tests passent, et que le conteneur
  ignore. À charger AVANT d'écrire une classe de service ou d'appeler un service depuis un autre.
  Déclencheurs : "crée un service", "un service métier", "logique métier partagée", "injecter une
  dépendance", "container.get", "@injectable", "@services", "appeler un service depuis un autre",
  "mon service est undefined", "le conteneur ne trouve pas mon service".
---

# add-service — un service que le conteneur connaît

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

C'est le piège n°1, et il ne produit aucune erreur — juste un `undefined` :

```ts
@injectable()                            // ← nomme la CLASSE : @inject("BillingService")
export class BillingService extends Service {
  constructor() {
    super("billing", ...);               // ← nomme l'INSTANCE : container.get("billing")
  }
}
```

## Obtenir un service depuis un autre — deux voies, un choix

| Voie                           | Quand                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `@inject("X")` au constructeur | **par défaut** — la dépendance est déclarée, l'ordre de démarrage la respecte |
| `container.get("x")` à l'usage | quand la dépendance est facultative, tardive, ou choisie à l'exécution        |

`create service --inject` pose la première. Le second est visible partout dans les exemples, et
c'est pour cela qu'il est sur-employé : **déclarer vaut mieux que chercher.**

## Prouver

```bash
npx nodefony check                # « porte @injectable mais n'est déclaré nulle part »
npx nodefony inspect services     # ce que le conteneur porte VRAIMENT au démarrage
npm test
```

`inspect services` est le seul juge : ni la compilation ni les tests ne voient un service absent
du conteneur — les tests l'instancient eux-mêmes.

## Voisins

| Besoin                         | Skill                  |
| ------------------------------ | ---------------------- |
| Une ressource complète stockée | `add-crud`             |
| Réserver une route             | `protect-route`        |
| Un flux temps réel             | `add-realtime-channel` |
