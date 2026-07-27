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
