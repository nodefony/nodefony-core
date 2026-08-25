import { describe, it, expect, afterEach } from "vitest";
import { hostname } from "node:os";
import { resolveBackplaneOriginId } from "../../src/backplane/originId.js";

/**
 * Résolveur d'originId backplane — dette 🔴 #2 du module : `String(process.pid)`
 * n'est PAS unique cross-pod (namespace PID par conteneur → 2 pods k8s = PID 1),
 * l'anti-écho jetait silencieusement le fan-out légitime. Le default doit porter
 * une composante HOST (NF_POD_NAME / hostname) + le pid (workers d'un même host).
 */

const savedPodName = process.env.NF_POD_NAME;
afterEach(() => {
  if (savedPodName === undefined) {
    delete process.env.NF_POD_NAME;
  } else {
    process.env.NF_POD_NAME = savedPodName;
  }
});

describe("resolveBackplaneOriginId", () => {
  it("NF_POD_NAME (downward API k8s) prioritaire : `<pod>:<pid>`", () => {
    process.env.NF_POD_NAME = "web-7f9c-abcde";
    expect(resolveBackplaneOriginId()).to.equal(
      `web-7f9c-abcde:${process.pid}`,
    );
  });

  it("sans NF_POD_NAME : `<hostname>:<pid>`", () => {
    delete process.env.NF_POD_NAME;
    expect(resolveBackplaneOriginId()).to.equal(`${hostname()}:${process.pid}`);
  });

  it("2 pods au MÊME pid (PID 1 conteneurisé) → origins DISTINCTS (le bug d'avant)", () => {
    process.env.NF_POD_NAME = "pod-a";
    const a = resolveBackplaneOriginId();
    process.env.NF_POD_NAME = "pod-b";
    const b = resolveBackplaneOriginId();
    // même process (donc même pid), seule la composante host diffère — c'est
    // exactement la situation k8s que le pid nu confondait.
    expect(a).to.not.equal(b);
    expect(a.endsWith(`:${process.pid}`)).to.equal(true);
    expect(b.endsWith(`:${process.pid}`)).to.equal(true);
  });
});
