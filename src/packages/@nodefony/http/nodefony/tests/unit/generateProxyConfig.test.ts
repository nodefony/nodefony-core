/// <reference types="node" />
import { expect } from "chai";
import {
  generateNginxConfig,
  generateHaproxyConfig,
  defaultIntrospection,
  type ProxyIntrospection,
} from "../../src/proxy/generateProxyConfig.js";

function intro(over: Partial<ProxyIntrospection> = {}): ProxyIntrospection {
  return { ...defaultIntrospection, ...over };
}

describe("generateProxyConfig — nginx", () => {
  // 🔴 Ce fichier REMPLACE le `nginx.conf` de l'image : ce qu'il n'inclut pas
  // n'existe pas. Sans la table des types, nginx sert TOUT en `text/plain` —
  // et un navigateur REFUSE un module ES à ce type (« Strict MIME type checking
  // is enforced for module scripts »), comme il ignore une feuille de style.
  //
  // Le symptôme est le pire qui soit : les assets répondent **200**, donc toute
  // sonde qui ne regarde que le code de retour reste VERTE, et l'écran est
  // blanc. Mesuré sur une application générée servie derrière son frontal.
  it("la table des types MIME est incluse — sinon tout part en text/plain", () => {
    const c = generateNginxConfig(intro());
    expect(c).to.match(/^\s*include\s+\/etc\/nginx\/mime\.types;/mu);
    expect(c).to.match(/^\s*default_type\s+application\/octet-stream;/mu);
    // Dans le bloc `http`, pas ailleurs : posée dans un `server`, la directive
    // ne vaudrait que pour lui.
    const http = c.slice(c.indexOf("http {"), c.indexOf("server {"));
    expect(http).to.include("mime.types");
  });

  it("les assets EMPREINTS sont immuables, le reste du montage non", () => {
    const c = generateNginxConfig(
      intro({ mounts: [{ prefix: "/_assets/app/", dir: "/srv/assets/app" }] }),
    );
    // Le sous-dossier empreint par le bundler : rien à revalider, jamais.
    expect(c).to.include("location /_assets/app/assets/ {");
    expect(c).to.include('add_header Cache-Control "public, immutable"');
    // Et le montage lui-même reste court : le `public/` d'un module n'est PAS
    // empreint, un cache long y servirait une version périmée après déploiement.
    const montage = c.slice(c.indexOf("location /_assets/app/ {"));
    expect(montage.slice(0, 200)).to.include("expires 1h;");
    expect(montage.slice(0, 200)).to.not.include("immutable");
  });

  it("compression des réponses TEXTUELLES seulement", () => {
    const c = generateNginxConfig(intro());
    expect(c).to.include("gzip on;");
    // `Vary: Accept-Encoding`, sans quoi un cache intermédiaire sert du
    // compressé à un client qui ne l'a pas demandé.
    expect(c).to.include("gzip_vary on;");
    expect(c).to.include("application/javascript");
    // Jamais sur ce qui est DÉJÀ compressé : on dépenserait du processeur pour
    // grossir le contenu. On regarde la LISTE, pas le fichier entier — un type
    // d'image peut légitimement apparaître ailleurs (`mime.types`).
    const types = c.slice(
      c.indexOf("gzip_types"),
      c.indexOf(";", c.indexOf("gzip_types")),
    );
    for (const deja of [
      "image/png",
      "image/jpeg",
      "application/zip",
      "video/",
    ]) {
      expect(types, `gzip_types ne doit pas porter ${deja}`).to.not.include(
        deja,
      );
    }
    // …mais le SVG, lui, est du texte : il se compresse très bien.
    expect(types).to.include("image/svg+xml");
    // Et la version du serveur ne s'annonce pas.
    expect(c).to.include("server_tokens off;");
  });

  it("la limite de corps du SERVEUR est imposée au proxy (sinon nginx coupe à 1 Mo)", () => {
    const c = generateNginxConfig(intro({ maxBodyBytes: 8_388_608 }));
    expect(c).to.include("client_max_body_size 8388608;");
    // Rien d'imposé quand le serveur n'annonce pas de limite.
    expect(generateNginxConfig(intro({ maxBodyBytes: 0 }))).to.not.include(
      "client_max_body_size",
    );
  });

  it("délai d'inactivité dérivé du heartbeat, pas du défaut nginx (60 s)", () => {
    const c = generateNginxConfig(intro({ keepaliveIntervalMs: 20_000 }));
    expect(c).to.include("proxy_read_timeout 300s;");
    expect(c).to.include("proxy_send_timeout 300s;");
  });

  it("server_name exclut les IP et 0.0.0.0", () => {
    const c = generateNginxConfig(
      intro({ domains: ["nodefony.com", "localhost", "127.0.0.1", "0.0.0.0"] }),
    );
    expect(c).to.match(/server_name nodefony\.com localhost;/);
    expect(c).to.not.include("127.0.0.1;");
  });

  it("sans domaine → catch-all `_`", () => {
    expect(generateNginxConfig(intro({ domains: [] }))).to.include(
      "server_name _;",
    );
  });

  it("upstream vise backendHost:httpPort (clair)", () => {
    const c = generateNginxConfig(
      intro({ backendHost: "host.docker.internal", httpPort: 5151 }),
    );
    expect(c).to.include("server host.docker.internal:5151;");
    expect(c).to.include("proxy_pass http://nodefony;");
  });

  it("reencrypt → backend httpsPort + proxy_pass https", () => {
    const c = generateNginxConfig(intro({ httpsPort: 5152, reencrypt: true }));
    expect(c).to.include(":5152;");
    expect(c).to.include("proxy_pass https://nodefony;");
  });

  it("mount préfixé → location alias propre", () => {
    const c = generateNginxConfig(
      intro({ mounts: [{ prefix: "/_assets/studio/", dir: "/abs/out" }] }),
    );
    expect(c).to.include("location /_assets/studio/ {");
    expect(c).to.include("alias /abs/out/;");
  });

  it("statiques multi-racines → chaîne try_files + fallback @nodefony", () => {
    const c = generateNginxConfig(
      intro({ staticRoots: ["/app/public", "/mod/test/public"] }),
    );
    expect(c).to.include("root /app/public;");
    expect(c).to.include("try_files $uri @r1;");
    expect(c).to.include("location @r1 {");
    expect(c).to.include("root /mod/test/public;");
    expect(c).to.include("try_files $uri @nodefony;");
  });

  it("aucune racine statique → location / proxifie directement", () => {
    const c = generateNginxConfig(intro({ staticRoots: [] }));
    expect(c).to.match(/location \/ \{\s*\n\s*proxy_pass/);
  });

  it("inclut l'upgrade WebSocket", () => {
    const c = generateNginxConfig(intro());
    expect(c).to.include("$connection_upgrade");
    expect(c).to.include("proxy_set_header Upgrade           $http_upgrade;");
  });

  it("edge : X-Forwarded-For = $remote_addr (écrase, pas append)", () => {
    expect(generateNginxConfig(intro())).to.include(
      "proxy_set_header X-Forwarded-For   $remote_addr;",
    );
  });

  it("sans terminaison TLS : une seule écoute, aucun certificat", () => {
    const c = generateNginxConfig(intro({ tls: null }));
    expect(c).to.not.include("ssl_certificate");
    expect(c).to.not.include("listen 443 ssl;");
    expect(c.match(/^  server \{$/gm)?.length).to.equal(1);
  });

  it("terminaison TLS : un SECOND vhost, http2, et les chemins du proxy", () => {
    const c = generateNginxConfig(
      intro({
        listen: 8080,
        tls: {
          certPath: "/etc/nginx/certs/fullchain.pem",
          keyPath: "/etc/nginx/certs/privkey.pem",
          listen: 8443,
        },
      }),
    );
    expect(c).to.include("listen 8080;");
    expect(c).to.include("listen 8443 ssl;");
    expect(c).to.include("http2 on;");
    expect(c).to.include("ssl_certificate     /etc/nginx/certs/fullchain.pem;");
    expect(c).to.include("ssl_certificate_key /etc/nginx/certs/privkey.pem;");
    expect(c).to.include("ssl_protocols TLSv1.2 TLSv1.3;");
    // Deux vhosts, un seul `http {}` : la limite de corps et l'upstream restent
    // déclarés UNE fois, sinon nginx refuse de démarrer sur un doublon.
    expect(c.match(/^  server \{$/gm)?.length).to.equal(2);
    expect(c.match(/upstream nodefony/g)?.length).to.equal(1);
  });

  it("le vhost TLS sert EXACTEMENT le même corps que celui en clair", () => {
    // Ce qui tient le cookie `Secure` derrière le frontal, c'est `$scheme` — que
    // nginx CONSTATE sur la connexion entrante. Un corps qui divergerait entre
    // les deux écoutes ferait mentir l'une des deux sans qu'aucun test ne le voie.
    const c = generateNginxConfig(
      intro({
        listen: 8080,
        staticRoots: ["/srv/assets"],
        mounts: [{ prefix: "/_assets/app/", dir: "/srv/assets/_assets/app" }],
        tls: {
          certPath: "/etc/nginx/certs/fullchain.pem",
          keyPath: "/etc/nginx/certs/privkey.pem",
          listen: 8443,
        },
      }),
    );
    const blocks = c.split(/^  server \{$/m).slice(1);
    expect(blocks.length).to.equal(2);
    // Borné à la fermeture du `server` : le DERNIER bloc emporte sinon celle du
    // `http {}` englobant, et la comparaison échouerait sur une accolade.
    const body = (b: string) => {
      const rows = b.split("\n");
      const start = rows.findIndex((l) => l.startsWith("    location"));
      const end = rows.findIndex((l, i) => i > start && l === "  }");
      return rows.slice(start, end).join(" ").replace(/\s+/g, " ").trim();
    };
    expect(body(blocks[0])).to.equal(body(blocks[1]));
    expect(body(blocks[0])).to.include(
      "proxy_set_header X-Forwarded-Proto $scheme;",
    );
  });

  it("assets-root : un seul root sert le favicon ET les préfixés (try_files, 0 chaîne)", () => {
    // La forme que produit `--assets-root` : l'arbre publié est UN dossier, et
    // les préfixes y sont des sous-dossiers. Plus de `@r1`, donc plus de trou
    // entre deux racines — c'est ce qui met `/favicon.ico` devant Node.
    const c = generateNginxConfig(
      intro({
        staticRoots: ["/srv/assets"],
        mounts: [{ prefix: "/_assets/app/", dir: "/srv/assets/_assets/app" }],
      }),
    );
    expect(c).to.include("root /srv/assets;");
    expect(c).to.include("try_files $uri @nodefony;");
    expect(c).to.not.include("@r1");
    expect(c).to.include("alias /srv/assets/_assets/app/;");
  });
});

describe("generateProxyConfig — haproxy", () => {
  it("frontend/backend + Forwarded RFC 7239 (proto=http en clair)", () => {
    const c = generateHaproxyConfig(
      intro({ backendHost: "127.0.0.1", httpPort: 5151 }),
    );
    expect(c).to.include("frontend fe_nodefony");
    expect(c).to.include("backend be_nodefony");
    expect(c).to.include("http-request del-header Forwarded");
    expect(c).to.include("proto=http");
    expect(c).to.include("server nodefony 127.0.0.1:5151 check");
  });

  it("reencrypt → ssl verify required + verifyhost + sni sur le 1er domaine", () => {
    const c = generateHaproxyConfig(
      intro({ domains: ["nodefony.com"], httpsPort: 5152, reencrypt: true }),
    );
    expect(c).to.include("127.0.0.1:5152"); // backendHost défaut
    expect(c).to.include(
      "ssl ca-file /etc/haproxy/certs/ca.pem verify required",
    );
    expect(c).to.include("verifyhost nodefony.com");
    expect(c).to.include("sni str(nodefony.com)");
  });

  it("le `proto` annoncé se CONSTATE sur la connexion cliente (ssl_fc)", () => {
    const c = generateHaproxyConfig(intro({ domains: ["nodefony.com"] }));
    // Les deux branches, et rien d'inconditionnel entre les deux.
    expect(c).to.include(
      "http-request set-header X-Forwarded-Proto https if { ssl_fc }",
    );
    expect(c).to.include(
      "http-request set-header X-Forwarded-Proto http  unless { ssl_fc }",
    );
    expect(c).to.include('proto=https;host=%[req.hdr(host)]" if { ssl_fc }');
    expect(c).to.include('proto=http;host=%[req.hdr(host)]" unless { ssl_fc }');
  });

  it("le re-chiffrement vers le backend ne décide PAS du `proto` du client", () => {
    // LE cas qui a manqué : `--reencrypt` décrit le lien proxy↔backend, `proto`
    // décrit ce que voit le client. Les confondre faisait annoncer `https` à un
    // frontend en clair — cookies `Secure` sur du clair, garde HTTPS désarmée.
    // La section forwarded doit donc être RIGOUREUSEMENT la même des deux côtés.
    const forwardedOf = (reencrypt: boolean) =>
      generateHaproxyConfig(intro({ domains: ["nodefony.com"], reencrypt }))
        .split("\n")
        .filter((l) => l.includes("set-header") || l.includes("Forwarded"))
        .join("\n");
    expect(forwardedOf(true)).to.equal(forwardedOf(false));
  });

  it("délai de tunnel dérivé du heartbeat (une WS n'est que du silence entre deux pings)", () => {
    // 4 battements, plancher 300 s : 20 s → 300 s, 120 s → 480 s.
    expect(
      generateHaproxyConfig(intro({ keepaliveIntervalMs: 20_000 })),
    ).to.include("timeout tunnel  300s");
    expect(
      generateHaproxyConfig(intro({ keepaliveIntervalMs: 120_000 })),
    ).to.include("timeout tunnel  480s");
    // Heartbeat éteint : plus rien ne borne le silence → une heure.
    expect(generateHaproxyConfig(intro({ keepaliveIntervalMs: 0 }))).to.include(
      "timeout tunnel  3600s",
    );
  });

  it("note l'absence d'offload statique si des statiques existent", () => {
    const c = generateHaproxyConfig(intro({ staticRoots: ["/app/public"] }));
    expect(c).to.match(/haproxy ne sert pas de fichiers/i);
  });
});
