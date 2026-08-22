# Décor d'un run : quel AGENT, et quelle PORTE MCP

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`. Une leçon durable devient une règle d'une section.

Deux réglages indépendants décident de ce qu'un run mesure : **qui** travaille (l'agent) et **ce
qu'il trouve** en arrivant (la porte MCP). Les confondre produit des comparaisons fausses — un agent
mieux outillé qu'un autre n'est pas un agent meilleur.

## 1. La porte — `NF_DEVKIT_BENCH_MCP`

| Régime                | Ce que l'agent trouve                                    | Ce que ça mesure                                            |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| `eteint` **(défaut)** | porte déclarée dans `.mcp.json`, **application arrêtée** | le cas le plus fréquent : on ouvre un dépôt, rien ne tourne |
| `auth`                | jeton émis **et** application démarrée                   | l'utilisateur outillé, celui que `create app` câble         |
| `off`                 | aucune déclaration                                       | le devkit sans MCP du tout                                  |

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

## 2. L'agent — `NF_DEVKIT_BENCH_AGENT` et ses drapeaux

`NF_DEVKIT_BENCH_AGENT_ARGS` est le contrat **COMPLET** : posé, il remplace tout, y compris le
câblage MCP par défaut. C'est ce qui permet de mesurer « sans MCP », et c'est aussi ce qui oblige à
donner la ligne entière pour un autre agent.

<!-- prettier-ignore -->
| Agent | `NF_DEVKIT_BENCH_AGENT_ARGS` | Modèle | Comment il atteint la porte |
| --- | --- | --- | --- |
| `claude` (défaut) | _(laisser vide)_ | `NF_DEVKIT_BENCH_MODEL` (défaut `haiku`) | `--mcp-config .mcp.json --strict-mcp-config`, ajoutés d'office |
| `vibe` | `--output streaming --yolo --trust -p` | poser `NF_DEVKIT_BENCH_MODEL=` **vide** | déclaré chez lui par `vibe mcp add`, dans un foyer JETABLE |
| `codex` | à établir | vide | même famille que `vibe` : `CODEX_HOME`, config globale |
| `gemini` | à établir | vide | portée PROJET (`.gemini/`) : rien à déporter |

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

## 5. Mesure de référence (tâche 9, `claude`/`haiku`, run UNIQUE)

| Régime   | Tours | Durée | Appels MCP |
| -------- | ----- | ----- | ---------- |
| `eteint` | 16    | 61 s  | 8          |
| `auth`   | 11    | 40 s  | 7          |

Et un run `vibe` (`devstral-small`, régime `auth`, tâche 9) : **PASS 11/11**, avec **zéro appel
MCP** — sa CLI ayant refusé la déclaration (cf ci-dessus), il a tout fait par les commandes. Il
réussit donc là où `claude`/`haiku` échouait, mais **sans** l'outillage qu'on croyait mesurer : deux
modèles ET deux décors changent à la fois, la comparaison ne conclut rien. Les compteurs d'effort
sont absents (format propre au CLI de Claude), comme prévu.

⚠️ **Un run unique ne conclut pas** (la variance écrase l'écart : cf `methode-de-mesure.md`). Ces
chiffres servent à savoir que le décor FONCTIONNE, pas à établir un gain.

🔎 **À instruire** : le run `eteint` a rendu **8 appels MCP** alors que l'application était arrêtée
au lancement de l'agent. Le banc affirme ailleurs que le client MCP « se connecte à l'init et ne
retente jamais » — ce run le contredit. Tant que ce n'est pas tranché, ne pas s'appuyer sur cette
affirmation dans un sens ni dans l'autre.
