---
name: nodefony-migration-audit
description: >
  Audit phase-par-phase de l'état RÉEL de la migration Nodefony — confronte MIGRATION_STATUS.md au
  code (grep/ls/find), une phase à la fois, corrige les écarts. Inclut un mode synthèse graphique
  (barres de progression par phase) à la demande.
  Déclencheurs : "audit migration", "état des lieux migration", "où en est la migration",
  "avancement migration", "vérifier MIGRATION_STATUS", "revue phase par phase", "mets à jour le migration".
---

# migration-audit

Revue **interactive et vérifiée dans le code** de la migration Nodefony. Le fichier `MIGRATION_STATUS.md` dérive (le tableau résumé n'est jamais re-synchronisé du détail). Ce skill confronte chaque phase au **code réel** et présente l'écart au user, **une phase à la fois**, pour qu'il comprenne l'état réel sans avaler 1600 lignes.

## Principe (ce qui marche — retour user 2026-05-20)

1. **Une phase = un message.** Titre de la phase + tableau `Fichier dit | Réel (code) | Preuve` + verdict en 1 ligne. Puis **STOP** — attendre que le user dise « suivante ».
2. **Vérifier dans le CODE, jamais faire confiance au fichier.** `ls`/`find`/`grep` l'implémentation réelle (module existe ? test existe ? endpoint défini ? décorateur présent ?).
3. **Source de vérité = la roadmap priorisée P0–P16** (sections `### P0`…`### P16`), PAS le tableau résumé « par composant » (périmé + granularité différente = sous-items vs tâches).
4. **Corriger à la fin**, après accord explicite du user (pas au fil de l'eau, sauf demande).
5. **Persister l'avancement** entre tours dans la mémoire IA `project_migration_audit_progress` (le user peut couper et reprendre).

## Workflow

### Étape 0 — Cadrage

Lire `MIGRATION_STATUS.md` (au moins les en-têtes `grep -nE "^### P[0-9]+|^## Phase"`).

**Si un mode est déjà fourni** (slash command `/migration-audit <mode>` ou demande explicite du user) → **ne PAS poser de question**, exécuter directement ce mode. Sinon, demander via `AskUserQuestion`.

Modes :

| Mode | Argument slash | Comportement |
|------|----------------|--------------|
| **Phase par phase** (défaut) | `phase` / vide | Revue interactive P0→P16 (Étape 1), STOP après chaque phase, le user dit « suivante ». |
| **Tableau / synthèse** | `tableau` `synthèse` `résumé` | Uniquement la synthèse graphique (barres + encadré « prochaine étape »). Aucun arrêt, aucune correction (sauf demande). |
| **Auto** | `auto` | Audit COMPLET non-interactif : exécuter la vérif code de **toutes** les phases et sortir leurs tableaux **d'affilée** (sans STOP « suivante »), puis le récap (Étape 2) + corrections proposées. Demander l'accord avant d'écrire. |
| **Une phase** | `P<n>` (ex. `P6`) | Audit ciblé d'une seule phase. |
| **Reprendre** | `reprendre` | Lire `project_migration_audit_progress`, repartir où on s'était arrêté. |

### Étape 1 — Boucle phase par phase (modes `phase` et `auto`)

> En mode **`auto`**, dérouler la boucle pour **toutes** les phases sans le « STOP »
> entre chacune (enchaîner les tableaux), puis passer directement à l'Étape 2.
> En mode **`phase`**, STOP après chaque phase et attendre « suivante ».

Pour chaque phase, dans cet ordre :

1. **Vérifier dans le code** (recettes ci-dessous selon le type de tâche).
2. **Présenter** (gabarit) :

   ```
   ## P<n> — <titre exact de la phase>

   | Tâche | Fichier dit | Réel (code) | Preuve |
   |-------|-------------|-------------|--------|
   | P<n>.x …      | ✅/🔶/⬜ | ✅/🔶/⬜ | <fichier:ligne / module / absent> |

   Verdict : <1 phrase> — [OK | ❌ sous-compté | ❌ chiffre faux | …]
   Dis « suivante ».
   ```
3. **STOP.** Ne pas enchaîner. Attendre « suivante » (ou « détails P<n>.x », « corrige cette phase », « va à P<k> »).
4. Noter l'écart dans la mémoire d'avancement.

> Garder ≤ ~12 lignes de tableau par phase. Le but est la **compréhension**, pas l'exhaustivité brute.

### Mode « synthèse graphique » (à la demande — « résumé migration », « avancement migration »)

Sortie compacte pour **compréhension globale**, sans revue phase-par-phase. Deux variantes selon la demande :

#### Variante A — barres rapides (défaut)

Trié par % décroissant, barres ASCII.

**Formule %** : `% = (✅ + 0,5 × 🔶) / tâches`. Barre 10 segments : `n = round(% / 10)` blocs `█`, reste `░`.

```
ÉTAT MIGRATION NODEFONY — <N> tâches — vérifié code <date>
  P0  bugs            ██████████ 100%   6/6     ✅ bouclé
  …
  P5  user/orm core   ░░░░░░░░░░   0%   0/16   ◀ CHEMIN CRITIQUE
  GLOBAL  ███░░░░░░░  29%   (35 ✅ · 24 🔶 · 105 ⬜)
```

#### Variante B — « tableau parfait » (« tableau complet », « avec détails »)

Tableau riche avec **dépendances, priorité, effort, temps**.

Colonnes : `Phase | Tâches (✅/🔶/⬜) | % | Diff | Prio | Dépend | Reste (ses.) | ~Temps`.

**Conversions temps** : `1 session ≈ 3 h` (CLAUDE.md : 1–4 h) · `1 jour ≈ 6 h` productives.
`Reste (ses.) = sessions_totales_phase × (1 − %)`. `~Temps = Reste × 3 h` (afficher en `~Xh` si < 10h, sinon `~Xh (~Yj)`).
Les **sessions totales par phase** viennent de la section `### Synthèse effort total` du fichier (+ P16 ≈ 26).

**Échelles** :
- Difficulté : 🟢 Facile · 🟡 Moyen · 🟠 Difficile · 🔴 Expert.
- Priorité : 🔴 P1 critique (chemin critique MVP) · 🟠 P2 haute · 🟡 P3 moyenne · ⚪ P4 future.
- **Dépendances** : tirer la colonne `Dépendances` de la roadmap (déps inter-phases clés ; mettre en gras les bloquantes, ex. **P5**, **P10**).

Règles communes (A **et** B) :
- Recompter ✅/🔶/⬜ depuis la roadmap P0–P16 (jamais hardcoder).
- **TOUJOURS afficher le graphe à barres** (variante A) — même en mode tableau parfait, mettre le graphe AVANT le tableau détaillé (le user veut le visuel).
- Toujours finir par la ligne **TOTAL** (compteurs + reste sessions + reste `~h / ~j`).
- **TOUJOURS terminer par un encadré « ➡️ PROCHAINE ÉTAPE »** (voir gabarit ci-dessous) — c'est la conclusion la plus utile.
- Annotations : `legacy en place`, `cassé claude-ts`, `précurseur`, `◀ session courante`.

#### Encadré « PROCHAINE ÉTAPE » (obligatoire en fin de synthèse)

Déterminer la prochaine étape = **première phase non finie sur le chemin critique** (typiquement P5 tant que sécurité pas faite). Format encadré ASCII :

```
╔═══════════════════════════════════════════════════════════════╗
║  ➡️  PROCHAINE ÉTAPE  →  <Phase> : <titre court>               ║
╠═══════════════════════════════════════════════════════════════╣
║  Pourquoi : <1-2 lignes — ce que ça débloque>                  ║
║  1er pas concret (ordre roadmap) :                             ║
║   • <P_x.y  sous-tâche>   ~<effort>                            ║
║   • …                                                          ║
║  Chemin critique MVP : <P5→P6 ≈ X ses ≈ ~Y jours>             ║
╚═══════════════════════════════════════════════════════════════╝
```

Règle de choix : tant que **P5/P6 = 0%**, la prochaine étape est **P5** (ORM core + @nodefony/user) — c'est le bloqueur racine de la sécurité, du Studio data-réelle, des drivers ORM, de l'IA. Lister les 2-3 premières sous-tâches roadmap avec leur effort.

### Étape 2 — Synthèse + corrections (fin)

1. Tableau récap **toutes phases** : `Phase | Fichier | Réel vérifié | Erreur ?`.
2. Énoncer la **cause racine** si récurrente (ici : résumé par composant jamais re-synchro + granularité ≠ roadmap).
3. Demander l'accord pour corriger (`AskUserQuestion` ou attendre « ok / corrige »).
4. Appliquer :
   - **Marques détail** : préfixer le `#` de la tâche par `✅`/`🔶` + note `vérif audit <date>` + preuve.
   - **Lignes résumé** clairement mappables (1 phase ↔ 1 ligne) : recaler les compteurs.
   - **Avertissement** en tête du tableau résumé s'il reste périmé : « indicatif, roadmap = vérité ».
   - **Chiffres factuels** (ex. `npm audit` count).
5. **Ne PAS** recompter le tableau par composant entier si la granularité diffère (risque d'inventer des chiffres) → avertissement + lignes nettes seulement.
6. Commit `docs(migration): audit phase-par-phase vérifié code …`.

## Interactivité & UX (pour que le user COMPRENNE, pas juste lise)

À chaque phase présentée, ajouter ces éléments de compréhension :

1. **Barre de progression** en tête : `Phase 3/17  ▓▓▓░░░░░░░░░░░░░░` — le user sait où il en est.
2. **Tally cumulatif** sous le tableau : `Cumul revu : 12 ✅ · 5 🔶 · 40 ⬜ · 4 ❌ écarts fichier`.
3. **Verdict en français simple** (1 phrase non-jargon) : pas « P2.1 ✅ via P1.1 » seul, mais « En vrai le timing des phases EST déjà mesuré (livré avec P1) — le fichier l'avait oublié. »
4. **Drapeau visuel de l'écart** : `🟢 fichier juste` · `🟠 fichier sous-compte (on a fait + que marqué)` · `🔴 fichier faux (chiffre/statut erroné)`.
5. **Nav explicite en pied** : `→ « suivante » · « détails P3.x » · « corrige cette phase » · « saute à P10 »`.
6. **Fin de boucle** : un **tableau récap visuel** (toutes phases, 1 ligne/phase, drapeau couleur) + une reco **« où concentrer l'effort »** (chemin critique réel : ce qui débloque le plus — typiquement P5→P6).

> Règle d'or UX : le user doit pouvoir répondre en **1 mot** (« suivante ») et comprendre l'état d'une phase en **5 secondes**. Si un tableau dépasse ~12 lignes ou nécessite du scroll mental, le résumer.

## Recettes de vérification (code, pas fichier)

| Type de tâche | Commande de vérif |
|---------------|-------------------|
| Module existe + a du code | `find src/packages/@nodefony/<m> -name '*.ts' \| grep -vE 'dist\|node_modules\|d.ts' \| wc -l` (0 = coquille vide) |
| Service/classe précise | `grep -rl "class <X>" src/.../<m> --include=*.ts \| grep -v dist` |
| Décorateur / API | `grep -rln "<@Decorator>\|<symbolName>" src --include=*.ts \| grep -v dist` ou `.ai/symbols.json` |
| Endpoint/route défini | `grep -rhoE '@(Get\|Post\|controller)\("[^"]+"\)' <controller>.ts` |
| Test existe | `find src/.../<m> -iname '*<feature>*test*' \| grep -v dist` |
| Symbole exporté | `jq '.symbols.<Name>' .ai/symbols.json` (cf skill `nodefony-generate-symbols`) |
| Vulnérabilités | `npm audit 2>/dev/null \| grep vulnerabilities \| tail -1` |
| Runtime (endpoint répond) | serveur up (`nodefony-start-server`) puis `curl -sk https://127.0.0.1:5152/<route>` |

> ⚠️ Une tâche peut être **livrée via une autre** (ex. P2.1 timing = livré par P1.1 ; tests P4.4 WS écrits pendant P0/P1). Toujours chercher le livrable, pas le numéro.

## Pièges connus (issus de l'audit 2026-05-20)

- **Tableau résumé `## Progression globale` = périmé** (ex. `HTTP / WS 0✅` alors que les 4 serveurs tournent). Ne jamais s'y fier ; c'est la roadmap P0–P16 qui porte les vraies marques.
- **Granularité ≠** : le résumé compte ~297 sous-items, la roadmap ~150 tâches → pas de mapping 1:1. Ne pas tenter un recompte total exact.
- **Structures de module** : certains modules IA utilisent `src/` (pas `nodefony/`) → `find` large, pas seulement `nodefony/**`.
- **Faux négatif `require(...package.json)`** : un paquet ESM avec `exports` peut bloquer `require` de sous-chemins → vérifier via `ls node_modules/...` ou `npm ls`.
- **Modules « legacy en place »** : P6 security (Factory/Provider) et P7 ORM (sequelize/mongoose) **existent et tournent** même si la refonte est ⬜ → marquer 🔶, pas ⬜, et le noter.
- **Cause d'augmentation des vulns** : un `npm install --legacy-peer-deps` (Angular) peut faire grimper le compte → toujours re-`npm audit`.

## Mémoire liée

- `project_migration_audit_progress` — avancement + corrections de la dernière passe (reprise).
- `feedback_session_pitfalls`, `feedback_turbo_cache_stale_logs` — pièges build/dist pendant la vérif.
