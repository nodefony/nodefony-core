---
name: nodefony-security-review
description: >
  Relit la sécurité du code d'une application Nodefony avant le commit : un script sur le diff,
  puis une grille de jugement. Le script nomme, fichier et ligne, ce
  qu'un motif suffit à voir — route ouverte à l'anonyme ou hors de toute
  zone du pare-feu, mutation sans jeton anti-falsification, SQL interpolé, secret écrit ou
  journalisé, identité brute qui inclut l'anonyme, garde éteinte, redirection ouverte — avec le
  geste qui corrige et le skill qui le porte ; la grille couvre le droit sur l'objet, les champs
  renvoyés, les entrées non bornées. À charger AVANT de commiter une route,
  une requête, un service qui touche des données ou de la configuration de sécurité. Écrire la
  garde elle-même → `nodefony-protect-route`.
  Déclencheurs : "c'est sûr ?", "est-ce sécurisé ?", "relis la sécurité avant que je commite", "ma route est-elle
  protégée ?", "revue de sécurité", "relecture de sécurité", "audit de sécurité de mon code",
  "y a-t-il une faille", "injection SQL", "secret dans le code", "avant de commiter".
metadata:
  version: 1.0.0
---

# nodefony-security-review — relire avant de commiter, faute par faute

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`. Pas de `references/`, comme `nodefony-dev` et pour la même raison mesurée : une page
> de `references/` n'est presque jamais ouverte par un agent, un script cité comme commande l'est.
> Ce qui doit atteindre un agent s'EXÉCUTE ou vit dans ce corps.

## Passer la main

| Ce que tu fais en réalité                                               | Le skill                  |
| ----------------------------------------------------------------------- | ------------------------- |
| Tu poses la garde : zone, rôle, jeton anti-falsification, voter         | `nodefony-protect-route`  |
| Tu touches à la connexion : identité, second facteur, jeton d'un script | `nodefony-authentication` |
| Tu codes la fonctionnalité elle-même                                    | `nodefony-dev`            |
| Tu sors un secret du source : `env.ts`, `.env`, `npx nodefony env`      | `nodefony-dev`            |
| Quelque chose qui marchait ne marche plus                               | `nodefony-troubleshoot`   |
| Tu prépares l'image, les secrets du déploiement, le proxy TLS           | `nodefony-devops`         |

## 1. La règle — nommer, trancher, prouver

**Une relecture NOMME chaque point**, avec son fichier et sa ligne : « ça me paraît sûr » n'est
pas une relecture. Puis elle **tranche** chacun : corrigé, ou justifié par écrit (« cette route est
publique : c'est la page d'accueil »). Un point ni corrigé ni justifié reste ouvert, et se dit.

**Ne corrige jamais en affaiblissant.** Retirer une garde qui gêne, couper le jeton
anti-falsification, élargir une zone à l'anonyme, déplacer une URL sous une autre zone : le diff
redevient silencieux et la faille est plus grande qu'avant. Une URL déjà publiée ne se déplace pas
— on adapte la ZONE à l'URL (skill `nodefony-protect-route`).

## 2. Le script — ce qu'un motif suffit à voir

```bash
node node_modules/@nodefony/devkit/skills/nodefony-security-review/scripts/review-diff.mjs
node node_modules/@nodefony/devkit/skills/nodefony-security-review/scripts/review-diff.mjs --base main
node node_modules/@nodefony/devkit/skills/nodefony-security-review/scripts/review-diff.mjs --staged
node node_modules/@nodefony/devkit/skills/nodefony-security-review/scripts/review-diff.mjs --json
```

Sans option, il relit le **travail en cours** (non commité, fichiers non suivis compris) ; s'il n'y
en a pas, le **dernier commit** — la première ligne de sa sortie dit toujours ce qu'il a relu.
`--base main` relit toute une branche. Sorties : `0` rien à signaler · `1` au moins un point ·
`64` usage · `66` aucun diff lisible (pas un dépôt git : passe un patch avec `--diff`).

Chaque point sort avec son niveau, `fichier:ligne`, la raison et le geste :

- **`FAUTE`** — à corriger. Une faute qu'on garde exige une raison écrite, et elle est rare.
- **`À JUSTIFIER`** — légitime parfois, jamais par accident : une route publique voulue, une
  variable lue hors de `env.ts` pour une bonne raison. Corrige, ou écris la raison.

Un secret signalé est **masqué** dans l'extrait (quatre caractères, puis `…`). Ne le recopie pas
non plus dans ta relecture : nomme sa constante et sa ligne. Une valeur citée dans un compte rendu
versionné est publiée une fois de plus.

⚠️ **Il croise les routes NOUVELLES avec les zones du pare-feu** lues dans `nodefony/config/` — ce
que ni `doctor` ni `inspect` ne font. Dans une application générée, la zone `^/api` laisse passer
l'anonyme : une route ajoutée sous `/api` sans `@IsGranted` répond à n'importe qui, et rien
d'autre ne le dit. Il ne relit pas les tests (leurs secrets en dur sont des fixtures).

⚠️ **Un outil MCP échappe aux zones.** Ce qu'un module publie par `getMcpTools()` est servi par
`/nodefony/mcp`, qu'aucune zone du pare-feu ne couvre : tant que `mcp.authorization` n'est pas
déclaré, seules l'adresse locale et l'origine le gardent. Un outil qui rend des données de compte
ou qui ÉCRIT se relit comme une route ouverte.

## 3. La grille — ce qu'on cherche, ce qui le montre, ce qui le corrige

| Ce qu'on cherche                                                          | Ce qui le montre                   | Le geste juste                                                                                                                                                     |
| ------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Une route nouvelle que l'anonyme atteint (zone `anonymous`, ou hors zone) | le script (`route-open`)           | `@IsGranted("ROLE_…")`, ou une zone qui exige une session → `nodefony-protect-route`                                                                               |
| Une mutation sans `@CsrfProtect` sous une zone à session                  | le script                          | `@CsrfProtect()` ; le client sème le jeton par un `GET` → `nodefony-protect-route`                                                                                 |
| « Connecté ? » testé sur l'utilisateur brut                               | le script (`raw-identity`)         | `this.user` dans un controller → `nodefony-authentication`                                                                                                         |
| Une donnée reçue dans du SQL brut                                         | le script                          | le gabarit `` sql`… ${valeur}` `` de drizzle lie la valeur ; jamais `sql.raw` sur une entrée                                                                       |
| Un secret dans le source, un `.env` dans le diff                          | le script, puis `npx nodefony env` | variable `NF_…` déclarée dans `env.ts`, valeur dans le `.env` du poste, jamais commité ; `npx nodefony env` AVANT et APRÈS prouve qu'elle est lue → `nodefony-dev` |
| Un mot de passe, un jeton, un cookie dans le journal                      | le script                          | journaliser l'identifiant de l'objet, jamais la valeur                                                                                                             |
| Une garde éteinte (`rateLimit`, `unsafe-inline`, secret en clair)         | le script                          | régler un seuil, jamais éteindre → `nodefony-protect-route`                                                                                                        |
| Une redirection vers une adresse reçue                                    | le script                          | `safeRedirectPath(valeur)`, importé de `nodefony`                                                                                                                  |
| Un chemin de fichier, une commande composés avec une entrée               | le script                          | vérifier que le chemin reste sous sa racine ; `execFile` avec un tableau d'arguments, sans shell                                                                   |
| Un outil MCP publié (`getMcpTools()`), une porte MCP ouverte au réseau    | le script                          | lecture seule et rien qu'on ne lirait sans compte ; sinon `scopes` + `mcp.authorization` (`node_modules/@nodefony/devkit/docs/index.md`)                           |
| Ce qui était DÉJÀ ouvert avant ce diff (`@Anonymous`, zone publique)      | `npx nodefony doctor`              | famille « Surface ouverte » : l'inventaire, à relire                                                                                                               |
| Un secret suivi par git, une variable non déclarée                        | `npx nodefony doctor`              | familles « Secrets hors de git » et « Variables déclarées »                                                                                                        |
| Une dépendance à vulnérabilité connue                                     | `npm audit --omit=dev`             | monter la version corrigée ; jamais `--force` sans lire ce qu'il casse                                                                                             |

## 4. Ce que seul un jugement tranche

Le script ne voit pas l'intention. Relis ces trois points toi-même, sur chaque route touchée :

1. **Le droit sur l'OBJET.** Un rôle dit « peut éditer des documents », pas « peut éditer CE
   document ». Une route qui lit un identifiant dans l'URL (`/api/documents/:id`) et renvoie
   l'enregistrement sans vérifier qu'il appartient à l'appelant laisse chacun lire les données des
   autres en changeant un nombre. Le geste : un voter, `@IsGranted("doc.edit", { subject: "id" })`
   → `nodefony-protect-route`.
2. **Les champs RENVOYÉS.** Rendre l'entité entière (`this.renderJson(user)`) envoie aussi ce
   qu'on n'a pas choisi — l'empreinte du mot de passe (colonne `password` de `User`), les
   métadonnées internes, les rôles d'un autre compte.
   Rends un objet construit champ par champ.
3. **Les entrées NON BORNÉES.** Une liste sans plafond, une taille de page lue telle quelle, un
   fichier reçu sans limite de taille : une seule requête suffit à épuiser le serveur. Plafonne
   (`Math.min(limite, 100)`), et refuse ce qui dépasse plutôt que de le traiter.

## 5. Avant de dire « relu »

1. **Le script est relancé APRÈS les corrections** : il rend `0`, ou chaque point restant porte sa
   justification écrite dans ta réponse.
2. **`npx nodefony doctor`** ne signale rien de neuf.
3. **Une garde ajoutée est PROUVÉE** par trois appels — anonyme refusé, compte sans le rôle refusé,
   compte avec le rôle servi (skill `nodefony-protect-route`). Le refus de l'anonyme seul ne prouve
   rien : n'importe quelle zone le donne.
4. **Nomme ce que tu n'as pas relu** : `npm audit` non lancé, une route dont tu ne sais pas si elle
   doit être publique. Le dire coûte une ligne ; le taire, une faille.
