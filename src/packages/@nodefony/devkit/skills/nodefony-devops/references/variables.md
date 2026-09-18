# Les variables d'environnement

> **Maintenance** : vérité courante. Éditer en place.

## 1. La commande qui répond, et à laquelle rien ne ment

```bash
npx nodefony env            # la cascade des .env, la valeur EFFECTIVE de chaque variable, et sa PROVENANCE
npx nodefony env --json     # le même rapport, pour un script
```

C'est **la** commande d'exploitation. Elle ne dit pas ce que ton manifeste déclare : elle dit ce
que l'application a **réellement lu**, et d'où ça vient. Toutes les fois où « la variable ne fait
rien », la réponse est dans cette sortie.

```bash
npx nodefony inspect config --json          # la configuration effective, et la provenance de chaque valeur
npx nodefony inspect schema <module>        # les clés qui EXISTENT, leur type, ce qu'elles font
npx nodefony doctor --env production        # ce qui manquerait là-bas, depuis ici
```

> 🔴 **`inspect schema` avant d'écrire une clé.** Une clé inconnue n'est pas refusée : elle est
> **retirée en silence** à la validation. Tu poses le réglage, rien ne change, rien ne le dit.

## 2. Deux grammaires, et elles ne font pas la même chose

### `NF_<NOM>` — les variables du catalogue

Simple underscore. Ce sont des variables **déclarées**, avec un rôle, un type et un défaut connus.

### `NF__<MODULE>__<CHEMIN>` — la surcharge de configuration

**Double** underscore. Elle atteint **n'importe quelle clé de configuration de n'importe quel
module**, sans que cette clé ait eu besoin d'être prévue comme variable. Le séparateur en double
underscore est la convention .NET Core et Docker : explicite, et sans ambiguïté avec le camelCase.

```bash
NF__SECURITY__JWT__ACCESSTTLS=300
NF__HTTP__SERVERS__HTTPS__PORT=8443
NF__SECURITY__CORS__ORIGINS=https://a.com,https://b.com     # la virgule fait un tableau
```

- Le **premier segment est le module** (`SECURITY` → `@nodefony/security`), les suivants sont le
  chemin dans sa configuration.
- Les segments sont **insensibles à la casse** et résolus contre les clés réelles :
  `ACCESSTTLS` trouve `accessTtlS`.
- **Précédence** : appliquée **après** la configuration de l'application, et **avant** la
  validation du schéma. Donc une valeur surchargée est **validée comme les autres** — une valeur
  aberrante fait échouer le démarrage au lieu de s'installer.
- Résolue **une fois au démarrage**. Aucun coût par requête.

**La conversion est explicite**, pas devinée par une bibliothèque : `true`/`false` deviennent un
booléen, un nombre devient un nombre, `[…]` et `{…}` sont lus en JSON, une chaîne à virgules
devient un tableau, le reste reste une chaîne. C'est ce qui évite le piège classique où la chaîne
`"false"` est convertie en booléen **vrai**.

## 3. Le suffixe `_FILE` — les secrets montés

**Toute** variable du catalogue accepte un `_FILE`. Le contenu du fichier est lu, retour à la ligne
final retiré.

```yaml
env:
  - name: NF_CSRF_SECRET_FILE
    value: /run/secrets/csrf
```

Trois comportements à connaître, et les deux derniers sont ce qui distingue ce mécanisme d'un
mécanisme complaisant :

| Situation                                      | Ce qui se passe                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `KEY` absente, `KEY_FILE` pointe un fichier    | La valeur est lue dans le fichier                                   |
| **`KEY` ET `KEY_FILE` posées toutes les deux** | **Le démarrage ÉCHOUE** — l'ambiguïté n'est pas arbitrée en silence |
| `KEY_FILE` pointe un fichier **illisible**     | **Le démarrage ÉCHOUE** — pas de repli muet sur un défaut           |

C'est délibéré : un secret qu'on croit monté et qui ne l'est pas est une application qui tourne
avec un secret de développement, en production, sans que personne le sache.

Marche avec les secrets Docker, les secrets Kubernetes, et tout agent qui dépose un fichier.

## 4. Les variables de l'exploitation

Les seules qui te concernent au déploiement. Le catalogue complet, c'est `npx nodefony env`.

### Environnement et réseau

| Variable        | Rôle                       | Absente ⇒            |
| --------------- | -------------------------- | -------------------- |
| `NF_ENV`        | L'environnement applicatif | Dérivé de `NODE_ENV` |
| `NF_PORT`       | Port HTTP                  | `5151`               |
| `NF_PORT_HTTPS` | Port HTTPS                 | `5152`               |

### Derrière un frontal — **les plus importantes**

| Variable                     | Rôle                                              | Absente ⇒                                                                            |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `NF__HTTP__TRUSTPROXY`       | Quels intermédiaires sont crus sur leurs en-têtes | **Le schéma constaté est `http`** → cookie `__Host-` non émis, adresse client fausse |
| `NF__HTTP__TRUSTEDHOSTS`     | Les hôtes servis                                  | Un `Host` étranger n'est pas refusé                                                  |
| `NF__APP__DOMAINCHECK`       | Contrôle du domaine                               | Pas de contrôle                                                                      |
| `NF__HTTP__STATICS__ENABLED` | L'application sert-elle les fichiers statiques    | Elle les sert — donc en double avec ton frontal                                      |

### Données

| Variable          | Rôle                   | Absente ⇒                                            |
| ----------------- | ---------------------- | ---------------------------------------------------- |
| `NF_DATABASE_URL` | L'URL de la base       | **Repli sur SQLite local**, dans `var/` — silencieux |
| `NF_REDIS_URL`    | L'URL du cache partagé | Le cache n'est pas chargé                            |

> Le repli SQLite est le piège d'exploitation classique : l'application **démarre**, sert des
> requêtes, écrit dans un fichier — et chaque exemplaire a sa propre base. Rien n'est en erreur.
> `npx nodefony env` le montre en une ligne.

### Secrets — obligatoires en production

| Variable            | Ce qu'il protège                                 |
| ------------------- | ------------------------------------------------ |
| `NF_CSRF_SECRET`    | Les jetons anti-CSRF, partagés entre exemplaires |
| `NF_TOTP_KEY`       | Les secrets de double authentification au repos  |
| `NF_WEBHOOK_KEY`    | Les signatures de webhooks                       |
| `NF_ADMIN_PASSWORD` | Le compte d'administration                       |

Tous en `_FILE` en production. Détail et rotation → [`secrets.md`](secrets.md).

### Plusieurs exemplaires

| Variable                          | Rôle                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `NF_POD_NAME`                     | Identité de l'exemplaire — **dérive l'identité d'origine du bus temps réel** |
| `NF_INSTANCE_ID`                  | Identifiant d'exemplaire                                                     |
| `NF_REALTIME_DRIVER`              | Le transport du bus entre exemplaires                                        |
| `NF_REALTIME_BACKPLANE_SECRET`    | Scelle les enveloppes échangées sur le bus                                   |
| `NF_REALTIME_BACKPLANE_NAMESPACE` | Cloisonne deux applications qui partagent le même bus                        |

> 🔴 **Deux applications sur un même cache, sans espace de noms distinct, se parlent.** Le symptôme
> est un message qui arrive à des clients d'une autre application — jamais une erreur.

### Multi-process sur une seule machine

| Variable     | Rôle                                                     |
| ------------ | -------------------------------------------------------- |
| `NF_CLUSTER` | Active le mode multi-process                             |
| `NF_WORKERS` | Nombre d'exécutants — sinon dérivé des limites du cgroup |

En Kubernetes, **laisse ça tranquille** : un exemplaire = un processus = un pod, et c'est
l'ordonnanceur qui multiplie. Le mode multi-process sert sur une machine nue.

### Démarrage et journalisation

| Variable             | Rôle                                                    |
| -------------------- | ------------------------------------------------------- |
| `NF_BOOT_TIMEOUT_MS` | Au-delà, le démarrage abandonne — borne ta sonde dessus |
| `NF_BOOT_WARN_MS`    | Au-delà, il avertit                                     |
| `NF_LOG_DRIVER`      | `stdout` (défaut), `file`, ou aucun                     |
| `NF__DEBUG`          | Débogage ciblé, par module                              |

En conteneur, **laisse `NF_LOG_DRIVER` sur `stdout`** : c'est ce que ton collecteur ramasse. Écrire
dans un fichier à l'intérieur d'un conteneur, c'est écrire dans quelque chose qui disparaît.

## 5. Le préfixe `NF_` — pourquoi, et ce que ça t'évite

**Tout ce que Nodefony lit est préfixé `NF_`.** Pas par coquetterie : ton environnement de
production a déjà des `REDIS_HOST`, des `COOKIE_SECRET`, des `POD_NAME` que d'autres outils
revendiquent. Une collision ne produit **jamais** une erreur — elle produit un comportement
inexplicable.

Deux exceptions, et deux seulement :

- Ce que Nodefony ne possède pas : `NODE_ENV`, `CI`, `NODE_DEBUG`… — lues telles quelles.
- Les alias qu'un hébergeur **pose lui-même** (`DATABASE_URL`, `REDIS_URL`, `APP_ENV`) : acceptés,
  mais **en second rang** derrière la forme `NF_`.

> ⚠️ Corollaire d'exploitation : si tu poses `REDIS_URL` **et** `NF_REDIS_URL`, c'est la forme
> préfixée qui gagne. Purger l'une en croyant avoir purgé l'autre est une erreur déjà vue.
