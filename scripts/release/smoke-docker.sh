#!/usr/bin/env bash
# Smoke test release (modèle B) + preuve Dockerfile/graceful shutdown (Phase 0.7).
#
# Enchaîne : pack-all.mjs → app témoin copiée dans release/smoke-app (deps
# réécrites vers les tarballs) → docker build (npm install VIERGE + tsc = gate
# types des tarballs) → docker run → asserts :
#   1. /readyz + /livez → 200
#   2. /api/hello → 200 {"hello":"world"}
#   3. docker stop PENDANT /api/slow (2 s) → la requête FINIT (200 slow:done),
#      le container sort en exit 0, les logs montrent le drain (SHUTDOWN).
#
# Usage (racine repo) : bash scripts/release/smoke-docker.sh
# Prérequis : npm run build (dist à jour) + docker daemon up.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_SRC="$ROOT/examples/minimal-app"
# HORS du repo : dedans, la résolution node/TS remonterait aux node_modules
# racine (symlinks workspaces → SOURCES du repo) → faux environnement vierge.
WORK="${TMPDIR:-/tmp}/nodefony-smoke-app"
IMG="nodefony-minimal-app:smoke"
CTN="nf-smoke"
PORT=15151

fail() { echo "✗ $1" >&2; docker rm -f "$CTN" >/dev/null 2>&1 || true; exit 1; }
ok() { echo "✓ $1"; }

# ── 1. Pack (bascule exports.types + peers optional + .d.ts extensionnés) ────
node "$ROOT/scripts/release/pack-all.mjs"

# ── 1bis. Gate attw : types du tarball certifiés sous node16-ESM + bundler ───
# (profil esm-only : node10 et require() CJS ignorés — framework ESM-only).
# `nodefony/debugbar.js` = export d'ASSET (bundle standalone pour <script src>,
# consommé par URL, jamais importé en TS) → exclu de l'analyse de types.
echo ">>> attw (types des tarballs, profil esm-only)"
for tgz in "$ROOT"/release/tarballs/*.tgz; do
  EXCLUDE=""
  [[ "$(basename "$tgz")" == nodefony-10.* ]] && EXCLUDE="--exclude-entrypoints ./debugbar.js"
  # shellcheck disable=SC2086 — $EXCLUDE volontairement non quoté (0 ou 2 mots)
  npx --yes @arethetypeswrong/cli "$tgz" --profile esm-only $EXCLUDE > /dev/null 2>&1 \
    || { npx --yes @arethetypeswrong/cli "$tgz" --profile esm-only $EXCLUDE | tail -25; fail "attw KO sur $(basename "$tgz") — types publiés cassés"; }
done
ok "attw 13/13 (node16-ESM + bundler verts)"

# ── 2. App témoin → workdir, deps réécrites vers les tarballs ────────────────
rm -rf "$WORK"
mkdir -p "$WORK"
cp -R "$APP_SRC/." "$WORK/"
cp -R "$ROOT/release/tarballs" "$WORK/tarballs"
node -e '
const fs = require("node:fs");
const path = process.argv[1];
const manifest = JSON.parse(fs.readFileSync(path + "/tarballs/manifest.json", "utf8"));
const pkgPath = path + "/package.json";
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
for (const dep of Object.keys(pkg.dependencies)) {
  if (manifest[dep]) pkg.dependencies[dep] = "file:./tarballs/" + manifest[dep];
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log("deps réécrites :", JSON.stringify(pkg.dependencies, null, 1));
' "$WORK"

# ── 3. Build de l'image (install vierge + tsc DANS le stage build) ───────────
docker build -t "$IMG" "$WORK" || fail "docker build (npm install vierge ou tsc KO → pipeline release cassé)"
ok "image buildée (install vierge + tsc verts sur les tarballs)"

# ── 4. Run + probes ───────────────────────────────────────────────────────────
docker rm -f "$CTN" >/dev/null 2>&1 || true
docker run -d --name "$CTN" -p "$PORT:5151" "$IMG" >/dev/null
for i in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/readyz" || true)
  [ "$CODE" = "200" ] && break
  sleep 1
done
[ "$CODE" = "200" ] || { docker logs "$CTN" | tail -20; fail "readyz jamais 200 après 60 s (reçu: $CODE)"; }
ok "readyz → 200 (boot complet)"

LIVEZ=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/livez")
[ "$LIVEZ" = "200" ] || fail "livez → $LIVEZ"
ok "livez → 200"

HELLO=$(curl -s "http://127.0.0.1:$PORT/api/hello")
echo "$HELLO" | grep -q '"hello"' || fail "hello KO : $HELLO"
ok "/api/hello → $HELLO"

# ── 5. Graceful : docker stop PENDANT une requête lente ──────────────────────
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
[ "$EXITCODE" = "0" ] || fail "exit code container = $EXITCODE (attendu 0 = SIGTERM drainé, pas de SIGKILL)"
ok "container sorti exit 0 (graceful, sous la grace period)"

docker logs "$CTN" 2>&1 | grep -q "SHUTDOWN" || fail "logs sans trace du drain (SHUTDOWN)"
ok "logs : drain visible (SHUTDOWN serveurs)"

docker rm -f "$CTN" >/dev/null 2>&1 || true
echo ""
echo "SMOKE RELEASE + DOCKER : PREUVE COMPLÈTE ✓ (tarballs installables, types OK, graceful shutdown prouvé dans le container)"
