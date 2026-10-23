---
adr: 19
title: Studio — la console d'administration sur un déploiement dédié, les exemplaires publics sans elle
lang: fr
navTitle: Studio sur un déploiement dédié
date: 2026-10-23
status: accepted
deciders: [Christophe CAMENSULI]
tags: [studio, deploiement, kubernetes, securite, observabilite]
---

# ADR-0019 — Studio : la console d'administration sur un déploiement dédié, les exemplaires publics sans elle

📍 [Documentation](../index.md) › [Décisions d'architecture](README.md) › **ADR-0019**

## Statut

Accepté (2026-10-23). Mise en œuvre : #662 (l'interrupteur), #321 (les manifestes Kubernetes).
Périmètre recalé : #661 (la page des journaux).

## Contexte

Le gabarit d'application charge `@nodefony/studio` en `policy: "mandatory"`, sans condition
d'environnement. Chaque exemplaire de l'application sert donc la console, production comprise.

Sur un seul processus, ça ne pose aucun problème. Dès qu'on lance N exemplaires derrière un
répartiteur, les écrans de la console se rangent en deux familles :

| Famille               | Écrans                                                                                                                                                             | Avec N exemplaires                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **État partagé**      | routes, configuration, schéma, utilisateurs, journaux relus dans Loki ou OpenSearch                                                                                | justes : tous les exemplaires lisent la même source    |
| **État du processus** | supervision, journaux en direct du tampon mémoire, barre de debug, mémoire, fenêtre d'audit à chaud ([ADR-0005](0005-observabilite-prod-gate-env-audit-window.md)) | **un exemplaire pris au hasard**, et rien ne l'indique |

La seconde famille ment par omission : elle affiche des chiffres vrais, pour un processus que
l'utilisateur n'a pas choisi, et qui peut changer d'une requête à l'autre.

S'y ajoute la sécurité. Les exemplaires exposés au public portent la surface d'administration. Le
data plane exige une session, mais la page de la console s'affiche à un anonyme (le gabarit le
documente lui-même) : elle ne montre rien, et elle révèle que la console est là. En Zero Trust, une
surface qui ne sert à aucun visiteur public n'a pas à être servie aux visiteurs publics.

## Décision

1. **Une seule image.** Le déploiement d'administration et les exemplaires publics démarrent le
   même artefact, avec la même configuration et la même base. Seul l'environnement les distingue.
2. **Un déploiement `admin`** : une réplique, Studio chargé, **non exposé** (réseau privé, VPN,
   entrée interne ou `kubectl port-forward`). C'est là, et là seulement, qu'on administre.
3. **Un déploiement `app`** : N répliques, exposées, démarrées **sans** Studio par un interrupteur
   d'environnement (#662).
4. **Le défaut ne change pas.** Sans interrupteur, le Studio est chargé comme aujourd'hui. Un VPS,
   un processus unique et `nodefony cluster -w N` sur une machine restent tels quels.
5. **Le Studio n'agrège pas.** Les métriques de N exemplaires relèvent de Prometheus ou
   d'OpenTelemetry. Sur le déploiement dédié, les écrans « état du processus » décrivent le
   processus d'administration, et ne prétendent rien de plus.

## Conséquences

- **#662** ajoute l'interrupteur, lu par `env.ts` seul, et le test de démarrage sans Studio.
- **#321** rend deux déploiements au lieu d'un : `app` (sans Studio) et `admin` (une réplique, sans
  entrée publique).
- **#661** (page des journaux) : en production, la page s'appuie sur la source partagée (Loki ou
  OpenSearch). Elle n'a pas à présenter le tampon mémoire ni un direct « par exemplaire » comme s'ils
  décrivaient l'application.
- **ADR-0005, point 4, précisé** : la fenêtre d'audit à chaud reste propre à un processus. Ouverte
  depuis le Studio dédié, elle ne vise que lui. Pour atteindre les exemplaires publics, il faudra le
  « fan-out cluster » qu'ADR-0005 renvoie à plus tard : diffuser la COMMANDE d'audit à tous les
  exemplaires. Ce n'est pas une agrégation, donc le point 5 ne l'interdit pas. Ce n'est pas décidé
  ici non plus.
- `docs/guides/kubernetes.md` décrit les deux déploiements.
- **Piste, non décidée** : un résumé par exemplaire publié sur le canal temps réel partagé (Redis),
  que le Studio dédié afficherait sans interroger l'orchestrateur.

## Alternatives écartées

- **Agréger dans le Studio** : il faudrait lister les exemplaires (droit de lecture sur l'API de
  l'orchestrateur), les interroger un par un et fusionner leurs séries. Ce serait réinventer
  Prometheus, en moins bien, et donner à l'application un droit qu'elle n'a pas à porter.
- **Couper le Studio par défaut en production** : le plus sûr sur le papier, mais il retire la
  console à tous les déploiements à processus unique, qui en ont l'usage et ne souffrent d'aucun des
  deux défauts. Après la 10.0.0, inverser ce défaut serait une rupture
  ([politique de compatibilité](../guides/compatibilite.md)) : il ne se rediscute qu'à une majeure.
- **Une affinité de session pour viser un exemplaire** : le choix reste celui du répartiteur, pas de
  l'utilisateur, et la surface d'administration reste sur les exemplaires publics.
- **Une image d'administration distincte** : deux artefacts à bâtir, signer et garder alignés,
  pour un résultat qu'un interrupteur d'environnement donne sur une seule image.
