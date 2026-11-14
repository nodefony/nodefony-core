#!/usr/bin/env bash
# Monte le banc multi-pods : Redis + N applications générées, liées au framework
# local, configurées sur un bus commun. Idempotent : relancer ne casse rien.
#
#   bash scripts/setup.sh [dossier] [namespace]
#
# Puis : bash scripts/run.sh   (démarre les pods)
set -euo pipefail

# Racine du dépôt = deux niveaux au-dessus de .claude/skills/<skill>/scripts
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$HERE")"
ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
BENCH_DIR="${1:-$ROOT/tmp/bench/multipod}"
NAMESPACE="${2:-bench}"
APPS=(appalpha appbeta)

echo ">>> dépôt      : $ROOT"
echo ">>> banc       : $BENCH_DIR"
echo ">>> namespace  : $NAMESPACE"

# ── 1. Redis ────────────────────────────────────────────────────────────────
echo ">>> Redis (docker compose du dépôt)…"
(cd "$ROOT" && docker compose -f docker/docker-compose.yml up -d redis >/dev/null)
until docker exec nodefony-redis redis-cli -a nodefony-dev --no-auth-warning PING >/dev/null 2>&1; do
  sleep 1
done
echo "    Redis prêt (127.0.0.1:6379)"

mkdir -p "$BENCH_DIR"

for APP in "${APPS[@]}"; do
  APP_DIR="$BENCH_DIR/$APP"

  # ── 2. L'application ──────────────────────────────────────────────────────
  if [ ! -f "$APP_DIR/package.json" ]; then
    echo ">>> génération de ${APP}…"
    (cd "$BENCH_DIR" && npx nodefony create app "$APP" \
       --preset minimal --frontend none --link --yes >/dev/null)
  else
    echo ">>> $APP existe déjà — génération sautée"
  fi

  # ── 3. Les modules du banc (liés au dépôt, pas au registre npm) ───────────
  # Liens ABSOLUS : un lien relatif dépend du dossier depuis lequel on l'a créé,
  # et le banc peut vivre n'importe où.
  for MOD in realtime redis; do
    ln -sfn "$ROOT/src/packages/@nodefony/$MOD" "$APP_DIR/node_modules/@nodefony/$MOD"
    (cd "$APP_DIR" && npm pkg set \
       "dependencies.@nodefony/$MOD=file:$ROOT/src/packages/@nodefony/$MOD" >/dev/null)
  done

  # ── 4. Le module applicatif ───────────────────────────────────────────────
  if [ ! -d "$APP_DIR/modules/chat" ]; then
    echo ">>> module chat dans ${APP}…"
    (cd "$APP_DIR" && npx nodefony create module chat \
       --controller realtime --no-service --no-install --yes >/dev/null)
  fi
  # Le controller du banc remplace celui du scaffold (canal diffusable + routes
  # de pilotage). Source unique : references/controller.md.
  node "$HERE/lib/bench-files.mjs" controller "$SKILL_DIR/references/controller.md" \
       "$APP_DIR/modules/chat/nodefony/controllers/ChatController.ts"

  # ── 5. La configuration : redis PUIS realtime, avant le module applicatif ──
  node "$HERE/lib/bench-files.mjs" config "$APP_DIR/nodefony.config.ts" "$APP" "$NAMESPACE"

  # ── 6. Build ──────────────────────────────────────────────────────────────
  echo ">>> build de ${APP}…"
  (cd "$APP_DIR" && npm install >/dev/null 2>&1 && npm run build >/dev/null 2>&1)
done

# Les scripts de mesure, à côté des applications. `lib/` et `mempeak.sh` en
# font partie : les bancs de base (`db-*-pod.mjs`) importent `./lib/pod.mjs`,
# et sans eux ils tombent en ERR_MODULE_NOT_FOUND une fois le décor monté.
cp "$HERE"/*.mjs "$BENCH_DIR/"
cp "$HERE"/mempeak.sh "$BENCH_DIR/"
mkdir -p "$BENCH_DIR/lib"
cp "$HERE"/lib/*.mjs "$BENCH_DIR/lib/"

cat <<EOF

Banc prêt : $BENCH_DIR
  bash $SKILL_DIR/scripts/run.sh $BENCH_DIR $NAMESPACE   # démarre les 3 pods
EOF
