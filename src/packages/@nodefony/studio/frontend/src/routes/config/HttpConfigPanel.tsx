/**
 * **HttpConfigPanel** — onglet « Config » du module `@nodefony/http`, branché sur
 * la brique générique `ConfigLayout`. Premier vrai cas **migré Zod** : il sert de
 * validation de la VISION (le même rendu s'appliquera à tout module).
 *
 * Données = le **schéma Zod** réel de http (`nodefony/config/schema.ts`) : clés,
 * types, valeurs possibles, défauts, et flags Nodefony (`runtimeMutable` →
 * « à chaud », `reserved`, `kernelDerived` → « auto »). Mode **schéma** (pas de
 * valeur effective ici) : on montre ce qui est CONFIGURABLE. Quand un endpoint
 * exposera `z.toJSONSchema()` + les options effectives, on basculera en mode
 * effectif (cascade de surcharge) SANS changer ce composant — juste les données.
 */
import { Code } from "@mantine/core";
import { ConfigLayout, type ConfigSection } from "../../components/ui";

/** Valeur de config en monospace. */
function code(v: string) {
  return <Code style={{ fontSize: 12 }}>{v}</Code>;
}

/** Sections de config http (mappées du schéma Zod) — partagées fiche ↔ synthèse. */
export const HTTP_CONFIG_SECTIONS: ConfigSection[] = [
  {
    title: "Identité & sécurité",
    description:
      "En-têtes de sécurité (defaults OWASP) et barrières Host / reverse-proxy.",
    fields: [
      {
        key: "headerServer",
        type: "string | null",
        defaultValue: code('"nodefony"'),
        mutability: "live",
        description:
          "Valeur de l'en-tête Server:. null = ne pas exposer l'identité du serveur (recommandé en prod).",
      },
      {
        key: "trustProxy",
        type: "boolean | string | string[]",
        constraint: "false · true · IP/CIDR · loopback/linklocal/uniquelocal",
        defaultValue: code("false"),
        mutability: "boot",
        description:
          "Confiance envers les en-têtes X-Forwarded-* (RFC 7239). false = ignorés (secure).",
      },
      {
        key: "trustedHosts",
        type: "boolean | string | string[]",
        defaultValue: code("false"),
        mutability: "boot",
        description:
          "Barrière Host testée AVANT le routing (anti Host-header injection). Domaine canonique + loopback (dev) toujours acceptés.",
      },
      {
        key: "securityHeaders.frameOptions",
        type: "string | null",
        constraint: "DENY · SAMEORIGIN · null",
        defaultValue: code('"DENY"'),
        mutability: "boot",
        description: "X-Frame-Options — anti-clickjacking.",
      },
      {
        key: "securityHeaders.strictTransportSecurity.maxAge",
        type: "number (s)",
        constraint: "entier ≥ 0",
        defaultValue: code("31536000"),
        mutability: "boot",
        description:
          "HSTS (RFC 6797) — durée pendant laquelle le navigateur force HTTPS. Défaut 1 an (OWASP).",
      },
    ],
  },
  {
    title: "Serveurs",
    fields: [
      {
        key: "http.requestTimeout",
        type: "number (ms)",
        constraint: "entier ≥ 0",
        defaultValue: code("30000"),
        mutability: "boot",
        description:
          "Timeout de réception de la requête complète — anti slow-loris.",
      },
      {
        key: "https.rejectUnauthorized",
        type: "boolean",
        defaultValue: code("false"),
        mutability: "boot",
        description:
          "Rejette les certificats TLS non valides. false en dev (auto-signés), TOUJOURS true en prod.",
      },
      {
        key: "http2.maxConcurrentStreams",
        type: "number",
        constraint: "entier > 0",
        defaultValue: code("100"),
        mutability: "boot",
        description:
          "Flux concurrents max par session HTTP/2 — défense CVE-2023-44487 (Rapid Reset).",
      },
      {
        key: "watch",
        type: "boolean",
        defaultValue: code("true"),
        mutability: "boot",
        reserved: true,
        description:
          "Futur serveur HMR (hot-reload dev). Non lu en runtime aujourd'hui.",
      },
      {
        key: "http3",
        type: "object",
        defaultValue: code("{}"),
        mutability: "boot",
        reserved: true,
        description: "Serveur HTTP/3 (QUIC), nécessitera Node.js ≥ 28.",
      },
    ],
  },
  {
    title: "Upload",
    fields: [
      {
        key: "upload.uploadDir",
        type: "string",
        defaultValue: code("auto"),
        mutability: "boot",
        kernelDerived: true,
        description:
          "Répertoire de dépôt des fichiers uploadés. Vide = résolu sur kernel.tmpDir par le builder.",
      },
      {
        key: "upload.maxFileSize",
        type: "number (octets)",
        constraint: "entier > 0",
        defaultValue: code("524288000"),
        mutability: "boot",
        description:
          "Taille max d'UN fichier (500 MB). Dépassement → 413. Réduire en production.",
      },
      {
        key: "upload.hashAlgorithm",
        type: "false | enum",
        constraint: "false · sha256 · sha1 · md5",
        defaultValue: code("false"),
        mutability: "boot",
        description:
          "Hash calculé pendant le stream du fichier (intégrité). false = 0 coût CPU.",
      },
    ],
  },
  {
    title: "Sessions",
    fields: [
      {
        key: "session.handler",
        type: "string",
        constraint: "files · drizzle · mongoose",
        defaultValue: code('"files"'),
        mutability: "boot",
        description:
          "Storage de session : nom d'un service DI ou handler enregistré.",
      },
      {
        key: "session.cookie.secure",
        type: "boolean",
        defaultValue: code("true"),
        mutability: "boot",
        description:
          "Cookie envoyé uniquement via HTTPS. TOUJOURS true en production.",
      },
      {
        key: "session.cookie.httpOnly",
        type: "boolean",
        defaultValue: code("true"),
        mutability: "boot",
        description:
          "Cookie inaccessible via JS (document.cookie) — protection XSS.",
      },
    ],
  },
  {
    title: "WebSocket",
    fields: [
      {
        key: "websocket.maxPayload",
        type: "number (octets)",
        constraint: "entier > 0",
        defaultValue: code("1048576"),
        mutability: "boot",
        description:
          "Taille max d'un message WS entrant (1 MiB). Au-delà → close RFC 6455 1009. Anti DoS mémoire.",
      },
      {
        key: "websocket.keepaliveInterval",
        type: "number (ms)",
        constraint: "entier > 0",
        defaultValue: code("20000"),
        mutability: "boot",
        description:
          "Intervalle des pings keep-alive — détecte les connexions zombies.",
      },
    ],
  },
  {
    title: "Certificats TLS",
    fields: [
      {
        key: "certificates.openssl.size",
        type: "number (bits)",
        constraint: "entier > 0",
        defaultValue: code("2048"),
        mutability: "boot",
        description:
          "Taille de la clé RSA. 2048 minimum, 4096 recommandé en prod.",
      },
      {
        key: "certificates.openssl.attrs",
        type: "array",
        defaultValue: code("auto"),
        mutability: "boot",
        kernelDerived: true,
        description:
          "Attributs du certificat (commonName…). Vide = dérivés du kernel (commonName ← domain).",
      },
      {
        key: "certificates.dev.useMkcert",
        type: "boolean",
        defaultValue: code("true"),
        mutability: "boot",
        description:
          "Préférer mkcert (CA locale trustée) en dev → HTTPS sans erreur navigateur (HMR/WSS).",
      },
    ],
  },
];

export function HttpConfigPanel() {
  return (
    <ConfigLayout
      module="@nodefony/http"
      schema="zod"
      sections={HTTP_CONFIG_SECTIONS}
    />
  );
}
