---
title: "Attente et progression au terminal"
navTitle: Attente et progression
lang: fr
module: "@nodefony/core"
topic: progression
coverageModule: nodefony-core
coveragePackage: "nodefony (cœur)"
coverageFiles: "cli/progress.ts"
section: "Architecture"
audience: [developer]
tags:
  [
    cli,
    terminal,
    spinner,
    progression,
    barre,
    tty,
    windows,
    accessibilite,
    ergonomie,
  ]
version: "doc"
status: stable
updated: 2026-09-05
source: "src/nodefony/docs/progression.md"
---

# Attente et progression au terminal

> Une commande qui annonce une étape puis se tait pendant quarante secondes est
> indiscernable d'une commande plantée : l'utilisateur ne peut pas savoir s'il
> doit attendre ou interrompre. **Un point fixe n'est pas une progression.**
> Ancré sur `src/nodefony/src/cli/progress.ts`.

📍 [Documentation](../../../docs/index.md) › [@nodefony/core](index.md) › **Attente et progression**

## 🧠 Le modèle mental — deux formes, un socle

| On sait…                               | La forme                        |
| -------------------------------------- | ------------------------------- |
| seulement que ça travaille             | `Spinner`                       |
| combien d'unités sur combien           | `ProgressBar`                   |
| les deux (une étape longue qui avance) | `ProgressBar` avec `spin: true` |

Les deux partagent `LiveLine`, qui porte ce que toute ligne réécrite doit
savoir : le flux, la détection de terminal, l'effacement **avant** écriture, la
troncature à la largeur, et le curseur.

```ts
import { Spinner, ProgressBar, formatDuration } from "nodefony";

const spinner = new Spinner();
spinner.start("Compilation");
await build();
spinner.stop(`✓ Compilation (${formatDuration(elapsed)})`);
```

```ts
const bar = new ProgressBar({ spin: true });
bar.start(files.length, "bundles");
for (const file of files) {
  await compile(file);
  bar.increment();
}
bar.stop(`✓ ${files.length} bundles`);
```

## 🗺️ Où vit quoi

| Ce qu'on cherche                                       | Où c'est                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| Le socle des deux formes — une ligne réécrite en place | `src/nodefony/src/cli/progress.ts:375` (`LiveLine`)              |
| Le tourniquet                                          | `src/nodefony/src/cli/progress.ts:498` (`Spinner`)               |
| La barre                                               | `src/nodefony/src/cli/progress.ts:645` (`ProgressBar`)           |
| Le dessin PUR, utilisable sans terminal                | `src/nodefony/src/cli/progress.ts:322` (`renderBar`)             |
| La capacité Unicode, CONSTATÉE sur l'environnement     | `src/nodefony/src/cli/progress.ts:117` (`supportsUnicode`)       |
| Les images, et leur repli                              | `src/nodefony/src/cli/progress.ts:46` (braille) et `:60` (ASCII) |
| Pourquoi une commande longue n'est plus interrompue    | `src/nodefony/src/command/Command.ts:256`                        |
| L'appelant asynchrone qui rend l'animation possible    | `src/nodefony/src/kernel/checks/deep.ts:297` (`runNpmScript`)    |

## 📖 Lexique

| Terme                          | Ce que c'est                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tourniquet** (`Spinner`)     | L'attente dont on ne connaît PAS la durée : une image qui tourne, aucun pourcentage.                                                                       |
| **Barre** (`ProgressBar`)      | L'attente dont on connaît le total : `renderBar` dessine, le reste anime.                                                                                  |
| **Ligne vivante** (`LiveLine`) | Une ligne réécrite en place, sans image ni total — le socle des deux formes.                                                                               |
| **Image** (_frame_)            | Un des caractères que le tourniquet fait défiler (`⠋ ⠙ ⠹ …`, ou `- \\                                                                                      | /` en repli). |
| **Repli ASCII**                | Ce que le produit dessine quand l'environnement ne promet pas l'Unicode : `cmd.exe` rend `⠋` en carré vide, et une animation illisible est pire qu'aucune. |
| **TTY**                        | Un terminal réel en face. Sans lui, on n'anime pas : une forge recevrait dix images par seconde dans son journal.                                          |

## 🔴 Ce qui ne passe JAMAIS par le Syslog

Une animation réécrit la même ligne dix fois par seconde. La faire passer par le
journal en ferait **dix entrées allouées par seconde**, poussées au tampon
circulaire, aux transports et au backplane — du décor d'affichage expédié à un
collecteur de logs.

Ces objets écrivent donc **directement** sur leur flux, et le journal les ignore.
C'est aussi la raison pour laquelle l'ancienne sévérité `SPINNER` (-1) a été
retirée du cœur : aucun code de production ne l'émettait, et les deux
indicateurs vivants du framework (`BootReporter`, `DevSupervisor`) l'évitaient
déjà délibérément.

## Ce que l'environnement décide, et pas vous

`shouldAnimate()` refuse d'animer dans quatre cas, tous constatés :

| Cas              | Pourquoi                                                              |
| ---------------- | --------------------------------------------------------------------- |
| pas un terminal  | `\r` ne ramène nulle part : chaque image deviendrait une ligne        |
| `CI` posé        | une forge peut fournir un terminal ; le journal deviendrait illisible |
| `TERM=dumb`      | déclaration explicite d'un terminal qui ne réécrit rien               |
| `NF_NO_PROGRESS` | l'interrupteur du projet                                              |

Hors animation, **seule la ligne finale de `stop()` est écrite** — c'est la trace
du passage, et c'est ce qui rend ces objets posables sans condition dans du code
qui tourne aussi bien en local qu'en forge.

## Windows — la capacité se CONSTATE

`cmd.exe` rend `⠋` en carré vide : une animation illisible est pire qu'aucune.
Mais Windows Terminal, VS Code et les consoles modernes dessinent le braille
parfaitement — les punir sur `process.platform` serait aussi faux que de
supposer que toutes y arrivent.

`supportsUnicode(env, platform)` interroge donc l'**environnement**
(`WT_SESSION`, `TERM_PROGRAM`, `ConEmuTask`, `TERM`), et retombe sur
`LINE_FRAMES` (`- \ | /`) et `BAR_STYLES.ascii` (`===--`) quand la réponse est
non. Les deux paramètres sont injectés : le comportement Windows s'éprouve
depuis n'importe quelle machine.

## Le curseur, et pourquoi il compte

Un curseur laissé masqué **survit au programme** : l'utilisateur se retrouve à
taper à l'aveugle, sans aucune raison de faire le lien avec l'outil qu'il vient
d'interrompre. Ce défaut n'arrive jamais au cas nominal — seulement sur `Ctrl+C`,
c'est-à-dire précisément quand l'utilisateur est déjà contrarié.

Le protocole reprend celui de `signal-exit` :

1. n'agir que si notre écouteur est le **seul** — sinon l'application a son
   propre arrêt gracieux, et c'est à lui de conclure ;
2. se **retirer** avant d'agir ;
3. réémettre par `process.kill`, **jamais** `process.exit` — qui mentirait au
   shell en lui présentant une sortie ordinaire là où il y a eu un signal.

⚠️ **Windows** : `SIGHUP` y lève `ENOSYS`. Seuls `SIGINT` et `SIGTERM` sont
écoutés, les deux que Node émule sur toutes les plateformes.

## Détails qui évitent les traînées

- **Troncature à la largeur** (`fitToWidth`), séquences de couleur non comptées.
  Sans elle, une ligne trop longue passe à la ligne et `clearLine` n'en efface
  qu'une : la queue reste à l'écran.
- **Sortie synchronisée** (mode `2026`) : le terminal publie effacement et
  réécriture d'un coup, plus de scintillement. Les terminaux qui l'ignorent ne
  voient rien changer.
- **Minuteur `unref()`** : une animation ne retient jamais un processus qui
  devrait sortir.
- ⚠️ **Une seule ligne.** Un rendu multi-lignes exigerait de compter les lignes
  déjà écrites pour toutes les effacer. Ce n'est pas le besoin ici, et le
  supposer laisserait des traînées.

## `renderBar` — utilisable sans terminal

Fonction **pure** : elle n'écrit nulle part et se teste par comparaison de
chaînes. Réutilisable dans un rapport, un journal ou une page.

```ts
renderBar(3, 10, { width: 10 }); // "▰▰▰▱▱▱▱▱▱▱"
renderBar(1, 2, { width: 4, style: BAR_STYLES.ascii }); // "==--"
```

Les bornes tiennent : `done` négatif, au-delà du total, total nul ou `NaN` ne
produisent jamais une barre d'une autre largeur. Le cas `NaN` n'est pas
théorique — il traverse `Math.min`, `Math.max` et `Math.round` sans lever, puis
`"▰".repeat(NaN)` rend la chaîne **vide** : une barre de vingt cellules
disparaissait en silence.

## Qui s'en sert

| Consommateur             | Forme                                      |
| ------------------------ | ------------------------------------------ |
| `nodefony doctor --deep` | `Spinner` par script lancé, sur **stderr** |

⚠️ Une animation exige que la boucle d'évènements tourne. Un `spawnSync` la
bloque : aucun `setInterval` ne s'y déclenche, et le tourniquet reste figé sur sa
première image. Tout appelant qui attend un processus doit donc le faire de
façon **asynchrone** — c'est ce qui a été corrigé dans `kernel/checks/deep.ts`.

## ⚠️ Pièges (symptôme → cause → correction)

| Symptôme                                                   | Cause                                                                                                                                                                        | Correction                                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le tourniquet peint sa première image puis reste **figé**  | Un `spawnSync` bloque la boucle d'évènements : aucun `setInterval` ne s'y déclenche                                                                                          | Attendre le processus de façon **asynchrone** (`spawn` + promesse) — cf `kernel/checks/deep.ts`                                                          |
| Une commande longue **sort en 0 au milieu** de son travail | L'action d'une commande est câblée comme un écouteur de cycle de vie, borné par le délai de démarrage. Passer en asynchrone a RÉVEILLÉ ce minuteur, que le blocage éteignait | L'action est marquée `tagUnboundedListener` : la borne du boot ne s'y applique plus (`command/Command.ts`)                                               |
| Rien ne s'anime alors qu'un terminal est là                | `CI` est posé, ou la sortie n'est pas un TTY                                                                                                                                 | Voulu : une forge ne doit pas recevoir dix images par seconde. Forcer avec `animate: true`                                                               |
| Des carrés vides à la place des images, sous Windows       | `cmd.exe` ne rend pas le braille ; le produit replie en ASCII                                                                                                                | Rien à corriger — c'est le repli. Un TEST qui exige du braille doit injecter son `env` (`{ WT_SESSION: "1" }`), jamais hériter du terminal de la machine |
| Une barre de vingt cellules **disparaît**                  | `"▰".repeat(NaN)` rend la chaîne vide                                                                                                                                        | `renderBar` borne son entrée ; ne pas recalculer un ratio à côté                                                                                         |

## 🧪 Tests & couverture

Un seul fichier couvre cette surface — les **chiffres exacts vivent dans la carte de l'aperçu**,
régénérée depuis vitest, jamais figés ici :

- **`progress.test.ts`** — le rendu pur (`renderBar` : ratios, bornes, largeurs), la décision
  d'animer (TTY, `CI`, `animate`), la constatation de capacité (`supportsUnicode` sur les trois
  plateformes, par injection de la grammaire), le tourniquet (première image immédiate, rotation
  au fil du temps, jeu d'images alternatif), la barre (dessin, avancement, libellé, tourniquet
  greffé sur un avancement figé), et le curseur (masqué au départ, RENDU à la sortie).

Ce qui **manque** aujourd'hui, et qu'il faut savoir :

- **Aucune épreuve sur un vrai terminal Windows.** La capacité est constatée par injection
  (`supportsUnicode(env, "win32")`), ce qui prouve la RÈGLE mais pas le rendu réel de `cmd.exe`.
- **Aucun banc de charge** : l'animation n'est pas dans un chemin chaud, elle n'a pas de budget.

Couverture : `npm run coverage` dans `src/nodefony`.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [@nodefony/core — vue d'ensemble](index.md) · [Toute la documentation](../../../docs/index.md)
- 🧭 **Pages sœurs** : [Journalisation (Syslog)](syslog.md) — ce qui, à l'inverse, doit passer par
  le journal · [Ligne de commande](cli.md) — `Cli` et `Command`, qui portent les commandes que ces
  formes accompagnent
