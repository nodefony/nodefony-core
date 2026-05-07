# Formation Claude Code — Guide débutant économe

## Avant de commencer — comprendre les coûts

Claude Code facture les tokens lus ET écrits.
Chaque fichier ouvert = tokens consommés.
Stratégie : lire le moins possible, cibler précisément.

---

## Installation

```bash
# Installer Claude Code
npm install -g @anthropic/claude-code

# Vérifier
claude --version

# Se connecter (nécessite abonnement Pro)
claude
# → ouvre le navigateur pour l'auth
```

---

## Les commandes essentielles

```bash
# Lancer Claude Code dans un dossier
cd nodefony-core
claude

# Lancer avec un fichier de contexte spécifique
claude --add-file MIGRATION_STATUS.md

# Mode non-interactif (une seule tâche)
claude "Explique la structure du dossier nodefony/"

# Lancer une commande slash définie dans .claude/commands/
/audit
/migrate
/fix-debt 1
/review src/container/Container.ts
```

---

## Règles d'or pour économiser les tokens

### ✅ Ce qui économise des tokens

**1. CLAUDE.md bien rédigé**
Claude Code lit automatiquement CLAUDE.md en début de session.
Un bon CLAUDE.md évite de re-expliquer le contexte à chaque fois.

**2. Commandes slash (/audit, /migrate...)**
Elles sont dans `.claude/commands/` — Claude les lit directement.
Économise le temps de taper un long prompt à chaque session.

**3. Une session = une tâche précise**
```bash
# ✅ Bon — tâche précise
claude "Migre uniquement src/container/Container.ts"

# ❌ Mauvais — trop large, lit tout le repo
claude "Migre tout le core"
```

**4. .claudeignore bien configuré**
Empêche Claude de lire node_modules, dist, assets.
Déjà préparé dans ce setup.

**5. MIGRATION_STATUS.md comme mémoire**
Entre deux sessions, Claude Code ne se souvient de rien.
MIGRATION_STATUS.md est la mémoire persistante — toujours à jour.

### ❌ Ce qui gaspille des tokens

```bash
# ❌ Lancer claude sans contexte
claude "qu'est ce que je dois faire ?"
# → Claude lit tout pour comprendre

# ❌ Sessions trop longues
# → Plus la session dure, plus le contexte grossit

# ❌ Demander plusieurs choses en même temps
claude "migre le container ET le kernel ET le router"
# → Contexte énorme, erreurs probables

# ❌ Oublier de committer entre sessions
# → La session suivante relit tout ce qui a changé
```

---

## Workflow type d'une session de migration

```bash
# 1. Aller dans le repo sur la bonne branche
cd nodefony-core
git checkout claude-ts

# 2. Lancer Claude Code
claude

# 3. Première commande dans Claude Code
/audit
# → Claude lit CLAUDE.md + MIGRATION_STATUS.md
# → Met à jour le statut réel des fichiers

# 4. Migrer le premier module
/migrate
# → Claude identifie le prochain module à migrer
# → Lit UNIQUEMENT les fichiers de ce module
# → Migre, écrit les tests, vérifie tsc + bun test

# 5. Review avant commit
/review src/[module-migré]/

# 6. Committer
# Claude Code propose le commit message
# Tu approuves

# 7. Fermer la session
# Coût typique d'une session bien ciblée : ~$0.10 - $0.30
```

---

## Comprendre ce que Claude Code peut faire

```
Claude Code peut :
  ✅ Lire des fichiers du repo
  ✅ Écrire / modifier des fichiers
  ✅ Exécuter des commandes bash (tsc, bun test, git)
  ✅ Naviguer la structure du projet
  ✅ Faire des recherches dans le code (grep)

Claude Code ne peut PAS :
  ❌ Se souvenir des sessions précédentes
     (c'est pour ça que MIGRATION_STATUS.md est crucial)
  ❌ Accéder à internet (sauf si tu actives web search)
  ❌ Modifier des fichiers hors du repo courant
```

---

## Les erreurs classiques du débutant

**Erreur 1 — Laisser Claude lire tout le repo**
```bash
# ❌ Claude va scanner tout
claude "analyse mon projet"

# ✅ Cibler
claude "lis MIGRATION_STATUS.md et dis-moi le prochain module à migrer"
```

**Erreur 2 — Session trop longue**
Une session > 30 min accumule du contexte = tokens.
Mieux vaut 3 sessions courtes qu'une longue.

**Erreur 3 — Pas de commit entre sessions**
```bash
# ✅ Toujours committer avant de fermer
git add -A && git commit -m "feat(migration): migrate Container"
```

**Erreur 4 — Demander à Claude de décider seul des choix architecturaux**
Claude Code est un exécutant — les décisions d'architecture, tu les prends
ici dans Claude.ai (gratuit dans le Pro) AVANT de lancer Claude Code.

---

## Séquence de démarrage — première fois

```bash
# Étape 1 — Créer la branche claude-ts
cd nodefony-core
git checkout main
git pull
git checkout -b claude-ts

# Étape 2 — Copier les fichiers de setup dans le repo
# (CLAUDE.md, MIGRATION_STATUS.md, .claude/, .claudeignore)
# Ces fichiers sont dans le dossier nodefony-claude-setup/local-claude/

cp /chemin/vers/setup/CLAUDE.md .
cp /chemin/vers/setup/MIGRATION_STATUS.md .
cp /chemin/vers/setup/.claudeignore .
cp -r /chemin/vers/setup/.claude .

# Étape 3 — Copier le CLAUDE.md global
mkdir -p ~/.claude
cp /chemin/vers/setup/global-claude/CLAUDE.md ~/.claude/CLAUDE.md

# Étape 4 — Premier commit de structure
git add .
git commit -m "chore: init claude-ts migration structure"

# Étape 5 — Cloner le repo JS de référence à côté
cd ..
git clone https://github.com/nodefony/nodefony .  
# si pas déjà fait

# Étape 6 — Lancer Claude Code
cd nodefony-core
claude

# Étape 7 — Premier audit
/audit
```

---

## Budget tokens estimé

| Session | Tâche | Tokens estimés | Coût ~$ |
|---------|-------|----------------|---------|
| Audit initial | Lire + analyser structure | ~15k | ~$0.15 |
| Fix dette #1 | tsconfig moduleResolution | ~3k | ~$0.03 |
| Fix dette #2 | lockfile | ~1k | ~$0.01 |
| Migration module simple | 3-5 fichiers | ~10k | ~$0.10 |
| Migration module complexe | 8-12 fichiers | ~25k | ~$0.25 |
| **Migration complète (15 modules)** | | **~200k** | **~$2-5** |

Avec le Pro à 20$/mois : largement couvert avec le quota inclus.
Le quota Pro inclut environ 1-2M tokens/mois selon les usages.
