#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# RÉGIME MACHINE — l'état du processeur au moment d'une mesure.
#
# Pourquoi ce fichier existe SÉPARÉMENT des bancs : le régime doit être relevé
# à l'identique par TOUS les camps d'une comparaison, sinon le décor du jeu de
# référence est renseigné pour l'un et muet pour l'autre — et c'est exactement
# ce qui rend un chiffre irreproductible. Deux copies de ces fonctions
# divergeraient en silence, chacune « juste » dans son propre banc.
#
# ⚡ Le thermal ne dit RIEN du plafond de fréquence, et c'est le piège le plus
# coûteux du banc : macOS active `lowpowermode` TOUT SEUL sur batterie
# (`pmset -g custom`), ce qui bride le Turbo Boost. Mesuré le 08-06 sur un code
# IDENTIQUE : 7 800 RPS sur batterie contre 12 600 sur secteur, soit ×1,62 —
# avec des dispersions intra-série PARFAITES des deux côtés (0,4 % et 1,6 %).
# Un CPU bridé tient un plafond bas sans effort : la fenêtre la plus STABLE
# était la plus FAUSSE, et aucune garde existante ne la voyait.
#
# On lit `lowpowermode` et pas seulement la prise : il peut être forcé à la main
# SUR secteur, auquel cas la source d'alimentation seule mentirait.
# ─────────────────────────────────────────────────────────────────────────────

# Niveau thermique macOS (0 = froid). « n/a » là où le sysctl n'existe pas.
therm() { sysctl -n machdep.xcpm.cpu_thermal_level 2>/dev/null || echo "n/a"; }

power_source() {
  pmset -g ps 2>/dev/null | head -1 | grep -o "AC Power\|Battery Power" || echo "n/a"
}
low_power() { pmset -g 2>/dev/null | awk '/lowpowermode/{print $2}'; }

# Régime compact « AC Power/lpm=0 » — à comparer entre DEUX séries : si elles
# diffèrent, leurs médianes ne sont pas comparables, et la série qui a changé de
# régime en cours de route est à JETER en entier, pas à rattraper.
cpu_regime() {
  local p l
  p=$(power_source)
  l=$(low_power)
  [ "$p" = "n/a" ] && { echo "n/a"; return 0; }
  echo "$p/lpm=${l:-?}"
}

# ── Décor VIRTUALISÉ, CONSTATÉ (axiome 4 : une capacité ne se déduit pas) ────
#
# `loadavg` ne voit PAS une machine virtuelle : un hyperviseur qui réserve 8 des
# 12 cœurs laisse une charge basse, et le banc part sereinement sur une machine
# dont il ignore qu'elle est partagée. Ce dépôt a payé cette cécité deux fois —
# facteur 3,7 sur le seul chemin virtualisé de Docker Desktop, puis une paire de
# camps mesurée en entier avec la VM allumée alors que ses CONTENEURS étaient
# éteints : arrêter les conteneurs ne rend pas les vCPU.
#
# `soak.mjs` porte déjà ce constat ; il est ici pour que les bancs de PAIRES le
# portent aussi, par la même implémentation. Un décor relevé par un banc et
# ignoré par l'autre laisse comparer deux fenêtres incomparables.
#
# ⚠️ Ce champ ne DÉSIGNE aucun coupable : il dit si deux runs sont comparables,
# jamais pourquoi ils diffèrent.
vcpu_virtualises() {
  local n
  n=$(docker info --format '{{.NCPU}}' 2>/dev/null | tr -d '[:space:]')
  case "$n" in
    '' | *[!0-9]*) echo 0 ;;
    *) echo "$n" ;;
  esac
}

# Rend « oui/N » ou « non ». À graver dans le décor de TOUTE mesure publiée.
hyperviseur() {
  local n
  n=$(vcpu_virtualises)
  [ "$n" -gt 0 ] 2>/dev/null && echo "oui/${n}vCPU" || echo "non"
}

# ── L'INDEXEUR de recherche macOS — des vagues invisibles au thermal ─────────
#
# Cette garde a été DÉCRITE dans `docs/performance/methode.md` (« la garde attend
# un niveau thermique acceptable ET un indexeur sous 2 % sur deux contrôles
# espacés de trente secondes ») alors qu'aucun script ne la portait. Vécu le
# 09-14 : deux séries sur quatre refusées pour dispersion, `spotlightknowledged`
# à 99,3 % de CPU, niveau thermique parfait — et la doc affirmait une protection
# qui n'existait pas. Une garde qui ne vit que dans une page ne garde rien.
#
# L'indexeur réindexe PAR VAGUES : un relevé ponctuel sous le seuil ne prouve
# rien, d'où les DEUX constats espacés. `LC_ALL=C` est obligatoire — en locale
# française `ps` rend « 99,3 » et awk s'arrête à la virgule, sous-estimant la
# vague d'un facteur arbitraire.
indexeur_pct() {
  # Sous-shell : la locale C doit couvrir `ps` ET `awk` (sinon awk lit « 18.4 »
  # comme 18 et une somme de petits processus est comptée 0), sans pour autant
  # imposer sa locale au banc qui appelle.
  (
    export LC_ALL=C
    ps -Ao pcpu,comm -r 2>/dev/null | awk '
      NR > 1 && $2 ~ /spotlightknowledged|mdworker|mds_stores|corespotlightd|mdsyncd|mds$/ { s += $1 }
      END { printf "%.0f", s + 0 }'
  )
}

# Dernier relevé de la garde — à écrire dans le décor de la mesure, comme le
# régime CPU et l'hyperviseur. Un chiffre publié sans lui n'est pas réfutable.
INDEXEUR_PCT="n/a"

# Attendre que la machine soit CALME : thermal sous la cible ET indexeur sous le
# seuil, CONSTATÉS DEUX FOIS à 30 s d'intervalle. Rend 0 si le calme est atteint,
# 1 si le plafond d'attente expire — l'appelant DIT alors qu'il mesure sous
# réserve, il ne se tait pas. La garde de dispersion reste le filet final.
attendre_machine_calme() {
  local cible_therm="${1:-45}" cible_idx="${2:-2}" plafond="${3:-300}"
  local attendu=0 stables=0 t idx therm_ok
  while :; do
    t=$(therm)
    idx=$(indexeur_pct)
    INDEXEUR_PCT="$idx"
    therm_ok=0
    { [ "$t" = "n/a" ] || [ "$t" -le "$cible_therm" ] 2>/dev/null; } && therm_ok=1
    if [ "$therm_ok" = "1" ] && [ "$idx" -le "$cible_idx" ] 2>/dev/null; then
      stables=$((stables + 1))
      [ "$stables" -ge 2 ] && break
      [ "$attendu" -ge "$plafond" ] && break
      sleep 30
      attendu=$((attendu + 30))
    else
      stables=0
      if [ "$attendu" -ge "$plafond" ]; then
        echo "  ⚠ machine NON calme après ${attendu}s (thermal $t, indexeur ${idx} %) — mesure SOUS RÉSERVE"
        return 1
      fi
      sleep 10
      attendu=$((attendu + 10))
    fi
  done
  [ "$attendu" -gt 0 ] && echo "  (machine calme après ${attendu}s → thermal $t, indexeur ${idx} %)"
  return 0
}
