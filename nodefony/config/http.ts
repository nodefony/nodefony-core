/**
 * Socle serveur — TLS, barrière Host, proxy de confiance, sessions, upload.
 *
 * Fragment du manifeste de l'application : `nodefony.config.ts` l'importe et
 * passe le résultat à `use("@nodefony/http", …)`. Rien ne charge ce fichier
 * tout seul — c'est l'import du manifeste qui le monte, et lui seul.
 *
 * 🔴 `satisfies` n'est PAS décoratif. Écrit dans le manifeste, ce littéral
 * était vérifié au point d'appel : une clé inconnue y était refusée. Rendu par
 * une fonction, il ne l'est plus — la clé compile, puis Zod la retire EN
 * SILENCE au boot, et le module démarre sur son défaut. `satisfies` rétablit
 * ce contrôle, et `nodefony doctor` refuse un fragment qui s'en passe.
 *
 * @module
 */
import type { ConfigContext } from "nodefony";
import type { IHttpConfigInput } from "@nodefony/http";
import type { env } from "../../env";

/** La configuration de `@nodefony/http` pour cette application. */
export const httpConfig = (ctx: ConfigContext<typeof env>) =>
  ({
    // Serveur HTTPS : en dev, accepte les certificats auto-signés (mkcert) ;
    // en prod, rejette tout certificat TLS non valide (secure-by-default).
    // ⚠️ Doit vivre sous `https` (httpsServerSchema) — au top-level la clé est
    // silencieusement strippée au parse et la valeur n'est JAMAIS appliquée.
    https: { rejectUnauthorized: !ctx.isDev },
    // Certificat TLS (HTTPS/WSS). DEV : génération auto — mkcert (CA locale
    // trustée → 0 warning navigateur, HMR Vite) si dispo, sinon auto-signé
    // node-forge (SHA-256). PROD : fournir un VRAI certificat (Let's Encrypt,
    // ingress k8s, reverse-proxy edge) — Nodefony n'est PAS une autorité de
    // certification ; la génération reste un confort de DÉVELOPPEMENT.
    // (Re)génération / inspection manuelle : `nodefony certificates [--force]`.
    certificates: {
      // PROD : décommenter pour fournir le vrai certificat (fail-fast si absent).
      // strategy: "explicit",
      // key: ctx.env.TLS_KEY, cert: ctx.env.TLS_CERT, ca: ctx.env.TLS_CA,
      selfSigned: {
        size: 2048,
        // Hachage de signature — JAMAIS SHA-1 (interdit CA/B Forum, SHAttered 2017).
        hash: "sha256",
        validityDays: 365,
        attrs: [
          {
            name: "commonName",
            value: ctx.isProd ? "nodefony.com" : "localhost",
          },
          { name: "organizationName", value: "Nodefony Signing Authority" },
          { name: "organizationalUnitName", value: "Development" },
          { name: "countryName", value: "FR" },
          { name: "stateOrProvinceName", value: "BDR" },
          { name: "localityName", value: "Marseille" },
        ],
      },
      // Subject Alternative Name — fait foi pour la vérification d'hôte
      // (RFC 6125 : le commonName est ignoré). Vide = dérivé du kernel
      // (localhost + domain ; une IP va en iPAddress). Banc reverse-proxy
      // par domaine (NF_BIND_ALL) : couvrir `nodefony.com` pour permettre à
      // haproxy `verify required` + `sni` de valider le cert backend.
      san: ctx.env.NF_BIND_ALL
        ? { dns: ["nodefony.com", "localhost"], ip: ["127.0.0.1", "::1"] }
        : { dns: [], ip: [] },
    },
    // Barrière Host (consommée si `domainCheck: true` ci-dessus) : le domaine
    // canonique est toujours accepté ; on liste localhost + 127.0.0.1 pour taper
    // le serveur via les deux noms en dev/cluster local. `nodefony.com` permet
    // l'accès par NOM DE DOMAINE — en dev via `/etc/hosts` (nodefony.com →
    // 127.0.0.1), en prod via le vrai DNS. Le port est strippé avant le match
    // (cf domainMatcher) → `nodefony.com:5151` matche `nodefony.com`.
    //
    // `host.docker.internal` : un navigateur qui tourne DANS un conteneur (le
    // service `browser` de docker-compose.yml) ne peut pas dire « localhost »
    // — ce nom y désigne le conteneur lui-même. Docker Desktop lui donne
    // `host.docker.internal` pour joindre la machine hôte, et c'est ce nom qui
    // arrive dans l'en-tête `Host` : sans lui dans l'allowlist, la barrière
    // répond `421 Misdirected Request` alors que le réseau, lui, passe.
    //
    // 🔴 EXCEPTION ASSUMÉE, PROPRE À CE DÉPÔT — inconditionnelle, y compris en
    // production. Elle était auparavant limitée au développement, ce qui
    // paraissait plus sûr et rendait en fait le navigateur en conteneur
    // INUTILISABLE là où l'on en a le plus besoin : les audits (Lighthouse,
    // accessibilité, agentic) se mènent sur un runtime `production`, et le
    // conteneur y recevait `421` dès la connexion — donc aucune page derrière
    // authentification n'était observable, ni par un humain ni par un agent.
    //
    // Pourquoi c'est acceptable ICI : ce dépôt est le banc de développement du
    // framework, jamais un déploiement exposé. `host.docker.internal` n'est
    // d'ailleurs pas un nom résolvable publiquement — c'est une convention
    // Docker Desktop, absente d'internet et des clusters. L'élargissement porte
    // donc sur un nom que seul un conteneur local peut présenter.
    //
    // 🔴 CE QUI NE DOIT PAS ESSAIMER : le SCAFFOLD ne pose pas cette entrée, et
    // ne doit jamais la poser. Une application générée n'a aucune raison de
    // faire confiance à ce nom en production — ses gabarits ne mentionnent
    // `host.docker.internal` que dans la marche à suivre pour observer un
    // écran depuis un conteneur (`compose.yaml.tpl`, `AGENTS.md.tpl`), là où
    // c'est un conseil de dev et non une règle de sécurité. Vérifié : aucun
    // gabarit n'écrit `trustedHosts`. Si un jour l'un d'eux le fait, cette
    // entrée reste conditionnée au développement CHEZ LUI.
    //
    // Cette liste porte AUSSI, depuis la dérivation d'origine par `Host`, la
    // décision « quels noms le rendu a le droit de suivre » : y ajouter un
    // hôte ouvre à la fois la barrière 421, l'allowlist Vite, le CSP et
    // l'origine des assets. Une seule liste, quatre effets — c'est voulu.
    trustedHosts: [
      "localhost",
      "127.0.0.1",
      "nodefony.com",
      "host.docker.internal",
    ],
    // trustProxy : n'honore les en-têtes forwarded que derrière un proxy de
    // confiance. Activé via NF_BIND_ALL (banc reverse-proxy Docker : IP source
    // des conteneurs = réseau privé 172.16/12, 192.168/16, 10/8). En prod,
    // régler explicitement selon l'ingress. Défaut SÛR : false (0 confiance).
    trustProxy: ctx.env.NF_BIND_ALL ? ["loopback", "uniquelocal"] : false,
    // Stockage de session en `auto` : sans infra déclarée mais @nodefony/drizzle
    // chargé → sqlite local (persistant) ; honore l'override global
    // `NF_STORE=memory` (banc de charge). Le modèle NIST/OWASP (idle + absolute +
    // touch sur activité HTTP/WS) vit dans @nodefony/http (défauts sains : idle
    // 30 min, absolute 12 h). Multi-nœud → déclarer NF_DATABASE_URL / NF_REDIS_URL.
    session: {
      store: "auto",
    },
    // Upload multipart (moteur busboy). `uploadDir` = dossier de dépôt ;
    // vide → résolu sur `kernel.tmpDir`. (Ex-clé `formidable` = moteur retiré.)
    upload: { uploadDir: "./tmp/upload" },
  }) satisfies IHttpConfigInput;
