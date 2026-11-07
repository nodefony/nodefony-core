## Ce qu'il y a dans la boîte

<!-- prettier-ignore -->
| Brique | Rôle |
| --- | --- |
<!-- @if core -->
| [`nodefony`](https://nodefony.github.io/nodefony-core/docs/modules/core/) | Noyau : modules, injection de dépendances, configuration validée au démarrage, journalisation structurée corrélée, CLI — et le client temps réel partagé avec le navigateur |
<!-- @end -->
<!-- @if npm -->
| [`nodefony`](https://nodefony.github.io/nodefony-core/docs/modules/core/) | **Ce paquet** — noyau : modules, injection de dépendances, configuration validée au démarrage, journalisation structurée corrélée, CLI — et le client temps réel partagé avec le navigateur |
<!-- @end -->
| [`@nodefony/http`](https://nodefony.github.io/nodefony-core/docs/modules/http/) | Serveurs HTTP, HTTPS, HTTP/2 et WebSocket natifs, flux SSE, sessions, contextes de requête, certificats TLS |
| [`@nodefony/framework`](https://nodefony.github.io/nodefony-core/docs/modules/framework/) | Routeur, contrôleurs, décorateurs, vues — le modèle de programmation |
| [`@nodefony/security`](https://nodefony.github.io/nodefony-core/docs/modules/security/) · [`@nodefony/user`](https://nodefony.github.io/nodefony-core/docs/modules/user/) | Pare-feu par zones, authentification, autorisation par rôles, CSRF, audit |
| [`@nodefony/realtime`](https://nodefony.github.io/nodefony-core/docs/modules/realtime/) | Socket à canaux, salons et leurs membres, admission par canal, binaire CBOR, contre-pression, diffusion entre plusieurs instances |
| [`@nodefony/ai`](https://nodefony.github.io/nodefony-core/docs/modules/ai/) | Porte MCP : les outils de l'application offerts aux agents d'IA, en HTTP avec flux SSE ou en stdio |
| [`@nodefony/orm-core`](https://nodefony.github.io/nodefony-core/docs/modules/orm-core/) | Un contrat de dépôt de données, plusieurs moteurs : [Drizzle](https://nodefony.github.io/nodefony-core/docs/modules/drizzle/) (SQLite, PostgreSQL, MySQL), [Mongoose](https://nodefony.github.io/nodefony-core/docs/modules/mongoose/), [Redis](https://nodefony.github.io/nodefony-core/docs/modules/redis/) |
| [`@nodefony/frontend`](https://nodefony.github.io/nodefony-core/docs/modules/frontend/) | Construction et rechargement à chaud des frontends de chaque module |
| [`@nodefony/studio`](https://nodefony.github.io/nodefony-core/docs/modules/studio/) | Console d'administration |

Par défaut, un processus Node égale une instance : le passage à l'échelle revient à l'orchestrateur,
et les journaux partent sur la sortie standard. Sans orchestrateur, `nodefony cluster -w N` démarre N
workers isolés, relancés s'ils tombent.
