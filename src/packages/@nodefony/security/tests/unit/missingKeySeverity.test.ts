import assert from "node:assert/strict";
import { Container, CONSOLE_RUN_PROFILE } from "nodefony";
import type { IKernel, IRunProfile, Module, Pdu } from "nodefony";

import { missingKeySeverity } from "../../nodefony/src/crypto/secretCipher";
import { WebhookService } from "../../nodefony/service/webhooks";

/**
 * L'alerte « clé de chiffrement au repos absente » ne crie que pour un run qui
 * SERT (#786).
 *
 * `security:secrets --env` démarre l'application pour FABRIQUER ces clés : les
 * services `totp` et `webhooks` y constataient leur absence et criaient
 * `CRITIC` — la première chose que voyait un nouveau venu sur la page Docker
 * Hub. Ce banc verrouille les deux côtés : un serveur de production sans clé
 * crie toujours, une commande console ne crie plus, et la clé rendue ne change
 * pas.
 */

const SERVING: IRunProfile = { ...CONSOLE_RUN_PROFILE, servers: true };

describe("missingKeySeverity — la règle", () => {
  it("run qui sert (profil serveur) → la sévérité due", () => {
    assert.equal(
      missingKeySeverity({ runProfile: SERVING, command: null }, "CRITIC"),
      "CRITIC",
    );
    assert.equal(
      missingKeySeverity({ runProfile: SERVING, command: null }, "WARNING"),
      "WARNING",
    );
  });

  it("commande de lancement dont le profil n'est pas encore posé → la sévérité due", () => {
    // `production`, `cluster`, `development` ne posent leur profil serveur
    // qu'à `onKernelStart` : c'est leur INTENTION déclarée qui fait foi.
    const command = { servesTraffic: true } as IKernel["command"];
    assert.equal(
      missingKeySeverity(
        { runProfile: CONSOLE_RUN_PROFILE, command },
        "CRITIC",
      ),
      "CRITIC",
    );
  });

  it("démon console (longrunning, sans HTTP) → la sévérité due", () => {
    // Un consommateur de file qui envoie des webhooks ne sert aucun trafic
    // HTTP, mais il EMPLOIE la clé : en production sans elle, la brique est
    // coupée, et ce silence-là doit rester un CRITIC.
    const daemon = { lifetime: "longrunning" } as IKernel["command"];
    assert.equal(
      missingKeySeverity(
        { runProfile: CONSOLE_RUN_PROFILE, command: daemon },
        "CRITIC",
      ),
      "CRITIC",
    );
    assert.equal(
      missingKeySeverity(
        {
          runProfile: { ...CONSOLE_RUN_PROFILE, lifetime: "longrunning" },
          command: null,
        },
        "CRITIC",
      ),
      "CRITIC",
    );
  });

  it("commande console (security:secrets…) → DEBUG", () => {
    assert.equal(
      missingKeySeverity(
        { runProfile: CONSOLE_RUN_PROFILE, command: null },
        "CRITIC",
      ),
      "DEBUG",
    );
    assert.equal(missingKeySeverity(null, "WARNING"), "DEBUG");
  });
});

/** Monte un WebhookService SANS clé, et relève ce qu'il journalise. */
function bootWithoutKey(
  runProfile: IRunProfile,
  environment: "production" | "development" = "production",
): {
  service: WebhookService;
  lines: Array<{ text: string; severity: unknown }>;
} {
  const container = new Container();
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const kernel = {
    container,
    environment,
    runProfile,
    command: null,
    once(ev: string, cb: (...a: unknown[]) => void) {
      handlers[ev] = cb;
    },
    registerStoreResolution() {},
  };
  container.set("kernel", kernel);
  const module = {
    container,
    notificationsCenter: false,
    options: { webhooks: {} },
  } as unknown as Module;
  const service = new WebhookService(module);
  const lines: Array<{ text: string; severity: unknown }> = [];
  service.log = (pci: unknown, severity?: unknown) => {
    lines.push({ text: String(pci), severity });
    return null as unknown as Pdu;
  };
  handlers["onBoot"]?.();
  return { service, lines };
}

describe("WebhookService sans clé, en production — le branchement", () => {
  it("serveur : l'alerte reste CRITIC", () => {
    const { lines } = bootWithoutKey(SERVING);
    const alert = lines.find((l) => l.text.includes("AUCUNE clé"));
    assert.ok(alert, "l'alerte de clé absente doit être journalisée");
    assert.equal(alert.severity, "CRITIC");
  });

  it("commande console : l'alerte descend en DEBUG", () => {
    const { lines } = bootWithoutKey(CONSOLE_RUN_PROFILE);
    const alert = lines.find((l) => l.text.includes("AUCUNE clé"));
    assert.ok(alert, "l'alerte reste tracée, au niveau DEBUG");
    assert.equal(alert.severity, "DEBUG");
    // Seules les lignes de CLÉ comptent : l'avertissement du store `memory`
    // d'un run sans connexion est un autre sujet, que le démarrage silencieux
    // d'une commande ne montre pas (sévérité 4, hors sortie d'erreur).
    const loud = lines.filter(
      (l) =>
        l.text.includes("clé de chiffrement") &&
        (l.severity === "CRITIC" || l.severity === "WARNING"),
    );
    assert.deepEqual(
      loud,
      [],
      "aucune ligne de clé WARNING ou plus dans une commande console",
    );
  });
});

describe("Démarrage en développement sans clé — RÉSILIENT, inchangé", () => {
  // La règle ne touche qu'à la SÉVÉRITÉ du message : la clé rendue, et donc le
  // démarrage, ne dépendent pas du run. En dev sans clé, une clé éphémère est
  // tirée et le service démarre, serveur comme commande — jamais un refus.
  for (const [label, profile] of [
    ["serveur", SERVING],
    ["commande console", CONSOLE_RUN_PROFILE],
  ] as const) {
    it(`${label} : clé éphémère tirée, service actif, aucun refus`, () => {
      const { lines } = bootWithoutKey(profile, "development");
      const ephemeral = lines.find((l) => l.text.includes("ÉPHÉMÈRE"));
      assert.ok(ephemeral, "la clé éphémère est tirée et annoncée");
      assert.equal(ephemeral.severity, profile.servers ? "WARNING" : "DEBUG");
      // Témoin POSITIF : « webhooks ready » n'est journalisé qu'une fois la
      // clé posée (`WebhookService.#build`). L'absence d'un mot (« désactivés »)
      // ne prouvait rien : une clé nulle passait sans le dire.
      assert.ok(
        lines.some((l) => l.text.includes("webhooks ready")),
        "les webhooks démarrent en dev",
      );
    });
  }
});
