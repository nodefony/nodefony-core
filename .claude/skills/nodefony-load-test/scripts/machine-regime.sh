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
