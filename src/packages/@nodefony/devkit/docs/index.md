---
module: "@nodefony/devkit"
topic: overview
audience: [human, ai]
tags: [module]
status: draft
---

# devkit

> Outillage de developpement d une application Nodefony : carte de visite et portes de decouverte pour un agent
> Cette page est **surfacée dans Studio** (onglet Docs du module) : ce que vous écrivez ici,
> l'équipe le lit dans l'admin, sans quitter l'application.

## Ce que fait le module

À remplir : le problème que ce module résout, et pour qui.

## Configuration

Le module se charge et se configure depuis le manifeste de l'app (`nodefony.config.ts`) :

```ts
use("@nodefony/devkit", {
  enabled: true,
  greeting: "Bonjour",
}),
```

Les clés disponibles, leurs types et leurs défauts viennent du schéma Zod
(`nodefony/config/config.ts`) — c'est la **source unique** : la doc, la validation au boot et
le formulaire d'édition de Studio en dérivent tous les trois.

## Service

`DevkitService` est injectable sous le nom `devkit` :

```ts
const svc = container.get<DevkitService>("devkit");
svc.status(); // { ready: true }
```

## À suivre

- Les routes exposées (une fois vos controllers écrits).
- Les décisions d'architecture qui méritent d'être expliquées plutôt que devinées.
