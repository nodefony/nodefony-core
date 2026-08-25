#!/usr/bin/env bash
# Smoke test release (modèle B) + preuve Dockerfile/graceful shutdown/frontend.
#
# Le décor est GÉNÉRÉ, il n'est plus copié : le scaffolder est installé depuis
# le tarball, et c'est LUI qui produit les applications témoins. Le smoke
# éprouve donc ce qu'un utilisateur reçoit réellement — y compris que
# `templates/` est bien publié dans le paquet, ce qu'aucun test du dépôt ne
# peut voir.
#
# TROIS scénarios, sélectionnables :
#
#   base   — app minimale sans front : sondes, node PID 1, drain au SIGTERM
#   front  — app à frontend React : tags `/_assets/…` servis, et les DEUX
#            issues d'un `public/dist` absent (reconstruit au boot quand vite
#            est là ; ERROR nommée + API toujours servie quand il ne l'est pas)
#   studio — preset complet, Studio en `mandatory` : l'UI pré-buildée du paquet
#            est servie (un 404 ici = `dist/frontend` absent du tarball)
#
# Usage (racine repo) :
#   npm run release:smoke -- [--scenario all|base|front|studio]
# Prérequis : npm run build (dist à jour) + docker daemon up.
set -euo pipefail

SCENARIO="all"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario) SCENARIO="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "option inconnue : $1" >&2; exit 64 ;;
  esac
done
case "$SCENARIO" in all|base|front|studio) ;; *) echo "scénario inconnu : $SCENARIO" >&2; exit 64 ;; esac
runs() { [[ "$SCENARIO" == "all" || "$SCENARIO" == "$1" ]]; }

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
step() { STEP="$1"; echo ""; echo "── $1 ──────────────────────────────────────"; }
cleanup() { for c in $CONTAINERS; do docker rm -f "$c" >/dev/null 2>&1 || true; done; }
fail() { echo "" >&2; echo "✗ ÉCHEC à l'étape « $STEP » : $1" >&2; cleanup; exit 1; }
ok() { echo "✓ $1"; }

# ═══ Briques partagées par les scénarios ════════════════════════════════════

# Génère une application témoin. Les gardes qui suivent ne sont pas du zèle :
# sans elles, un gabarit disparu ferait échouer `docker build` avec un message
# qui accuserait les tarballs.
scaffold_app() { # nom dir preset frontend
  local name="$1" dir="$2" preset="$3" front="$4"
  "$NODEFONY_BIN" create app "$name" --dir "$dir" --yes \
    --preset "$preset" --frontend "$front" --no-install --no-git > "$WORK/.scaffold-$name.out" 2>&1 \
    || { tail -30 "$WORK/.scaffold-$name.out"; fail "nodefony create app ($preset/$front)"; }
  local f
  for f in Dockerfile .dockerignore package.json index.ts nodefony.config.ts; do
    [[ -f "$dir/$f" ]] || fail "l'app générée n'a pas de $f — gabarit absent du tarball ?"
  done
  grep -q '^CMD \["' "$dir/Dockerfile" || fail "Dockerfile généré sans CMD en forme exec"
  ok "app « $name » générée ($preset / front=$front)"
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

build_image() { # dir tag
  docker build -t "$2" "$1" || fail "docker build ($2)"
  ok "image $2 construite (npm install vierge depuis les tarballs)"
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

http_code() { curl -s -o /dev/null -w "%{http_code}" "$1" || true; }

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
  wait_ready "$CTN" "$PORT"
  ok "readyz → 200 (boot complet)"

  LIVEZ=$(http_code "http://127.0.0.1:$PORT/livez")
  [ "$LIVEZ" = "200" ] || fail "livez → $LIVEZ"
  ok "livez → 200"

  HELLO=$(curl -s "http://127.0.0.1:$PORT/api/hello")
  echo "$HELLO" | grep -q '"hello"' || fail "hello KO : $HELLO"
  ok "/api/hello → $HELLO"

  # La forme exec du CMD se CONSTATE ici, elle ne se déduit pas du fichier : en
  # forme shell, /bin/sh serait PID 1 et node porterait un autre numéro — le
  # seul signe observable avant que le drain ne manque à l'appel.
  echo "$HELLO" | grep -q '"pid":1' || fail "node n'est PAS PID 1 (forme shell du CMD ?) : $HELLO"
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

  docker logs "$CTN" 2>&1 | grep -q "SHUTDOWN" || fail "logs sans trace du drain (SHUTDOWN)"
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
  echo "$BODY" | grep -q "/_assets/" \
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
  echo "$BODY" | grep -q "/_assets/" \
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
  # `public/dist` effacé DANS le conteneur : on reproduit une image bâtie sans
  # build front, sans avoir à en construire une seconde.
  docker run -d --name "$FCTN" -p "$FPORT:5151" --entrypoint sh "$FIMG" \
    -c 'rm -rf public/dist && exec node_modules/.bin/nodefony production' >/dev/null
  wait_ready "$FCTN" "$FPORT"
  docker logs "$FCTN" 2>&1 | grep -q "vite indisponible" \
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

  # Le gabarit déclare déjà `ui: "static"` ; seule la policy change. Studio est
  # `dev` par défaut (0 coût en production), or c'est justement en production
  # qu'on veut savoir si son UI publiée est servie.
  step "[studio] policy dev → mandatory"
  node -e '
const fs = require("node:fs");
const f = process.argv[1] + "/nodefony.config.ts";
const src = fs.readFileSync(f, "utf8");
const lines = src.split("\n");
const i = lines.findIndex((l) => l.includes("@nodefony/studio"));
if (i < 0) { throw new Error("ligne @nodefony/studio introuvable dans le manifeste généré"); }
if (!lines[i].includes("policy: \"dev\"")) { throw new Error("policy attendue `dev` : " + lines[i].trim()); }
lines[i] = lines[i].replace("policy: \"dev\"", "policy: \"mandatory\"");
fs.writeFileSync(f, lines.join("\n"));
process.stdout.write("studio → mandatory\n");
' "$SAPP" || fail "bascule de la policy Studio"
  ok "Studio passé en mandatory (ui: static déjà posé par le gabarit)"

  step "[studio] deps + image"
  rewrite_deps "$SAPP"
  build_image "$SAPP" "$SIMG"

  step "[studio] run — l'UI publiée est-elle servie ?"
  docker rm -f "$SCTN" >/dev/null 2>&1 || true
  docker run -d --name "$SCTN" -p "$SPORT:5151" "$SIMG" >/dev/null
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

cleanup
echo ""
echo "SMOKE RELEASE + DOCKER : PREUVE COMPLÈTE ✓  (scénario: $SCENARIO)"
echo "  tarballs installables · types certifiés · scaffolder publié · apps GÉNÉRÉES"
