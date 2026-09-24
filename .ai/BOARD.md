<!-- GÉNÉRÉ par le skill `nodefony-session` (scripts/board-snapshot.mjs).
     NE PAS ÉDITER À LA MAIN.
     La source est GitHub ; ce fichier n'en est qu'une empreinte, pour
     reprendre le travail hors ligne. L'éditer ferait diverger la copie
     de sa source, ce que ce fichier existe précisément pour empêcher. -->

# État du pilotage — empreinte des tickets

> Empreinte prise le **2026-09-24 07:56** (UTC).
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
| **10.0.0-alpha** | ![10.0.0-alpha](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/6?style=flat-square&label=) `█████████░` 93% | 145 | 11 | 2026-09-24 |
| **10.0.0-beta** | ![10.0.0-beta](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/7?style=flat-square&label=) `████░░░░░░` 35% | 23 | 42 | 2026-10-10 |
| **10.0.0** | ![10.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/1?style=flat-square&label=) `██████████` 99% | 134 | 2 | 2026-11-15 |
| **10.1.0** | ![10.1.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/2?style=flat-square&label=) `█░░░░░░░░░` 14% | 5 | 31 | 2026-12-15 |
| **10.2.0** | ![10.2.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/3?style=flat-square&label=) `░░░░░░░░░░` 4% | 1 | 27 | — |
| **11.0.0** | ![11.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/4?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 5 | — |
| **12.0.0** | ![12.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/5?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 8 | — |
| **outillage-agents** | ![outillage-agents](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/8?style=flat-square&label=) `███████░░░` 67% | 4 | 2 | — |

## ➡️ Le prochain dans l'ordre

**#457 — fix(studio): réparer les trois manquements d'accessibilité du tableau de bord ORM**

Ordre 4.13 · P2 — décision · 1 j · jalon 10.0.0-alpha · frise 2026-09-24 → 09-24

> Choisi dans le **jalon courant `10.0.0-alpha`**, qui a encore 11 tickets ouverts. Un ticket d'un jalon ULTÉRIEUR ne passe jamais devant, même mieux classé : l'ordre encode les dépendances, le jalon encode la livraison.

> L'ordre encode les **dépendances**, pas le moment : un ticket petit dont le
> contexte est déjà chargé se prend maintenant (skill `nodefony-ticket`).

## Jalon 10.0.0-beta — 42 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 1.01 | P1 — figé à la création | 1 | 2026-10-06 → 10-06 | #293 | build(release): cesser de réécrire les types au moment du publish |
| 1.02 | P2 — décision | 1 | 2026-10-07 → 10-07 | #275 | fix(release): écarter du changelog les commits qui n'atteignent aucun installeur |
| 1.03 | P2 — décision | 1 | 2026-10-08 → 10-08 | #312 | chore(release): rendre le lot de publication annulable |
| 1.04 | P0 — bloque le reste | 1 | 2026-10-09 → 10-09 | #175 | chore(release): publier la beta depuis la forge, pas à la main |
| 1.05 | P2 — décision | 1 | 2026-10-12 → 10-12 | #259 | ci(release): publier l'image sur le registre de GitHub, sans aucun secret |
| 2.01 | P1 — figé à la création | 1 | 2026-10-13 → 10-13 | #215 | fix(build): réparer le contrôle de format du code généré |
| 2.02 | P2 — décision | 1 | 2026-10-14 → 10-14 | #104 | test(cli): un seul processus pour vérifier la forme du code généré |
| 2.03 | P1 — figé à la création | 1 | 2026-10-15 → 10-15 | #20 | test(security): attaquer les paquets publiés avant leur sortie |
| 2.04 | P1 — figé à la création | 1 | 2026-10-16 → 10-16 | #294 | test(cli): éprouver l'installation d'une app avec pnpm, yarn et bun |
| 2.05 | P1 — figé à la création | 1 | 2026-10-19 → 10-19 | #351 | fix(bundler): garder le framework hors du bundle d'un module |
| 2.06 | P2 — décision | 0.5 | 2026-10-20 → 10-20 | #425 | fix(scaffold): bâtir l'application avant de contrôler son image dans la chaîne GitLab |
| 3.01 | P1 — figé à la création | 3 | 2026-10-21 → 10-23 | #268 | feat(security): rendre Keycloak utilisable de bout en bout pour la connexion externe |
| 3.02 | P0 — bloque le reste | 1 | 2026-10-22 → 10-22 | #269 | test(security): éprouver la connexion OpenID Connect contre un vrai Keycloak |
| 3.03 | P1 — figé à la création | 1 | 2026-10-23 → 10-23 | #270 | fix(security): refuser au démarrage une configuration de fournisseur incomplète |
| 3.04 | P2 — décision | 1 | 2026-10-26 → 10-26 | #272 | docs(security): documenter le branchement d'un Keycloak, du realm au premier login |
| 4.01 | P2 — décision | 0.5 | 2026-10-27 → 10-27 | #396 | fix(orm): refuser orm:generate si une entité n'a pas pu être lue |
| 4.02 | P1 — figé à la création | 0.5 | 2026-10-28 → 10-28 | #401 | fix(portabilite): faire importer par URL les dix chemins qui lèvent sous Windows |
| 4.03 | P1 — figé à la création | 1 | 2026-10-29 → 10-29 | #313 | fix(cli): resservir la vraie erreur de démarrage, pas celle de la dernière tentative |
| 4.04 | P1 — figé à la création | 1 | 2026-10-30 → 10-30 | #314 | fix(orm): ne pas replier sur un dialecte que les entités ne parlent pas |
| 4.05 | P2 — décision | 1 | 2026-11-02 → 11-02 | #352 | fix(http): empêcher un frontal de retenir un flux d'événements |
| 4.06 | P2 — décision | 1 | 2026-11-03 → 11-03 | #139 | fix(security): ne plus laisser de sessions et jetons sans propriétaire |
| 4.07 | P2 — décision | 1 | 2026-11-04 → 11-04 | #62 | fix(cli): sonder les ports réellement utilisés par l'application |
| 4.08 | P2 — décision | 0.5 | 2026-11-05 → 11-05 | #427 | fix(frontend): stabiliser le cas du décalage de port, intermittent sur macOS et Windows |
| 4.09 | P1 — figé à la création | 1 | 2026-11-05 → 11-05 | #451 | fix(client): cesser d'ignorer en silence les trames binaires reçues |
| 4.1 | P2 — décision | 1 | — | #472 | test(ci): stabiliser trois suites qui rougissent en passe complète |
| 5.01 | P2 — décision | 1 | 2026-11-06 → 11-06 | #159 | docs(api): publier une référence d'API générée par paquet |
| 5.02 | P2 — décision | 1 | 2026-11-09 → 11-09 | #359 | docs(corpus): recaler les 433 ancres fichier:ligne qui ont dérivé |
| 5.03 | P2 — décision | 1 | 2026-11-10 → 11-10 | #406 | docs(modules): publier les 8 règles de dev backend qu'aucune page ne porte |
| 5.04 | P2 — décision | 1 | 2026-11-11 → 11-11 | #407 | docs(modules): publier les 15 règles de dev frontend qu'aucune page ne porte |
| 5.05 | P2 — décision | 1 | 2026-11-12 → 11-12 | #213 | build(scripts): typechecker les outils du dépôt, aujourd'hui hors de tout tsconfig |
| 5.06 | P2 — décision | 0.5 | 2026-11-13 → 11-13 | #399 | test(http): rendre la base Redis dans l'état où la suite l'a trouvée |
| 5.07 | P2 — décision | 0.5 | 2026-11-16 → 11-16 | #400 | docs(tests): sortir les boots CLI du lot dit non disruptif |
| 5.08 | P1 — figé à la création | 1 | 2026-11-17 → 11-17 | #371 | test(devkit-bench): constater qu'un agent écrit hors de son décor |
| 5.09 | P0 — bloque le reste | 1 | 2026-11-18 → 11-18 | #372 | fix(devkit-bench): chercher la zone de firewall où elle vit vraiment |
| 5.1 | P2 — décision | 0.5 | 2026-11-19 → 11-19 | #412 | fix(devkit-bench): faire entrer le motif d'une sonde dans son empreinte |
| 5.11 | P2 — décision | 1 | 2026-11-20 → 11-20 | #428 | feat(devkit): contrôler la dérive du corpus du skill de déploiement |
| 6.01 | P2 — décision | 7 | 2026-11-23 → 12-01 | #445 | test(ecosysteme): éprouver le framework par un module tiers temps réel |
| 6.02 | P2 — décision | 1 | 2026-11-23 → 11-23 | #446 | test(ecosysteme): figer l'énoncé de l'épreuve et sa grille de notation |
| 6.03 | P2 — décision | 1 | 2026-11-24 → 11-24 | #447 | test(ecosysteme): journaliser pas à pas ce que fait l'agent |
| 6.04 | P1 — figé à la création | 1 | 2026-11-25 → 11-25 | #448 | test(ecosysteme): jouer l'épreuve sans jamais guider l'agent |
| 6.05 | P1 — figé à la création | 1 | 2026-11-26 → 11-26 | #449 | test(ecosysteme): trier ce qui remonte au cœur du framework |
| 6.06 | P1 — figé à la création | 3 | 2026-11-27 → 12-01 | #450 | feat(ecosysteme): livrer le tableau blanc comme module installable |

## Jalon outillage-agents — 2 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 2 | P2 — décision | 1 | — | #334 | test(agents): mesurer ce que les skills changent pour un agent seul |
| 90 | P2 — décision | 1 | — | #205 | refactor(repo): ranger scripts/ et dire où va un contrôle neuf |

## Jalon 10.0.0-alpha — 11 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 4.13 | P2 — décision | 1 | 2026-09-24 → 09-24 | #457 | fix(studio): réparer les trois manquements d'accessibilité du tableau de bord ORM |
| 4.14 | P2 — décision | 0.5 | 2026-09-24 → 09-24 | #461 | fix(orm): ne plus annoncer un échec de connexion quand le serveur refuse le schéma |
| 4.2 | P2 — décision | 1 | — | #468 | feat(studio): montrer les types de champ du moteur à la création |
| 4.3 | P1 — figé à la création | 1 | — | #469 | fix(mediasoup): déclarer son connecteur au lieu de l'ouvrir dans son code |
| 4.4 | P2 — décision | 0.5 | — | #470 | feat(doctor): signaler un connecteur ORM que personne n'a déclaré |
| 4.5 | P2 — décision | 1 | — | #471 | feat(cli): demander les champs d'une entité un par un dans le terminal |
| 4.6 | P2 — décision | 1 | — | #467 | feat(mongoose): refuser la suppression d'un parent encore référencé |
| 57 | P2 — décision | 0.5 | 2026-09-24 → 09-24 | #443 | test(scaffold): lier la route de connexion des tests générés à sa source |
| 58 | P2 — décision | 1 | 2026-09-24 → 09-24 | #444 | test(devkit-bench): éprouver le code généré d'une relation sur un vrai schéma |
| 158 | P2 — décision | 1 | 2026-09-24 → 09-24 | #238 | test(orm): prouver la parite de contrat entre Mongoose et Drizzle |
| 159 | P2 — décision | 0.5 | 2026-09-24 → 09-24 | #458 | docs(readme): orienter l'évaluateur vers une application générée |

## Jalon 10.1.0 — 31 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 12 | P2 — décision | 1 | 2026-11-24 → 11-28 | #378 | feat(core): rendre traduisibles les textes du framework |
| 15 | P1 — figé à la création | 6 | 2026-11-16 → 12-15 | #83 | feat(notification): doter le framework de l'envoi de messages sortants |
| 16 | P2 — décision | 1 | 2026-11-16 → 12-15 | #89 | docs(notification): faire la veille des canaux de communication attendus |
| 17 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #84 | feat(mail): créer le module et son service d'envoi |
| 18 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #85 | feat(mail): composer un courriel depuis un gabarit |
| 19 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #86 | feat(mail): envoyer un courriel en ligne de commande |
| 20 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #87 | test(mail): éprouver l'envoi contre un vrai serveur de test |
| 21 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #88 | docs(mail): documenter la configuration et le premier envoi |
| 46 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #349 | feat(cli): ajouter une brique à une application déjà générée |
| 46.5 | P1 — figé à la création | 1 | — | #462 | feat(cli): ajouter mcp:stdio pour les agents qui lancent leur serveur |
| 100 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #28 | feat(config): surcharger la config d'application par l'environnement |
| 110 | P2 — décision | 3 | 2026-11-16 → 12-15 | #63 | test(bancs): rendre chaque banc indépendant du décor partagé |
| 113 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #78 | test(core): remplacer les seuils absolus des tests de performance |
| 115 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #66 | feat(orm): exposer et borner la taille du pool de connexions |
| 116 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #67 | feat(orm): capturer le contexte des requêtes qui échouent |
| 116.5 | P2 — décision | 1 | 2026-09-25 → 09-25 | #321 | feat(scaffold): rendre l'application déployable en Kubernetes |
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
| 146 | P2 — décision | 1 | 2026-11-16 → 12-15 | #227 | docs(site): publier la liste des variables d'environnement |
| 150.6 | P2 — décision | 1 | 2026-11-16 → 12-15 | #403 | test(perf): mesurer le banc ORM applicatif sur les trois dialectes |
| 154 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #234 | fix(session): enregistrer le stockage Redis au demarrage |
| 155 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #235 | feat(security): journaliser les evenements d'authentification |

## Jalon 10.2.0 — 27 ouverts

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
| 159 | P2 — décision | 1 | — | #239 | feat(realtime): declarer un canal parametre par un motif |
| 160 | P2 — décision | 1 | — | #240 | chore(frontend): trancher si frontend:create doit exister |
| 161 | P2 — décision | 1 | — | #241 | fix(security): deriver le domaine des passkeys de l'hote valide |

## Jalon 10.0.0 — 2 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 59 | P1 — figé à la création | 1 | 2026-11-18 → 11-18 | #47 | docs(release): faire suivre à l'accueil ce qui est réellement publié |
| 60 | P3 — fin de cycle | 1 | 2026-11-19 → 11-19 | #27 | chore(release): publier les paquets de la version 10 sur npm |

## Jalon 11.0.0 — 4 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 162 | P3 — fin de cycle | 1 | — | #242 | feat(core): instruire le besoin de transports TCP, UDP et Unix |
| 163 | P3 — fin de cycle | 1 | — | #243 | feat(realtime): servir le bus par Kafka pour la retention |
| 164 | P2 — décision | 1 | — | #244 | feat(security): trancher le serveur d'autorisation et le mTLS |
| 165 | P2 — décision | 15 | — | #459 | feat(media): modèle média partagé et moteur audio du navigateur |

## Jalon 12.0.0 — 8 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 165 | P1 — figé à la création | 1 | — | #245 | chore(ia): refaire l'etat de l'art avant de coder la couche IA |
| 166 | P1 — figé à la création | 1 | — | #246 | feat(llm): brancher un fournisseur de modele reel |
| 167 | P2 — décision | 1 | — | #247 | feat(vector): eprouver le stockage de vecteurs en reel |
| 168 | P2 — décision | 1 | — | #248 | feat(rag): eprouver la recherche augmentee de bout en bout |
| 169 | P2 — décision | 1 | — | #249 | feat(memory): persister la memoire d'un agent |
| 170 | P2 — décision | 1 | — | #250 | feat(agent): arreter le modele de boucle d'un agent |
| 171 | P2 — décision | 1 | — | #251 | chore(mcp): trancher si le protocole descend du coeur en module |
| 172 | P1 — figé à la création | 1 | — | #252 | feat(agent-guard): borner ce qu'un agent a le droit de faire |

## Backlog — aucune date promise · 5 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 901 | P2 — décision | 0.5 | — | #387 | fix(test): sonder les deux ports avant de lancer le banc de démarrage |
| 902 | P2 — décision | 1 | — | #422 | feat(ci): regarder l'écran d'une application générée à chaque publication |
| 903 | P2 — décision | 1 | — | #423 | test(release): éprouver la surface npm telle que le registre la sert |
| 904 | P3 — fin de cycle | 1 | — | #436 | docs(corpus): mettre au standard les neuf pages internes non publiées |
| 905 | P2 — décision | 22.5 | — | #460 | feat(broadcast): boîtier d'apport et hub, une app à rôles |

