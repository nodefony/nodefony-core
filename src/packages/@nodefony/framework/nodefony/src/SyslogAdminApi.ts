import type {
  ISyslog,
  IAdminApi,
  IAdminEndpoint,
  IAdminDescriptor,
  IAdminRequest,
} from "nodefony";

/** Élément du ring buffer Syslog (Pdu), sans importer la classe concrète. */
type PduLike = ISyslog["ringStack"][number];

/**
 * Producteur `IAdminApi` du **syslog** (core) — exposé sous
 * `/nodefony/syslog/api/*`. 4ᵉ et dernier producteur de P10.3.
 *
 * Le syslog vit dans `@nodefony/core` et ne peut pas importer framework →
 * framework le wrappe (comme le kernel) via `createSyslogAdminApi(syslog)`.
 * Lecture seule du ring buffer (`ISyslog.ringStack`, FIFO O(1)).
 *
 * Endpoints :
 *  - `GET /nodefony/syslog/api/logs` → Pdu récents (`?severity=ERROR&limit=N`)
 *  - `GET /nodefony/syslog/api/info` → compteurs (valid/invalid/missed/buffer)
 *
 * @param syslog - instance Syslog du kernel (`kernel.syslog`).
 */
export function createSyslogAdminApi(syslog: ISyslog): IAdminApi {
  const serialize = (pdu: PduLike) => ({
    uid: pdu.uid,
    severity: pdu.severity,
    severityName: pdu.severityName,
    module: pdu.moduleName,
    msgid: pdu.msgid,
    msg: pdu.msg,
    timeStamp: pdu.timeStamp,
    payload: pdu.payload,
  });

  /** Lit un entier de query (`?limit=50`), borné, avec défaut. */
  const intParam = (
    req: IAdminRequest,
    key: string,
    def: number,
    max: number,
  ): number => {
    const raw = req.query[key];
    const v = Array.isArray(raw) ? raw[0] : raw;
    const n = v !== undefined ? Number.parseInt(v, 10) : NaN;
    if (Number.isNaN(n) || n <= 0) return def;
    return Math.min(n, max);
  };

  const descriptor: IAdminDescriptor = {
    label: "Logs",
    icon: "file-text",
    order: 3,
  };

  const endpoints: IAdminEndpoint[] = [
    {
      path: "logs",
      summary: "Recent log entries (Pdu ring buffer) — ?severity=ERROR&limit=N",
      handler: (request) => {
        // ringStack = FIFO (ancien→récent). On filtre éventuellement par
        // sévérité, puis on garde les N plus récents (fin du tableau).
        let entries = syslog.ringStack;
        const sev = request.query.severity;
        const sevName = Array.isArray(sev) ? sev[0] : sev;
        if (sevName) {
          const up = sevName.toUpperCase();
          entries = entries.filter((p) => p.severityName === up);
        }
        const limit = intParam(request, "limit", 200, 1000);
        return entries.slice(-limit).map(serialize);
      },
    },
    {
      path: "info",
      summary: "Syslog counters — valid, invalid, missed, buffered",
      handler: () => ({
        valid: syslog.valid,
        invalid: syslog.invalid,
        missed: syslog.missed,
        buffered: syslog.ringStack.length,
      }),
    },
  ];

  return {
    adminNamespace: "syslog",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}
