#!/usr/bin/env bash
# Construit les PEM dont le banc haproxy a besoin, À PARTIR des certificats
# générés par Nodefony. Pré-requis : Nodefony lancé avec NF_BIND_ALL=1 (le SAN du
# cert inclut alors `nodefony.com` — cf certificates.san dans nodefony.config.ts).
#
#   - ca.pem      : la CA qui a signé le cert backend (mkcert rootCA, ou le cert
#                   auto-signé en fallback). → haproxy `ca-file` (verify required).
#   - haproxy.pem : fullchain + clé privée concaténés. → cert que haproxy PRÉSENTE
#                   au client sur le frontend TLS `bind ssl crt` (port 8443).
#
# Ces fichiers sont gitignorés (ils contiennent la clé privée). Re-générer après
# chaque (re)génération de cert Nodefony.
set -euo pipefail

DST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DST/../.." && pwd)"
SRC="$REPO_ROOT/nodefony/config/certificates"

if [ ! -f "$SRC/server/fullchain.pem" ] || [ ! -f "$SRC/server/privkey.pem" ]; then
  echo "✗ Certificats Nodefony absents ($SRC/server/)." >&2
  echo "  Lance d'abord :  NF_BIND_ALL=1 bash .claude/skills/nodefony-start-server/start.sh" >&2
  exit 1
fi

# Ancre CA pour verify required. ca/ est présent pour mkcert ET pour l'auto-signé
# (qui y écrit son propre cert comme ancre de confiance).
if [ -f "$SRC/ca/nodefony-root-ca.crt.pem" ]; then
  cp "$SRC/ca/nodefony-root-ca.crt.pem" "$DST/ca.pem"
else
  echo "✗ Ancre CA absente ($SRC/ca/nodefony-root-ca.crt.pem)." >&2
  exit 1
fi

# Cert présenté au client par haproxy (cert + chaîne + clé privée).
cat "$SRC/server/fullchain.pem" "$SRC/server/privkey.pem" > "$DST/haproxy.pem"
chmod 600 "$DST/haproxy.pem"

echo "✓ $DST/ca.pem"
echo "✓ $DST/haproxy.pem (cert + clé — gitignoré)"
echo "  Vérifie le SAN :  openssl x509 -in '$SRC/server/cert.pem' -noout -ext subjectAltName"
