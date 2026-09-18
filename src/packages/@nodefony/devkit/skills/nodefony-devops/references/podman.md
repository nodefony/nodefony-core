# Podman — les six écarts avec Docker

> **Maintenance** : vérité courante. Éditer en place.

Podman fait tourner cette image. Six choses changent, dont **une qui ne se répare pas** — et c'est
celle-là qu'il faut connaître avant de mettre une application derrière un frontal.

## 1. Le contrôle de santé disparaît

Podman construit en format OCI par défaut, et **le format OCI ne porte pas de `HEALTHCHECK`**.
`podman inspect` rend alors une valeur vide, et toute dépendance qui attend « ce service est sain »
ne s'arme jamais — donc l'orchestration de ton compose démarre dans le désordre, sans erreur.

```bash
podman build --format docker -t <app> .              # le garde
podman run --health-cmd '…' --health-interval 10s …  # ou le poser à l'exécution
```

## 2. L'arrêt coupe à 10 s — sous le drain

`podman stop` attend **10 secondes** par défaut. Le drain de l'application est borné à **15**.
Chaque arrêt tue donc l'application au milieu de son drain : code **137**, requêtes en vol perdues,
aucun message.

```bash
podman stop --time 20 <conteneur>
# ou, dans le compose :  stop_grace_period: 20s
```

C'est l'écart le plus fréquent, et celui qui ressemble le moins à un problème de conteneur.

## 3. Un montage lié n'est pas inscriptible, en mode sans privilèges

En mode sans privilèges, l'identifiant `1000` **du conteneur** est projeté sur un identifiant
subordonné **de l'hôte** — qui n'est pas ton `1000` à toi. Un dossier de ton disque monté dans le
conteneur ne lui appartient donc pas : le premier `mkdir` de l'application échoue en `EACCES`.

Deux remèdes :

- **un volume nommé** — il hérite du porteur du dossier sous-jacent, que l'image a déjà fixé ;
- **le suffixe `:U`** sur le montage, qui recale le porteur.

## 4. Conserver l'identité de l'hôte écrase le `USER` de l'image

`--userns=keep-id` **nu** fait tourner le processus sous l'identifiant de l'hôte, et non sous le
`1000` que l'image déclare. Si ton identifiant d'hôte n'est pas `1000`, les dossiers `/app/tmp` et
`/app/var` — qui appartiennent à `1000` — lui refusent l'écriture, et le démarrage meurt.

```bash
podman run --userns=keep-id:uid=1000,gid=1000 …
```

## 5. SELinux refuse les montages liés

Sur une distribution avec SELinux en vigueur, un montage lié est refusé (`permission denied`) tant
qu'il ne porte pas de suffixe de réétiquetage :

```bash
-v ./docker/db:/docker-entrypoint-initdb.d:ro,z
```

Le `z` partage l'étiquette entre conteneurs, le `Z` la rend exclusive. Sur un dossier partagé par
plusieurs services, c'est `z`.

## 6. 🔴 L'adresse du client est perdue — et ça ne se répare pas

En mode sans privilèges, la redirection de ports passe par un composant qui **ne préserve pas
l'adresse source**. Le trafic arrive donc depuis la passerelle, pas depuis le client.

Conséquences, toutes **silencieuses** :

- l'en-tête d'adresse d'origine porte la passerelle → **l'audit est faux** ;
- toute limitation par adresse voit **une seule** adresse → elle protège tout le monde de personne,
  ou bloque tout le monde ensemble ;
- aucune erreur, aucun journal : les valeurs sont plausibles, simplement fausses.

**Ce n'est pas un réglage à trouver.** Une autre pile réseau existe, mais son état varie selon les
versions. La conduite à tenir est de l'**énoncer** — dans le README de ton déploiement, dans le
ticket, dans la revue — et non de la masquer derrière une configuration qui en aurait l'air.

## 7. Ce qui marche pareil

| Point                                   | Verdict                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Un processus d'init dédié               | Inutile, comme avec Docker : `node` est le processus n° 1 et reçoit `SIGTERM` directement |
| Les ports au-dessus de 1024             | `5151`, `8080`, `8443` : rien d'inaccessible en mode sans privilèges                      |
| Racine scellée + volumes `tmp` et `var` | Identique                                                                                 |
| `podman kube play`                      | Joue tes manifestes **sans cluster** — voir ci-dessous                                    |

## 8. `podman kube play` — ce qu'il prouve, et ce qu'il ne prouve pas

```bash
podman kube play deploy/
```

**Il prouve** : que le YAML est valide, que l'image démarre avec ce contexte de sécurité, que les
volumes déclarés suffisent, que les sondes répondent.

**Il ne prouve pas** : l'admission de la politique de sécurité (aucun contrôleur d'admission), les
Ingress, un déploiement progressif, la mise à l'échelle.

C'est une preuve locale utile et bon marché. Elle ne remplace pas un cluster jetable — elle évite
d'en démarrer un pour une faute de frappe.
