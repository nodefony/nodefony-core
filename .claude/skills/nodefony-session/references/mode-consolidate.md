# MODE CONSOLIDATE — plan d'amélioration IA + maintenance du SAS

> Référence du skill `nodefony-session`, chargée au mode **CONSOLIDATE** (« consolide les retex »,
> « plan d'amélioration IA »), tous les 10-20 retex. Anti-patterns communs au END :
> [`mode-end.md`](mode-end.md).
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

Déclencheurs : "consolide les retex", "plan d'amélioration IA".

> **CONSOLIDATE porte les tâches LOURDES déplacées du END** (stats tool_use / coût € / allowlist via
> **`consolidate-toolkit.md` (voisin)**) **+ la maintenance du SAS `RETEX.md`** qui borne sa taille :
>
> 1. **Graduer** : tout **THÈME** de `RETEX.md` portant **~5 frictions distinctes** → le promouvoir
>    en **mémoire `feedback_*`** (durable, indexée dans `MEMORY.md`) PUIS **le retirer de
>    `RETEX.md`** (règle anti-doublon : jamais dans les deux), en laissant une ligne de renvoi vers
>    la mémoire pour qu'aucune leçon ne devienne introuvable.
> 2. **Vérifier le RETRAIT des graduations déjà faites** — c'est le pas qu'on saute, et c'est lui qui
>    gonfle le sas : `git -C "$MEM" log --diff-filter=A --since=<dernier CONSOLIDATE> --name-only
--format="" -- 'feedback_*.md'` liste les mémoires créées entre-temps ; chacune doit avoir vidé
>    son thème du SAS.
> 3. **Archiver** : déplacer les retex bruts consolidés vers `docs/session-retros/archive/` (`git mv`,
>    l'historique suit), et snapshoter `RETEX.md` AVANT coupe
>    (`archive/RETEX-snapshot-<date>.md`). `RETEX.md` reste ~1 écran.
> 4. **Nettoyer** : retirer de `RETEX.md` les frictions devenues obsolètes (corrigées dans le code/skill).
> 5. **PORTER — la troisième sortie du cycle, et celle qu'on saute.** Le cycle n'a longtemps eu
>    que deux sorties (friction → sas → mémoire), si bien qu'une leçon graduée ne protégeait que
>    l'agent qui la relit : elle ne sortait JAMAIS du dépôt, et aucune application générée n'en
>    profitait. Mesuré le 2026-09-08 : sur 115 leçons durables, **6 seulement sont portées par du
>    code livré**, 28 par un automate, et **81 ne tiennent que si on y pense**.
>
>    ```bash
>    node .claude/skills/nodefony-session/scripts/lessons-carriers.mjs --write   # + --inert, --dead
>    npm run lessons:carriers -- --recos    # la boucle recommandation → action
>    ```
>
>    Il classe chaque leçon en PRODUIT / DÉPÔT / CONTEXTE / INERTE, écrit l'empreinte
>    `.ai/LESSONS.md`, et surtout **nomme les ancres MORTES** — une mémoire qui prescrit un fichier
>    disparu envoie chercher au mauvais endroit sans jamais lever d'erreur.
>
> 6. **Contrôler que les specs FIGÉES n'ont pas dérivé** :
>
>    ```bash
>    npm run refs:check     # 0 = à jour · 3 = une spec a DÉRIVÉ (il la nomme) · 78 = réseau muet
>    ```
>
>    Une RFC ne bouge jamais ; une spec VIVANTE figée sous `references/` (AGENTS.md, MCP), si — et
>    elle se périme **en silence** : on continue de la citer en croyant tenir la norme. Sortie `3` :
>    relire le comparatif qu'il donne, puis remplacer les fichiers ET le `sha` de son `AMONT.json`.
>    Il ne met jamais à jour tout seul — une norme se relit avant d'être recopiée.
>
>    ⚠️ **Ici et pas au END**, et c'est une leçon payée : une spec bouge quelques fois par an, le
>    END se joue à chaque clôture. Y brancher ce contrôle en ferait un coût récurrent pour un
>    événement rare — exactement ce que [[feedback_ritual_must_earn_its_keep]] met en garde, et le
>    END est déjà jugé trop long.
>
>    **La question à poser à CHAQUE graduation** : quel automate, quel code du produit, quel gabarit
>    ou quel skill livré porte cette leçon ? Si la réponse est « aucun », l'écrire dans la mémoire
>    et dire pourquoi — certaines n'ont légitimement pas d'automate possible. Une leçon sans porteur
>    ni raison est une leçon qui se reperdra. → [[feedback_gate_must_run]]
>
>    **`--recos` ferme la boucle la plus ancienne**, celle que rien ne refermait : un retex
>    archivé porte une section « Recommandations » que personne ne relit jamais. Mesuré :
>    **937 recommandations dans 310 retex**, dont 30/36 mémoires nommées effectivement écrites
>    et 16/27 skills créés — le reste est du travail proposé, accepté par le silence, et perdu.
>    Le drapeau ne vérifie que ce qui NOMME un artefact (une mémoire, un skill) : c'est ce qu'un
>    automate rend sans jugement. Il annonce des « non résolus », jamais des « jamais créés » —
>    le motif attrape aussi des tournures, et c'est au lecteur de trancher.
>
>    🔴 **Cette liste n'est PAS un backlog, et surtout pas un backlog de skills.** Une
>    recommandation non suivie est le plus souvent un ARBITRAGE déjà pris, en mieux informé qu'au
>    moment où elle a été écrite. Le dépôt porte **27 skills** et la mesure connue est que **11
>    d'entre eux n'ont jamais été invoqués**, presque tous doublés par une règle du `CLAUDE.md` :
>    en créer davantage DÉGRADE le dispositif au lieu de l'améliorer
>    ([`docs/outillage-agents.md`](../../../../docs/outillage-agents.md)). Lire cette sortie comme une liste de
>    travaux à faire serait le contresens exact. Elle sert à une seule chose : voir ce qui a été
>    proposé puis **accepté par le silence**, et décider — le plus souvent, décider de ne rien faire
>    et de le dire.
>
>    ⚠️ **Cet outil n'a rien à faire au END.** Le END est déjà jugé trop long ; une commande de plus
>    à chaque clôture coûte plus qu'elle ne rend. Ici, tous les 10-20 retex, elle se paie.

## 1. Compter les retex

```bash
COUNT=$(ls docs/session-retros/*.md 2>/dev/null | grep -v CONSOLIDATION | wc -l | tr -d ' ')
echo "Retex accumulés : $COUNT"
[ "$COUNT" -lt 10 ] && echo "⚠️ < 10 retex — consolidation prématurée, attendre."
```

## 2. Lire les sections clés (jq/awk, pas tout le fichier)

```bash
for f in docs/session-retros/*.md; do
  case "$f" in *CONSOLIDATION*) continue ;; esac
  echo "=== $f ==="
  awk '/^## (Recommandations|Coûts évidents|Patterns récurrents)/{p=1} /^## (Commits|Tool usage|Top)/{p=0} p' "$f"
done
```

## 3. Patterns récurrents (≥ 3 retex)

Coûts répétés (restarts serveur, re-lectures, friction permissions), recommandations jamais
appliquées (skill suggéré 3× jamais créé), pièges récurrents (dist périmé, watch Rollup, ALS…).

## 4. Produire le PLAN D'ACTION

Présenter au user + sauver dans `docs/session-retros/CONSOLIDATION-<date>.md` :

```markdown
# Consolidation retex — <date> — retex #<N1> à #<N2>

## Patterns récurrents détectés

| Pattern | Occurrences | Impact |
| ------- | ----------- | ------ |

## Plan d'action (qualité IA)

1. **<action>** (ex: créer skill X) — résout <pattern>, gain estimé
2. **<MAJ CLAUDE.md>** — règle Y vue N fois
3. **<nouvelle mémoire IA>** — capture décision Z

## À archiver

- Retex consolidés → optionnel : docs/session-retros/archive/
```

## 5. Exécuter (avec accord user)

Créer skill / éditer CLAUDE.md / écrire mémoire. **Demander l'accord avant tout changement
structurant** (nouveaux skills, MAJ CLAUDE.md).

---
