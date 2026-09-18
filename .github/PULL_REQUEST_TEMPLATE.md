<!--
Merci pour cette contribution. Ce gabarit n'est pas une formalité : chaque case
correspond à une garde que le dépôt applique déjà à ses propres commits, et que
l'intégration continue vérifiera de toute façon. La remplir maintenant évite un
aller-retour.

🔒 Une faille de sécurité ne se corrige JAMAIS par une demande de fusion
publique : un correctif public raconte la faille. Passer par la politique de
sécurité — https://github.com/nodefony/nodefony-core/security/policy
-->

## Ce que ça change

<!-- Deux à quatre phrases. Le POURQUOI avant le QUOI : un diff se lit, une
intention non. -->

Ferme #

## Comment on le constate

<!-- La commande, l'écran ou le test qui MONTRE le changement. Une sortie collée
vaut mieux qu'une affirmation. -->

```

```

## Avant de demander la fusion

- [ ] Le **titre** suit [Conventional Commits](https://www.conventionalcommits.org) —
      `type(portée): verbe à l'infinitif` — et se comprend sans connaître ce dépôt.
- [ ] `npm run typecheck` et `npm test` passent en local.
- [ ] Le code est en **anglais** (identifiants), la prose en **français**
      (TSDoc, commentaires, libellés de test).
- [ ] Un test **neuf** a été vu **ROUGE** une fois : débrancher le correctif,
      constater que quelque chose tombe. Un test écrit face au code corrigé ne
      prouve rien.
- [ ] Ce qui n'a **pas** été lancé, ou reste supposé, est dit ci-dessous.

## Ce que je n'ai pas vérifié

<!-- Une phrase suffit — « non lancé : la suite d'intégration ORM, pas de base
locale ». C'est l'inverse d'un aveu : c'est ce qui permet au relecteur de
regarder au bon endroit. Rien à signaler → « rien ». -->
