# Décor d'un run : quel AGENT, et quelle PORTE MCP

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`. Une leçon durable devient une règle d'une section.

Deux réglages indépendants décident de ce qu'un run mesure : **qui** travaille (l'agent) et **ce
qu'il trouve** en arrivant (la porte MCP). Les confondre produit des comparaisons fausses — un agent
mieux outillé qu'un autre n'est pas un agent meilleur.

## 1. La porte — `NF_DEVKIT_BENCH_MCP`

| Régime                | Ce que l'agent trouve                                                                    | Ce que ça mesure                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `eteint` **(défaut)** | porte déclarée dans `.mcp.json`, **aucun jeton** ; le décor ne démarre pas l'application | le cas le plus fréquent : on ouvre un dépôt, rien ne tourne — **sauf si la tâche a une prémisse qui démarre** (§ 5) |
| `auth`                | jeton émis **et** application démarrée                                                   | l'utilisateur outillé, celui que `create app` câble                                                                 |
| `off`                 | aucune déclaration                                                                       | le devkit sans MCP du tout                                                                                          |

⚠️ **« arrêtée » décrit le MONTAGE, pas chaque tâche.** Plusieurs tâches démarrent l'application par
leur `prepare` (la 9 la première) : sur celles-là, `eteint` ne mesure pas une porte morte mais une
porte **anonyme**. Ce que le banc annonce se lit sur le CONSTAT imprimé avant l'agent, jamais sur le
nom du régime — c'est ce qui a fait passer 8 appels MCP réussis pour une contradiction (§ 5).

**`eteint` reste le défaut** : la référence (`baseline.json`) a été établie dessus, et la changer
d'office rendrait toute comparaison fausse. Le régime entre dans le décor enregistré ; le dépistage
REFUSE de comparer deux régimes (sortie 78), comme il le doit.

🔴 **`auth` implique de DÉMARRER l'application, et ce n'est pas une option** : la porte est une
ROUTE. Jeton parfait + application éteinte = agent muet, et l'on croirait mesurer l'outillage.

⚠️ **En `auth`, la tâche 5** (« démarre puis arrête le serveur ») trouve un serveur déjà là : son
verdict ne vaut rien dans ce régime. Le banc le DIT au lieu de le taire.

### Quatre pièges du décor authentifié, tous payés

1. **L'audience.** Une application ne peut émettre un jeton que pour une ressource déclarée
   (`security.jwt.audiences`, RFC 8707). Le gabarit d'app la pose désormais ; le dépôt, lui, la
   tenait d'un module de BANC — ce qui masquait le trou pour toutes les apps générées.
2. **L'ORDRE : construire avant d'émettre.** Le CLI lit la configuration dans le `dist`. Sans build,
   l'audience n'existe pas encore pour lui, et le refus (`invalid_target`) accuse le jeton alors que
   la cause est l'ordre.
3. **L'ORDRE, encore : démarrer APRÈS la prémisse.** Plusieurs tâches démarrent elles-mêmes
   l'application ; un serveur lancé au montage du décor occupe le port, leur prémisse tombe, et la
   tâche n'est pas jouée du tout (« 0/0 tâches PASS » — un verdict qui n'en est pas un).
4. **Un code de sortie n'est pas un verdict.** Démarrer une application déjà démarrée sort en `69` :
   annoncer « porte morte » sur cette base est faux. On CONSTATE par une requête (`/livez`).
5. **🔴 Un port qui répond ne dit pas À QUI.** C'est le piège le plus coûteux, parce qu'il produit
   des chiffres EXACTS à propos de la mauvaise application. Vécu de bout en bout : un run interrompu
   (« l'agent n'a rendu aucun tour ») a quitté sans éteindre son serveur ; le run suivant a trouvé
   ses ports dédiés pris, sa prémisse n'a donc jamais démarré le sien — et l'agent, le constat de
   porte et le juge des routes ont TOUS interrogé l'application du run précédent. Même ports, même
   nom (`bench-app`) : rien ne pouvait le trahir. Le seul verdict juste de la passe fut le rouge de
   `nodefony check` — « le port est tenu par un autre processus », littéralement vrai.
   **Le discriminant est local et gratuit** : un serveur Nodefony publie `pid` et ports EFFECTIFS
   dans `node_modules/.cache/nodefony/runtime.json`, **dans l'application qui l'a démarré**. Absent,
   ou ne portant pas le port qu'on va frapper ⇒ ce qui répond appartient à quelqu'un d'autre
   (`portDeLAppSousTest`, dans le socle `lib/http-probe.mjs`).
6. **Un arrêt qui ne couvre pas les sorties d'URGENCE n'est pas un arrêt.** Celui du banc existait,
   nommait même le risque — mais il vivait après la boucle des tâches et ne valait qu'en régime
   `auth`. Or une passe s'interrompt (`process.exit`), et une PRÉMISSE démarre l'application dans
   tous les régimes. Il est désormais armé sur `process.on("exit")` et sur les signaux, et la fin
   normale CONSTATE (`nodefony status`) au lieu de croire le code de sortie de `stop`.

## 2. L'agent — `NF_DEVKIT_BENCH_AGENT` et ses drapeaux

`NF_DEVKIT_BENCH_AGENT_ARGS` est le contrat **COMPLET** : posé, il remplace tout, y compris le
câblage MCP par défaut. C'est ce qui permet de mesurer « sans MCP », et c'est aussi ce qui oblige à
donner la ligne entière pour un autre agent.

<!-- prettier-ignore -->
| Agent | `NF_DEVKIT_BENCH_AGENT_ARGS` | Modèle | Comment il atteint la porte |
| --- | --- | --- | --- |
| `claude` (défaut) | _(laisser vide)_ | `NF_DEVKIT_BENCH_MODEL` (défaut `haiku`) | `--mcp-config .mcp.json --strict-mcp-config`, ajoutés d'office |
| `vibe` | `--output streaming --yolo --trust -p` | poser `NF_DEVKIT_BENCH_MODEL=` **vide** | déclaré chez lui par `vibe mcp add`, dans un foyer JETABLE |
| `codex` | `exec --json --skip-git-repo-check --approve-for-me` | vide | `codex mcp add`, foyer JETABLE `CODEX_HOME` |
| `gemini` | `--skip-trust -y -o stream-json -p` (`-p` en DERNIER) | vide | portée PROJET (`.gemini/`) : rien à déporter |
| `agy` (Antigravity) | `--output-format stream-json -p` (`-p` en DERNIER) | vide | `agy mcp add`, portée GLOBALE — il suit `HOME` |

### Deux pièges de drapeaux, tous deux payés

**`codex` — `--sandbox` et `--approve-for-me` sont EXCLUSIFS.** `--approve-for-me` route déjà les
demandes d'approbation par une revue automatique _dans le bac à sable `workspace-write`_ : le nommer
en plus est refusé (`error: the argument '--sandbox <SANDBOX_MODE>' cannot be used with
'--approve-for-me'`). Codex sort alors en **2 sans écrire une ligne** — et un transcript de 0 octet
ressemble trait pour trait à un agent non authentifié ou à un quota épuisé. Le banc a bien refusé de
rendre un verdict (« ce n'est pas un verdict »), mais le motif ne se lit qu'en **rejouant la commande
à la main**, la sortie de l'agent étant capturée.

**`agy` — un drapeau placé après `<name>` est rejeté** par `agy mcp add` (« Flags must come before
`<name>` »). Même famille de défaut : la commande échoue pour une raison de FORME, jamais de fond.

### 🔴 Gemini CLI est INÉLIGIBLE sur le tier gratuit individuel

Ce n'est ni un défaut de login ni un choix du banc : c'est le serveur de Google qui refuse, compte
parfaitement authentifié (`google_accounts.json` : `active` renseigné, `oauth_creds.json` posé).

```
IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals.
reasonCode: 'UNSUPPORTED_CLIENT'  ·  tierId: 'free-tier'
To continue using Gemini, please migrate to the Antigravity suite of products
```

Les voies qui restent, toutes deux non interactives et documentées par la CLI elle-même
(`docs/get-started/authentication.mdx`, bundlée dans le paquet npm) : **`GEMINI_API_KEY`** (clé AI
Studio) ou **Vertex AI**. Sa doc est explicite sur le mode headless — « will use your existing
authentication method, **if an existing authentication credential is cached** » — donc sans clé, un
`-p` part ouvrir un navigateur et **attend une réponse sur stdin** : le symptôme est un banc qui
pend, pas une erreur.

**Antigravity CLI est le remplaçant désigné, et il est pilotable.** Son binaire s'appelle **`agy`**
(pas `antigravity`), et il vit dans `~/.local/bin`. Vérifié en le lançant :

| Ce qu'on veut       | Chez `agy`                                                                  |
| ------------------- | --------------------------------------------------------------------------- |
| mode non interactif | `-p` / `--print` / `--prompt` (prend le prompt en VALEUR → dernier drapeau) |
| JSONL               | `--output-format stream-json`                                               |
| auto-approbation    | `--dangerously-skip-permissions`                                            |
| modèle · effort     | `--model` · `--effort low\|medium\|high`                                    |
| déclarer la porte   | `agy mcp add --type http --header "Authorization: Bearer …" <nom> <url>`    |

⚠️ **`agy mcp add` REJETTE un drapeau placé après le nom** — sa propre aide le dit : « Flags must
come before `<name>` ». Un ordre d'arguments naturel échoue donc, et l'échec ne ressemble pas à un
problème d'ordre.

Il écrit dans **`$HOME/.gemini/config/mcp_config.json`** (portée globale, forme
`{mcpServers:{<nom>:{disabled, headers, serverUrl}}}` — la clé est `serverUrl`, pas `url`).
Constaté : **il respecte `HOME`** — avec un `HOME` détourné, la déclaration part dans le foyer
jetable et le foyer réel reste vide (`agy mcp list` → « No MCP servers configured »). Un foyer
jetable est donc possible, mais il emporterait aussi son identité (`~/.gemini/oauth_creds.json`) et
son propre foyer de données (`~/.gemini/antigravity-cli/`, binaire et bases comprises) : à traiter
comme pour Codex, en copiant ce qui identifie, jamais en écrivant chez l'utilisateur.

```bash
# claude (défaut) — porte authentifiée
NF_DEVKIT_BENCH_MCP=auth node …/bench-discoverability.mjs --task 9

# vibe — l'ordre des drapeaux n'est pas cosmétique (cf ci-dessous)
NF_DEVKIT_BENCH_AGENT=vibe NF_DEVKIT_BENCH_MODEL= \
  NF_DEVKIT_BENCH_AGENT_ARGS="--output streaming --yolo --trust -p" \
  NF_DEVKIT_BENCH_MCP=auth node …/bench-discoverability.mjs --task 9
```

### Pourquoi `-p` doit être le DERNIER drapeau de Vibe

Le banc ajoute le prompt en **dernier argument**. Chez Vibe, `-p [TEXT]` prend une valeur
**optionnelle** : placé en tête, il reste vide et le prompt devient un positionnel — c'est-à-dire le
mode INTERACTIF, qui sort immédiatement sans TTY. Symptôme : `agent sorti en 1`, transcript de
0 octet, et le message `Error: No prompt provided for programmatic mode` qu'on ne voit que si on
rejoue la commande à la main. Mis en dernier, `-p` prend le prompt pour valeur.

`--trust` est indispensable en automation (sans lui, Vibe demande à approuver le dossier) et
`--yolo` approuve les appels d'outils. `--output streaming` rend du JSON par ligne, dont les
messages `"role": "assistant"` que les sondes lisent.

### Le foyer JETABLE — `VIBE_HOME`, `CODEX_HOME`

🔴 Vibe et Codex n'ont **pas de portée projet en écriture** : leur `mcp add` écrit chez
l'utilisateur. Un banc qui les déclarerait ainsi modifierait la configuration du POSTE, et y
laisserait une porte pointant vers une application témoin détruite depuis longtemps.

Le décor déplace donc leur foyer dans l'application témoin (`.vibe-home/`, `.codex-home/`), qui
disparaît avec elle. Deux conséquences à connaître :

- la déclaration passe par **`nodefony ai:mcp --agent <nom>`**, donc par la CLI de l'agent — même
  implémentation que pour un utilisateur réel, jamais une grammaire recopiée dans un banc ;
- **la clé d'API voyage avec le foyer** : sa `config.toml` est COPIÉE depuis le foyer réel. Sans
  elle, l'agent ne répond pas, et l'on mesurerait un décor au lieu d'un agent. On lit ce qui
  appartient à l'utilisateur ; on n'y écrit jamais.

### Constater la déclaration — elle échoue silencieusement

🔴 **`vibe mcp add` valide sa `config.toml` plus strictement que le démarrage normal de Vibe.**
Mesuré : une configuration où un modèle est déclaré sans `name` ni `provider` fait tourner Vibe
sans broncher, mais fait refuser `mcp add` par pydantic (`ValidationError`). La porte n'était donc
PAS déclarée, et rien ne le montrait : `ai:mcp` DIT pourtant le refus, mais le décor capture sa
sortie. Le banc CONSTATE désormais la présence du serveur dans le foyer et l'annonce — un run où
l'agent n'a pas d'outils reste exploitable, à condition de le SAVOIR.

Symptôme à reconnaître : l'agent passe la tâche… avec **zéro appel MCP**. Ce n'est pas
« il a préféré la CLI », c'est le plus souvent « il n'a jamais eu la porte ».

Pour lire le motif d'un refus, rejouer la déclaration **depuis l'application témoin** :
`VIBE_HOME=$PWD/.vibe-home npx --no-install nodefony ai:mcp --auth --agent vibe`

## 3. Ce que les mesures d'effort valent selon l'agent

Les compteurs `tours / durée / coût / appels MCP` sont extraits d'un enregistrement propre au CLI de
Claude (`type=result`, blocs `tool_use`). Chez un autre agent, ils sont **absents** — leur absence
n'est pas un échec, et le banc ne la compte pas comme tel. Les sondes, elles, lisent le transcript
textuel et restent valables partout.

**Deux agents ne se comparent donc pas entre eux** (modèles différents, formats différents). Ce qui
se compare, à agent constant, c'est le RÉGIME de porte.

## 4. Une sonde ne doit jamais mesurer un MOYEN

Mesuré ici : la sonde « a interrogé l'application en marche » cherchait `nodefony inspect` dans une
commande shell. En régime authentifié, l'agent a interrogé l'application **sept fois par ses outils
MCP** — le geste EXACT que la tâche demande — et la sonde l'a compté ROUGE. Le banc aurait conclu
que le MCP dégrade ce qu'il améliore.

Le helper `gesteParCommandeOuMcp(motif, outils)` accepte les deux voies du même geste. **Toute sonde
nouvelle qui vise un geste servi AUSSI par un outil MCP doit l'utiliser** — sinon elle mesure le
transport, pas le fait.

## 5. 🔴 Le nom d'un régime n'est pas son décor — ce que `eteint` mesure vraiment

**Tranché.** Un régime nommé `eteint` a enregistré **8 appels MCP RÉUSSIS** — vérifié un par un dans
le transcript : `is_error=false`, réponses portant des données réelles (145 routes, la liste des
services, la configuration effective du store). L'explication n'est pas une reconnexion du client :

- **la tâche 9 DÉMARRE l'application elle-même**, par son `prepare`
  (`npx nodefony development --detach --wait`), et son commentaire l'énonce : « PRÉMISSE :
  l'application TOURNE quand l'agent démarre ». La porte était donc joignable à l'init, comme le
  client l'exige ;
- le régime, lui, imprimait « application ÉTEINTE — le client la marquera `failed` pour la session ».
  Une **prédiction**, faite au montage, à propos d'un état qu'une prémisse de tâche modifie ensuite.

**L'affirmation « le client MCP se connecte à l'init et ne retente jamais » n'est donc ni contredite
ni confirmée par ce run** : il ne l'éprouvait pas. Elle reste appuyée sur la mesure du 08-21
(0 appel sur 30 tâches, décor réellement éteint).

**Ce que `eteint` sépare de `auth`, sur la tâche 9, c'est l'IDENTITÉ, pas l'allumage** : sans
`--auth`, aucun jeton n'est émis, l'en-tête reste le gabarit `${NF_MCP_TOKEN}` non substitué, et la
porte sert l'**anonyme**. La preuve est dans le transcript du run `eteint` : `admin_list` rend
« **0 lectures appelables** » puis « 3 lectures appelables » sur 97 endpoints déclarés — la retenue
des outils réservés, pas une porte morte.

Le banc CONSTATE désormais l'état de la porte pour tout régime qui en déclare une, **après la
prémisse et avant l'agent** (décor figé), et nomme l'identité servie (`jeton posé` / `ANONYME`). La
règle générale est celle que le régime `auth` appliquait déjà, et qui manquait ici : **un décor
s'énonce sur ce qu'on frappe, jamais sur ce qu'on avait prévu.**

## 6. Mesure de référence (tâche 9, `claude`/`haiku`, run UNIQUE)

⚠️ **Ces deux lignes comparent ANONYME et AUTHENTIFIÉ** — dans les deux cas l'application tourne
(cf § ci-dessus). Elles ne disent rien d'une porte éteinte.

| Régime               | Tours | Durée | Appels MCP |
| -------------------- | ----- | ----- | ---------- |
| `eteint` (= anonyme) | 16    | 61 s  | 8          |
| `auth`               | 11    | 40 s  | 7          |

Et un run `vibe` (`devstral-small`, régime `auth`, tâche 9) : **PASS 11/11**, avec **zéro appel
MCP** — sa CLI ayant refusé la déclaration (cf ci-dessus), il a tout fait par les commandes. Il
réussit donc là où `claude`/`haiku` échouait, mais **sans** l'outillage qu'on croyait mesurer : deux
modèles ET deux décors changent à la fois, la comparaison ne conclut rien. Les compteurs d'effort
sont absents (format propre au CLI de Claude), comme prévu.

⚠️ **Un run unique ne conclut pas** (la variance écrase l'écart : cf `methode-de-mesure.md`). Ces
chiffres servent à savoir que le décor FONCTIONNE, pas à établir un gain.

✅ **Instruit** : les 8 appels MCP du run `eteint` sont RÉELS et RÉUSSIS — l'application tournait,
sa prémisse l'ayant démarrée. Voir le § « Le nom d'un régime n'est pas son décor » ci-dessus.
