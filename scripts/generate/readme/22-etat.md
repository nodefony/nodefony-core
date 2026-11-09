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

**Ce que ça donne en charge.** À travail égal — mêmes journaux, même contexte de requête, mêmes
<!-- @if core -->
en-têtes de sécurité, même protection CSRF —, Nodefony se tient **dans la même zone qu'Express et
NestJS munis des mêmes intergiciels** : entre 93,6 et 112,7 % de leur débit sur une route qui ne
<!-- @end -->
<!-- @if npm -->
en-têtes de sécurité, même protection CSRF —, Nodefony se tient **dans la même zone que les frameworks
Node.js établis, munis des mêmes intergiciels** : entre 93,6 et 112,7 % de leur débit sur une route qui ne
<!-- @end -->
fait rien (21 686 requêtes/s, p99 4,4 ms sur la machine de référence), entre 95,9 et 96,7 % sur une
route qui lit et écrit une base — pour une résolution de banc de 3 %. Quatre-vingt-huit minutes de
charge continue et 97,5 millions de requêtes laissent **le tas, l'empreinte mémoire et le `rss`
plats** : 0,021 Mo par million de requêtes. La page de mesures de la version courante —
**[peut-on partir en production ?](https://nodefony.net/performance/latest/)** — porte le comparatif, la
tenue dans la durée, le dimensionnement d'un pod et un calculateur ; elle nomme aussi ce que ces
chiffres **ne** prouvent pas. Le dossier [`docs/performance/`](https://nodefony.net/performance/) donne le
protocole, les scripts qui rejouent chaque chiffre et les instruments qui ont menti avant qu'on
s'en aperçoive — aucun absolu pris derrière un chemin virtualisé n'est transposable.

Ce qu'il faut savoir avant de bâtir dessus : les versions JavaScript historiques (≤ 7.x) ne
reçoivent plus de correctifs. Projet libre, développé bénévolement par une seule personne.

Licence [Apache 2.0](LICENSE.txt) — permissive, avec concession de brevet explicite.
**Christophe Camensuli** · [ccamensuli@gmail.com](mailto:ccamensuli@gmail.com)

---

<div align="center">

_La suite est une couche d'agents IA construite sur ce socle : le même pipeline, la même sécurité, le
même temps réel — et une application qui sait déjà se décrire à une machine._

</div>
