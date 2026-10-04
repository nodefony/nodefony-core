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
. "$DIR/../scripts/bench-out.sh"
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
    # 🔴 Le verdict se lit en FERMÉ : seul « oui » passe. La garde a longtemps
    # accepté tout le reste — un `return` au niveau racine d'un `node -e`, que
    # Node 26 refuse (« Illegal return statement »), rendait une sortie VIDE,
    # masquée par `2>/dev/null`, et le vide passait pour conforme. Elle n'a
    # alors mordu sur RIEN, et rien ne le signalait (#489).
    ok=$(node -e '
      console.log((() => {
        const s = (()=>{ try { return require("semver") } catch { return null } })();
        const [p, v] = ["'"$plage"'", "'"$pose"'"];
        if (v === "ABSENT") return "non";
        if (!s) return "inconnu";
        return s.satisfies(v, p) ? "oui" : "non";
      })());
    ' 2>&1)
    if [ "$ok" != "oui" ]; then
      echo "  ✖ $nom : installé $pose, déclaré $plage (verdict : ${ok:-vide})"
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
  # La sortie de chaque série se GARDE : jetée, un échec autre que la dispersion
  # (boot, cible, sonde, erreurs wrk) s'affichait « REFUSÉE (dispersion) » sans
  # aucune trace pour le diagnostiquer.
  local log="$NF_BENCH_OUT/nf-bench-$camp-p$rang.log"
  if [ "$camp" = "nodefony" ]; then
    BENCH_URL="${NODEFONY_URL:-http://127.0.0.1:5151/nodefony/test/als-test/state}" \
      bash "$DIR/../scripts/bench-ab-mono.sh" nodefony \
      NF_WITH_DEV_MODULES=1 NF_WITH_DEV_MODULES_TTL_MIN="${NODEFONY_TTL_MIN:-120}" \
      >"$log" 2>&1
  elif [ "$camp" = "nodefony-orm" ]; then
    # Le cas APPLICATIF : une lecture et une écriture par requête, sur le corpus
    # seedé (`NF_BENCH_ORM=1`). Même route, même travail que `express-fair-sqlite` —
    # la MÊME `BENCH_PATH` que le camp témoin (ex. `…/read-write-body` en POST,
    # avec `BENCH_METHOD`/`BENCH_BODY`, transmis aux deux par l'environnement).
    BENCH_URL="http://127.0.0.1:5151${BENCH_PATH:-/nodefony/test/bench-orm/read-write}" \
      bash "$DIR/../scripts/bench-ab-mono.sh" nodefony-orm \
      NF_BENCH_ORM=1 NF_WITH_DEV_MODULES=1 \
      NF_WITH_DEV_MODULES_TTL_MIN="${NODEFONY_TTL_MIN:-120}" \
      >"$log" 2>&1
  else
    bash "$DIR/bench.sh" "$camp" "$PORT" >"$log" 2>&1
  fi
  # La preuve d'un refus se range comme une mesure : sans rang, la série 2
  # écraserait le diagnostic de la série 1 et on rejouerait sans rien savoir.
  [ -f "$NF_BENCH_OUT/nf-bench-$camp.refused.json" ] &&
    mv "$NF_BENCH_OUT/nf-bench-$camp.refused.json" "$NF_BENCH_OUT/nf-bench-$camp-p$rang.refused.json"
  local med="$NF_BENCH_OUT/nf-bench-$camp.med"
  # Ni médiane ni preuve de refus : la série a ÉCHOUÉ, ce n'est pas de la dispersion.
  [ -f "$med" ] || [ -f "$NF_BENCH_OUT/nf-bench-$camp-p$rang.refused.json" ] ||
    echo "ÉCHEC — voir $log" >&2
  if [ -f "$med" ]; then
    cat "$med"
    mv "$med" "$NF_BENCH_OUT/nf-bench-$camp-p$rang.med" 2>/dev/null
    [ -f "$NF_BENCH_OUT/nf-bench-$camp.json" ] &&
      mv "$NF_BENCH_OUT/nf-bench-$camp.json" "$NF_BENCH_OUT/nf-bench-$camp-p$rang.json"
  fi
}

# Une série sans médiane est REFUSÉE (preuve de dispersion rangée) ou en ÉCHEC
# (boot, cible, contenu, erreurs wrk). Les confondre coûte cher : vécu, un POST
# dont le banc attendait le contenu d'une autre route s'affichait « REFUSÉE
# (dispersion) », et la campagne rejouait trois fois une paire qui ne pouvait
# QUE échouer. Un échec sort en code 1 : rejouer ne le corrigera pas.
ECHEC=0
etat() { # camp rang médiane
  if [ -n "$3" ]; then echo "$3"
  elif [ -f "$NF_BENCH_OUT/nf-bench-$1-p$2.refused.json" ]; then echo "REFUSÉE (dispersion)"
  else ECHEC=1; echo "ÉCHEC — voir $NF_BENCH_OUT/nf-bench-$1-p$2.log"; fi
}
echo "── paires alternées : $A ↔ $B ──"
A1=$(mesurer "$A" 1); echo "  $A  série 1 : $(etat "$A" 1 "$A1")"; [ -n "$A1" ] || [ -f "$NF_BENCH_OUT/nf-bench-$A-p1.refused.json" ] || ECHEC=1
B1=$(mesurer "$B" 1); echo "  $B  série 1 : $(etat "$B" 1 "$B1")"; [ -n "$B1" ] || [ -f "$NF_BENCH_OUT/nf-bench-$B-p1.refused.json" ] || ECHEC=1
A2=$(mesurer "$A" 2); echo "  $A  série 2 : $(etat "$A" 2 "$A2")"; [ -n "$A2" ] || [ -f "$NF_BENCH_OUT/nf-bench-$A-p2.refused.json" ] || ECHEC=1
B2=$(mesurer "$B" 2); echo "  $B  série 2 : $(etat "$B" 2 "$B2")"; [ -n "$B2" ] || [ -f "$NF_BENCH_OUT/nf-bench-$B-p2.refused.json" ] || ECHEC=1
echo ""

if [ "$ECHEC" = 1 ]; then
  echo "❌ ÉCHEC DU BANC — au moins une série n'a rien mesuré (ni médiane, ni preuve de dispersion)."
  echo "   Lire le journal de la série : la cause est dans le décor, pas dans la machine."
  exit 1
fi

if [ -z "$A1" ] || [ -z "$A2" ] || [ -z "$B1" ] || [ -z "$B2" ]; then
  echo "❌ INCONCLUSIF — au moins une série a été refusée pour dispersion."
  echo "   Laisser la machine refroidir (BENCH_THERM_TARGET plus bas) et rejouer."
  echo "   Ne PAS retenir les séries survivantes : une paire incomplète ne se compare pas."
  exit 2
fi

# ── Verdict : SÉPARATION, jamais un simple écart de médianes ─────────────────
node -e '
const [a1, b1, a2, b2, A, B, minEffect] = process.argv.slice(1);
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
// Seuil d’effet minimal : la séparation seule ne suffit pas. Vécu au test nul —
// un camp contre LUI-MÊME a rendu 99,1 %, séries séparées : quand les séries
// sont serrées, le critère de séparation « classe » un écart que la résolution
// du banc (±3 %) ne permet pas d’affirmer. Le protocole publié exige les DEUX.
if (separe && Math.abs(ecart) < +minEffect) {
  console.log(`  ⚠ SÉPARÉ MAIS SOUS LA RÉSOLUTION — écart de ${Math.abs(ecart).toFixed(1)} % < ${minEffect} %.`);
  console.log("     Les séries ne se chevauchent pas, mais l’écart est plus petit que ce que");
  console.log("     ce banc sait affirmer. Il ne CLASSE rien (BENCH_MIN_EFFECT).");
  process.exitCode = 3;
} else if (separe) {
  console.log(`  ✅ SÉPARATION NETTE — les deux séries de ${medA > medB ? A : B} sont au-dessus`);
  console.log("     des deux séries de l’autre. Le classement tient.");
} else {
  console.log("  ⚠ DANS LE BRUIT — les deux nuages se CHEVAUCHENT.");
  console.log("     Le rapport ci-dessus est affiché pour information, il ne CLASSE rien.");
  console.log("     Un écart de médianes sans séparation des séries n’est pas un résultat.");
  process.exitCode = 3;
}
' "$A1" "$B1" "$A2" "$B2" "$A" "$B" "${BENCH_MIN_EFFECT:-3}"
