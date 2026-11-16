## État du projet

Le cœur — serveurs, routage, sécurité, temps réel, persistance, console d'administration,
construction des frontends — est couvert par des suites de tests exécutables sur infrastructure
<!-- @if core -->
réelle (`npm run test:all`), et le dépôt versionne des seuils de fuite mémoire et de charge
<!-- @end -->
<!-- @if npm -->
réelle, et le dépôt versionne des seuils de fuite mémoire et de charge
<!-- @end -->
opposables à chaque exécution.

**Ce que ça donne en charge.** À résultat observable égal — mêmes en-têtes de sécurité, même
identifiant de requête, même corrélation `traceparent`, même protection CSRF, vérifiés par un
contrôle de parité —, Nodefony sert de 4 à 17 % de requêtes en moins que NestJS 12 équipé (sur
Fastify et sur `node:http`) et se tient dans la même zone qu'Express 5 équipé, sur une route qui
ne fait rien — le cas où le framework est tout le budget. Dès qu'une base entre dans la boucle, les
camps se tiennent à quelques pourcents, sauf sur le refus de validation face à Express (−21 %),
où Nodefony audite chaque refus quand le témoin n'en garde aucune trace. Quatre-vingt-dix minutes de charge continue et 110 millions de requêtes
laissent le tas plat et aucune ressource accumulée. Mesuré sur un portable de 2018 : seuls les
rapports entre camps valent, pas les absolus. La page de la version courante —
**[peut-on partir en production ?](https://nodefony.net/performance/latest/)** — porte le comparatif,
la tenue dans la durée et le dimensionnement d'un pod ;
**[où part le temps](https://nodefony.net/performance/analyses/)** décompose l'écart étage par étage
et nomme le travail que la parité ne voit pas.

Ce qu'il faut savoir avant de bâtir dessus : les versions JavaScript historiques (≤ 7.x) ne
reçoivent plus de correctifs.

**Une seule personne en répond, et le projet est écrit pour être repris.** Nodefony est libre et
développé bénévolement par son auteur. Si l'auteur s'arrête, la connaissance ne part pas avec lui :
chaque décision d'architecture est consignée dans un ADR, la documentation renvoie aux symboles du
code source et un contrôle refuse un renvoi devenu faux, et le dépôt porte ses consignes pour agents,
ses tests et sa chaîne de publication. Ce qui dépend vraiment d'une personne, c'est la
responsabilité : publier un correctif, trancher une rupture. La
[gouvernance](https://github.com/nodefony/nodefony-core/blob/main/GOVERNANCE.md) le dit sans
détour, avec ce qui protège ceux qui s'en servent.

Licence [Apache 2.0](LICENSE.txt) — permissive, avec concession de brevet explicite.
**Christophe Camensuli** · [ccamensuli@gmail.com](mailto:ccamensuli@gmail.com)

---

<div align="center">

_La suite est une couche d'agents IA construite sur ce socle : le même pipeline, la même sécurité, le
même temps réel — et une application qui sait déjà se décrire à une machine._

</div>
