import assert from "node:assert";
import {
  isInKubernetes,
  shouldWarnPerPodView,
} from "../service/cluster/podEnvironment";

describe("podEnvironment — isInKubernetes (détection pod k8s)", () => {
  it("KUBERNETES_SERVICE_HOST présent → true", () => {
    assert.strictEqual(
      isInKubernetes({ KUBERNETES_SERVICE_HOST: "10.0.0.1" }),
      true,
    );
  });

  it("KUBERNETES_SERVICE_PORT seul → true", () => {
    assert.strictEqual(
      isInKubernetes({ KUBERNETES_SERVICE_PORT: "443" }),
      true,
    );
  });

  it("aucun marqueur k8s → false (hors cluster / dev / VPS)", () => {
    assert.strictEqual(isInKubernetes({}), false);
    assert.strictEqual(isInKubernetes({ NODE_ENV: "production" }), false);
  });
});

describe("podEnvironment — shouldWarnPerPodView (garde-fou vue multi-pod)", () => {
  it("k8s + driver LOCAL + pas d'agrégation → WARN", () => {
    assert.strictEqual(shouldWarnPerPodView(true, "memory", false), true);
    assert.strictEqual(shouldWarnPerPodView(true, "cluster-file", false), true);
    assert.strictEqual(shouldWarnPerPodView(true, "file", false), true);
  });

  it("hors k8s → jamais (dev/VPS/cluster local)", () => {
    assert.strictEqual(shouldWarnPerPodView(false, "memory", false), false);
  });

  it("agrégation configurée (loki/opensearch) → pas de warn", () => {
    assert.strictEqual(shouldWarnPerPodView(true, "memory", true), false);
  });

  it("driver d'agrégation actif (loki/opensearch/nom inconnu) → pas de warn", () => {
    // Régression : `getActiveLogDriver()` renvoie un OBJET ILogDriver, pas une
    // string — passer l'objet à un Set<string> matchait toujours false (bug réel).
    // La fonction prend le NOM (string) : un driver non-local ne déclenche rien.
    assert.strictEqual(shouldWarnPerPodView(true, "loki", false), false);
    assert.strictEqual(shouldWarnPerPodView(true, "opensearch", false), false);
    assert.strictEqual(shouldWarnPerPodView(true, undefined, false), false);
  });
});
