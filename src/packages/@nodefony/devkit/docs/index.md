---
module: "@nodefony/devkit"
topic: overview
audience: [human, ai]
tags: [module, developpement, agent]
status: stable
---

# devkit

> L'outillage de développement d'une application : sa carte de visite, et les
> portes qui mènent au reste.

Cette page est **surfacée dans Studio** (onglet Docs du module).

## Le problème qu'il résout

Une application Nodefony sait beaucoup de choses sur elle-même — ses modules, ses
routes, sa configuration, la documentation installée avec chaque paquet. Mais
elle ne le **dit** à personne. Celui qui arrive — un développeur qui reprend le
projet, un agent qui code — n'a d'autre choix que de deviner : lire les sources,
supposer une convention, inventer une route.

Le devkit répond à la question d'ouverture, et à elle seule : **qui répond ici,
et où faut-il aller ensuite ?**

```bash
npx nodefony devkit:card        # -j pour du JSON (| jq)
```

La réponse tient en trois blocs : l'identité (nom, version, environnement, cœur),
les modules réellement chargés, puis **où lire** et **quoi lancer**.

## Pourquoi il n'existe pas en production

Ce que la carte expose — modules chargés, chemins de documentation, commandes —
aide pendant le développement. En production, c'est une description de votre
architecture offerte à qui la demande : une divulgation, pas une fonctionnalité.

D'où la double protection, et les deux moitiés comptent :

```ts
// nodefony.config.ts — posé par `nodefony create app`
use("@nodefony/devkit", {}, { policy: "dev" }),
```

- **`devDependencies`** : `npm ci --omit=dev` ne l'installe pas ;
- **`policy: "dev"`** : un déploiement qui installerait tout ne le charge pas
  quand même. Un module non chargé n'est **même pas importé** — le coût en
  production est nul, pas « faible ».

Corollaire à connaître : hors développement, la commande **n'existe pas**. Depuis
un terminal qui n'aurait pas posé la variable :

```bash
NODE_ENV=development npx nodefony devkit:card
```

## Trois portes, une seule source

| Porte                            | Pour qui                                           |
| -------------------------------- | -------------------------------------------------- |
| `npx nodefony devkit:card`       | un agent, un humain au terminal                    |
| `GET /nodefony/devkit/api/card`  | Studio, un script authentifié                      |
| `buildCard()` (export du paquet) | une porte de plus, à écrire — rien à réimplémenter |

**Ajouter une porte n'ajoute jamais une vérité** : les trois lisent le même
service, qui dérive le même Kernel. La construction elle-même vit dans une
fonction pure (`buildCard`) qui reçoit son état au lieu de le lire — c'est ce qui
la rend éprouvable sans serveur, et ce qui l'empêche d'inventer quoi que ce soit.

> La route HTTP vit sous `/nodefony`, que le pare-feu d'une application réelle
> couvre : un agent qui code ne s'authentifie pas et n'a pas de navigateur. La
> porte qui compte pour lui est la commande.

## Ce qu'il ne fait pas

Le scaffold (`nodefony create …`), le diagnostic (`nodefony check`) et
l'introspection (`nodefony inspect`) **ne sont pas ici** : ils vivent dans le
cœur, parce qu'ils doivent répondre sans qu'aucun module soit installé — et
surtout quand l'application est cassée. Un outil de diagnostic qui exige que
l'application démarre ne sert pas au moment où on en a besoin.

## Configuration

| Clé       | Type      | Défaut | Rôle                   |
| --------- | --------- | ------ | ---------------------- |
| `enabled` | `boolean` | `true` | Interrupteur du module |

Les clés, leurs types et leurs défauts viennent du schéma Zod
(`nodefony/config/config.ts`) — **source unique** dont dérivent la
documentation, la validation au boot et le formulaire d'édition de Studio.
