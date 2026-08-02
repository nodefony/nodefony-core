#!/usr/bin/env bash
# Smoke test release (modèle B) + preuve Dockerfile/graceful shutdown.
#
# Le décor est GÉNÉRÉ, il n'est plus copié : le scaffolder est installé depuis
# le tarball, et c'est LUI qui produit l'application témoin. Le smoke éprouve
# donc ce qu'un utilisateur reçoit réellement — y compris que `templates/` est
# bien publié dans le paquet, ce qu'aucun test du dépôt ne peut voir.
#
# Enchaîne : pack → attw → scaffolder installé du tarball → `create app` →
# décor (route lente) → deps réécrites vers les tarballs → docker build
# (install VIERGE) → docker run → asserts :
#   1. /readyz + /livez → 200
#   2. /api/hello → 200 {"hello":…}, servi par un process de PID 1
#   3. docker stop PENDANT /api/slow (2 s) → la requête FINIT (200 slow:done),
#      le container sort en exit 0, les logs montrent le drain (SHUTDOWN).
#
# Usage (racine repo) : bash .claude/skills/nodefony-release/scripts/smoke-docker.sh
# Prérequis : npm run build (dist à jour) + docker daemon up.
set -euo pipefail

# Quatre niveaux : scripts → nodefony-release → skills → .claude → racine.
# Le compte se VÉRIFIE au lieu de se supposer : déplacer ce script d'un dossier
# le décalait en silence, et le seul symptôme était un chemin doublé
# (`.claude/skills/.claude/skills/…`) au premier `node`.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
[[ -f "$ROOT/package.json" && -d "$ROOT/.claude" ]] ||
  { echo "✗ racine du dépôt introuvable depuis ${BASH_SOURCE[0]} (ROOT=$ROOT)" >&2; exit 1; }

# HORS du repo : dedans, la résolution node/TS remonterait aux node_modules
# racine (symlinks workspaces → SOURCES du repo) → faux environnement vierge.
WORK="${TMPDIR:-/tmp}/nodefony-smoke-app"
SCAFFOLDER="$WORK/scaffolder"   # le paquet `nodefony` installé DEPUIS son tarball
APP="$WORK/app"                 # l'application générée par ce scaffolder
APP_NAME="smokeapp"
IMG="nodefony-smoke-app:smoke"
CTN="nf-smoke"
PORT=15151

# ── Étapes NOMMÉES : un échec doit dire lequel des maillons a lâché. Un
#    « docker build KO » qui vient en fait d'un scaffold muet envoie chercher
#    la panne dans les tarballs pendant que le générateur est en cause.
STEP="init"
step() { STEP="$1"; echo ""; echo "── $1 ──────────────────────────────────────"; }
fail() { echo "" >&2; echo "✗ ÉCHEC à l'étape « $STEP » : $1" >&2; docker rm -f "$CTN" >/dev/null 2>&1 || true; exit 1; }
ok() { echo "✓ $1"; }

# ── 1. Pack (bascule exports.types + peers optional + .d.ts extensionnés) ────
step "pack — 14 tarballs depuis les workspaces"
node "$ROOT/.claude/skills/nodefony-release/scripts/pack-all.mjs" || fail "pack-all.mjs"
ok "tarballs écrits dans release/tarballs/"

# ── 2. Gate attw : types du tarball certifiés sous node16-ESM + bundler ──────
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

# ── 3. Le scaffolder vient du TARBALL, pas du checkout ──────────────────────
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

# ── 4. L'application témoin est GÉNÉRÉE ─────────────────────────────────────
step "create app — l'application témoin est générée, plus copiée"
"$NODEFONY_BIN" create app "$APP_NAME" --dir "$APP" --yes \
  --preset minimal --frontend none --no-install --no-git > "$WORK/.scaffold.out" 2>&1 \
  || { tail -30 "$WORK/.scaffold.out"; fail "nodefony create app"; }
# Ce que le scaffold DOIT avoir posé pour que la suite prouve quelque chose.
# Sans ces gardes, un gabarit disparu ferait échouer `docker build` avec un
# message qui accuserait les tarballs.
for f in Dockerfile .dockerignore package.json index.ts nodefony.config.ts; do
  [[ -f "$APP/$f" ]] || fail "l'app générée n'a pas de $f — gabarit absent du tarball ?"
done
grep -q '^CMD \["' "$APP/Dockerfile" || fail "Dockerfile généré sans CMD en forme exec"
ok "app générée dans $APP (Dockerfile + .dockerignore inclus)"

# ── 5. Décor : une route LENTE, pour éprouver le drain ───────────────────────
# Le controller est créé par la commande (qui pose aussi le câblage
# `@controllers([...])` — édition qu'on ne veut PAS faire à la main), puis son
# CORPS est réécrit en entier : aucune insertion textuelle dans un fichier
# généré, donc aucune ancre à maintenir.
# `create controller` est IN-PROJECT : il remonte au `nodefony.config.ts` le
# plus proche. Lancé depuis la racine du dépôt, il écrirait DANS LE DÉPÔT —
# d'où le sous-shell qui l'ancre dans l'app témoin.
step "décor — route /api/slow (create controller + corps réécrit)"
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

# ── 6. Deps → tarballs (installation vierge dans l'image) ───────────────────
step "deps — réécriture vers les tarballs locaux"
cp -R "$ROOT/release/tarballs" "$APP/tarballs"
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
console.log("deps réécrites vers les tarballs :", n);
' "$APP" || fail "réécriture des dépendances"

# ── 7. Build de l'image, avec le Dockerfile GÉNÉRÉ ──────────────────────────
step "docker build — image depuis le Dockerfile généré"
docker build -t "$IMG" "$APP" || fail "docker build (install vierge ou build de l'app KO)"
ok "image construite (npm install vierge depuis les tarballs)"

# ── 8. Run + probes ─────────────────────────────────────────────────────────
step "run — sondes de l'orchestrateur"
docker rm -f "$CTN" >/dev/null 2>&1 || true
docker run -d --name "$CTN" -p "$PORT:5151" "$IMG" >/dev/null
CODE=""
for _ in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/readyz" || true)
  [ "$CODE" = "200" ] && break
  sleep 1
done
[ "$CODE" = "200" ] || { docker logs "$CTN" 2>&1 | tail -30; fail "readyz jamais 200 après 60 s (reçu: $CODE)"; }
ok "readyz → 200 (boot complet)"

LIVEZ=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/livez")
[ "$LIVEZ" = "200" ] || fail "livez → $LIVEZ"
ok "livez → 200"

HELLO=$(curl -s "http://127.0.0.1:$PORT/api/hello")
echo "$HELLO" | grep -q '"hello"' || fail "hello KO : $HELLO"
ok "/api/hello → $HELLO"

# La forme exec du CMD se CONSTATE ici, elle ne se déduit pas du fichier : en
# forme shell, /bin/sh serait PID 1 et node porterait un autre numéro — le seul
# signe observable avant que le drain ne manque à l'appel.
echo "$HELLO" | grep -q '"pid":1' || fail "node n'est PAS PID 1 (forme shell du CMD ?) : $HELLO"
ok "node est PID 1 (forme exec constatée, pas supposée)"

# ── 9. Graceful : docker stop PENDANT une requête lente ─────────────────────
step "graceful — docker stop pendant une requête en vol"
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
echo ""
echo "SMOKE RELEASE + DOCKER : PREUVE COMPLÈTE ✓"
echo "  tarballs installables · types certifiés · scaffolder publié · app GÉNÉRÉE"
echo "  buildée et drainée dans un container (node PID 1, exit 0)"
