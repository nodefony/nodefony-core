<!-- GÉNÉRÉ par le skill `nodefony-session` (scripts/board-snapshot.mjs).
     NE PAS ÉDITER À LA MAIN.
     La source est GitHub ; ce fichier n'en est qu'une empreinte, pour
     reprendre le travail hors ligne. L'éditer ferait diverger la copie
     de sa source, ce que ce fichier existe précisément pour empêcher. -->

# État du pilotage — empreinte des tickets

> Empreinte prise le **2026-09-12 21:21** (UTC).
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
| **10.0.0-alpha** | ![10.0.0-alpha](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/6?style=flat-square&label=) `████████░░` 79% | 81 | 22 | 2026-09-19 |
| **10.0.0-beta** | ![10.0.0-beta](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/7?style=flat-square&label=) `█░░░░░░░░░` 14% | 5 | 31 | 2026-10-14 |
| **10.0.0** | ![10.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/1?style=flat-square&label=) `██████████` 99% | 134 | 2 | 2026-11-15 |
| **10.1.0** | ![10.1.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/2?style=flat-square&label=) `█░░░░░░░░░` 10% | 3 | 28 | 2026-12-15 |
| **10.2.0** | ![10.2.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/3?style=flat-square&label=) `░░░░░░░░░░` 4% | 1 | 27 | — |
| **11.0.0** | ![11.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/4?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 3 | — |
| **12.0.0** | ![12.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/5?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 8 | — |
| **outillage-agents** | ![outillage-agents](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/8?style=flat-square&label=) `███████░░░` 67% | 4 | 2 | — |

## ➡️ Le prochain dans l'ordre

**#316 — feat(scaffold): rendre l'application générée déployable en production**

Ordre 9.91 · P1 — figé à la création · 5.5 j · jalon 10.0.0-alpha · frise 2026-09-11 → 09-11

> Choisi dans le **jalon courant `10.0.0-alpha`**, qui a encore 22 tickets ouverts. Un ticket d'un jalon ULTÉRIEUR ne passe jamais devant, même mieux classé : l'ordre encode les dépendances, le jalon encode la livraison.

> L'ordre encode les **dépendances**, pas le moment : un ticket petit dont le
> contexte est déjà chargé se prend maintenant (skill `nodefony-ticket`).

## Jalon 10.0.0-beta — 31 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 1.5 | P1 — figé à la création | 0.5 | 2026-10-12 → 10-12 | #255 | test(release): contrôler les README publiés avant chaque publication |
| 1.6 | P1 — figé à la création | 1 | 2026-10-13 → 10-13 | #293 | build(release): cesser de réécrire les types au moment du publish |
| 1.7 | P2 — décision | 0.5 | 2026-10-14 → 10-14 | #275 | fix(release): écarter du changelog les commits qui n'atteignent aucun installeur |
| 1.8 | P2 — décision | 1 | 2026-10-15 → 10-15 | #312 | chore(release): rendre le lot de publication annulable |
| 2 | P0 — bloque le reste | 1 | 2026-10-16 → 10-16 | #175 | chore(release): publier la beta depuis la forge, pas à la main |
| 3 | P2 — décision | 0.5 | 2026-10-19 → 10-19 | #259 | ci(release): publier l'image sur le registre de GitHub, sans aucun secret |
| 4 | P1 — figé à la création | 2 | 2026-10-20 → 10-20 | #155 | docs(agents): rendre le dépôt lisible par un agent web |
| 4.2 | P1 — figé à la création | 0.5 | 2026-10-21 → 10-21 | #158 | docs(site): publier llms.txt, le plan du site et robots.txt |
| 4.3 | P2 — décision | 1 | 2026-10-22 → 10-22 | #159 | docs(api): publier une référence d'API générée par paquet |
| 4.4 | P1 — figé à la création | 0.5 | 2026-10-23 → 10-23 | #160 | chore(github): poser les gabarits de ticket et de fusion |
| 4.5 | P1 — figé à la création | 0.5 | 2026-10-26 → 10-26 | #215 | fix(build): réparer le contrôle de format du code généré |
| 4.6 | P2 — décision | 0.5 | 2026-10-27 → 10-27 | #104 | test(cli): un seul processus pour vérifier la forme du code généré |
| 4.8 | P1 — figé à la création | 2 | 2026-10-28 → 10-28 | #20 | test(security): attaquer les paquets publiés avant leur sortie |
| 4.9 | P1 — figé à la création | 2 | 2026-10-29 → 10-29 | #294 | test(cli): éprouver l'installation d'une app avec pnpm, yarn et bun |
| 5 | P1 — figé à la création | 3.5 | 2026-10-30 → 10-30 | #268 | feat(security): rendre Keycloak utilisable de bout en bout pour la connexion externe |
| 5.1 | P0 — bloque le reste | 2 | 2026-11-02 → 11-02 | #269 | test(security): éprouver la connexion OpenID Connect contre un vrai Keycloak |
| 5.2 | P1 — figé à la création | 1 | 2026-11-03 → 11-03 | #270 | fix(security): refuser au démarrage une configuration de fournisseur incomplète |
| 5.3 | P2 — décision | 0.5 | 2026-11-04 → 11-04 | #272 | docs(security): documenter le branchement d'un Keycloak, du realm au premier login |
| 9.3 | P2 — décision | 1 | 2026-10-19 → 10-19 | #359 | docs(corpus): recaler les 433 ancres fichier:ligne qui ont dérivé |
| 9.4 | P2 — décision | 0.5 | 2026-11-05 → 11-05 | #213 | build(scripts): typechecker les outils du dépôt, aujourd'hui hors de tout tsconfig |
| 9.5 | P2 — décision | 0.5 | 2026-11-09 → 11-09 | #176 | fix(orm): ne plus voir une destruction dans une table sqlite reconstruite |
| 9.6 | P1 — figé à la création | 0.5 | 2026-11-10 → 11-10 | #313 | fix(cli): resservir la vraie erreur de démarrage, pas celle de la dernière tentative |
| 9.7 | P1 — figé à la création | 1 | 2026-11-11 → 11-11 | #314 | fix(orm): ne pas replier sur un dialecte que les entités ne parlent pas |
| 9.8 | P2 — décision | 0.5 | 2026-11-11 → 11-11 | #352 | fix(http): empêcher un frontal de retenir un flux d'événements |
| 11 | P2 — décision | 0.5 | 2026-11-12 → 11-12 | #139 | fix(security): ne plus laisser de sessions et jetons sans propriétaire |
| 29 | P2 — décision | 0.5 | 2026-11-16 → 11-16 | #62 | fix(cli): sonder les ports réellement utilisés par l'application |
| 30 | P2 — décision | 0.5 | 2026-11-17 → 11-17 | #25 | ci(tests): remettre au vert le test de tenue dans la durée |
| 32 | P2 — décision | 1 | 2026-11-18 → 11-18 | #80 | chore(pilotage): confronter au code les cases de la feuille de route |
| 46.1 | P1 — figé à la création | 0.5 | 2026-10-30 → 10-30 | #371 | test(devkit-bench): constater qu'un agent écrit hors de son décor |
| 46.2 | P0 — bloque le reste | 0.5 | 2026-10-30 → 10-30 | #372 | fix(devkit-bench): chercher la zone de firewall où elle vit vraiment |
| 48 | P1 — figé à la création | 1 | 2026-11-30 → 11-30 | #351 | fix(bundler): garder le framework hors du bundle d'un module |

## Jalon outillage-agents — 2 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 2 | P2 — décision | 3 | — | #334 | test(agents): mesurer ce que les skills changent pour un agent seul |
| 90 | P2 — décision | 1 | — | #205 | refactor(repo): ranger scripts/ et dire où va un contrôle neuf |

## Jalon 10.0.0-alpha — 22 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 9.91 | P1 — figé à la création | 5.5 | 2026-09-11 → 09-11 | #316 | feat(scaffold): rendre l'application générée déployable en production |
| 9.94 | P0 — bloque le reste | 2.5 | 2026-09-12 → 09-12 | #369 | chore(release): publier la préversion 10.0.0-alpha.6 |
| 9.9405 | P0 — bloque le reste | 1 | 2026-11-19 → 11-19 | #340 | feat(cli): guider l'agent au-delà de la génération |
| 9.9411 | P2 — décision | 0.5 | 2026-09-12 → 09-12 | #366 | test(devkit-bench): constater l'identité admin avant de juger |
| 9.9412 | P1 — figé à la création | 0.5 | 2026-09-12 → 09-12 | #367 | fix(cli): rendre vert le rapport d'une application neuve |
| 9.9413 | P1 — figé à la création | 1 | 2026-09-12 → 09-12 | #368 | feat(cli): soigner le premier contact avec le framework |
| 9.9414 | P1 — figé à la création | 0.5 | 2026-09-12 → 09-12 | #373 | fix(scaffold): dire quel compte n'a pas été semé, et pourquoi |
| 9.9416 | P1 — figé à la création | 0.5 | 2026-09-13 → 09-13 | #375 | fix(scaffold): ne pas perdre les champs d'une entité qu'on complète |
| 9.9417 | P2 — décision | 0.5 | 2026-09-13 → 09-13 | #376 | fix(orm): nommer ce qui a arrêté la génération d'une migration |
| 9.955 | P1 — figé à la création | 1 | 2026-09-15 → 09-16 | #358 | feat(cli): donner à une application un contrôle de sa propre image |
| 9.96 | P2 — décision | 1.5 | 2026-09-22 → 09-22 | #321 | feat(scaffold): rendre l'application déployable en Kubernetes |
| 9.97 | P1 — figé à la création | 2 | 2026-09-23 → 09-23 | #322 | feat(ci): faire prouver par la vitrine ce que nul n'éprouve |
| 9.99 | P2 — décision | 1 | 2026-09-25 → 09-25 | #327 | test(log): éprouver les transports contre de vrais serveurs |
| 10 | P2 — décision | 1 | 2026-09-29 → 09-29 | #138 | feat(orm): poser les contraintes d'intégrité des relations |
| 10.5 | P1 — figé à la création | 0.5 | 2026-09-12 → 09-12 | #370 | feat(cli): donner un critère pour choisir le moteur frontend |
| 12 | P1 — figé à la création | 1 | 2026-09-30 → 09-30 | #33 | feat(studio): protéger toute la surface d'administration par un rôle |
| 13 | P1 — figé à la création | 1 | 2026-10-01 → 10-01 | #60 | fix(studio): lire la liste des rôles depuis le serveur |
| 20 | P2 — décision | 0.5 | 2026-10-06 → 10-06 | #292 | chore(env): trancher le préfixe des variables propres à l'application |
| 26 | P1 — figé à la création | 0.5 | 2026-10-08 → 10-08 | #99 | feat(devkit): apprendre à l'agent à migrer un schéma |
| 28 | P1 — figé à la création | 0.5 | 2026-09-12 → 09-12 | #154 | fix(frontend): stabiliser le décalage de port sur les agents macOS |
| 45.2 | P0 — bloque le reste | 1 | 2026-09-12 → 09-12 | #341 | feat(cli): laisser un exemple de chaque geste en « Minimal » |
| 55 | P3 — fin de cycle | 3 | 2026-10-09 → 10-09 | #30 | feat(mongoose): compléter les stockages manquants côté MongoDB |

## Jalon 10.1.0 — 28 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 15 | P1 — figé à la création | 5 | 2026-11-16 → 12-15 | #83 | feat(notification): doter le framework de l'envoi de messages sortants |
| 16 | P2 — décision | 1 | 2026-11-16 → 12-15 | #89 | docs(notification): faire la veille des canaux de communication attendus |
| 17 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #84 | feat(mail): créer le module et son service d'envoi |
| 18 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #85 | feat(mail): composer un courriel depuis un gabarit |
| 19 | P1 — figé à la création | 0.5 | 2026-11-16 → 12-15 | #86 | feat(mail): envoyer un courriel en ligne de commande |
| 20 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #87 | test(mail): éprouver l'envoi contre un vrai serveur de test |
| 21 | P1 — figé à la création | 0.5 | 2026-11-16 → 12-15 | #88 | docs(mail): documenter la configuration et le premier envoi |
| 46 | P1 — figé à la création | 2 | 2026-11-16 → 12-15 | #349 | feat(cli): ajouter une brique à une application déjà générée |
| 100 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #28 | feat(config): surcharger la config d'application par l'environnement |
| 110 | P2 — décision | 1.5 | 2026-11-16 → 12-15 | #63 | test(bancs): rendre chaque banc indépendant du décor partagé |
| 113 | P3 — fin de cycle | 0.5 | 2026-11-16 → 12-15 | #78 | test(core): remplacer les seuils absolus des tests de performance |
| 115 | P3 — fin de cycle | 0.5 | 2026-11-16 → 12-15 | #66 | feat(orm): exposer et borner la taille du pool de connexions |
| 116 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #67 | feat(orm): capturer le contexte des requêtes qui échouent |
| 120 | P3 — fin de cycle | 0.5 | 2026-11-16 → 12-15 | #72 | test(http): mesurer la tenue mémoire sur plusieurs heures |
| 121 | P3 — fin de cycle | 0.5 | 2026-11-16 → 12-15 | #73 | perf(http): rejouer le profil processeur du chemin chaud |
| 134 | P2 — décision | 0.5 | 2026-11-16 → 12-15 | #171 | ci(workflows): refuser une étape multi-commandes sans shell |
| 135 | P2 — décision | 0.5 | 2026-11-16 → 12-15 | #172 | fix(pilotage): ne pas mettre « en cours » sur un commit de pilotage |
| 139 | P3 — fin de cycle | 0.5 | 2026-11-16 → 12-15 | #195 | fix(cli): ne plus compter deux fois les fichiers d'une cible imbriquée |
| 140 | P2 — décision | 0.5 | 2026-11-16 → 12-15 | #196 | fix(orm): ne proposer un geste que si l'on a constaté qu'il s'applique |
| 141 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #216 | fix(bench): poser la base que trois bancs multi-pods exigent |
| 142 | P3 — fin de cycle | 1 | 2026-11-16 → 12-15 | #217 | fix(bench): réparer trois bancs de charge hors service |
| 143 | P1 — figé à la création | 2 | 2026-11-16 → 12-15 | #224 | feat(core): lire les secrets ailleurs que dans l'environnement |
| 144 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #225 | feat(kernel): ouvrir un point d'accroche avant et après le drain |
| 145 | P1 — figé à la création | 0.5 | 2026-11-16 → 12-15 | #226 | feat(kernel): avertir quand l'arrêt gracieux ne pourra pas se faire |
| 146 | P2 — décision | 0.5 | 2026-11-16 → 12-15 | #227 | docs(site): publier la liste des variables d'environnement |
| 150 | P2 — décision | 1 | 2026-11-16 → 12-15 | #218 | test(http): caractériser la hausse du RSS d'un pod sous charge |
| 154 | P1 — figé à la création | 0.5 | 2026-11-16 → 12-15 | #234 | fix(session): enregistrer le stockage Redis au demarrage |
| 155 | P1 — figé à la création | 1 | 2026-11-16 → 12-15 | #235 | feat(security): journaliser les evenements d'authentification |

## Jalon 10.0.0 — 2 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 59 | P1 — figé à la création | 0.5 | 2026-09-08 → 09-08 | #47 | docs(release): faire suivre à l'accueil ce qui est réellement publié |
| 60 | P3 — fin de cycle | 1.5 | 2026-10-15 → 11-15 | #27 | chore(release): publier les paquets de la version 10 sur npm |

## Jalon 10.2.0 — 27 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 101 | P3 — fin de cycle | 0.5 | — | #31 | chore: refermer les bogues résolus et les tests jamais lancés |
| 111 | P3 — fin de cycle | 0.5 | — | #76 | test(bancs): constater le décor avant de lancer les suites |
| 112 | P3 — fin de cycle | 0.5 | — | #77 | test(bancs): donner à chaque banc son propre compte |
| 114 | P3 — fin de cycle | 0.5 | — | #64 | perf(dev): supprimer les 45 secondes de build au démarrage |
| 117 | P3 — fin de cycle | 1 | — | #71 | feat(security): rendre la hiérarchie de rôles extensible |
| 118 | P3 — fin de cycle | 2 | — | #79 | refactor(studio): dériver l'affichage des rôles servis par le serveur |
| 119 | P3 — fin de cycle | 0.5 | — | #69 | feat(studio): signaler visiblement un serveur en dérogation |
| 122 | P2 — décision | 0.5 | — | #75 | chore(core): trancher l'héritage des dépendances déclarées |
| 123 | P2 — décision | 0.5 | — | #131 | refactor(frontend): composer les plugins Vite en un seul endroit |
| 124 | P2 — décision | 2 | — | #161 | feat(devkit): mesurer si un agent clôt un ticket sans humain |
| 130 | P3 — fin de cycle | 2 | — | #70 | feat(webhooks): séparer les événements métier du journal d'audit |
| 131 | P3 — fin de cycle | 1 | — | #68 | feat(studio): garder les préférences d'affichage côté serveur |
| 132 | P3 — fin de cycle | 3 | — | #74 | feat(studio): éditer la configuration d'un module à chaud |
| 133 | P3 — fin de cycle | 3 | — | #65 | test(paquets): rapatrier les preuves de bout en bout dans leur paquet |
| 137 | P2 — décision | 0.5 | — | #188 | test(mcp): dire POURQUOI l'outil de diagnostic n'a pas répondu |
| 142 | P3 — fin de cycle | 5 | — | #50 | docs(tutoriels): écrire la partie 2, jusqu'au déploiement |
| 147 | P2 — décision | 1 | — | #228 | feat(observabilite): exposer les métriques au format Prometheus |
| 148 | P3 — fin de cycle | 0.5 | — | #229 | feat(scaffold): livrer un Dockerfile de développement |
| 151 | P2 — décision | 1 | — | #231 | feat(cli): interroger les journaux depuis un terminal |
| 152 | P2 — décision | 2 | — | #232 | feat(cli): compléter les commandes de module et leur couverture |
| 153 | P2 — décision | 2 | — | #233 | feat(kernel): faire tourner un travail batch et periodique sans serveur |
| 156 | P2 — décision | 1.5 | — | #236 | feat(studio): livrer la vue Services et l'audit en direct |
| 157 | P2 — décision | 1.5 | — | #237 | test(studio): eprouver la console d'administration de bout en bout |
| 158 | P2 — décision | 2 | — | #238 | test(orm): prouver la parite de contrat entre Mongoose et Drizzle |
| 159 | P2 — décision | 1 | — | #239 | feat(realtime): declarer un canal parametre par un motif |
| 160 | P2 — décision | 0.5 | — | #240 | chore(frontend): trancher si frontend:create doit exister |
| 161 | P2 — décision | 0.5 | — | #241 | fix(security): deriver le domaine des passkeys de l'hote valide |

## Jalon 11.0.0 — 3 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 162 | P3 — fin de cycle | 3 | — | #242 | feat(core): instruire le besoin de transports TCP, UDP et Unix |
| 163 | P3 — fin de cycle | 3 | — | #243 | feat(realtime): servir le bus par Kafka pour la retention |
| 164 | P2 — décision | 5 | — | #244 | feat(security): trancher le serveur d'autorisation et le mTLS |

## Jalon 12.0.0 — 8 ouverts

| Ordre | Prio | Jours | Frise | Ticket | Titre |
| --- | --- | ---: | --- | --- | --- |
| 165 | P1 — figé à la création | 3 | — | #245 | chore(ia): refaire l'etat de l'art avant de coder la couche IA |
| 166 | P1 — figé à la création | 1 | — | #246 | feat(llm): brancher un fournisseur de modele reel |
| 167 | P2 — décision | 1 | — | #247 | feat(vector): eprouver le stockage de vecteurs en reel |
| 168 | P2 — décision | 1 | — | #248 | feat(rag): eprouver la recherche augmentee de bout en bout |
| 169 | P2 — décision | 1 | — | #249 | feat(memory): persister la memoire d'un agent |
| 170 | P2 — décision | 1 | — | #250 | feat(agent): arreter le modele de boucle d'un agent |
| 171 | P2 — décision | 1 | — | #251 | chore(mcp): trancher si le protocole descend du coeur en module |
| 172 | P1 — figé à la création | 1 | — | #252 | feat(agent-guard): borner ce qu'un agent a le droit de faire |

