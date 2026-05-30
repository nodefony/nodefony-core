# CLAUDE.md — Syslog / Pdu

> Sous-module `src/nodefony/src/syslog/` du workspace `@nodefony/core`.
> Pour audience IA en cours de session. Complète [`MEMORY.md`](./MEMORY.md) et [`README.md`](./README.md).

## Rôle

Système de logs structurés RFC 5424 de Nodefony. **Pdu** = 1 log (Process Data Unit). **Syslog** = hub central (ring buffer + filtrage + dispatch transports). Utilisé par TOUS les composants via `Service.log()`.

## Architecture du sous-module

```
src/nodefony/src/syslog/
├── Syslog.ts            ← hub central (buffer + filtres + dispatch)
├── Pdu.ts               ← classe d'entrée de log
├── CircularBuffer.ts    ← ring buffer O(1)
├── sinks/               ← drivers de sink (LB.W — où partent les lignes, write enfichable)
│   └── FileSink.ts      ← fd PAR worker (async|sync) ; goulet cluster = coalescence des writes, fd/worker = garde-fou (Node-only)
├── transports/          ← formatters + sinks
│   ├── console.ts
│   ├── file.ts
│   └── json.ts
├── MEMORY.md / README.md / CLAUDE.md
```

## Sévérités — `SysLogSeverity` (RFC 5424 + extension)

| #   | Nom                         | Usage                             |
| --- | --------------------------- | --------------------------------- |
| 0   | `EMERGENCY`                 | Système inutilisable              |
| 1   | `ALERT`                     | Action immédiate                  |
| 2   | **`CRITIC`** (PAS CRITICAL) | Conditions critiques              |
| 3   | `ERROR`                     | Erreurs logique                   |
| 4   | `WARNING`                   | Conditions d'alerte               |
| 5   | `NOTICE`                    | Normal mais important             |
| 6   | `INFO`                      | Informationnel                    |
| 7   | `DEBUG`                     | Debug                             |
| -1  | `SPINNER`                   | Animation CLI (extension non-RFC) |

⚠️ Le nom dans l'enum est `"CRITIC"`, jamais `"CRITICAL"`.

## Pdu — anatomie

```typescript
class Pdu {
  payload: unknown; // contenu (string, Error, objet)
  uid: number; // id incrémental du log
  severity: number; // 6 (numérique pour comparaisons rapides)
  severityName: string; // "INFO" (string pour affichage)
  typePayload: string | null; // typeof rapide du payload
  moduleName: string; // nom du syslog parent ou du service
  msgid: string; // catégorie ("AUTH", "ROUTER", "HTTP-KERNEL"...)
  msg: string; // détail libre optionnel
  timeStamp: number; // Date.now() (pas d'objet Date stocké — getDate() le dérive)
  status: Status; // "NOTDEFINED" | "INVALID" | "ACCEPTED" | "DROPPED"
  pid: number; // = procid RFC 5424. const PID module-level (process.pid,
  //   capturé 1× → 0 appel système/log). Browser → 0.
  //   Voyage dans ring buffer / syslog:stream / JSON → groupe par worker.
  requestId?: string; // corrélation log↔requête via ALS (P1.4). Présent si le
  //   Pdu est créé dans une bulle `RequestContext.run(...)` ;
  //   capturé via `Pdu.requestIdProvider` (provider injectable,
  //   branché par `src/index.ts` côté Node UNIQUEMENT).
  //   Browser/debugbar : provider reste `null` → 0 lecture, 0 alloc.
  //   Slot toujours créé (`= undefined` hors bulle) pour que
  //   `parseJson` réhydrate correctement (`"requestId" in this`).
  //   JSON.stringify ignore `undefined` → 0 verbosité côté wire.
}

// Provider injectable (corrélation log↔requête) :
Pdu.requestIdProvider; // (() => string | undefined) | null
//   - Node (barrel `src/index.ts`) : branché sur `RequestContext.getRequestId`.
//   - Browser (bundle client `src/client/index.ts`) : non branché, reste `null`.
//   - Coût : 1 test de référence ~5 ns + (si branché) ~50-100 ns par Pdu.
```

> ⚠️ Il n'y a **PAS** de champ `date: Date` (en stocker un = 1 allocation Date PAR log =
> violation hot path). Le timestamp vit dans `timeStamp: number` ; `getDate()` le formate à la demande.
>
> **Champs historiques** :
>
> - `pid` ajouté **2026-05-24** (auparavant pid n'existait qu'à l'affichage console, ne voyageait pas dans le pipeline structuré).
> - `requestId` ajouté **2026-05-27** (action E du tableau « trucs en suspend » — corrélation log↔requête comblée). Provider injectable pour préserver l'isomorphisme (Pdu reste utilisable côté browser/debugbar — cf `src/client/debugbar/model.ts`).

## Flux d'un log

```
Service.log("msg", "INFO")
   │
   ▼
new Pdu(...)
   │
   ▼
Syslog.log(pdu)
   ├── CircularBuffer.push(pdu)    ← O(1), taille fixe (défaut ~1000)
   ├── matchConditions(pdu)         ← filtrage par severity/msgid/module
   └── fire("onLog", pdu)           ← chaque transport branché
       │
       ├─→ Console transport       (stdout coloré)
       ├─→ File transport           (logs/*.log)
       ├─→ JSON transport           (pipeline ELK/Loki)
       └─→ SSE transport            (Studio /nodefony/api/logs/stream)
```

## Pattern d'usage typique

```typescript
class MyService extends Service {
  doSomething(): void {
    this.log("simple", "INFO");
    this.log(error, "ERROR", "AUTH", "user login failed");
    this.spinlog("Chargement..."); // SPINNER

    const pdu = this.log("returned", "WARNING");
    pdu.severityName; // "WARNING"
    pdu.severity; // 4
  }
}
```

Toutes les variantes de `log()` retournent un `Pdu` (utile pour audit signed ou test).

## Conditions — filtrage avant fire

```typescript
syslog.setConditions({
  console: {
    severity: ["ERROR", "CRITIC", "ALERT", "EMERGENCY"],
    exclude: { moduleName: ["NOISY_MODULE"] },
  },
});
```

Économie : les conditions sont matchées AVANT `fire("onLog")`. Moins de CPU + moins de bruit log si filtrage strict.

## CircularBuffer — ring buffer O(1)

Stocke les N derniers logs en mémoire (configurable, défaut ~1000).

**Usages** :

- Studio (Phase 10) — `kernel.syslog.buffer.toArray()` → snapshot rapide
- SSE Logs panel — stream live (cf `@nodefony/studio/frontend/src/pages/Logs.tsx`)
- Debug en cours d'exécution

**Implémentation** : tableau de taille fixe + head/tail pointers. `push()` = O(1), pas de `shift()` O(N) qui re-décale.

## Initialisation par environnement

```typescript
svc.initSyslog("development", true); // verbose, DEBUG OK
svc.initSyslog("production", false); // INFO+ seulement
svc.initSyslog("test", false); // silencieux ou WARN+
```

Applique les **conditions par défaut** selon environnement.

## Pattern SSE Studio (Phase 10)

```typescript
// @nodefony/studio (futur P10)
@Controller("/nodefony/api/logs")
class LogsController {
  @Get("/stream")
  async stream(ctx: HttpContext) {
    ctx.response.setHeader("Content-Type", "text/event-stream");

    const handler = (pdu: Pdu) => {
      ctx.response.write(`data: ${JSON.stringify(pdu)}\n\n`);
    };

    this.kernel.syslog.on("onLog", handler);

    // ⚠️ Cleanup : listener sur RESPONSE (rawRes), pas REQUEST en HTTP/2
    // cf mémoire feedback_sse_http2_request_close
    ctx.rawRes.on("close", () => {
      this.kernel.syslog.off("onLog", handler);
    });
  }
}
```

## Format texte (depuis 2026-05-17)

`HH:MM:SS.mmm SEVERITY MSGID : payload`

```
14:32:01.247 INFO  HTTP-KERNEL : Server Listen on http://127.0.0.1:5151
14:32:01.248 INFO  ROUTER       : route + [GET] /nodefony/test → @test/DefaultController.index
14:32:01.350 ERROR FIREWALL     : Auth failed for user@example.com
```

Le skill `start-nodefony-server` parse ce format.

## Tests de regression

```bash
cd src/nodefony && npm run test 2>&1 | grep -A 3 "Syslog\|Pdu"
```

## ⚠️ Gotchas

| Symptôme                            | Cause                                     | Fix                                                                   |
| ----------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `Cannot find "CRITICAL"`            | Le nom est `"CRITIC"`                     | Utiliser `"CRITIC"` ou `SysLogSeverity.CRITIC`                        |
| Log perdu après `clean()`           | `syslog=null` après clean                 | Pdu standalone fallback créé (mais perdu) — ne pas logger après clean |
| `pdu.severity === "INFO"` false     | severity = numérique                      | Comparer `pdu.severityName === "INFO"`                                |
| Logs trop verbeux en prod           | `initSyslog("development", true)` au boot | Passer bon env (`"production"`)                                       |
| ANSI codes pollueent les greps      | Console transport ajoute couleurs         | `sed 's/\x1b\[[0-9;]*m//g'` sur le tail                               |
| Tous les sévérités du même listener | Conditions non setées                     | Appeler `setConditions()` au boot                                     |

## Cycle de vie

```typescript
syslog.reset(); // vide ring buffer + reset compteurs
syslog.clean(); // libère transports + reset
```

À `Service.clean(true)` → appelle `syslog.reset()`. À `clean()` simple → conservé. À `clean(false)` → conservé sans reset.

## Liens

- [`MEMORY.md`](./MEMORY.md) — internals IA détaillés
- [`README.md`](./README.md) — doc humaine
- [`../../CLAUDE.md`](../../CLAUDE.md) — workspace core
- [`../../docs/syslog.md`](../../docs/syslog.md) — vision architecturale (relocalisé `src/nodefony/docs/`, ADR-0001)
- `feedback_sse_http2_request_close` (mémoire IA) — piège HTTP/2 cleanup SSE
- Studio Logs panel (futur P10) — `@nodefony/studio/frontend/src/pages/Logs.tsx`
