<!-- GÉNÉRÉ par le skill `nodefony-session` (scripts/board-snapshot.mjs).
     NE PAS ÉDITER À LA MAIN.
     La source est GitHub ; ce fichier n'en est qu'une empreinte, pour
     reprendre le travail hors ligne. L'éditer ferait diverger la copie
     de sa source, ce que ce fichier existe précisément pour empêcher. -->

# État du pilotage — empreinte des tickets

> Empreinte prise le **2026-11-20 13:02** (UTC).
> La **source** est le tableau de bord GitHub ; relire ici ne dispense pas de
> vérifier en ligne quand le réseau répond — une empreinte vieille de trois
> jours a manqué trois jours de travail.

## Jalons

> Les badges viennent de shields.io et se mettent à jour **tout seuls** : ils
> interrogent GitHub au moment où la page est lue, ils ne sont pas une photo.
> Ils ne peuvent pas vivre dans la description d'un jalon — mesuré le 09-06 :
> GitHub y rend le texte BRUT, ni tableau, ni image, ni gras.

| Jalon | Avancement | Fait | Reste | Échéance |
| --- | --- | ---: | ---: | --- |
| **10.0.x** | ![10.0.x](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/18?style=flat-square&label=) `██████░░░░` 55% | 6 | 5 | 2026-11-27 |
| **10.1.0** | ![10.1.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/2?style=flat-square&label=) `███░░░░░░░` 32% | 7 | 15 | 2026-12-28 |
| **10.2.0** | ![10.2.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/3?style=flat-square&label=) `█░░░░░░░░░` 11% | 1 | 8 | 2027-01-11 |
| **10.3.0** | ![10.3.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/12?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 12 | 2027-01-26 |
| **10.4.0** | ![10.4.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/13?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 8 | 2027-02-04 |
| **10.5.0** | ![10.5.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/14?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 10 | 2027-02-25 |
| **10.6.0** | ![10.6.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/15?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 5 | 2027-03-04 |
| **10.7.0** | ![10.7.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/16?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 2 | 2027-03-08 |
| **10.8.0** | ![10.8.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/17?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 5 | 2027-03-17 |
| **11.0.0** | ![11.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/4?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 1 | — |
| **12.0.0** | ![12.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/5?style=flat-square&label=) `██░░░░░░░░` 15% | 2 | 11 | — |
| **13.0.0** | ![13.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/9?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 2 | — |
| **outillage-agents** | ![outillage-agents](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/8?style=flat-square&label=) `██░░░░░░░░` 21% | 6 | 23 | — |

## ➡️ Le prochain dans l'ordre

**#794 — fix(http): libérer à coup sûr le scope d'un HEAD en HTTP/2**

Ordre 1.02 · P1 — figé à la création · 1 j · jalon 10.0.x · frise 2026-11-23 → 11-23

> Choisi dans le **jalon courant `10.0.x`**, qui a encore 5 tickets ouverts. Un ticket d'un jalon ULTÉRIEUR ne passe jamais devant, même mieux classé : l'ordre encode les dépendances, le jalon encode la livraison.

> L'ordre encode les **dépendances**, pas le moment : un ticket petit dont le
> contexte est déjà chargé se prend maintenant (skill `nodefony-ticket`).

## Jalon 10.0.x — 5 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 1.02 | P1 — figé à la création | 1 | 2026-11-23 → 11-23 | #794 | fix(http): libérer à coup sûr le scope d'un HEAD en HTTP/2 |
| 1.03 | P3 — fin de cycle | 1 | 2026-11-24 → 11-24 | #195 | fix(cli): ne plus compter deux fois les fichiers d'une cible imbriquée |
| 1.04 | P1 — figé à la création | 1 | 2026-11-25 → 11-25 | #196 | fix(orm): ne proposer un geste que si l'on a constaté qu'il s'applique |
| 1.05 | P1 — figé à la création | 1 | 2026-11-26 → 11-26 | #234 | fix(session): enregistrer le stockage Redis au démarrage |
| 1.06 | P1 — figé à la création | 1 | 2026-11-27 → 11-27 | #241 | fix(security): dériver le domaine des passkeys de l'hôte validé |

## Jalon 10.1.0 — 15 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 2.01 | P2 — décision | 1 | 2026-11-30 → 11-30 | #725 | feat(realtime): empêcher le rejeu d'une éjection sur un canal durable |
| 2.02 | P2 — décision | 11.25 | 2026-11-30 → 12-28 | #621 | feat(realtime): compléter le temps réel : binaire, canaux privés, voix |
| 2.03 | P2 — décision | 5 | 2026-11-30 → 12-28 | #694 | feat(http): servir des services gRPC dans le pipeline HTTP/2 |
| 2.04 | P2 — décision | 2 | 2026-12-01 → 12-02 | #745 | feat(realtime): s'abonner et publier sur un canal depuis un client gRPC |
| 2.05 | P3 — fin de cycle | 1 | 2026-12-03 → 12-03 | #697 | feat(http): exposer la réflexion et la santé gRPC standard |
| 2.06 | P2 — décision | 2 | 2026-12-04 → 12-07 | #764 | feat(cli): générer un service gRPC avec create controller --kind grpc |
| 2.07 | P2 — décision | 1 | 2026-12-08 → 12-08 | #75 | chore(core): trancher l'héritage des dépendances déclarées |
| 2.08 | P2 — décision | 1 | 2026-12-09 → 12-09 | #239 | feat(realtime): déclarer un canal paramétré par un motif |
| 2.09 | P3 — fin de cycle | 3 | 2026-11-30 → 12-28 | #714 | feat(realtime): livrer les ajouts différés des ADR temps réel |
| 2.1 | P3 — fin de cycle | 2 | 2026-12-10 → 12-11 | #715 | feat(realtime): reprendre un abonnement depuis un curseur |
| 2.11 | P3 — fin de cycle | 1 | 2026-12-14 → 12-14 | #716 | feat(realtime): signaler la fin d'un canal par realtime:closed |
| 2.12 | P2 — décision | 3 | 2026-12-15 → 12-17 | #712 | perf(http): ne payer par requête que le travail que la route consomme |
| 2.13 | P2 — décision | 2 | 2026-12-18 → 12-21 | #717 | feat(realtime): rejouer les messages manqués à la reconnexion |
| 2.14 | P2 — décision | 2 | 2026-12-22 → 12-23 | #751 | feat(http): mesurer l'aller-retour de chaque WebSocket au ping/pong |
| 2.15 | P2 — décision | 2 | 2026-12-24 → 12-28 | #743 | feat(http): compter les requêtes par route dans la supervision |

## Jalon 10.2.0 — 8 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 3.01 | P2 — décision | 1 | 2026-12-29 → 12-29 | #584 | feat(client): proposer les passkeys dans le champ identifiant |
| 3.02 | P1 — figé à la création | 5 | 2026-12-29 → 2027-01-11 | #268 | feat(security): rendre Keycloak utilisable de bout en bout pour la connexion externe |
| 3.03 | P1 — figé à la création | 2 | 2026-12-30 → 12-31 | #522 | feat(studio): ajouter un écran Identité pour les fournisseurs de connexion |
| 3.04 | P2 — décision | 1 | 2027-01-04 → 01-04 | #523 | feat(security): guider la connexion Keycloak et brancher plusieurs realms |
| 3.05 | P2 — décision | 2 | 2027-01-05 → 01-06 | #524 | feat(security): lier un compte existant à Keycloak et exporter les comptes |
| 3.06 | P1 — figé à la création | 1 | 2027-01-07 → 01-07 | #224 | feat(core): lire les secrets ailleurs que dans l'environnement |
| 3.07 | P1 — figé à la création | 1 | 2027-01-08 → 01-08 | #235 | feat(security): journaliser les événements d'authentification |
| 3.08 | P2 — décision | 1 | 2027-01-11 → 01-11 | #244 | feat(security): trancher le serveur d'autorisation et le mTLS |

## Jalon 10.3.0 — 12 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 4.01 | P3 — fin de cycle | 1 | 2027-01-12 → 01-12 | #28 | feat(config): surcharger la config d'application par l'environnement |
| 4.02 | P2 — décision | 1 | 2027-01-13 → 01-13 | #662 | feat(studio): réserver la console d'administration à un déploiement dédié |
| 4.03 | P3 — fin de cycle | 1 | 2027-01-14 → 01-14 | #66 | feat(orm): exposer et borner la taille du pool de connexions |
| 4.04 | P2 — décision | 1 | 2027-01-15 → 01-15 | #321 | feat(scaffold): rendre l'application déployable en Kubernetes |
| 4.045 | P2 — décision | 2 | — | #800 | feat(http): servir HTTPS en production avec un certificat monté |
| 4.05 | P3 — fin de cycle | 1 | 2027-01-18 → 01-18 | #50 | docs(tutoriels): écrire la partie 2, jusqu'au déploiement |
| 4.06 | P1 — figé à la création | 1 | 2027-01-19 → 01-19 | #225 | feat(kernel): ouvrir un point d'accroche avant et après le drain |
| 4.07 | P1 — figé à la création | 1 | 2027-01-20 → 01-20 | #226 | feat(kernel): avertir quand l'arrêt gracieux ne pourra pas se faire |
| 4.08 | P2 — décision | 1 | 2027-01-21 → 01-21 | #228 | feat(observabilite): exposer les métriques au format Prometheus |
| 4.09 | P3 — fin de cycle | 1 | 2027-01-22 → 01-22 | #229 | feat(scaffold): livrer un Dockerfile de développement |
| 4.1 | P2 — décision | 1 | 2027-01-25 → 01-25 | #231 | feat(cli): interroger les journaux depuis un terminal |
| 4.11 | P2 — décision | 1 | 2027-01-26 → 01-26 | #233 | feat(kernel): faire tourner un travail batch et périodique sans serveur |

## Jalon 10.4.0 — 8 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 5.01 | P1 — figé à la création | 5.5 | 2027-01-27 → 02-04 | #83 | feat(notification): doter le framework de l'envoi de messages sortants |
| 5.02 | P2 — décision | 0.5 | 2027-01-27 → 01-27 | #89 | docs(notification): faire la veille des canaux de communication attendus |
| 5.03 | P1 — figé à la création | 1 | 2027-01-28 → 01-28 | #84 | feat(mail): créer le module et son service d'envoi |
| 5.04 | P1 — figé à la création | 1 | 2027-01-29 → 01-29 | #85 | feat(mail): composer un courriel depuis un gabarit |
| 5.05 | P1 — figé à la création | 1 | 2027-02-01 → 02-01 | #86 | feat(mail): envoyer un courriel en ligne de commande |
| 5.06 | P1 — figé à la création | 1 | 2027-02-02 → 02-02 | #87 | test(mail): éprouver l'envoi contre un vrai serveur de test |
| 5.07 | P1 — figé à la création | 1 | 2027-02-03 → 02-03 | #88 | docs(mail): documenter la configuration et le premier envoi |
| 5.08 | P3 — fin de cycle | 1 | 2027-02-04 → 02-04 | #70 | feat(webhooks): séparer les événements métier du journal d'audit |

## Jalon 10.5.0 — 10 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 6.01 | P1 — figé à la création | 1 | 2027-02-05 → 02-05 | #349 | feat(cli): ajouter une brique à une application déjà générée |
| 6.02 | P3 — fin de cycle | 1 | 2027-02-08 → 02-08 | #64 | perf(dev): supprimer les 45 secondes de build au démarrage |
| 6.03 | P3 — fin de cycle | 1 | 2027-02-09 → 02-09 | #67 | feat(orm): capturer le contexte des requêtes qui échouent |
| 6.04 | P2 — décision | 1 | 2027-02-10 → 02-10 | #131 | refactor(frontend): composer les plugins Vite en un seul endroit |
| 6.05 | P2 — décision | 1 | 2027-02-11 → 02-11 | #161 | feat(devkit): mesurer si un agent clôt un ticket sans humain |
| 6.06 | P2 — décision | 1 | 2027-02-12 → 02-12 | #232 | feat(cli): compléter les commandes de module et leur couverture |
| 6.07 | P2 — décision | 1 | 2027-02-15 → 02-15 | #511 | perf(orm): préparer une fois les écritures du repository Drizzle |
| 6.08 | P2 — décision | 1 | 2027-02-16 → 02-16 | #240 | chore(frontend): trancher si frontend:create doit exister |
| 6.09 | P2 — décision | 2 | 2027-02-17 → 02-18 | #502 | feat(orm): propager la transaction en cours sans la passer à chaque dépôt |
| 6.1 | P2 — décision | 5 | 2027-02-19 → 02-25 | #692 | perf(cli): faire porter Vite par le superviseur de développement |

## Backlog — aucune date promise · 54 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 6.037 | P2 — décision | 1 | — | #555 | feat(studio): montrer en direct la contre-pression du temps réel |
| 6.11 | P1 — figé à la création | 1 | — | #513 | feat(scaffold): mettre les apps générées en quarantaine de 3 jours |
| 7.09 | P2 — décision | 3.25 | — | #445 | test(ecosysteme): éprouver le framework par un module tiers temps réel |
| 7.091 | P2 — décision | 0.25 | — | #446 | test(ecosysteme): figer l'énoncé de l'épreuve et sa grille de notation |
| 7.092 | P2 — décision | 0.5 | — | #447 | test(ecosysteme): journaliser pas à pas ce que fait l'agent |
| 7.093 | P1 — figé à la création | 1 | — | #448 | test(ecosysteme): jouer l'épreuve sans jamais guider l'agent |
| 7.094 | P1 — figé à la création | 0.5 | — | #449 | test(ecosysteme): trier ce qui remonte au cœur du framework |
| 7.095 | P1 — figé à la création | 1 | — | #450 | feat(ecosysteme): livrer le tableau blanc comme module installable |
| 7.56 | P2 — décision | 1 | — | #738 | docs(rfc): relire contre le code les nouvelles révisions d'OAuth 2.1 |
| 117 | P3 — fin de cycle | 1 | — | #71 | feat(security): rendre la hiérarchie de rôles extensible |
| 157 | P2 — décision | 0.5 | — | #412 | fix(devkit-bench): faire entrer le motif d'une sonde dans son empreinte |
| 158 | P1 — figé à la création | 1 | — | #371 | test(devkit-bench): constater qu'un agent écrit hors de son décor |
| 162 | P3 — fin de cycle | 1 | — | #242 | feat(core): instruire le besoin de transports TCP, UDP et Unix |
| 163 | P3 — fin de cycle | 1 | — | #243 | feat(realtime): servir le bus par Kafka pour la rétention |
| 164 | P2 — décision | 1 | — | #557 | feat(studio): simuler les écrans de l'atelier IA d'après le livre blanc |
| 164.5 | P3 — fin de cycle | 5 | — | #637 | feat(framework): servir une API GraphQL dérivée des services CRUD |
| 901 | P2 — décision | 0.5 | — | #387 | fix(test): sonder les deux ports avant de lancer le banc de démarrage |
| 902 | P2 — décision | 1 | — | #422 | feat(ci): regarder l'écran d'une application générée à chaque publication |
| 903 | P2 — décision | 1 | — | #423 | test(release): éprouver la surface npm telle que le registre la sert |
| 904 | P3 — fin de cycle | 1 | — | #436 | docs(corpus): mettre au standard les neuf pages internes non publiées |
| 905 | P2 — décision | 22.5 | — | #460 | feat(broadcast): boîtier d'apport et hub, une app à rôles |
| 907 | P2 — décision | 1 | — | #499 | feat(orm): dessiner les liens logiques des tables du framework vers l'utilisateur |
| 909 | P2 — décision | 1 | — | #501 | feat(core): typer la résolution des services par leur nom |
| 910 | P2 — décision | 1 | — | #504 | feat(runtime): porter l'identité d'une requête dans un traitement différé |
| 912 | P2 — décision | 2 | — | #532 | chore(scripts): fiabiliser et alléger l'outillage du dépôt |
| 913 | P3 — fin de cycle | 5 | — | #534 | feat(cli): ajouter barre figée et invite au serveur de développement |
| 913.4 | P2 — décision | 2 | — | #538 | feat(cli): ajouter une invite de commandes sous la barre d'état |
| 913.5 | P3 — fin de cycle | 3 | — | #539 | feat(cli): brancher un assistant à modèle local sur l'invite |
| 914 | P2 — décision | 2 | — | #558 | docs: rendre lisibles les schémas verticaux trop hauts de la doc |
| 915 | P3 — fin de cycle | 2 | — | #567 | feat(realtime): ajouter WebTransport comme second transport temps réel |
| 916 | P3 — fin de cycle | 1 | — | #603 | feat(http): ouvrir le défi ACME dans la config proxy générée |
| 917 | P3 — fin de cycle | 6 | — | #612 | refactor(core): finir le découpage du noyau, une famille à la fois |
| 918 | P2 — décision | 2 | — | #615 | feat(cli): ajouter un type de champ chiffré au repos à create entity |
| 919 | P2 — décision | 3 | — | #616 | feat(cli): exprimer une énumération partagée entre tables dans create entity |
| 921 | P3 — fin de cycle | 2 | — | #651 | feat(ai): relayer ai:stdio vers le serveur de dev quand il tourne |
| 922 | P2 — décision | 1 | — | #556 | feat(studio): suivre en direct le transcript d'un agent de code |
| 924 | P3 — fin de cycle | 9 | — | #668 | refactor(types): supprimer les conversions de type restantes |
| 924.1 | P3 — fin de cycle | 1 | — | #669 | refactor(core): typer la fusion d'objets extend, qui rend any |
| 924.2 | P2 — décision | 2 | — | #670 | refactor(core): typer les services du conteneur par leur nom |
| 924.3 | P3 — fin de cycle | 1 | — | #671 | refactor(core): vérifier les données reçues au lieu de forcer leur type |
| 924.4 | P3 — fin de cycle | 1 | — | #672 | refactor(framework): vérifier les données reçues au lieu de forcer leur type |
| 924.5 | P3 — fin de cycle | 1 | — | #673 | refactor(http): vérifier les données reçues au lieu de forcer leur type |
| 924.6 | P3 — fin de cycle | 1 | — | #674 | refactor(drizzle): vérifier les lignes lues en base au lieu de forcer leur type |
| 924.7 | P3 — fin de cycle | 1 | — | #675 | refactor(studio): vérifier les réponses du serveur au lieu de forcer leur type |
| 924.8 | P3 — fin de cycle | 1 | — | #676 | refactor(types): vérifier les données reçues dans les petits paquets |
| 925 | P3 — fin de cycle | 1 | — | #718 | feat(http): écouter sur un fichier de socket Unix derrière un relais local |
| 925.1 | P2 — décision | 1 | — | #722 | perf(studio): ne plus redessiner toute la page Supervision à chaque mesure |
| 925.2 | P3 — fin de cycle | 2 | — | #721 | feat(studio): montrer dans la console ce que le binaire fait gagner |
| 925.3 | P3 — fin de cycle | 2 | — | #729 | feat(security): signaler les puits DOM, interdire les scripts créés |
| 925.4 | P3 — fin de cycle | 2 | — | #730 | feat(security): partager et afficher les rapports de violation CSP |
| 925.5 | P3 — fin de cycle | 1 | — | #728 | feat(client): signer les styles créés à l'exécution sous CSP stricte |
| 925.6 | P3 — fin de cycle | 1 | — | #768 | perf(http): mesurer le coût du journal d'accès par requête |
| 926 | P1 — figé à la création | 0.5 | — | #541 | test(cli): valider le plein écran du serveur de dev sous Windows |
| 927 | P3 — fin de cycle | 1 | — | #788 | ci(cli): éprouver sur GitLab l'image arm64 de la CI générée |

## Jalon 10.6.0 — 5 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 7.01 | P3 — fin de cycle | 1 | 2027-02-26 → 02-26 | #79 | refactor(studio): dériver l'affichage des rôles servis par le serveur |
| 7.02 | P3 — fin de cycle | 1 | 2027-03-01 → 03-01 | #69 | feat(studio): signaler visiblement un serveur en dérogation |
| 7.03 | P3 — fin de cycle | 1 | 2027-03-02 → 03-02 | #68 | feat(studio): garder les préférences d'affichage côté serveur |
| 7.04 | P3 — fin de cycle | 1 | 2027-03-03 → 03-03 | #74 | feat(studio): éditer la configuration d'un module à chaud |
| 7.05 | P2 — décision | 1 | 2027-03-04 → 03-04 | #236 | feat(studio): livrer la vue Services et l'audit en direct |

## Jalon 10.7.0 — 2 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 8.01 | P2 — décision | 1 | 2027-03-05 → 03-05 | #378 | feat(core): rendre traduisibles les textes du framework |
| 8.02 | P2 — décision | 1 | 2027-03-08 → 03-08 | #379 | feat(core): servir une application dans la langue du visiteur |

## Jalon 10.8.0 — 5 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 9.01 | P2 — décision | 1.5 | 2027-03-09 → 03-10 | #624 | docs(adr): figer le contrat du modèle média partagé et de la capture |
| 9.02 | P2 — décision | 1 | 2027-03-11 → 03-11 | #625 | feat(media): livrer le modèle média partagé, sans dépendance au navigateur |
| 9.03 | P2 — décision | 0.5 | 2027-03-12 → 03-12 | #631 | test(media): lancer les tests audio dans un vrai navigateur |
| 9.04 | P2 — décision | 3 | 2027-03-15 → 03-17 | #626 | feat(realtime): transcrire la voix du navigateur sur la socket |
| 9.05 | P2 — décision | 3 | 2027-03-09 → 03-17 | #459 | feat(media): modèle média partagé et moteur audio du navigateur |

## Jalon 11.0.0 — 1 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 10.01 | P1 — figé à la création | 2 | — | #685 | chore(drizzle): monter Drizzle vers sa version 1 |

## Jalon 12.0.0 — 11 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 11.01 | P1 — figé à la création | 1 | — | #245 | chore(ia): refaire l'état de l'art avant de coder la couche IA |
| 11.02 | P1 — figé à la création | 1 | — | #246 | feat(llm): brancher un fournisseur de modèle réel |
| 11.03 | P2 — décision | 1 | — | #247 | feat(vector): éprouver le stockage de vecteurs en réel |
| 11.04 | P2 — décision | 1 | — | #248 | feat(rag): éprouver la recherche augmentée de bout en bout |
| 11.05 | P2 — décision | 1 | — | #249 | feat(memory): persister la mémoire d'un agent |
| 11.06 | P2 — décision | 1 | — | #250 | feat(agent): arrêter le modèle de boucle d'un agent |
| 11.07 | P1 — figé à la création | 1 | — | #252 | feat(agent-guard): borner ce qu'un agent a le droit de faire |
| 11.08 | P1 — figé à la création | 11 | — | #492 | feat(tenant): isoler les organisations qui partagent une même application |
| 11.09 | P3 — fin de cycle | 3 | — | #503 | feat(mcp): exposer une route annotée comme outil pour les agents |
| 11.1 | P2 — décision | 2 | — | #550 | feat(mcp): rendre un serveur MCP publiable au registre officiel |
| 11.11 | P2 — décision | 4 | — | #619 | feat(ai): converser à la voix avec un agent, sur la socket |

## Jalon 13.0.0 — 2 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 12.01 | P2 — décision | 3 | — | #583 | feat(security): authentifier par certificat client sur carte à puce |
| 12.02 | P3 — fin de cycle | 5 | — | #798 | feat(media): faire entrer un téléphone dans une salle de conférence |

## Jalon outillage-agents — 22 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 90.01 | P1 — figé à la création | 2 | 2026-11-23 → 11-24 | #796 | chore(pilotage): ouvrir une branche et une demande de fusion avant tout code |
| 90.02 | P2 — décision | 1 | — | #334 | test(agents): mesurer ce que les skills changent pour un agent seul |
| 90.03 | P2 — décision | 1 | — | #205 | refactor(repo): ranger scripts/ et dire où va un contrôle neuf |
| 90.04 | P3 — fin de cycle | 1 | — | #31 | chore: refermer les bogues résolus et les tests jamais lancés |
| 90.05 | P2 — décision | 3 | — | #63 | test(bancs): rendre chaque banc indépendant du décor partagé |
| 90.06 | P3 — fin de cycle | 1 | — | #76 | test(bancs): constater le décor avant de lancer les suites |
| 90.07 | P3 — fin de cycle | 1 | — | #77 | test(bancs): donner à chaque banc son propre compte |
| 90.08 | P3 — fin de cycle | 1 | — | #78 | test(core): remplacer les seuils absolus des tests de performance |
| 90.09 | P3 — fin de cycle | 1 | — | #72 | test(http): mesurer la tenue mémoire sur plusieurs heures |
| 90.1 | P3 — fin de cycle | 1 | — | #73 | perf(http): rejouer le profil processeur du chemin chaud |
| 90.11 | P3 — fin de cycle | 1 | — | #65 | test(paquets): rapatrier les preuves de bout en bout dans leur paquet |
| 90.12 | P2 — décision | 1 | — | #171 | ci(workflows): refuser une étape multi-commandes sans shell |
| 90.13 | P2 — décision | 1 | — | #172 | fix(pilotage): ne pas mettre « en cours » sur un commit de pilotage |
| 90.14 | P2 — décision | 1 | — | #188 | test(mcp): dire POURQUOI l'outil de diagnostic n'a pas répondu |
| 90.15 | P3 — fin de cycle | 1 | — | #216 | fix(bench): poser la base que trois bancs multi-pods exigent |
| 90.16 | P3 — fin de cycle | 1 | — | #217 | fix(bench): réparer trois bancs de charge hors service |
| 90.17 | P2 — décision | 1 | — | #791 | test(realtime): mesurer la grâce de présence sur des comptes connectés |
| 90.18 | P3 — fin de cycle | 1 | — | #792 | chore(test): préfixer NF_ les variables lues par les bancs |
| 90.19 | P2 — décision | 1 | — | #403 | test(perf): mesurer le banc ORM applicatif sur les trois dialectes |
| 90.2 | P2 — décision | 1 | — | #237 | test(studio): éprouver la console d'administration de bout en bout |
| 90.21 | P1 — figé à la création | 1 | — | #658 | test(devkit-bench): réenregistrer la référence du banc sur le modèle courant |
| 90.22 | P2 — décision | 1 | — | #793 | perf(http): expliquer l'écart de mesure HTTP/1.1 entre deux bancs |

