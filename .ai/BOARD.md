<!-- GÉNÉRÉ par le skill `nodefony-session` (scripts/board-snapshot.mjs).
     NE PAS ÉDITER À LA MAIN.
     La source est GitHub ; ce fichier n'en est qu'une empreinte, pour
     reprendre le travail hors ligne. L'éditer ferait diverger la copie
     de sa source, ce que ce fichier existe précisément pour empêcher. -->

# État du pilotage — empreinte des tickets

> Empreinte prise le **2026-08-27 11:55** (UTC).
> La **source** est le tableau de bord GitHub ; relire ici ne dispense pas de
> vérifier en ligne quand le réseau répond — une empreinte vieille de trois
> jours a manqué trois jours de travail.

## Jalons

| Jalon | Ouverts | Fermés | Échéance |
| --- | ---: | ---: | --- |
| 10.1 | 3 | 1 | — |
| 10.0.0 | 33 | 3 | 2026-11-15 |

## ➡️ Le prochain dans l'ordre

**#41 — fix(client): corriger le contrat du noyau client avant de le figer**

Ordre 1.5 · P0 — bloque le reste · 0.5 j · jalon 10.0.0

> L'ordre encode les **dépendances**, pas le moment : un ticket petit dont le
> contexte est déjà chargé se prend maintenant (skill `nodefony-ticket`).

## Jalon 10.0.0 — 33 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 1.5 | P0 — bloque le reste | 0.5 | #41 | fix(client): corriger le contrat du noyau client avant de le figer |
| 1.6 | P0 — bloque le reste | — | #54 | feat(client): simplifier la socket cliente pour un débutant |
| 1.8 | P1 — figé à la création | 1 | #56 | chore(pilotage): donner un ticket aux dettes qui n'en ont pas |
| 2 | P0 — bloque le reste | 5 | #17 | feat(orm): livrer les migrations de schéma en production |
| 3 | P0 — bloque le reste | 3 | #18 | feat(cli): rendre l'entité User à l'application |
| 4 | P1 — figé à la création | 2 | #19 | refactor(drizzle): rendre optionnels les pilotes de base de données |
| 6 | P1 — figé à la création | 0.5 | #22 | ci(security): détecter les secrets commités dans le dépôt |
| 6 | P1 — figé à la création | — | #53 | docs: remettre la documentation à niveau avant la version 10 |
| 6.5 | P1 — figé à la création | 0.5 | #45 | docs(guides): retirer « mocha + bun » et les pages fantômes |
| 6.6 | P1 — figé à la création | 1 | #46 | docs(core): documenter l'outillage de test livré aux applications |
| 6.7 | P1 — figé à la création | 0.5 | #48 | docs(site): mettre les tutoriels avant l'architecture |
| 7 | P1 — figé à la création | 1 | #33 | feat(studio): protéger toute la surface d'administration par un rôle |
| 8 | P1 — figé à la création | 0.5 | #21 | feat(cli): ajouter la commande de changement de mot de passe |
| 9.5 | P1 — figé à la création | 0.5 | #42 | fix(client): corriger l'adresse du serveur temps réel par défaut |
| 10 | P2 — décision | 0.5 | #26 | refactor(client)!: retirer l'appel non typé de la socket cliente |
| 11 | P2 — décision | 0.5 | #25 | ci(tests): remettre au vert le test de tenue dans la durée |
| 12 | P3 — fin de cycle | 2 | #20 | test(security): attaquer les paquets publiés avant leur sortie |
| 12.5 | P3 — fin de cycle | 0.5 | #47 | docs(release): préparer la page d'accueil du jour de la publication |
| 13 | P3 — fin de cycle | 1.5 | #27 | chore(release): publier les paquets de la version 10 sur npm |
| 14 | P3 — fin de cycle | 0.5 | #23 | feat(cli): générer la page de signalement de faille des apps |
| 15 | P3 — fin de cycle | 0.5 | #24 | docs(security): expliquer comment obtenir un jeton |
| 17 | P3 — fin de cycle | 1 | #44 | feat(docs): raccourcir les libellés de menu des titres longs |
| 18 | P3 — fin de cycle | 0.5 | #49 | docs: corriger les 108 renvois au code devenus faux |
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

## Jalon 10.1 — 3 ouverts

| Ordre | Prio | Jours | Ticket | Titre |
| --- | --- | ---: | --- | --- |
| 20 | P3 — fin de cycle | 1 | #28 | feat(config): surcharger la config d'application par l'environnement |
| 23 | P3 — fin de cycle | 0.5 | #31 | chore: refermer les bogues résolus et les tests jamais lancés |
| 30 | P3 — fin de cycle | 5 | #34 | feat(client): implémenter le noyau applicatif côté navigateur |

