# Portabilité — écrire du code qui tourne sur les 3 plateformes

> _Maintenance_ : édition en place, jamais de journal (l'historique vit dans `git log`). Les
> axiomes courts vivent dans le `CLAUDE.md` racine, lu à chaque tour ; **ce fichier porte les
> recettes, les preuves et la méthode d'épreuve** — ne pas les y recopier, sinon il n'est
> jamais ouvert.

Windows est un **impératif produit**, au même titre que linux et macOS. Ce qui suit a été payé
par un chantier entier, dont un défaut qui empêchait le Kernel de charger le moindre module :
tout compilait, rien ne s'exécutait.

---

## 1. Chemins — la question qui tranche : « qui va le lire ? »

Un chemin **voyage** (quelqu'un d'autre le lira) ou **s'ouvre** (le système le lira). Les deux
grammaires ne se mélangent pas, et le tri se fait au moment de l'écriture.

| Le chemin part vers…                                                                      | Grammaire             |
| ----------------------------------------------------------------------------------------- | --------------------- |
| un `import()`, une URL, un `file:` — bref un **spécificateur de module**                  | URL (`pathToFileURL`) |
| une **clé d'entrée de bundler**, un nom de sortie, une entrée d'`exports` du package.json | `/` (POSIX)           |
| un document **généré** ou versionné (doc, `AGENTS.md`, ancre `fichier:ligne`)             | `/` (POSIX)           |
| un `readFile`, `mkdir`, `rm`, `spawn({cwd})` — le **disque**                              | natif (`path.join`)   |
| un **message d'erreur** qu'un humain va coller dans son terminal                          | natif                 |

### Normaliser AVANT de filtrer, pas seulement avant de nommer

C'est l'erreur qui coûte le plus cher, parce qu'elle est SILENCIEUSE :

```ts
// ❌ le filtre parle POSIX, l'entrée arrive en natif → l'exclusion ne mord jamais
files.filter((f) => !/(^|\/)tests\//u.test(f)).map(toPosix);

// ✅ POSIX d'abord : tout ce qui suit parle la même langue
files.map(toPosix).filter((f) => !/(^|\/)tests\//u.test(f));
```

Vécu (`nodefonyInput`, cœur) : sous Windows les fichiers de test **entraient dans le paquet
publié**, et les chunks sortaient nommés `nodefony\src\x.js` — introuvables par les `exports`.
Rien ne le signalait ; on l'a vu dans les journaux d'un build de CI, à l'œil.

### `import()` prend une URL, pas un chemin

`D:\app\index.js` a un `d:` qui est un **schéma d'URL syntaxiquement valide** → Node refuse
(`ERR_UNSUPPORTED_ESM_URL_SCHEME`). Passer par le helper unique `toImportSpecifier`
(`kernel/resolveModuleEntry.ts`) ; l'absoluité s'y teste AVANT toute lecture de schéma, sinon on
reprend `d:` pour un protocole.

---

## 2. Process — ce que Windows n'a pas

### Pas de groupes

`process.kill(-pid)` n'existe pas. La seule voie est `taskkill /PID <pid> /T /F`, qui descend la
**filiation** au lieu du groupe — d'où un enfant spawné `detached: false` sous Windows (le
rattachement est ce qui rend l'arbre atteignable), et `detached: true` sous POSIX (leader de
groupe). Une seule implémentation porte les deux : **`signalProcessGroup`** (`devProcess.ts`,
exportée par le cœur). Ne jamais écrire un `child.kill()` de plus dès qu'il peut y avoir des
petits-enfants (Vite → esbuild, superviseur → serveur → Vite).

### Pas d'arrêt gracieux d'arbre — à ÉNONCER

`taskkill` sans `/F` poste un `WM_CLOSE` aux **fenêtres**, qu'un process console n'a pas : la
demande polie n'arrive nulle part. `/F` est donc une nécessité, pas un choix. Le verdict le dit
(`group` / `forced-tree` / `single` / `gone`) au lieu de le masquer derrière un `SIGTERM` qui n'en
aurait que le nom — et `single` (les descendants survivent) se signale à l'utilisateur.

### Un dossier occupé ne se supprime pas

Windows refuse de supprimer un dossier tant qu'un process l'a pour **répertoire courant** →
`EPERM`, typiquement dans un `finally`, sur un test dont toutes les assertions sont passées.
Le remède est l'ORDRE, pas le nombre de réessais : attendre la mort EFFECTIVE (`waitAllDead`),
puis supprimer ; `maxRetries`/`retryDelay` de `rmSync` ne sont qu'une ceinture.

### Une capacité se CONSTATE

Ne jamais répondre « je ne peux pas » d'après `process.platform`. Rendre `{supported, data}`
depuis l'EXÉCUTION (binaire absent, code de sortie, sortie illisible). Le pari « ce n'est pas
Windows, donc `ps` existe » est faux là où ça compte le plus : `procps` n'est pas installé dans
les images Node minces (`node:*-slim`, distroless), qui SONT le modèle de déploiement.
Pour identifier un process, `identifyProcess` couvre les deux mondes (`ps` / `tasklist`).

### Divers

- **Permissions POSIX** : `chmod 600` n'existe pas — aucune garantie de sécurité ne doit reposer
  dessus sans repli explicite et annoncé.
- **Scripts npm** : `VAR=1 cmd` est de la syntaxe POSIX que `cmd.exe` refuse → `cross-env`.
- **Scripts shell** de banc (`lsof`, `seq`, `curl`) : ne peuvent pas quitter ubuntu. Un contrôle
  qui doit valoir partout s'écrit en **Node pur**.

---

## 3. Éprouver une plateforme qu'on n'a pas — 3 leviers

1. **Rendre la fonction PURE et injecter la grammaire.** `path.win32` reproduit le mécanisme
   depuis n'importe quel système. C'est ainsi qu'on a prouvé qu'un `resolve()` rendait `\a\b` là
   où le test attendait `/a/b`, sans attendre la CI.
2. **Injecter le VERDICT plutôt que lire l'environnement** (`discoverySupported` en paramètre,
   `killTreeCommand(pid, platform)`, une écriture asynchrone injectable) → le comportement « privé
   d'observation » ou « en pleine course » se teste partout. Un test qui lit `process.platform` ne
   peut éprouver qu'une seule plateforme.
3. **Écrire le test en Node pur** pour qu'il tourne dans le job qui, lui, est sur la plateforme
   visée.

### Écrire l'assertion

```ts
// ❌ ment sur une plateforme
assert.ok(p.endsWith("node_modules/.cache/nodefony/cli-manifest.json"));

// ✅ aussi strict, et vrai partout — on exige LE séparateur du système
assert.ok(
  p.endsWith(
    path.join("node_modules", ".cache", "nodefony", "cli-manifest.json"),
  ),
);
```

🚫 **Accepter « l'un ou l'autre séparateur » n'est jamais la réponse** : c'est assouplir un test
pour qu'il passe. On compose l'attendu comme le code le compose.

---

## 4. Lire les résultats — les pièges qui font conclure faux

- **« Ça compile » ne prouve rien.** Les jobs de vérification Windows étaient verts pendant que le
  Kernel ne chargeait aucun module. Seul un contrôle qui EXÉCUTE tranche.
- **Un rouge peut en masquer plusieurs** : un `beforeEach` qui fait `ctx.skip()` sur port occupé
  transforme les suivants en `skipped`, état qui se lit « rien à signaler ». Lire les `skipped`
  autant que les `failed`, surtout quand un compteur s'améliore d'un coup.
- **Si le contrôle positif tombe, c'est le DÉCOR**, pas N défauts distincts.
- **Le rouge annoncé n'est pas le rouge réel** : relire le run COURANT avant de reprendre une
  liste (`gh run list --branch <b>`, `gh api repos/:owner/:repo/actions/jobs/<id>/logs`, puis
  `sed 's/\x1b\[[0-9;]*m//g'`). Et l'ouvrir en ENTIER : trois rouges ont été crus disparus parce
  qu'ils vivaient dans un job qu'on n'avait pas ouvert.
- **Une défaillance qui en empêche d'autres de parler coûte plus qu'elle-même** : `turbo run test`
  interrompait les tâches en cours à la première qui tombe, et le paquet le plus long — le cœur —
  n'affichait jamais son récapitulatif. D'où `--continue` sur les trois suites.
