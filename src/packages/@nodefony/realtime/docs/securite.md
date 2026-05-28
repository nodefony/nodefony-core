---
slug: realtime-module/securite
title: "Sécurité de la socket — qui parle, qui peut quoi ?"
section: realtime-module
audience: developer,architect,devops,supervisor,admin
version: v0.1
status: draft
updated: 2026-05-28
source: src/packages/@nodefony/realtime/docs/securite.md
module: "@nodefony/realtime"
topic: security
tags:
  [
    realtime,
    websocket,
    security,
    handshake,
    authenticator,
    csrf,
    origin,
    jwt,
    zero-trust,
    p6,
  ]
---

# Sécurité de la socket — qui parle, qui peut quoi ?

> Cette page t'explique **comment Nodefony sécurise une connexion temps réel** —
> sans jargon. La sécurité d'une WebSocket n'est PAS la même chose que la sécurité HTTP :
> elle se joue à un moment précis (le **handshake**), puis se prolonge dans toutes les
> frames qui suivent.

---

## 🚪 L'analogie : la WebSocket, c'est une porte (pas un guichet)

| Modèle        | Comparaison physique                                                                                                                 | Sécurité                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HTTP**      | Un **guichet** : tu demandes un truc, on te répond, tu repars. Chaque requête est un nouveau ticket.                                 | On vérifie ton identité **à chaque requête**.                                                                                                           |
| **WebSocket** | Une **porte** que tu pousses **une fois**, puis tu restes dans la pièce et tu causes en permanence avec ceux qui sont à l'intérieur. | On vérifie ton identité **au moment où tu pousses la porte** (handshake). Une fois entré, c'est trop tard pour te demander tes papiers à chaque phrase. |

D'où **la règle d'or** :

> **L'authentification d'une socket se fait AU HANDSHAKE. Une seule fois. Puis on garde l'identité en mémoire et on l'utilise pour autoriser (ou refuser) chaque frame qui arrive ensuite.**

---

## 🧱 Les 4 questions de sécurité d'une socket

| Question                                           | Quand ?                | Qui répond ?                 | Analogie                                                                       |
| -------------------------------------------------- | ---------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| **(1) Cette personne vient-elle d'où je crois ?**  | Handshake              | `Origin check` (RFC 6455)    | « Tu sors bien de la file d'attente, ou tu débarques d'une fenêtre voisine ? » |
| **(2) Cette personne, c'est qui ?**                | Handshake              | `IRealtimeAuthenticator`     | Le **vigile** lit ta carte (cookie JWT, clé API, etc.).                        |
| **(3) A-t-elle le droit de pousser CETTE frame ?** | À chaque frame         | `beforeDispatch` + voters P6 | Une fois dedans, peux-tu vraiment monter au 4ᵉ étage VIP ?                     |
| **(4) Qui a fait quoi ?**                          | À chaque frame notable | `onFrameAudit`               | Le **registre du concierge** : qui est passé, qui a été refusé.                |

Les 4 questions correspondent aux **5 seams** dans le code (les seams 1 et 5 sont les 2 facettes de la question 3 + 4 dans le protocole — détails plus bas).

---

## 🔍 Vocabulaire sécurité (5 mots qui suffisent)

- **Handshake** = la poignée de main initiale entre client et serveur (1 requête HTTP `Upgrade`) qui négocie le passage en WebSocket. **Tout se joue ici.**
- **Token** (`IRealtimeToken`) = la **carte plastifiée** posée au cou de chaque connexion après le contrôle d'identité. Ne contient PAS le mot de passe, juste « qui tu es, quels droits tu as ».
- **Authenticator** (`IRealtimeAuthenticator`) = le **vigile à la porte**. Il lit le cookie / la clé / l'en-tête et te délivre une carte (ou te refuse l'entrée).
- **Matcher** (`IRealtimeAuthenticatorMatcher`) = la **règle d'affectation** : « si tu pousses la porte du `/admin/`, tu passes par le vigile-JWT ; pour `/chat/`, vigile-anonyme. »
- **Zero Trust** = principe par défaut. Tu n'as PAS de carte avant le contrôle. Un token est toujours posé (anonyme si rien d'autre) — ce qui change, c'est `isAuthenticated() === true/false`.

---

## 🎬 Le pipeline en 5 actes (handshake → 1ʳᵉ frame autorisée)

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │                  Le client pousse la porte                          │
   │           (HTTP GET /realtime  Upgrade: websocket)                  │
   └──────────────────────────┬──────────────────────────────────────────┘
                              ▼
   ┌───────────────────────────────────────────┐
   │ ACT 1 — Origin check (seam #4)            │
   │ « Tu viens bien de https://app.exemple ? »│
   │ Si non → close(4003, "origin not allowed")│
   └──────────────────────────┬────────────────┘
                              ▼
   ┌───────────────────────────────────────────┐
   │ ACT 2 — Matcher                           │
   │ « URL = /admin/* + host=admin.exemple →   │
   │   vigile JWT. Sinon vigile anonyme. »     │
   └──────────────────────────┬────────────────┘
                              ▼
   ┌───────────────────────────────────────────┐
   │ ACT 3 — Authenticator (seam #2)           │
   │ vigile.authenticate(handshake)            │
   │   = lit le cookie JWT, vérifie la         │
   │     signature, retourne un IRealtimeToken │
   │ Si throw → close(4001, "unauthorized")    │
   └──────────────────────────┬────────────────┘
                              ▼
   ┌───────────────────────────────────────────┐
   │ ACT 4 — Pose la carte au cou              │
   │ hub.setTokenForPeer(peer, token)          │
   │   = WeakMap interne, lookup O(1) ensuite  │
   └──────────────────────────┬────────────────┘
                              ▼
   ┌───────────────────────────────────────────┐
   │ ACT 5 — Welcome JSON-RPC                  │
   │ « Bienvenue, voici les canaux dispo. »    │
   │ La connexion est utilisable.              │
   └───────────────────────────────────────────┘
                              ▼
   ─── À PARTIR DE MAINTENANT, CHAQUE FRAME ENTRANTE ───
                              ▼
   ┌───────────────────────────────────────────┐
   │ Frame → JsonRpcPeer.receive()             │
   │   ↓                                       │
   │ beforeDispatch(frame, peer) (seam #1)     │
   │   = voters P6 lookup token → boolean      │
   │   false → -32001 "unauthorized"           │
   │   ↓                                       │
   │ Handler métier (controller)               │
   │   ↓                                       │
   │ onFrameAudit(reason, frame, peer) (seam #5)│
   │   = journal "qui a fait quoi"             │
   └───────────────────────────────────────────┘
```

---

## 🪡 Les 5 seams en détail (vulgarisé)

Un **seam** = un point de greffe. Le module realtime EXPOSE ces 5 hooks ; le module `@nodefony/security` (à venir, phase P6) viendra y BRANCHER sa logique. Aujourd'hui, sans P6, ils existent mais ne font rien (bypass 0 coût) — la socket fonctionne ouvertement, comme avant.

### Seam #1 — `beforeDispatch(frame, peer)` (dans `JsonRpcPeer`)

**Qui ?** Le **portier intérieur** : pour chaque frame qui arrive après la connexion, il décide si on la laisse passer au handler métier.

**Pourquoi sync ?** C'est le **hot path** — des milliers de frames/seconde. Un `await` ici coûterait une microtask Node (~50 ns) PAR frame + sérialiserait les frames d'une même connexion. La décision doit être prise **instantanément**, en lisant **uniquement la mémoire** (le token déjà posé au handshake, les metadata du handler `@IsGranted`).

**Branchement P6 :**

```ts
// Côté @nodefony/security (futur)
new JsonRpcPeer({
  // ...
  beforeDispatch: (frame, peer) => {
    const token = hub.getTokenForPeer(peer); // O(1) WeakMap
    const required = readIsGrantedMetadata(frame); // O(1) Reflect cache
    return voters.decide(token, required); // sync — décision mémoire
  },
});
```

### Seam #2 — `IRealtimeAuthenticator` (au handshake, dans le hub)

**Qui ?** Le **vigile à la porte**. Lit un credential (cookie JWT, clé API, mTLS) et produit un `IRealtimeToken`.

**Async OK** — on est au handshake (1× par connexion, cold path). On peut faire un `await db.user.findById(...)` sans craindre la latence par frame. Le **résultat** est ensuite mis en cache sur le peer pour que le seam #1 reste sync.

**Branchement P6 :**

```ts
// Côté @nodefony/security (futur)
class JwtRealtimeAuthenticator implements IRealtimeAuthenticator {
  readonly name = "realtime_jwt";

  supports(handshake) {
    return handshake.cookies.has("nf_jwt");
  }

  async authenticate(handshake) {
    const jwt = handshake.cookies.get("nf_jwt")!;
    const payload = await verify(jwt, secret); // jose — async
    return new JwtRealtimeToken(payload); // implements IRealtimeToken
  }
}
```

### Seam #3 — Matchers (`useAuthenticator(matcher, authenticator)`)

**Qui ?** La **carte d'affectation des vigiles** : pour chaque porte (URL/vhost), quel vigile applique ?

```ts
// API publique du module @nodefony/realtime — utilisable dès aujourd'hui
realtimeService.useAuthenticator(
  { pattern: "/admin/", host: "admin.example.com" },
  jwtAuthenticator,
);
realtimeService.useAuthenticator(
  { pattern: "/chat/" },
  anonymousAuthenticator, // ok pour le chat public
);
```

**Ordre = priorité.** Le 1ᵉʳ matcher qui matche capture la connexion. Convention : déclare les patterns **les plus spécifiques en premier**.

**Branchement P6 :** `@nodefony/security` lira `defineSecurityConfig().areas`, filtrera celles marquées `realtime: true` et appellera `useAuthenticator()` pour chacune au boot. Tu n'auras PAS à dupliquer la config — la même `areas` couvrira HTTP et WS.

### Seam #4 — Origin check (au handshake, RFC 6455 §10.2)

**Qui ?** La **vérification que tu sors bien de l'immeuble d'à côté, pas d'une fenêtre voisine**.

**Pourquoi ?** Une WebSocket peut être ouverte par n'importe quel site (`https://evil.com`) qui fait `new WebSocket("wss://app.exemple.com/realtime")` — et **les cookies de `app.exemple.com` y seront envoyés**, même avec `SameSite=Lax/Strict` (le navigateur traite parfois les WS comme du "top-level navigation"). Sans Origin check, `evil.com` pourrait piloter ta session WebSocket à ta place. **C'est l'équivalent du CSRF, mais pour la socket.**

**Config :**

```ts
defineRealtimeConfig({
  csrf: {
    checkOrigin: {
      enabled: true,
      allowList: [
        "https://app.example.com",
        "http://localhost:5151", // dev
      ],
      allowMissingOrigin: false, // browsers envoient TOUJOURS Origin
    },
  },
});
```

Politique **fail-closed** : si la config dit `enabled: true` et `allowList: []`, **tout** est refusé.

### Seam #5 — `onFrameAudit(reason, frame, peer)` (dans `JsonRpcPeer`)

**Qui ?** Le **registre du concierge** : journal append-only de tout ce qui a été notable (frame invalide, frame refusée, méthode inconnue, handler en erreur).

**Pourquoi le `peer` en 3ᵉ arg ?** Pour que le consumer (P6.14 `AuditEventEntity`) puisse retrouver l'**actor** (le token associé via `hub.getTokenForPeer(peer)`) — sinon un audit « frame refusée à 14:35:02 IP 1.2.3.4 » est inutile : on veut « frame refusée à 14:35:02 utilisateur `bob@exemple.com` ».

**Branchement P6.14 :**

```ts
new JsonRpcPeer({
  // ...
  onFrameAudit: (reason, frame, peer) => {
    const token = hub.getTokenForPeer(peer);
    auditEventRepo.create({
      ts: Date.now(),
      actor: token.getUserIdentifier(),
      reason, // "denied" | "invalid" | ...
      method: (frame as { method?: string }).method ?? "(none)",
    });
  },
});
```

---

## 🛡️ Politique Zero Trust appliquée à la socket

| Cas                                         | Conséquence                                                                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aucun authenticator enregistré              | Token = `ANONYMOUS_REALTIME_TOKEN` (gelé, `isAuthenticated()=false`). La connexion fonctionne — c'est aux **voters P6** de refuser les actions sensibles. |
| `authenticator.authenticate()` throw        | Connexion fermée (code 4001 `unauthorized`). Aucune frame n'arrivera jamais.                                                                              |
| Origin check actif + Origin non whitelistée | Connexion fermée (code 4003 `forbidden`).                                                                                                                 |
| Pas de matcher pour l'URL                   | Token = `ANONYMOUS_REALTIME_TOKEN` (fallback Zero Trust).                                                                                                 |
| `getTokenForPeer(peer)` sur peer inconnu    | Renvoie `ANONYMOUS_REALTIME_TOKEN` (jamais `null` — pattern fail-safe).                                                                                   |

**Conséquence pratique :** le code consumer (voters, audit) n'a **jamais** à se demander « et si pas de token ? » — il y a TOUJOURS un token. Code mort éliminé, raisonnement simplifié.

---

## ❓ Foire aux questions

### Pourquoi ne pas re-authentifier à chaque frame, comme en HTTP ?

Parce que c'est inutile et coûteux. Le credential (cookie JWT) ne change pas entre 2 frames d'une même connexion. Le re-vérifier reviendrait à re-lire la même carte d'identité tous les 50 ms — gaspillage CPU + I/O (si la vérif touche la base ou Redis pour la denylist).

**Le compromis Nodefony :**

- Vérifier 1× au handshake (peut être async, on peut taper la base)
- Cacher le token sur la WeakMap `peer → token`
- À chaque frame : lookup O(1) + décision sync (voters lisent uniquement la mémoire)

Si tu veux **invalider** un token (logout, compte compromis) → soit ferme la WS côté serveur (`conn.close()`), soit utilise une **denylist `jti`** au handshake (slot #3 forward-audit P6) + un signal cross-process via le backplane pour fermer toutes les connexions concernées.

### Et la rotation de clés JWT ?

Géré au niveau de l'**authenticator** (slot #2 forward-audit P6 : `kid` header + JWKS endpoint). Le module realtime n'a pas à savoir comment l'authenticator vérifie le JWT — il reçoit juste un `IRealtimeToken` valide ou un throw.

### Pourquoi pas de session stateful WS comme en HTTP P5 ?

Parce que **la connexion EST la session**. Tant que la WS est ouverte, l'identité ne change pas. Pas besoin d'un cookie de session séparé qui pointe vers un stockage Redis. La WeakMap `peer → token` joue ce rôle, en mémoire process, et meurt naturellement avec la connexion (GC).

### Multi-tenant ?

`IRealtimeToken.getAttribute("tenantId")` (slot #1 forward-audit P6). L'authenticator pose `tenantId` en attribut au moment de l'auth ; les voters le lisent pour autoriser ou non l'accès à un canal `chat:tenant-42:*`.

### Rate-limit par connexion ?

Au handshake (`authenticator.authenticate()` peut throw une `AuthenticationError` avec un compteur). Ou en seam #1 (`beforeDispatch`) avec un compteur token-bucket lu sur le peer (slot #8 forward-audit P6).

---

## 🔌 Comment P6 (security) va se brancher

```
┌──────────────────────────────────────────────────────────┐
│  @nodefony/security (P6 — à venir)                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │  defineSecurityConfig({                            │  │
│  │    areas: [                                        │  │
│  │      { pattern:"/admin/", authenticator:"jwt",     │  │
│  │        realtime: true },                           │  │
│  │      { pattern:"/chat/",  authenticator:"anon",    │  │
│  │        realtime: true }                            │  │
│  │    ],                                              │  │
│  │    authenticators: { jwt:..., anon:... }           │  │
│  │  })                                                │  │
│  └────────────────────┬───────────────────────────────┘  │
│                       │ au boot kernel                   │
│                       ▼                                  │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Lit les areas avec `realtime: true`             │    │
│  │  Pour chacune :                                  │    │
│  │    realtimeService.useAuthenticator(             │    │
│  │      { pattern, host },                          │    │
│  │      jwtRealtimeAuthenticator                    │    │
│  │    )                                             │    │
│  └──────────────────┬───────────────────────────────┘    │
│                     ▼                                    │
│  ┌──────────────────────────────────────────────────┐    │
│  │  hub.useAuthenticator + setOriginGuard           │    │
│  │  hub.getTokenForPeer (lookup voters)             │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

**Résultat :** tu écris **une seule fois** ta config sécu (`defineSecurityConfig`), elle couvre HTTP **et** WebSocket automatiquement. C'est l'intérêt de la séparation realtime-pur / security-greffé.

---

## ➡️ Pour aller plus loin

- [`architecture.md`](./architecture.md) — la pile 5 étages où vivent les seams
- [`vocabulaire.md`](./vocabulaire.md) — les 12 mots de la socket
- [`configuration.md`](./configuration.md) — le builder `defineRealtimeConfig` complet
- **Mémoire IA** `project_p13_realtime_finish_plan` §🪡 — tableau des 5 seams + branchement P6
- **Mémoire IA** `project_p6_security_kit` — kit P6 forward-audit (9 slots anti-refonte)
