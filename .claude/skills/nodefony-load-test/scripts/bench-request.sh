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
#   BENCH_HEADER  un en-tête supplémentaire (ex. cookie d'une route authentifiée,
#                 `Sec-Fetch-Site: same-origin` pour qu'une mutation traverse la
#                 garde anti-falsification au lieu d'en être dispensée)
#   BENCH_EXPECT_STATUS  statut ATTENDU sous charge, quand ce n'est pas un 2xx
#                 (ex. 422 : le chemin d'erreur de la validation). wrk compte
#                 alors chaque réponse d'un autre statut et écrit
#                 « Unexpected status: N » — la preuve du travail pendant la
#                 mesure, que « Non-2xx » ne peut plus donner (#507).
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
  if [ "$method" = "GET" ] && [ -z "${BENCH_BODY:-}" ] && [ -z "${BENCH_EXPECT_STATUS:-}" ]; then
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
    if [ -n "${BENCH_EXPECT_STATUS:-}" ]; then
      # Un compteur PAR FIL (chaque fil wrk a son état Lua), sommé à la fin.
      # Déclarer `response` fait lire la réponse par wrk : coût égal pour tous
      # les camps, et seulement quand un statut non-2xx est attendu.
      cat <<LUA
local threads = {}
function setup(thread) table.insert(threads, thread) end
function init(args) unexpected = 0 end
function response(status, headers, body)
  if status ~= ${BENCH_EXPECT_STATUS} then unexpected = unexpected + 1 end
end
function done(summary, latency, requests)
  local n = 0
  for _, t in ipairs(threads) do n = n + t:get("unexpected") end
  io.write("Unexpected status: " .. n .. "\n")
end
LUA
    fi
  } > "$lua"
  WRK_REQ+=(-s "$lua")
  CURL_REQ+=(-X "$method")
  if [ -n "${BENCH_BODY:-}" ]; then
    CURL_REQ+=(-H "Content-Type: application/json" --data "$BENCH_BODY")
  fi
}

# Verdict de validité d'UN run wrk — partagé par les deux lanceurs, pour que le
# camp produit et les camps témoins soient jugés par la même règle.
# Entrée : la sortie complète de wrk. Sortie : le motif d'invalidité, vide si le
# run est valide.
#   · défaut : toute réponse hors 2xx/3xx, toute erreur de socket ;
#   · BENCH_EXPECT_STATUS posé : toute réponse d'un AUTRE statut (compteur Lua),
#     et l'absence du compteur elle-même — un script Lua qui n'a pas tourné ne
#     prouve rien.
bench_run_invalid() {
  local out="$1" errs
  errs=$(printf '%s' "$out" | grep "Socket errors" || true)
  if [ -n "${BENCH_EXPECT_STATUS:-}" ]; then
    local unexpected
    unexpected=$(printf '%s' "$out" | grep "Unexpected status:" | awk '{print $NF}')
    if [ -z "$unexpected" ]; then
      echo "compteur de statut absent${errs:+ · $errs}"
    elif [ "$unexpected" != "0" ] || [ -n "$errs" ]; then
      echo "$unexpected réponses hors ${BENCH_EXPECT_STATUS}${errs:+ · $errs}"
    fi
    return 0
  fi
  local non2xx
  non2xx=$(printf '%s' "$out" | grep "Non-2xx or 3xx responses" | awk '{print $NF}')
  if [ -n "$non2xx" ] || [ -n "$errs" ]; then
    echo "${non2xx:-0} réponses hors 2xx/3xx${errs:+ · $errs}"
  fi
}
