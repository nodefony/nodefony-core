---
name: nodefony-nestjs
description: >
  Inspire l'architecture Nodefony (decorators, controllers, modules, DI, guards) des concepts NestJS
  via le repo officiel en raw markdown (jamais le site docs.nestjs.com, JS lourd). Déclencheur
  EXCLUSIF : le mot-clé "NestJS" dans le message — sans lui, ignorer totalement.
  Exemples : "inspire-toi de NestJS pour X", "DI NestJS", "NestJS modules pattern", "NestJS guards".
---

# nodefony-nestjs

Inspiration architecturale NestJS pour Nodefony — uniquement sur déclencheur explicite "NestJS".

## ⚠️ TRIGGER CONDITION

**N'applique cette inspiration QUE si l'utilisateur écrit explicitement le mot "NestJS".**
Sinon, ignore totalement ce skill. Ne pas mentionner NestJS de toi-même.

## Règle d'or

- **Interdiction** d'aller sur `docs.nestjs.com` (le site plante avec JS lourd).
- Lire le `.md` brut depuis raw GitHub.
- Analyser la syntaxe TypeScript (Metadata, Reflect) → l'adapter au Kernel Nodefony.
- **Zéro Blabla** : ne pas écrire "NestJS fait comme ceci…". Écrire directement le code du décorateur adapté à Nodefony.

## Sources canoniques (raw markdown via r.jina.ai)

### 1. Controllers & HTTP/WS lifecycle

Décorateurs liés aux routes, cycle de vie requêtes :

```
https://r.jina.ai/https://raw.githubusercontent.com/nestjs/docs.nestjs.com/master/content/controllers.md
```

→ Calquer sur `@nodefony/framework` (Router, Controller, décorateurs `@Route`, `@Get`).

### 2. Providers — Injection de dépendances

System `@Service` / `@Inject` :

```
https://r.jina.ai/https://raw.githubusercontent.com/nestjs/docs.nestjs.com/master/content/providers.md
```

→ Calquer sur `src/nodefony/src/kernel/injector/` (decorators `@injectable`, `@inject`, scopes).

### 3. Modules — Encapsulation

Pour structurer `src/packages/@nodefony/` :

```
https://r.jina.ai/https://raw.githubusercontent.com/nestjs/docs.nestjs.com/master/content/modules.md
```

### 4. Guards — Sécurité / WAF

Inspiration directe pour `@nodefony/security` (Firewall) :

```
https://r.jina.ai/https://raw.githubusercontent.com/nestjs/docs.nestjs.com/master/content/guards.md
```

→ Calquer sur décorateurs `@IsGranted`, `@HasAnyRole` Nodefony.

## Pattern d'usage

1. L'utilisateur demande : "Inspire-toi de NestJS pour le décorateur X."
2. Lire le `.md` raw pertinent (controllers/providers/modules/guards).
3. Extraire la syntaxe TypeScript (Reflect Metadata, decorator factories).
4. Adapter aux conventions Nodefony (préfixe `I`, named exports, `Nodefony.getKernel()`).
5. Coder le décorateur. Pas de phrase "NestJS utilise X, donc on fait Y".

## Anti-patterns à éviter

- Lire `docs.nestjs.com` — plante l'agent.
- Copier-coller verbatim du code NestJS sans adapter à Nodefony.
- Mentionner NestJS dans le code (commentaires, noms) — Nodefony reste autonome.
- Activer ce skill sans que l'utilisateur ait écrit "NestJS".
