#!/bin/bash

# Nom du service web
WEB_SERVICE='nginx'
# Chemin de base (à personnaliser)
BASE_PATH="/path/to/your/project"
# Fichier de configuration de Certbot
CONFIG_FILE="$BASE_PATH/nodefony/config/letsencrypt/webroot.ini"
# Limite de jours avant expiration pour renouveler le certificat
EXP_LIMIT=180

# Vérifie si le fichier de configuration existe
if [ ! -f "$CONFIG_FILE" ]; then
  echo "[ERROR] Config file does not exist: $CONFIG_FILE"
  exit 1
fi

# Extraction des domaines depuis le fichier de configuration
DOMAINS=$(awk -F= '/^\s*domains\s*=/{gsub(/ /, "", $2); print $2}' "$CONFIG_FILE")
# Filtrage pour obtenir le premier domaine sans sous-domaine
DOMAIN=$(echo "$DOMAINS" | tr ',' '\n' | grep -E '^[^.]+\.[^.]+$' | head -n 1)
# Vérifie si un domaine sans sous-domaine a été trouvé
if [ -z "$DOMAIN" ]; then
  echo "[ERROR] No valid domain without subdomain found in the config file: $CONFIG_FILE"
  exit 1
fi
# Chemin vers le fichier du certificat
BASE_CERT_PATH="/etc/letsencrypt/live"
CERT_FILE="$BASE_CERT_PATH/$DOMAIN/fullchain.pem"

# Vérifie si le fichier de certificat existe
if [ ! -f "$CERT_FILE" ]; then
  echo "[ERROR] Certificate file not found for domain $DOMAIN."
  exit 1
fi

# Variables pour les dates
DATE_NOW=$(date -d "now" +%s)
EXP_DATE=$(date -d "$(openssl x509 -in "$CERT_FILE" -text -noout | grep "Not After" | cut -c 25-)" +%s)
EXP_DAYS=$(((EXP_DATE - DATE_NOW) / 86400))

echo "Checking expiration date for $DOMAIN..."
echo "Expiration date: $(date -d @$EXP_DATE)"
echo "Days until expiration: $EXP_DAYS"

# Vérifie si le certificat doit être renouvelé
if [ "$EXP_DAYS" -gt "$EXP_LIMIT" ]; then
  echo "The certificate is up to date, no need for renewal ($EXP_DAYS days left)."
  exit 0
else
  echo "The certificate for $DOMAIN is about to expire soon. Starting webroot renewal script..."
  certbot certonly --webroot --renew-by-default --config "$CONFIG_FILE" --quiet --renew-hook "systemctl reload $WEB_SERVICE"
  if [ $? -ne 0 ]; then
    echo "[ERROR] Certbot failed to renew the certificate for $DOMAIN"
    exit 1
  fi
  echo "Renewal process finished for domain $DOMAIN"
  exit 0
fi
