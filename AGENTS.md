# AGENTS.md — nodefony-core

Carte d'entrée du dépôt, au format [AGENTS.md](https://agents.md), pour un agent de
codage qui arrive ici sans contexte. Elle **pointe**, elle ne recopie pas : chaque
ligne dit où trouver la vérité, jamais ce qu'elle contient.

---

## Ce que fait Nodefony, et pour qui

Un framework Node.js fullstack en TypeScript strict, ESM uniquement, où **HTTP et
WebSocket partagent la même route, la même session et le même pare-feu** : un même
contrôleur répond aux deux, sans pont, sans second serveur, sans dupliquer
l'authentification. Autour de cet axe : injection de dépendances, modules, pare-feu
applicatif, ORM multi-dialecte, constructeur de frontends (Vite), console
d'administration, et une ligne de commande qui génère le code conventionnel.

Il vise l'application métier dont le temps réel est un citoyen de premier rang —
API, WebSocket, écran et commandes dans un seul processus, un seul routeur, une
seule session.

---

## 🔴 Ce dépôt n'est pas ce qu'une application installe

Ce dépôt est le **dépôt de développement** du framework : un monorepo qui porte
aussi ses bancs de mesure, ses gabarits, ses procédures d'agent et ses retours
d'expérience. **Rien de tout cela n'entre dans une application.**

|                                      |                                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Une application minimale générée** | **quatre dépendances de production** — `nodefony`, `@nodefony/http`, `@nodefony/framework`, `zod`. Se constate : `src/nodefony/templates/app/base/package.json.tpl` |
| **Ce dépôt**                         | 20 paquets, 5 modules d'épreuve, ~7 700 tests, les bancs de charge et la chaîne de publication — aucun n'est une dépendance d'application                           |

> ⚠️ **Ne pas juger le produit sur ce dépôt.** Lire `src/` donne l'implémentation du
> framework, jamais la surface qu'une application utilise. Le monorepo, la branche de
> travail, les compétences d'agent, les retex : ce sont les outils du mainteneur.

**Pour évaluer le framework** — « est-ce une bonne base pour mon projet ? » :
[`README.md`](README.md), puis [`docs/index.md`](docs/index.md), puis générer une
application (`npm create nodefony@alpha <app>`) et lire ce qu'elle contient. Ne pas
descendre dans `src/` : la question ne s'y trouve pas.

**Pour travailler sur le framework** : tout le reste de ce fichier.

**La documentation voyage AVEC les paquets** : chaque paquet publie son dossier
`docs/` sur npm (`files: ["dist", "docs"]` ; le tarball de `@nodefony/http` porte
sept pages). Une fois l'application installée, tout se lit hors ligne depuis
`node_modules/@nodefony/<paquet>/docs/` — rien n'oblige à revenir sur un site ni
sur un hébergeur de code, et la version lue est celle qui est INSTALLÉE.

---

## État

Ces réserves portent sur la maturité de la **publication** et sur les moyens du
projet — pas sur le poids d'une application, mesuré ci-dessus.

|                           |                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Version**               | `10.0.0` (`package.json`)                                                                                                                                                                                                                                                                                                                  |
| **Publication npm**       | **préversion `10.0.0-alpha.7`**, les quinze paquets, sous le canal `alpha` SEULEMENT — `npm install nodefony` sert toujours `nodefony@7.0.2` (JavaScript). Les `@nodefony/*-bundle` de l'ère 7 sont dépréciés                                                                                                                              |
| **Branche par défaut**    | `main` — elle porte la **dernière publication** et n'avance qu'aux releases                                                                                                                                                                                                                                                                |
| **Branche de travail**    | `dev` — **c'est là que vit le code courant** ; `main` ne le reçoit qu'à la publication suivante                                                                                                                                                                                                                                            |
| **Tests**                 | ~7 700 quand toute l'infrastructure répond (`npm run test:all`)                                                                                                                                                                                                                                                                            |
| **Licence**               | Apache 2.0 — projet libre, développé bénévolement par une seule personne                                                                                                                                                                                                                                                                   |
| **Reste avant la stable** | les [jalons](https://github.com/nodefony/nodefony-core/milestones) portent le compte exact des tickets ouverts par version, et une échéance qui **glisse** — le compte fait foi, pas la date. Ce qui peut casser d'une version à l'autre, et ce qui reçoit des correctifs : [`docs/guides/compatibilite.md`](docs/guides/compatibilite.md) |

> ⚠️ **Lire `dev`, pas `main`**, pour toute question sur le code actuel. Le
> constater plutôt que le croire : `git rev-list --count origin/main..origin/dev`.

---

## Carte du dépôt

Le dépôt est **self-hosted** : la racine se comporte comme une application utilisateur
qui consomme le framework, ce qui permet de l'éprouver en marchant.

| Chemin                          | Ce qu'on y trouve                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/nodefony/`                 | le cœur — `Kernel`, conteneur d'injection, services, journalisation, CLI                                                |
| `src/packages/@nodefony/`       | les 20 paquets du framework — `http`, `framework`, `security`, `frontend`, `studio`, `orm-core`, `drizzle`, `realtime`… |
| `src/packages/create-nodefony/` | la porte d'entrée : `npm create nodefony@alpha <app>`                                                                   |
| `src/modules/`                  | les modules d'épreuve montés par l'application racine (`test`, quatre bancs de frontends, `mediasoup`)                  |
| `scripts/`                      | les automates du dépôt — contrôles, bancs, chaîne de publication (`scripts/release/`)                                   |
| `docs/`                         | la documentation humaine : guides, décisions d'architecture (`adr/`), performance, `index.md`                           |
| `.ai/`                          | ce qui est **généré** pour les agents — jamais édité à la main                                                          |
| `.claude/skills/`               | les procédures outillées du dépôt (publication, tickets, bancs, documentation)                                          |

Quinze de ces paquets sont publiables ; les autres portent `private: true`. La liste
ne se devine pas, elle se demande : `npm query .workspace`.

---

## Six commandes

```bash
npm install            # Node ≥ 24 requis
npm run build          # compile les workspaces modifiés (cache turbo)
npm run dev            # reconstruit le cœur à chaud (rolldown --watch)
npm test               # construit, puis lance TOUTES les suites du dépôt
npm run typecheck      # TypeScript strict, zéro erreur attendue
npm run test:all       # TOUT : conteneurs, build, unité, intégration — et le rapport
```

Pour lancer le serveur de développement, c'est `npx nodefony development` — pas
`npm run dev`, qui ne fait que reconstruire. Pour une boucle courte sur un module :
`cd src/packages/@nodefony/<m> && npx vitest run`.

`npm run test:all` démarre l'infrastructure manquante, pose les variables à votre
place et **dit ce qu'il n'a PAS testé**. Après un `git pull` ou un changement d'API
publique : `npm run clean && npm run build`, sinon un `dist/` périmé produit des
erreurs qui n'ont aucun rapport avec le code lu.

---

## Où vit la vérité

Un fichier écrit à la main vieillit ; un fichier généré ne le peut pas. La colonne de
droite dit à quelle **question** chacun répond.

| Fichier                                                                        | La question                                                                               |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| [`docs/index.md`](docs/index.md)                                               | par où entrer dans la documentation ?                                                     |
| [`.ai/BOARD.md`](.ai/BOARD.md)                                                 | _(généré)_ quels tickets sont ouverts, dans quel ordre ? **où en est le projet ?**        |
| [`docs/adr/`](docs/adr/README.md)                                              | pourquoi cette décision d'architecture, et qu'est-ce qui a été écarté ?                   |
| [`.ai/ENV.md`](.ai/ENV.md)                                                     | _(généré)_ quelle variable pose ce décor — et **que se passe-t-il si elle est absente ?** |
| [`.ai/symbols.json`](.ai/symbols.json)                                         | _(généré)_ qui étend, implémente ou importe ce symbole ? Où est-il défini ?               |
| `npx nodefony inspect schema <module>`                                         | _(exécuté)_ quelles clés de configuration existent, de quel type, et que font-elles ?     |
| `npx nodefony inspect config`                                                  | _(exécuté)_ quelle valeur est POSÉE aujourd'hui, et d'où vient-elle ?                     |
| [`docs/lexique.md`](docs/lexique.md)                                           | que veut dire ce terme dans ce dépôt ?                                                    |
| [`docs/guides/deux-paquets-nodefony.md`](docs/guides/deux-paquets-nodefony.md) | pourquoi `nodefony <cmd>` échoue là où `npm run dev` réussit, sur la MÊME app ?           |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                                           | comment proposer un changement ?                                                          |
| [`SECURITY.md`](SECURITY.md)                                                   | comment signaler une faille — jamais en ticket public                                     |

> 🔴 **Sur ce dépôt, un décor absent ne lève presque jamais : il fait sauter un banc, et
> un banc sauté compte comme vert.** Avant de conclure « les tests passent », lire ce
> que la suite déclare ne pas avoir exercé. La source unique des variables et des
> conteneurs est `vitest.gates.ts`, à la racine.

---

## Lire ce dépôt sans HTML

Les pages d'un hébergeur de code coûtent cher à charger et rendent mal en texte. Tout
fichier se lit brut :

```
https://raw.githubusercontent.com/nodefony/nodefony-core/dev/<chemin>
```

Exemple : `…/dev/docs/index.md`. Remplacer `dev` par `main` donne l'état publié, pas
l'état courant (voir **État** ci-dessus).

---

## Conventions non négociables

Elles sont **vérifiées par des contrôles**, pas seulement écrites : TypeScript strict
sans `any` ni `@ts-ignore` · ESM uniquement, `import` jamais `require()` · préfixe
`node:` sur les modules natifs · **identifiants du code en anglais, prose et messages
en français** · toute variable d'environnement lue par le framework se préfixe `NF_`
· messages de validation au format _Conventional Commits_.

Le détail par domaine vit dans le `CLAUDE.md` de chaque module, et les gates dans
`scripts/check-*.mjs`.

---

## Déléguer du travail à un autre agent

Les règles de coût, de choix de modèle et de sûreté — dont celles qui ont déjà coûté
du travail perdu — vivent dans [`docs/ia/delegation.md`](docs/ia/delegation.md).
