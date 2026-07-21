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
BENCH_DIR="${1:-$ROOT/tmp/bench}"
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
  # de pilotage). Source unique : reference/controller.md.
  python3 - "$SKILL_DIR/reference/controller.md" \
            "$APP_DIR/modules/chat/nodefony/controllers/ChatController.ts" <<'PY'
import re, sys, pathlib
doc, cible = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
bloc = re.search(r"```ts\n(.*?)```", doc.read_text(), re.S)
if not bloc:
    sys.exit("controller introuvable dans reference/controller.md")
cible.write_text(bloc.group(1))
PY

  # ── 5. La configuration : redis PUIS realtime, avant le module applicatif ──
  python3 - "$APP_DIR/nodefony.config.ts" "$APP" "$NAMESPACE" <<'PY'
import sys, pathlib
cfg, app, ns = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
s = cfg.read_text()
if "@nodefony/realtime" in s:
    print(f"    config de {app} déjà en place")
    raise SystemExit
ancre = f'  use("@{app}/chat", {{}}),'
if ancre not in s:
    raise SystemExit(f"ancre introuvable dans {cfg} — le scaffold a-t-il changé ?")
bloc = (
    "  // Banc multi-pods : bus partagé par toutes les applications du banc.\n"
    '  use("@nodefony/redis", {}),\n'
    '  use("@nodefony/realtime", {\n'
    "    backplane: {\n"
    '      driver: "redis",\n'
    "      // Cloison FORCÉE identique partout : on retire la séparation par nom\n"
    "      // d'application pour ne tester que l'authenticité des messages.\n"
    f'      namespace: "{ns}",\n'
    "    },\n"
    "  }),\n"
)
cfg.write_text(s.replace(ancre, bloc + ancre))
print(f"    config de {app} écrite")
PY

  # ── 6. Build ──────────────────────────────────────────────────────────────
  echo ">>> build de ${APP}…"
  (cd "$APP_DIR" && npm install >/dev/null 2>&1 && npm run build >/dev/null 2>&1)
done

# Les scripts de mesure, à côté des applications.
cp "$HERE"/*.mjs "$BENCH_DIR/"

cat <<EOF

Banc prêt : $BENCH_DIR
  bash $SKILL_DIR/scripts/run.sh $BENCH_DIR $NAMESPACE   # démarre les 3 pods
EOF
