#!/usr/bin/env sh

# Les contrôles en LECTURE SEULE du commit — appelés par `commit-msg`, APRÈS
# commitlint, et non plus par `pre-commit`.
#
# Pourquoi : git lance `pre-commit` AVANT `commit-msg`, et le pre-commit ne
# connaît pas encore le message. Un titre de 101 caractères n'était donc refusé
# qu'après une à deux minutes de contrôles longs — à repayer en entier pour
# corriger un mot. Vécu, et signalé par l'auteur. Ces contrôles ne touchent pas
# à l'index : ils jugent aussi bien ici. Ce qui ÉCRIT dans l'index (lint-staged,
# empreinte des variables d'environnement) reste au pre-commit, seul moment où
# git relit l'index.
#
# Un commit de FUSION ne les jouait pas (pas de pre-commit sur une fusion) : il
# ne les joue toujours pas.
if [ -f "$(git rev-parse --git-dir)/MERGE_HEAD" ]; then
  exit 0
fi

# Le code s'écrit en ANGLAIS — et c'est la règle qui se fautait le plus : écrite
# dans le CLAUDE.md, relue le matin, enfreinte deux jours de suite dans l'après-
# midi, jamais attrapée qu'après coup par `npm run check:lang`, que rien ne
# lançait. Ce qui est IMPOSÉ au moment du geste s'applique ; ce qui est écrit se
# rate. Seuls les fichiers INDEXÉS sous `src/` (le périmètre de `check:lang`)
# sont balayés : ~0,2 s au lieu de 18 pour le dépôt entier.
STAGED_SRC=$(git diff --cached --name-only --diff-filter=ACMR -- 'src/*')
if [ -n "$STAGED_SRC" ]; then
  # shellcheck disable=SC2086 # la liste se découpe en arguments, c'est voulu
  if ! node .claude/skills/nodefony-identifiers/scripts/check-identifier-language.mjs $STAGED_SRC; then
    echo "❌ identifiant(s) français dans le code de production — le code s'écrit en anglais."
    echo "   → renommer (skill nodefony-identifiers), ou déclarer une exception AVEC sa raison"
    exit 1
  fi
fi

# Garde anti-dérive : `.env.example` est GÉNÉRÉ depuis env.ts (catalogue defineEnv).
# Si env.ts, .env.example ou l'en-tête curé est staged, vérifier qu'ils sont
# synchronisés (sinon une var ajoutée à env.ts mais pas régénérée passerait). Placé
# AVANT le pré-filtre .ts pour aussi attraper un .env.example édité à la main (non-.ts).
# La commande lit env.ts EN SOURCE (pas le dist) : un build en retard ne fait pas
# mentir le gate. C'est la commande du framework — le dépôt consomme la sienne.
if git diff --cached --name-only --diff-filter=ACMR \
   | grep -qE '^(env\.ts|\.env\.example|\.env\.example\.head)$'; then
  if ! npx --no-install nodefony env --example --check; then
    echo "❌ .env.example désynchronisé de env.ts."
    echo "   → npx nodefony env --example  puis  git add .env.example"
    exit 1
  fi
fi

# Garde anti-dérive : les fiches publiques des skills sont GÉNÉRÉES depuis les
# `SKILL.md`. Toucher un skill sans les régénérer publie une doc qui ment, avec
# l'autorité du généré — et le rouge ne tombait qu'en CI, un aller-retour plus
# tard. Vécu le jour même où ce contrôle est né : une modification de script de
# skill, deux fiches périmées, un job rouge.
# La garde publiée en compte TROIS (fraîcheur des fiches, déclencheurs, audit des
# scripts) et le hook n'en lançait qu'UNE : un script de skill que personne
# n'appelle passait donc ici pour se faire refuser vingt minutes plus tard en
# forge. Une règle appliquée à un seul de ses frères n'est pas appliquée — et
# l'ensemble coûte UNE seconde, ce qui ne laisse aucun argument à l'asymétrie.
# Les DEUX racines que lit `skills-doc.mjs` : les skills du dépôt ET ceux que
# devkit PUBLIE — surveiller la première seule a laissé partir une fiche
# périmée de `nodefony-dev` jusqu'en CI.
if git diff --cached --name-only --diff-filter=ACMR | grep -qE '^(\.claude/skills/|src/packages/@nodefony/devkit/skills/)'; then
  if ! npm run --silent skills:check; then
    echo "❌ pre-commit REFUSÉ : contrôle des skills — chaque écart ci-dessus porte son Pourquoi et son Faire." >&2
    echo "   Rejouer seul : npm run skills:check" >&2
    exit 1
  fi
fi

# Le FORMAT de ce que le scaffold produit — deux gates qui ne se recouvrent pas,
# et qui n'étaient lancés par personne.
#
# `prettier` ne connaît pas l'extension `.tpl` : ni `lint-staged` ci-dessus, ni
# le `format:check` de la forge ne voient un gabarit. Deux d'entre eux étaient
# donc hors format depuis leur écriture, et une application générée hors ligne
# les recevait tels quels.
#
#  · `format:templates --check` juge la SOURCE des gabarits sans balise (pour
#    ceux-là, source et rendu sont le même texte).
#  · `--raw` juge le RENDU, gabarits à balises compris, sans installer : c'est le
#    seul régime où le formatage post-installation de `create` ne masque pas la
#    forme rendue. Les variantes qui installent coûtent deux minutes et restent
#    à la forge (`npm run format:scaffold`).
#
# ~5 s, et seulement quand un gabarit est staged.
if git diff --cached --name-only --diff-filter=ACMR | grep -qE '^src/nodefony/templates/'; then
  if ! npm run --silent format:templates -- --check; then
    echo "❌ un gabarit n'est pas au format — commit annulé"
    echo "   → npm run format:templates   puis  git add src/nodefony/templates"
    exit 1
  fi
  # `env -u GIT_INDEX_FILE` : ces étapes font du git dans des DÉCORS
  # temporaires. Pendant un commit partiel (`git commit -- chemins`), git pose
  # `GIT_INDEX_FILE` en chemin ABSOLU vers l'index temporaire du commit : un
  # `git add` du décor l'hériterait et y écrirait ses fichiers (vécu :
  # `invalid object … for package-lock.json`, commit refusé).
  if ! env -u GIT_INDEX_FILE node scripts/scaffold/check-scaffold-format.mjs --raw; then
    echo "❌ le RENDU d'un gabarit n'est pas au format — commit annulé"
    echo "   → la correction va dans le GABARIT : npm run format:scaffold -- --raw --diff"
    exit 1
  fi
fi

# Les JUGES du banc devkit, éprouvés — mais SEULEMENT quand on touche au banc.
#
# Le cas qui a fait écrire ces lignes : `6f2c2c53` a renommé la définition d'une
# requête sans renommer ses deux appels, et `gate-media-range.mjs` est resté MORT
# cinq jours — un `ReferenceError` à sa première ligne. Un juge qui plante sort
# sans `CAUSE=`, et le banc rend alors un rouge OPPOSABLE À L'AGENT : la tâche
# serait tombée en échec « stable », donnant une chute à instruire et trois
# agents payés pour une faute de frappe. Ce commit-là touchait ce dossier.
#
# Le filtre est ÉTROIT à dessein — corriger une faute dans un autre SKILL.md n'a
# pas à payer une minute trente. `--sans` écarte le contrôle qui exige
# PostgreSQL : la forge `orm.yml` le joue, là où la base existe.
if git diff --cached --name-only --diff-filter=ACMR \
   | grep -qE '^\.claude/skills/nodefony-devkit-bench/'; then
  echo "🧪 banc devkit touché → auto-contrôle des juges (~1 min 30)..."
  # Même raison que le rendu des gabarits ci-dessus : décors git temporaires.
  if ! env -u GIT_INDEX_FILE npm run --silent devkit:selftest -- --prove --sans bench-schema.selftest.mjs; then
    echo "❌ un juge du banc est cassé — commit annulé"
    echo "   → npm run devkit:selftest -- --prove   (rejouer et lire les causes)"
    exit 1
  fi
fi

# Garde anti-dérive : les noms de canaux/méthodes de plateforme (`nodefony:*`) ne
# s'écrivent pas en dur — ils viennent de la table du cœur. Un producteur renommé
# sans son consommateur rend un écran muet SANS qu'aucun test ne rougisse (les
# écrans n'en ont pas) ; seule la table, donc le compilateur, ferme cette porte.
# Filtre .tsx inclus : le front est justement la zone non testée.
if git diff --cached --name-only --diff-filter=ACMR | grep -qE '\.tsx?$'; then
  if ! node scripts/gates/check-platform-channels.mjs; then
    echo "   → importer PLATFORM_CHANNELS / PLATFORM_METHODS / PLATFORM_EVENTS depuis \"nodefony\""
    exit 1
  fi
fi

# PROVISOIRE — le total des conversions de type qui resserrent un type (`x as T`,
# `as unknown as T`) ne monte pas, paquet par paquet, d'ici à leur correction ;
# la règle `no-unsafe-type-assertion` passera alors en "error" dans
# `.oxlintrc.json` et ce bloc disparaîtra avec le script. ~4 s, seulement quand
# du code de production TypeScript est indexé.
if echo "$STAGED_SRC" | grep -qE '\.(ts|tsx|mts)$'; then
  if ! node scripts/gates/check-type-assertions.mjs; then
    exit 1
  fi
fi

# Garde anti-dérive : un paquet qui importe sans déclarer ne casse RIEN ici (npm
# hisse tout à la racine) — il casse l'ordre de build après un `clean`, et
# l'installation chez le consommateur. Deux endroits où nous ne sommes jamais.
if git diff --cached --name-only --diff-filter=ACMR | grep -qE '(\.tsx?|package\.json)$'; then
  if ! node scripts/gates/check-package-deps.mjs; then
    exit 1
  fi
fi
