# Auditer la page comme un moteur de recherche et un agent la voient — `audit.mjs`

> Détail chargé à la demande depuis le `SKILL.md` (§ « Auditer la page »). Vérité courante — éditer en place, historique = `git log`.

Lighthouse complet, y compris **derrière une authentification** — ce que l'extension du navigateur
ne sait pas faire sur une application protégée.

```bash
npx nodefony see /tableau-de-bord --audit             # audite
npx nodefony see /tableau-de-bord --audit --install   # pose `lighthouse` (une vingtaine de
                                                      # mégaoctets, payés seulement si tu audites)
```

Hors d'une application générée, ou pour passer des identifiants :

```bash
npm i -D lighthouse
NF_BROWSER_LOGIN=/login NF_BROWSER_USER=admin NF_BROWSER_PASSWORD=nodefony-dev-42 node .../scripts/audit.mjs /tableau-de-bord
```

Il rend les scores des cinq catégories — dont **`agentic-browsing`**, qui note ce qu'un agent
d'intelligence artificielle trouve en arrivant sur ta page : arbre d'accessibilité bien formé,
stabilité visuelle, annotations **WebMCP** de tes formulaires, outils déclarés, et présence d'un
`llms.txt`. Puis les audits ratés, **classés par poids** — ce qui coûte le plus à ta note, en
premier.

```json
{
  "verdict": "ALERTE",
  "decor": { "appareil": "desktop", "bridage": "simulate" },
  "scores": {
    "performance": 30,
    "accessibility": 93,
    "best-practices": 100,
    "seo": 91,
    "agentic-browsing": 96
  },
  "failedAudits": { "total": 22, "examples": [] },
  "fullReport": "tmp/browser/lighthouse-….json"
}
```

Le rapport COMPLET est déposé à côté : le résumé sert à décider, l'original à vérifier et à
comparer dans le temps. Tu peux l'ouvrir tel quel dans une visionneuse Lighthouse.

**Trois choses à savoir, sans quoi les chiffres trompent :**

- **Le `decor` fait partie de la mesure.** Un score de performance sans son appareil ne veut rien
  dire. Le défaut est `desktop` ; `NF_BROWSER_FORMFACTOR=mobile` simule un téléphone bridé, et les
  chiffres n'ont alors plus rien à voir.
- **Ne juge pas la performance d'un serveur de DÉVELOPPEMENT.** Modules servis un par un, sources
  non minifiées, rechargement à chaud : la note s'effondre pour des raisons qui n'existent pas en
  production. Cette catégorie ne se mesure que sur une version bâtie.
- **Un audit sans score n'a pas échoué** — il ne s'applique pas. Les audits WebMCP et `llms.txt`
  sortent ainsi tant que tu ne les as pas mis en place ; c'est une indication, pas un reproche.

> **Comment l'authentification survit** alors que Lighthouse ouvre son propre onglet : le navigateur
> est lancé avec un profil PERSISTANT et un port de débogage ; on s'y connecte, puis Lighthouse s'y
> branche et hérite du profil. Et `disableStorageReset` est posé — sans lui, Lighthouse **vide le
> stockage** avant de mesurer, donc les témoins de session, et audite l'écran de connexion sans le
> dire.
