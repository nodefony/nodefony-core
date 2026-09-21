Copyright (c) <%= it.year %> — <%= it.appName %>

Tous droits réservés.

Ce fichier est posé par `nodefony create app`, et il dit le défaut JURIDIQUE :
sans licence explicite, personne n'est autorisé à copier, modifier ou
redistribuer ce logiciel. C'est le bon défaut pour une application privée —
celle-ci naît d'ailleurs `"private": true` et `"license": "UNLICENSED"` dans son
`package.json`.

Si ce logiciel doit être partagé ou publié, le geste OUTILLÉ est de le créer
sous sa licence dès le départ — le fichier et le champ `license` du
`package.json` sont alors posés ensemble, et ne peuvent pas se contredire :

    nodefony create app mon-app --license MIT

Les identifiants servis : MIT, Apache-2.0, BSD-3-Clause, ISC. Pour une licence
à obligations (GPL, AGPL, MPL), REMPLACE ce fichier par son texte et aligne le
champ `license` sur son identifiant SPDX. Les deux doivent dire la même chose :
le champ est ce que lisent les outils, le fichier est ce que lisent les humains.

---

Ce que cette licence ne couvre PAS : les dépendances tierces. Elles restent sous
leur propre licence, et les licences permissives (MIT, BSD, Apache-2.0) exigent
toutes que leur notice de copyright voyage avec les distributions. Le relevé de
ce qui est redistribué vit dans THIRD-PARTY-NOTICES.md :

    npm run licenses            # le relevé, et ce qui n'a pas été examiné
    npm run licenses:write      # (re)génère THIRD-PARTY-NOTICES.md
