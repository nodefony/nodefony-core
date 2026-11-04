---
adr: 24
title: Politique de sécurité du contenu — stricte par défaut, jamais bloquante
lang: fr
navTitle: CSP par défaut
date: 2026-11-04
status: accepted
deciders: [Christophe CAMENSULI]
tags: [security, csp, http, realtime, design, compatibility]
---

# ADR-0024 — Politique de sécurité du contenu : stricte par défaut, jamais bloquante

## Statut

Accepté (2026-11-04). Les onze décisions C1 à C11 et la règle C12 ont été tranchées une à une
par l'auteur ; le texte exact de chacune, son pourquoi et ses portes de sortie sont inscrits en
commentaire sur le ticket #699, qui instruit cet ADR. Chaque point a été confronté au corpus de
normes figé hors ligne (`.claude/skills/nodefony-rfc/references/csp/`, index `README.md`) : CSP
Level 3, Trusted Types, Reporting, Upgrade Insecure Requests, aide-mémoire OWASP. Ce que ces
textes ne tranchent pas est marqué **à constater au navigateur**.

## Contexte

La politique posée par défaut par `@nodefony/security` (source unique :
`src/packages/@nodefony/security/nodefony/config/config.ts#headersSchema`, clé `csp`) était
« sûre mais utilisable » : seul `script-src` était strict. Elle ne déclarait ni
`frame-ancestors`, ni `upgrade-insecure-requests`, ni rapport de violation ; elle permettait
`style-src 'unsafe-inline'` ; elle autorisait pour toutes les applications trois hôtes
d'avatars tiers ; et `connect-src 'self'` bloquait une socket temps réel servie sur une autre
origine sans que le module temps réel puisse le dire.

Les modules contribuent déjà à la politique par une fusion unique,
`src/packages/@nodefony/security/nodefony/src/csp.ts#mergeCspFragments`, appelée par
`firewall.registerCspOrigins(nom, fragment)`. C'est la seule voie : deux `script-src` dans une
même politique, le navigateur ignore le second ; deux en-têtes, il applique les deux.

Le temps réel est la clé de voûte du framework. Un durcissement qui casserait la socket, le flux
SSE ou la connexion OAuth serait retiré par les applications au premier incident — et ne
protégerait plus personne.

## Décision

### C0. Principe : la sécurité ne bloque jamais l'application

Chaque durcissement a une **porte de sortie délibérée**, écrite par l'application. Le framework
ne contourne rien en silence et n'impose rien sans recours. Une faute de configuration de
sécurité **retire et avertit** ; elle n'empêche pas le démarrage, en développement surtout.

| Décision                                  | Porte de sortie de l'application                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| C1, C2, C4, C6, C7 (politique par défaut) | réécrire `security.headers.csp` (jamais filtrée) ; `@Csp` par route ; `security.headers.enabled: false` coupe tout |
| C3 temps réel                             | `realtime.publicOrigin`                                                                                            |
| C5 cadres                                 | `http.frameOptions` (`SAMEORIGIN`, `null`) ou `frame-ancestors` dans sa politique                                  |
| C7 rapports                               | `security.headers.cspReport: false`, ou l'URL de son propre collecteur                                             |
| C8 Trusted Types                          | `trustedTypes: "off"`                                                                                              |
| C9 OAuth                                  | origine du fournisseur dans sa politique                                                                           |
| C10 gate                                  | ne vise que les paquets du framework, jamais le code de l'application                                              |
| C11 portée                                | réécrire la politique                                                                                              |
| C12 sources trop larges                   | le filtre ne vise que les contributions de MODULES ; config et `@Csp` de l'application passent tels quels          |

### C1. Scripts : nonce et `'strict-dynamic'`

`script-src 'nonce-{{nonce}}' 'strict-dynamic' 'self'`. Sous `'strict-dynamic'`, un navigateur
CSP3 ignore `'self'` et les hôtes (`w3c-csp3.bs` § « Authoring Considerations ») : `'self'` ne
reste que comme repli CSP2. Ferme le contournement par `'self'` — tout fichier JavaScript déposé
sur l'origine (téléversement, réponse mal typée) s'exécutait. Les `<script>` du framework portent
déjà le nonce (`TemplateHelper.ts#TemplateHelper.renderTags`, `prebuiltUi.ts#PrebuiltUi.renderIndex`).

**À constater au navigateur** : un `<link rel="modulepreload">` sans nonce est-il bloqué ? Si
oui, le nonce s'y pose.

### C2. Styles : nonce, attributs tolérés

`style-src 'self' 'nonce-{{nonce}}'; style-src-attr 'unsafe-inline'`. Ferme l'exfiltration par
`<style>` injecté (sélecteurs d'attribut vers `url()`, sans JavaScript). Un attribut `style="…"`
ne porte pas de sélecteur : risque résiduel faible, toléré. React et Vue écrivent les styles par
le CSSOM, que la politique ne gouverne pas. Tout `<style>` créé à l'exécution reçoit le nonce,
transmis au front par la convention `<meta property="csp-nonce">`.

### C3. Temps réel : l'origine se déclare, exacte

Même origine (cas courant, URL relative) : couvert par `connect-src 'self'`, qui inclut `wss:`
de la même origine en CSP3 (`w3c-csp3.bs` § « Changes from Level 2 »). Autre origine : clé
`realtime.publicOrigin` (schéma, hôte, port — sans joker), que `@nodefony/realtime` pose
lui-même au démarrage par `registerCspOrigins("realtime", { "connect-src": [publicOrigin] })`.
`publicOrigin` dit où la socket EST ; `allowedOrigins` dit quelles pages peuvent l'OUVRIR.

### C4. Avatars tiers : hors du défaut, déclarés par qui les affiche

Défaut `img-src 'self' data: blob:`. Chaque fournisseur OAuth porte l'hôte de ses avatars dans
sa définition, posé dans `img-src` seulement s'il est configuré ; Studio déclare Gravatar, dont
il est le seul consommateur. La copie de la liste dans `FrontendService` est supprimée : une
règle, une implémentation.

### C5. Cadres : un seul bouton pour deux en-têtes

`http.frameOptions` pilote `X-Frame-Options` ET `frame-ancestors` — un navigateur CSP ignore le
premier dès que le second est présent (`w3c-csp3.bs` § « `frame-ancestors` »), et le second
n'existe qu'en en-tête, jamais en `<meta>`.

| `http.frameOptions` | `X-Frame-Options` | `frame-ancestors` |
| ------------------- | ----------------- | ----------------- |
| `DENY` (défaut)     | `DENY`            | `'none'`          |
| `SAMEORIGIN`        | `SAMEORIGIN`      | `'self'`          |
| `null`              | absent            | absent            |

`security.headers.frameguard`, inerte, est déprécié au profit de `http.frameOptions`.

### C6. Transport chiffré, base des URL

`upgrade-insecure-requests` est posé sur les seules réponses servies en TLS, comme HSTS : en
clair (`http://localhost` en développement), la directive casserait les sous-ressources.
`base-uri 'self'` est gardé plutôt que `'none'` : il ferme déjà le détournement d'un script
relatif vers un hôte tiers, et `'none'` casserait les applications qui posent `<base href="/">`
ou vivent sous un sous-chemin. `object-src 'none'` et `form-action 'self'` restent.

**À constater au navigateur** : la réécriture `ws:` → `wss:`, que la norme n'écrit pas.

### C7. Rapports de violation : actifs, reçus bornés

Actifs par défaut : ils rendent visibles les ruptures assumées de C1 et C2. Directives
`report-uri` ET `report-to`, en-tête `Reporting-Endpoints`, composés au démarrage. La réception
`POST` est publique (le navigateur n'envoie pas d'identifiants) et bornée : corps ≈ 8 Ko,
`Content-Type` vérifié, quota par adresse, URL expurgées de leur requête et de leur fragment
(la norme ne le fait pas, `w3c-reporting.bs` § « Strip URL for use in reports »), stockage en
mémoire seule (tampon circulaire), journal dédoublonné. La lecture
`GET /nodefony/security/api/csp-reports` est protégée et surfacée dans Studio, qui affiche les
champs comme du texte. `'report-sample'` n'est pas posé : l'extrait est une chaîne de
l'attaquant.

### C8. Trusted Types : signalés en développement, coupés en production

Clé `trustedTypes: "off" | "report" | "enforce"` ; défaut `report` en développement (second
en-tête `Content-Security-Policy-Report-Only`), `off` en production. Assumé : le défaut de
production ne protège pas des XSS par puits DOM. Les puits du framework (barre de debug, rendu
Markdown de Studio) passent par une politique qui assainit, ou par `textContent`, pour que le
bruit des rapports ne vienne pas de nous.

### C9. OAuth démarre par un lien

`form-action 'self'` est gardé sans origine de fournisseur : les boutons de la page de connexion
sont des liens GET, qu'une navigation ne soumet pas à `form-action`. Le patron « OAuth démarre
par un lien » est figé par un test sur le gabarit.

### C10. Scripts créés à l'exécution : interdits dans le framework

`'strict-dynamic'` fait confiance à tout script qu'un script autorisé crée. Une garde statique
(`scripts/gates/`) refuse `createElement("script")` et `document.write` dans le TypeScript des
paquets du framework ; liste d'exceptions déclarée, vide. Pas de garde sur les bundles
(forme minifiée instable) : Trusted Types en `report` (C8) détecte à l'exécution.

### C11. Portée : la politique suit le type de contenu

Choisie au `writeHead` unique, sur le type de la réponse :

| Type                                         | En-têtes                                                 |
| -------------------------------------------- | -------------------------------------------------------- |
| `text/html`, tout type XML (dont XHTML, SVG) | politique complète avec nonce, `Permissions-Policy`      |
| JavaScript                                   | politique complète SANS nonce (un worker prend celle-ci) |
| reste (JSON, images, CSS, polices, binaire)  | `default-src 'none'; frame-ancestors 'none'`, figée      |

Prérequis tenu : `X-Content-Type-Options: nosniff` est posé partout.

Précisions tranchées à la mise en œuvre (`securityHeaders.ts#responseKindOf`,
`Response.ts#HttpResponse.applyHeaderPolicy`) :

- **Le moment** : le pare-feu est ARMÉ sur la réponse au routage ; la réponse l'appelle à son
  `writeHead`, une fois le type fixé. Les réponses précoces (421, 429, refus CSRF) restent hors
  couche applicative, comme avant.
- **Les autres en-têtes suivent la même règle** : chacun part là où le navigateur le lit.
  `Referrer-Policy` et CORP partout ; COEP sur document et JavaScript ; COOP,
  `Origin-Agent-Cluster` et `Permissions-Policy` sur document seulement.
- **`frame-ancestors` de la politique courte** : celui de la politique complète, donc
  `http.frameOptions` (C5). Le défaut `DENY` donne exactement la chaîne figée ci-dessus ;
  `SAMEORIGIN` laisse un PDF ou une image encadrés par l'application.
- **Document = HTML ou tout type XML** (`text/xml`, `application/xml`, sous-type `+xml` —
  WHATWG MIME Sniffing §4.6), pas seulement XHTML et SVG : une page XML est rendue, et sous la
  politique courte un formulaire injecté n'y relèverait d'aucun `form-action` (que `default-src`
  ne couvre pas).
- **`304` du pipeline** : aucun en-tête applicatif. Ses en-têtes remplacent ceux de la
  représentation en cache (RFC 9111 §4.3.4) : une politique courte y réduirait la page, un nonce
  neuf la désaccorderait de ses balises. Un statique en `304` garde la politique de son `200`
  (posée avant que le serveur statique sache la copie fraîche) : sans effet, même politique et
  aucun nonce dans un fichier.
- **Sans contenu** (204, corps vide) : politique courte, même si un `Content-Type` y est posé.
- **Fichier statique** : écrit en natif par le serveur statique, son type se lit à l'extension.
  Extension inconnue (index d'un dossier) ou adresse finissant par `/` : politique complète,
  jamais une plus faible par défaut.
- **Ce que l'application écrit n'est jamais réduit** : une route `@Csp` garde SA politique quel
  que soit le type ; un en-tête posé à la main par un contrôleur gagne sur celui du pare-feu
  (`HttpResponse.setDefaultHeader`).

### C12. Contributions de modules : trop large = retirée, malformée = ignorée

- Source **trop large** dans une contribution de module (`*`, schéma réseau nu `http:` `https:`
  `ws:` `wss:`, hôte joker seul `https://*`) : la SOURCE est retirée de la politique, un
  avertissement nomme le module, la directive et la source (`csp.ts#isOverbroadSource`,
  `csp.ts#withoutOverbroadSources`). Acceptés : origine exacte, `*.domaine.tld`, `blob:`, `data:`.
- Contribution **malformée** (`;`, `,`, retour à la ligne, nom de directive — de quoi fabriquer
  une directive ou une seconde politique) : la contribution est ignorée EN ENTIER, une erreur
  nomme le module. Un `@Csp` de route malformé sert la politique de base. Échec fermé : la
  politique ne devient jamais plus permissive que demandé. `mergeCspFragments` reste pure et
  lève.
- La politique écrite par l'application dans sa configuration n'est jamais filtrée.

## Alternatives écartées

- **Nonce seul, sans `'strict-dynamic'`** : laisse ouvert le contournement par `'self'`.
- **Garder `style-src 'unsafe-inline'`** : laisse l'exfiltration par CSS injecté.
- **Déduire l'origine temps réel des ports d'écoute** : fausse derrière un proxy inverse.
- **`base-uri 'none'`** : casse des applications légitimes pour un gain nul face à `'self'`.
- **Stocker les rapports en base** : porte publique qui écrit sur disque ; le journal centralisé
  voit déjà tout.
- **Trusted Types appliqués par défaut** : les vues Vue et Svelte insèrent par `innerHTML`.
- **Refuser au démarrage une source trop large** : contredit C0 ; une faute de module que
  l'auteur de l'application ne peut pas corriger ne doit pas l'empêcher de démarrer.
- **`'unsafe-eval'` au défaut** pour une bibliothèque qui le réclame : ouvre l'injection de
  script à toutes les applications. Vite en développement reste une contribution de
  `@nodefony/frontend`, jamais le défaut.

## Conséquences

- **Rupture assumée (version majeure)** : un `<script src>` ou un `<style>` sans nonce dans un
  gabarit d'application cesse de s'appliquer ; une bibliothèque CSS-in-JS doit recevoir le
  nonce ; un avatar tiers hors de nos fournisseurs se déclare. La documentation donne le geste
  (`nonce="{{ nonce }}"`) ; les rapports de C7 rendent chaque rupture visible.
- **Coût** : les variantes de politique (type de contenu × TLS) sont composées au démarrage ; par
  réponse, un test sur le type et un sur le transport, une écriture d'en-tête. Mesuré au
  micro-banc `micro-write-head.mjs` et au gate mémoire de `@nodefony/http`.
- **Porte publique neuve** (réception des rapports) : ses vecteurs entrent dans la matrice
  d'attaque de `nodefony-security-review`.
- **Preuve finale** : un banc en navigateur réel, sous la politique par défaut, rend zéro
  violation sur la console d'administration, la page de connexion, une socket même origine et
  autre origine, un flux SSE, un parcours OAuth sous Chromium et Firefox, et les quatre vues de
  test bâties en production.
