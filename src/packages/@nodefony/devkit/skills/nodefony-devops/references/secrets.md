# Secrets, mots de passe, matière cryptographique

> **Maintenance** : vérité courante. Éditer en place.

## 1. Le fait qui gouverne tout

**Une couche d'image est lisible par quiconque télécharge l'image, et un fichier effacé par une
couche ultérieure y reste.** Un `COPY` d'un secret suivi d'un `RUN rm` ne supprime rien : le
secret est toujours dans l'archive, à une commande d'extraction. Un conteneur qui démarre ne le
montre plus — c'est précisément ce qui rend l'erreur indétectable à l'œil.

```bash
npx nodefony image:check <app>     # lit les COUCHES, pas l'image aplatie. Sort en échec.
```

C'est pour ça que ce contrôle existe, et pour ça qu'il ne regarde pas l'image aplatie : un
contrôle qui la regarderait serait **vert dans le cas exactement le plus fautif**.

## 2. Ce qui n'entre jamais dans l'image — le `.dockerignore`

Il est rendu avec l'application, et il exclut quatre familles. Ne les retire pas.

| Famille                                 | Pourquoi                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `**/node_modules`, `**/dist`            | Reconstruits **dans** l'image. Entrés depuis ta machine, ils masqueraient la construction et l'image partirait avec le code de la veille. |
| `var`, `logs`, `**/*.log`, `**/*.jsonl` | Écritures propres à une machine, sans valeur dans une image                                                                               |
| `*.local`, `**/*.local`                 | La convention des fichiers de secrets locaux — jamais commités, et pas davantage dans une image                                           |
| **La matière cryptographique**          | Clés privées, certificats                                                                                                                 |

> ⚠️ **Un motif de `.dockerignore` n'obéit pas aux règles du `.gitignore`.** Sans `**/`, il est
> **ancré à la racine du contexte** — alors qu'en `.gitignore` il vaut à toute profondeur. Un
> `*.log` seul ne voit donc aucun journal dans un sous-dossier. Quand tu ajoutes une exclusion,
> écris `**/motif` sauf si tu veux vraiment ne viser que la racine.

## 3. Les certificats — ils se MONTENT, ils ne se gravent pas

L'image du frontal ne contient **aucune** clé privée : les certificats sont montés en lecture
seule à l'exécution. En Kubernetes, un Secret monté en volume ; avec compose, un montage lié.

L'étage de construction efface aussi les certificats de développement générés localement, pour
qu'aucun certificat auto-signé de ta machine ne descende en production.

## 4. Les secrets de l'application

| Variable            | Ce qu'il protège                                               | Doit être partagé entre exemplaires ?                                  |
| ------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `NF_CSRF_SECRET`    | Les jetons anti-CSRF                                           | **oui** — sinon un jeton émis par un exemplaire est refusé par l'autre |
| `NF_TOTP_KEY`       | Le chiffrement au repos des secrets de double authentification | **oui** — sinon les seconds facteurs deviennent illisibles             |
| `NF_WEBHOOK_KEY`    | Le chiffrement des signatures de webhooks                      | **oui**                                                                |
| `NF_ADMIN_PASSWORD` | Le compte d'administration                                     | —                                                                      |

> 🔴 **Le partage entre exemplaires n'est pas un détail de confort.** Un secret différent par
> exemplaire produit des échecs **intermittents** — une requête sur deux, selon le répartiteur.
> C'est le symptôme le plus coûteux à diagnostiquer, parce qu'il ressemble à un problème réseau.

`NF_ADMIN_PASSWORD` a un défaut en développement. **En production il est obligatoire** : sans lui,
aucun compte d'administration n'est créé et le démarrage échoue — volontairement, plutôt que de
créer un compte avec un mot de passe connu de tout le monde.

## 5. Les monter, pas les poser en clair

Le suffixe `_FILE` marche sur **toute** variable — détail complet dans
[`variables.md`](variables.md). Ce qu'il faut retenir ici :

```yaml
# Kubernetes
env:
  - name: NF_CSRF_SECRET_FILE
    value: /run/secrets/csrf
volumeMounts:
  - { name: secrets, mountPath: /run/secrets, readOnly: true }
```

```yaml
# compose
secrets: [csrf]
environment:
  NF_CSRF_SECRET_FILE: /run/secrets/csrf
```

**Pourquoi le fichier plutôt que la variable** : une variable d'environnement est lisible dans
`/proc/<pid>/environ`, ressort dans `docker inspect`, dans un vidage de processus, et souvent dans
un rapport d'erreur. Un fichier monté ne ressort d'aucun des quatre.

**Poser `KEY` et `KEY_FILE` ensemble fait échouer le démarrage.** L'ambiguïté n'est pas arbitrée en
silence — c'est voulu.

## 6. Rotation

Les secrets de session et de CSRF ne peuvent pas changer d'un coup sans invalider ce qui est en
vol. L'ordre qui limite la casse :

1. Poser le nouveau secret **à côté** de l'ancien dans le gestionnaire de secrets.
2. Redéployer **progressivement** — les exemplaires reprennent le nouveau.
3. Retirer l'ancien **après** que tous les exemplaires ont repris, pas avant.

Entre 2 et 3, les deux valeurs coexistent : c'est la fenêtre où rien ne casse. Sauter l'étape 3
est l'erreur la plus fréquente — un secret « remplacé » qui traîne encore six mois plus tard.

## 7. Ce qu'il ne faut pas faire, et pourquoi c'est tentant

| Tentation                                        | Ce qui arrive                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Mettre le secret en `ARG` de construction        | Les arguments de construction sont **dans les métadonnées de l'image**. `docker history` les montre. |
| Copier le fichier de secrets puis l'effacer      | Il reste dans la couche. Voir §1.                                                                    |
| Mettre les secrets dans un ConfigMap             | Un ConfigMap n'est ni chiffré au repos ni traité comme sensible par les outils                       |
| Laisser le défaut de développement en production | Il est **connu** : il est dans le dépôt public du framework                                          |
| Passer le secret en ligne de commande            | La ligne de commande est visible dans la liste des processus du conteneur                            |
