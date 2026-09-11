/**
 * Générateurs de configuration reverse-proxy (nginx / haproxy) DÉRIVÉE de
 * l'introspection Nodefony — fonctions PURES (aucun accès kernel/fs), testables
 * et sérialisables. Le câblage (lecture des services) vit dans la commande CLI
 * `proxy:generate` ; ici on ne fait que transformer un modèle → texte de conf.
 *
 * Résout le « trou statiques multi-modules » : Nodefony sert N dossiers `public/`
 * (racine + un par module) AU MÊME préfixe `/`. nginx ne sait pas servir N roots
 * sous `/` → on génère une CHAÎNE de `try_files` via des locations nommées
 * (root d0 → @r1 → root d1 → … → @nodefony), fallback final vers le backend.
 */

/** Un dossier statique servi sous un préfixe d'URL (mount préfixé). */
export interface ProxyStaticMount {
  /** Préfixe d'URL (ex. `/_assets/studio/`). */
  prefix: string;
  /** Dossier absolu servi. */
  dir: string;
}

/**
 * Terminaison TLS au frontal — **nginx uniquement**.
 *
 * Les chemins sont ceux vus par le PROXY à l'exécution, jamais ceux de la
 * machine qui a généré la configuration : une clé privée n'entre pas dans une
 * image (une couche reste lisible même effacée plus loin), elle se MONTE au
 * déploiement — volume compose, secret Kubernetes.
 */
export interface ProxyTlsTermination {
  /** Chaîne de certificats servie au client (`fullchain.pem`). */
  certPath: string;
  /** Clé privée correspondante (`privkey.pem`). */
  keyPath: string;
  /** Port d'écoute TLS du proxy. */
  listen: number;
}

/** Modèle d'introspection consommé par les générateurs. */
export interface ProxyIntrospection {
  /** `server_name` (hôtes de confiance, IP exclues). Vide → `_` (catch-all). */
  domains: string[];
  /** Hôte du backend Nodefony à joindre (ex. `host.docker.internal`). */
  backendHost: string;
  /** Port HTTP du backend (clair). */
  httpPort: number;
  /** Port HTTPS/2 du backend (re-encrypt). */
  httpsPort: number;
  /** Dossiers statiques servis à la racine `/` (ordre = priorité). */
  staticRoots: string[];
  /** Montages statiques préfixés (servis tels quels). */
  mounts: ProxyStaticMount[];
  /** Port d'écoute du proxy généré (défaut 80). */
  listen: number;
  /** Re-chiffrer vers le backend HTTPS (true) ou forward en clair (false). */
  reencrypt: boolean;
  /**
   * Taille maximale d'un corps de requête acceptée par Nodefony, en octets
   * (`http.maxBodySize`). `0` = ne rien imposer au proxy.
   *
   * Sans elle, nginx applique son propre défaut — **1 Mo** — et rend un `413`
   * que le serveur ne voit jamais : l'application marche en direct et casse
   * derrière le proxy, sur une limite que personne n'a écrite.
   */
  maxBodyBytes: number;
  /**
   * Intervalle du heartbeat WebSocket, en millisecondes (`ws.keepaliveInterval`,
   * `0` = désactivé) — d'où les proxys tirent leur délai de tunnel.
   *
   * Une WebSocket est, vue d'un proxy, une connexion SANS trafic entre deux
   * messages. Ce qui la garde en vie derrière nginx et haproxy, ce sont les
   * pings du serveur : le délai d'inactivité doit donc être dérivé de leur
   * intervalle, jamais posé au hasard. Heartbeat désactivé → plus rien ne borne
   * le silence, et seul un délai franchement long évite de couper des sockets
   * saines.
   */
  keepaliveIntervalMs: number;
  /**
   * Terminaison TLS au frontal, ou `null` pour n'écouter qu'en clair.
   *
   * **nginx seulement** : haproxy exige un PEM COMBINÉ (certificat + clé dans
   * un même fichier), que Nodefony ne fabrique pas — la commande REFUSE donc
   * l'option sur cette cible plutôt que de l'accepter et de la jeter.
   */
  tls: ProxyTlsTermination | null;
}

/** Valeurs par défaut d'un modèle d'introspection (complété par la commande). */
export const defaultIntrospection: ProxyIntrospection = {
  domains: [],
  backendHost: "127.0.0.1",
  httpPort: 5151,
  httpsPort: 5152,
  staticRoots: [],
  mounts: [],
  listen: 80,
  reencrypt: false,
  maxBodyBytes: 0,
  keepaliveIntervalMs: 0,
  tls: null,
};

/**
 * Délai d'inactivité, en secondes, qu'un proxy doit accorder à une connexion
 * portée par le heartbeat WebSocket.
 *
 * Quatre intervalles de battement : il faut trois pings perdus d'affilée pour
 * que le proxy coupe, ce qui laisse passer une pause de collecteur mémoire ou
 * une seconde de charge sans sacrifier des sockets vivantes. Plancher à 300 s
 * pour que les requêtes HTTP lentes ne soient pas coupées par le même réglage ;
 * heartbeat éteint → une heure, parce que plus rien ne garantit du trafic et
 * qu'un silence légitime peut alors durer.
 */
function idleTimeoutSeconds(intro: ProxyIntrospection): number {
  if (intro.keepaliveIntervalMs <= 0) return 3600;
  return Math.max(300, Math.ceil((intro.keepaliveIntervalMs * 4) / 1000));
}

/** `server_name` nginx / hôte de comparaison — IP et `0.0.0.0` exclus. */
function serverNames(domains: string[]): string {
  const names = domains.filter((d) => d && d !== "0.0.0.0" && !isIpLiteral(d));
  return names.length > 0 ? names.join(" ") : "_";
}

/** IP littérale (IPv4 ou IPv6) — ne va pas en `server_name`. */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/** En-têtes forwarded nginx (pattern EDGE : on ÉCRASE X-Forwarded-For). */
const NGINX_FORWARD_HEADERS_TPL = `      # EDGE (face client) : on ÉCRASE X-Forwarded-For avec la SEULE IP vue par
      # nginx → toute valeur forgée par le client est jetée (RFC 7239 §8.1).
      proxy_set_header Host              $host;
      proxy_set_header X-Real-IP         $remote_addr;
      proxy_set_header X-Forwarded-For   $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header X-Forwarded-Host  $host;
      proxy_set_header X-Forwarded-Port  $server_port;
      # WebSocket (Nodefony co-héberge HTTP + WS sur le même port).
      proxy_set_header Upgrade           $http_upgrade;
      proxy_set_header Connection        $connection_upgrade;
      # Inactivité tolérée — dérivée du heartbeat WebSocket du serveur, pas du
      # défaut nginx (60 s) : entre deux messages, une socket vivante ne montre
      # au proxy que les pings du serveur.
      proxy_read_timeout __IDLE__s;
      proxy_send_timeout __IDLE__s;`;

/** Les en-têtes forwarded nginx, avec le délai d'inactivité effectif. */
function nginxForwardHeaders(idleSeconds: number): string {
  return NGINX_FORWARD_HEADERS_TPL.replaceAll("__IDLE__", String(idleSeconds));
}

/**
 * Génère une configuration nginx complète (reverse-proxy + offload statiques).
 *
 * @param intro - modèle d'introspection Nodefony.
 * @returns le contenu d'un `nginx.conf`.
 */
export function generateNginxConfig(intro: ProxyIntrospection): string {
  const scheme = intro.reencrypt ? "https" : "http";
  const backendPort = intro.reencrypt ? intro.httpsPort : intro.httpPort;
  const idleSeconds = idleTimeoutSeconds(intro);
  const lines: string[] = [];

  lines.push(
    "# Généré par `nodefony proxy:generate nginx` — NE PAS éditer à la main.",
    "# Reverse-proxy dérivé de l'introspection Nodefony (domaines, statiques, ports).",
    "worker_processes auto;",
    "events { worker_connections 1024; }",
    "",
    "http {",
    // 🔴 La table des types MIME, sans laquelle le frontal CASSE la page.
    //
    // Ce fichier REMPLACE le `nginx.conf` de l'image : ce qu'il n'inclut pas
    // n'existe pas. Sans `mime.types`, nginx sert TOUT avec son type par défaut
    // (`text/plain`) — et un navigateur REFUSE un module ES servi en text/plain
    // (« Strict MIME type checking is enforced for module scripts per HTML
    // spec »), tout comme il ignore une feuille de style au mauvais type.
    //
    // Le symptôme est le pire qui soit : les assets répondent **200**, donc
    // toute sonde qui ne regarde que le code de retour est verte — et l'écran
    // est BLANC. Mesuré sur une application générée servie derrière son frontal.
    "  include /etc/nginx/mime.types;",
    "  default_type application/octet-stream;",
    "",
    // Ne pas annoncer sa version dans chaque réponse ni dans les pages
    // d'erreur : c'est du renseignement gratuit pour qui cherche une faille
    // connue, et cela ne sert à personne d'autre.
    "  server_tokens off;",
    "",
    // Service de fichiers : `sendfile` évite la copie par l'espace utilisateur,
    // `tcp_nopush` regroupe l'en-tête et le début du corps dans un seul segment,
    // `tcp_nodelay` rend la main tout de suite sur les petites écritures — dont
    // les trames WebSocket, qu'un algorithme de Nagle retarderait.
    "  sendfile on;",
    "  tcp_nopush on;",
    "  tcp_nodelay on;",
    "",
    // Compression des réponses TEXTUELLES. Mesuré sur le bundle d'une
    // application générée : 255 kB → 85 kB. `gzip_vary` ajoute `Vary:
    // Accept-Encoding`, sans quoi un cache intermédiaire sert du contenu
    // compressé à un client qui ne l'a pas demandé.
    //
    // Jamais sur les images ni les archives : déjà compressées, on dépenserait
    // du processeur pour grossir. La liste ci-dessous ne contient donc que du
    // texte — `text/html` est toujours inclus par nginx, on ne le répète pas.
    "  gzip on;",
    "  gzip_vary on;",
    "  gzip_min_length 1024;",
    "  gzip_proxied any;",
    "  gzip_types text/plain text/css text/xml application/javascript " +
      "application/json application/xml image/svg+xml application/manifest+json;",
    "",
    "  # Upgrade WebSocket — HTTP et WS co-habitent sur le même port Nodefony.",
    "  map $http_upgrade $connection_upgrade { default upgrade; '' close; }",
    "",
    `  upstream nodefony { server ${intro.backendHost}:${backendPort}; keepalive 32; }`,
    "",
  );

  // La limite de corps est celle du SERVEUR, pas celle de nginx. Sans cette
  // ligne, nginx refuse à 1 Mo (son défaut) une requête que Nodefony aurait
  // acceptée — un 413 qui n'apparaît dans aucun journal applicatif.
  if (intro.maxBodyBytes > 0) {
    lines.push(
      `  # Aligné sur \`http.maxBodySize\` (${intro.maxBodyBytes} octets) — sans quoi`,
      "  # nginx rendrait 413 à 1 Mo, son défaut, sans que le serveur le sache.",
      `  client_max_body_size ${intro.maxBodyBytes};`,
      "",
    );
  }

  lines.push(...nginxServerBlock(intro, scheme, idleSeconds, null));

  // Le MÊME vhost, écouté une seconde fois en TLS. Deux blocs plutôt qu'un
  // `listen … ssl` ajouté au premier : nginx appliquerait alors le certificat
  // aux deux écoutes, et le port en clair cesserait de répondre en clair.
  if (intro.tls) {
    lines.push("", ...nginxServerBlock(intro, scheme, idleSeconds, intro.tls));
  }

  lines.push("}", "");
  return lines.join("\n");
}

/**
 * Un bloc `server {}` nginx — corps IDENTIQUE en clair et en TLS.
 *
 * Le scheme annoncé au backend reste `$scheme`, que nginx CONSTATE sur la
 * connexion entrante : le même corps sert donc les deux écoutes sans qu'aucune
 * n'ait à savoir laquelle elle est. C'est ce qui fait qu'un cookie `Secure`
 * tient derrière le frontal alors que le lien interne est en clair.
 *
 * @param intro - modèle d'introspection Nodefony.
 * @param scheme - `http` ou `https` vers le BACKEND (re-chiffrement).
 * @param idleSeconds - inactivité tolérée, dérivée du heartbeat WebSocket.
 * @param tls - terminaison TLS de CE bloc, ou `null` pour une écoute en clair.
 * @returns les lignes du bloc `server`.
 */
function nginxServerBlock(
  intro: ProxyIntrospection,
  scheme: string,
  idleSeconds: number,
  tls: ProxyTlsTermination | null,
): string[] {
  const lines: string[] = ["  server {"];

  if (tls) {
    lines.push(
      `    listen ${tls.listen} ssl;`,
      "    http2 on;",
      `    server_name ${serverNames(intro.domains)};`,
      "",
      "    # Terminaison TLS au frontal. Ces chemins sont ceux d'un MONTAGE, à",
      "    # pourvoir au déploiement (volume compose, secret k8s) : une clé privée",
      "    # n'entre pas dans une image, où la couche reste lisible même effacée.",
      `    ssl_certificate     ${tls.certPath};`,
      `    ssl_certificate_key ${tls.keyPath};`,
      "    ssl_protocols TLSv1.2 TLSv1.3;",
      "    ssl_session_cache shared:SSL:10m;",
      "    ssl_session_timeout 1h;",
      "",
      // Une requête EN CLAIR arrivée sur le port TLS : nginx en fait un code
      // interne 497 (« a regular request has been sent to the HTTPS port »,
      // module ngx_http_ssl_module) et rend, sans cette ligne, un « 400 Bad
      // Request » nu — qui ne dit ni que le port est chiffré, ni quoi taper.
      // Vécu deux fois de suite sur la même URL. On redirige vers la MÊME
      // adresse en https : l'erreur de frappe se corrige toute seule, et le
      // navigateur affiche la page au lieu d'un refus.
      //
      // 🔴 `$http_host`, jamais `$host:$server_port`. `$server_port` est le port
      // sur lequel nginx écoute DANS le conteneur (8443) — pas celui que le
      // client a composé (18443 derrière un mapping). Mesuré : la redirection
      // renvoyait vers un port qui n'existe pas côté client. `$host`, lui,
      // RETIRE le port (documentation du module core) ; `$http_host` est
      // l'en-tête `Host` brut, port compris — donc exactement ce que le client
      // a tapé, ce qui est la seule adresse où on peut le renvoyer.
      "    error_page 497 =301 https://$http_host$request_uri;",
    );
  } else {
    lines.push(
      `    listen ${intro.listen};`,
      `    server_name ${serverNames(intro.domains)};`,
    );
  }

  if (intro.reencrypt) {
    lines.push(
      "    # Re-encrypt : valider le cert backend (cf docker/certs).",
      "    # proxy_ssl_trusted_certificate /etc/nginx/certs/ca.pem;",
      "    # proxy_ssl_verify on; proxy_ssl_name nodefony.com;",
    );
  }

  // Montages préfixés : servis directement (alias), sans toucher au backend.
  for (const m of intro.mounts) {
    const prefix = ensureTrailingSlash(m.prefix);
    const dir = ensureTrailingSlash(m.dir);
    // Le sous-dossier que le bundler EMPREINTE (`assets/`, défaut de Vite) se
    // met en cache pour un an : son nom contient déjà l'empreinte du contenu,
    // donc une version différente porte une URL différente — il n'y a rien à
    // revalider, jamais. `immutable` dit au navigateur de ne même pas demander
    // (RFC 8246), ce qu'un simple `expires` n'obtient pas : sans lui, un
    // rechargement de page renvoie une conditionnelle par fichier.
    //
    // Une location au préfixe PLUS LONG l'emporte chez nginx : elle passe donc
    // devant celle du montage, sans la remplacer. Absente du disque, elle ne
    // matche rien — le cas d'un bundler qui n'empreinte pas est inoffensif.
    lines.push(
      "",
      `    location ${prefix}assets/ {`,
      `      alias ${dir}assets/;`,
      "      access_log off;",
      "      expires 1y;",
      '      add_header Cache-Control "public, immutable";',
      "    }",
      "",
      `    location ${prefix} {`,
      `      alias ${dir};`,
      "      access_log off;",
      // Le reste du montage (le `public/` d'un module) n'est PAS empreint :
      // un cache long y servirait une version périmée après un déploiement.
      "      expires 1h;",
      "    }",
    );
  }

  lines.push(
    "",
    `    location @nodefony {`,
    `      proxy_pass ${scheme}://nodefony;`,
    "      proxy_http_version 1.1;",
    nginxForwardHeaders(idleSeconds),
    "    }",
  );

  if (intro.staticRoots.length === 0) {
    // Aucun statique racine → tout va au backend.
    lines.push(
      "",
      "    location / {",
      `      proxy_pass ${scheme}://nodefony;`,
      "      proxy_http_version 1.1;",
      nginxForwardHeaders(idleSeconds),
      "    }",
    );
  } else {
    // Chaîne de roots : essaie chaque dossier statique, fallback backend.
    const roots = intro.staticRoots;
    lines.push(
      "",
      roots.length > 1
        ? "    # Statiques multi-dossiers (racine app + modules) : chaîne try_files,\n" +
            "    # fallback vers le backend Nodefony si aucun fichier ne matche."
        : "    # Statiques servis par le frontal ; fallback vers le backend\n" +
            "    # Nodefony si aucun fichier ne correspond.",
      "    location / {",
      `      root ${roots[0]};`,
      `      try_files $uri ${roots.length > 1 ? "@r1" : "@nodefony"};`,
      "    }",
    );
    for (let i = 1; i < roots.length; i++) {
      const next = i + 1 < roots.length ? `@r${i + 1}` : "@nodefony";
      lines.push(
        `    location @r${i} {`,
        `      root ${roots[i]};`,
        `      try_files $uri ${next};`,
        "    }",
      );
    }
  }

  lines.push("  }");
  return lines;
}

/**
 * Génère une configuration haproxy (reverse-proxy + Forwarded RFC 7239).
 * haproxy ne sert PAS de fichiers : les statiques sont proxifiés au backend
 * (ou désactivés côté serveur via `statics.enabled: false` + un nginx/CDN).
 *
 * @param intro - modèle d'introspection Nodefony.
 * @returns le contenu d'un `haproxy.cfg`.
 */
export function generateHaproxyConfig(intro: ProxyIntrospection): string {
  const backendPort = intro.reencrypt ? intro.httpsPort : intro.httpPort;
  const idleSeconds = idleTimeoutSeconds(intro);
  const serverSsl = intro.reencrypt
    ? " ssl ca-file /etc/haproxy/certs/ca.pem verify required" +
      ` verifyhost ${firstDomain(intro)} sni str(${firstDomain(intro)})`
    : "";
  const staticNote =
    intro.staticRoots.length > 0 || intro.mounts.length > 0
      ? "  # NB : haproxy ne sert pas de fichiers — les statiques sont proxifiés au\n" +
        "  # backend. Pour les offloader, utiliser nginx (proxy:generate nginx) +\n" +
        "  # `statics.enabled: false` côté Nodefony.\n"
      : "";

  return `# Généré par \`nodefony proxy:generate haproxy\` — NE PAS éditer à la main.
# Reverse-proxy dérivé de l'introspection Nodefony.
global
  log stdout format raw local0 info

defaults
  mode http
  log global
  option httplog
  timeout connect 5s
  timeout client  ${idleSeconds}s
  timeout server  ${idleSeconds}s
  # Une fois l'échange passé en WebSocket, ce sont ces secondes-là qui comptent :
  # \`timeout server\` ne s'applique plus au tunnel. Sans cette ligne, la valeur
  # implicite coupe des sockets que le heartbeat gardait pourtant vivantes.
  timeout tunnel  ${idleSeconds}s

frontend fe_nodefony
  bind *:${intro.listen}

  # SÉCU : effacer le Forwarded entrant (forgé) avant de poser le nôtre (§8.1).
  http-request del-header Forwarded
  option forwardfor

  # Le \`proto\` annoncé au serveur est le scheme vu par le CLIENT — il se
  # CONSTATE sur la connexion entrante (\`ssl_fc\`), il ne se déduit pas.
  #
  # Il était déduit du re-chiffrement vers le backend, qui est une tout autre
  # question : un frontend en clair re-chiffrant vers le backend annonçait
  # \`proto=https\`, et le serveur traitait alors une requête EN CLAIR comme
  # sécurisée — cookies \`Secure\` posés sur du clair, garde « exiger HTTPS »
  # jamais déclenchée. Le cas inverse (frontend TLS, backend en clair) faisait
  # boucler les redirections vers HTTPS.
  http-request set-header X-Forwarded-Proto https if { ssl_fc }
  http-request set-header X-Forwarded-Proto http  unless { ssl_fc }
  http-request set-header X-Forwarded-Host  %[req.hdr(host)]
  http-request set-header X-Real-IP         %[src]
  http-request set-header Forwarded "for=%[src];proto=https;host=%[req.hdr(host)]" if { ssl_fc }
  http-request set-header Forwarded "for=%[src];proto=http;host=%[req.hdr(host)]" unless { ssl_fc }

  default_backend be_nodefony

backend be_nodefony
${staticNote}  server nodefony ${intro.backendHost}:${backendPort} check${serverSsl}
`;
}

/** Premier domaine non-IP (pour verifyhost/sni), défaut `localhost`. */
function firstDomain(intro: ProxyIntrospection): string {
  return (
    intro.domains.find((d) => d && d !== "0.0.0.0" && !isIpLiteral(d)) ??
    "localhost"
  );
}

/** Garantit un `/` final (requis par `alias` nginx). */
function ensureTrailingSlash(dir: string): string {
  return dir.endsWith("/") ? dir : `${dir}/`;
}
