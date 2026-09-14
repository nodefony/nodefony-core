#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Comparer DEUX camps en PAIRES ALTERNÉES — et refuser de conclure sous le bruit.
#
# Pourquoi ce script existe : la méthode des paires alternées était ÉCRITE (en-tête
# de bench-ab-mono.sh, skill nodefony-load-test) et personne ne l'appliquait — il
# fallait taper soi-même `A1 ; B1 ; A2 ; B2` et comparer les médianes à l'œil.
# Vécu le 2026-09-14 : cinq camps mesurés en séries SÉQUENTIELLES étalées sur une
# heure, pendant que la machine chauffait et se libérait des outils de la session.
# Chaque série était propre isolément (dispersion ≤ 3 %) et le RATIO entre deux
# camps, lui, ne valait rien. Une règle en prose n'est appliquée que si un automate
# la relit.
#
# Ce qu'il ajoute à bench.sh, et rien d'autre :
#   1. l'ALTERNANCE  A1 → B1 → A2 → B2 (la dérive thermique porte alors sur les
#      deux camps de la même façon, au lieu d'avantager celui qui passe en premier) ;
#   2. un verdict de SÉPARATION : un écart n'est retenu que si les deux séries d'un
#      camp sont TOUTES DEUX du même côté des deux séries de l'autre. Deux nuages
#      qui se chevauchent ne se classent pas, quelle que soit la distance des médianes ;
#   3. la garde « installé == déclaré » (cf § plus bas).
#
# Usage :
#   bash bench-pairs.sh <campA> <campB> [PORT]
#   BENCH_CONN=64 BENCH_WARMUP=10 bash bench-pairs.sh express-fair nodefony
#
# Les variables de bench.sh (BENCH_CONN, BENCH_DUR, BENCH_THREADS, BENCH_WARMUP,
# BENCH_THERM_TARGET) sont transmises telles quelles — un warmup donné à l'un et
# pas à l'autre inverse un classement serré.
# ─────────────────────────────────────────────────────────────────────────────
set -u
export LC_ALL=C # locale fr : « 4,1 » casse toute comparaison numérique

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
A="${1:?usage: bench-pairs.sh <campA> <campB> [port]}"
B="${2:?usage: bench-pairs.sh <campA> <campB> [port]}"
PORT="${3:-5161}"

# ── Garde : l'INSTALLÉ doit correspondre au DÉCLARÉ ──────────────────────────
# Un banc comparatif dont les concurrents dérivent en silence attribue au produit
# des écarts qui ne sont pas les siens. Vécu le 2026-09-14 : le package.json
# déclarait `fastify: ^5.12.4`, node_modules servait 5.8.5 — et ces deux versions
# de fastify sont séparées de 29 % de débit. L'écart avait été imputé à la machine.
verifier_versions() {
  local manquant=0
  local declares
  declares=$(node -e '
    const d = require("'"$DIR"'/package.json").dependencies || {};
    for (const [n, r] of Object.entries(d)) console.log(n, r);
  ' 2>/dev/null) || return 0
  while read -r nom plage; do
    [ -z "$nom" ] && continue
    local pose
    pose=$(node -e '
      try { console.log(require("'"$DIR"'/node_modules/'"$nom"'/package.json").version) }
      catch { console.log("ABSENT") }
    ' 2>/dev/null)
    # `semver` n'est pas garanti présent : on délègue la comparaison à npm, qui
    # sait lire une plage, et on ne bloque QUE sur un désaccord constaté.
    local ok
    ok=$(node -e '
      const s = (()=>{ try { return require("semver") } catch { return null } })();
      const [p, v] = ["'"$plage"'", "'"$pose"'"];
      if (v === "ABSENT") return console.log("non");
      if (!s) return console.log("inconnu");
      console.log(s.satisfies(v, p) ? "oui" : "non");
    ' 2>/dev/null)
    if [ "$ok" = "non" ]; then
      echo "  ✖ $nom : installé $pose, déclaré $plage"
      manquant=1
    fi
  done <<<"$declares"
  if [ "$manquant" = "1" ]; then
    echo ""
    echo "❌ Le sandbox ne sert pas ce qu'il déclare — la mesure porterait sur"
    echo "   un décor que personne ne peut reproduire. Lancer : (cd $DIR && npm install)"
    exit 1
  fi
}
echo "── contrôle du décor ──"
verifier_versions
echo "  ✓ node_modules conforme au package.json"
echo ""

# ── Les quatre séries, ALTERNÉES ─────────────────────────────────────────────
# `nodefony` n'est pas un `.mjs` de ce dossier : c'est le VRAI serveur, et il se
# lance par `bench-ab-mono.sh`. Sans ce routage, `bench-pairs.sh express-fair
# nodefony` — l'exemple même que le skill documente, et la comparaison qui motive
# le banc — mourait au spawn sur un `nodefony.mjs` qui n'existe pas. L'alternance
# était donc imposée à tous les camps SAUF à celui qu'on mesure.
#
# ÉQUITÉ : les deux camps doivent taper la MÊME route. Les apps `.mjs` répliquent
# `/nodefony/test/als-test/state` ; côté produit cette route vient d'un module
# `policy:"dev"`, absent en production — d'où la dérogation, MINUTÉE par le
# framework (TTL), qu'on règle assez large pour couvrir les quatre séries.
mesurer() { # camp, rang → rend la médiane, ou vide si le banc a refusé
  local camp="$1" rang="$2"
  if [ "$camp" = "nodefony" ]; then
    BENCH_URL="${NODEFONY_URL:-http://127.0.0.1:5151/nodefony/test/als-test/state}" \
      bash "$DIR/../scripts/bench-ab-mono.sh" nodefony \
      NF_WITH_DEV_MODULES=1 NF_WITH_DEV_MODULES_TTL_MIN="${NODEFONY_TTL_MIN:-120}" \
      >/dev/null 2>&1
  else
    bash "$DIR/bench.sh" "$camp" "$PORT" >/dev/null 2>&1
  fi
  local med="/tmp/nf-bench-$camp.med"
  if [ -f "$med" ]; then
    cat "$med"
    mv "$med" "/tmp/nf-bench-$camp-p$rang.med" 2>/dev/null
    [ -f "/tmp/nf-bench-$camp.json" ] &&
      mv "/tmp/nf-bench-$camp.json" "/tmp/nf-bench-$camp-p$rang.json"
  fi
}

echo "── paires alternées : $A ↔ $B ──"
A1=$(mesurer "$A" 1); echo "  $A  série 1 : ${A1:-REFUSÉE (dispersion)}"
B1=$(mesurer "$B" 1); echo "  $B  série 1 : ${B1:-REFUSÉE (dispersion)}"
A2=$(mesurer "$A" 2); echo "  $A  série 2 : ${A2:-REFUSÉE (dispersion)}"
B2=$(mesurer "$B" 2); echo "  $B  série 2 : ${B2:-REFUSÉE (dispersion)}"
echo ""

if [ -z "$A1" ] || [ -z "$A2" ] || [ -z "$B1" ] || [ -z "$B2" ]; then
  echo "❌ INCONCLUSIF — au moins une série a été refusée pour dispersion."
  echo "   Laisser la machine refroidir (BENCH_THERM_TARGET plus bas) et rejouer."
  echo "   Ne PAS retenir les séries survivantes : une paire incomplète ne se compare pas."
  exit 2
fi

# ── Verdict : SÉPARATION, jamais un simple écart de médianes ─────────────────
node -e '
const [a1, b1, a2, b2, A, B] = process.argv.slice(1);
const a = [ +a1, +a2 ].sort((x, y) => x - y);
const b = [ +b1, +b2 ].sort((x, y) => x - y);
const medA = (a[0] + a[1]) / 2, medB = (b[0] + b[1]) / 2;
const ecart = ((medA / medB - 1) * 100);
const separe = a[0] > b[1] || b[0] > a[1];
const spread = (v) => ((v[1] / v[0] - 1) * 100).toFixed(1);
console.log(`  ${A} : ${a[0].toFixed(0)} … ${a[1].toFixed(0)}  (écart inter-séries ${spread(a)} %)`);
console.log(`  ${B} : ${b[0].toFixed(0)} … ${b[1].toFixed(0)}  (écart inter-séries ${spread(b)} %)`);
console.log("");
console.log(`  rapport ${A}/${B} : ${(medA / medB * 100).toFixed(1)} %  (${ecart >= 0 ? "+" : ""}${ecart.toFixed(1)} %)`);
console.log("");
if (separe) {
  console.log(`  ✅ SÉPARATION NETTE — les deux séries de ${medA > medB ? A : B} sont au-dessus`);
  console.log("     des deux séries de l’autre. Le classement tient.");
} else {
  console.log("  ⚠ DANS LE BRUIT — les deux nuages se CHEVAUCHENT.");
  console.log("     Le rapport ci-dessus est affiché pour information, il ne CLASSE rien.");
  console.log("     Un écart de médianes sans séparation des séries n’est pas un résultat.");
  process.exitCode = 3;
}
' "$A1" "$B1" "$A2" "$B2" "$A" "$B"
