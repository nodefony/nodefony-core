/**
 * #664 — chaque ligne ACCEPTÉE du journal est publiée sur le canal
 * `diagnostics_channel` `nodefony.syslog.log`, le message étant le `Pdu`.
 *
 * L'import passe par le barrel Node (`../index`) : c'est LUI qui branche le
 * canal (`setLogChannel`). Le débrancher fait tomber les cas « reçoit ».
 */
import { describe, it, expect, afterEach } from "vitest";
import diagnosticsChannel from "node:diagnostics_channel";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Syslog, Pdu, SYSLOG_LOG_CHANNEL } from "../index";

const received: Pdu[] = [];
const onMessage = (message: unknown): void => {
  if (message instanceof Pdu) received.push(message);
};

function listen(): void {
  diagnosticsChannel.subscribe(SYSLOG_LOG_CHANNEL, onMessage);
}

afterEach(() => {
  diagnosticsChannel.unsubscribe(SYSLOG_LOG_CHANNEL, onMessage);
  received.length = 0;
});

describe("Syslog → diagnostics_channel nodefony.syslog.log (#664)", () => {
  it("le nom suit la forme module.fonction de nodefony.http.request", () => {
    expect(SYSLOG_LOG_CHANNEL).toBe("nodefony.syslog.log");
  });

  it("un abonné reçoit le Pdu accepté, à l'identique", () => {
    listen();
    const syslog = new Syslog({ moduleName: "dc-test" });
    const pdu = syslog.log("ligne observée", "INFO", "DC");
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(pdu);
    expect(pdu.status).toBe("ACCEPTED");
    expect(pdu.msgid).toBe("DC");
  });

  it("une ligne sous le seuil n'est PAS publiée — ni le Pdu partagé du gate", () => {
    listen();
    const syslog = new Syslog({ moduleName: "dc-test" });
    syslog.setSeverityThreshold("INFO");
    const gated = syslog.log("trop bavard", "DEBUG");
    expect(gated.status).toBe("DROPPED");
    expect(received).toHaveLength(0);
    syslog.log("visible", "INFO");
    expect(received).toHaveLength(1);
    expect(received[0]).not.toBe(gated);
  });

  it("sous limite de débit : la rafale acceptée est publiée, la ligne perdue ne l'est pas", () => {
    listen();
    const syslog = new Syslog({
      moduleName: "dc-test",
      rateLimit: 60_000,
      burstLimit: 2,
    });
    const first = syslog.log("un", "INFO");
    const second = syslog.log("deux", "INFO");
    const dropped = syslog.log("trois", "INFO");
    expect(dropped.status).toBe("DROPPED");
    expect(received).toEqual([first, second]);
  });

  it("sans abonné, rien n'est publié et la ligne est acceptée", () => {
    const syslog = new Syslog({ moduleName: "dc-test" });
    expect(diagnosticsChannel.hasSubscribers(SYSLOG_LOG_CHANNEL)).toBe(false);
    expect(syslog.log("seul", "INFO").status).toBe("ACCEPTED");
    expect(received).toHaveLength(0);
  });

  it("le bundle navigateur n'importe pas node:diagnostics_channel", () => {
    const distClient = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "dist",
      "client",
    );
    expect(existsSync(distClient), "dist/client absent : lancer le build").toBe(
      true,
    );
    // L'IMPORT, pas la chaîne : la TSDoc du journal nomme le module.
    const nodeImport =
      /(?:from|import)\s*\(?\s*["'](?:node:)?diagnostics_channel["']/;
    const offenders = readdirSync(distClient, {
      recursive: true,
      encoding: "utf8",
    })
      .filter((file) => file.endsWith(".js"))
      .filter((file) =>
        nodeImport.test(readFileSync(path.join(distClient, file), "utf8")),
      );
    expect(offenders).toEqual([]);
  });
});
