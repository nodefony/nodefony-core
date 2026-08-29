---
name: nodefony-migrate-schema
description: >
  Fait évoluer le schéma d'une base Nodefony et le porte en production, par les commandes
  `orm:generate` et `orm:migrate` — jamais par un `ALTER` écrit à la main ni par la suppression
  d'une base. Porte la lecture de l'état (que l'application tourne ou non), le plan avant le geste,
  les codes de refus et le geste que chacun appelle, les trois interdits qui cassent un historique,
  et le patron de déploiement où les migrations passent AVANT les exemplaires. À charger AVANT de
  modifier une entité déjà en base, ou avant de déployer un schéma changé.
  Déclencheurs : "j'ai ajouté un champ à une entité", "la colonne n'existe pas en base",
  "migrer le schéma", "orm:migrate", "orm:generate", "appliquer les migrations",
  "déployer un changement de schéma", "adopter une base existante",
  "réparer une migration en échec", "no such column".
metadata:
  nodefony-source-package: "@nodefony/devkit"
---

# nodefony-migrate-schema

> Ce fichier est un **pointeur**. Le contenu vit dans le paquet `@nodefony/devkit`, d'où il part
> sur npm : c'est le MÊME texte que reçoit l'utilisateur d'une application, et c'est ce qui
> garantit qu'un défaut s'y voit ici, chez quelqu'un qui peut le corriger. Ne l'édite pas à cet
> endroit — l'édition ne profiterait à personne.

**Lis maintenant `src/packages/@nodefony/devkit/skills/nodefony-migrate-schema/SKILL.md`** — et,
pour les codes de verdict exhaustifs, la référence qu'il désigne dans son propre dossier.

> Dans une application, ce même pointeur est posé par `nodefony ai:sync` et désigne
> `node_modules/@nodefony/devkit/skills/…`. Ici, dans le dépôt qui PRODUIT le paquet, il désigne
> la source.
