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

**`eteint` reste le défaut** : c'est le cas réel — on ouvre un dépôt, la porte est déclarée, rien
ne tourne. Le régime entre dans le décor enregistré ; le dépistage REFUSE de comparer deux régimes
(sortie 78), comme il le doit.

⚠️ **La référence historique du 08-09 n'était PAS établie sur ce régime, contrairement à ce qui
était écrit ici.** Elle date d'avant que `--mcp-config` entre dans les arguments par défaut de
l'agent : son décor ne portait aucune mention de porte (`isolé (tarballs, hors dépôt)`), là où tout
run d'aujourd'hui écrit `… · MCP <régime>`. La garde de décor refusait donc de fusionner quoi que
ce soit dedans — c'est pourquoi deux campagnes successives n'ont pas pu re-figer la référence, et
pourquoi la nouvelle a été écrite à neuf plutôt que fusionnée. Une référence dont le décor n'existe
plus ne se répare pas : elle se remplace.

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
   (`portDeLAppSousTest`, dans le socle `scripts/lib/http-probe.mjs`).
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
| `gemini` | `--skip-trust -y -o stream-json --model gemini-3.1-flash-lite -p` (`-p` en DERNIER, modèle DANS les args) | vide — **surtout pas** `NF_DEVKIT_BENCH_MODEL` | portée PROJET (`.gemini/`) : rien à déporter |
| ~~`agy` (Antigravity)~~ | **CLOS — pas une cible** (jeton en clair exigé, cf ci-dessous) | — | — |

### 🛑 Antigravity CLI (`agy`) — CLOS : il ne sera pas une cible du banc

**Décision prise, ne pas rouvrir le chantier.** L'authentifier exigerait d'écrire la **valeur** du
jeton en clair dans le foyer utilisateur, parce qu'`agy` n'expanse aucune variable dans un en-tête
(mesuré : il envoie `Bearer ${NF_MCP_TOKEN}` LITTÉRAL sur le réseau). La table du cœur ne
transporte que `tokenEnv` — le NOM de la variable, jamais le secret — et cette règle ne se casse
pas pour un seul agent. S'ajoutait un second mur : un foyer JETABLE le déconnecte (`HOME` détourné
⇒ flux OAuth dans le navigateur), donc il faudrait déclarer dans son foyer RÉEL puis retirer après
le run.

Rien n'a été livré au produit : `agy` **n'est pas** dans `AGENT_TARGETS`
(`src/nodefony/src/cli/agentTargets.ts`).

**Ce qui reste, et pourquoi ça reste** : la lecture de sa **grammaire de transcript**. Elle ne
coûte rien et protège d'un diagnostic faux — un transcript `agy` qu'on ne saurait pas lire
rendrait « 0 tour, 0 appel MCP », le symptôme exact de « il n'a jamais eu la porte ».

Sa grammaire est donc câblée et éprouvée (4ᵉ dialecte, constaté en le lançant) :
l'enveloppe s'appelle `event`, pas `type` ; le tour d'agent est un `step_update` de
`step_type: "agent_response"` ; `result` porte `num_turns` comme Claude, mais une durée en
**secondes**. Le compteur d'effort et la garde « l'agent a-t-il parlé ? » le lisent.

**Ce qui n'est PAS câblé, et pourquoi — deux constats, pas des suppositions.**

1. 🔴 **`agy` ne substitue AUCUNE variable dans un en-tête.** Mesuré avec une porte espionne qui
   journalise ce qu'elle reçoit : déclaré avec `Authorization: Bearer ${NF_MCP_TOKEN}` et lancé avec
   la variable posée, il envoie **le gabarit littéral sur le réseau** —
   `VU: ["Bearer ${NF_MCP_TOKEN}", …]`. L'authentifier exigerait donc d'écrire **la valeur du jeton
   en clair** dans `$HOME/.gemini/config/mcp_config.json`.
   Or la table du cœur refuse cela **par principe** : `IDeclarationContext` ne transporte que
   `tokenEnv` — « le NOM de la variable qui porte le jeton, jamais le jeton lui-même ». Le servir
   demanderait de faire remonter la valeur depuis l'émission jusqu'à `declarerChezAgents`, et
   d'assumer un secret en clair (foyer utilisateur, hors dépôt). **C'est une décision de produit, pas
   un oubli de câblage** — elle se prend à froid.
2. 🔴 **Un foyer JETABLE le déconnecte.** `HOME` détourné ⇒ aucune identité ⇒ il ouvre un flux OAuth
   dans le navigateur (vécu : une fenêtre a surgi pendant un test). Son identité n'est ni dans un
   fichier repérable de `~/.gemini`, ni dans le trousseau sous ce nom. La stratégie des trois autres
   (foyer jetable + copie de ce qui identifie) **ne s'applique donc pas** : il faudrait déclarer dans
   son foyer RÉEL et RETIRER après le run — désormais sûr, le filet d'arrêt du banc pouvant porter
   ce retrait.

**Et le reste est prêt** : `--dangerously-skip-permissions` est indispensable (sans lui, headless
refuse tout outil : « a tool required the "command" permission that headless mode cannot prompt
for »), `agy mcp add --type http --header … <nom> <url>` écrit dans
`$HOME/.gemini/config/mcp_config.json` (clé `serverUrl`), et il **respecte `HOME`**.

🔎 **Non observé, donc non câblé** : la forme d'un APPEL MCP chez `agy`. Il expose un outil
`call_mcp_tool`, mais aucun appel réussi n'a encore été enregistré. Deviner un motif rendrait
« 0 appel MCP » sans qu'on sache si c'est vrai — le diagnostic faux que ce compteur existe pour ne
plus produire.

### 🔑 Gemini par CLÉ D'API — la seule voie qui marche ici

L'OAuth personnel est refusé (cf ci-dessous), la clé AI Studio passe. Trois choses apprises en la
posant, toutes en la LANÇANT :

- **`.zshrc` n'est lu que par un shell INTERACTIF.** Une clé exportée là n'existe ni pour un shell de
  login (`zsh -lc`), ni pour un process lancé par un agent : le banc la voit ABSENTE alors qu'elle est
  bien posée dans le terminal du développeur. Emplacements qui n'ont pas ce défaut : `~/.zshenv` (lu
  par tous les shells) ou `~/.gemini/.env`, que la CLI lit elle-même.
- **`auto` ne choisit pas un modèle disponible.** Il a résolu vers `gemini-3.1-flash-lite` et rendu
  `TerminalQuotaError: You have exhausted your daily quota on this model` — le quota est PAR MODÈLE,
  et le message le dit. Constaté ensuite : `gemini-3.1-flash-lite` répond, `gemini-3.5-flash` non,
  et `gemini-2.5-flash-lite` n'existe plus pour un compte neuf (`ModelNotFoundError: no longer
available to new users`). **Nommer le modèle**, ne pas laisser `auto` décider.
- 🔴 **Le `--model` du banc CASSE la règle du `-p` final.** Le banc compose
  `[...args, --model, <m>, <prompt>]` : avec `-p` en dernier des args, `-p` prend `--model` pour
  valeur et le prompt redevient un positionnel — c'est-à-dire le mode interactif, qui sort aussitôt
  sans TTY. Le modèle doit donc vivre DANS `NF_DEVKIT_BENCH_AGENT_ARGS`, avant `-p`, et
  `NF_DEVKIT_BENCH_MODEL` rester **vide**.

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

**Antigravity CLI se présente comme le remplaçant, et il EST pilotable — mais le banc ne le
prend pas** (cf « CLOS » ci-dessus : l'authentifier demanderait le jeton en clair). Ce qui suit est
conservé parce qu'il a été payé en le lançant, et qu'il resservirait si la contrainte tombait. Son binaire s'appelle **`agy`**
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

## 6. 🔴 Un agent à portée PROJET n'était JAMAIS déclaré — et son « 0 appel » mentait

Le banc décidait d'appeler la CLI d'un agent sur `foyer ? AGENT : "none"`. Cette condition confondait
**« a-t-il un foyer déportable ? »** avec **« faut-il appeler sa CLI ? »**. Gemini est à portée
PROJET (il écrit dans `.gemini/`, rien à déporter) : pas de foyer ⇒ `--agent none` ⇒ **sa CLI n'était
jamais appelée**, et il a joué une tâche entière sans le moindre outil MCP.

Son relevé disait alors « 0 appel MCP » — ce que ce document apprend précisément à lire comme un
CHOIX de l'agent (§ 2, « c'est le plus souvent : il n'a jamais eu la porte »). **Le banc s'est fait
prendre par le piège qu'il documente.**

La racine est une **règle en deux exemplaires** : « quels agents nommer à `ai:mcp` » vit dans le
cœur (`argvMcpWiring` filtre `declaration === "cli"`, deux tests le gardent), et le banc en tenait
une copie fausse. Il nomme désormais TOUJOURS l'agent et laisse `ai:mcp` trancher. Le CONSTAT de
déclaration, lui aussi enfermé dans `if (foyer)`, cherche maintenant dans le foyer jetable **ou**
dans le projet — et dit lequel.

**Mesure avant / après, même agent, même tâche 9 :**

|       | `.gemini/` | ce qu'il a fait                                      | routes annoncées         | verdict        |
| ----- | ---------- | ---------------------------------------------------- | ------------------------ | -------------- |
| avant | **absent** | 5 `read_file`, `grep`, 1 commande (`inspect config`) | **6** (lues aux sources) | FAIL 1/11      |
| après | déclaré    | 4 commandes, 1 `read_file`                           | **147**                  | **PASS 11/11** |

⚠️ **Un run unique ne prouve pas la causalité.** Que la déclaration ait CHANGÉ son comportement est
plausible, pas établi — et dans les deux cas il a répondu par la CLI, sans un seul appel MCP. Ce qui
est acquis, c'est que le premier relevé ne mesurait pas ce qu'il prétendait.

## 7. Mesure de référence (tâche 9, `claude`/`haiku`, run UNIQUE)

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

### Ce que chaque agent a rendu sur la tâche 9 (runs UNIQUES, non comparables entre eux)

| Agent                     | Verdict                 | Effort          | Appels MCP | Comment il s'y est pris                         |
| ------------------------- | ----------------------- | --------------- | ---------- | ----------------------------------------------- |
| `claude`/`haiku`          | FAIL (sonde de contenu) | 16 tours / 61 s | 8          | par la porte                                    |
| `vibe`/`devstral-small`   | PASS 11/11              | —               | 0          | sa CLI a REFUSÉ la déclaration                  |
| `codex`                   | FAIL 1/11               | 1 tour          | 0          | 27 commandes, **porte vue mais ignorée**        |
| `gemini`/`3.1-flash-lite` | **PASS 11/11**          | 94 s            | 0          | 4 commandes, après correction de la déclaration |

🔎 **Trois agents sur quatre n'ont pas touché la porte alors qu'ils l'avaient.** Codex la VOYAIT
(`codex mcp list` → `enabled`, `Bearer token`) et a préféré 27 commandes. C'est un résultat en soi,
et il mérite d'être instruit plutôt que corrigé : l'outillage MCP ne s'impose pas de lui-même.

⚠️ **Un run unique ne conclut pas** (la variance écrase l'écart : cf `methode-de-mesure.md`). Ces
chiffres servent à savoir que le décor FONCTIONNE, pas à établir un gain.

✅ **Instruit** : les 8 appels MCP du run `eteint` sont RÉELS et RÉUSSIS — l'application tournait,
sa prémisse l'ayant démarrée. Voir le § « Le nom d'un régime n'est pas son décor » ci-dessus.
