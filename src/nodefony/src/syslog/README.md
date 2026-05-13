# Nodefony Syslog

Système de logging structuré pour Nodefony. Buffer circulaire FIFO, filtrage conditionnel par événement, rate limiting, surcharge `console`.

---

## Niveaux de sévérité

| Nom | Valeur | Console | Usage |
|-----|--------|---------|-------|
| `EMERGENCY` | 0 | `stderr` | Système inutilisable |
| `ALERT` | 1 | `stderr` | Action immédiate requise |
| `CRITIC` | 2 | `stderr` | Condition critique |
| `ERROR` | 3 | `stderr` | Erreur |
| `WARNING` | 4 | `stderr` | Avertissement |
| `NOTICE` | 5 | `stdout` | Normal mais significatif |
| `INFO` | 6 | `stdout` | Information |
| `DEBUG` | 7 | `stdout` | Débogage |
| `SPINNER` | -1 | `stdout` | Animation CLI (pas bufferisé) |

> **Attention** : `CRITIC` (pas `CRITICAL`).

---

## Installation

```typescript
import Syslog from "@nodefony/core/syslog/Syslog";
import Pdu from "@nodefony/core/syslog/Pdu";
```

---

## Usage de base

```typescript
const syslog = new Syslog({ moduleName: "MyService" });

// Appel principal
syslog.log("connexion établie", "INFO");
syslog.log(new Error("échec DB"), "ERROR", "DATABASE");

// Raccourcis
syslog.info("serveur démarré sur le port 5151");
syslog.warn("certificat expire dans 7 jours");
syslog.error(new Error("timeout"));
syslog.debug({ query: "SELECT *", duration: 42 });

// Multi-arguments (comme console.log)
syslog.print("User:", user, "→ Status:", 200);         // 1 Pdu, payload = [...]
syslog.logMultiple("ERROR", "Payload:", body, err);    // sévérité explicite
```

---

## Configuration

```typescript
const syslog = new Syslog({
  moduleName: "MyModule",     // préfixe de chaque log (défaut : "SYSLOG")
  defaultSeverity: "INFO",   // sévérité si non précisée (défaut : "DEBUG")
  maxStack: 200,             // taille du buffer circulaire (défaut : 100)
  rateLimit: 1000,           // fenêtre en ms — false = désactivé (défaut : false)
  burstLimit: 5,             // max logs par fenêtre (défaut : 3)
  checkConditions: "&&",     // opérateur logique des filtres (défaut : "&&")
  overrideConsole: true,     // redirige console.* vers syslog (défaut : false)
  async: false,              // mode asynchrone (défaut : false)
});
```

---

## Initialisation (output console)

```typescript
// Active l'affichage coloré dans la console selon l'environnement
syslog.init("development");          // severity <= INFO (6)
syslog.init("development", true);    // severity <= DEBUG (7)
syslog.init("development", "*");     // idem
syslog.init("production");           // severity <= INFO (6)
syslog.init("production", true);     // severity <= DEBUG (7)

// Conditions personnalisées
syslog.init("production", false, {
  severity: { operator: "<=", data: "WARNING" },
});
```

---

## Filtrage conditionnel

Filtre les logs **en temps réel** via des listeners `onLog`.

```typescript
// Écouter uniquement les ERROR et pires
syslog.listenWithConditions(
  { severity: { operator: "<=", data: "ERROR" } },
  (pdu) => sendAlert(pdu)
);

// Plusieurs sévérités explicites
syslog.listenWithConditions(
  { severity: { data: ["ERROR", "WARNING", "INFO"] } },
  (pdu) => console.log(pdu.payload)
);

// Par module (msgid)
syslog.listenWithConditions(
  { msgid: { data: "DATABASE" } },
  (pdu) => metrics.record(pdu)
);

// RegExp sur le msgid
syslog.listenWithConditions(
  { msgid: { data: /^NODEFONY/ } },
  (pdu) => pdu
);

// Combinaison (&&)
syslog.listenWithConditions(
  {
    severity: { operator: "<=", data: "ERROR" },
    msgid: { data: "AUTH" },
    checkConditions: "&&",
  },
  (pdu) => alertSecurityTeam(pdu)
);
```

### Opérateurs disponibles

| Opérateur | Description |
|-----------|-------------|
| `<` `>` `<=` `>=` | Comparaison numérique |
| `==` `===` `!=` | Égalité |
| `RegExp` | Test regex (sur `msgid`) |

---

## Rate limiting

```typescript
const syslog = new Syslog({
  rateLimit: 1000,  // fenêtre de 1 seconde
  burstLimit: 3,    // max 3 logs par seconde
});

syslog.info("log 1");  // ACCEPTED
syslog.info("log 2");  // ACCEPTED
syslog.info("log 3");  // ACCEPTED
syslog.info("log 4");  // DROPPED — pdu.status = "DROPPED", syslog.missed++
```

---

## Buffer et consultation

```typescript
// Dernier log
const last = syslog.getLogStack() as Pdu;

// Tranche [0..9] (FIFO — le plus ancien en premier)
const first10 = syslog.getLogStack(0, 10) as Pdu[];

// Depuis l'index 50
const tail = syslog.getLogStack(50) as Pdu[];

// Avec filtre
const errors = syslog.getLogs({ severity: { data: "ERROR" } });

// Sérialisation JSON
const json = syslog.logToJson({ severity: { operator: "<=", data: "WARNING" } });
```

---

## Charger un stack existant

```typescript
// Depuis un tableau de Pdu
syslog.loadStack(existingPdus);

// Avec déclenchement des événements
syslog.loadStack(existingPdus, true);

// Avec callback avant chaque événement
syslog.loadStack(existingPdus, true, (pdu, raw) => {
  pdu.msgid = raw.msgid || "IMPORTED";
});

// Depuis du JSON
syslog.loadStack(jsonString, true);
```

---

## Output haute performance — `rawLog`

Écrit directement dans `process.stdout` / `process.stderr` via un seul `stream.write()`. Évite l'overhead de `console.*` (formatage interne, buffering TTY). Utile en production haute fréquence ou comme fondation pour un transport fichier/HTTP.

```typescript
// Remplacer normalizeLog par rawLog dans l'init
syslog.listenWithConditions(
  { severity: { operator: "<=", data: "DEBUG" } },
  (pdu) => Syslog.rawLog(pdu)
);

// Ou directement sur un Pdu
const pdu = syslog.log("user connected", "INFO", "HTTP");
Syslog.rawLog(pdu);
Syslog.rawLog(pdu, "[PID 1234]");  // préfixe optionnel
```

| Payload | Sortie |
|---------|--------|
| `string` / `number` | `String(payload)` |
| `object` / `Error` / `array` | `util.inspect(payload, depth:3, colors:true)` |
| severity ≤ 3 (ERROR+) | `process.stderr` |
| severity > 3 | `process.stdout` |
| SPINNER (-1) | `process.stdout.write("\r...")` |

> `rawLog` est la base du futur **Transport Layer** (session planifiée — voir `MIGRATION_STATUS.md`).

---

## Transport Layer

Envoie chaque `Pdu` vers des destinations externes (fichier, HTTP, console) de façon **asynchrone et fire-and-forget**. `log()` reste synchrone.

### Interface

```typescript
interface ITransport {
  readonly name: string;
  send(pdu: Pdu): Promise<void>;
}
```

### Ajouter / retirer un transport

```typescript
import { ConsoleTransport, FileTransport, HttpTransport } from "@nodefony/core";

const syslog = new Syslog({ moduleName: "APP" });

// Console (avec préfixe PID optionnel)
syslog.addTransport(new ConsoleTransport("[APP]"));

// Fichier JSON
syslog.addTransport(new FileTransport({ path: "./app.log" }));

// Fichier texte lisible
syslog.addTransport(new FileTransport({ path: "./app.log", format: "text" }));

// HTTP POST JSON
syslog.addTransport(new HttpTransport({ url: "http://logs.example.com/ingest" }));

// Agrégation parent/enfant — tous les logs du child remontent vers parent
const parent = new Syslog({ moduleName: "KERNEL" });
const child = new Syslog({ moduleName: "HTTP" });
child.addTransport(new SyslogTransport(parent));

// Retrait
const file = new FileTransport({ path: "./app.log" });
syslog.addTransport(file);
// ...
syslog.removeTransport(file);
```

### Transport personnalisé

```typescript
import type { ITransport } from "@nodefony/core";
import type Pdu from "@nodefony/core";

class MyTransport implements ITransport {
  readonly name = "my-transport";
  async send(pdu: Pdu): Promise<void> {
    await myExternalSystem.push({ level: pdu.severityName, msg: pdu.payload });
  }
}

syslog.addTransport(new MyTransport());
```

### Erreurs de transport

```typescript
syslog.on("onTransportError", (err: Error, pdu: Pdu) => {
  console.error("Transport failed:", err.message);
});
```

### Règles de comportement

| Règle | Détail |
|-------|--------|
| `log()` reste synchrone | Les transports sont fire-and-forget |
| DROPPED → non envoyé | Seuls les PDU `ACCEPTED` passent aux transports |
| Même instance ajoutée 2× | Dédupliquée — `send()` appelé une seule fois |
| Erreur transport | `onTransportError(err, pdu)` — pas de crash |

---

## Surcharge de `console`

Redirige `console.log/info/warn/error/debug/table/dir` vers l'instance Syslog. Les logs restent affichés via les méthodes console natives originales (capturées au démarrage du module — pas de récursion infinie).

```typescript
// Option 1 : via settings
const syslog = new Syslog({ overrideConsole: true });

// Option 2 : statique
Syslog.overrideConsole(syslog);

// Utilisation normale de console
console.log("user connected", user);   // → syslog.print(...)           → 1 Pdu, payload=[...]
console.error("DB failed", err);       // → syslog.logMultiple("ERROR") → 1 Pdu
console.warn("slow query", 3200);      // → syslog.logMultiple("WARNING")
console.table([{ id: 1, name: "A" }]); // → syslog.logMultiple("INFO")  → payload = tableau brut
console.dir({ config: true });         // → syslog.logMultiple("DEBUG") → payload = objet brut

// Restaurer le console original
Syslog.restoreConsole();
```

> Un double appel à `overrideConsole` ajoute un Pdu `WARNING` dans le buffer sans crasher.

---

## Cycle de vie

```typescript
syslog.clearLogStack();  // vide uniquement le buffer
syslog.reset();          // vide buffer + retire tous les listeners
syslog.clean();          // alias de reset()
```

---

## API — `Pdu`

```typescript
const pdu = syslog.log("message", "INFO", "MODULE", "msgid optionnel");

pdu.payload       // unknown — le message brut
pdu.typePayload   // "string" | "number" | "array" | "Error" | "object" | ...
pdu.severity      // number (0-7, -1)
pdu.severityName  // "INFO" | "ERROR" | ...
pdu.moduleName    // string
pdu.msgid         // string
pdu.timeStamp     // number (ms epoch)
pdu.status        // "ACCEPTED" | "DROPPED" | "INVALID" | "NOTDEFINED"
pdu.uid           // number — auto-incrémenté global
```

---

## Intégration dans un Service Nodefony

Les services Nodefony accèdent au syslog via `this.log()` (hérité de `Service`). `Syslog` est automatiquement initialisé par le kernel.

```typescript
import { Service, Module } from "nodefony";

class MyService extends Service {
  constructor(module: Module) {
    super("myService", module);
  }

  start() {
    this.log("service démarré", "INFO");               // utilise this.syslog
    this.log(new Error("connexion refusée"), "ERROR"); // idem
  }
}
```

---

## Troubleshooting

| Problème | Cause | Solution |
|----------|-------|----------|
| Logs `DROPPED` | `burstLimit` atteint | Augmenter `burstLimit` ou `rateLimit` |
| Logs `INVALID` | Exception dans `log()` | Vérifier le type de `payload` |
| Pas d'affichage console | `init()` non appelé | Appeler `syslog.init(env, debug)` |
| `CRITIC` inconnu | Faute de frappe | C'est `"CRITIC"`, pas `"CRITICAL"` |
| `translateSeverity` throw | Sévérité numérique invalide | Utiliser 0–7 ou -1 (SPINNER) |
| Récursion avec `overrideConsole` | console.* dans les listeners | Utiliser `Syslog._nativeConsole` — déjà géré en interne |
