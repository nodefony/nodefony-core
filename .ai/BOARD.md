<!-- GÉNÉRÉ par le skill `nodefony-session` (scripts/board-snapshot.mjs).
     NE PAS ÉDITER À LA MAIN.
     La source est GitHub ; ce fichier n'en est qu'une empreinte, pour
     reprendre le travail hors ligne. L'éditer ferait diverger la copie
     de sa source, ce que ce fichier existe précisément pour empêcher. -->

# État du pilotage — empreinte des tickets

> Empreinte prise le **2026-10-28 22:14** (UTC).
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
| **10.0.0-beta** | ![10.0.0-beta](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/7?style=flat-square&label=) `█████████░` 92% | 209 | 18 | 2026-11-12 |
| **10.0.0** | ![10.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/1?style=flat-square&label=) `██████████` 98% | 135 | 3 | 2026-11-15 |
| **10.1.0** | ![10.1.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/2?style=flat-square&label=) `█░░░░░░░░░` 11% | 5 | 41 | 2026-12-15 |
| **10.2.0** | ![10.2.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/3?style=flat-square&label=) `░░░░░░░░░░` 3% | 1 | 31 | — |
| **11.0.0** | ![11.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/4?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 7 | — |
| **12.0.0** | ![12.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/5?style=flat-square&label=) `██░░░░░░░░` 15% | 2 | 11 | — |
| **13.0.0** | ![13.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/9?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 1 | — |
| **outillage-agents** | ![outillage-agents](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/8?style=flat-square&label=) `███████░░░` 71% | 5 | 2 | — |

## ➡️ Le prochain dans l'ordre

**#621 — feat(realtime): compléter le temps réel : binaire, canaux privés, voix**

Ordre 6.03 · P2 — décision · 27 j · jalon 10.0.0-beta · frise 2026-10-29 → 11-16

> Choisi dans le **jalon courant `10.0.0-beta`**, qui a encore 18 tickets ouverts. Un ticket d'un jalon ULTÉRIEUR ne passe jamais devant, même mieux classé : l'ordre encode les dépendances, le jalon encode la livraison.

> L'ordre encode les **dépendances**, pas le moment : un ticket petit dont le
> contexte est déjà chargé se prend maintenant (skill `nodefony-ticket`).

## Jalon 10.1.0 — 41 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 1 | P1 — figé à la création | 6 | 2026-11-16 → 12-15 | #83 | feat(notification): doter le framework de l'envoi de messages sortants |
| 2 | P2 — décision | 1 | 2026-11-26 → 11-26 | #378 | feat(core): rendre traduisibles les textes du framework |
| 3.93 | P1 — figé à la création | 5 | — | #268 | feat(security): rendre Keycloak utilisable de bout en bout pour la connexion externe |
| 3.945 | P1 — figé à la création | 2 | — | #522 | feat(studio): ajouter un écran Identité pour les fournisseurs de connexion |
| 3.95 | P2 — décision | 1 | — | #523 | feat(security): guider la connexion Keycloak et brancher plusieurs realms |
| 3.955 | P2 — décision | 2 | — | #524 | feat(security): lier un compte existant à Keycloak et exporter les comptes |
| 17 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #84 | feat(mail): créer le module et son service d'envoi |
| 18 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #85 | feat(mail): composer un courriel depuis un gabarit |
| 19 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #86 | feat(mail): envoyer un courriel en ligne de commande |
| 20 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #87 | test(mail): éprouver l'envoi contre un vrai serveur de test |
| 21 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #88 | docs(mail): documenter la configuration et le premier envoi |
| 46 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #349 | feat(cli): ajouter une brique à une application déjà générée |
| 100 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #28 | feat(config): surcharger la config d'application par l'environnement |
| 110 | P2 — décision | 3 | 2026-11-16 → 12-15 | #63 | test(bancs): rendre chaque banc indépendant du décor partagé |
| 113 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #78 | test(core): remplacer les seuils absolus des tests de performance |
| 115 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #66 | feat(orm): exposer et borner la taille du pool de connexions |
| 116 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #67 | feat(orm): capturer le contexte des requêtes qui échouent |
| 116.3 | P2 — décision | 1 | — | #662 | feat(studio): réserver la console d'administration à un déploiement dédié |
| 116.5 | P2 — décision | 1 | 2026-11-16 → 12-15 | #321 | feat(scaffold): rendre l'application déployable en Kubernetes |
| 120 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #72 | test(http): mesurer la tenue mémoire sur plusieurs heures |
| 121 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #73 | perf(http): rejouer le profil processeur du chemin chaud |
| 134 | P2 — décision | 1 | 2026-11-16 → 12-15 | #171 | ci(workflows): refuser une étape multi-commandes sans shell |
| 135 | P2 — décision | 1 | 2026-11-16 → 12-15 | #172 | fix(pilotage): ne pas mettre « en cours » sur un commit de pilotage |
| 139 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #195 | fix(cli): ne plus compter deux fois les fichiers d'une cible imbriquée |
| 140 | P2 — décision | 1 | 2026-11-16 → 12-15 | #196 | fix(orm): ne proposer un geste que si l'on a constaté qu'il s'applique |
| 141 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #216 | fix(bench): poser la base que trois bancs multi-pods exigent |
| 142 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #217 | fix(bench): réparer trois bancs de charge hors service |
| 143 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #224 | feat(core): lire les secrets ailleurs que dans l'environnement |
| 144 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #225 | feat(kernel): ouvrir un point d'accroche avant et après le drain |
| 145 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #226 | feat(kernel): avertir quand l'arrêt gracieux ne pourra pas se faire |
| 150.6 | P2 — décision | 1 | 2026-11-16 → 12-15 | #403 | test(perf): mesurer le banc ORM applicatif sur les trois dialectes |
| 154 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #234 | fix(session): enregistrer le stockage Redis au demarrage |
| 155 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #235 | feat(security): journaliser les evenements d'authentification |
| 156 | P2 — décision | 1 | 2026-11-16 → 12-15 | #511 | perf(orm): préparer une fois les écritures du repository Drizzle |
| 157 | P2 — décision | 0.5 | 2026-11-27 → 11-27 | #412 | fix(devkit-bench): faire entrer le motif d'une sonde dans son empreinte |
| 158 | P1 — figé à la création | 1 | 2026-11-30 → 11-30 | #371 | test(devkit-bench): constater qu'un agent écrit hors de son décor |
| 164 | P2 — décision | 1 | — | #557 | feat(studio): simuler les écrans de l'atelier IA d'après le livre blanc |
| 170 | P2 — décision | 4.5 | — | #694 | feat(http): servir des services gRPC dans le pipeline HTTP/2 |
| 170.1 | P2 — décision | 3 | — | #695 | feat(http): déclarer et servir un service gRPC depuis un module |
| 170.2 | P2 — décision | 0.5 | — | #696 | fix(cli): router gRPC vers h2c dans la config nginx générée |
| 170.3 | P3 — fin de cycle | 1 | — | #697 | feat(http): exposer la réflexion et la santé gRPC standard |

## Jalon 13.0.0 — 1 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 1 | P2 — décision | 3 | — | #583 | feat(security): authentifier par certificat client sur carte à puce |

## Jalon 11.0.0 — 7 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 1 | P2 — décision | 1 | — | #584 | feat(client): proposer les passkeys dans le champ identifiant |
| 2 | P1 — figé à la création | 2 | — | #685 | chore(drizzle): monter Drizzle vers sa version 1 |
| 162 | P3 — fin de cycle | 1 | — | #242 | feat(core): instruire le besoin de transports TCP, UDP et Unix |
| 163 | P3 — fin de cycle | 1 | — | #243 | feat(realtime): servir le bus par Kafka pour la retention |
| 164 | P2 — décision | 1 | — | #244 | feat(security): trancher le serveur d'autorisation et le mTLS |
| 164.5 | P3 — fin de cycle | 5 | — | #637 | feat(framework): servir une API GraphQL dérivée des services CRUD |
| 165 | P2 — décision | 15 | — | #459 | feat(media): modèle média partagé et moteur audio du navigateur |

## Jalon outillage-agents — 2 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 2 | P2 — décision | 1 | — | #334 | test(agents): mesurer ce que les skills changent pour un agent seul |
| 90 | P2 — décision | 1 | — | #205 | refactor(repo): ranger scripts/ et dire où va un contrôle neuf |

## Jalon 10.0.0-beta — 18 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 6.03 | P2 — décision | 27 | 2026-10-29 → 11-16 | #621 | feat(realtime): compléter le temps réel : binaire, canaux privés, voix |
| 6.031 | P2 — décision | 2 | 2026-10-29 → 10-29 | #627 | docs(adr): figer l'architecture de la socket temps réel |
| 6.032 | P2 — décision | 2 | 2026-10-30 → 10-30 | #628 | feat(realtime): tenir le serveur au même contrat que le client |
| 6.033 | P2 — décision | 3 | 2026-11-02 → 11-02 | #618 | feat(realtime): router les trames binaires vers leur canal |
| 6.034 | P2 — décision | 1 | 2026-11-03 → 11-03 | #622 | feat(realtime): admettre un abonné de canal par son identité |
| 6.035 | P2 — décision | 2 | 2026-11-04 → 11-04 | #623 | feat(realtime): identifier les abonnés d'un canal côté serveur |
| 6.0355 | P2 — décision | 1 | 2026-11-05 → 11-05 | #631 | test(media): lancer les tests audio dans un vrai navigateur |
| 6.036 | P2 — décision | 2 | 2026-11-06 → 11-06 | #629 | test(realtime): garder l'isomorphisme par des contrôles qui mordent |
| 6.037 | P2 — décision | 1 | 2026-11-09 → 11-09 | #555 | feat(studio): montrer en direct la contre-pression du temps réel |
| 6.04 | P2 — décision | 7 | 2026-11-10 → 11-16 | #445 | test(ecosysteme): éprouver le framework par un module tiers temps réel |
| 6.041 | P2 — décision | 1 | 2026-11-10 → 11-10 | #446 | test(ecosysteme): figer l'énoncé de l'épreuve et sa grille de notation |
| 6.042 | P2 — décision | 1 | 2026-11-11 → 11-11 | #447 | test(ecosysteme): journaliser pas à pas ce que fait l'agent |
| 6.043 | P1 — figé à la création | 1 | 2026-11-12 → 11-12 | #448 | test(ecosysteme): jouer l'épreuve sans jamais guider l'agent |
| 6.044 | P1 — figé à la création | 1 | 2026-11-13 → 11-13 | #449 | test(ecosysteme): trier ce qui remonte au cœur du framework |
| 6.045 | P1 — figé à la création | 3 | 2026-11-16 → 11-16 | #450 | feat(ecosysteme): livrer le tableau blanc comme module installable |
| 6.1 | P1 — figé à la création | 0.5 | 2026-11-17 → 11-17 | #541 | test(cli): valider le plein écran du serveur de dev sous Windows |
| 6.12 | P2 — décision | 1 | 2026-11-19 → 11-19 | #89 | docs(notification): faire la veille des canaux de communication attendus |
| 6.2 | P1 — figé à la création | 3 | 2026-11-20 → 11-20 | #659 | docs(performance): remesurer les pages de performance avant la release |

## Backlog — aucune date promise · 32 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 6.11 | P1 — figé à la création | 1 | — | #513 | feat(scaffold): mettre les apps générées en quarantaine de 3 jours |
| 901 | P2 — décision | 0.5 | — | #387 | fix(test): sonder les deux ports avant de lancer le banc de démarrage |
| 902 | P2 — décision | 1 | — | #422 | feat(ci): regarder l'écran d'une application générée à chaque publication |
| 903 | P2 — décision | 1 | — | #423 | test(release): éprouver la surface npm telle que le registre la sert |
| 904 | P3 — fin de cycle | 1 | — | #436 | docs(corpus): mettre au standard les neuf pages internes non publiées |
| 905 | P2 — décision | 22.5 | — | #460 | feat(broadcast): boîtier d'apport et hub, une app à rôles |
| 907 | P2 — décision | 1 | — | #499 | feat(orm): dessiner les liens logiques des tables du framework vers l'utilisateur |
| 909 | P2 — décision | 1 | — | #501 | feat(core): typer la résolution des services par leur nom |
| 910 | P2 — décision | 1 | — | #504 | feat(runtime): porter l'identité d'une requête dans un traitement différé |
| 912 | P2 — décision | 2 | — | #532 | chore(scripts): fiabiliser et alléger l'outillage du dépôt |
| 913 | P3 — fin de cycle | 11 | — | #534 | feat(cli): ajouter barre figée et invite au serveur de développement |
| 913.4 | P2 — décision | 2 | — | #538 | feat(cli): ajouter une invite de commandes sous la barre d'état |
| 913.5 | P3 — fin de cycle | 3 | — | #539 | feat(cli): brancher un assistant à modèle local sur l'invite |
| 913.6 | P2 — décision | 5 | — | #692 | perf(cli): faire porter Vite par le superviseur de développement |
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
| 924.9 | P2 — décision | 0.5 | — | #687 | fix(orm): ne plus générer en production les tables d'un module de dev |

## Jalon 10.2.0 — 31 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 12 | P2 — décision | 1 | — | #379 | feat(core): servir une application dans la langue du visiteur |
| 101 | P3 — fin de cycle | 1 | — | #31 | chore: refermer les bogues résolus et les tests jamais lancés |
| 111 | P3 — fin de cycle | 1 | — | #76 | test(bancs): constater le décor avant de lancer les suites |
| 112 | P3 — fin de cycle | 1 | — | #77 | test(bancs): donner à chaque banc son propre compte |
| 114 | P3 — fin de cycle | 1 | — | #64 | perf(dev): supprimer les 45 secondes de build au démarrage |
| 117 | P3 — fin de cycle | 1 | — | #71 | feat(security): rendre la hiérarchie de rôles extensible |
| 118 | P3 — fin de cycle | 1 | — | #79 | refactor(studio): dériver l'affichage des rôles servis par le serveur |
| 119 | P3 — fin de cycle | 1 | — | #69 | feat(studio): signaler visiblement un serveur en dérogation |
| 122 | P2 — décision | 1 | — | #75 | chore(core): trancher l'héritage des dépendances déclarées |
| 123 | P2 — décision | 1 | — | #131 | refactor(frontend): composer les plugins Vite en un seul endroit |
| 124 | P2 — décision | 1 | — | #161 | feat(devkit): mesurer si un agent clôt un ticket sans humain |
| 130 | P3 — fin de cycle | 1 | — | #70 | feat(webhooks): séparer les événements métier du journal d'audit |
| 131 | P3 — fin de cycle | 1 | — | #68 | feat(studio): garder les préférences d'affichage côté serveur |
| 132 | P3 — fin de cycle | 1 | — | #74 | feat(studio): éditer la configuration d'un module à chaud |
| 133 | P3 — fin de cycle | 1 | — | #65 | test(paquets): rapatrier les preuves de bout en bout dans leur paquet |
| 137 | P2 — décision | 1 | — | #188 | test(mcp): dire POURQUOI l'outil de diagnostic n'a pas répondu |
| 142 | P3 — fin de cycle | 1 | — | #50 | docs(tutoriels): écrire la partie 2, jusqu'au déploiement |
| 147 | P2 — décision | 1 | — | #228 | feat(observabilite): exposer les métriques au format Prometheus |
| 148 | P3 — fin de cycle | 1 | — | #229 | feat(scaffold): livrer un Dockerfile de développement |
| 151 | P2 — décision | 1 | — | #231 | feat(cli): interroger les journaux depuis un terminal |
| 152 | P2 — décision | 1 | — | #232 | feat(cli): compléter les commandes de module et leur couverture |
| 153 | P2 — décision | 1 | — | #233 | feat(kernel): faire tourner un travail batch et periodique sans serveur |
| 156 | P2 — décision | 1 | — | #236 | feat(studio): livrer la vue Services et l'audit en direct |
| 157 | P2 — décision | 1 | — | #237 | test(studio): eprouver la console d'administration de bout en bout |
| 160 | P2 — décision | 1 | — | #240 | chore(frontend): trancher si frontend:create doit exister |
| 161 | P2 — décision | 1 | — | #241 | fix(security): deriver le domaine des passkeys de l'hote valide |
| 162 | P2 — décision | 2 | — | #502 | feat(orm): propager la transaction en cours sans la passer à chaque dépôt |
| 162.6 | P2 — décision | 1.5 | — | #624 | docs(adr): figer le contrat du modèle média partagé et de la capture |
| 163.05 | P2 — décision | 1 | — | #239 | feat(realtime): declarer un canal parametre par un motif |
| 163.3 | P2 — décision | 1 | — | #625 | feat(media): livrer le modèle média partagé, sans dépendance au navigateur |
| 163.6 | P2 — décision | 3 | — | #626 | feat(realtime): transcrire la voix du navigateur sur la socket |

## Jalon 10.0.0 — 3 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 58.5 | P1 — figé à la création | 1 | 2026-11-23 → 11-23 | #658 | test(devkit-bench): réenregistrer la référence du banc sur le modèle courant |
| 59 | P1 — figé à la création | 1 | 2026-11-24 → 11-24 | #47 | docs(release): faire suivre à l'accueil ce qui est réellement publié |
| 60 | P3 — fin de cycle | 1 | 2026-11-25 → 11-25 | #27 | chore(release): publier les paquets de la version 10 sur npm |

## Jalon 12.0.0 — 11 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 165 | P1 — figé à la création | 1 | — | #245 | chore(ia): refaire l'etat de l'art avant de coder la couche IA |
| 166 | P1 — figé à la création | 1 | — | #246 | feat(llm): brancher un fournisseur de modele reel |
| 167 | P2 — décision | 1 | — | #247 | feat(vector): eprouver le stockage de vecteurs en reel |
| 168 | P2 — décision | 1 | — | #248 | feat(rag): eprouver la recherche augmentee de bout en bout |
| 169 | P2 — décision | 1 | — | #249 | feat(memory): persister la memoire d'un agent |
| 170 | P2 — décision | 1 | — | #250 | feat(agent): arreter le modele de boucle d'un agent |
| 172 | P1 — figé à la création | 1 | — | #252 | feat(agent-guard): borner ce qu'un agent a le droit de faire |
| 173 | P1 — figé à la création | 11 | — | #492 | feat(tenant): isoler les organisations qui partagent une même application |
| 174 | P3 — fin de cycle | 3 | — | #503 | feat(mcp): exposer une route annotée comme outil pour les agents |
| 175 | P2 — décision | 2 | — | #550 | feat(mcp): rendre un serveur MCP publiable au registre officiel |
| 176 | P2 — décision | 4 | — | #619 | feat(ai): converser à la voix avec un agent, sur la socket |

