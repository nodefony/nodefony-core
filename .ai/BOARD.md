<!-- GÉNÉRÉ par le skill `nodefony-session` (scripts/board-snapshot.mjs).
     NE PAS ÉDITER À LA MAIN.
     La source est GitHub ; ce fichier n'en est qu'une empreinte, pour
     reprendre le travail hors ligne. L'éditer ferait diverger la copie
     de sa source, ce que ce fichier existe précisément pour empêcher. -->

# État du pilotage — empreinte des tickets

> Empreinte prise le **2026-08-27 15:22** (UTC).
> La **source** est le tableau de bord GitHub ; relire ici ne dispense pas de
> vérifier en ligne quand le réseau répond — une empreinte vieille de trois
> jours a manqué trois jours de travail.

## Jalons

| Jalon | Ouverts | Fermés | Échéance |
| --- | ---: | ---: | --- |
| 10.1 | 15 | 1 | — |
| 10.0.0 | 46 | 6 | 2026-11-15 |

## ➡️ Le prochain dans l'ordre

**#41 — fix(client): corriger le contrat du noyau client avant de le figer**

Ordre 1.5 · P0 — bloque le reste · 0.5 j · jalon 10.0.0

> L'ordre encode les **dépendances**, pas le moment : un ticket petit dont le
> contexte est déjà chargé se prend maintenant (skill `nodefony-ticket`).

## Jalon 10.0.0 — 46 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 1.5 | P0 — bloque le reste | 0.5 | #41 | fix(client): corriger le contrat du noyau client avant de le figer |
| 1.6 | P0 — bloque le reste | — | #54 | feat(client): simplifier la socket cliente pour un débutant |
| 2 | P0 — bloque le reste | 5 | #17 | feat(orm): livrer les migrations de schéma en production |
| 2.1 | P1 — figé à la création | 0.5 | #57 | fix(orm): refuser une option de tri mal formée au lieu de l'ignorer |
| 3 | P0 — bloque le reste | 3 | #18 | feat(cli): rendre l'entité User à l'application |
| 4 | P1 — figé à la création | 2 | #19 | refactor(drizzle): rendre optionnels les pilotes de base de données |
| 4.5 | P1 — figé à la création | 0.5 | #59 | fix(cluster): ne plus arracher les gestionnaires de signaux des modules |
| 4.6 | P1 — figé à la création | 1 | #61 | feat(realtime): garder les canaux dynamiques par un motif de nom |
| 6 | P1 — figé à la création | 0.5 | #22 | ci(security): détecter les secrets commités dans le dépôt |
| 6 | P1 — figé à la création | — | #53 | docs: remettre la documentation à niveau avant la version 10 |
| 6.5 | P1 — figé à la création | 0.5 | #45 | docs(guides): retirer « mocha + bun » et les pages fantômes |
| 6.6 | P1 — figé à la création | 1 | #46 | docs(core): documenter l'outillage de test livré aux applications |
| 6.7 | P1 — figé à la création | 0.5 | #48 | docs(site): mettre les tutoriels avant l'architecture |
| 7 | P1 — figé à la création | 1 | #33 | feat(studio): protéger toute la surface d'administration par un rôle |
| 7.1 | P1 — figé à la création | 1 | #60 | fix(studio): lire la liste des rôles depuis le serveur |
| 8 | P1 — figé à la création | 0.5 | #21 | feat(cli): ajouter la commande de changement de mot de passe |
| 9.5 | P1 — figé à la création | 0.5 | #42 | fix(client): corriger l'adresse du serveur temps réel par défaut |
| 10 | P2 — décision | 0.5 | #26 | refactor(client)!: retirer l'appel non typé de la socket cliente |
| 11 | P2 — décision | 0.5 | #25 | ci(tests): remettre au vert le test de tenue dans la durée |
| 11.5 | P2 — décision | 0.5 | #62 | fix(cli): sonder les ports réellement utilisés par l'application |
| 11.6 | P2 — décision | 1 | #80 | chore(pilotage): confronter au code les cases de la feuille de route |
| 12 | P3 — fin de cycle | 2 | #20 | test(security): attaquer les paquets publiés avant leur sortie |
| 12.5 | P3 — fin de cycle | 0.5 | #47 | docs(release): préparer la page d'accueil du jour de la publication |
| 13 | P3 — fin de cycle | 1.5 | #27 | chore(release): publier les paquets de la version 10 sur npm |
| 14 | P3 — fin de cycle | 0.5 | #23 | feat(cli): générer la page de signalement de faille des apps |
| 15 | P3 — fin de cycle | 0.5 | #24 | docs(security): expliquer comment obtenir un jeton |
| 17 | P3 — fin de cycle | 1 | #44 | feat(docs): raccourcir les libellés de menu des titres longs |
| 18 | P3 — fin de cycle | 1 | #49 | docs: rendre conformes les 11 pages qui échouent au contrôle |
| 22 | P3 — fin de cycle | 3 | #30 | feat(mongoose): compléter les stockages manquants côté MongoDB |
| 31 | P3 — fin de cycle | 3 | #35 | feat(client): faire remonter les journaux du navigateur au serveur |
| 32 | P3 — fin de cycle | 2 | #36 | refactor(client): extraire un socle commun aux quatre fronts |
| 33 | P3 — fin de cycle | 1.5 | #37 | feat(client): ajouter les composables Vue 3 du temps réel |
| 34 | P3 — fin de cycle | 2 | #38 | feat(client): ajouter les services Angular du temps réel |
| 35 | P3 — fin de cycle | 1.5 | #39 | feat(client): ajouter les runes Svelte 5 du temps réel |
| 36 | P3 — fin de cycle | 1 | #43 | feat(client): accepter une adresse de serveur sur le composant racine |
| 37 | P3 — fin de cycle | 5 | #50 | docs(tutoriels): écrire la partie 2, jusqu'au déploiement |
| 38 | P3 — fin de cycle | 2 | #51 | docs(guides): écrire les recettes d'exploitation |
| 39 | P3 — fin de cycle | 1 | #52 | docs(guides): dégraisser l'essai sur l'outillage agent |
| — | P1 — figé à la création | — | #83 | feat(notification): doter le framework de l'envoi de messages sortants |
| — | P1 — figé à la création | 1 | #84 | feat(mail): créer le module et son service d'envoi |
| — | P1 — figé à la création | 1 | #85 | feat(mail): composer un courriel depuis un gabarit |
| — | P1 — figé à la création | 0.5 | #86 | feat(mail): envoyer un courriel en ligne de commande |
| — | P1 — figé à la création | 1 | #87 | test(mail): éprouver l'envoi contre un vrai serveur de test |
| — | P1 — figé à la création | 0.5 | #88 | docs(mail): documenter la configuration et le premier envoi |
| — | P2 — décision | 1 | #89 | docs(notification): faire la veille des canaux de communication attendus |
| — | P1 — figé à la création | 1 | #90 | test(devkit): auditer le module généré comme l'application générée |

## Jalon 10.1 — 15 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 20 | P3 — fin de cycle | 1 | #28 | feat(config): surcharger la config d'application par l'environnement |
| 23 | P3 — fin de cycle | 0.5 | #31 | chore: refermer les bogues résolus et les tests jamais lancés |
| 30 | P3 — fin de cycle | 5 | #34 | feat(client): implémenter le noyau applicatif côté navigateur |
| 50 | P2 — décision | 1.5 | #63 | test(bancs): rendre chaque banc indépendant du décor partagé |
| 50.1 | P3 — fin de cycle | 0.5 | #76 | test(bancs): constater le décor avant de lancer les suites |
| 50.2 | P3 — fin de cycle | 0.5 | #77 | test(bancs): donner à chaque banc son propre compte |
| 50.3 | P3 — fin de cycle | 0.5 | #78 | test(core): remplacer les seuils absolus des tests de performance |
| 51 | P3 — fin de cycle | 0.5 | #64 | perf(dev): supprimer les 45 secondes de build au démarrage |
| 52 | P3 — fin de cycle | 0.5 | #66 | feat(orm): exposer la taille du pool de connexions |
| 53 | P3 — fin de cycle | 1 | #67 | feat(orm): capturer le contexte des requêtes qui échouent |
| 54.5 | P3 — fin de cycle | 2 | #79 | refactor(studio): dériver l'affichage des rôles servis par le serveur |
| 57 | P3 — fin de cycle | 0.5 | #69 | feat(studio): signaler visiblement un serveur en dérogation |
| 60 | P3 — fin de cycle | 0.5 | #72 | test(http): mesurer la tenue mémoire sur plusieurs heures |
| 61 | P3 — fin de cycle | 0.5 | #73 | perf(http): rejouer le profil processeur du chemin chaud |
| 62 | P2 — décision | 0.5 | #75 | chore(core): trancher l'héritage des dépendances déclarées |

## Backlog — aucune date promise · 5 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 54 | P3 — fin de cycle | 1 | #71 | feat(security): rendre la hiérarchie de rôles extensible |
| 55 | P3 — fin de cycle | 2 | #70 | feat(webhooks): séparer les événements métier du journal d'audit |
| 56 | P3 — fin de cycle | 1 | #68 | feat(studio): garder les préférences d'affichage côté serveur |
| 58 | P3 — fin de cycle | 3 | #74 | feat(studio): éditer la configuration d'un module à chaud |
| 59 | P3 — fin de cycle | 3 | #65 | test(paquets): rapatrier les preuves de bout en bout dans leur paquet |

