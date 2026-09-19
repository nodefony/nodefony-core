#!/usr/bin/env bash
# Smoke test release (modèle B) + preuve Dockerfile/graceful shutdown/frontend.
#
# Le décor est GÉNÉRÉ, il n'est plus copié : le scaffolder est installé depuis
# le tarball, et c'est LUI qui produit les applications témoins. Le smoke
# éprouve donc ce qu'un utilisateur reçoit réellement — y compris que
# `templates/` est bien publié dans le paquet, ce qu'aucun test du dépôt ne
# peut voir.
#
# Une étape précède les scénarios et ne dépend d'aucun : la PORTE D'ENTRÉE,
# `create-nodefony` installé depuis SON tarball. C'est le premier paquet qu'un
# inconnu exécute (`npm create nodefony <app>`), et il n'était éprouvé par rien.
#
# CINQ scénarios, sélectionnables :
#
#   base   — app minimale sans front : sondes, node PID 1, drain au SIGTERM
#   front  — app à frontend React : tags `/_assets/…` servis, et les DEUX
#            issues d'un `public/dist` absent (reconstruit au boot quand vite
#            est là ; ERROR nommée + API toujours servie quand il ne l'est pas)
#   studio — preset complet, Studio en `mandatory` : l'UI pré-buildée du paquet
#            est servie (un 404 ici = `dist/frontend` absent du tarball)
#   edge   — la TOPOLOGIE de production, montée par `docker compose --profile
#            edge up -d --build` : l'app derrière son frontal nginx, jointe par
#            son NOM de service, `trustProxy: uniquelocal` éprouvé pour de vrai,
#            et les statiques servis sans que Node soit joint
#   sql    — les TROIS moteurs serveurs (`--database postgres|mariadb|mysql`)
#            sous musl : la base jointe par son NOM de service — la seule chose
#            qu'Alpine pouvait casser —, les migrations appliquées, et la suite
#            e2e générée jouée DANS un conteneur Alpine
#
# Usage (racine repo) :
#   npm run release:smoke -- [--scenario all|base|front|studio|edge|sql]
# Prérequis : npm run build (dist à jour) + docker daemon up.
set -euo pipefail

# Secret jetable des scénarios qui démarrent une app du preset complet : le
# framework en EXIGE en production, et un banc qui ne les pose pas accuse le
# produit d'un défaut qui est le sien. 32 hexadécimaux — la forme attendue.
#
# 🔴 TIRÉ, jamais littéralisé. Écrite en clair, cette valeur est un secret
# d'APPARENCE dans un dépôt public : le gate `Secrets` la refuse (règle
# `generic-api-key`), et il a raison — aucun relecteur, humain ou automate, ne
# distingue un faux secret d'un vrai. L'exclure par une exception aurait appris
# au gate à se taire sur cette forme partout ailleurs.
SMOKE_SECRET="$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
[[ ${#SMOKE_SECRET} -eq 32 ]] ||
  { echo "✗ impossible de tirer le secret jetable (openssl et /dev/urandom muets)" >&2; exit 1; }

SCENARIO="all"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario) SCENARIO="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "option inconnue : $1" >&2; exit 64 ;;
  esac
done
case "$SCENARIO" in
  all|base|front|studio|edge|sql|sql:postgres|sql:mariadb|sql:mysql) ;;
  *) echo "scénario inconnu : $SCENARIO" >&2; exit 64 ;;
esac
# `sql` se DÉCOUPE par moteur, et ce n'est pas un raffinement : le job de forge
# est borné à 45 min, or les trois moteurs en série demandent trois
# installations, trois constructions d'image et trois suites e2e. Un seul job
# les dépasserait — et un banc tué par son plafond ne rend aucun verdict, pas
# même partiel. Un moteur par job : ils tournent en parallèle, et chacun dit sa
# propre vérité (même raison que `fail-fast: false`).
runs() { [[ "$SCENARIO" == "all" || "$SCENARIO" == "$1" || "${SCENARIO%%:*}" == "$1" ]]; }

# Quatre niveaux : scripts → nodefony-release → skills → .claude → racine.
# Le compte se VÉRIFIE au lieu de se supposer : déplacer ce script d'un dossier
# le décalait en silence, et le seul symptôme était un chemin doublé
# (`.claude/skills/.claude/skills/…`) au premier `node`.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ -f "$ROOT/package.json" && -d "$ROOT/scripts/release" ]] ||
  { echo "✗ racine du dépôt introuvable depuis ${BASH_SOURCE[0]} (ROOT=$ROOT)" >&2; exit 1; }

# HORS du repo : dedans, la résolution node/TS remonterait aux node_modules
# racine (symlinks workspaces → SOURCES du repo) → faux environnement vierge.
WORK="${TMPDIR:-/tmp}/nodefony-smoke-app"
SCAFFOLDER="$WORK/scaffolder"   # le paquet `nodefony` installé DEPUIS son tarball

# ── Étapes NOMMÉES : un échec doit dire lequel des maillons a lâché. Un
#    « docker build KO » qui vient en fait d'un scaffold muet envoie chercher
#    la panne dans les tarballs pendant que le générateur est en cause.
STEP="init"
CONTAINERS=""
# Le scénario `edge` ne lance pas des conteneurs, il lève une TOPOLOGIE : réseau,
# volumes, services liés. `docker rm -f` en laisserait la moitié derrière — d'où
# un défaisage qui lui est propre, posé dès que le compose est monté.
COMPOSE_DIR=""
# Le profil à DÉFAIRE n'est pas le même selon le scénario (`edge` lève un
# frontal, `sql` lève une base et sa tâche de migration). Un `down` sur le
# mauvais profil laisse des services debout sans le dire — et le suivant
# démarre alors sur un décor sale.
COMPOSE_PROFILE="edge"
step() { STEP="$1"; echo ""; echo "── $1 ──────────────────────────────────────"; }
cleanup() {
  for c in $CONTAINERS; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  [ -n "$COMPOSE_DIR" ] && (cd "$COMPOSE_DIR" && docker compose --profile "$COMPOSE_PROFILE" down -v >/dev/null 2>&1 || true)
  return 0
}
fail() { echo "" >&2; echo "✗ ÉCHEC à l'étape « $STEP » : $1" >&2; cleanup; exit 1; }
ok() { echo "✓ $1"; }

# ═══ Briques partagées par les scénarios ════════════════════════════════════

# Génère une application témoin. Les gardes qui suivent ne sont pas du zèle :
# sans elles, un gabarit disparu ferait échouer `docker build` avec un message
# qui accuserait les tarballs.
# Ce qu'une application générée doit porter, quel que soit le générateur qui l'a
# produite. UNE implémentation : le binaire du cœur et le shim `create-nodefony`
# subissent le même contrôle, sinon l'un des deux chemins dériverait sans bruit.
assert_app_conforme() { # dir quoi
  local dir="$1" quoi="$2" f
  for f in Dockerfile .dockerignore package.json index.ts nodefony.config.ts; do
    [[ -f "$dir/$f" ]] || fail "$quoi : l'app générée n'a pas de $f — gabarit absent du tarball ?"
  done
  grep -q '^CMD \["' "$dir/Dockerfile" || fail "$quoi : Dockerfile généré sans CMD en forme exec"
}

# Le 5e argument est le moteur de base (`--database`). Il est OPTIONNEL et,
# omis, la commande n'est pas passée du tout : c'est le générateur qui décide
# alors, et le banc ne doit pas se substituer à son défaut — le jour où il
# change, les quatre autres scénarios doivent suivre sans qu'on y touche.
scaffold_app() { # nom dir preset frontend [database]
  local name="$1" dir="$2" preset="$3" front="$4" db="${5:-}"
  local db_opt=()
  [ -n "$db" ] && db_opt=(--database "$db")
  "$NODEFONY_BIN" create app "$name" --dir "$dir" --yes \
    --preset "$preset" --frontend "$front" "${db_opt[@]}" \
    --no-install --no-git > "$WORK/.scaffold-$name.out" 2>&1 \
    || { tail -30 "$WORK/.scaffold-$name.out"; fail "nodefony create app ($preset/$front${db:+/db=$db})"; }
  assert_app_conforme "$dir" "nodefony create app"
  ok "app « $name » générée ($preset / front=$front${db:+ / database=$db})"
}

# Pointe les dépendances du framework vers les tarballs : l'installation qui
# suivra n'aura jamais vu le dépôt.
rewrite_deps() { # dir
  local dir="$1"
  rm -rf "$dir/tarballs"
  cp -R "$ROOT/release/tarballs" "$dir/tarballs"
  node -e '
const fs = require("node:fs");
const app = process.argv[1];
const manifest = JSON.parse(fs.readFileSync(app + "/tarballs/manifest.json", "utf8"));
const p = app + "/package.json";
const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
let n = 0;
for (const block of ["dependencies", "devDependencies"]) {
  for (const dep of Object.keys(pkg[block] ?? {})) {
    if (manifest[dep]) { pkg[block][dep] = "file:./tarballs/" + manifest[dep]; n++; }
  }
}
if (n === 0) { throw new Error("aucune dep réécrite — le manifeste ne recouvre pas le package.json généré"); }
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
process.stdout.write("deps réécrites : " + n + "\n");
' "$dir" || fail "réécriture des dépendances"
}

# Joue, CÔTÉ HÔTE, ce que le produit prescrit à qui a généré son application
# sans installation — les trois lignes que `create app --no-install` affiche
# désormais sous « Prochaines étapes » : installer, bâtir, écrire la première
# migration. Le banc n'invente donc aucune séquence : il EXÉCUTE la
# documentation, et échoue si elle ment.
#
# Pourquoi ce détour au lieu de laisser `create app` s'en charger : le banc
# scaffolde en `--no-install` exprès, parce que les dépendances doivent venir
# des tarballs et jamais du dépôt. Sans installation, pas de build ; sans build,
# pas de migration — et le scénario s'arrêtait sur « table absente : User ».
#
# 🔴 Et on ne peut PAS la générer plus tard, dans le conteneur : `drizzle-kit`
# est une dépendance de DÉVELOPPEMENT, l'image installe en `--omit=dev`, et le
# produit refuse proprement (`NF_GENERATE_TOOL_MISSING`). C'est juste :
# APPLIQUER une migration ne réclame aucun outil tiers, seul l'ÉCRIRE en
# demande un. La migration s'écrit au développement et voyage dans le dépôt.
#
# Le coût — une installation et un build par scénario concerné — n'est payé que
# par les applications qui ont un ORM, et cela se CONSTATE dans le manifeste
# généré : le déduire du nom du préset ferait mentir le banc le jour où un
# préset change de contenu.
write_initial_migration() { # dir
  local dir="$1"
  node -e '
const pkg = require(process.argv[1] + "/package.json");
process.exit(pkg.dependencies?.["@nodefony/drizzle"] ? 0 : 1);
' "$dir" 2>/dev/null || { ok "pas d ORM déclaré — aucune migration à écrire"; return 0; }

  # Les journaux vont dans $WORK, jamais dans l'application : tout ce qui vit
  # sous `$dir` entre dans le contexte de construction de l'image, et
  # `.dockerignore` ne connaît pas ces fichiers-là.
  (cd "$dir" && npm install --no-audit --no-fund) > "$WORK/.host-install.out" 2>&1 \
    || { tail -30 "$WORK/.host-install.out"; fail "npm install côté hôte (deps → tarballs)"; }
  ok "dépendances installées côté hôte (avec les devDeps : drizzle-kit présent)"

  # La commande démarre l'application, qui charge `dist/` : sans build, elle
  # n'a rien à lire.
  (cd "$dir" && npm run build) > "$WORK/.host-build.out" 2>&1 \
    || { tail -30 "$WORK/.host-build.out"; fail "npm run build côté hôte"; }
  ok "application bâtie côté hôte"

  # 🔴 Le décor sans lequel la commande se mord la queue : elle démarre
  # l'application, et un démarrage en DÉVELOPPEMENT dérive le schéma du code —
  # la base se retrouve peuplée par la commande elle-même, qui refuse alors
  # d'écrire une première migration (`NF_GENERATE_DATABASE_NOT_ADOPTED`).
  # `production` donne le mode `none` ; `NF_STORE=memory` empêche le démarrage
  # de lire une table qui n'existe pas encore.
  (cd "$dir" && NODE_ENV=production NF_STORE=memory \
    npx nodefony orm:generate --name init) > "$WORK/.host-generate.out" 2>&1 \
    || { tail -30 "$WORK/.host-generate.out"; fail "nodefony orm:generate --name init"; }

  # Un code de sortie 0 ne prouve pas qu'un fichier a été écrit. C'est
  # l'ARTEFACT qui est la preuve — et c'est lui qui voyagera dans l'image.
  local n
  n=$(find "$dir/migrations" -name '*.sql' 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -ge 1 ] || { tail -20 "$WORK/.host-generate.out"; fail "orm:generate sorti en 0 sans écrire de .sql dans migrations/"; }
  ok "migration initiale écrite ($n fichier(s) .sql) — elle entrera dans l image"

  # Le lockfile RESTE, et c'est le propos : il est ce qu'un développeur commite
  # après son premier `npm install`, et c'est LUI qui a révélé que l'image ne se
  # construisait plus dès qu'il existe. Un arbre bâti depuis un lockfile perd le
  # `gypfile: false` par lequel `better-sqlite3` interdit la recompilation, donc
  # npm SYNTHÉTISE un `node-gyp rebuild` qui meurt faute de Python dans
  # `node:*-slim` (défaut npm amont `npm/cli#9837`, correctif proposé en
  # `npm/cli#9859`). Le gabarit installe donc en `--ignore-scripts` ; ce banc est
  # le seul endroit qui l'éprouve, parce qu'il est le seul à construire l'image
  # d'une application qui a un lockfile.
  [ -f "$dir/package-lock.json" ] || fail "npm install n a pas écrit de package-lock.json"
  ok "package-lock.json présent — l image sera construite AVEC, comme chez l utilisateur"
}

build_image() { # dir tag
  docker build -t "$2" "$1" || fail "docker build ($2)"
  ok "image $2 construite (npm install vierge depuis les tarballs)"
  # C'est ICI que le contrôle mord le plus tôt : les trois scénarios couvrent
  # les trois presets, donc trois `.dockerignore` rendus, alors que la chaîne de
  # publication n'en bâtit qu'un. La `10.0.0-alpha.4` est partie avec la clé
  # privée du poste faute d'un regard à ce moment précis.
  node "$ROOT/scripts/release/image-gate.mjs" "$2" \
    || fail "matière sensible dans l'image $2 (voir ci-dessus)"
}

# Attend que /readyz réponde 200. Rend la main en échec APRÈS avoir versé les
# journaux : un boot qui n'aboutit pas est muet sans eux.
wait_ready() { # ctn port
  local ctn="$1" port="$2" code=""
  local _
  for _ in $(seq 1 90); do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$port/readyz" || true)
    [ "$code" = "200" ] && return 0
    sleep 1
  done
  docker logs "$ctn" 2>&1 | tail -40
  fail "readyz jamais 200 après 90 s (reçu: $code)"
}

# Applique les migrations DANS le conteneur, comme un exploitant le fait — les
# migrations passent AVANT que le trafic n'arrive.
#
# Sans cette étape, le banc mesurait autre chose que ce qu'il croyait. En
# production le schéma appartient aux migrations (`ddl: none`), et un exemplaire
# dont le schéma est en retard REFUSE le trafic : `/readyz` répond 503, `/livez`
# reste vert. C'est le comportement voulu du produit — mais le banc lançait le
# conteneur puis sondait `/readyz` sans rien appliquer, et accusait donc le
# paquet publié d'un échec dont la cause était son propre décor.
#
# C'est `docker exec` et non un conteneur jetable, parce que la base de l'app
# générée est un fichier SQLite qui vit DANS le conteneur : migrer ailleurs
# créerait une base que personne ne lit. Sur une vraie base réseau, le patron est
# l'inverse — un job de migration séparé, avant le déploiement.
#
# L'app tourne déjà pendant qu'on migre : c'est voulu, et c'est justement ce que
# la sonde promet — elle re-vérifie, et passe à 200 d'elle-même une fois le
# schéma à jour. Le banc éprouve donc AUSSI cette promesse.
migrate_in() { # ctn
  local ctn="$1" out=""
  # Une app sans ORM n'a pas de migrations : ne pas confondre « rien à faire »
  # avec « la commande a échoué ».
  if ! docker exec "$ctn" test -d node_modules/@nodefony/drizzle 2>/dev/null; then
    return 0
  fi
  if ! out=$(docker exec "$ctn" node_modules/.bin/nodefony orm:migrate 2>&1); then
    echo "$out" | tail -25
    fail "migrations non appliquées dans $ctn"
  fi
  ok "migrations appliquées dans $ctn (avant l'ouverture du trafic)"
}

http_code() { curl -s -o /dev/null -w "%{http_code}" "$1" || true; }

# `grep -q` FERME le pipe dès qu'il a trouvé : l'amont reçoit SIGPIPE, sort en
# 141, et sous `set -o pipefail` le PIPELINE rend 141 — un succès devient un
# échec. Et seulement quand l'amont avait encore de quoi écrire, donc de façon
# NON DÉTERMINISTE : le scénario `front` était vert ou rouge sans qu'une ligne
# ne change. Ce test-ci ne crée aucun pipe, donc aucun SIGPIPE.
# (Le motif est traité comme un glob : n'y mettre que du littéral.)
contient() { # texte motif
  case "$1" in
    *"$2"*) return 0 ;;
    *) return 1 ;;
  esac
}

# ═══ 1-3. Chaîne commune : pack, types, scaffolder ══════════════════════════

step "pack — 14 tarballs depuis les workspaces"
node "$ROOT/scripts/release/pack-all.mjs" || fail "pack-all.mjs"
ok "tarballs écrits dans release/tarballs/"

# (profil esm-only : node10 et require() CJS ignorés — framework ESM-only).
# `nodefony/debugbar.js` = export d'ASSET (bundle standalone pour <script src>,
# consommé par URL, jamais importé en TS) → exclu de l'analyse de types.
step "attw — types publiés des 13 paquets"
for tgz in "$ROOT"/release/tarballs/*.tgz; do
  EXCLUDE=""
  [[ "$(basename "$tgz")" == nodefony-10.* ]] && EXCLUDE="--exclude-entrypoints ./debugbar.js"
  # shellcheck disable=SC2086 — $EXCLUDE volontairement non quoté (0 ou 2 mots)
  npx --yes @arethetypeswrong/cli "$tgz" --profile esm-only $EXCLUDE > /dev/null 2>&1 \
    || { npx --yes @arethetypeswrong/cli "$tgz" --profile esm-only $EXCLUDE | tail -25; fail "attw KO sur $(basename "$tgz") — types publiés cassés"; }
done
ok "attw 13/13 (node16-ESM + bundler verts)"

# C'est ce qui fait la différence entre « nos gabarits marchent » et « les
# gabarits que nous PUBLIONS marchent » : `templates/` doit être dans `files`,
# et un fichier oublié là ne se voit d'aucune autre façon.
step "scaffolder — installation du paquet nodefony depuis son tarball"
rm -rf "$WORK"
mkdir -p "$SCAFFOLDER"
NODEFONY_TGZ="$(node -e '
const m = require(process.argv[1] + "/manifest.json");
if (!m["nodefony"]) { throw new Error("manifest.json sans entrée `nodefony`"); }
process.stdout.write(m["nodefony"]);
' "$ROOT/release/tarballs")"
(cd "$SCAFFOLDER" && npm init -y > /dev/null 2>&1 \
  && npm install --no-audit --no-fund "$ROOT/release/tarballs/$NODEFONY_TGZ" > /dev/null 2>&1) \
  || fail "npm install du tarball nodefony ($NODEFONY_TGZ)"
NODEFONY_BIN="$SCAFFOLDER/node_modules/.bin/nodefony"
[[ -x "$NODEFONY_BIN" ]] || fail "binaire absent du tarball : $NODEFONY_BIN"
ok "nodefony installé depuis $NODEFONY_TGZ"

# ═══ LA PORTE D'ENTRÉE — `npm create nodefony` ══════════════════════════════
#
# `create-nodefony` est le PREMIER paquet qu'un inconnu exécute, et le seul qui
# ait remplacé le `npm i -g`. Il n'était éprouvé par RIEN : tout le reste de ce
# banc passe par le binaire du paquet `nodefony`, jamais par ce shim. Un paquet
# qu'on publie sans l'avoir exécuté depuis son tarball est exactement ce que ce
# banc existe pour empêcher.
#
# Sa dépendance `nodefony` est épinglée sur la MÊME version, qui n'existe pas
# encore sur le registre — d'où l'`overrides` vers le tarball local. Ce n'est pas
# un contournement : c'est le propos, on éprouve ce qu'on s'APPRÊTE à publier.
#
# ⚠️ CE QUE CETTE ÉTAPE NE PROUVE PAS, et personne ne peut le prouver avant la
# publication : la résolution `npm create nodefony <app>` depuis le REGISTRE.
# Ce qui EST prouvé : le tarball porte son binaire, ce binaire trouve le lanceur
# par `nodefonyBin` (résolution qui a sa propre subtilité — import dynamique,
# hoisting), et il produit une application conforme.
step "porte d'entrée — create-nodefony depuis SON tarball (le geste d'un inconnu)"
CREATOR="$WORK/creator"
CREATE_TGZ="$(node -e '
const m = require(process.argv[1] + "/manifest.json");
if (!m["create-nodefony"]) {
  throw new Error("manifest.json sans entrée `create-nodefony` — le 15e paquet n a pas ete packe");
}
process.stdout.write(m["create-nodefony"]);
' "$ROOT/release/tarballs")"
mkdir -p "$CREATOR"
node -e '
const fs = require("fs");
const [dir, tgz] = process.argv.slice(1);
fs.writeFileSync(dir + "/package.json", JSON.stringify({
  name: "nodefony-smoke-creator", version: "1.0.0", private: true,
  // La dépendance épinglée du shim pointe une version encore absente du
  // registre : on la redirige vers le tarball que ce banc vient de fabriquer.
  overrides: { nodefony: "file:" + tgz },
}, null, 2) + "\n");
' "$CREATOR" "$ROOT/release/tarballs/$NODEFONY_TGZ"
(cd "$CREATOR" && npm install --no-audit --no-fund "$ROOT/release/tarballs/$CREATE_TGZ" > "$WORK/.creator.out" 2>&1) \
  || { tail -30 "$WORK/.creator.out"; fail "npm install du tarball create-nodefony ($CREATE_TGZ)"; }
CREATE_BIN="$CREATOR/node_modules/.bin/create-nodefony"
[[ -x "$CREATE_BIN" ]] || fail "binaire absent du tarball create-nodefony : $CREATE_BIN"
VIA_CREATE="$WORK/via-create"
"$CREATE_BIN" "smokecreate" --dir "$VIA_CREATE" --yes \
  --preset minimal --frontend none --no-install --no-git > "$WORK/.via-create.out" 2>&1 \
  || { tail -30 "$WORK/.via-create.out"; fail "create-nodefony n a pas produit d application"; }
assert_app_conforme "$VIA_CREATE" "create-nodefony"
ok "create-nodefony installé depuis $CREATE_TGZ, et son application est conforme"

# ═══ SCÉNARIO « base » — sondes, PID 1, drain ═══════════════════════════════

if runs base; then
  APP="$WORK/base"
  IMG="nodefony-smoke-base:smoke"
  CTN="nf-smoke-base"; CONTAINERS="$CONTAINERS $CTN"
  PORT=15151

  step "[base] create app — application témoin minimale"
  scaffold_app "smokeapp" "$APP" "minimal" "none"

  # Le controller est créé par la commande (qui pose aussi le câblage
  # `@controllers([...])` — édition qu'on ne veut PAS faire à la main), puis son
  # CORPS est réécrit en entier : aucune insertion textuelle dans un fichier
  # généré, donc aucune ancre à maintenir.
  #
  # ⚠️ `create controller` est IN-PROJECT : il remonte au `nodefony.config.ts`
  # le plus proche. Lancé depuis la racine du dépôt, il écrirait DANS LE DÉPÔT
  # — d'où le sous-shell qui l'ancre dans l'app témoin.
  step "[base] décor — route /api/slow (create controller + corps réécrit)"
  (cd "$APP" && "$NODEFONY_BIN" create controller slow --kind hello --route /api) \
    > "$WORK/.controller.out" 2>&1 \
    || { tail -20 "$WORK/.controller.out"; fail "nodefony create controller"; }
  SLOW_FILE="$APP/nodefony/controllers/SlowController.ts"
  [[ -f "$SLOW_FILE" ]] || fail "SlowController.ts non produit par create controller"
  grep -q "SlowController" "$APP/index.ts" || fail "SlowController non câblé dans index.ts"
  cat > "$SLOW_FILE" <<'TS'
import { route, controller, Controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/** DÉCOR DU SMOKE — une requête lente, pour éprouver le drain au SIGTERM. */
@controller("/api")
class SlowController extends Controller {
  constructor(context: ContextType) {
    super("slow", context);
  }

  @route("slow-index", { path: "/slow", method: "GET" })
  async index() {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return this.renderJson({ slow: "done", pid: process.pid });
  }
}

export default SlowController;
TS
  ok "route /api/slow posée et câblée"

  step "[base] deps + image"
  rewrite_deps "$APP"
  build_image "$APP" "$IMG"

  step "[base] run — sondes de l'orchestrateur"
  docker rm -f "$CTN" >/dev/null 2>&1 || true
  docker run -d --name "$CTN" -p "$PORT:5151" "$IMG" >/dev/null
  migrate_in "$CTN"
  wait_ready "$CTN" "$PORT"
  ok "readyz → 200 (boot complet)"

  LIVEZ=$(http_code "http://127.0.0.1:$PORT/livez")
  [ "$LIVEZ" = "200" ] || fail "livez → $LIVEZ"
  ok "livez → 200"

  HELLO=$(curl -s "http://127.0.0.1:$PORT/api/hello")
  contient "$HELLO" '"hello"' || fail "hello KO : $HELLO"
  ok "/api/hello → $HELLO"

  # La forme exec du CMD se CONSTATE ici, elle ne se déduit pas du fichier : en
  # forme shell, /bin/sh serait PID 1 et node porterait un autre numéro — le
  # seul signe observable avant que le drain ne manque à l'appel.
  contient "$HELLO" '"pid":1' || fail "node n'est PAS PID 1 (forme shell du CMD ?) : $HELLO"
  ok "node est PID 1 (forme exec constatée, pas supposée)"

  step "[base] graceful — docker stop pendant une requête en vol"
  SLOW_OUT="$WORK/.slow.out"
  (curl -s -m 10 -w "\nHTTP=%{http_code}" "http://127.0.0.1:$PORT/api/slow" > "$SLOW_OUT" 2>&1; echo "EXIT=$?" >> "$SLOW_OUT") &
  SLOW_PID=$!
  sleep 0.5
  docker stop -t 12 "$CTN" >/dev/null &
  STOP_PID=$!
  wait "$SLOW_PID"
  grep -q '"slow"' "$SLOW_OUT" && grep -q "HTTP=200" "$SLOW_OUT" \
    || { cat "$SLOW_OUT"; fail "requête in-flight NON drainée pendant docker stop"; }
  ok "in-flight terminée pendant docker stop (200 slow:done)"

  wait "$STOP_PID"
  EXITCODE=$(docker wait "$CTN" 2>/dev/null || docker inspect -f '{{.State.ExitCode}}' "$CTN")
  [ "$EXITCODE" = "0" ] || { docker logs "$CTN" 2>&1 | tail -30; fail "exit code container = $EXITCODE (attendu 0 = SIGTERM drainé, pas de SIGKILL)"; }
  ok "container sorti exit 0 (graceful, sous la grace period)"

  contient "$(docker logs "$CTN" 2>&1)" "SHUTDOWN" || fail "logs sans trace du drain (SHUTDOWN)"
  ok "logs : drain visible (SHUTDOWN serveurs)"
  docker rm -f "$CTN" >/dev/null 2>&1 || true
fi

# ═══ SCÉNARIO « front » — la page blanche muette, sous ses deux formes ══════
#
# Trou vécu : une app à front déployée servait une page BLANCHE, sans une
# ligne de journal. Trois étages ont été corrigés (chaînage `frontend:build`
# au scaffold, refus du silence dans `setupProd`, absence de manifeste jamais
# mise en cache) — et aucun n'est observable depuis le dépôt self-hosted, qui
# a toujours ses devDependencies sous la main.

if runs front; then
  FAPP="$WORK/front"
  FIMG="nodefony-smoke-front:smoke"
  FCTN="nf-smoke-front"; CONTAINERS="$CONTAINERS $FCTN"
  FPORT=15152
  LPORT=15171   # boot HORS conteneur (poste de dev)

  step "[front] create app — application témoin à frontend React"
  scaffold_app "smokefront" "$FAPP" "minimal" "react"
  rewrite_deps "$FAPP"

  # Installation LOCALE : c'est le poste de dev qu'on imite ici, devDependencies
  # comprises (vite est résolvable). L'image, elle, ne les aura pas — c'est
  # toute la différence entre les deux issues éprouvées plus bas.
  step "[front] npm install + npm run build (poste de dev)"
  (cd "$FAPP" && npm install --no-audit --no-fund) > "$WORK/.front-install.out" 2>&1 \
    || { tail -30 "$WORK/.front-install.out"; fail "npm install de l'app à front"; }
  (cd "$FAPP" && npm run build) > "$WORK/.front-build.out" 2>&1 \
    || { tail -30 "$WORK/.front-build.out"; fail "npm run build (le chaînage frontend:build du package.json généré)"; }
  [[ -f "$FAPP/public/dist/.vite/manifest.json" ]] \
    || fail "public/dist/.vite/manifest.json absent — 'npm run build' ne chaîne pas frontend:build"
  ok "front construit (manifeste Vite présent)"

  # Boot local, journaux capturés : `--detach` les enverrait ailleurs, or c'est
  # précisément l'ANNONCE qu'on veut lire au scénario suivant.
  # Les DEUX ports sont déplacés : sans `NF_PORT_HTTPS`, le serveur HTTP/2 de
  # l'app témoin réclamerait 5152 et heurterait un serveur de développement
  # déjà en écoute — l'échec parlerait alors du front, pas du port.
  boot_local() { # fichier-journal
    (cd "$FAPP" && NF_PORT="$LPORT" NF_PORT_HTTPS="$((LPORT + 1))" \
      node_modules/.bin/nodefony production > "$1" 2>&1 &)
    local _ code=""
    for _ in $(seq 1 90); do
      code=$(http_code "http://127.0.0.1:$LPORT/readyz")
      [ "$code" = "200" ] && return 0
      sleep 1
    done
    tail -40 "$1"; fail "readyz local jamais 200 (reçu: $code)"
  }
  stop_local() { (cd "$FAPP" && node_modules/.bin/nodefony stop) > /dev/null 2>&1 || true; sleep 1; }

  # ── (a) le front construit est SERVI ──────────────────────────────────────
  step "[front] (a) la page porte les tags /_assets/… du build"
  boot_local "$WORK/.front-a.log"
  BODY=$(curl -s "http://127.0.0.1:$LPORT/")
  contient "$BODY" "/_assets/" \
    || { echo "$BODY" | head -20; stop_local; fail "GET / sans tag /_assets/ — le manifeste n'est pas lu"; }
  ok "GET / porte les tags /_assets/… (manifeste Vite servi)"
  stop_local

  # ── (b1) manifeste absent, vite PRÉSENT → reconstruit et annoncé ──────────
  step "[front] (b1) public/dist supprimé, vite présent → build au boot, ANNONCÉ"
  rm -rf "$FAPP/public/dist"
  boot_local "$WORK/.front-b1.log"
  grep -q "construction au boot" "$WORK/.front-b1.log" \
    || { tail -30 "$WORK/.front-b1.log"; stop_local; fail "reconstruction au boot NON annoncée (WARNING attendu)"; }
  ok "WARNING : construction au boot annoncée"
  BODY=$(curl -s "http://127.0.0.1:$LPORT/")
  contient "$BODY" "/_assets/" \
    || { stop_local; fail "GET / sans tag après reconstruction au boot"; }
  ok "GET / porte de nouveau les tags (auto-guérison, sans restart)"
  stop_local

  # ── (b2) manifeste absent, vite ABSENT (image runtime) → ERROR + API vivante
  step "[front] deps + image"
  build_image "$FAPP" "$FIMG"

  # La toolchain ne doit PAS descendre en production — c'est la promesse écrite
  # en tête du Dockerfile généré. Elle a été fausse : une peer, même optionnelle,
  # est SATISFAITE par la devDependency de l'application, et `npm prune
  # --omit=dev` la garde alors comme un paquet de production. `@nodefony/frontend`
  # ne déclare donc plus vite ni ses plugins (tout y est en `await import()`).
  # Sans ce contrôle, la régression reviendrait par une simple ligne de manifeste,
  # et rien ne la signalerait — l'image marcherait.
  step "[front] (b2) image de production : la toolchain n'y est PAS"
  for tool in vite vue typescript; do
    docker run --rm --entrypoint sh "$FIMG" -c "test -d node_modules/$tool" \
      && fail "$tool est dans l'image de production — une peer ou une dep l'y a fait entrer"
  done
  ok "vite, vue, typescript absents de l'image"

  step "[front] (b2) front non construit, vite absent → ERREUR nommée, API vivante"
  docker rm -f "$FCTN" >/dev/null 2>&1 || true
  # `public/dist` MASQUÉ par un montage vide : on reproduit une image bâtie sans
  # build front, sans avoir à en construire une seconde. Un `rm -rf` dans le
  # conteneur ne le peut PAS — le code appartient à root et le processus tourne
  # en 1000 (durcissement volontaire du gabarit : une application qui peut
  # réécrire son propre `dist/` offre à une faille un moyen de PERSISTER).
  # Le montage n'exige aucun droit, et le décor est plus fidèle : le dossier
  # existe et il est vide, comme après un `COPY` sans build. Surtout, l'image
  # garde son ENTRYPOINT et son CMD — on mesure celle qu'on publie, pas un
  # `sh -c` de circonstance.
  docker run -d --name "$FCTN" -p "$FPORT:5151" --tmpfs /app/public/dist "$FIMG" >/dev/null
  migrate_in "$FCTN"
  wait_ready "$FCTN" "$FPORT"
  # Le message est émis pendant le BOOT, donc il est écrit quand `/readyz`
  # répond : rien à attendre ici. Ce qui faisait échouer cette ligne n'était pas
  # un retard mais `grep -q` sous `pipefail` (cf `contient`).
  contient "$(docker logs "$FCTN" 2>&1)" "vite indisponible" \
    || { docker logs "$FCTN" 2>&1 | tail -30; fail "ERREUR « vite indisponible » absente — la page blanche redevient muette"; }
  ok "ERREUR nommée : vite indisponible, geste indiqué"
  APICODE=$(http_code "http://127.0.0.1:$FPORT/api/hello")
  [ "$APICODE" = "200" ] || fail "API à $APICODE — un front absent ne doit PAS emporter le backend"
  ok "/api/hello → 200 (le backend survit à un front non construit)"
  docker rm -f "$FCTN" >/dev/null 2>&1 || true
fi

# ═══ SCÉNARIO « studio » — l'UI pré-buildée voyage-t-elle dans le paquet ? ══

if runs studio; then
  SAPP="$WORK/studio"
  SIMG="nodefony-smoke-studio:smoke"
  SCTN="nf-smoke-studio"; CONTAINERS="$CONTAINERS $SCTN"
  SPORT=15153

  step "[studio] create app — preset complet"
  scaffold_app "smokestudio" "$SAPP" "complete" "none"

  # Le gabarit pose lui-même `ui: "static"` ET `policy: "mandatory"` : la console
  # reste servie en production, ce qui est précisément la situation qu'on veut
  # éprouver ici. Ce banc CONSTATE donc cet état, il ne le fabrique plus.
  #
  # 🔴 Constater plutôt que basculer, et pourquoi le constat doit rester.
  # Ce bloc réécrivait la policy `dev` → `mandatory` dans le manifeste généré.
  # Le jour où le gabarit a posé `mandatory` de lui-même, la réécriture a levé
  # sur sa propre garde — le banc corrigeait un défaut qui n'existait plus.
  # Le supprimer aurait laissé le scénario muet sur un retour à `dev` : il
  # aurait alors mesuré une console ABSENTE en croyant mesurer son UI publiée.
  # Un banc qui modifie son sujet ne l'éprouve pas ; un banc qui le constate, si.
  step "[studio] la console est-elle déclarée pour la production ?"
  node -e '
const fs = require("node:fs");
const f = process.argv[1] + "/nodefony.config.ts";
const lines = fs.readFileSync(f, "utf8").split("\n");
// Le marqueur est `use("@nodefony/studio"`, PAS le seul nom du paquet : le
// manifeste généré le mentionne aussi dans un `export type { … } from
// "@nodefony/studio"`, placé AVANT la déclaration. Chercher le nom nu prenait
// cette ligne-là et échouait en accusant la policy — un motif plausible qui
// désigne la mauvaise ligne tout en semblant chercher la bonne.
const i = lines.findIndex((l) => l.includes("use(\"@nodefony/studio\""));
if (i < 0) { throw new Error("déclaration `use(\"@nodefony/studio\", …)` introuvable dans le manifeste généré"); }
const ligne = lines[i].trim();
if (!ligne.includes("policy: \"mandatory\"")) {
  throw new Error(
    "le gabarit ne déclare plus la console pour la production : " + ligne + "\n" +
    "  Deux causes, et toutes deux se corrigent hors de ce banc :\n" +
    "   · la policy est repassée à `dev` — la console dispara\u00eet du build de production,\n" +
    "     et ce scénario mesurerait une absence en croyant mesurer son UI publiée ;\n" +
    "   · la forme de la déclaration a changé (options réordonnées, policy implicite)\n" +
    "     — alors le constat doit apprendre la forme nouvelle, le gabarit reste juste."
  );
}
process.stdout.write("studio: policy mandatory constatée dans le gabarit\n");
' "$SAPP" || fail "constat de la policy Studio"
  ok "Studio déclaré mandatory par le gabarit (ui: static posé de même)"

  step "[studio] deps + migration initiale + image"
  rewrite_deps "$SAPP"
  write_initial_migration "$SAPP"
  build_image "$SAPP" "$SIMG"

  step "[studio] run — l'UI publiée est-elle servie ?"
  docker rm -f "$SCTN" >/dev/null 2>&1 || true
  # 🔴 Les SECRETS que la production EXIGE, posés comme un déploiement le ferait.
  #
  # Sans eux, l'application du preset complet refuse de démarrer — à raison :
  # `NF_CSRF_SECRET` est requis en production. Le conteneur mourait donc au boot,
  # et l'échec se manifestait trois lignes plus loin, sur `migrate_in`, sous la
  # forme « migrations non appliquées » — un message qui envoie chercher dans
  # l'ORM ce qui est un décor incomplet. Le scénario `base` n'était pas touché :
  # son preset minimal n'embarque pas la sécurité, donc n'exige aucun secret.
  #
  # Valeurs jetables et LISIBLES comme telles : ce banc ne protège rien, il
  # éprouve un démarrage.
  docker run -d --name "$SCTN" -p "$SPORT:5151" \
    -e NF_CSRF_SECRET="$SMOKE_SECRET" \
    -e NF_SESSION_SECRET="$SMOKE_SECRET" \
    "$SIMG" >/dev/null
  migrate_in "$SCTN"
  wait_ready "$SCTN" "$SPORT"
  SCODE=$(http_code "http://127.0.0.1:$SPORT/nodefony")
  [ "$SCODE" = "200" ] || { docker logs "$SCTN" 2>&1 | tail -30; fail "/nodefony → $SCODE"; }
  ok "/nodefony → 200"

  # L'asset n'est pas DEVINÉ : on le prend dans la page. Une URL écrite à la
  # main ici deviendrait fausse au premier changement de nommage, et le test
  # accuserait le tarball pour un motif qui n'a rien à voir.
  ASSET=$(curl -s "http://127.0.0.1:$SPORT/nodefony" \
    | grep -o '\(src\|href\)="/[^"]*\.\(js\|css\)"' | head -1 | sed 's/.*"\(.*\)"/\1/')
  [ -n "$ASSET" ] || { curl -s "http://127.0.0.1:$SPORT/nodefony" | head -20; fail "aucun asset référencé dans la page Studio"; }
  ACODE=$(http_code "http://127.0.0.1:$SPORT$ASSET")
  [ "$ACODE" = "200" ] || fail "asset $ASSET → $ACODE (dist/frontend absent du tarball studio ?)"
  ok "asset $ASSET → 200 (UI pré-buildée présente dans le paquet publié)"
  docker rm -f "$SCTN" >/dev/null 2>&1 || true
fi

# ═══ SCÉNARIO « edge » — la TOPOLOGIE de production, pas ses morceaux ═══════
#
# Ce que #320 a produit (frontal nginx dérivé de l'application) n'avait été
# prouvé que par pièces détachées : une application en production SUR L'HÔTE
# avec un nginx en conteneur devant elle. Même contrat applicatif, topologie
# différente — et c'est la topologie qui portait les inconnues :
#
#   - l'étage `proxyconf` BOOTE l'application en production pour dériver la
#     configuration du frontal. Sans base, sans Redis, sans secret. S'il échoue,
#     l'image du frontal ne se construit pas, et personne ne le sait avant
#     d'essayer. Ici, `docker build` le constate ;
#   - l'application est-elle jointe par son NOM DE SERVICE sur le réseau du
#     compose, et non par une adresse de boucle qui, dans un conteneur, désigne
#     le conteneur lui-même ;
#   - `trustProxy: uniquelocal` mord-il RÉELLEMENT ? Sur le banc de #320, le
#     frontal joignait l'hôte depuis une source de BOUCLE (`127.0.0.1`) — pas une
#     adresse privée — et il avait fallu `loopback,uniquelocal`. Dans le compose
#     les deux services sont sur le même pont (172.x) et `uniquelocal` DOIT
#     suffire. C'est ce que le gabarit pose, et rien ne le vérifiait ;
#   - `/_assets/…` servi par le frontal SANS que Node soit joint — invérifiable
#     au banc de #320, dont l'application témoin n'avait pas de frontal
#     applicatif et donc pas d'arbre d'assets.
#
# Le discriminant de `trustProxy` n'est pas l'adresse (les deux candidates sont
# en 172.x, on ne prouverait rien de net) : c'est le SCHÉMA. Le lien interne est
# en clair, l'arrivée est en TLS. `scheme === "https"` côté application signifie
# exactement « le `X-Forwarded-Proto` du frontal a été CRU » — et il ne l'est que
# si la confiance s'applique à l'adresse du socket.

if runs edge; then
  EAPP="$WORK/edge"
  EHTTP=18080
  ETLS=18443
  # Les deux images que `docker compose --build` bâtit. Les noms viennent du
  # gabarit `compose.yaml.tpl` (`<app>:local` et `<app>-edge:local`) : les
  # composer ici plutôt que de les littéraliser garde le lien avec le nom de
  # l'application scaffoldée juste en dessous.
  EDGE_APP_NAME="smokeedge"
  EDGE_APP_IMAGE="$EDGE_APP_NAME:local"
  EDGE_PROXY_IMAGE="$EDGE_APP_NAME-edge:local"
  # Le mot de passe se LIT dans la suite générée, il ne se redonne pas ici : la
  # suite e2e porte sa propre constante (`ADMIN_PASSWORD`) et s'en sert pour
  # s'authentifier. Deux valeurs écrites séparément divergent au premier
  # changement de gabarit — et le symptôme est un `401` que le banc impute à la
  # route mesurée. Renseigné après le scaffold (cf plus bas).
  EDGE_ADMIN_PASSWORD=""

  step "[edge] create app — preset complet + front React (pour l'arbre d'assets)"
  scaffold_app "$EDGE_APP_NAME" "$EAPP" "complete" "react"

  # Ce que l'application CROIT du client — la seule façon de constater que la
  # confiance au proxy s'applique. Même geste qu'au scénario `base` : la commande
  # pose le câblage, le corps est réécrit en entier (aucune ancre à maintenir).
  step "[edge] décor — route /api/whoami (ce que l'app croit du client)"
  (cd "$EAPP" && "$NODEFONY_BIN" create controller whoami --kind hello --route /api) \
    > "$WORK/.edge-controller.out" 2>&1 \
    || { tail -20 "$WORK/.edge-controller.out"; fail "nodefony create controller (edge)"; }
  WHO_FILE="$EAPP/nodefony/controllers/WhoamiController.ts"
  [[ -f "$WHO_FILE" ]] || fail "WhoamiController.ts non produit par create controller"
  grep -q "WhoamiController" "$EAPP/index.ts" || fail "WhoamiController non câblé dans index.ts"
  cat > "$WHO_FILE" <<'TS'
import { route, controller, Controller } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * DÉCOR DU SMOKE — ce que l'application croit du client qui l'appelle.
 *
 * `scheme` est le témoin de `trustProxy` : le lien interne entre le frontal et
 * l'application est en CLAIR, donc `https` ne peut venir que d'un
 * `X-Forwarded-Proto` qui a été CRU.
 */
@controller("/api")
class WhoamiController extends Controller {
  constructor(context: ContextType) {
    super("whoami", context);
  }

  @route("whoami-index", { path: "/whoami", method: "GET" })
  index() {
    return this.renderJson({
      scheme: this.context.scheme,
      ip: this.context.remoteAddress ?? null,
    });
  }
}

export default WhoamiController;
TS
  ok "route /api/whoami posée et câblée"

  # L'identité que la suite générée présentera — lue dans SON fichier, pas
  # redonnée ici (cf `EDGE_ADMIN_PASSWORD` plus haut).
  EDGE_ADMIN_PASSWORD=$(sed -n 's/^export const ADMIN_PASSWORD = "\(.*\)";$/\1/p' \
    "$EAPP/tests/e2e.setup.ts")
  [ -n "$EDGE_ADMIN_PASSWORD" ] \
    || fail "ADMIN_PASSWORD introuvable dans la suite e2e générée — le banc ne peut pas fournir l'identité qu'elle attend"
  ok "identité de la suite lue dans son propre fichier"

  step "[edge] deps + migration initiale (installe et bâtit côté hôte)"
  rewrite_deps "$EAPP"
  write_initial_migration "$EAPP"

  # 🔴 Le certificat est MONTÉ par le frontal, jamais gravé dans son image — le
  # compose monte `nodefony/config/certificates/server`. Sans ce fichier, nginx
  # ne démarre pas, et l'échec parle d'un chemin, pas d'un certificat manquant.
  # C'est la commande que le compose prescrit en toutes lettres.
  step "[edge] certificat de développement (MONTÉ par le frontal, jamais gravé)"
  (cd "$EAPP" && node_modules/.bin/nodefony http:certificates) \
    > "$WORK/.edge-certs.out" 2>&1 \
    || { tail -20 "$WORK/.edge-certs.out"; fail "nodefony http:certificates"; }
  for pem in fullchain.pem privkey.pem; do
    [[ -f "$EAPP/nodefony/config/certificates/server/$pem" ]] \
      || fail "certificat absent : nodefony/config/certificates/server/$pem"
  done
  ok "fullchain.pem + privkey.pem présents (le montage du frontal a de quoi lire)"

  # Ports décalés pour cohabiter avec le poste de développement — le compose
  # généré publie sur la boucle locale à des ports CONVENTIONNELS (6379 pour
  # Redis), et ce banc tourne sur une machine qui fait déjà tourner les siens.
  # Chaque valeur est interpolée par le compose (`${REDIS_PORT:-6379}`) : c'est
  # le mécanisme que le gabarit documente, pas un contournement.
  #
  # Vécu : sans `REDIS_PORT`, les deux images se construisaient parfaitement puis
  # le `up` mourait sur « port is already allocated » — un échec de DÉCOR qui
  # s'affiche à l'étape du produit, et qu'on impute au produit.
  export EDGE_HTTP_PORT="$EHTTP" EDGE_TLS_PORT="$ETLS" REDIS_PORT=16379
  COMPOSE_DIR="$EAPP"

  # Les SECRETS que la production exige, posés comme un exploitant le ferait :
  # par l'environnement du service, jamais dans l'image (`.dockerignore` exclut
  # `*.local`, et une couche reste lisible même effacée). Le compte
  # d'administration en fait partie — sans lui, aucune identité n'existe en
  # production, et le cas du cookie `__Host-` n'aurait rien à observer.
  # `compose.override.yaml` est lu AUTOMATIQUEMENT par compose : c'est le point
  # d'injection que le gabarit laisse à qui déploie.
  cat > "$EAPP/compose.override.yaml" <<YML
services:
  migrate:
    environment:
      NF_CSRF_SECRET: "$SMOKE_SECRET"
      NF_SESSION_SECRET: "$SMOKE_SECRET"
  app-edge:
    environment:
      NF_CSRF_SECRET: "$SMOKE_SECRET"
      NF_SESSION_SECRET: "$SMOKE_SECRET"
      NF_ADMIN_PASSWORD: "$EDGE_ADMIN_PASSWORD"
YML

  step "[edge] docker compose --profile edge up -d --build (le geste de l'utilisateur)"
  (cd "$EAPP" && docker compose --profile edge up -d --build) > "$WORK/.edge-up.out" 2>&1 \
    || { tail -40 "$WORK/.edge-up.out"; fail "docker compose --profile edge up"; }
  ok "topologie levée : l'étage proxyconf a bâti la configuration du frontal"

  # 🔴 La garde de matière sensible, sur les DEUX images que compose vient de
  # bâtir — #317. Les scénarios `base`, `front` et `studio` passent par
  # `build_image`, qui la lance ; `edge`, lui, construit par `docker compose
  # --build` et y échappait. C'était le trou le plus coûteux des quatre : c'est
  # ICI qu'un certificat est en jeu (le frontal en MONTE un), et c'est la
  # topologie la plus proche de la production. Une clé privée est déjà partie
  # dans une image publiée faute d'un regard à ce moment précis.
  #
  # Le frontal est contrôlé au même titre que l'application : il LIT le
  # certificat par un montage, il ne doit pas l'embarquer.
  step "[edge] matière sensible dans les images bâties par compose"
  for IMAGE in "$EDGE_APP_IMAGE" "$EDGE_PROXY_IMAGE"; do
    node "$ROOT/scripts/release/image-gate.mjs" "$IMAGE" \
      || fail "matière sensible dans l'image $IMAGE (voir ci-dessus)"
  done
  ok "aucune matière sensible dans $EDGE_APP_IMAGE ni $EDGE_PROXY_IMAGE"

  # `docker compose up` rend la main dès que les conteneurs sont créés, pas
  # quand ils servent. Le frontal dépend de `app-edge: service_healthy`, donc
  # sa présence prouve déjà le boot de l'application — mais nginx, lui, met
  # encore un instant à accepter du TLS.
  step "[edge] readiness du frontal"
  EDGE_URL="https://localhost:$ETLS"
  ECODE=""
  for _ in $(seq 1 60); do
    ECODE=$(curl -sk -o /dev/null -w "%{http_code}" "$EDGE_URL/livez" || true)
    [ "$ECODE" = "200" ] && break
    sleep 1
  done
  if [ "$ECODE" != "200" ]; then
    (cd "$EAPP" && docker compose --profile edge logs --tail 40) 2>&1 | tail -60
    fail "$EDGE_URL/livez jamais 200 (reçu: $ECODE)"
  fi
  ok "$EDGE_URL/livez → 200 (l'app est jointe par son NOM de service, app-edge)"

  step "[edge] trustProxy: uniquelocal SEUL — le frontal est-il cru ?"
  WHO=$(curl -sk "$EDGE_URL/api/whoami")
  contient "$WHO" '"scheme":"https"' \
    || { echo "$WHO"; fail "l'app voit du http À TRAVERS un frontal TLS — uniquelocal ne mord pas (il avait fallu loopback au banc de #320)"; }
  ok "/api/whoami → $WHO (X-Forwarded-Proto CRU sur une adresse privée)"

  # Le cookie `__Host-` DÉRIVE du schéma constaté : le préfixe exige `Secure`, et
  # `Secure` ne se pose que si l'application se sait servie en TLS. C'est donc le
  # témoin OBSERVABLE de la chaîne complète, du `proxy_set_header` du frontal
  # jusqu'au cookie que le navigateur recevra.
  step "[edge] le préfixe __Host- sur le cookie de session"
  LOGIN_HDRS=$(curl -sk -D - -o /dev/null -X POST "$EDGE_URL/nodefony/security/api/auth/login" \
    -H "content-type: application/json" -d "{\"username\":\"admin\",\"password\":\"$EDGE_ADMIN_PASSWORD\"}" || true)
  contient "$LOGIN_HDRS" "__Host-" \
    || { echo "$LOGIN_HDRS" | grep -i "set-cookie" || echo "(aucun Set-Cookie)"; \
         fail "aucun cookie __Host- — l'app ne se sait pas servie en TLS"; }
  ok "cookie __Host- posé (le préfixe dérive du schéma constaté)"

  step "[edge] la suite de bout en bout générée, JOUÉE À TRAVERS le frontal"
  # `NF_E2E_BASE_URL` : la suite ne démarre alors rien et ne touche aucune base —
  # elle mesure le déploiement qui tourne. C'est le seul moment où l'on constate
  # ce qu'un `fetch` direct ne peut pas voir.
  # Le certificat est auto-signé : on le DONNE à Node plutôt que de désarmer la
  # validation, qui ferait passer la suite contre n'importe quel certificat.
  (cd "$EAPP" && NF_E2E_BASE_URL="$EDGE_URL" \
    NODE_EXTRA_CA_CERTS="$EAPP/nodefony/config/certificates/ca/nodefony-root-ca.crt.pem" \
    npm run test:e2e) > "$WORK/.edge-e2e.out" 2>&1 \
    || { tail -40 "$WORK/.edge-e2e.out"; fail "suite e2e générée À TRAVERS le frontal"; }
  ok "suite e2e verte à travers le frontal (mêmes tests, autre topologie)"

  # La preuve que le frontal sert SEUL : on éteint l'application. Un asset qui
  # répond encore n'a pas pu passer par Node. C'est binaire, et ça ne dépend
  # d'aucun compteur.
  # 🔴 Un 200 ne dit PAS que la page marche, et c'est le piège de ce frontal.
  # Sa configuration REMPLACE le `nginx.conf` de l'image : sans `mime.types`,
  # nginx sert TOUT en `text/plain`, le navigateur REFUSE un module ES à ce type
  # (« Strict MIME type checking is enforced for module scripts ») et ignore la
  # feuille de style. Les assets répondaient 200, ce scénario était VERT, et
  # l'écran était noir. On vérifie donc le TYPE, pendant que la page est servie.
  step "[edge] les assets sont servis avec le BON type (un 200 ne suffit pas)"
  PAGE=$(curl -sk "$EDGE_URL/" || true)
  # `|| true` sur CHAQUE grep : sans correspondance il rend 1, et sous
  # `set -euo pipefail` cela tue le banc SANS message ni nettoyage — vécu.
  JS=$(printf '%s' "$PAGE" | grep -o '/_assets/[^"]*\.js' | head -1 || true)
  CSS=$(printf '%s' "$PAGE" | grep -o '/_assets/[^"]*\.css' | head -1 || true)
  [ -n "$JS" ] || { printf '%s' "$PAGE" | head -20; fail "aucun module JS dans la page — l'arbre d'assets n'a pas été publié"; }
  for couple in "$JS|javascript" "$CSS|css"; do
    url="${couple%%|*}"; attendu="${couple##*|}"
    [ -n "$url" ] || continue
    typ=$(curl -sk -o /dev/null -w "%{content_type}" "$EDGE_URL$url" || true)
    case "$typ" in
      *"$attendu"*) ok "$(basename "$url") servi en « $typ »" ;;
      *) fail "$(basename "$url") servi en « $typ » (attendu : $attendu) — le navigateur le REFUSE, écran blanc" ;;
    esac
  done

  step "[edge] /_assets/… servi par le frontal SANS joindre Node"
  ASSET="$JS"
  (cd "$EAPP" && docker compose --profile edge stop app-edge) > /dev/null 2>&1 \
    || fail "arrêt de app-edge"
  ACODE=$(curl -sk -o /dev/null -w "%{http_code}" "$EDGE_URL$ASSET" || true)
  [ "$ACODE" = "200" ] || fail "$ASSET → $ACODE application ÉTEINTE : le frontal ne sert pas les statiques"
  ok "$ASSET → 200 application éteinte (nginx sert, Node n'est pas joint)"

  # Et le contrôle négatif : une route applicative, elle, DOIT tomber — sinon on
  # aurait prouvé que l'application était encore là, pas que nginx sert seul.
  DEADCODE=$(curl -sk -o /dev/null -w "%{http_code}" "$EDGE_URL/api/whoami" || true)
  [ "$DEADCODE" = "200" ] && fail "l'application répond alors qu'elle est arrêtée — la preuve précédente ne prouve rien"
  ok "/api/whoami → $DEADCODE (l'application est bien éteinte : la preuve tient)"

  # ── LA GARDE, VUE MORDRE ──────────────────────────────────────────────────
  # Un contrôle qu'on n'a jamais vu échouer ne garde rien. On retire la seule
  # ligne qui accorde la confiance et on constate que le cookie perd son préfixe :
  # l'application, ne croyant plus le frontal, se croit servie en clair.
  step "[edge] garde vue mordre — sans NF__HTTP__TRUSTPROXY, __Host- tombe"
  cat > "$EAPP/compose.degraded.yaml" <<'YML'
# Débranchement DÉLIBÉRÉ du banc : la confiance au frontal est retirée.
services:
  app-edge:
    environment:
      NF__HTTP__TRUSTPROXY: ""
YML
  (cd "$EAPP" && docker compose -f compose.yaml -f compose.override.yaml \
      -f compose.degraded.yaml --profile edge up -d --force-recreate app-edge) \
    > "$WORK/.edge-degraded.out" 2>&1 \
    || { tail -30 "$WORK/.edge-degraded.out"; fail "recréation de app-edge sans trustProxy"; }
  DCODE=""
  for _ in $(seq 1 60); do
    DCODE=$(curl -sk -o /dev/null -w "%{http_code}" "$EDGE_URL/livez" || true)
    [ "$DCODE" = "200" ] && break
    sleep 1
  done
  [ "$DCODE" = "200" ] || { (cd "$EAPP" && docker compose --profile edge logs --tail 30 app-edge) 2>&1 | tail -40; \
    fail "l'app sans trustProxy ne répond pas — le débranchement mesure autre chose"; }
  DEGRADED=$(curl -sk -D - -o /dev/null -X POST "$EDGE_URL/nodefony/security/api/auth/login" \
    -H "content-type: application/json" -d "{\"username\":\"admin\",\"password\":\"$EDGE_ADMIN_PASSWORD\"}" || true)
  contient "$DEGRADED" "__Host-" \
    && fail "__Host- posé SANS trustProxy — le cas ne prouvait rien, il passait de toute façon"
  ok "__Host- absent sans trustProxy : la garde MORD (le cas précédent avait un sens)"
  rm -f "$EAPP/compose.degraded.yaml"

  step "[edge] docker compose --profile edge down — le drain n'est pas coupé"
  (cd "$EAPP" && docker compose --profile edge up -d --force-recreate app-edge) > /dev/null 2>&1 \
    || fail "remise en état de app-edge avant l'arrêt propre"
  (cd "$EAPP" && docker compose --profile edge down) > "$WORK/.edge-down.out" 2>&1 \
    || { tail -20 "$WORK/.edge-down.out"; fail "docker compose --profile edge down n'a pas rendu 0"; }
  ok "down → 0 (stop_grace_period au-dessus du shutdownDeadline)"
  # 🔴 NE PAS désarmer `cleanup` ici. Le `down` ci-dessus est SANS `-v` — c'est
  # le geste qu'on MESURE (le drain n'est pas coupé), pas le rangement. Vider
  # `COMPOSE_DIR` rendait le `cleanup` final inerte, et le banc ne laissait donc
  # un décor sale QUE lorsqu'il RÉUSSISSAIT : `<app>-var` survivait, avec la base
  # sqlite et ses comptes.
  #
  # La passe suivante démarrait alors sur une base peuplée. Le semis d'admin est
  # idempotent — il crée le compte s'il n'existe pas, il ne réaligne jamais son
  # mot de passe : le login du cas `__Host-` se faisait refuser, sans Set-Cookie
  # et sans une ligne dans les journaux. Un rouge qui accuse le produit et qui
  # n'appartient qu'au décor (vécu le 2026-09-18, sur la bascule de la base de
  # l'image : trois quarts d'heure à chercher dans Alpine ce qui était dans un
  # volume).
fi

# ═══ SCÉNARIO « sql » — les TROIS moteurs serveurs, sous musl ═══════════════
#
# Ce que les quatre autres scénarios ne peuvent pas voir : ils tournent tous sur
# SQLite, un FICHIER. Or l'image est bâtie sur Alpine (#420), dont la bibliothèque
# C est musl — et ce qui change entre musl et glibc n'est pas le pilote (`pg` et
# `mysql2` sont du JavaScript pur) mais la RÉSOLUTION DE NOMS. Joindre sa base
# par un nom de service est le mode NOMINAL en compose comme en Kubernetes ;
# c'est donc le premier appel système que fait une application déployée, et le
# seul que le passage à Alpine pouvait casser.
#
# Trois différences documentées de musl, toutes invisibles tant qu'on reste sur
# un fichier : il n'implémente ni `search` à plusieurs domaines ni `ndots` comme
# glibc, il interroge les serveurs de `resolv.conf` EN PARALLÈLE et retient la
# première réponse, et il n'a pas de `nsswitch.conf`. Aucun de ces écarts ne
# lève d'erreur : ils se manifestent par un nom qui ne résout pas, donc par une
# application qui n'atteint jamais sa base.
#
# Ce que ce scénario établit, moteur par moteur :
#   1. le compose généré joint la base par son NOM (et non par une boucle locale,
#      qui dans un conteneur désigne le conteneur lui-même) ;
#   2. ce nom RÉSOUT depuis l'application, sous musl — constaté par `getaddrinfo`
#      exécuté DANS le conteneur, pas déduit du fait que l'app démarre ;
#   3. la tâche de migration, qui est le PREMIER à ouvrir une connexion par ce
#      nom, s'est terminée avec succès ;
#   4. l'application sert, et une route qui TOUCHE la base répond ;
#   5. la suite de bout en bout générée passe, exécutée DANS Alpine et joignant
#      l'application par son nom de service — les deux points que le « Fini
#      quand » de #420 réclamait et qu'aucun banc ne couvrait.
#
# Le coût est assumé : trois applications générées, installées, bâties et mises
# en conteneur. C'est le prix d'une preuve sur les trois dialectes que
# `--database` propose, et ce banc ne se joue pas à chaque commit.

if runs sql; then
  # Ports décalés : ce banc tourne sur une machine de développement qui fait
  # déjà tourner les siens, et le compose généré publie sur des ports
  # CONVENTIONNELS. Chaque valeur est interpolée par le gabarit
  # (`${POSTGRES_PORT:-5432}`) — c'est le mécanisme qu'il documente, pas un
  # contournement. Les trois moteurs ne cohabitent jamais : on range entre deux.
  export APP_PORT=15251 REDIS_PORT=16379 \
         POSTGRES_PORT=15432 MARIADB_PORT=13306 MYSQL_PORT=13307
  SQL_APP_PORT=15251
  COMPOSE_PROFILE="app"

  # `--scenario sql` joue les trois ; `--scenario sql:mysql` n'en joue qu'un,
  # ce dont la forge se sert pour en faire trois jobs parallèles.
  case "$SCENARIO" in
    sql:*) SQL_MOTEURS="${SCENARIO#sql:}" ;;
    *)     SQL_MOTEURS="postgres mariadb mysql" ;;
  esac
  # L'ordre ne porte rien. La garde « vue mordre » se joue sur le PREMIER de la
  # liste EFFECTIVE, une seule fois : elle débranche la résolution de nom, qui
  # ne dépend d'aucun dialecte — un job qui ne joue que `mysql` doit donc la
  # jouer quand même, sinon ce job-là ne prouverait rien.
  SQL_FIRST="${SQL_MOTEURS%% *}"

  for MOTEUR in $SQL_MOTEURS; do
    case "$MOTEUR" in
      postgres) QAPP_NAME="smokesqlpg";    SERVICE="postgres" ;;
      mariadb)  QAPP_NAME="smokesqlmaria"; SERVICE="mariadb" ;;
      mysql)    QAPP_NAME="smokesqlmy";    SERVICE="mysql" ;;
    esac
    QAPP="$WORK/sql-$MOTEUR"
    QAPP_IMAGE="$QAPP_NAME:local"
    QAPP_E2E_IMAGE="$QAPP_NAME-e2e:local"

    step "[sql:$MOTEUR] create app — preset complet, --database $MOTEUR"
    scaffold_app "$QAPP_NAME" "$QAPP" "complete" "none" "$MOTEUR"

    # ── Ce qui rend la suite DISCRIMINANTE ────────────────────────────────────
    # Si le compose posait `127.0.0.1`, l'application ne résoudrait aucun nom et
    # tout ce qui suit serait vert sans rien prouver de musl. On le CONSTATE
    # avant de mesurer, plutôt que de le supposer d'après le gabarit.
    step "[sql:$MOTEUR] le compose joint la base par son NOM, pas par une boucle locale"
    [[ -f "$QAPP/compose.yaml" ]] || fail "compose.yaml non généré pour --database $MOTEUR"
    SURL=$(sed -n 's/^ *NF_DATABASE_URL: *"\(.*\)"$/\1/p' "$QAPP/compose.yaml" | head -1)
    [ -n "$SURL" ] || { grep -n "NF_DATABASE_URL" "$QAPP/compose.yaml" | head -5; \
      fail "NF_DATABASE_URL absente du compose généré"; }
    contient "$SURL" "@$SERVICE:" \
      || fail "NF_DATABASE_URL = « $SURL » : la base n'est pas jointe par le nom de service « $SERVICE » — rien ici ne mesurerait la résolution musl"
    case "$SURL" in
      *127.0.0.1*|*localhost*) fail "NF_DATABASE_URL = « $SURL » : une boucle locale dans un conteneur désigne le CONTENEUR, pas la base" ;;
    esac
    grep -q "^  $SERVICE:" "$QAPP/compose.yaml" \
      || fail "le service « $SERVICE » n'est pas déclaré dans le compose généré"
    ok "NF_DATABASE_URL = $SURL (nom de service « $SERVICE »)"

    # ── L'INFRA AVANT LA MIGRATION, et c'est le produit qui l'impose ─────────
    # `orm:generate` DÉMARRE l'application pour lire ses entités ; sur un moteur
    # serveur, ce démarrage ouvre une connexion. Sur SQLite la question ne se
    # pose pas — un fichier est toujours là —, et c'est pourquoi les quatre
    # autres scénarios n'ont jamais eu besoin de cette étape.
    #
    # `up -d` SANS profil monte exactement la base et Redis : ni `migrate`, ni
    # `app`, qui portent `profiles:`. C'est le geste que le README généré
    # prescrit à qui développe sur son poste, et `--wait` rend la main quand les
    # sondes du compose sont vertes, pas quand les conteneurs existent.
    COMPOSE_DIR="$QAPP"
    step "[sql:$MOTEUR] infra seule ($SERVICE + redis) — ce que la génération exige"
    (cd "$QAPP" && docker compose up -d --wait) > "$WORK/.sql-$MOTEUR-infra.out" 2>&1 \
      || { tail -30 "$WORK/.sql-$MOTEUR-infra.out"; fail "docker compose up -d --wait (infra $MOTEUR)"; }
    ok "$SERVICE et redis répondent à leurs sondes"

    # 🔴 Depuis l'HÔTE, la base se joint par la boucle locale et le port PUBLIÉ —
    # décalé, parce que le poste fait déjà tourner ses propres conteneurs sur les
    # ports conventionnels. Sans cette surcharge, l'application lit le
    # `NF_DATABASE_URL` de son `.env` (`127.0.0.1:5432`) et tombe sur le
    # PostgreSQL d'un autre projet : le serveur répond puis refuse (28P01), et
    # le message accuse des identifiants alors que la base n'est pas la bonne.
    # Vécu au premier run de ce scénario.
    case "$MOTEUR" in
      postgres) HOST_DB_PORT="$POSTGRES_PORT" ;;
      mariadb)  HOST_DB_PORT="$MARIADB_PORT" ;;
      mysql)    HOST_DB_PORT="$MYSQL_PORT" ;;
    esac
    SURL_HOST=$(printf '%s' "$SURL" | sed "s#@$SERVICE:[0-9]*/#@127.0.0.1:$HOST_DB_PORT/#")
    contient "$SURL_HOST" "@127.0.0.1:$HOST_DB_PORT/" \
      || fail "réécriture de l'URL vers l'hôte ratée : « $SURL_HOST »"

    step "[sql:$MOTEUR] deps + migration initiale du dialecte (côté hôte)"
    rewrite_deps "$QAPP"
    # L'environnement du processus gagne sur le `.env` de l'application — c'est
    # le même mécanisme par lequel le compose pose ses valeurs aux services.
    NF_DATABASE_URL="$SURL_HOST" \
    NF_REDIS_URL="redis://:$QAPP_NAME-dev@127.0.0.1:$REDIS_PORT" \
      write_initial_migration "$QAPP"

    # L'identité que la suite e2e présentera — lue dans SON fichier, jamais
    # redonnée ici : deux valeurs écrites séparément divergent au premier
    # changement de gabarit, et le symptôme est un 401 qu'on impute à la route.
    SQL_ADMIN_PASSWORD=$(sed -n 's/^export const ADMIN_PASSWORD = "\(.*\)";$/\1/p' \
      "$QAPP/tests/e2e.setup.ts")
    [ -n "$SQL_ADMIN_PASSWORD" ] \
      || fail "ADMIN_PASSWORD introuvable dans la suite e2e générée ($MOTEUR)"

    # Les secrets que la production EXIGE, posés comme un exploitant le ferait :
    # par l'environnement du service, jamais dans l'image.
    cat > "$QAPP/compose.override.yaml" <<YML
services:
  migrate:
    environment:
      NF_CSRF_SECRET: "$SMOKE_SECRET"
      NF_SESSION_SECRET: "$SMOKE_SECRET"
  app:
    environment:
      NF_CSRF_SECRET: "$SMOKE_SECRET"
      NF_SESSION_SECRET: "$SMOKE_SECRET"
      NF_ADMIN_PASSWORD: "$SQL_ADMIN_PASSWORD"
YML

    step "[sql:$MOTEUR] docker compose --profile app up -d --build (le geste de l'utilisateur)"
    (cd "$QAPP" && docker compose --profile app up -d --build) > "$WORK/.sql-$MOTEUR-up.out" 2>&1 \
      || { tail -40 "$WORK/.sql-$MOTEUR-up.out"; fail "docker compose --profile app up ($MOTEUR)"; }
    ok "$SERVICE + redis + migrate + app levés"

    # Même motif que le scénario `edge` : compose bâtit l'image lui-même et
    # échappe donc à `build_image`, qui porte la garde de matière sensible.
    step "[sql:$MOTEUR] matière sensible dans l'image bâtie par compose"
    node "$ROOT/scripts/release/image-gate.mjs" "$QAPP_IMAGE" \
      || fail "matière sensible dans l'image $QAPP_IMAGE (voir ci-dessus)"
    ok "aucune matière sensible dans $QAPP_IMAGE"

    # ── LA RÉSOLUTION, CONSTATÉE — pas déduite ───────────────────────────────
    # `getaddrinfo` est l'appel que musl implémente autrement ; on le fait jouer
    # DANS le conteneur de l'application, avec son `/etc/resolv.conf` et sa
    # bibliothèque C. Un `ping` prouverait autre chose (il existe des images sans
    # `ping`, et `busybox` ne passe pas toujours par le même chemin).
    step "[sql:$MOTEUR] le nom « $SERVICE » résout DEPUIS l'app, sous musl"
    LIBC=$(docker exec "$QAPP_NAME-app" sh -c 'ls /lib/ld-musl-* 2>/dev/null | head -1' || true)
    [ -n "$LIBC" ] || fail "l'image de l'application n'est pas sur musl ($QAPP_IMAGE) — ce scénario ne mesurerait pas ce qu'il annonce"
    ADDR=$(docker exec "$QAPP_NAME-app" node -e \
      "require('node:dns').promises.lookup(process.argv[1]).then(r=>console.log(r.address),e=>{console.error(e.code||e.message);process.exit(1)})" \
      "$SERVICE" 2>&1) \
      || { echo "$ADDR"; fail "getaddrinfo(« $SERVICE ») ÉCHOUE sous musl depuis le conteneur de l'app"; }
    ok "getaddrinfo(« $SERVICE ») → $ADDR (musl : $(basename "$LIBC"))"

    # La tâche de migration est le PREMIER à ouvrir une connexion par ce nom :
    # son code de sortie est donc la preuve la plus précoce que la chaîne tient.
    # `service_completed_successfully` le garantit déjà côté compose — mais une
    # garantie qu'on n'a pas lue n'est pas une preuve.
    step "[sql:$MOTEUR] la tâche de migration s'est terminée avec succès"
    MIG_CODE=$(docker inspect -f '{{.State.ExitCode}}' "$QAPP_NAME-migrate" 2>/dev/null || echo "?")
    [ "$MIG_CODE" = "0" ] \
      || { docker logs "$QAPP_NAME-migrate" 2>&1 | tail -30; \
           fail "la tâche migrate est sortie en $MIG_CODE — le schéma n'a pas été appliqué sur $MOTEUR"; }
    ok "migrate → exit 0 (le schéma $MOTEUR est appliqué, par le nom de service)"

    step "[sql:$MOTEUR] /readyz — l'application se déclare prête"
    wait_ready "$QAPP_NAME-app" "$SQL_APP_PORT"
    ok "http://127.0.0.1:$SQL_APP_PORT/readyz → 200"

    # `/readyz` peut se contenter de vérifier le schéma ; une route qui LIT la
    # table des comptes prouve que le dialecte fonctionne de bout en bout.
    step "[sql:$MOTEUR] une route qui TOUCHE la base ($MOTEUR) répond"
    SQL_LOGIN=$(curl -s -D - -o /dev/null -X POST \
      "http://127.0.0.1:$SQL_APP_PORT/nodefony/security/api/auth/login" \
      -H "content-type: application/json" \
      -d "{\"username\":\"admin\",\"password\":\"$SQL_ADMIN_PASSWORD\"}" || true)
    # 🔴 La casse d'un nom d'en-tête ne se suppose pas : HTTP/1.1 la laisse
    # libre, HTTP/2 l'impose en minuscules, et notre serveur rend « set-cookie ».
    # Chercher « Set-Cookie » a fait échouer ce cas sur une réponse 200
    # parfaitement valide — un rouge qui accusait PostgreSQL d'un défaut de banc.
    SQL_LOGIN=$(printf '%s' "$SQL_LOGIN" | tr '[:upper:]' '[:lower:]')
    contient "$SQL_LOGIN" "set-cookie" \
      || { echo "$SQL_LOGIN" | head -20; docker logs "$QAPP_NAME-app" 2>&1 | tail -30; \
           fail "connexion admin refusée sur $MOTEUR — la lecture de la table des comptes ne passe pas"; }
    ok "login admin → Set-Cookie (le compte a été SEMÉ puis RELU dans $MOTEUR)"

    # ── LA SUITE e2e, JOUÉE DANS ALPINE ──────────────────────────────────────
    # Deux choses d'un coup, et c'est pour cela qu'elle est jouée ici plutôt que
    # depuis l'hôte : les tests s'exécutent sous musl (avec le build de
    # l'application, que `test:e2e` refait), et ils joignent l'application par
    # son NOM DE SERVICE sur le réseau du compose.
    #
    # 🔴 Elle ne peut PAS tourner dans l'image de production : `vitest` est une
    # dépendance de développement, et l'image installe en `--omit=dev`. C'est
    # juste — une image de production n'embarque pas son banc. D'où une image
    # SŒUR, bâtie du même `node:24-alpine`, avec les devDependencies.
    #
    # Son `.dockerignore` lui est propre (`Dockerfile.e2e.dockerignore`, lu en
    # priorité par BuildKit) : celui de l'application exclut `tests`, ce qui est
    # exactement ce qu'on veut pour l'image qu'on déploie — et l'inverse de ce
    # qu'il faut ici.
    #
    # Elle est écrite APRÈS le `up --build` : le `.dockerignore` de production
    # ne connaît pas ces deux fichiers, et ils entreraient dans l'image qu'on
    # vient de faire contrôler.
    step "[sql:$MOTEUR] image sœur de test (même Alpine, AVEC les devDeps)"
    ALPINE_BASE=$(sed -n 's/^FROM \(node:[0-9]*-alpine\).*/\1/p' "$QAPP/Dockerfile" | head -1)
    [ -n "$ALPINE_BASE" ] \
      || { grep -n "^FROM" "$QAPP/Dockerfile"; fail "base Alpine introuvable dans le Dockerfile généré — l'image sœur dériverait de l'image mesurée"; }
    cat > "$QAPP/Dockerfile.e2e" <<DOCKERFILE
# Image SŒUR du banc — jamais publiée, jamais déployée.
# Même base que l'image de production (lue dans son Dockerfile, pas recopiée),
# mais avec les devDependencies : la suite de bout en bout a besoin de vitest,
# que \`--omit=dev\` retire à juste titre de l'image qu'on déploie.
FROM $ALPINE_BASE
WORKDIR /app
COPY . ./
RUN npm install --no-audit --no-fund --ignore-scripts
DOCKERFILE
    # Ce que l'image de production exclut à raison, et qu'il faut ICI.
    cat > "$QAPP/Dockerfile.e2e.dockerignore" <<'DOCKERIGNORE'
**/node_modules
**/dist
var
logs
**/*.log
*.local
**/*.local
nodefony/config/certificates
**/*.key
**/*.pem
.npmrc
**/.npmrc
.git
compose*.y*ml
DOCKERIGNORE
    docker build -f "$QAPP/Dockerfile.e2e" -t "$QAPP_E2E_IMAGE" "$QAPP" \
      > "$WORK/.sql-$MOTEUR-e2e-build.out" 2>&1 \
      || { tail -40 "$WORK/.sql-$MOTEUR-e2e-build.out"; fail "construction de l'image sœur de test ($MOTEUR)"; }
    # Un `.dockerignore` dédié qui ne serait PAS pris en compte donnerait une
    # image sans `tests/`, et la suite « passerait » en ne jouant rien.
    docker run --rm "$QAPP_E2E_IMAGE" sh -c 'test -f tests/e2e.setup.ts' \
      || fail "l'image sœur n'a pas tests/ — le .dockerignore dédié n'a pas été pris en compte, la suite ne jouerait rien"
    ok "image sœur $QAPP_E2E_IMAGE bâtie sur $ALPINE_BASE, tests/ présents"

    step "[sql:$MOTEUR] la suite e2e générée, JOUÉE DANS Alpine et par le nom de service"
    SQL_NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' \
      "$QAPP_NAME-app" 2>/dev/null || true)
    [ -n "$SQL_NET" ] || fail "réseau du compose introuvable pour $QAPP_NAME-app"
    # `NF_E2E_BASE_URL` : la suite ne démarre alors rien et ne touche aucune
    # base — elle mesure le déploiement qui tourne. L'adresse est le NOM du
    # service `app` et son port INTERNE (5151), pas le port publié sur l'hôte :
    # c'est ce qui fait de ce run une seconde preuve de résolution, cette fois
    # depuis un conteneur tiers.
    docker run --rm --network "$SQL_NET" \
      -e NF_E2E_BASE_URL="http://app:5151" \
      "$QAPP_E2E_IMAGE" npm run test:e2e > "$WORK/.sql-$MOTEUR-e2e.out" 2>&1 \
      || { tail -40 "$WORK/.sql-$MOTEUR-e2e.out"; fail "suite e2e DANS Alpine ($MOTEUR)"; }
    # Un run qui ne joue AUCUN test sort en 0 : le compte se lit, il ne se
    # suppose pas. Et les migrations se sautent délibérément en cible externe —
    # le banc le DIT plutôt que de laisser croire à une couverture complète.
    # 🔴 DÉPOUILLER LES CODES ANSI AVANT DE LIRE. vitest colorise sa sortie même
    # redirigée dans un fichier : entre « Tests » et le chiffre se glissent des
    # séquences d'échappement, et un motif écrit sur le texte VISIBLE ne mord
    # pas. Vécu ici : la suite était verte (4 passés, 12 sautés) et le banc a
    # annoncé « aucun test joué ». C'est le banc qui lisait mal, pas la suite
    # qui se taisait.
    SQL_E2E_LINE=$(sed $'s/\033\[[0-9;]*m//g' "$WORK/.sql-$MOTEUR-e2e.out" \
      | grep -E "Tests +[0-9]+ (passed|failed)" | tail -1 || true)
    [ -n "$SQL_E2E_LINE" ] \
      || { tail -25 "$WORK/.sql-$MOTEUR-e2e.out"; fail "la suite e2e n'annonce aucun test joué ($MOTEUR)"; }
    ok "e2e sous musl, via http://app:5151 — $SQL_E2E_LINE"
    ok "  (les cas « migrations » se sautent en cible externe : c'est le contrat de NF_E2E_BASE_URL)"

    # ── LA GARDE, VUE MORDRE ─────────────────────────────────────────────────
    # Une fois, sur le premier moteur : ce qu'on débranche est la RÉSOLUTION DE
    # NOM, qui ne dépend d'aucun dialecte. On pointe la base sur un nom qui
    # n'existe pas sur le réseau et l'on constate que la tâche de migration
    # tombe — sans quoi les étapes ci-dessus passeraient de toute façon, et ne
    # prouveraient rien de musl.
    if [ "$MOTEUR" = "$SQL_FIRST" ]; then
      step "[sql:$MOTEUR] garde vue mordre — un nom qui ne résout pas fait tomber la migration"
      BAD_URL=${SURL/@$SERVICE:/@nexistepas-$SERVICE:}
      cat > "$QAPP/compose.degraded.yaml" <<YML
# Débranchement DÉLIBÉRÉ du banc : la base est désignée par un nom introuvable.
services:
  migrate:
    environment:
      NF_DATABASE_URL: "$BAD_URL"
YML
      (cd "$QAPP" && docker compose -f compose.yaml -f compose.override.yaml \
          -f compose.degraded.yaml --profile app run --rm --no-deps migrate) \
        > "$WORK/.sql-degraded.out" 2>&1 \
        && { tail -20 "$WORK/.sql-degraded.out"; \
             fail "la migration RÉUSSIT avec un nom introuvable — les étapes de résolution ne prouvent rien"; }
      ok "migration en échec sur « nexistepas-$SERVICE » : la résolution EST le maillon mesuré"
      rm -f "$QAPP/compose.degraded.yaml"
    fi

    step "[sql:$MOTEUR] down -v — le décor est rangé, volumes compris"
    (cd "$QAPP" && docker compose --profile app down -v) > "$WORK/.sql-$MOTEUR-down.out" 2>&1 \
      || { tail -20 "$WORK/.sql-$MOTEUR-down.out"; fail "docker compose --profile app down -v ($MOTEUR)"; }
    docker rmi -f "$QAPP_E2E_IMAGE" >/dev/null 2>&1 || true
    COMPOSE_DIR=""
    ok "$MOTEUR : décor rangé (une base survivante fausserait le moteur suivant)"
  done

  ok "TROIS moteurs serveurs éprouvés sous musl : postgres, mariadb, mysql"
fi

cleanup
echo ""
echo "SMOKE RELEASE + DOCKER : PREUVE COMPLÈTE ✓  (scénario: $SCENARIO)"
echo "  tarballs installables · types certifiés · scaffolder publié · apps GÉNÉRÉES"
