#!/usr/bin/env bash
# Construit, ÉPROUVE puis (option) publie l'image de démonstration
# `nodefony/nodefony` pour CHAQUE plateforme demandée.
#
# 🔴 UN SEUL CODE pour la forge et pour le poste. Le job `image` de
# `release.yml` appelle ce script avec `--push` ; le poste l'appelle SANS, avant
# le tag. Une recette recopiée dans le YAML et rejouée « à l'identique » à la
# main divergerait au premier réglage — et la preuve locale ne prouverait plus
# rien de ce que la forge publie.
#
# Lancé depuis l'application générée (`nodefony create app demo --preset
# complete`), ou avec `--app <dossier>`.
#
# ## Pourquoi une plateforme à la fois, et pas `--platform a,b --push`
#
# Le moteur docker du runner GitHub garde le magasin d'images CLASSIQUE, qui ne
# sait pas CHARGER une image multi-plateforme (doc Docker « Multi-platform image
# with GitHub Actions », § Build and load). Or chaque garde ci-dessous lit une
# image LOCALE (`docker inspect`, `docker save`, `docker run`) : un
# `buildx --push` direct publierait des variantes que personne n'a regardées.
# Donc : chaque plateforme est bâtie et CHARGÉE seule, sous son étiquette
# `<version>-<arch>`, éprouvée, et seulement si TOUTES passent, poussée ; l'index
# multi-plateforme est assemblé ENSUITE dans le registre par
# `docker buildx imagetools create`, à partir de ces manifestes déjà vérifiés —
# aucun second build, donc aucun digest que les gardes n'auraient pas vu.
# `imagetools create` exige ses sources DANS le registre où il écrit (référence
# buildx) : les étiquettes d'architecture sont poussées sur chaque registre.
#
# ## Émulation
#
# Une plateforme étrangère à l'hôte se construit ET s'exécute sous QEMU : la
# forge le fait enregistrer par ce script (`--poser-emulation`), depuis la même
# liste `--platforms` ; Docker Desktop l'embarque déjà. Aucune architecture
# d'hôte n'est supposée. Les délais d'attente sont élargis (`--budget-emule`) :
# un démarrage émulé est plusieurs fois plus lent, pas en panne.
#
# Usage :
#   bash scripts/release/image-demo.sh --version 10.0.0-beta.9 --revision <sha40> \
#     [--platforms linux/amd64,linux/arm64] [--app <dossier>] \
#     [--budget-natif 90] [--budget-emule 300] [--poser-emulation] \
#     [--push --canal beta] \
#     [--depots localhost:5000/nodefony/nodefony]   # registre jetable
#
# @usage bash scripts/release/image-demo.sh --version <v> --revision <sha> [--platforms <liste>] [--push --canal <canal>]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test -f "$root/scripts/release/image-gate.mjs" || {
  echo "racine du dépôt introuvable depuis ${BASH_SOURCE[0]}" >&2
  exit 64
}

version="" revision="" app="." canal="" push=0 depots_liste="" poser_emulation=0
platforms="linux/amd64,linux/arm64"
budget_natif=90 budget_emule=300
while [[ $# -gt 0 ]]; do
  # Une option à valeur placée en dernier ferait échouer `shift 2` en silence.
  case "$1" in
    --version|--revision|--platforms|--app|--canal|--budget-natif|--budget-emule|--depots)
      [[ $# -ge 2 ]] || { echo "option $1 : valeur manquante" >&2; exit 64; } ;;
  esac
  case "$1" in
    --version) version="${2:-}"; shift 2 ;;
    --revision) revision="${2:-}"; shift 2 ;;
    --platforms) platforms="${2:-}"; shift 2 ;;
    --app) app="${2:-}"; shift 2 ;;
    --canal) canal="${2:-}"; shift 2 ;;
    --budget-natif) budget_natif="${2:-}"; shift 2 ;;
    --budget-emule) budget_emule="${2:-}"; shift 2 ;;
    --depots) depots_liste="${2:-}"; shift 2 ;;
    --push) push=1; shift ;;
    --poser-emulation) poser_emulation=1; shift ;;
    -h|--help) sed -n '2,46p' "$0"; exit 0 ;;
    *) echo "option inconnue : $1" >&2; exit 64 ;;
  esac
done
[[ -n "$version" && -n "$revision" && -n "$platforms" ]] || {
  echo "usage : image-demo.sh --version <v> --revision <sha40> [--platforms …] [--push --canal …]" >&2
  exit 64
}
cd "$app"
test -f Dockerfile || { echo "::error::pas de Dockerfile dans $(pwd)"; exit 1; }
docker version >/dev/null 2>&1 || {
  echo "::error::démon docker injoignable — rien ne peut être construit ni contrôlé"
  exit 69
}

# NETTOYAGE GARANTI, quelle que soit la sortie (refus, `set -e`, interruption) :
# le fichier d'environnement contient les secrets fabriqués par l'image, et un
# conteneur de contrôle oublié tiendrait un port du poste.
env_courant=""
conteneurs=()
nettoyer() {
  [[ -z "$env_courant" ]] || rm -f "$env_courant"
  local c
  for c in "${conteneurs[@]+"${conteneurs[@]}"}"; do
    docker rm -f "$c" >/dev/null 2>&1 || true
  done
}
trap nettoyer EXIT

v="${version#v}"
image="nodefony/nodefony"
# Dépôts de destination. Défaut = Docker Hub puis GHCR ; `--depots` sert à
# éprouver le push et l'assemblage de l'index sur un registre JETABLE
# (`localhost:<port>/…`) avant le tag, sans rien publier.
depots_liste="${depots_liste:-${image},ghcr.io/nodefony/nodefony}"
hote="$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')"
IFS=',' read -r -a plats <<< "$platforms"

# `--poser-emulation` (la forge) : enregistre QEMU pour les plateformes de la
# liste que l'HÔTE n'exécute pas — amd64 sur un hôte arm64, arm64 sur un amd64.
# La liste vient de `--platforms` et de nulle part ailleurs : une plateforme
# ajoutée reçoit son émulateur sans second endroit à tenir. Absent sur le poste
# (Docker Desktop embarque déjà l'émulation) : le conteneur est `--privileged`.
# Épinglé par DIGEST, jamais par une étiquette mobile : il tourne dans un job
# qui détient les jetons des registres. (Doc Docker « Multi-platform builds »,
# § Install QEMU manually ; `setup-qemu-action` lance ce même conteneur.)
if [[ "$poser_emulation" == 1 ]]; then
  etrangeres=""
  for p in "${plats[@]}"; do
    a="${p#*/}"; a="${a%%/*}"
    [[ "$a" == "${hote#*/}" ]] || etrangeres="${etrangeres:+${etrangeres},}${a}"
  done
  if [[ -n "$etrangeres" ]]; then
    echo "hôte ${hote} — émulation posée pour : ${etrangeres}"
    docker run --privileged --rm \
      tonistiigi/binfmt:qemu-v10.2.3@sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0 \
      --install "$etrangeres"
  else
    echo "hôte ${hote} — aucune plateforme étrangère, pas d'émulation"
  fi
fi

# `linux/arm64` → `arm64` ; `linux/arm/v7` → `arm-v7` : une étiquette docker
# n'admet pas `/`.
suffixe() { local p="${1#linux/}"; echo "${p//\//-}"; }

# Architecture OCI (`GOARCH`, image-spec « image-index ») → `process.arch` de
# Node. Une architecture absente de la table est rendue telle quelle : la
# comparaison échoue alors en la NOMMANT, elle ne passe jamais par défaut.
arch_node() {
  case "${1#*/}" in
    amd64) echo x64 ;;
    386) echo ia32 ;;
    ppc64le) echo ppc64 ;;
    *) echo "${1#*/}" ;;
  esac
}

# Attend qu'un conteneur détaché SORTE, borné. Rend son code de sortie, ou 124
# s'il tourne encore au bout du budget. Remplace `timeout`, absent de macOS :
# ce script tourne aussi sur le poste.
attendre_sortie() {
  local nom="$1" budget="$2" t=0 etat
  while (( t < budget )); do
    etat="$(docker inspect -f '{{.State.Status}}' "$nom" 2>/dev/null || echo absent)"
    if [[ "$etat" == "exited" || "$etat" == "dead" ]]; then
      docker inspect -f '{{.State.ExitCode}}' "$nom"
      return 0
    fi
    sleep 2; t=$(( t + 2 ))
  done
  echo 124
}

eprouver() {
  local plat="$1" arch img budget
  arch="$(suffixe "$plat")"
  img="${image}:${v}-${arch}"
  budget="$budget_natif"
  [[ "$plat" == "$hote" ]] || budget="$budget_emule"
  echo "::group::${plat} — construction (hôte ${hote}, budget ${budget} s)"

  # Les `ARG` du gabarit existaient déjà, mais RIEN ne les passait : la
  # `10.0.0-alpha.4` est partie avec `version="0.1.0"`, `revision=""` et
  # `created=""`. Une étiquette FAUSSE est pire qu'absente.
  #
  # `--label` (et non un `ARG` de plus) pour le titre et la source :
  # l'application témoin s'appelle « demo », et c'est juste pour ELLE. C'est
  # l'IMAGE PUBLIÉE qui ne doit pas porter ce nom, donc la décision appartient
  # à la forge, pas au gabarit distribué.
  docker build --platform "$plat" \
    --build-arg VERSION="${v}" \
    --build-arg VCS_REF="${revision}" \
    --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --label org.opencontainers.image.title="Nodefony" \
    --label org.opencontainers.image.description="Application Nodefony de démonstration, générée par « nodefony create app --preset complete » au tag ${v}" \
    --label org.opencontainers.image.source="https://github.com/nodefony/nodefony-core" \
    --label org.opencontainers.image.licenses="Apache-2.0" \
    -t "nf-demo-app:${v}-${arch}" .

  # 🔴 LA BASE DE LA DÉMO NAÎT MIGRÉE. L'image embarque sa base SQLite : sans
  # migration, `/readyz` restait à 503 (« 2 migrations à appliquer ») pendant
  # que la page promettait un `docker run` qui sert (vu à la beta.1). Migrer au
  # BUILD, pas au démarrage : la doctrine veut les migrations AVANT les
  # exemplaires, et ici la base vit DANS l'image. Le gabarit ne change pas :
  # une application réelle garde sa base hors de l'image et son job de
  # migration (`deploy/migrate-job.yaml`).
  #
  # 🔓 LE CLAIR EST DÉCLARÉ, ICI SEULEMENT : la page promet une console sur
  # http://127.0.0.1:5151 pour un essai sur le poste. L'échappement vit dans
  # CETTE couche de démonstration, jamais dans le gabarit.
  #
  # 🔴 `RUN` en forme EXEC : l'image est distroless, sans shell. Le script du
  # PAQUET, jamais `node_modules/.bin/nodefony` : sous pnpm c'est un script
  # shell que node lit comme du JS (`nodefonyBin.ts#IMAGE_NODEFONY_BIN`).
  # Sous émulation, ce `RUN` s'exécute lui aussi sous QEMU.
  docker build --platform "$plat" -t "$img" - <<EOF
FROM nf-demo-app:${v}-${arch}
RUN ["/nodejs/bin/node", "node_modules/nodefony/bin/nodefony", "orm:migrate"]
ENV NF__SECURITY__ALLOWINSECURECREDENTIALS=true
EOF
  echo "::endgroup::"

  # La PLATEFORME se constate sur l'image, elle ne se déduit pas de l'option
  # passée : une variante étiquetée `arm64` qui contiendrait de l'amd64
  # partirait dans l'index sous la mauvaise entrée, et `docker pull` sur un Pi
  # rendrait « exec format error » — sans qu'aucune garde ne l'ait vu.
  # La variante (`arm/v7`) ne se compare pas : `inspect` ne la rend pas toujours.
  local lue attendue
  lue="$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$img")"
  attendue="$(cut -d/ -f1-2 <<< "$plat")"
  if [[ "$lue" != "$attendue" ]]; then
    echo "::error::${img} est en ${lue}, pas en ${plat} — publication refusée"
    return 1
  fi
  # Et le binaire l'EXÉCUTE : le `node` de l'image, lancé sur cet hôte (natif
  # ou émulé), rapporte sa propre architecture. Rien n'est supposé de l'hôte —
  # sur un poste arm64, c'est amd64 qui passe par l'émulation.
  local rapportee
  rapportee="$(docker run --rm --platform "$plat" "$img" -p "process.arch" 2>&1 || true)"
  if [[ "$rapportee" != "$(arch_node "$attendue")" ]]; then
    echo "::error::${img} : node rapporte « ${rapportee} », attendu « $(arch_node "$attendue") » — émulation absente sur l'hôte ${hote} ?"
    return 1
  fi
  echo "✓ plateforme constatée : ${lue} (node : ${rapportee})"

  # AVANT le push : une image poussée est publique, ses étiquettes voyagent
  # avec elle.
  node "$root/scripts/release/image-labels-gate.mjs" "$img" \
    --version "${v}" --revision "${revision}" --titre-interdit demo || {
    echo "::error::${plat} : étiquettes OCI fausses — publication refusée"
    return 1
  }

  # 🔴 ENTRE le build et le push, jamais après : une couche reste lisible même
  # effacée par une couche suivante. La `10.0.0-alpha.4` est partie avec la clé
  # privée TLS du poste de construction. Le contrôle sort non nul s'il n'a PAS
  # PU regarder : `!= 0` refuse dans les deux cas, ce qui est voulu.
  node "$root/scripts/release/image-gate.mjs" "$img" || {
    echo "::error::${plat} : l'image embarque de la matière sensible — publication refusée"
    return 1
  }

  # L'image SERT-elle ? On la lance EXACTEMENT comme la page de l'image le dit
  # (`docker/hub-overview.md`, « Lancer ») : secrets fabriqués par l'image
  # elle-même, mot de passe admin, `--env-file` — et `/readyz` à 200 dans un
  # délai borné. Depuis l'ADR-0014 et #478, une application en production
  # REFUSE de démarrer sans NF_CSRF_SECRET ni NF_JWT_KEYSET.
  env_courant="$(mktemp)"
  docker run --rm --platform "$plat" "$img" \
    node_modules/nodefony/bin/nodefony security:secrets --env > "$env_courant" || {
    echo "::error::${plat} : l'image ne sait pas produire ses secrets (security:secrets --env) — la ligne 1 de la page échoue"
    return 1
  }
  local k
  for k in NF_CSRF_SECRET NF_JWT_KEYSET NF_TOTP_KEY NF_WEBHOOK_KEY; do
    grep -q "^${k}=" "$env_courant" || {
      echo "::error::${plat} : security:secrets --env n'a pas rendu ${k} — la ligne 1 de la page ment"
      return 1
    }
  done
  echo "NF_ADMIN_PASSWORD=$(openssl rand -hex 16)" >> "$env_courant"

  # Et la garde de la page MORD : sans rien, l'image refuse (78) en nommant la
  # variable — sinon la page décrirait un refus qui n'a pas lieu. Borné : une
  # image qui NE refuse PAS resterait au premier plan (124).
  local refus refuslog
  docker rm -f "nf-demo-refus-${arch}" >/dev/null 2>&1 || true
  conteneurs+=("nf-demo-refus-${arch}")
  docker run -d --platform "$plat" --name "nf-demo-refus-${arch}" "$img" >/dev/null
  refus="$(attendre_sortie "nf-demo-refus-${arch}" "$budget")"
  refuslog="$(docker logs "nf-demo-refus-${arch}" 2>&1 || true)"
  docker rm -f "nf-demo-refus-${arch}" >/dev/null 2>&1 || true
  if [[ "$refus" != "78" || "$refuslog" != *NF_CSRF_SECRET* ]]; then
    printf '%s\n' "$refuslog" | tail -20
    echo "::error::${plat} : lancée sans secrets, l'image devait refuser en 78 en nommant NF_CSRF_SECRET (code ${refus})"
    return 1
  fi
  echo "✓ refus en 78 sans secrets"

  # Port HÔTE choisi par le moteur (`127.0.0.1::5151`) : ni le poste (où un
  # serveur de développement tient souvent 5151) ni deux runs ne se battent
  # pour le même port.
  local nom="nf-demo-readyz-${arch}" port code=000 t=0 debut
  docker rm -f "$nom" >/dev/null 2>&1 || true
  conteneurs+=("$nom")
  debut="$(date +%s)"
  docker run -d --platform "$plat" --name "$nom" -p 127.0.0.1::5151 \
    --env-file "$env_courant" "$img" >/dev/null
  rm -f "$env_courant"; env_courant=""
  # Un conteneur mort dès le départ (« exec format error », crash au boot) n'a
  # plus de port : le dire, journal à l'appui, au lieu de sortir muet.
  port="$(docker port "$nom" 5151/tcp 2>/dev/null | head -1 | sed 's/.*://' || true)"
  if [[ -z "$port" ]]; then
    docker logs "$nom" 2>&1 | tail -40
    echo "::error::${plat} : le conteneur n'a pas tenu jusqu'à la publication de son port — publication refusée"
    return 1
  fi
  while (( t < budget )); do
    # `--max-time` : sous émulation, une connexion acceptée sans réponse
    # bloquerait `curl` au-delà du budget, que la boucle ne borne qu'en tours.
    code="$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/readyz" || true)"
    [[ "$code" == "200" ]] && break
    sleep 2; t=$(( t + 2 ))
  done
  if [[ "$code" != "200" ]]; then
    docker logs "$nom" 2>&1 | tail -40
    docker rm -f "$nom" >/dev/null
    echo "::error::${plat} : l'image ne sert pas — /readyz répond ${code} après ${budget} s. Publication refusée."
    return 1
  fi
  echo "::notice::${plat} : l'image sert — /readyz 200 en $(( $(date +%s) - debut )) s"

  # Arrêt GRACIEUX : le seul verdict qui compte est 0 ; 137 = tué, donc le
  # drain n'a pas eu lieu. Sous émulation aussi : c'est la variante que le Pi
  # exécutera.
  local sortie
  docker stop -t 30 "$nom" >/dev/null
  sortie="$(docker inspect -f '{{.State.ExitCode}}' "$nom")"
  docker rm -f "$nom" >/dev/null
  if [[ "$sortie" != "0" ]]; then
    echo "::error::${plat} : arrêt non gracieux (code ${sortie})"
    return 1
  fi
  echo "✓ arrêt gracieux (code 0)"
}

for p in "${plats[@]}"; do
  eprouver "$p"
done
echo "::notice::toutes les plateformes éprouvées : ${platforms}"

if [[ "$push" != 1 ]]; then
  echo "(--push absent : rien n'est publié)"
  exit 0
fi

# L'ÉTIQUETTE MOBILE se dérive du canal, exactement comme le dist-tag npm :
# `latest` n'appartient qu'aux versions finales. Poussé sans condition, il
# servirait une préversion à tout `docker pull nodefony/nodefony`.
mobile="${canal:-latest}"

# GHCR : les MÊMES images, re-étiquetées — pas de second build, qui rendrait un
# autre digest que les gardes n'auraient pas regardé.
#
# ⚠️ VISIBILITÉ GHCR À CONSTATER au premier push : s'il naît privé, le passer
# public UNE fois (Package settings), sinon le `docker pull` d'un inconnu
# répond `denied`. `org.opencontainers.image.source` le rattache au dépôt.
#
# ORDRE DE PUBLICATION — du moins visible au plus visible, pour qu'un échec en
# route (registre qui refuse, plafond du job) laisse le moins possible exposé :
#   1. les variantes `<v>-<arch>`, sur TOUS les dépôts — personne ne les tire
#      sans les nommer ;
#   2. l'index `<v>` de chaque dépôt, RELU dans le registre ;
#   3. seulement alors l'étiquette mobile, copie conforme de `<v>` (même
#      digest, constaté) — c'est elle que tire un `docker pull` sans version,
#      elle ne bouge jamais vers un index non vérifié.
IFS=',' read -r -a depots <<< "$depots_liste"

for depot in "${depots[@]}"; do
  for p in "${plats[@]}"; do
    a="$(suffixe "$p")"
    [[ "$depot" == "$image" ]] || docker tag "${image}:${v}-${a}" "${depot}:${v}-${a}"
    docker push "${depot}:${v}-${a}"
  done
done

# Empreinte d'une référence telle que le registre la sert.
#
# 🔴 `awk` lit TOUTE l'entrée — jamais `{ print $2; exit }`. Un lecteur qui sort
# tôt ferme le tuyau ; si `imagetools inspect` écrit encore après, il sort en
# 255 SANS UN MOT, et `pipefail` tue le script. Course pure : vert sur le poste,
# rouge sur le runner de la 10.0.0-beta.9 — `:beta` poussé sur Docker Hub, GHCR
# jamais atteint.
empreinte() { docker buildx imagetools inspect "$1" | awk '/^Digest:/ && d == "" { d = $2 } END { print d }'; }

for depot in "${depots[@]}"; do
  sources=()
  for p in "${plats[@]}"; do sources+=("${depot}:${v}-$(suffixe "$p")"); done
  docker buildx imagetools create -t "${depot}:${v}" "${sources[@]}"

  # Le critère de fin, CONSTATÉ dans le registre : l'index publié liste chaque
  # plateforme demandée. La variante éventuelle (`linux/arm64/v8`, que rend
  # une construction native arm64) est admise : la garde ne dépend pas de
  # l'architecture de l'hôte qui a construit.
  index="$(docker buildx imagetools inspect "${depot}:${v}")"
  for p in "${plats[@]}"; do
    grep -Eq "Platform:[[:space:]]+${p}(/[^[:space:]]+)?\$" <<< "$index" || {
      printf '%s\n' "$index"
      echo "::error::${depot}:${v} ne liste pas ${p} — index incomplet, étiquette mobile NON déplacée"
      exit 1
    }
  done
  echo "✓ ${depot}:${v} — ${platforms}"
done

for depot in "${depots[@]}"; do
  docker buildx imagetools create -t "${depot}:${mobile}" "${depot}:${v}"
  attendu="$(empreinte "${depot}:${v}")"
  obtenu="$(empreinte "${depot}:${mobile}")"
  if [[ -z "$attendu" || "$obtenu" != "$attendu" ]]; then
    echo "::error::${depot}:${mobile} (${obtenu:-?}) n'est pas ${depot}:${v} (${attendu:-?})"
    exit 1
  fi
  echo "::notice::${depot}:${v} et :${mobile} (${attendu}) — ${platforms}"
done
