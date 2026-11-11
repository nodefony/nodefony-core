## Développer le framework lui-même

<!-- @if core -->
### Le poste de travail

Une application n'exige que Node. Le dépôt du framework, lui, se teste contre de vrais services et
de vrais clients : il lui faut davantage. Chaque outil ci-dessous est appelé par un script ou une
suite du dépôt — aucun n'est là par confort.

| Outil | Pourquoi | Linux (Debian, Ubuntu) | macOS (Homebrew) | Windows |
| --- | --- | --- | --- | --- |
| **Node 24.16+ ou 26+** | le plancher `engines` ; la CI joue 24 et 26 | `nvm install 26` | `nvm install 26` | `nvm install 26` (nvm-windows) |
| **git**, **GitHub CLI** | dépôt, tickets, tableau de bord | `apt install git gh` | `brew install git gh` | `winget install Git.Git GitHub.cli` |
| **Docker** et Compose | bases, Redis, Keycloak, proxys : **sans lui, des suites entières se sautent et comptent comme vertes** | Docker Engine + extension `compose` | Docker Desktop | Docker Desktop (WSL 2) |
| **jq**, **ripgrep** | scripts du dépôt, contrôle des tickets (`rg` doit être sur le PATH) | `apt install jq ripgrep` | `brew install jq ripgrep` | `winget install jqlang.jq BurntSushi.ripgrep.MSVC` |
| **bun**, **pnpm**, **yarn** | une application générée s'installe avec chacun | `npm i -g bun pnpm yarn` | idem | idem |
| **mkcert** | certificat de développement approuvé (sinon : auto-signé) | `apt install mkcert libnss3-tools` | `brew install mkcert nss` | `winget install FiloSottile.mkcert` |
| **gitleaks** | garde anti-secrets | binaire publié | `brew install gitleaks` | `winget install Gitleaks.Gitleaks` |
| **wrk**, **h2load** | bancs de charge HTTP/1.1 et HTTP/2 | `apt install wrk nghttp2-client` | `brew install wrk nghttp2` | sous WSL 2 |
| **grpcurl** | interopérabilité gRPC | binaire publié | `brew install grpcurl` | `winget install fullstorydev.grpcurl` |

`npm run test:all -- --infra` dit ce qui manque au poste **avant** de lancer quoi que ce soit, et
chaque suite qui saute faute d'un service le nomme en fin de passe.

### Cloner et construire

Pour travailler sur le framework, c'est ce dépôt qu'on clone :

```bash
git clone https://github.com/nodefony/nodefony-core.git
cd nodefony-core
npm install && npm run build
npm run dev
```

Une application peut alors suivre ce checkout plutôt que npm : `nodefony create app <nom> --link`
lie ses dépendances `nodefony`/`@nodefony/*` en `file:` — tu modifies le framework, tu le rebâtis,
l'application le voit.
<!-- @end -->

<!-- @if app -->
Si cette app a été générée avec `--link`, les dépendances `nodefony`/`@nodefony/*`
pointent en `file:` vers un checkout local de `nodefony-core` : tu modifies le
framework, tu rebuilds le checkout, ton app le voit. Ne publie pas ce
`package.json` tel quel — après la release npm, régénère sans `--link`
(versions `^<%= it.nodefonyVersion %>`).
<!-- @end -->
