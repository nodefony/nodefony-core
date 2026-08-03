---
module: "<%= it.pkgName %>"
topic: overview
audience: [human, ai]
tags: [module]
status: draft
---

# <%= it.name %>


> <%= it.description %>


Cette page est **surfacée dans Studio** (onglet Docs du module) : ce que vous écrivez ici,
l'équipe le lit dans l'admin, sans quitter l'application.

## Ce que fait le module

À remplir : le problème que ce module résout, et pour qui.

## Configuration

Le module se charge et se configure depuis le manifeste de l'app (`nodefony.config.ts`) :

```ts
use("<%= it.pkgName %>", {
  enabled: true,
  greeting: "Bonjour",
}),
```

Les clés disponibles, leurs types et leurs défauts viennent du schéma Zod
(`nodefony/config/config.ts`) — c'est la **source unique** : la doc, la validation au boot et
le formulaire d'édition de Studio en dérivent tous les trois.
<% if (it.service) { %>
## Service

`<%= it.pascal %>Service` est injectable sous le nom `<%= it.name %>` :

```ts
const svc = container.get<<%= it.pascal %>Service>("<%= it.name %>");
svc.status(); // { ready: true }
```
<% } %><% if (it.command) { %>
## Commande CLI

```bash
nodefony <%= it.name %>:hello
```
<% } %>
## À suivre

- Les routes exposées (une fois vos controllers écrits).
- Les décisions d'architecture qui méritent d'être expliquées plutôt que devinées.
