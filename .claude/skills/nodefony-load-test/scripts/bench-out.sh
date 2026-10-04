# shellcheck shell=bash
# Où les bancs écrivent leurs sorties (médianes `.med`, détails `.json`, séries
# refusées, relevés de sonde, journaux, pid) — SEULE définition, sourcée par
# bench-ab-mono.sh, bench-frameworks/bench.sh, bench-pairs.sh et perf-campaign.sh.
#
# Sous `tmp/bench/ab/` (catégorie `bench` de scripts/repo/tmp-layout.mjs), jamais
# dans le /tmp du système : un résultat qu'on relit n'a rien à faire dans le
# jetable d'un test, et il y survivait sans que rien ne le range ni ne le purge.
# Les noms de fichiers (`nf-bench-<label>.*`) ne changent pas ; seul le dossier.
#
# Exportée : les bancs se lancent les uns les autres, et le JavaScript embarqué
# (`node -e`) la lit par `process.env`. bench-out.mjs en porte le miroir
# JavaScript, et bench-out.test.mjs compare les deux défauts.
#
# @usage . "$(dirname "${BASH_SOURCE[0]}")/bench-out.sh"
# @env NF_BENCH_OUT  dossier des sorties (défaut : <racine du dépôt>/tmp/bench/ab)
: "${NF_BENCH_OUT:=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)/tmp/bench/ab}"
export NF_BENCH_OUT
mkdir -p "$NF_BENCH_OUT"
