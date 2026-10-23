import Syslog from "../syslog/Syslog";
import type { ILogSink } from "../syslog/Syslog";
import type Pdu from "../syslog/Pdu";

/**
 * Écrit des Pdu par la sortie d'écran en `log.format: "json"` et rend les lignes
 * EXACTES émises — ce qu'un collecteur lirait sur stdout/stderr. Restaure le
 * format, le tampon et le sink process-globaux, même sur exception.
 */
export function captureJsonLines(pdus: Pdu[]): string[] {
  const out: string[] = [];
  const sink: ILogSink = {
    name: "capture",
    writeOut: (s) => void out.push(s),
    writeErr: (s) => void out.push(s),
    flushSync: () => {},
    close: () => {},
  };
  Syslog.setLogSink(sink);
  Syslog.setOutputBuffering(false);
  Syslog.setLineFormat("json");
  try {
    for (const p of pdus) Syslog.rawLog(p, "1234");
  } finally {
    Syslog.setLineFormat("text");
    Syslog.setOutputBuffering("auto");
    Syslog.setLogSink(null);
  }
  return out;
}
