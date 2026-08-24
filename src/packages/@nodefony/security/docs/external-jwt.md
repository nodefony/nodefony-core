---
title: "Jetons d'un émetteur TIERS — accepter Keycloak, Auth0 ou Entra sans leur céder l'application"
lang: fr
module: "@nodefony/security"
topic: external-jwt
coverageModule: security
coverageFiles: "ExternalJwtAuthenticator,accessTokenVerifier,authenticatorRegistry"
section: "Sécurité"
audience: [developer, devops]
tags: [security, jwt, oauth2, resource-server, rfc9068, rfc8707, keycloak]
status: stable
version: "10.0.0"
updated: 2026-08-24
source: "src/packages/@nodefony/security/nodefony/src/authenticator/ExternalJwtAuthenticator.ts"
---

# Accepter les jetons d'un émetteur tiers

📍 [Documentation](../../../../../docs/index.md) › [Sécurité](index.md) › **Jetons d'un émetteur tiers**

Une application Nodefony sait émettre ses propres jetons ([Jetons](tokens.md)). Cette page traite du
cas inverse : **un serveur d'autorisation extérieur** — l'annuaire de l'entreprise, Keycloak, Auth0,
Entra ID — émet les jetons, et l'application doit décider qui entre. Elle devient alors ce que les
normes appellent un **serveur de ressources** (RFC 6750, RFC 9068).

C'est le mode d'une API appelée par d'autres services, par des agents, ou par une application dont
l'authentification est centralisée ailleurs.

## Ce que l'application NE délègue pas

Accepter un émetteur ne veut pas dire lui remettre les clés. Deux décisions restent locales, et ce
sont elles qui font la différence entre « intégrer un annuaire » et « en faire l'unique autorité
d'accès » :

1. **La liste des émetteurs acceptés** est une allowlist (`config.ts:660`). Un jeton dont l'`iss` n'y figure pas est
   refusé **avant toute requête sortante** — l'application ne va pas interroger un émetteur inconnu.
2. **Le sujet du jeton ne devient pas d'office un utilisateur** (`config.ts:666`). Par défaut, il
   doit correspondre à un compte local. Un annuaire d'entreprise vaut pour des milliers de personnes : les accepter
   toutes parce que leur jeton est valide supprimerait la seconde décision, qui est la raison d'être
   du pare-feu.

## Démarrage rapide

```ts
// nodefony.config.ts
security: {
  resourceServer: {
    issuers: [
      {
        issuer: "https://auth.example.com/realms/mon-royaume",
        algorithms: ["RS256"],
      },
    ],
  },
}
```

Cela suffit : les clés publiques de l'émetteur sont découvertes par ses points de métadonnées
normalisés (RFC 8414 / OpenID), et le pare-feu accepte désormais un `Authorization: Bearer <jeton>`
émis par ce royaume — **à condition que le sujet du jeton corresponde à un compte local**.

> **L'audience n'est pas facultative.** Un jeton émis pour une autre application du même annuaire ne
> doit pas ouvrir celle-ci : c'est le rôle du claim `aud` (RFC 8707). La vérification l'exige.

## Les réglages, et ce qu'ils engagent

| Réglage                    | Défaut                    | Ce qu'il décide                                                                                                                                       |
| -------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issuers[].issuer`         | —                         | L'allowlist. En `https`, sans requête ni fragment (RFC 8414 §2).                                                                                      |
| `issuers[].jwksUri`        | découvert                 | Déclaré, aucune découverte n'a lieu — utile pour un émetteur sans métadonnées, ou un démarrage à froid sans requête sortante.                         |
| `issuers[].algorithms`     | `RS256`, `ES256`, `EdDSA` | Allowlist **serveur** : l'algorithme n'est jamais déduit de l'en-tête du jeton (RFC 8725 §3.1). À restreindre à ce que l'émetteur utilise réellement. |
| `issuers[].typ`            | non exigé                 | `at+jwt` pour un émetteur conforme RFC 9068.                                                                                                          |
| `issuers[].requiredClaims` | `[]`                      | Claims dont la présence est exigée, en plus d'`iss` et `aud`.                                                                                         |
| `issuers[].subjectMapping` | `prefixed`                | Comment le `sub` devient un identifiant local — **voir l'encadré ci-dessous**.                                                                        |
| `subjectPolicy`            | `require`                 | `require` : un compte local est exigé. `ephemeral` : l'appelant vit le temps de la requête.                                                           |
| `ephemeralRoles`           | `[]`                      | Rôles accordés en mode `ephemeral`. Vide à dessein.                                                                                                   |

### 🔴 `subjectMapping` — pourquoi le défaut est `prefixed`

Un `sub` n'est unique que **dans l'espace de son émetteur** (OIDC Core §2). L'identité est donc la
paire `(émetteur, sujet)`, jamais le sujet seul.

En mode `prefixed` (`config.ts:650`), l'identifiant cherché localement est `<issuer>#<sub>` : deux émetteurs ne peuvent
pas se disputer un compte, et surtout **aucun sujet étranger ne peut tomber par hasard sur un
identifiant local existant**. En mode `subject`, le `sub` est cherché tel quel — dans un annuaire où
l'utilisateur choisit son identifiant, quelqu'un peut alors se présenter avec `sub: "admin"` et être
rattaché au compte local du même nom.

`subject` ne se déclare donc que si l'on maîtrise l'espace de noms de cet émetteur : typiquement
parce qu'il **est** cette application, ou parce que ses sujets sont déjà des identifiants locaux.

### `subjectPolicy` — qui a le droit d'exister

- **`require`** (défaut) — le sujet doit correspondre à un compte local (`loadUserByIdentifier`).
  Absent, désactivé ou verrouillé : l'accès est refusé. C'est le mode d'une application dont les
  utilisateurs existent chez elle, l'émetteur ne servant qu'à les authentifier.
- **`ephemeral`** — aucun compte local n'est exigé ni créé ; l'appelant vit le temps de la requête
  avec les rôles d'`ephemeralRoles` (`config.ts:672`). C'est le mode de l'appelant **purement machine** : un agent, un
  service. Sans rôle déclaré, il ne passe aucun `@IsGranted` et n'est autorisé que par ses **scopes**
  — qui viennent du jeton, donc bornés par le serveur d'autorisation.

> Écrire un rôle dans `ephemeralRoles` accorde un pouvoir local à quiconque détient un jeton valide
> pour cette ressource. À faire sciemment, jamais par confort.

## Comment ça s'articule

Le service `accessTokenVerifier` n'est posé au conteneur **que si `issuers` n'est pas vide** — il n'y
a pas de drapeau `enabled` qui permettrait « activé sans émetteur ». Une porte protégée par des
jetons tiers, dans une application qui n'en déclare aucun, **refuse de servir** plutôt que d'accepter
des porteurs qu'elle ne sait pas lire.

L'authentificateur `external-jwt` (`authenticatorRegistry.ts:118`) reconnaît les jetons qui le
concernent d'après la liste d'émetteurs, puis délègue la vérification au service — qui refait le contrôle sur sa propre liste.
La liste sert donc à deux choses : router, et dire dans quel espace de noms lire le sujet.

```ts
firewall: {
  api: {
    pattern: "^/api",
    stateless: true,
    authenticators: ["external-jwt"],
  },
}
```

## Ce que l'application publie d'elle-même

Une ressource protégée doit dire **où obtenir un jeton valable pour elle**. C'est l'objet des
métadonnées de ressource protégée (RFC 9728), servies par l'application, et de l'en-tête
`WWW-Authenticate` renvoyé sur un refus. Un client conforme y trouve seul l'émetteur à interroger et
l'audience à demander.

## ⚠️ Pièges

- **Une panne de l'émetteur est un `503`, jamais un `401`.** Si les clés publiques sont
  injoignables, l'application ne sait pas si le jeton est valide — répondre « refusé » ferait passer
  une panne d'infrastructure pour un problème d'identifiants, et enverrait le porteur légitime
  chercher au mauvais endroit. Le message de refus est **constant** ; la cause vit dans le journal.
- **L'audience vient de la ZONE, pas de l'authentificateur.** Elle est exigée au boot
  (`validateArea`) : le pare-feu ne connaît aucun nom en dur, et une zone sans ressource déclarée ne
  démarre pas.
- **L'ordre des authentificateurs dans la zone ne décide de rien** entre `jwt` et `external-jwt` :
  l'aiguillage se fait sur l'`iss` du jeton. Inutile de les ranger « dans le bon ordre ».
- **`HS256` est impossible en configuration**, et ce n'est pas un oubli : un secret partagé ferait de
  l'application un émetteur autant qu'un vérificateur. Seules des clés publiques sont acceptées.
- **`issuers` vide n'est pas « désactivé par erreur »** : c'est le défaut, et il fait qu'une zone
  protégée par jetons tiers refuse de servir plutôt que d'accepter des porteurs illisibles.

## 📖 Lexique

| Terme                     | Ce que ça désigne ici                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| **Émetteur** (`iss`)      | Le serveur d'autorisation qui a signé le jeton. Identifiant en `https`, sans requête ni fragment.   |
| **Audience** (`aud`)      | Pour QUI le jeton a été émis. Un jeton destiné à une autre application ne doit pas ouvrir celle-ci. |
| **Sujet** (`sub`)         | Qui est le porteur, **dans l'espace de noms de son émetteur** — jamais unique en soi.               |
| **JWKS**                  | Le jeu de clés publiques de l'émetteur, qui permet de vérifier la signature sans secret partagé.    |
| **Serveur de ressources** | Le rôle que joue l'application : elle vérifie des jetons qu'elle n'a pas émis (RFC 6750).           |
| **Scope**                 | Ce que le serveur d'autorisation a autorisé. Distinct d'un **rôle**, qui est une décision locale.   |

## 🧪 Tests & couverture

- **unit** : `externalJwtAuthenticator` (espace de noms du sujet, refus d'un `iss` hors allowlist),
  `remoteJwtVerifier` (signature, audience, panne de l'émetteur), `protectedResourcePublication` et
  `protectedResourceChain` (ce que la ressource publie d'elle-même, RFC 9728), et
  `protectedResourceRoutes` côté framework ;
- **intégration, sur un serveur réel** : `external-jwt.test.ts` éprouve la PANNE (l'émetteur ne
  répond pas), `external-jwt-e2e.test.ts` joue la boucle entière — l'application se déclarant
  elle-même émetteur de confiance, ce qu'elle peut faire depuis qu'elle publie ses métadonnées.

Les chiffres exacts vivent dans la carte de l'aperçu, régénérée depuis vitest — jamais figés ici.

## Pour aller plus loin

- ⬆️ **Retour au hub** : [Sécurité — vue d'ensemble](index.md) · [Toute la documentation](../../../../../docs/index.md)
- [Jetons](tokens.md) — l'émission par l'application elle-même, le keystore, la révocation.
- [OAuth2](oauth2.md) — « se connecter avec GitHub » : un flux d'authentification, pas un serveur de
  ressources.
- [Clés d'API](api-keys.md) — le porteur opaque, révocable, quand il n'y a pas de serveur
  d'autorisation.
- [Pare-feu](firewall.md) — zones, `stateless`, ordre des authentificateurs.
