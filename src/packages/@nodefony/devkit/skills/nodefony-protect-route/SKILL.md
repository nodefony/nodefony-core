---
name: nodefony-protect-route
description: >
  Réserve une route d'une application Nodefony aux personnes habilitées, par les briques du
  framework plutôt que par un contrôle écrit à la main dans l'action. Porte les deux étages
  (zone du pare-feu et garde par route), la hiérarchie de rôles qui évite d'attribuer un rôle de
  plus, la façon d'ouvrir une route à un partenaire sans démonter la défense anti-falsification,
  et les gestes qui affaiblissent l'application en silence. À charger AVANT de poser une garde,
  d'ouvrir une route à un tiers, ou de toucher à la configuration de sécurité.
  Déclencheurs : "protège cette route", "réserver aux administrateurs", "@IsGranted", "firewall",
  "zone protégée", "403", "401", "un rôle qui en implique un autre", "roleHierarchy",
  "un partenaire doit pouvoir poster", "erreur CSRF", "origine refusée", "@CsrfExempt",
  "API pour un programme", "clé d'API", "désactiver la sécurité pour tester".
---

# protect-route — la garde vient du framework, jamais de l'action

> ⚖️ **La confiance n'exclut pas le contrôle.** Une route qui « répond 403 quand je teste » n'est
> pas une route protégée. Le seul juge est un appel avec **trois identités**.

## Deux étages, et ils ne font pas la même chose

| Étage                | Où                                      | Ce qu'il protège                          |
| -------------------- | --------------------------------------- | ----------------------------------------- |
| **zone du pare-feu** | `nodefony.config.ts`, `firewalls.areas` | un **espace** : `pattern: "^/api/secure"` |
| **garde par route**  | `@IsGranted("ROLE_X")` sur l'action     | **une** route précise                     |

Les deux se combinent : la zone décide **qui entre**, la garde décide **qui fait**.

```ts
@Get("/api/reports")
@IsGranted("ROLE_REPORTS")
async list() { … }
```

🔴 **Le `pattern` d'une zone est un PRÉFIXE, jamais la liste des routes du jour.**

```ts
pattern: "^/api/account"; // ✅ l'espace
pattern: "^/api/account/(profile|invoices)"; // ❌ les routes d'aujourd'hui
```

Énumérer marche à l'essai et passe la revue. Puis quelqu'un ajoute
`/api/account/payment-methods` — et elle **naît publique**. Rien ne le signale : la zone existe,
elle a l'air de couvrir l'espace, et l'introspection montre bien une route protégée à côté. Quand
des routes partagent un préfixe, ne les protège pas une par une.

## 🔴 Ce qu'il ne faut jamais écrire

```ts
// ❌ contrôle artisanal — invisible au pare-feu, à l'audit et à l'introspection
if (!this.context?.user?.roles.includes("ROLE_ADMIN")) {
  return this.renderJson({ error: "forbidden" }, 403);
}
```

Le framework refuse **avant** d'entrer dans l'action. Un test écrit dans l'action s'oublie sur la
route suivante, ne se voit pas dans `inspect routes`, et ne protège rien qu'on n'ait pensé à
protéger.

## Un rôle qui en implique un autre

Un administrateur doit pouvoir consulter la facturation **sans** qu'on lui attribue un rôle de
plus. Ça se déclare une fois, dans le manifeste :

```ts
roleHierarchy: {
  ROLE_ADMIN: ["ROLE_BILLING", "ROLE_REPORTS"],
}
```

**Ne recopie pas le rôle sur le compte administrateur au moment du semis** : ça marche pour ce
compte-là, et pour aucun autre — la relation entre les rôles n'existe alors nulle part.

## Ouvrir à un partenaire sans démonter la défense

Une origine tierce qui poste reçoit un refus : c'est la défense anti-falsification qui fait son
travail. **Le geste juste est de DÉCLARER l'origine**, jamais de retirer la défense :

```ts
csrf: {
  trustedOrigins: ["https://partenaire.example"],
}
```

🔴 `@CsrfExempt`, `csrf.enabled: false`, ou couper le contrôle de provenance **résolvent le
symptôme et ouvrent l'application** : n'importe quel site peut alors faire poster le navigateur
d'une personne connectée, à son insu et avec ses droits.

Deux précisions qui décident du résultat :

- la comparaison porte sur l'origine **ENTIÈRE** (`scheme://host[:port]`) — ni joker, ni
  sous-domaine implicite : **une origine par entrée**, et `https://x.example` ne couvre pas
  `https://api.x.example` ;
- `cors.origins` n'est **pas** la même clé et ne remplace pas celle-ci : elle autorise EN PLUS
  le JS du tiers à **lire** tes réponses. Un partenaire qui POSTE n'en a pas besoin — et les deux
  se traversent sans se suppléer.

Détail : `node_modules/@nodefony/security/docs/csrf.md`.

## Créer un compte

```bash
npx nodefony security:user:add <identifiant>
```

**N'insère jamais un utilisateur directement en base** : le mot de passe doit passer par
l'encodeur du framework. Une ligne posée à la main produit un compte qui ne pourra pas se
connecter — ou pire, un mot de passe stocké en clair.

## Lire l'utilisateur courant

Le paramètre décoré `@CurrentUser()` (typé `IUser` de `@nodefony/user`). L'identité est
**ré-résolue à chaque requête** : les rôles sont frais, et une révocation prend effet tout de
suite. N'écris pas ton propre lecteur de session — le tien lira un instantané.

## Un droit métier qui ne se réduit pas à un rôle

« L'auteur peut éditer SON document » ne s'exprime pas avec un rôle : la réponse dépend de
l'objet. Ça s'écrit en **voter**, enregistré par `registerVoterFactory`, et appelé par la garde
habituelle :

```ts
@IsGranted("doc.edit", { subject: "id" })
```

C'est le point d'extension prévu — il n'y a **pas** de table de permissions à inventer, ni de test
d'appartenance à écrire dans l'action.

## Une API pour un PROGRAMME, pas pour un navigateur

Un service partenaire, un script, un agent ne stockent aucun cookie. **La zone est déjà posée**
dans le `nodefony.config.ts` généré :

```ts
machine: {
  pattern: "^/api/machine",
  authenticators: ["apikey"], // PAS "session" — ce client n'a pas de cookie
  stateless: true,            // false ⇒ l'app ouvre une session qu'il ne renverra jamais
}
```

Fais donc **tomber ta route sous `/api/machine`** plutôt que d'ajouter une zone : celle-ci est
déjà réglée, et une seconde zone au pattern plus court la coifferait sans prévenir — le pare-feu
trie par longueur de pattern.

⚠️ `stateless: false` (le défaut) **ne fait pas échouer l'essai**, et c'est tout le piège : depuis
un navigateur ou un `curl -c`, le cookie posé revient aux requêtes suivantes et tout semble
marcher. Le vrai client ne stocke rien : il repart **anonyme** à chaque appel, et le défaut
n'apparaît qu'en production, en 401 intermittents. Ajouter `"session"` à côté de `"apikey"`
produit le même défaut, en plus discret. Règle : **un appelant qui ne stocke pas de cookie ne doit
rien recevoir qu'il faille stocker.**

Les clés s'émettent par `POST /nodefony/security/api/keys`.

## Les gestes qui affaiblissent en silence

Bloqué par une garde en résolvant autre chose, le réflexe est de la retirer. La fonctionnalité
marche, les tests passent, et le diff ne contient aucune faute visible — il contient un manque.

| À ne pas faire                                      | Ce que ça ouvre                                |
| --------------------------------------------------- | ---------------------------------------------- |
| `'unsafe-inline'` dans `script-src`                 | l'exécution de n'importe quel script injecté   |
| `@BypassFirewall`, `@Anonymous`                     | la route sort de sa zone                       |
| `anonymous` ajouté aux authentificateurs d'une zone | toute la zone devient publique                 |
| `rateLimit: { enabled: false }`                     | le bourrage de mots de passe redevient gratuit |

Relever un **seuil** est un réglage légitime. L'**éteindre** ne l'est pas.

## Prouver — trois identités, pas une

Le refus d'un anonyme est gratuit : n'importe quelle zone le donne. Ce qui prouve, c'est le
**deuxième** appel :

```bash
npx nodefony security:user:add            # un témoin SANS le rôle
# 1. anonyme            → refusé (401 ou 403 : les deux sont justes)
# 2. connecté SANS rôle → refusé      ← celui-ci porte l'information
# 3. administrateur     → servi
npx nodefony inspect routes --json        # la garde est-elle sur la route qu'on croit ?
```

## Voisins

| Besoin                         | Skill                           |
| ------------------------------ | ------------------------------- |
| Une ressource complète stockée | `nodefony-add-crud`             |
| Un service métier injectable   | `nodefony-add-service`          |
| Un flux temps réel réservé     | `nodefony-add-realtime-channel` |
