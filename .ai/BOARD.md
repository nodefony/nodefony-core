<!-- GÉNÉRÉ par le skill `nodefony-session` (scripts/board-snapshot.mjs).
     NE PAS ÉDITER À LA MAIN.
     La source est GitHub ; ce fichier n'en est qu'une empreinte, pour
     reprendre le travail hors ligne. L'éditer ferait diverger la copie
     de sa source, ce que ce fichier existe précisément pour empêcher. -->

# État du pilotage — empreinte des tickets

> Empreinte prise le **2026-09-05 13:37** (UTC).
> La **source** est le tableau de bord GitHub ; relire ici ne dispense pas de
> vérifier en ligne quand le réseau répond — une empreinte vieille de trois
> jours a manqué trois jours de travail.

## Jalons

| Jalon | Ouverts | Fermés | Échéance |
| --- | ---: | ---: | --- |
| 10.1 | 27 | 1 | — |
| 10.0.0 | 42 | 108 | 2026-11-15 |

## ➡️ Le prochain dans l'ordre

**#19 — refactor(drizzle): rendre optionnels les pilotes de base de données**

Ordre 1 · P1 — figé à la création · 2 j · jalon 10.0.0

> L'ordre encode les **dépendances**, pas le moment : un ticket petit dont le
> contexte est déjà chargé se prend maintenant (skill `nodefony-ticket`).

## Jalon 10.0.0 — 42 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 1 | P1 — figé à la création | 2 | #19 | refactor(drizzle): rendre optionnels les pilotes de base de données |
| 2 | P1 — figé à la création | 1 | #174 | fix(config): refuser une clé de config inconnue au lieu de la retirer |
| 3 | P2 — décision | 0.5 | #26 | refactor(client)!: retirer l'appel non typé de la socket cliente |
| 4 | P1 — figé à la création | 0.5 | #156 | chore(release): recaler description et mots-clés des paquets |
| 4.5 | P1 — figé à la création | 1.5 | #187 | refactor(core)!: écrire tous les identifiants du framework en anglais |
| 5 | P0 — bloque le reste | 1 | #175 | chore(release): publier une beta avant la 10.0.0 |
| 6 | P1 — figé à la création | 1 | #197 | test(realtime): fermer les trous de couverture des bancs du temps réel |
| 6.4 | P2 — décision | 0.5 | #202 | test(realtime): éprouver la file de publication quand elle sature |
| 6.5 | P3 — fin de cycle | 0.5 | #203 | test(realtime): éprouver ce que RealtimeError transporte |
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
| 27 | P2 — décision | 0.5 | #104 | test(cli): un seul processus pour vérifier la forme du code généré |
| 28 | P1 — figé à la création | 0.5 | #154 | fix(frontend): stabiliser le décalage de port sur les agents macOS |
| 29 | P2 — décision | 0.5 | #62 | fix(cli): sonder les ports réellement utilisés par l'application |
| 30 | P2 — décision | 0.5 | #25 | ci(tests): remettre au vert le test de tenue dans la durée |
| 31 | P3 — fin de cycle | 2 | #20 | test(security): attaquer les paquets publiés avant leur sortie |
| 32 | P2 — décision | 1 | #80 | chore(pilotage): confronter au code les cases de la feuille de route |
| 40 | P1 — figé à la création | 8 | #53 | docs: remettre la documentation à niveau avant la version 10 |
| 41 | P1 — figé à la création | 3 | #155 | docs(agents): rendre le dépôt lisible par un agent web |
| 42 | P1 — figé à la création | 0.5 | #157 | docs(racine): faire d'AGENTS.md la carte d'entrée du dépôt |
| 43 | P1 — figé à la création | 0.5 | #158 | docs(site): publier llms.txt, le plan du site et robots.txt |
| 44 | P2 — décision | 1 | #159 | docs(api): publier une référence d'API générée par paquet |
| 45 | P3 — fin de cycle | 0.5 | #24 | docs(security): expliquer comment obtenir un jeton |
| 46 | P3 — fin de cycle | 0.5 | #47 | docs(release): préparer la page d'accueil du jour de la publication |
| 47 | P3 — fin de cycle | 5 | #50 | docs(tutoriels): écrire la partie 2, jusqu'au déploiement |
| 48 | P3 — fin de cycle | 2 | #51 | docs(guides): écrire les recettes d'exploitation |
| 49 | P3 — fin de cycle | 0.5 | #160 | chore(github): poser les gabarits de ticket et de fusion |
| 55 | P3 — fin de cycle | 3 | #30 | feat(mongoose): compléter les stockages manquants côté MongoDB |
| 60 | P3 — fin de cycle | 1.5 | #27 | chore(release): publier les paquets de la version 10 sur npm |

## Jalon 10.1 — 27 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 100 | P3 — fin de cycle | 1 | #28 | feat(config): surcharger la config d'application par l'environnement |
| 101 | P3 — fin de cycle | 0.5 | #31 | chore: refermer les bogues résolus et les tests jamais lancés |
| 110 | P2 — décision | 1.5 | #63 | test(bancs): rendre chaque banc indépendant du décor partagé |
| 111 | P3 — fin de cycle | 0.5 | #76 | test(bancs): constater le décor avant de lancer les suites |
| 112 | P3 — fin de cycle | 0.5 | #77 | test(bancs): donner à chaque banc son propre compte |
| 113 | P3 — fin de cycle | 0.5 | #78 | test(core): remplacer les seuils absolus des tests de performance |
| 114 | P3 — fin de cycle | 0.5 | #64 | perf(dev): supprimer les 45 secondes de build au démarrage |
| 115 | P3 — fin de cycle | 0.5 | #66 | feat(orm): exposer la taille du pool de connexions |
| 116 | P3 — fin de cycle | 1 | #67 | feat(orm): capturer le contexte des requêtes qui échouent |
| 117 | P3 — fin de cycle | 1 | #71 | feat(security): rendre la hiérarchie de rôles extensible |
| 118 | P3 — fin de cycle | 2 | #79 | refactor(studio): dériver l'affichage des rôles servis par le serveur |
| 119 | P3 — fin de cycle | 0.5 | #69 | feat(studio): signaler visiblement un serveur en dérogation |
| 120 | P3 — fin de cycle | 0.5 | #72 | test(http): mesurer la tenue mémoire sur plusieurs heures |
| 121 | P3 — fin de cycle | 0.5 | #73 | perf(http): rejouer le profil processeur du chemin chaud |
| 122 | P2 — décision | 0.5 | #75 | chore(core): trancher l'héritage des dépendances déclarées |
| 123 | P2 — décision | 0.5 | #131 | refactor(frontend): composer les plugins Vite en un seul endroit |
| 124 | P2 — décision | 2 | #161 | feat(devkit): mesurer si un agent clôt un ticket sans humain |
| 130 | P3 — fin de cycle | 2 | #70 | feat(webhooks): séparer les événements métier du journal d'audit |
| 131 | P3 — fin de cycle | 1 | #68 | feat(studio): garder les préférences d'affichage côté serveur |
| 132 | P3 — fin de cycle | 3 | #74 | feat(studio): éditer la configuration d'un module à chaud |
| 133 | P3 — fin de cycle | 3 | #65 | test(paquets): rapatrier les preuves de bout en bout dans leur paquet |
| 134 | P2 — décision | 0.5 | #171 | ci(workflows): refuser une étape multi-commandes sans shell |
| 135 | P2 — décision | 0.5 | #172 | fix(pilotage): ne pas mettre « en cours » sur un commit de pilotage |
| 136 | P3 — fin de cycle | 1 | #173 | feat(scaffold): servir l'application derrière un proxy inverse dans le compose |
| 137 | P2 — décision | 0.5 | #188 | test(mcp): dire POURQUOI l'outil de diagnostic n'a pas répondu |
| 139 | P3 — fin de cycle | 0.5 | #195 | fix(cli): ne plus compter deux fois les fichiers d'une cible imbriquée |
| 140 | P2 — décision | 0.5 | #196 | fix(orm): ne proposer un geste que si l'on a constaté qu'il s'applique |

## Backlog — aucune date promise · 1 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 900 | P2 — décision | 0.5 | #201 | test(core): faire échouer le typecheck du cœur sur un test faux |

