# MODE END — clôture de session (RETEX)

> Référence du skill `nodefony-session`, chargée au mode **END** (« fin de session », « retex »,
> « fais le retex »). Le `SKILL.md` route, cette page exécute.
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

RETEX = RETour d'EXpérience. **But réel** : amélioration continue de l'IA sur Nodefony — PAS un log
de tokens (`feedback_session_retros_purpose`).

**Le principe** : tout ce qui se COMPTE est fait par
[`scripts/session-end.mjs`](../scripts/session-end.mjs) ; l'agent ne garde que ce qu'aucun automate
ne sait faire — fermer un ticket avec son compte rendu, écrire les leçons, la mémoire de reprise.
Une clôture qui traîne est une clôture mal faite. Ordre : **1 → 2 → 3 → 4**, sans en sauter.

## 1. Préparer — `npm run session:end`

Une passe, ~25 lignes : la plage de commits de la session, les tickets que leurs messages citent et
leur état, les tickets ouverts qui citent les fichiers touchés, ceux qui **dépendent** d'un ticket
cité, le tableau contrôlé (`board-lint`) **puis seulement** photographié (empreinte + README du
projet + issue épinglée, dans le même run), le seuil du sas, et les deux chemins à écrire.
`--no-publish` évite les deux vitrines ; `--since <rév>` force le début de la plage.

- Le tableau en erreur **bloque l'empreinte** : une empreinte prise sur un tableau incohérent grave
  l'incohérence, et c'est elle qu'on relira hors ligne. Solder, relancer.
- Un refus de l'empreinte se LIT (« GitHub muet » : l'ancienne est conservée, c'est voulu ;
  « chute suspecte du nombre de tickets » : on ne force pas sans avoir compris).
- Un statut « In Progress » que plus aucun commit ne fait avancer est signalé par `board-lint` :
  le redescendre à `Todo` — un statut qui ment est pire qu'un statut absent.

## 2. Juger — ce que le script ne sait pas faire

1. **Fermer ou commenter les tickets soldés.** Un ticket seulement AVANCÉ reçoit un commentaire.
   La fermeture porte un **compte rendu**, pas une ligne — sa forme et `ticket-close.mjs` vivent
   dans le skill **`nodefony-ticket`** (`references/fermeture.md`) : le charger AVANT de fermer.
   Relire d'abord les tickets que la préparation a listés (fichiers touchés, dépendants) : fermer,
   c'est aussi recaler ce que ce ticket rendait faux ailleurs.
2. **Sas `docs/session-retros/RETEX.md`** : 3-5 bullets `[1× — <date courte>]` **sous un thème
   existant** — un titre neuf par session éclate les familles et le seuil de graduation (~5
   frictions par THÈME, pas par bullet) ne mord plus. Friction déjà présente → incrémenter `[N×]`.
   Déjà graduée en `feedback_*` → pointer, ne pas recopier. Thèmes mûrs annoncés → le DIRE au user :
   graduer est un travail de CONSOLIDATE.
3. **Retex court** au chemin donné par la préparation (`docs/session-retros/<date>-<id>.md`,
   ≤ 30 lignes, **sans tableaux de stats**) :

   ```markdown
   ---
   date: AAAA-MM-JJ
   session_id: <id complet>
   focus: <1 ligne>
   ---

   # Retex <date> — <id court>

   - **Fait** : <commits hash + sujet, tickets fermés>
   - **Frictions** : <ce qui a coûté, et pourquoi> (versées au sas sous leur thème)
   - **Décisions** : <tranchées, avec le pourquoi>
   ```

4. **Mémoire de reprise** au chemin donné (`project_session_<date>[lettre]_state.md`) — c'est ce que
   lit le prochain « reprends ». Elle **cite le hash de chaque `feat`/`fix` de la session** : le
   garde-fou de RESUME et `--verify` le contrôlent.

   ```markdown
   ---
   name: project-session-<date>-state
   description: État fin session <date> — <focus + prochaine étape>
   metadata:
     type: project
   ---

   # Session <date> — <focus>

   ## Fait

   - <hash> <sujet> …

   ## Décisions

   - <choix, avec le POURQUOI> ; liens [[mémoire]]

   ## Reste

   1. **Priorité 1** : <LA chose suivante> — [[kit]]
   ```

   Puis la ligne pointeur dans `MEMORY.md` :
   `- [⭐ État <date>](project_session_<date>_state.md) — <hook + prochaine étape>`.

5. **S'il est tard** (la préparation affiche 🌙) : nommer en UNE phrase le travail de nuit en attente
   (mémoires `project_*_night_runs.md`), son coût et sa durée — et attendre le OUI. Lancé détaché,
   sortie capturée ENTIÈRE dans un fichier, lue au réveil par `@agent-nodefony-run-log-report`.

## 3. Pousser

```bash
git push                                    # le dépôt — commits + .ai/ + docs/
MEM="$HOME/.claude/projects/-Users-cci-repository-nodefony-core/memory"
git -C "$MEM" add -A
git -C "$MEM" -c user.name="Christophe CAMENSULI" -c user.email="ccamensuli@gmail.com" \
  commit -q -m "session <date>: <focus court>" && git -C "$MEM" push -q
```

La mémoire vit HORS du dépôt, dans le dépôt git privé de `~/.claude` tout entier (`git add -A`
sauvegarde aussi le `CLAUDE.md` global et les réglages). Non poussée, un crash la perd. La
restauration sur un poste neuf vit dans `~/.claude/README.md` — ne pas la recopier ici. ⚠️ Le
dossier de mémoire encode le CHEMIN ABSOLU du projet : un poste qui range le dépôt ailleurs ne voit
plus aucune mémoire, sans le dire.

## 4. Vérifier — `npm run session:end -- --verify`

Un gate : il sort **1** tant qu'il manque quelque chose, et nomme chaque manque — arbre non propre
(`.ai/` compris), commits non poussés, `_state` du jour absent ou qui omet un `feat`/`fix`, pointeur
`MEMORY.md` manquant, retex absent, **dates ajoutées** dans un `MEMORY.md`/`CLAUDE.md` (ces fichiers
décrivent le présent), mémoire IA non commitée ou non poussée, CI rouge. Une CI encore en cours est
signalée ⏳ sans faire échouer : le prochain `session:resume` la relit de lui-même — ne pas
rouvrir le `_state` pour l'y écrire, ce qui relancerait commit et push.

**On ne dit « session close » que sur son vert.**

---

## Pourquoi un sas (`RETEX.md`)

Trois canaux, un seul relu : `CLAUDE.md`/skills et `MEMORY.md` sont relus ; les retex bruts ne le
sont jamais seuls. Le sas comble le trou : friction → thème à ~5 frictions → **graduée** en
`feedback_*` et retirée du sas (une leçon vit dans l'un OU l'autre, jamais les deux). CONSOLIDATE
gradue et archive pour tenir le sas à ~1 écran ; ses analyses coûteuses (tool_use, coût €,
allowlist) vivent dans [`consolidate-toolkit.md`](consolidate-toolkit.md) et ne se déroulent
jamais au END.

## Anti-patterns

- **Exécuter la clôture de mémoire** au lieu des deux passes du script — c'est là que les contrôles
  se sautaient.
- **Lire tout le transcript** dans le contexte — `jq` pour filtrer, et seulement en CONSOLIDATE.
- **Oublier le retex ou le `_state`** — le premier nourrit la consolidation, le second la reprise.
- **Consolider trop tôt** — attendre 10-20 retex.
