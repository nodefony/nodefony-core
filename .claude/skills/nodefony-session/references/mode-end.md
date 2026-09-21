# MODE END — clôture de session (RETEX)

> Référence du skill `nodefony-session`, chargée au mode **END** (« fin de session », « retex »,
> « fais le retex », « où sont passés les tokens »). Le `SKILL.md` route, cette page exécute.
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

RETEX = RETour d'EXpérience. **But réel** : amélioration continue de l'IA sur Nodefony — PAS un log
de tokens. Cf `feedback_session_retros_purpose`.

## ⚡ END courant = 7 étapes LÉGÈRES (ne PAS faire les stats lourdes)

Le END par défaut doit être **rapide** (reproche user 2026-05-31 : END trop lourd/pénible). Il fait
SEULEMENT :

0. **Fermer ou commenter les TICKETS que la session a soldés**, puis rafraîchir l'empreinte
   (`npm run board:snapshot`) — c'est le seul état d'avancement du dépôt, et le seul moment où
   GitHub est joint. Un ticket fermé sans compte rendu perd la preuve qui l'a soldé : le
   commentaire porte le hash et l'ancre, la fermeture ne porte que la date.
   > Le tableau de bord de migration qui vivait à la racine a été **archivé le 2026-09-19**
   > (`docs/archives/migration-status-2026-09-19.md`) : il n'y a plus de carte de phases à
   > mettre à jour au END, et les décisions d'architecture vivent en `docs/adr/`.
1. **MAJ `docs/session-retros/RETEX.md`** (le SAS, lu au START/RESUME) : ajouter **3-5 bullets** des
   frictions/leçons du jour, **rangées par thème**, format `[1× — <date courte>]`. Si une friction y
   figure déjà → **incrémenter le compteur** `[2× — …]` + re-dater. NE PAS redupliquer ce qui est
   déjà gradué en `feedback_*` (juste pointer si utile).

   > 🔴 **AVANT d'écrire, LISTER les thèmes existants — et verser dessous.**
   > `npm run retex:seuil -- --all` — les thèmes vivants et leur compte, plus ceux qui ont
   > atteint le seuil de graduation. **Le lancer À CHAQUE END** : le seuil ne vivait que dans
   > cette page, donc nulle part — mesuré au CONSOLIDATE du 2026-09-07, **95 retex pour
   > 2 mémoires créées**, un sas gonflé à 2902 lignes et sept thèmes mûrs depuis des semaines,
   > dont un à 47 frictions. S'il annonce des thèmes mûrs, le dire au user : graduer est un
   > travail de CONSOLIDATE, pas de END, mais il ne se programme que s'il se voit.
   > **Ouvrir un thème neuf est le dernier recours, pas le geste par défaut.** Mesuré au
   > CONSOLIDATE du 2026-08-24 : **55 thèmes créés en quatre jours**, si bien que quatre familles
   > évidentes (le décor d'un banc, la sonde qui mesure autre chose, le code de sortie, le gabarit
   > vs son rendu) étaient éclatées en 3-4 thèmes de 2-4 frictions — **aucun n'atteignait le seuil
   > de 5**, alors que réunies elles pesaient 19, 12, 9 et 7. Le seuil de graduation ne mord que si
   > la friction rejoint sa FAMILLE ; un titre neuf par session le désamorce en silence.

2. **Retex brut court** `docs/session-retros/<date>-<id>.md` : focus + Fait + frictions + commits.
   **SANS les tableaux de stats** (tool_use/coût € → déplacés en CONSOLIDATE). ~30 lignes.
3. **Refermer les tickets que la session a soldés** — un ticket resté ouvert fait recompter un
   travail déjà fait à la reprise suivante, et fausse le seul compteur d'avancement qui ne se
   périme pas. Un ticket seulement AVANCÉ reçoit un commentaire, pas une fermeture.

   **La fermeture porte un COMPTE RENDU, pas une ligne** — commits, preuves, ce qui a débordé de
   l'énoncé, ce qui n'a pas été fait. Sa forme et son script (`ticket-close.mjs`) vivent dans le
   skill **`nodefony-ticket`** (`references/fermeture.md`) : le charger AVANT de fermer.
   Recopier ici le geste rendrait le skill inatteignable — et c'est lui qui porte les deux blocs
   qu'aucun automate ne connaît, ceux qui évitent une relecture de code des semaines plus tard.

   Fermer, c'est aussi **recaler ce que ce ticket rendait faux** — les tickets voisins et la
   documentation, pas seulement le code (skill `nodefony-ticket`, `references/fermeture.md`) :

   ```bash
   node .claude/skills/nodefony-ticket/scripts/ticket-verify.mjs --touched-by HEAD   # tickets à relire
   node .claude/skills/nodefony-ticket/scripts/ticket-effort.mjs                                                    # estimé vs constaté
   ```

4. **Redescendre les tickets « In Progress » que rien ne fait avancer.** Le statut monte tout
   seul — `.githooks/post-commit` le pose dès qu'un commit cite `#N` sans le fermer (raisonnement :
   en-tête de [`ticket-progress.mjs`](../../nodefony-ticket/scripts/ticket-progress.mjs)) — mais **rien ne le fait
   redescendre**. Un ticket ouvert un jour, abandonné le lendemain, resterait « en cours » pour
   toujours : c'est précisément la fossilisation qui a tué ce champ la première fois (0 usage sur 64
   items). Le contrôle vaut le geste :

   ```bash
   gh api graphql -f query='{repository(owner:"nodefony",name:"nodefony-core"){
     projectV2(number:2){items(first:100){nodes{content{... on Issue{number title}}
     fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}' \
     --jq '.data.repository.projectV2.items.nodes[] | select(.fieldValueByName.name=="In Progress")
           | "#\(.content.number) \(.content.title)"'
   ```

   Pour chacun : un commit récent le cite-t-il ? (`git log --oneline --grep="#<n>" -3`). Sinon, le
   remettre à `Todo` — un statut qui ment est pire qu'un statut absent.

5. **Contrôler le pilotage AVANT de le graver** — un ticket ouvert en séance a pu rester hors
   tableau, un statut a pu monter tout seul, une estimation manque. L'empreinte du §5 bis
   photographie ce qu'on lui donne : la prendre sur un tableau incohérent grave l'incohérence, et
   c'est elle qu'on relira hors ligne.

   ```bash
   npm run ticket:lint     # 0 = rien à solder ; 1 = corriger AVANT l'empreinte
   ```

5 bis. **Régénérer l'empreinte des tickets** — c'est le moment où GitHub est joignable et où le board
vient d'être mis à jour ; c'est donc là qu'elle se prend, jamais plus tard :

```bash
npm run board:snapshot          # ou : node .claude/skills/nodefony-session/scripts/board-snapshot.mjs
```

Elle est **commitée avec le reste** (§11). Si le script refuse d'écrire, le lire : un refus dit
soit « GitHub muet » (l'ancienne empreinte est conservée, c'est voulu), soit « chute suspecte du
nombre de tickets » — dans les deux cas on ne force pas sans avoir compris.

5 ter. **Republier l'avancement dans le README du tableau de bord** — la même empreinte, mais
rendue là où on la REGARDE :

```bash
npm run board:readme                     # publie
npm run board:readme -- --dry-run        # montre ce qui partirait, sans rien écrire
```

Et **la même empreinte a une seconde vitrine**, qui n'est pas la même audience : l'issue publique
« Où en est la version 10 » (label `tableau-de-bord`). Le README se lit quand on ouvre le projet ;
l'issue se suit, s'épingle et se commente — c'est elle que quelqu'un d'extérieur regarde.

```bash
npm run board:issue                      # republie l'issue-tableau
```

🔴 **Les deux se lancent, pas l'un OU l'autre.** `--readme` ne touche pas l'issue, et `--issue` ne
touche pas le README : deux surfaces, deux commandes. Vécu — l'issue est restée sur une photo d'un
jour plus tôt, à `112 tickets ouverts` contre `122`, parce que seul le README avait été republié.
Une vitrine périmée est pire qu'une vitrine absente : on la croit.

**Pourquoi le README et pas un graphique.** GitHub n'expose **aucune mutation** pour les _Insights_
de Projects v2 — vérifié par introspection du schéma : pas un champ `*Insight*` ni `*Chart*` dans
`mutationType`. Leur configuration ne vit que dans l'interface web, donc elle ne se versionne pas,
ne se régénère pas, et personne ne saura dire de quand elle date. Le `readme` du projet, lui, est un
champ de `updateProjectV2` : c'est **la seule surface visuelle du projet qu'un script puisse tenir à
jour**. Même famille que le groupement d'une vue (skill `nodefony-ticket`, `references/tableau-de-bord.md`) — ne pas chercher une
commande là où il n'y en a pas.

**Ce que le script ne touche PAS.** Le README porte deux natures : le **POURQUOI** du périmètre,
écrit à la main et durable, et l'**ÉTAT**, qui se périme en un jour. La zone générée vit entre
`<!-- BOARD:AUTO:DEBUT -->` et `<!-- BOARD:AUTO:FIN -->` ; tout ce qui est hors marqueurs est
préservé mot pour mot, et à la première pose la zone est AJOUTÉE à la fin plutôt qu'en tête — pour
qu'aucune ligne écrite à la main ne bouge sans qu'on l'ait voulu.

> ⚠️ **Ce qui est hors marqueurs ne se régénère pas — donc il se périme, et personne ne le voit.**
> Mesuré à la première pose : le README annonçait « 45 jours-homme », nommait comme premier ticket
> un arbitrage tranché de longue date, et affirmait « le board ne montre que 15 entrées racine »
> quand le tableau en portait plus de cent ouvertes, dans un tout autre ordre. C'est l'argument entier de la zone générée : ce qui se compte doit être CALCULÉ, et
> ce qui s'arbitre doit rester écrit à la main — jamais l'inverse.

La comparaison qui décide de republier **ignore l'horodatage** : sinon le script annoncerait
« republié » à chaque passage, y compris quand rien n'a bougé — et un instrument qui crie sans
raison finit par ne plus être lu.

5 quater. **L'issue ÉPINGLÉE — la surface qu'on voit vraiment.** Le README d'un projet v2 ne
s'affiche que dans ses réglages : il se tient à jour, mais personne ne passe devant. L'issue
épinglée, elle, est en tête de l'onglet Issues.

```bash
npm run board:issue                      # crée au premier passage, puis republie
npm run board:issue -- --dry-run         # montre le corps, sans rien écrire
```

Le MÊME rendu nourrit les deux surfaces (`renderAvancement`) : deux rendus séparés se
ressembleraient aujourd'hui et divergeraient au premier ajout, sans que rien ne le dise. L'issue se
retrouve d'un passage à l'autre par son **label** `tableau-de-bord`, jamais par son titre (qui se
renomme) ni par un numéro écrit en dur (qu'aucun automate ne recalcule).

> 🔴 **Cette issue reste HORS du tableau de bord et SANS jalon** — elle n'est pas du travail.
> `ticket:lint` contrôle **toutes les issues ouvertes**, pas seulement les items du tableau : il l'a
> donc refusée d'emblée (`NI-JALON-NI-BACKLOG`). La réponse n'est pas de lui poser `backlog` pour
> faire taire le contrôle — ce serait le mensonge commode que ce gate existe pour empêcher — mais
> d'apprendre au gate qu'une issue-INSTRUMENT n'est pas un ticket. L'exception est portée par le
> label, dans `board-lint.mjs`, et elle a été **vue mordre** : label retiré, l'issue est signalée ;
> label remis, le tableau est vert.

6. **`_state` de reprise** (§10) + **MAJ pointeur `MEMORY.md`**.
7. **Commit + push mémoire IA** (§11) **+ push du repo projet** (les commits feature + `docs/`).

8. **S'IL EST TARD, proposer le travail de NUIT — la machine dort moins que le user.**
   Certaines mesures coûtent des heures d'agents et n'ont aucune raison d'être payées
   en séance : elles ne demandent qu'une machine allumée. Le seul moment où l'on peut
   les proposer, c'est ici — la session se ferme, et le user va se coucher.

   **Le contrôle** : est-il après ~22 h locale (`date +%H`) ? Alors nommer, en UNE
   phrase, ce qui pourrait tourner cette nuit, avec son coût et sa durée — et
   attendre le OUI, jamais lancer d'office. Ce qui est en attente vit dans les
   mémoires `project_*_night_runs.md` ; aujourd'hui : **les 3 runs d'unanimité du
   banc devkit** avant la release ([[project_devkit_bench_night_runs]], ~46 $ / 8,7 h).

   Un travail de nuit se lance **détaché** avec sa sortie CAPTURÉE EN ENTIER dans un
   fichier — au réveil elle se lit par `@agent-nodefony-run-log-report`, jamais par un `tail`
   qui efface les SKIPS sans le dire.

> **DÉPLACÉ en CONSOLIDATE** (ne PAS l'exécuter au END courant) : comptage tool_use, top fichiers,
> coût €, balayage allowlist, détection candidats skill. Analyses coûteuses utiles 1×/10-20 retex
> seulement → **`consolidate-toolkit.md` (voisin)**, chargé à la demande. Le END courant ne le
> déroule jamais.

## Modèle SAS (pourquoi RETEX.md existe)

3 canaux, 1 seul relu à chaque session : `CLAUDE.md`/skills + `MEMORY.md` (✅ relus) vs
`session-retros/<id>.md` bruts (❌ jamais relus seuls → inertes). **`RETEX.md` comble le trou** :
digest par thème, lu au START/RESUME. Cycle de vie d'une leçon : **friction (RETEX.md, sas)** →
**thème atteignant ~5 frictions distinctes** → **gradué en `feedback_*`** (durable) + **retiré de
RETEX.md**. Règle anti-doublon : une leçon est dans RETEX.md **OU** `feedback_*`, **jamais les deux**
(sinon dérive, cf l'anti-pattern « liste dupliquée » de `nodefony-check-externals`). CONSOLIDATE gère
graduation + archivage pour borner la taille de RETEX.md (~1 écran).

> 🔴 **Le seuil porte sur le THÈME, pas sur le compteur `[N×]` d'un bullet.** L'ancienne règle
> « friction vue ≥3× » n'a **jamais** déclenché : sur 135 frictions accumulées, 121 étaient à `1×`,
> 14 à `2×`, **zéro à `3×`** — chaque session écrit un bullet NEUF plutôt que d'incrémenter, car les
> formulations diffèrent. Un thème à **35 frictions en dix jours** n'a donc jamais été gradué. Le
> `[N×]` ne sert plus qu'à repérer une répétition à l'identique ; il ne déclenche rien.
> (Constat et chiffres : `docs/session-retros/CONSOLIDATION-2026-08-02.md`.)

## Boîte à outils CONSOLIDATE — déportée

> Le minage du transcript (comptage tool_use, top fichiers, coût € réel, volume de sortie, balayage
> allowlist, détection de candidats skill, synthèse « intéressante » à présenter au user) vit dans
> **`consolidate-toolkit.md` (voisin)** — chargé à la demande. **Ne PAS le dérouler au END
> courant** : ces analyses coûtent et ne servent qu'en CONSOLIDATE ou lors d'un END approfondi
> ponctuel. Le reste de ce mode END (§9-§11) est utilisé à CHAQUE clôture et reste ici.

## 9. Sauvegarde OBLIGATOIRE (auto-save)

```bash
mkdir -p docs/session-retros
DATE=$(date +%Y-%m-%d); SHORT_ID=$(basename "$LATEST" .jsonl | cut -c1-8)
OUT="docs/session-retros/$DATE-$SHORT_ID.md"
echo "Écriture du retex : $OUT"
# Écrire le markdown (format ci-dessous) dans $OUT via tool Write (jamais echo/cat)
```

### Format du fichier retex (≤ 80 lignes)

```markdown
---
date: YYYY-MM-DD
session_id: <full-session-id>
focus: <1 ligne — sujet principal>
---

# Session retro — <date> — <session-short-id>

## Tool usage

| Outil | Calls |
| ----- | ----: |

## Top fichiers Read/Edit

| Fichier |   × |
| ------- | --: |

## Coûts évidents

- <ce qui a brûlé tokens/temps — restarts serveur, re-lectures…>

## 💶 Coût (€)

- Total ~€X (≈ $Y) — <décompo : cache write/read vs output> ; <enseignement, ex. cache-dominé X %>

## Recommandations

1. <skill suggéré> — raison
2. <pattern à éviter> — raison
3. <mémorisation MEMORY.md> — raison

## Patterns récurrents (déjà gérés)

- ✅ <pattern déjà en mémoire/skill>

## Commits produits

| Commit | Sujet |
| ------ | ----- |
```

## 10. Mémoire de reprise (OBLIGATOIRE — c'est ce que lit le mode RESUME)

Le retex ci-dessus = **stats**. Les **décisions + la prochaine étape** vont dans une mémoire IA
dédiée, écrite/MAJ à CHAQUE fin de session — sinon RESUME n'a rien à reprendre au prochain `/clear`.

```bash
MEM="/Users/cci/.claude/projects/-Users-cci-repository-nodefony-core/memory"
DATE=$(date +%Y-%m-%d)
echo "Mémoire de reprise : $MEM/project_session_${DATE}_state.md"
ls "$MEM"/project_session_${DATE}_state.md 2>/dev/null && echo "(existe → MAJ)" || echo "(à créer)"
```

Écrire (via tool Write) le fichier `project_session_<date>_state.md` :

```markdown
---
name: project-session-<date>-state
description: État fin session <date> — <focus 1 ligne + prochaine étape>
metadata:
  node_type: memory
  type: project
  originSessionId: <full-session-id>
---

# Session <date> — <focus>

## Fait

- <livrables + commits (hash + sujet)>

## Décisions

- <choix archi/design pris cette session, avec le POURQUOI> ; liens [[autre-memoire]]

## Reste — prochaine étape

1. **Priorité 1** : <LA chose à faire ensuite> — liens [[kit]] / [[memoire]]
2. <suite éventuelle>
```

Puis **ajouter/MAJ la ligne pointeur** dans `MEMORY.md` (l'index auto-chargé) :
`- [Session <date> — état + reprise](project_session_<date>_state.md) — <hook + prochaine étape>`

## 11. Sauvegarde de la mémoire IA (OBLIGATOIRE — durabilité crash / changement de PC)

La mémoire IA vit dans `~/.claude/projects/-Users-cci-repository-nodefony-core/memory/` — **HORS
du repo nodefony** (non versionnée par le repo projet). Elle est sauvegardée dans un **repo git
PRIVÉ** `ccamensuli/nodefony-ai-memory`, dont la racine de travail est **`~/.claude` tout entier** :
le `CLAUDE.md` global, `settings.json`, la ligne d'état et `backup/` partent avec la mémoire.
`git add -A` porte sur TOUT le dépôt même lancé depuis le dossier de mémoire — le geste ci-dessous
est donc inchangé, il sauvegarde simplement davantage. **À CHAQUE fin de session**,
après avoir écrit le retex + l'état de reprise + MAJ `MEMORY.md`, **commit + push** ce repo, sinon
le backup se périme et un crash perd le travail :

```bash
MEM="/Users/cci/.claude/projects/-Users-cci-repository-nodefony-core/memory"
git -C "$MEM" add -A
git -C "$MEM" -c user.name="Christophe CAMENSULI" -c user.email="ccamensuli@gmail.com" \
  commit -q -m "session <date>: <focus court>" && git -C "$MEM" push -q
git -C "$MEM" log --oneline -1
```

> **Restauration sur un poste neuf : la procédure vit dans `~/.claude/README.md`** (sauvegardé
> avec le reste), et elle remonte le POSTE, pas seulement la mémoire — outillage système relevé sur
> la machine (Homebrew, nvm + Node, bun/pnpm/yarn, Docker, `wrk`, `gitleaks`, `mkcert`), les deux
> dépôts à cloner, l'infra docker de test, et les secrets à reposer à la main. Ne pas la recopier
> ici : elle divergerait. ⚠️ Le dossier de mémoire encode le CHEMIN ABSOLU du projet — un poste
> qui range le dépôt ailleurs ne voit plus aucune mémoire, sans le dire.
> Le mode **RESUME** peut faire `git -C "$MEM" pull -q` au début pour récupérer une session faite ailleurs.

---

## Anti-patterns END / CONSOLIDATE

- **Lire tout le transcript** dans Claude (plusieurs MB) — toujours `jq` pour filtrer.
- **Proposer un skill à la légère** — n'inventer que si le pattern ≥ 3 fois.
- **Mesurer les tokens exacts** — impossible en local ; utiliser les **caractères** comme proxy.
- **Oublier de sauver** le retex — c'est le matériau de la consolidation.
- **Consolider trop tôt** — attendre 10-20 retex.
