#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# La requête d'un banc — UNE implémentation, sourcée par `bench-ab-mono.sh`
# (camp Nodefony) ET `bench-frameworks/bench.sh` (camps témoins).
#
# Pourquoi partagée : un POST envoyé avec un corps à un camp et sans corps à
# l'autre (ou avec un autre `Content-Type`) ne compare plus le même travail, et
# rien ne le dirait — les deux répondraient 200.
#
# Entrées (env) :
#   BENCH_METHOD  méthode HTTP (défaut GET)
#   BENCH_BODY    corps JSON (pose `Content-Type: application/json`)
#   BENCH_HEADER  un en-tête supplémentaire (ex. cookie d'une route authentifiée)
# Sorties : tableaux WRK_REQ (arguments de wrk) et CURL_REQ (arguments de curl),
# éventuellement vides — les développer par `${A[@]+"${A[@]}"}` (bash 3.2 de
# macOS + `set -u` rejette l'expansion d'un tableau vide).
# ─────────────────────────────────────────────────────────────────────────────
bench_request_args() {
  WRK_REQ=()
  CURL_REQ=()
  if [ -n "${BENCH_HEADER:-}" ]; then
    WRK_REQ+=(-H "$BENCH_HEADER")
    CURL_REQ+=(-H "$BENCH_HEADER")
  fi
  local method="${BENCH_METHOD:-GET}"
  if [ "$method" = "GET" ] && [ -z "${BENCH_BODY:-}" ]; then
    return 0
  fi
  # wrk ne pose méthode et corps que par un script Lua. Chaîne longue `[==[ ]==]` :
  # le JSON y passe sans échappement.
  local lua="${TMPDIR:-/tmp}/nf-bench-request.$$.lua"
  {
    echo "wrk.method = \"$method\""
    if [ -n "${BENCH_BODY:-}" ]; then
      echo "wrk.body = [==[${BENCH_BODY}]==]"
      echo 'wrk.headers["Content-Type"] = "application/json"'
    fi
  } > "$lua"
  WRK_REQ+=(-s "$lua")
  CURL_REQ+=(-X "$method")
  if [ -n "${BENCH_BODY:-}" ]; then
    CURL_REQ+=(-H "Content-Type: application/json" --data "$BENCH_BODY")
  fi
}
