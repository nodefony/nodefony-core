# Les verdicts de migration, en entier

> Chargé à la demande. Le `SKILL.md` porte les cinq refus courants et leur geste ; cette page les
> donne tous, avec la charge utile que la commande rend en `--json`.

## Ce que rend une lecture d'état

`orm:migrate:status --json` rend **un seul objet**. Son cœur est NEUTRE — un second moteur de base
de données remplira la même structure — et tout ce qui est propre au pilote SQL vit sous `driver`.
N'écris jamais un chemin de lecture qui passe par le nom d'un pilote.

```json
{
  "formatVersion": 1,
  "connector": "default",
  "verdict": "pending",
  "exitCode": 1,
  "summary": "1 migration en attente sur « default ».",
  "nextActions": [
    {
      "command": "nodefony orm:migrate --dry-run",
      "args": ["orm:migrate", "--dry-run"]
    },
    { "command": "nodefony orm:migrate", "args": ["orm:migrate"] }
  ],
  "sources": [
    {
      "name": "app",
      "applied": 2,
      "pending": 1,
      "failed": 0,
      "pendingTags": ["0003_ajout_slug"],
      "drifted": [],
      "missing": [],
      "entries": [
        {
          "tag": "0001_init",
          "status": "applied",
          "appliedAt": 1756400000000,
          "durationMs": 42,
          "appliedBy": "poste-de-dev",
          "runId": "b0e2…"
        },
        { "tag": "0003_ajout_slug", "status": "pending" }
      ]
    }
  ],
  "driver": {
    "kind": "sql",
    "dialect": "postgres",
    "ddl": "none",
    "historyTable": "nodefony_migrations"
  }
}
```

**Les six verdicts**, dans l'ordre de gravité — le premier qui s'applique gagne, et cet ordre dit
quel geste vient EN PREMIER :

| `verdict`    | Ce que ça dit                                                        | `exitCode` |
| ------------ | -------------------------------------------------------------------- | ---------- |
| `failed`     | une migration a échoué : rien d'autre ne se discute avant réparation | `1`        |
| `drift`      | un fichier appliqué a changé depuis son application                  | `1`        |
| `adopt`      | la base porte les tables sans historique — elle est antérieure       | `1`        |
| `divergent`  | la base ne correspond pas au schéma déclaré                          | `0` ou `1` |
| `pending`    | des migrations restent à appliquer                                   | `1`        |
| `up-to-date` | rien à faire                                                         | `0`        |

> `divergent` est le seul dont le code de sortie DÉPEND d'un réglage : selon la conduite choisie,
> il informe (`0`) ou bloque (`1`). Superviser ne doit pas faire tomber un déploiement par défaut.

## Ce que rend un refus

Une sortie qui porte `error` est un ARRÊT ; une sortie qui porte `verdict` est un état lu. Aucune
n'a jamais les deux — c'est le discriminant à tester.

```json
{
  "formatVersion": 1,
  "connector": "default",
  "exitCode": 1,
  "error": {
    "code": "NF_MIGRATE_BASELINE_REQUIRED",
    "summary": "Cette base porte déjà les tables du schéma mais n'a aucun historique de migration.",
    "meaning": "",
    "nextActions": [
      {
        "command": "nodefony orm:migrate:baseline --connector default",
        "args": ["orm:migrate:baseline", "--connector", "default"]
      }
    ]
  }
}
```

## Tous les codes

### Refus de l'applicateur — l'état de la base ou des fichiers

| Code                               | Ce qui s'est passé                                             | Le geste                                                                       |
| ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `NF_MIGRATE_BASELINE_REQUIRED`     | tables présentes, historique vide                              | `orm:migrate:baseline` — adopte explicitement, n'exécute aucun SQL             |
| `NF_MIGRATE_BASELINE_AMBIGUOUS`    | la base s'écarte du schéma déclaré : adopter graverait un faux | `--up-to <tag>` pour borner, ou `--from-database` si aucune migration n'existe |
| `NF_MIGRATE_BASELINE_NOT_EMPTY`    | `--from-database` demandé, mais des migrations existent déjà   | `orm:migrate:baseline` sans option — l'historique des fichiers fait foi        |
| `NF_GENERATE_DATABASE_NOT_ADOPTED` | aucune migration écrite, et la base porte déjà ces tables      | `orm:migrate:baseline --from-database`, puis regénérer                         |
| `NF_MIGRATE_FAILED_MARKER`         | une migration a échoué ou n'a jamais fini                      | lire l'erreur enregistrée, corriger la base, puis `orm:migrate:repair`         |
| `NF_MIGRATE_HASH_MISMATCH`         | le fichier d'une migration appliquée a changé                  | rétablir le fichier ; sinon écrire une migration correctrice                   |
| `NF_MIGRATE_OUT_OF_ORDER`          | une migration en attente se range avant la dernière appliquée  | renommer la nouvelle pour qu'elle suive la dernière appliquée                  |
| `NF_MIGRATE_MISSING_FILE`          | une migration appliquée n'a plus de fichier                    | rétablir le fichier — il fait partie de l'historique                           |
| `NF_MIGRATE_UNKNOWN_FORMAT`        | un fichier n'est pas au format que cet applicateur lit         | vérifier le journal de la source ; ne pas éditer à la main                     |
| `NF_MIGRATE_LOCK_TIMEOUT`          | le verrou est tenu par un autre travail                        | attendre, puis rejouer — le verbe est idempotent                               |
| `NF_MIGRATE_JOURNAL_MISMATCH`      | le journal annonce un fichier que le dossier ne contient pas   | rétablir le fichier, ou régénérer la source                                    |

### Refus d'usage — la demande elle-même

| Code                           | Ce qui s'est passé                                             | Le geste                                              |
| ------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------- |
| `NF_MIGRATE_UNKNOWN_CONNECTOR` | aucun connecteur de ce nom                                     | le message liste ceux que l'application déclare       |
| `NF_MIGRATE_UNKNOWN_TAG`       | `--up-to` désigne une migration inconnue                       | relire `sources[].pendingTags`                        |
| `NF_MIGRATE_UNKNOWN_SOURCE`    | `--source` n'est pas déclarée par cette application            | relire `sources[].name`                               |
| `NF_MIGRATE_URL_MISMATCH`      | la variable de migration désigne une base d'un AUTRE dialecte  | corriger la variable, ou choisir le bon connecteur    |
| `NF_MIGRATE_NOT_CONFIGURED`    | connecteur SQL non déclaré dans la configuration               | le déclarer pour pouvoir le suivre                    |
| `NF_MIGRATE_NO_MIGRATIONS`     | ce connecteur est porté par une base qui ne se migre pas ainsi | rien à migrer ici — ce n'est pas une panne            |
| `NF_MIGRATE_NOT_DEVELOPMENT`   | geste réservé au développement, demandé ailleurs               | passer par le travail de déploiement                  |
| `NF_MIGRATE_DESTRUCTIVE`       | des migrations en attente SUPPRIMENT des données               | relire le fichier produit, puis assumer explicitement |
| `NF_MIGRATE_UNAVAILABLE`       | la commande n'a pas pu joindre la base                         | vérifier la connexion et les droits                   |

## Un contrat qui ne bougera pas

`formatVersion` vaut `1` au premier niveau de chaque sortie. Ajouter un champ est une évolution
mineure ; en retirer ou en renommer un est interdit sur la série majeure. Les codes de sortie
`0` / `1` / `2` sont figés : des passes d'intégration continue s'y adossent.
