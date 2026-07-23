# HTML ou Markdown ? Ce que dit le terrain

> Veille 2026. La question n'est pas esthétique : elle décide de **qui va lire le livrable** — un
> humain qui doit trancher, ou une machine qui va le réingérer.

## La formule qui résume tout

> **« HTML wins the session. Markdown wins the archive. »**

Le HTML gagne quand un **humain** doit décider _maintenant_, en regardant. Le Markdown gagne dès que
le contenu sera **relu par un outil** : contexte réinjecté dans un LLM, RAG, `git diff`, README cité
six mois plus tard.

## Pourquoi le basculement a eu lieu

Le problème de 2026 n'est plus la génération, c'est que **l'agent produit plus que l'humain ne lit**.
Un rapport de 200 lignes en Markdown se fait _approuver sans lecture_. Thariq Shihipar (Anthropic) :

> _« I tend to not actually read more than a 100-line markdown file. »_

Le HTML n'est donc pas une coquetterie de mise en page : c'est un outil **anti-décrochage**. Un diff
annoté en couleur, six variantes côte à côte, un curseur qui explore un espace de paramètres —
l'humain reste dans la boucle parce qu'il peut _voir_ et _manipuler_, au lieu de scanner du texte.

Simon Willison, qui défendait le Markdown à l'époque des contextes de 8 000 tokens, a changé d'avis
publiquement : l'arbitrage a changé avec les contextes longs et les modèles bon marché.

## Le tableau de décision

| Le livrable…                                                      | Format   |
| ----------------------------------------------------------------- | -------- |
| aide à **décider** (audit, banc, revue, comparaison de variantes) | **HTML** |
| doit être **manipulé** (trier, filtrer, simuler des hypothèses)   | **HTML** |
| doit être **imprimé** ou **présenté**                             | **HTML** |
| est **versionné** et relu en diff                                 | Markdown |
| est **réinjecté dans un LLM** (mémoire, contexte, RAG)            | Markdown |
| documente le code pour la suite                                   | Markdown |

**Conséquence pour ce repo** : `CLAUDE.md`, `MEMORY.md`, `MIGRATION_STATUS.md` **restent en Markdown**.
Ils sont ré-ingérés par un modèle à chaque session — c'est précisément le cas où le Markdown est
objectivement supérieur, pas une question de goût.

## Les trois faits qui doivent guider l'implémentation

### 1. Le HTML coûte cher — et se relit mal par une machine

- Un rapport HTML avec CSS et JS inline coûte **environ un ordre de grandeur** de tokens de plus qu'un
  Markdown équivalent (les ratios ×8–10 qui circulent n'ont pas de source primaire sérieuse ; l'ordre
  de grandeur, lui, se vérifie en dix minutes sur un tokenizer).
- Sur l'**extraction de tableaux**, les modèles sont _plus précis_ en Markdown (≈61 %) qu'en HTML
  (≈54 %). En RAG, ingérer du Markdown plutôt que du HTML brut améliore nettement la précision.
- Les agents éditent par **diff/patch**, et les diffs HTML sont bruités.

→ **Un rapport HTML est un cul-de-sac : on le régénère, on ne le ré-édite jamais.**

### 2. Le HTML se **génère depuis des données**, il ne s'écrit pas à la main

C'est le modèle **Lighthouse** : un objet JSON (les données) → un _renderer_ déterministe → un HTML
autonome **avec le JSON embarqué dedans**. La vue est jetable, les données sont la vérité.

Ce que ça donne ici : `lib/report.mjs` **est** le renderer, et `doc({ data })` embarque les données
sources dans la page. Le rapport devient alors :

- **rejouable** — on régénère la page à partir du JSON ;
- **comparable** — on diff deux runs sur le JSON, pas sur les balises ;
- **ré-ingérable par un LLM** — on lui donne les données, pas le HTML.

C'est ce qui **annule le seul défaut irrécupérable** du HTML face au Markdown.

> ⚠️ Piège documenté par ceux qui s'y sont cassé les dents : **ne fabriquez pas une grammaire de
> gabarits** (« slots » JSON à remplir). Résultat obtenu par d'autres : _« worse Jinja »_ — le modèle
> doit alors connaître le HTML **et** votre grammaire, et se bat contre le carcan. Fournissez le
> **chrome** (design, composants, impression, échappement) et laissez le corps libre.

### 3. La sortie d'un LLM est une **entrée non fiable** (OWASP LLM05)

Le vecteur réel n'est même pas l'injection de prompt : c'est que **votre rapport affiche des données
du système** — logs, noms de routes, messages d'erreur, User-Agent. Un log qui contient `<script>`
devient une XSS ; un JSON qui contient `</script>` **ferme le bloc** et injecte du HTML.

Règles appliquées par `report.mjs` :

- `esc()` sur **toute** donnée ; jamais de concaténation brute.
- `embedData()` échappe `</script` et `<!--` avant d'injecter le JSON.
- **Zéro requête réseau** : un rapport est _« a capture of work, not an application »_ (le modèle des
  artifacts d'Anthropic, isolés dans une iframe sans réseau). Ça règle d'un coup l'exfiltration, la
  CSP, le hors-ligne et l'archivage.

## L'accessibilité n'est pas négociable — et elle appartient au moteur

Les benchmarks académiques montrent que le HTML généré par LLM **échoue régulièrement** WCAG. Sur le
web réel, 95,9 % des pages d'accueil échouent, dont 83,9 % pour un simple défaut de contraste.

→ L'a11y doit vivre dans le **chrome**, jamais dans le contenu improvisé : contrastes validés dans le
CSS de la bibliothèque, `role="img"` + `aria-label` sur les SVG, `aria-sort` sur les colonnes triées,
focus visible, `prefers-reduced-motion`, équivalent clavier pour le glisser-déposer. Si vous laissez
le modèle choisir ses couleurs au cas par cas, vous produisez du non-conforme.

## Ce qu'on a volé aux autres

| Outil               | L'idée reprise                                                         |
| ------------------- | ---------------------------------------------------------------------- |
| **Lighthouse**      | Données JSON embarquées + renderer pur ; la vue est jetable            |
| **pandoc / Quarto** | `--standalone --embed-resources` : un seul fichier, tout inline        |
| **Observable**      | Les données sont pré-calculées au build ; le client ne fait que rendre |
| **Allure**          | Statut agrégé en tête, détail en dessous (pyramide inversée)           |
| **pytest-html**     | Le minimum viable : un flag, un fichier, zéro cérémonie                |

## Anti-slop

Bannir l'esthétique « IA par défaut » : dégradés, emoji dans les titres, glassmorphism, ombres
partout. Un rapport crédible a l'air **sobre** — le design se dérive du système existant (ici : la
palette de la debug bar et de Studio), pas d'un moodboard.

## Sources

- Thariq Shihipar (Anthropic) — _The Unreasonable Effectiveness of HTML_ ; relais de Simon Willison
  (mai 2026) et InfoQ (juin 2026)
- AgentMail — _HTML vs Markdown for AI agents_ (« HTML wins the session, Markdown wins the archive »)
- OWASP GenAI — **LLM05:2025 Improper Output Handling**
- Anthropic Engineering — _How we contain Claude_ (artifacts : iframe sandbox, aucun réseau sortant)
- Google Lighthouse — architecture du report renderer (LHR JSON → HTML autonome)
- Springer, _Universal Access in the Information Society_ — accessibilité du HTML généré par IA
- WebAIM Million 2026 — 95,9 % des pages d'accueil échouent WCAG
