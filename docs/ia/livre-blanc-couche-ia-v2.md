---
title: "Nodefony — l'IA générative souveraine, sur un socle temps réel"
type: livre blanc
version: 0.2 (brouillon de travail)
audience: pair technique (ingénieur, chercheur en IA) et décideur
auteur: Christophe Camensuli
date: 2026-06-17
licence: CeCILL-B (open source)
---

# L'IA générative, sans que les données quittent vos murs

> En environnement sensible — défense, industrie, services régulés — l'IA générative
> reste bloquée à la porte : les données ne doivent pas partir vers un cloud étranger.
> Nodefony est conçu pour lever ce verrou — faire tourner des agents IA puissants, en
> restant entièrement chez soi.

## En une page

Mettre une IA générative en production, c'est aujourd'hui assembler à la main trois mondes
séparés : un serveur web, une bibliothèque d'IA, et une couche de gouvernance bricolée
par-dessus. En environnement sensible, s'ajoute une contrainte que peu d'outils savent
tenir : **rien ne doit sortir**.

Nodefony prend le problème à l'envers : serveur, temps réel et gouvernance des données
sont **le même framework**, dans le même langage, capable de tourner **intégralement sur
site**. J'ai construit et éprouvé ce socle pendant plusieurs années — il est opérationnel
et testé. La couche IA proprement dite — agents, mémoire, recherche documentaire — reste à
concevoir. Ce document est honnête sur ce point, et c'est précisément l'invitation :
**bâtir ces briques sur des fondations propres, ouvertes et souveraines.**

---

## 1. Le problème, tel que je le vis

Un prototype d'IA qui marche dans un notebook n'est pas un produit. Le porter en production
demande trois couches que les écosystèmes actuels fournissent séparément :

- **un serveur** capable de renvoyer la réponse du modèle au fil de l'eau, sans laisser
  l'utilisateur devant un écran figé ;
- **une orchestration** des agents et des outils qu'ils appellent, qui soit testable et
  maîtrisée ;
- **une gouvernance** : d'où vient cette réponse, quelles données ont transité, qui valide
  une action sensible, le modèle tourne-t-il chez moi ou ailleurs.

Chaque jointure entre ces trois mondes est une dette et un angle mort. Et en environnement
sensible, une quatrième contrainte domine tout : **les données ne doivent pas sortir.**
C'est le mur contre lequel l'IA générative se cogne aujourd'hui dans la défense et
l'industrie.

---

## 2. Ce que j'ai déjà construit

Nodefony est un framework Node.js fullstack, écrit en TypeScript. Un seul langage, du
navigateur jusqu'au serveur. Ce qui est en place, testé et opérationnel :

- des **serveurs web natifs** (HTTP, HTTPS, HTTP/2) et le **temps réel** (WebSocket)
  traités comme des citoyens de première classe, dans le même contexte ;
- une **injection de dépendances** — autrement dit, chaque brique est un service isolé,
  remplaçable et testable, pas un bloc monolithique ;
- la **sécurité** (pare-feu applicatif, authentification, contrôle d'accès par rôles), les
  **sessions**, l'**accès aux bases de données** ;
- un **tableau de bord d'administration** — le Studio — qui donne à voir en direct l'état
  du système.

Ce socle est le fruit de plusieurs années de travail. Je le dis sans détour : **c'est lui
qui est mûr.** C'est la fondation, pas la décoration.

---

## 3. Le temps réel et le fullstack : le bon terrain pour l'IA

Un modèle de langage ne répond pas d'un bloc : il produit sa réponse mot après mot. Pour
que l'utilisateur voie le texte se former en direct, il faut un **canal temps réel** entre
le modèle et l'écran. Ce canal — le WebSocket — est au cœur de Nodefony **depuis
l'origine**, pas ajouté après coup. Le streaming d'un modèle est, presque mot pour mot, le
cas d'usage pour lequel j'ai conçu cette dualité HTTP + temps réel.

Le **fullstack** fait le reste : un seul flux continu, sans couture ni traduction, du token
produit par le modèle jusqu'au composant qui l'affiche. Là où d'autres assemblent un
serveur Python, une passerelle et un front séparé, Nodefony tient **toute la chaîne dans un
même runtime**. Pour une application d'IA, c'est le bon terrain.

---

## 4. La souveraineté, par construction

La souveraineté n'est pas un mode de déploiement qu'on activerait à la fin. Elle est dans
l'architecture :

- tout peut tourner **en local, voire en air-gap** : un modèle hébergé sur site (par
  exemple via Ollama), une base de recherche locale, **zéro appel sortant** ;
- le choix du fournisseur de modèle est une **frontière explicite**, décidée par
  configuration : on sait, noir sur blanc, quelle donnée part où, et chez qui. Les modèles
  européens et locaux sont des options de premier rang, pas des sous-traitants tolérés ;
- chaque action — appel de modèle, décision d'agent — peut être **tracée et journalisée**,
  de bout en bout.

Données qui ne sortent pas, sources traçables, journal d'audit : ce sont aussi les
fondations concrètes d'une **mise en conformité** (RGPD, AI Act), obtenues par
l'architecture plutôt que rajoutées en pansement.

---

## 5. La couche IA : le terrain à bâtir

Voilà où j'en suis — et où je cherche un pair.

Le socle est prêt. La couche IA, elle, **reste à concevoir** : l'orchestration des agents
(comment un agent dirige son propre raisonnement, appelle des outils, délègue à des
sous-agents), la mémoire (court et long terme), la recherche documentaire (le _retrieval_),
l'accès unifié aux modèles, les garde-fous d'exécution. Aujourd'hui, ce sont des
**esquisses**, pas une architecture figée. Et je l'assume comme une force, pas comme un
manque.

Car ces questions ne sont pas que de l'ingénierie — ce sont de **vraies questions de
fond**. Quand un agent doit-il aller chercher une information, et comment juger qu'il a bien
cherché ? Comment évaluer la qualité d'une réponse ? Comment faire collaborer plusieurs
agents sans que l'ensemble dérive ? C'est un terrain de **recherche** autant que de code —
et c'est exactement pour ça que je le partage.

Travailler ici, c'est un luxe rare : **partir d'une page blanche, mais posée sur des
fondations solides et testées.** Pas de dette à réparer, pas de serveur à réécrire, pas de
gouvernance à bricoler — tout cela est déjà là. Il reste à concevoir le plus intéressant.

Un aperçu du terrain de jeu : parce que l'observabilité et le tableau de bord partagent les
mêmes données, un agent pourrait demain **lire l'état du système lui-même**, l'expliquer,
le diagnostiquer — le framework qui s'introspecte. Ce genre d'idée attend qu'on la
construise.

C'est l'invitation de ce document : **bâtir cette couche, ensemble, sur des bases saines.**

---

## 6. Ce que l'on peut démontrer

Pas besoin d'attendre que tout soit fini pour le prouver. Une démonstration modeste suffit à
valider toute la thèse — une **tranche fine qui traverse la pile** de bout en bout :

> Un assistant qui répond à une question métier **en temps réel**, le texte se formant à
> l'écran ; ses réponses s'appuient sur un **corpus interne** et **citent leurs sources** ;
> le tout tourne **à 100 % en local**, sans qu'aucune donnée ne sorte ; **chaque échange est
> tracé**.

Petit périmètre, mais il démontre l'essentiel : **IA, temps réel et souveraineté réunis dans
un seul runtime.** C'est ce que je propose de montrer.

---

## 7. Une invitation

Nodefony ne cherche pas à concurrencer les producteurs de modèles ni les bibliothèques
d'IA. Il fournit le **cadre** qui les met au travail dans une application réelle — avec le
temps réel, l'orchestration et la **souveraineté dans l'ADN**.

Le socle est mûr. La couche IA est à concevoir. Ce n'est pas un produit fini que je
présente : c'est une **fondation ouverte et souveraine**, et une invitation à bâtir dessus.

_Projet open source sous licence CeCILL-B — [github.com/nodefony/nodefony-core](https://github.com/nodefony/nodefony-core). Échanges bienvenus : ccamensuli@gmail.com._
