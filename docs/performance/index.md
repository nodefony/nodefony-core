---
title: "Performance — mesures, méthode, et ce qu'on n'a pas mesuré"
lang: fr
module: "global"
topic: perf-index
section: "Performance"
audience: [developer, devops]
tags: [performance, benchmark, mesure, methode, orm, express]
status: stable
updated: "2026-08-07"
source: "docs/performance/"
---

📍 [Documentation](../index.md) › **Performance**

> Ce dossier rassemble treize sessions de mesure sur le pipeline HTTP, l'ORM et les WebSockets de
> Nodefony : ce qui a été profilé, ce qui a été gagné, **ce qui a été annulé après avoir été
> écrit**, et les instruments qui ont menti avant qu'on s'en aperçoive. Il est écrit pour être
> contesté : chaque chiffre porte son décor, son protocole et le script qui le rejoue.

## Par où commencer

Trois parcours, selon ce que vous cherchez.

### « Je veux savoir ce que ça vaut »

1. [Face aux autres](comparaisons.md) — l'écart avec Express passe de ×1,61 à **×1,07** selon ce
   que l'application fait réellement. Commencez par là : c'est le chiffre le plus honnête.
2. [Dimensionnement](dimensionnement.md) — ce que tient un pod, et comment en déduire un nombre de
   pods.
3. [Ce qui reste ouvert](ouvertures.md) — ce que ces chiffres ne disent pas.

### « Je veux comprendre où part le temps »

1. [Le pipeline HTTP](pipeline-http.md) — profilage, huit lots livrés, un lot rejeté par sa propre
   mesure.
2. [ORM et bases de données](orm.md) — l'escalier complet : le framework coûte 86 µs, une lecture
   en coûte 936.
3. [La boucle d'événements](boucle-evenements.md) — pourquoi la base la plus lente n'est pas celle
   qui plafonne le serveur.

### « Je veux mesurer moi-même »

1. [Méthode de mesure](methode.md) — le protocole, les gardes, le lexique.
2. [Le décor ment plus souvent que le code](instruments.md) — les pièges à connaître **avant** de
   lancer un banc.
3. L'outillage versionné : `.claude/skills/nodefony-load-test/` — bancs, scripts et protocoles.

## Ce que ce dossier établit

| Question                                                 | Réponse mesurée                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| Le framework est-il le goulot d'une application réelle ? | **Non** — sa couche ORM pèse moins de 2,5 % du CPU d'une route de lecture |
| Combien coûte le service rendu par requête ?             | −19,5 % de débit pour Express quand on le lui fait rendre aussi           |
| L'écart avec Express, à travail et ORM égaux ?           | **×1,07**                                                                 |
| Le ramasse-miettes est-il le problème ?                  | **Non** — 0,93 à 1,3 % selon l'instrument, trois mesures concordantes     |
| Qu'est-ce qui plafonne un processus ?                    | Le **blocage** de la boucle, jamais la latence                            |
| Qu'est-ce qui plafonnait les mesures PostgreSQL ?        | La **virtualisation réseau** de Docker Desktop, pas la base               |

## Les pages

### [`methode`](methode.md) — Méthode de mesure

Ce qu'on mesure et pourquoi, le décor exact, les contrôles de validité, le protocole A/B et ses
trois issues, le lexique. **À lire avant tout le reste** si vous comptez rejouer une mesure ou
contester un chiffre.

### [`pipeline-http`](pipeline-http.md) — Le pipeline HTTP

Le profilage runtime et ce qu'il a réfuté de l'analyse statique. Les lots livrés — en-têtes,
entropie amortie, promesses à vide, URL analysée une fois — pour **+8,9 %** puis ~+14 % de plus.
Le lot **annulé après implémentation** parce que son A/B rendait du bruit. Le routeur, qui divise
par neuf le nombre de motifs exécutés **sans revendiquer un gain de débit**. Et la preuve que rien
n'a régressé côté WebSocket.

### [`boucle-evenements`](boucle-evenements.md) — La boucle d'événements

Le chapitre le plus utile pour choisir un magasin de données. Une base répond en 22 µs, l'autre en
1 232 — et c'est la **première** qui bloque le serveur. La démonstration par le rappel armé, le
coût CPU réel d'un pilote, et pourquoi un pilote synchrone s'effondre au 99ᵉ centile.

### [`orm`](orm.md) — ORM et bases de données

L'escalier marche par marche, le profilage qui **innocente** la couche du framework, et le lot de
mémoïsation des requêtes préparées : **+86 et +96 %** sur SQLite, **+61 et +59 %** sur PostgreSQL.
Y compris l'attribution fausse qu'on avait d'abord publiée, et pourquoi elle est retirée.

### [`comparaisons`](comparaisons.md) — Face aux autres

`node:http` nu, Fastify, Express, Express équipé du même travail, Express avec le même ORM. Trois
niveaux de comparaison, du plus flatteur pour la concurrence au plus honnête — avec la **preuve
d'équité** qui montre que la cible Nodefony ne traîne aucun travail dormant.

### [`instruments`](instruments.md) — Le décor ment plus souvent que le code

Quatre instruments faux sur une seule question, deux explications réfutées dont notre propre
correction, un processeur bridé qui fausse d'un facteur 1,62, un indexeur système, une locale qui
rend une garde muette. **Aucun verdict faux de ce chantier ne venait d'une erreur sur le code.**

### [`dimensionnement`](dimensionnement.md) — Dimensionnement

Les constantes d'un pod, l'escalier de concurrence, le calcul du nombre de pods, les plafonds
WebSocket, et ce que fait le serveur quand il ne suit plus : il **dégrade, il ne tombe pas**.

### [`ouvertures`](ouvertures.md) — Ce qui reste ouvert

Les trous de mesure, les absolus non transposables, les pistes écartées **avec leur condition de
réouverture**, et ce qui relève d'un choix d'architecture plutôt que d'une optimisation.

## Comment lire les chiffres absolus

Les mesures sont produites sur une machine de développement, générateur de charge **co-localisé**
avec le serveur. Les valeurs absolues sont donc basses pour tout le monde, y compris pour les
points de comparaison. **Seuls les rapports entre eux sont exploitables**, à décor identique et
dans la même fenêtre. Un chiffre de ce dossier ne se cite pas hors de son contexte.

Les mesures impliquant PostgreSQL portent une réserve supplémentaire : elles sont prises derrière
une virtualisation réseau qui coûte un facteur 3,7 sur le chemin de la base. Les A/B restent
valides, **les absolus ne se transposent pas**.

## Rejouer une mesure

```bash
# Nodefony, mono-processus production, cible de banc du framework
BENCH_DUR=10 BENCH_URL=http://127.0.0.1:5151/nodefony/kernel/bench \
  bash .claude/skills/nodefony-load-test/scripts/bench-ab-mono.sh <label> NF_BENCH_ROUTE=1

# Points de comparaison (mêmes routes, même charge utile)
BENCH_DUR=10 bash .claude/skills/nodefony-load-test/bench-frameworks/bench.sh fastify 5163

# Ce qu'un pilote de base coûte à la boucle d'événements
node .claude/skills/nodefony-load-test/scripts/db-backend-cost.mjs --prove
```

La cible `/nodefony/kernel/bench` n'existe **que** sous `NF_BENCH_ROUTE=1` : aucune surface n'est
ajoutée en production par défaut.

## Pour aller plus loin

- 📚 [Toute la documentation](../index.md)
- 🧰 Outillage de mesure : `.claude/skills/nodefony-load-test/`
- 📄 [Rapport du 23 juillet](2026-07-23-pipeline-http-vs-express-fastify.md) — **remplacé** :
  l'analyse statique qui a ouvert le chantier, conservée parce que la mesure l'a en partie
  contredite. Ses chiffres ne sont plus une référence.
