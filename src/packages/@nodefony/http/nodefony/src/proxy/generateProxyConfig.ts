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

  lines.push(
    "  server {",
    `    listen ${intro.listen};`,
    `    server_name ${serverNames(intro.domains)};`,
  );

  if (intro.reencrypt) {
    lines.push(
      "    # Re-encrypt : valider le cert backend (cf docker/certs).",
      "    # proxy_ssl_trusted_certificate /etc/nginx/certs/ca.pem;",
      "    # proxy_ssl_verify on; proxy_ssl_name nodefony.com;",
    );
  }

  // Montages préfixés : servis directement (alias), sans toucher au backend.
  for (const m of intro.mounts) {
    lines.push(
      "",
      `    location ${m.prefix} {`,
      `      alias ${ensureTrailingSlash(m.dir)};`,
      "      access_log off;",
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
      "    # Statiques multi-dossiers (racine app + modules) : chaîne try_files,",
      "    # fallback vers le backend Nodefony si aucun fichier ne matche.",
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

  lines.push("  }", "}", "");
  return lines.join("\n");
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
