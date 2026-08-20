---
name: nodefony-migration-audit
description: >
  Audit phase-par-phase de l'état RÉEL de la migration Nodefony — confronte MIGRATION_STATUS.md au
  code (grep/ls/find), une phase à la fois, corrige les écarts. Inclut un mode synthèse graphique
  (barres de progression par phase) ET un mode VÉRITÉ exhaustif : croise code + mémoire IA + docs +
  MD modules → fichier d'audit persistant + assainissement de la FORME du dashboard (anti-obésité).
  Déclencheurs : "audit migration", "état des lieux migration", "où en est la migration",
  "avancement migration", "vérifier MIGRATION_STATUS", "revue phase par phase", "mets à jour le migration",
  "gros point migration", "fichier vérité", "audit vérité", "assainir le dashboard migration".
---

# migration-audit

Revue **interactive et vérifiée dans le code** de la migration Nodefony. Le fichier `MIGRATION_STATUS.md` dérive (le tableau résumé n'est jamais re-synchronisé du détail). Ce skill confronte chaque phase au **code réel** et présente l'écart au user, **une phase à la fois**, pour qu'il comprenne l'état réel sans avaler 1600 lignes.

> ## ⚠️ Charge-moi — ne refais PAS l'audit « à la main »
>
> **2 briques sont de la valeur DURE, à ne JAMAIS ré-improviser** (sinon erreur garantie, vécu plusieurs fois) :
>
> 1. **Le comptage `awk` sur la 1ʳᵉ cellule** (§ Variante A) — à la main on compte les emoji n'importe où → **chiffres faux**.
> 2. **La méthode de dégraissage** (§ Mode `vérité` n°3) — sans elle le dashboard **ré-enfle** (278 KB illisible).
>
> Le reste (rendus ASCII, gabarits) = **interface de compréhension** : précieux pour que le user pige en 5 s,
> mais **inerte si ce skill n'est pas chargé**. **Réflexe** : à tout « point / audit / état migration »,
> charger ce skill (ou taper `/migration-audit`) **AVANT** de toucher `MIGRATION_STATUS.md`. Le faire à la
> main = re-dériver les bugs que ce skill a déjà résolus (le piège exact du 2026-06-05 : audit fait sans lui).

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

<!-- prettier-ignore -->
| Mode | Argument slash | Comportement |
| --- | --- | --- |
| **Phase par phase** (défaut) | `phase` / vide | Revue interactive P0→P16 (Étape 1), STOP après chaque phase, le user dit « suivante ». |
| **Tableau / synthèse** | `tableau` `synthèse` `résumé` | Uniquement la synthèse graphique (barres + encadré « prochaine étape »). Aucun arrêt, aucune correction (sauf demande). |
| **Auto** | `auto` | Audit COMPLET non-interactif : exécuter la vérif code de **toutes** les phases et sortir leurs tableaux **d'affilée** (sans STOP « suivante »), puis le récap (Étape 2) + corrections proposées. Demander l'accord avant d'écrire. |
| **Une phase** | `P<n>` (ex. `P6`) | Audit ciblé d'une seule phase. |
| **Reprendre** | `reprendre` | Lire `project_migration_audit_progress`, repartir où on s'était arrêté. |
| **Vérité / assainir** | `vérité` `assainir` | Passe « gros point » : audit exhaustif croisé (code + mémoire IA + docs + MD) → **fichier d'audit persistant** + **assainissement de forme** du dashboard. Voir section dédiée. |

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

##### Comptage FIABLE (recette unique — ne pas improviser)

> **Le fichier marque de façon incohérente** (1ʳᵉ cellule pour P0–P10, parfois colonne Notes
> pour P14/P12). Règle d'or : **l'autorité de statut = l'emoji en TÊTE de la 1ʳᵉ cellule du tableau**
> (la colonne `#`). Une tâche = **une ligne de tableau** dont la 1ʳᵉ cellule est un `P<n>.<x>`.
> Statut : `✅` si la 1ʳᵉ cellule commence par ✅, `🔶` si 🔶, **sinon `⬜`** (pas de marque = à faire).

```bash
# Borne la roadmap P0–P16 (s'arrête à "### Synthèse effort total")
S=$(grep -n "^### P0" MIGRATION_STATUS.md | head -1 | cut -d: -f1)
E=$(grep -n "^### Synthèse effort" MIGRATION_STATUS.md | head -1 | cut -d: -f1)
awk -v s="$S" -v e="$E" 'NR>=s && NR<e' MIGRATION_STATUS.md | awk -F'|' '
  /^### P[0-9]+/ { if(ph)printf "%s %d %d %d\n",ph,d,p,t; ph=$0; sub(/^### /,"",ph); sub(/ .*/,"",ph); d=p=t=0; next }
  $2 ~ /P[0-9]+\.[0-9]/ {            # ligne de tâche : 1re cellule = le # de tâche
    if($2 ~ /✅/) d++; else if($2 ~ /🔶/) p++; else t++ }   # statut = emoji 1re CELLULE
  END { if(ph)printf "%s %d %d %d\n",ph,d,p,t }'
```

**❌ Méthodes à NE PAS utiliser** (sources des chiffres faux) :

- `gsub(/✅/...)` (compter les occurrences) → multi-emoji par ligne = sur-compte.
- `$0 ~ /✅/` (emoji n'importe où dans la ligne) → une **note** « ✅ **Décision** » ou « ✅ 2026 » dans
  la colonne Notes d'une tâche **non livrée** (ex. `P5.0b`) compte un faux ✅.
- Faire confiance au tableau résumé `## Progression globale` (périmé, granularité ≠).

**⚠️ Divergence 1ʳᵉ cellule ≠ réalité** (ex. P14 « fait » mais marqué en notes, pas en tête) = une
**INCOHÉRENCE À CORRIGER** (normaliser, cf. ci-dessous), **pas** à contourner en changeant la formule.

##### Formule + rendu

`% = (✅ + 0,5 × 🔶) / tâches`. Barre 10 segments : `n = round(% / 10)` blocs `█`, reste `░`.
Emoji de phase : `✅` si 100 %, `⬜` si 0 %, sinon `🔶`. Tri par % décroissant ; **flag `◀` le chemin
critique** (P5/P6) même s'il n'est pas en tête.

```
━━━ NODEFONY · ÉTAT MIGRATION ━━━━━━━━━━━━━━━━━━━━ vérifié code <date> ━━━
 ✅ P0   Bugs bloquants        ██████████  100%    6/6
 ✅ P1   Fondations            ██████████  100%    8/8
 🔶 P5   ORM / User / Session  ██████░░░░   62%   10/17   ◀ chemin critique
 ⬜ P6   Security              ░░░░░░░░░░    0%    0/13   ◀ bloqueur suivant
 …  (une ligne par phase, triée % décroissant)
─────────────────────────────────────────────────────────────────────────
 GLOBAL                        ████░░░░░░   ~42%   46✅ · 18🔶 · 70⬜  (134)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

> Aligner les colonnes (titre ~20c, barre 10c, %, `n/N`). Ne PAS tenter une bordure droite fermée
> (largeur emoji variable selon terminal → casse l'alignement) : règles `━`/`─` pleines uniquement.

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

Règle de choix : tant que **P5/P6 ne sont pas terminées**, la prochaine étape est la première phase non finie du chemin critique — typiquement **P5** (ORM core + @nodefony/user), bloqueur racine de la sécurité, du Studio data-réelle, des drivers ORM, de l'IA. **Mesurer leur % réel dans le code, ne pas le supposer** (P5.2/P5.3/P7.4 déjà livrés au 2026-05-21) ; lister les 2-3 premières sous-tâches NON faites avec leur effort.

### Normalisation des marques (CORRIGER les incohérences) — objectif du skill

Le but n'est pas que de _mesurer_ l'état, c'est de **rendre le fichier cohérent** pour que toute mesure
future soit triviale et fiable. **Convention unique imposée** : chaque ligne de tâche porte son statut
en **TÊTE de la 1ʳᵉ cellule** (`| ✅ P5.2 | …`, `| 🔶 P5.4 | …`, `| ⬜ P5.7 | …`). Marquer `⬜`
explicitement les tâches non faites (plus de « pas de marque » ambigu).

**Détecter les incohérences** = comparer 2 comptes :

```bash
# A) autorité 1re cellule (cf recette fiable)   B) emoji n'importe où ($0 ~ /✅|🔶/)
# Une phase où A < B = des tâches marquées AILLEURS que la 1re cellule → à normaliser.
```

**Corriger (par ligne divergente, avec jugement — ne pas automatiser aveuglément)** :

1. Lire la ligne (et au besoin la section détaillée `## Phase N`).
2. Décider le vrai statut : **livré** (`✅`), **partiel/legacy en place** (`🔶`), **à faire** (`⬜`).
   ⚠️ Une **note** « ✅ **Décision** … » = décision prise, **PAS** une tâche livrée → reste `⬜`/`🔶`.
3. Préfixer la 1ʳᵉ cellule par l'emoji (déplacer la marque depuis les notes si elle y était).
4. Re-lancer le compteur fiable → A == B (plus de divergence) = fichier cohérent.

> Toujours **montrer le diff** (avant/après) et **demander l'accord** avant d'écrire dans
> `MIGRATION_STATUS.md` (c'est la source de vérité). Commit dédié `docs(migration): normalise les marques de statut (1re cellule) …`.

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

### Mode `vérité` / `assainir` — audit exhaustif croisé + assainissement (passe « gros point »)

> Déclencheurs : « gros point migration », « fichier vérité », « audit complet », « confronte TOUT au code ».
> **Référence vivante** (passe réelle 2026-06-05, dashboard **278 KB → 32 KB**) :
> `AUDIT-verite-2026-06` (mémoire IA `core-dev/migration/`).

Va plus loin que `auto` : croise **toutes les sources**, écrit un **fichier d'audit persistant**, puis
**assainit la FORME** du dashboard. Tracer les phases avec `TaskCreate` (1 lot / groupe de phases).

#### 1. Croiser les sources — hiérarchie de fraîcheur

```
FRAÎCHEUR DES SOURCES  ·  on resync TOUJOURS vers le code, jamais l'inverse
  ① Code ......................... VÉRITÉ        (git log = autorité absolue)
  ② Mémoire IA (MEMORY.md + project_*) quasi à jour (décisions récentes)
  ③ MD modules (CLAUDE.md/MEMORY.md) . à jour si le module a bougé récemment
  ④ MIGRATION_STATUS.md ............ ⚠️ LE PLUS EN RETARD (tenu à la main, fin de session)
```

À détecter (l'écart vit entre ③/④ et ①) : décision actée **non répercutée** (ex. virage ORM présent dans
la section _Décisions_ mais pas dans les _lignes de tâches_) · **réf morte** (PM2, mikroorm) · dette `🚧`
en fait **résolue dans le code** (TOUJOURS vérifier le code, pas croire la marque) · module réel **non
tracké** · métrique de **surface** trompeuse (cf piège « banc ORM » plus bas).

#### 2. Écrire le fichier d'audit PERSISTANT

Au fil de l'eau dans la mémoire IA `core-dev/migration/AUDIT-verite-<AAAA-MM>.md` (survit au `/clear`/coupure, devient le
matériau du resync). Squelette : `frontmatter` → **table synthèse des écarts** → 1 section / phase
(`déclaré vs réel + sonde code`) → section **croisement docs/mémoire/MD** → **verdict global**.

**Rendu — table « synthèse des écarts majeurs »** (en tête du fichier, le plus consulté) :

```markdown
| #   | Écart                                             | Gravité          | Action             |
| --- | ------------------------------------------------- | ---------------- | ------------------ |
| F1  | dashboard 278 KB — cellules-journal de 3 800 car. | 🔴 Forme         | dégraisser → docs/ |
| 1   | `documentation` = module complet mais 1 occ.      | ➕ non tracké    | ajouter ligne      |
| 2   | DETTE-CFG marquée 🚧 mais RÉSOLUE dans le code    | 🟠 doc périmée   | passer 🚧 → ✅     |
| 4   | virage ORM acté (06-02) pas répercuté sur P5/P7   | 🔴 contradiction | recadrer ⏭️/🔨     |
```

> Légende gravité : `✅` déclaré = réel · `⚠️` périmé/optimiste · `🔴` contradiction nette · `➕` réel non tracké · `🟠` doc en retard sur le code.

**Rendu — verdict par phase** (1 ligne dense, drapeau de fidélité déclaré↔réel) :

```
P0  Bugs bloquants     100%  6✅            🟢 fidèle
P5  Session/User/ORM    58%  9✅ 3🔶 6⬜    🟢 fidèle   ⚠️ virage ORM à répercuter (P5.7 ⏭️ caduc)
P6  Security            12%  0✅ 4🔶 13⬜   🟢 fidèle   (S1 présent · 0 test = 0 tâche close)
P7  ORM drivers         50%  2✅ 5🔶 2⬜    🟡 % à recadrer (mikroorm vaporware, sequelize SORTI Ph.1)
P15 Mediasoup            0%  —— 8⬜         🟢 fidèle   (mod/mediasoup = banc ORM ≠ implé télécom)
```

> Drapeau = fidélité du COMPTAGE au code : `🟢 fidèle` · `🟡 vision/forme périmée` · `🔴 chiffre faux`.

#### 3. Assainir la FORME (dégraissage) — le vrai gain

Le dashboard dérive vers l'**obésité** : des cellules de tableau deviennent un **journal de commits inline**
(vécu : cellules de ~3 800 car., fichier 278 KB, illisible/non-diffable). Le resync ne corrige pas que les
chiffres, il **dégraisse** :

- **`Write` du fichier condensé `>>>` N `Edit` chirurgicaux** : matcher un `old_string` de 3 800 car. coûte
  plus de tokens que réécrire le dashboard court d'un bloc. Quand `> ~50 %` est à condenser → `Write`.
- **Préserver TOUTES les tâches** (1 ligne courte : `| ✅ P5.2 | Tâche | 1 phrase + hash |`). Le détail-journal
  n'est PAS perdu → il reste dans `git log` + les mémoires + la mémoire IA `core-dev/migration/`.

**Rendu — bilan d'assainissement** (à présenter après le `Write`, prouve le gain) :

```
ASSAINISSEMENT  ·  MIGRATION_STATUS.md
                       avant        après        Δ
  taille               278 KB   →   32 KB      −88 %
  lignes               729      →   364
  cellule max          3832     →   228 car.
  tâches préservées    117      =   117          (0 perdue)
```

> Mesurer : `wc -l` · `du -h` · `awk '{print length"\t"NR}' f | sort -rn | head` (cellule max + n° de ligne).
> ⚠️ `Read` **échoue > 256 KB / 25000 tokens** → lire par tranches (`offset`/`limit`) ; l'`awk` ci-dessus
> localise les cellules géantes à tuer.

#### 4. Clôturer — carte « verdict global »

À présenter au user en fin de passe (la photo qui survit au `/clear`) :

```
╔══════════════════ VERDICT · AUDIT VÉRITÉ ══════════════════╗
║  Chiffres déclarés :  ✅ HONNÊTES  (déclaré ≈ réel)         ║
║  Global réel       :  50 %   (74✅ · 35🔶 · 73⬜ · 182)     ║
║  Le problème       :  ⚠️ la FORME, pas le fond              ║
║    • dashboard 278 KB → cellules-journal illisibles         ║
║    • 1 virage (ORM) acté mais non répercuté                 ║
║    • 2 réfs mortes (PM2, mikroorm) + 1 dette déjà résolue   ║
║  ➡️ Prochaine étape :  🥇 durcissement ORM                  ║
╚═════════════════════════════════════════════════════════════╝
```

> Le verdict typique : **« les chiffres sont honnêtes, le dashboard les dit MAL »**. Si l'audit révèle
> au contraire un **chiffre faux** (statut ≠ code), c'est un `🔴` à recaler en priorité.

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

<!-- prettier-ignore -->
| Type de tâche | Commande de vérif |
| --- | --- |
| Module existe + a du code | `find src/packages/@nodefony/<m> -name '*.ts' \| grep -vE 'dist\|node_modules\|d.ts' \| wc -l` (0 = coquille vide) |
| Service/classe précise | `grep -rl "class <X>" src/.../<m> --include=*.ts \| grep -v dist` |
| Décorateur / API | `grep -rln "<@Decorator>\|<symbolName>" src --include=*.ts \| grep -v dist` ou `.ai/symbols.json` |
| Endpoint/route défini | `grep -rhoE '@(Get\|Post\|controller)\("[^"]+"\)' <controller>.ts` |
| Test existe | `find src/.../<m> -iname '*<feature>*test*' \| grep -v dist` |
| Symbole exporté | `jq '.symbols.<Name>' .ai/symbols.json` (cf skill `nodefony-inspect`) |
| Vulnérabilités | `npm audit 2>/dev/null \| grep vulnerabilities \| tail -1` |
| Runtime (endpoint répond) | serveur up (`nodefony-start-server`) puis `curl -sk https://127.0.0.1:5152/<route>` |

> ⚠️ Une tâche peut être **livrée via une autre** (ex. P2.1 timing = livré par P1.1 ; tests P4.4 WS écrits pendant P0/P1). Toujours chercher le livrable, pas le numéro.

## Pièges connus (issus des audits 2026-05-20 + 2026-06-05)

- **Comptage faux par emoji-occurrence / emoji-n'importe-où** (audit 2026-05-22) : sur-compte
  (multi-emoji, notes « ✅ Décision » d'une tâche non faite). **Autorité = emoji 1ʳᵉ cellule** ($2),
  une ligne = une tâche. Voir recette fiable « Variante A ». Marquage incohérent du fichier → **normaliser**.
- **Tableau résumé `## Progression globale` = périmé** (ex. `HTTP / WS 0✅` alors que les 4 serveurs tournent). Ne jamais s'y fier ; c'est la roadmap P0–P16 qui porte les vraies marques.
- **Granularité ≠** : le résumé compte ~297 sous-items, la roadmap ~150 tâches → pas de mapping 1:1. Ne pas tenter un recompte total exact.
- **Structures de module** : certains modules IA utilisent `src/` (pas `nodefony/`) → `find` large, pas seulement `nodefony/**`.
- **Faux négatif `require(...package.json)`** : un paquet ESM avec `exports` peut bloquer `require` de sous-chemins → vérifier via `ls node_modules/...` ou `npm ls`.
- **Modules « legacy en place »** : P6 security (Factory/Provider) et P7 ORM (drizzle/mongoose) **existent et tournent** même si la refonte est ⬜ → marquer 🔶, pas ⬜, et le noter. (Sequelize a été SUPPRIMÉ — virage ORM Ph.1.)
- **Cause d'augmentation des vulns** : un `npm install --legacy-peer-deps` (Angular) peut faire grimper le compte → toujours re-`npm audit`.
- **Métrique de SURFACE trompeuse** (2026-06-05) : « le module X existe (N fichiers + dist) donc la phase est entamée » = FAUX. Vécu : `src/modules/mediasoup` (8 src) ≠ implé P15 → son `package.json` dit `description: "banc test ORM"`. **Sonder le CONTENU** (description, ce que ça fait), pas l'existence des fichiers.
- **`Read` échoue sur le dashboard obèse** (> 256 KB / 25000 tokens) : lire par tranches (`offset`/`limit`) ; `awk '{print length"\t"NR}' MIGRATION_STATUS.md | sort -rn | head` localise les cellules-journal géantes à tuer.
- **Dette `🚧` peut être déjà RÉSOLUE dans le code** : le dashboard est la source la plus périmée (cf hiérarchie de fraîcheur). Vérifier la dette dans le code avant de la reporter — vécu : `DETTE-CFG` marquée `🚧` au dashboard mais `✅` dans `Kernel.applyModuleConfigOverrides`.
- **Couche IA = squelettes brainstorming → HORS SCOPE par défaut** (directive user 2026-06-05) : `agent`/`agent-guard`/`llm`/`mcp`/`memory`/`rag`/`vector` = créés tôt, peu d'importance, certains sans `package.json`. Les tagger `🧪 différé P12`, ne PAS auditer/supprimer sans demande.

## Mémoire liée

- `project_migration_audit_progress` — avancement + corrections de la dernière passe (reprise).
- `feedback_session_pitfalls`, `feedback_turbo_cache_stale_logs` — pièges build/dist pendant la vérif.
- `project_session_2026-06-05_state` — passe `vérité` de référence (audit P0→P16 + dashboard 278→32 KB).
- `AUDIT-verite-2026-06` (mémoire IA `core-dev/migration/`) — exemple concret de **fichier d'audit persistant** produit par le mode `vérité`.
