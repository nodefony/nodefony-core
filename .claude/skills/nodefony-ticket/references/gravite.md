# La gravité d'un défaut — une norme, jamais une impression

> Référence du skill `nodefony-ticket`, chargée **avant d'ouvrir ou de trier un défaut** (type
> `Bug`). Déclencheurs : « quelle gravité ? », « c'est grave ? », « CVSS », « faille ou bug ? ».
>
> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.

## Gravité ≠ priorité — deux colonnes du tableau

| Colonne      | Ce qu'elle dit                        | Échelle                                                       |
| ------------ | ------------------------------------- | ------------------------------------------------------------- |
| **Gravité**  | ce que le défaut CASSE — l'impact     | IEEE 1044 : Blocking, Critical, Major, Minor, Inconsequential |
| **Priorité** | QUAND on le traite — l'ordonnancement | la nôtre : P0 à P3                                            |

La colonne **Gravité** est la SOURCE de la classe. Le corps du ticket en porte le **motif**
(`**Gravité** : Major — <ce qui casse>`), et le vecteur **CVSS** quand c'est une faille. GitHub
n'a pas de champ « gravité » pour une issue : la colonne vit sur le tableau de bord, que le lint
lit déjà.

La gravité fixe un **plancher** de priorité : on peut monter au-dessus (un Minor qui bloque une
publication passe P0), jamais descendre. `ticket:lint` signale l'inverse (`PRIORITE-SOUS-GRAVITE`).
Une feature n'a pas de gravité : sa valeur se décide, elle ne se mesure pas — la colonne reste vide.

## La classe — l'échelle de l'IEEE 1044, pour TOUT défaut

L'IEEE 1044 (classification des anomalies logicielles) nomme cinq classes pour l'attribut
_Severity_. On garde ses noms, en anglais, comme les libellés CVSS : un nom de norme ne se traduit
pas, il se reconnaît.

| Classe              | Ce qu'elle recouvre ici                                                                                    | Plancher |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | -------- |
| **Blocking**        | l'usage est arrêté tant qu'il n'y a ni correctif ni contournement — processus arrêté, démarrage impossible | P0       |
| **Critical**        | des opérations essentielles sont interrompues sans recours — données perdues ou corrompues                 | P0       |
| **Major**           | des opérations essentielles sont touchées mais peuvent continuer — un contournement existe                 | P1       |
| **Minor**           | des opérations non essentielles sont perturbées                                                            | P3       |
| **Inconsequential** | aucun effet notable sur le fonctionnement — texte, message, documentation                                  | P3       |

Les libellés viennent de la norme ; leurs définitions ci-dessus sont les NÔTRES, rédigées pour ce
dépôt — le texte de la norme n'est pas en accès libre, il n'a pas été relu.

La classe ne va **jamais seule** : `Major — l'export CSV échoue au-delà de 1 000 lignes`. Une
classe sans motif ne s'instruit pas — les scripts la refusent.

## Le score — CVSS 3.1, EN PLUS, pour une faille

**Un tiers peut-il, par ce défaut, atteindre la confidentialité, l'intégrité ou la disponibilité
de l'application ?** Oui → c'est une faille : elle garde sa classe IEEE 1044 ET reçoit un vecteur
CVSS 3.1 (FIRST). Un arrêt du processus à la portée d'une requête en est une (disponibilité) —
c'est le cas qui a fondé la règle (#739 : Blocking, CVSS 5,9).

On écrit le **vecteur**, jamais le score : `severity.mjs` le CALCULE (formule de la
spécification, arrondi de l'annexe A). Un score recopié est l'erreur la plus facile à faire, et
la plus crue. La version 3.1 et non 4.0 : c'est celle que lisent les avis de sécurité GitHub et
la plupart des outils, et sa formule se calcule sans tables.

| Métrique    | Question                                    | Valeurs                                                                |
| ----------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `AV`        | d'où l'attaque part-elle ?                  | `N` réseau · `A` adjacent · `L` local · `P` physique                   |
| `AC`        | l'attaquant contrôle-t-il le déclencheur ?  | `L` oui, à volonté · `H` il dépend de conditions qu'il ne maîtrise pas |
| `PR`        | quels droits faut-il avant ?                | `N` aucun · `L` un compte · `H` administrateur                         |
| `UI`        | faut-il qu'une victime agisse ?             | `N` non · `R` oui (cliquer un lien)                                    |
| `S`         | l'impact sort-il du composant ?             | `U` non · `C` oui (le navigateur, un autre service)                    |
| `C`/`I`/`A` | confidentialité / intégrité / disponibilité | `H` totale · `L` partielle · `N` aucune                                |

**`AC` décide presque toujours du verdict, et c'est là qu'on triche sans le vouloir.** Quand le
déclencheur dépend de ce que l'APPLICATION expose (une route qui sert un fichier illisible), c'est
`H` ; le dire, et donner l'autre lecture dans le corps (« 7,5 si une application laisse
l'utilisateur désigner le fichier »).

Libellés (§5) : 0 None · 0,1-3,9 Low · 4-6,9 Medium · 7-8,9 High · 9-10 Critical. Plancher : ≥ 7
→ P0 · 4 à 6,9 → P1 · < 4 → P2 ; le plancher retenu est le plus exigeant de la classe et du score.

## Le geste

```bash
# À la création — refuse un Bug sans gravité, AVANT de rien créer
npm run ticket:open -- --title "fix(http): …" --body-file corps.md --gravite "Major — motif" …
npm run ticket:open -- … --gravite "Blocking — motif" --cvss "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H"

# Un ticket déjà ouvert (d'avant la règle, ou né du formulaire GitHub)
node .claude/skills/nodefony-ticket/scripts/ticket-severity.mjs 196 "Major — motif" [--cvss …]
```

Les deux posent la colonne et écrivent au corps, juste avant l'estimation :

```markdown
**Gravité** : Blocking — un flux en échec d'ouverture arrêtait le processus serveur
**CVSS** : CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H — 5,9 (Medium)
**Estimation : 0,25 j**
```

**Depuis l'interface GitHub**, le formulaire de défaut (`.github/ISSUE_TEMPLATE/defaut.yml`)
DEMANDE la classe : un champ obligatoire à cinq options — jamais CVSS, une faille passe par le
canal privé. Un formulaire ne peut pas poser une colonne du tableau : GitHub rend le choix en
section `### Gravité` au corps, et `ticket:lint` (`BUG-SANS-GRAVITE`) donne alors le geste
`ticket-severity.mjs` tout fait, classe lue au corps. Les options dérivent de
`severityFormOptions()` ; `github-templates.test.mjs` refuse qu'elles divergent.

## Une faille dans une version PUBLIÉE

- **Le changelog** ne porte ni section `Unreleased` ni catégorie `Security` (Common Changelog,
  rédigé à la publication) : l'entrée part sous `Fixed`, et elle **dit** que c'est une faille,
  avec son vecteur et la version touchée.
- **Un avis de sécurité GitHub** ne se publie que pour une version que la politique de support
  couvre (`docs/guides/compatibilite.md` : la dernière majeure stable). Une bêta n'en reçoit pas :
  le ticket et l'entrée du changelog suffisent.
