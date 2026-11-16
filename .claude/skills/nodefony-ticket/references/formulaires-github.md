# Les formulaires GitHub — le protocole rendu une seconde fois

> Détail chargé à la demande depuis le `SKILL.md` (§2, « Ces quatre blocs sont rendus DEUX fois »). Vérité courante — éditer en place, historique = `git log`.

Depuis que le dépôt sert des gabarits d'issue, le protocole ci-dessus existe aussi sous une forme
que GitHub sait lire : **`.github/ISSUE_TEMPLATE/defaut.yml` et `evolution.yml`**, dont les champs
SONT les blocs. C'est une duplication, et le dépôt s'interdit les duplications — mais celle-ci est
imposée par une frontière : GitHub ne sait pas lire cette page, il veut ses propres fichiers.

Quand une frontière impose la copie, la règle du dépôt est d'y poser un test qui compare les deux
sorties. C'est [`scripts/github-templates.test.mjs`](scripts/github-templates.test.mjs)
(`npm run test:pilotage`) : il LIT les blocs dans cette page — jamais une liste à lui, qui serait
une troisième copie — et exige de les retrouver en `label:` des deux formulaires, obligatoires.
**Renommer un bloc ici fait donc tomber le gate** tant que les formulaires n'ont pas suivi.

Il tient aussi les deux gardes que ces fichiers ne doivent pas perdre par distraction :
l'issue vierge reste fermée (sinon la page blanche revient, et le protocole redevient invisible de
l'extérieur), et le **canal de sécurité est le premier lien proposé**, vers la politique et jamais
vers un formulaire d'issue — une faille publiée est indexée en quelques minutes.

⚠️ **Ce que le formulaire ne peut PAS faire, et que la commande fait** : poser jalon, ordre et
priorité. Une issue ouverte depuis l'interface naît donc HORS du tableau de bord ; `ticket:lint` la
signale (`NI-JALON-NI-BACKLOG`), mais après coup. Les deux formulaires le disent en toutes lettres
aux mainteneurs — la voie normale reste `npm run ticket:open` (§5 du `SKILL.md`).
