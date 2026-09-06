<!-- GÉNÉRÉ par le skill `nodefony-session` (scripts/board-snapshot.mjs).
     NE PAS ÉDITER À LA MAIN.
     La source est GitHub ; ce fichier n'en est qu'une empreinte, pour
     reprendre le travail hors ligne. L'éditer ferait diverger la copie
     de sa source, ce que ce fichier existe précisément pour empêcher. -->

# État du pilotage — empreinte des tickets

> Empreinte prise le **2026-09-06 23:29** (UTC).
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
| **10.0.0-alpha** | ![10.0.0-alpha](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/6?style=flat-square&label=) `█████░░░░░` 50% | 2 | 2 | 2026-09-19 |
| **10.0.0-beta** | ![10.0.0-beta](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/7?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 2 | 2026-10-14 |
| **10.0.0** | ![10.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/1?style=flat-square&label=) `████████░░` 82% | 133 | 30 | 2026-11-15 |
| **10.1.0** | ![10.1.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/2?style=flat-square&label=) `█░░░░░░░░░` 9% | 2 | 21 | — |
| **10.2.0** | ![10.2.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/3?style=flat-square&label=) `░░░░░░░░░░` 4% | 1 | 27 | — |
| **11.0.0** | ![11.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/4?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 3 | — |
| **12.0.0** | ![12.0.0](https://img.shields.io/github/milestones/progress-percent/nodefony/nodefony-core/5?style=flat-square&label=) `░░░░░░░░░░` 0% | 0 | 8 | — |

## ➡️ Le prochain dans l'ordre

**#256 — chore(release): publier une 10.0.0-alpha.2 qui n'installe plus la version 7**

Ordre 1.2 · P0 — bloque le reste · 0.5 j · jalon 10.0.0-alpha

> L'ordre encode les **dépendances**, pas le moment : un ticket petit dont le
> contexte est déjà chargé se prend maintenant (skill `nodefony-ticket`).

## Jalon 10.0.0-alpha — 2 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 1.2 | P0 — bloque le reste | 0.5 | #256 | chore(release): publier une 10.0.0-alpha.2 qui n'installe plus la version 7 |
| 1.3 | P1 — figé à la création | 0.5 | #47 | docs(release): faire suivre à l'accueil ce qui est réellement publié |

## Jalon 10.0.0-beta — 2 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 1.5 | P1 — figé à la création | 0.5 | #255 | test(release): contrôler les README publiés avant chaque publication |
| 2 | P0 — bloque le reste | 1 | #175 | chore(release): publier la beta depuis la forge, pas à la main |

## Jalon 10.0.0 — 30 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 4 | P1 — figé à la création | 2 | #155 | docs(agents): rendre le dépôt lisible par un agent web |
| 4.2 | P1 — figé à la création | 0.5 | #158 | docs(site): publier llms.txt, le plan du site et robots.txt |
| 4.3 | P2 — décision | 1 | #159 | docs(api): publier une référence d'API générée par paquet |
| 4.4 | P1 — figé à la création | 0.5 | #160 | chore(github): poser les gabarits de ticket et de fusion |
| 4.5 | P1 — figé à la création | 0.5 | #215 | fix(build): réparer le contrôle de format du code généré |
| 4.6 | P2 — décision | 0.5 | #104 | test(cli): un seul processus pour vérifier la forme du code généré |
| 4.8 | P1 — figé à la création | 2 | #20 | test(security): attaquer les paquets publiés avant leur sortie |
| 9.4 | P2 — décision | 0.5 | #213 | build(scripts): typechecker les outils du dépôt, aujourd'hui hors de tout tsconfig |
| 9.45 | P2 — décision | 0.5 | #214 | fix(http): glisser de port si une autre app l'écoute déjà |
| 9.5 | P2 — décision | 0.5 | #176 | fix(orm): ne plus voir une destruction dans une table sqlite reconstruite |
| 10 | P2 — décision | 1 | #138 | feat(orm): poser les contraintes d'intégrité des relations |
| 11 | P2 — décision | 0.5 | #139 | fix(security): ne plus laisser de sessions et jetons sans propriétaire |
| 12 | P1 — figé à la création | 1 | #33 | feat(studio): protéger toute la surface d'administration par un rôle |
| 13 | P1 — figé à la création | 1 | #60 | fix(studio): lire la liste des rôles depuis le serveur |
| 14 | P1 — figé à la création | 0.5 | #21 | feat(cli): ajouter la commande de changement de mot de passe |
| 15 | P1 — figé à la création | 5 | #83 | feat(notification): doter le framework de l'envoi de messages sortants |
| 16 | P2 — décision | 1 | #89 | docs(notification): faire la veille des canaux de communication attendus |
| 17 | P1 — figé à la création | 1 | #84 | feat(mail): créer le module et son service d'envoi |
| 18 | P1 — figé à la création | 1 | #85 | feat(mail): composer un courriel depuis un gabarit |
| 19 | P1 — figé à la création | 0.5 | #86 | feat(mail): envoyer un courriel en ligne de commande |
| 20 | P1 — figé à la création | 1 | #87 | test(mail): éprouver l'envoi contre un vrai serveur de test |
| 21 | P1 — figé à la création | 0.5 | #88 | docs(mail): documenter la configuration et le premier envoi |
| 22 | P3 — fin de cycle | 0.5 | #23 | feat(cli): générer la page de signalement de faille des apps |
| 26 | P1 — figé à la création | 0.5 | #99 | feat(devkit): apprendre à l'agent à migrer un schéma |
| 28 | P1 — figé à la création | 0.5 | #154 | fix(frontend): stabiliser le décalage de port sur les agents macOS |
| 29 | P2 — décision | 0.5 | #62 | fix(cli): sonder les ports réellement utilisés par l'application |
| 30 | P2 — décision | 0.5 | #25 | ci(tests): remettre au vert le test de tenue dans la durée |
| 32 | P2 — décision | 1 | #80 | chore(pilotage): confronter au code les cases de la feuille de route |
| 55 | P3 — fin de cycle | 3 | #30 | feat(mongoose): compléter les stockages manquants côté MongoDB |
| 60 | P3 — fin de cycle | 1.5 | #27 | chore(release): publier les paquets de la version 10 sur npm |

## Backlog — aucune date promise · 1 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 90 | P2 — décision | 1 | #205 | refactor(repo): ranger scripts/ et dire où va un contrôle neuf |

## Jalon 10.1.0 — 21 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 100 | P3 — fin de cycle | 1 | #28 | feat(config): surcharger la config d'application par l'environnement |
| 110 | P2 — décision | 1.5 | #63 | test(bancs): rendre chaque banc indépendant du décor partagé |
| 113 | P3 — fin de cycle | 0.5 | #78 | test(core): remplacer les seuils absolus des tests de performance |
| 115 | P3 — fin de cycle | 0.5 | #66 | feat(orm): exposer et borner la taille du pool de connexions |
| 116 | P3 — fin de cycle | 1 | #67 | feat(orm): capturer le contexte des requêtes qui échouent |
| 120 | P3 — fin de cycle | 0.5 | #72 | test(http): mesurer la tenue mémoire sur plusieurs heures |
| 121 | P3 — fin de cycle | 0.5 | #73 | perf(http): rejouer le profil processeur du chemin chaud |
| 134 | P2 — décision | 0.5 | #171 | ci(workflows): refuser une étape multi-commandes sans shell |
| 135 | P2 — décision | 0.5 | #172 | fix(pilotage): ne pas mettre « en cours » sur un commit de pilotage |
| 136 | P3 — fin de cycle | 1 | #173 | feat(scaffold): servir l'application derrière un proxy inverse dans le compose |
| 139 | P3 — fin de cycle | 0.5 | #195 | fix(cli): ne plus compter deux fois les fichiers d'une cible imbriquée |
| 140 | P2 — décision | 0.5 | #196 | fix(orm): ne proposer un geste que si l'on a constaté qu'il s'applique |
| 141 | P3 — fin de cycle | 1 | #216 | fix(bench): poser la base que trois bancs multi-pods exigent |
| 142 | P3 — fin de cycle | 1 | #217 | fix(bench): réparer trois bancs de charge hors service |
| 143 | P1 — figé à la création | 2 | #224 | feat(core): lire les secrets ailleurs que dans l'environnement |
| 144 | P1 — figé à la création | 1 | #225 | feat(kernel): ouvrir un point d'accroche avant et après le drain |
| 145 | P1 — figé à la création | 0.5 | #226 | feat(kernel): avertir quand l'arrêt gracieux ne pourra pas se faire |
| 146 | P2 — décision | 0.5 | #227 | docs(site): publier la liste des variables d'environnement |
| 150 | P2 — décision | 1 | #218 | test(http): caractériser la hausse du RSS d'un pod sous charge |
| 154 | P1 — figé à la création | 0.5 | #234 | fix(session): enregistrer le stockage Redis au demarrage |
| 155 | P1 — figé à la création | 1 | #235 | feat(security): journaliser les evenements d'authentification |

## Jalon 10.2.0 — 27 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 101 | P3 — fin de cycle | 0.5 | #31 | chore: refermer les bogues résolus et les tests jamais lancés |
| 111 | P3 — fin de cycle | 0.5 | #76 | test(bancs): constater le décor avant de lancer les suites |
| 112 | P3 — fin de cycle | 0.5 | #77 | test(bancs): donner à chaque banc son propre compte |
| 114 | P3 — fin de cycle | 0.5 | #64 | perf(dev): supprimer les 45 secondes de build au démarrage |
| 117 | P3 — fin de cycle | 1 | #71 | feat(security): rendre la hiérarchie de rôles extensible |
| 118 | P3 — fin de cycle | 2 | #79 | refactor(studio): dériver l'affichage des rôles servis par le serveur |
| 119 | P3 — fin de cycle | 0.5 | #69 | feat(studio): signaler visiblement un serveur en dérogation |
| 122 | P2 — décision | 0.5 | #75 | chore(core): trancher l'héritage des dépendances déclarées |
| 123 | P2 — décision | 0.5 | #131 | refactor(frontend): composer les plugins Vite en un seul endroit |
| 124 | P2 — décision | 2 | #161 | feat(devkit): mesurer si un agent clôt un ticket sans humain |
| 130 | P3 — fin de cycle | 2 | #70 | feat(webhooks): séparer les événements métier du journal d'audit |
| 131 | P3 — fin de cycle | 1 | #68 | feat(studio): garder les préférences d'affichage côté serveur |
| 132 | P3 — fin de cycle | 3 | #74 | feat(studio): éditer la configuration d'un module à chaud |
| 133 | P3 — fin de cycle | 3 | #65 | test(paquets): rapatrier les preuves de bout en bout dans leur paquet |
| 137 | P2 — décision | 0.5 | #188 | test(mcp): dire POURQUOI l'outil de diagnostic n'a pas répondu |
| 142 | P3 — fin de cycle | 5 | #50 | docs(tutoriels): écrire la partie 2, jusqu'au déploiement |
| 147 | P2 — décision | 1 | #228 | feat(observabilite): exposer les métriques au format Prometheus |
| 148 | P3 — fin de cycle | 0.5 | #229 | feat(scaffold): livrer un Dockerfile de développement |
| 151 | P2 — décision | 1 | #231 | feat(cli): interroger les journaux depuis un terminal |
| 152 | P2 — décision | 2 | #232 | feat(cli): compléter les commandes de module et leur couverture |
| 153 | P2 — décision | 2 | #233 | feat(kernel): faire tourner un travail batch et periodique sans serveur |
| 156 | P2 — décision | 1.5 | #236 | feat(studio): livrer la vue Services et l'audit en direct |
| 157 | P2 — décision | 1.5 | #237 | test(studio): eprouver la console d'administration de bout en bout |
| 158 | P2 — décision | 2 | #238 | test(orm): prouver la parite de contrat entre Mongoose et Drizzle |
| 159 | P2 — décision | 1 | #239 | feat(realtime): declarer un canal parametre par un motif |
| 160 | P2 — décision | 0.5 | #240 | chore(frontend): trancher si frontend:create doit exister |
| 161 | P2 — décision | 0.5 | #241 | fix(security): deriver le domaine des passkeys de l'hote valide |

## Jalon 11.0.0 — 3 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 162 | P3 — fin de cycle | 3 | #242 | feat(core): instruire le besoin de transports TCP, UDP et Unix |
| 163 | P3 — fin de cycle | 3 | #243 | feat(realtime): servir le bus par Kafka pour la retention |
| 164 | P2 — décision | 5 | #244 | feat(security): trancher le serveur d'autorisation et le mTLS |

## Jalon 12.0.0 — 8 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 165 | P1 — figé à la création | 3 | #245 | chore(ia): refaire l'etat de l'art avant de coder la couche IA |
| 166 | P1 — figé à la création | 1 | #246 | feat(llm): brancher un fournisseur de modele reel |
| 167 | P2 — décision | 1 | #247 | feat(vector): eprouver le stockage de vecteurs en reel |
| 168 | P2 — décision | 1 | #248 | feat(rag): eprouver la recherche augmentee de bout en bout |
| 169 | P2 — décision | 1 | #249 | feat(memory): persister la memoire d'un agent |
| 170 | P2 — décision | 1 | #250 | feat(agent): arreter le modele de boucle d'un agent |
| 171 | P2 — décision | 1 | #251 | chore(mcp): trancher si le protocole descend du coeur en module |
| 172 | P1 — figé à la création | 1 | #252 | feat(agent-guard): borner ce qu'un agent a le droit de faire |

