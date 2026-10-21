# Dimensionner un pod — HTTP, WebSocket, SSE

> **Maintenance** : vérité courante. Éditer en place. Les constantes du §2 se recalent sur la page
> de performance publiée, jamais de mémoire.

## 1. Le modèle — un process, une boucle, un cœur

Un process Node exécute ton code sur **une seule** boucle d'événements. Ce qui borne un pod n'est
donc pas le nombre de cœurs de la machine, c'est la part de temps où cette boucle travaille :
l'**ELU** (_event loop utilization_, de 0 à 1). À ELU 1, le pod ne sert pas plus vite : il met en
file, et la latence monte.

| Conséquence                                   | Le geste                                                                                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un pod n'utilise **qu'un cœur** pour ton code | `requests.cpu: "1"`. Davantage ne sert qu'au ramasse-miettes et aux E/S de fond                                                                                                                             |
| Une **limite** processeur ralentit sans tuer  | pas de `limits.cpu` (voir le §3 de la page principale)                                                                                                                                                      |
| Monter en charge, c'est **ajouter des pods**  | horizontal, par l'orchestrateur ; `nodefony cluster -w N` n'est que pour une machine sans orchestrateur                                                                                                     |
| Plusieurs workers dans un pod                 | à éviter : la diffusion `broadcast()` ne touche que les clients du **même** worker, et le cluster Node répartit des **connexions** — avec les rares connexions h2c d'un proxy, un worker peut tout recevoir |

## 2. Les constantes mesurées — un ordre de grandeur, pas ta capacité

Mesurées sur Nodefony **10.0.0**, en **production**, Node 26.10, **un** process, route de banc
**triviale**, charge de 1 Ko. Chaque débit est ramené à ELU 1 (débit observé ÷ ELU), donc c'est un
**plafond**. Source et calculateur :
[peut-on partir en production ?](https://nodefony.github.io/nodefony-core/performance/latest/).

| Constante                                         | Valeur                        | Ce qu'elle dit                                                                        |
| ------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| Tas par socket WebSocket — TLS terminé au frontal | **≈ 10 Ko**                   | le coût d'une connexion **ouverte et muette** ; pente linéaire sur 0 → 800 sockets    |
| Tas par socket — TLS terminé par Node (`wss`)     | ≈ 12 à 14 Ko                  | mesure non concordante d'un run à l'autre : retenir le haut de la fourchette          |
| Écho WebSocket 1:1                                | ≈ 35 000 à 46 000 msg/s       | messages reçus **et** renvoyés par seconde, à ELU 1                                   |
| Diffusion à 100 abonnés                           | ≈ 197 000 livraisons/s        | une livraison = un message remis à un abonné ; c'est elle qui coûte, pas l'émission   |
| HTTP/1.1, route triviale                          | ≈ 15 000 req/s (TLS ≈ 12 000) | p99 ≈ 0,3 ms à vide — **ton** contrôleur, ta base et tes services dominent ce chiffre |
| Mémoire au repos (RSS)                            | **à mesurer chez toi**        | dépend des modules chargés ; `docker stats` sur un conteneur prêt et sans trafic      |

🔴 **Ce que ces constantes ne disent pas.** Une route réelle lit une base, signe un jeton, rend une
vue : elle coûte dix à cent fois la route de banc. Le coût d'un **flux SSE** ouvert n'est pas
mesuré. Ces nombres servent à vérifier un ordre de grandeur, puis à **mesurer ton application**
(§5) — jamais à remplir directement un manifeste.

## 3. La formule

Trois plafonds, et le pod est borné par le **premier** atteint :

```text
pods = max( ⌈ C / C_pod ⌉ , ⌈ M / (D_msg × u) ⌉ , ⌈ R / (D_req × u) ⌉ ) + 1

C      connexions simultanées (WebSocket + flux SSE) au pic
M      livraisons temps réel par seconde au pic (un message diffusé à N abonnés = N livraisons)
R      requêtes HTTP par seconde au pic
D_msg  livraisons/s d'UN pod à ELU 1  — mesurées sur TON application (§5)
D_req  requêtes/s d'UN pod à ELU 1    — idem
u      ELU visée : 0,6 — la marge absorbe une rafale et la reconnexion d'un déploiement (§4)
+1     le pod qui draine pendant un déploiement, ou celui qu'on perd
```

`C_pod` se déduit de la **mémoire** :

```text
limits.memory ≥ RSS_repos + C_pod × coût_socket + L × maxBackpressure + marge GC (≈ 30 %)

coût_socket      ≈ 10 Ko de tas (§2) + les tampons noyau et TLS, hors tas
L                clients LENTS simultanés tolérés
maxBackpressure  file d'envoi par socket avant de jeter : 4 Mio par défaut
```

> 🔴 **Le terme qui fait exploser la mémoire n'est pas le nombre de sockets, c'est la
> contre-pression.** Dix mille sockets muettes tiennent en ≈ 100 Mo de tas ; cent clients mobiles
> qui ne lisent plus, à 4 Mio chacun, en réservent 400. Pour des canaux d'**état** (seul le dernier
> instantané compte), baisser `maxBackpressure` — et le régler sur `websocket` **et**
> `websocketSecure`, régler l'un ne règle pas l'autre :
>
> ```ts
> use("@nodefony/http", {
>   websocket: { maxBackpressure: 262144, backpressureCloseAfterDrops: 50 },
>   websocketSecure: {
>     maxBackpressure: 262144,
>     backpressureCloseAfterDrops: 50,
>   },
> });
> ```
>
> Au-delà du solde de refus, le client est fermé en `1013` et se reconnecte de lui-même.

**Exemple.** 20 000 connexions, 2 000 messages/s diffusés à 50 abonnés en moyenne (100 000
livraisons/s), 300 req/s. Ton application mesure `D_msg = 60 000`, `D_req = 1 500`, RSS au repos
250 Mo, et tu tolères 200 clients lents avec `maxBackpressure` à 256 Kio :

- mémoire par pod pour 10 000 connexions : 250 + 10 000 × 0,01 + 200 × 0,25 = 400 Mo, + 30 % ≈ **520 Mo** ;
- connexions : ⌈20 000 / 10 000⌉ = 2 ;
- temps réel : ⌈100 000 / (60 000 × 0,6)⌉ = 3 ;
- HTTP : ⌈300 / (1 500 × 0,6)⌉ = 1 ;
- **pods = 3 + 1 = 4**, `limits.memory: 768Mi`. C'est le temps réel qui dimensionne, pas les connexions.

## 4. Ce qui change dès qu'il y a plus d'un pod

| Fait                                                                                              | Conséquence, et le geste                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un canal est **local au pod** par défaut                                                          | deux utilisateurs sur deux pods ne se voient pas, **sans erreur**. Bus partagé : `NF_REALTIME_DRIVER=redis` et `NF_REDIS_URL`, plus un `namespace` explicite si le Redis est mutualisé — sinon deux applications se parlent. Le canal doit aussi **demander** à traverser : skill `nodefony-add-realtime-channel` |
| Chaque exemplaire doit être **identifiable**                                                      | `NF_POD_NAME` depuis `metadata.name` — sans elle, l'identité d'origine du bus se confond entre pods                                                                                                                                                                                                               |
| Un déploiement **ferme** les WebSocket du pod qui draine (`1001`)                                 | tous ses clients se reconnectent **en même temps** sur les pods restants : `maxUnavailable: 0`, `maxSurge: 1`, et la marge `u = 0,6` du §3                                                                                                                                                                        |
| La limitation de débit compte **par adresse cliente**                                             | derrière un frontal sans `NF__HTTP__TRUSTPROXY`, tous les clients ont l'adresse du frontal : une vague de reconnexions épuise un seul quota et répond `429` à tout le monde                                                                                                                                       |
| Une connexion WebSocket **ne migre pas**                                                          | après un ajout de pods, les anciens gardent leurs connexions jusqu'à ce qu'elles se rouvrent : l'équilibre ne revient qu'avec les reconnexions. Côté HAProxy, `balance leastconn` répartit mieux des connexions longues que le tourniquet                                                                         |
| Le CPU est un mauvais signal de mise à l'échelle pour des connexions longues                      | un pod chargé de sockets muettes a peu de CPU et beaucoup de mémoire. L'application **n'expose aucune métrique Prometheus** : une mise à l'échelle sur le nombre de connexions demande de la produire toi-même                                                                                                    |
| Chaque connexion est un **descripteur de fichier**, deux à travers un frontal sur la même machine | vérifier `ulimit -n` de l'hôte ou du conteneur avant de viser des dizaines de milliers de connexions par pod                                                                                                                                                                                                      |

## 5. Mesurer TON application — la seule source de `D_msg` et `D_req`

1. **Un pod**, en production (`NODE_ENV=production`), à la taille prévue, avec ses vraies
   dépendances (base, Redis). Pas de limite processeur.
2. Une charge qui ressemble au trafic réel : tes routes, tes canaux, tes tailles de message.
   `h2load` (HTTP/1.1 et h2c avec le même instrument), `k6` ou `artillery` pour le WebSocket.
3. Monter par paliers jusqu'à ce que le CPU du conteneur plafonne autour d'**un** cœur
   (`kubectl top pod`, `docker stats`) ou que le p99 décroche : le débit à ce palier est ton plafond.
4. Rejouer **trois fois** et garder la médiane. Un écart de plus de 10 % entre runs ne tranche
   rien : le décor bouge (autre charge sur la machine, base froide).
5. Mesurer la mémoire **à connexions ouvertes et muettes**, par paliers (0, 1 000, 2 000…) : la
   pente est ton `coût_socket`. Une mesure à un seul point mélange le repos et le coût.

> Le CPU d'un conteneur additionne la boucle, le ramasse-miettes et les fils d'E/S : il surestime
> un peu l'ELU. C'est sans gravité pour dimensionner — la marge `u = 0,6` le couvre — mais deux
> mesures ne se comparent qu'avec le même instrument.
