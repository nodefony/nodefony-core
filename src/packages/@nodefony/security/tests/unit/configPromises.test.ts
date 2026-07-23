import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import { securityConfigJsonSchema } from "../../nodefony/config/defineModuleConfig";
import { generateApiKey } from "../../nodefony/src/apikey/apiKeyFormat";
import { listTotpStores } from "../../nodefony/src/totp/totpSecretStoreRegistry";
import { WebAuthnService } from "../../nodefony/service/webAuthn";

/**
 * **Ce que la configuration PROMET doit être vrai.**
 *
 * Un `.describe()` n'est pas un commentaire : il remonte dans le JSON Schema, donc
 * dans l'écran de configuration de Studio et dans l'auto-complétion. Quand il
 * décrit un format, une garantie ou une liste de backends, il ENGAGE le framework
 * — et une promesse fausse est plus coûteuse qu'une absence de texte : elle est
 * crédible, donc personne ne va vérifier.
 *
 * Ce banc verrouille les trois promesses qui avaient dérivé du code, en testant le
 * COMPORTEMENT (le format réellement émis, les backends réellement enregistrés,
 * l'avertissement réellement émis) plutôt que la lettre du texte : un test qui
 * relit une phrase ne prouve que l'orthographe.
 */

/** Le `.describe()` publié pour un chemin de config (tel que Studio le lit). */
function describeOf(path: readonly string[]): string {
  const schema = securityConfigJsonSchema() as Record<string, unknown>;
  let node: Record<string, unknown> = schema;
  for (const key of path) {
    const props = node.properties as Record<string, Record<string, unknown>>;
    assert.ok(props?.[key], `chemin de config introuvable : ${path.join(".")}`);
    node = props[key];
  }
  return String(node.description ?? "");
}

describe("promesses de config — format des clés d'API", () => {
  it("un seul séparateur STRUCTUREL, puis un corps positionnel de 57 caractères", () => {
    const { token, pubid, publicPrefix } = generateApiKey("nf");
    // Le corps est positionnel — pubid(8) + secret(43) + crc(6) — précisément
    // parce que le charset base64url contient lui-même `_` : le token en porte
    // d'autres, qui sont de la DONNÉE. Découper sur `_` (ce que suggérait le
    // format annoncé `<prefix>_<pubid>_<secret><crc>`) casse donc au hasard des
    // octets tirés — un bug qui ne se reproduit qu'une fois sur quelques clés.
    const cut = token.indexOf("_");
    assert.equal(token.slice(0, cut), "nf");
    assert.equal(token.slice(cut + 1).length, 8 + 43 + 6);
    assert.equal(publicPrefix, `nf_${pubid}`);
    assert.equal(token.slice(cut + 1, cut + 9), pubid);
  });

  it("le describe ne réintroduit pas la forme à deux séparateurs", () => {
    const text = describeOf(["apiKeys", "prefix"]);
    assert.ok(
      !text.includes("<pubid>_<secret>"),
      "le format documenté doit rester `<prefix>_<pubid><secret><crc>`",
    );
    assert.ok(text.includes("<prefix>_<pubid><secret><crc>"));
  });
});

describe("promesses de config — backends de store TOTP", () => {
  /** Briques que l'adapter DÉCLARE couvrir (`nodefony.stores`, lu par Studio). */
  function declaredStores(pkg: string): string[] {
    const url = new URL(`../../../${pkg}/package.json`, import.meta.url);
    const json = JSON.parse(readFileSync(url, "utf8")) as {
      nodefony?: { stores?: string[] };
    };
    return json.nodefony?.stores ?? [];
  }

  it("seul @nodefony/drizzle annonce un store TOTP", () => {
    // Le jour où mongoose ou redis en fournira un, ce test tombera — et c'est le
    // rappel voulu : le `.describe()` de `totp.store` prévient aujourd'hui qu'une
    // infra Mongo se replie sur `memory`. Cette mise en garde devra sauter avec.
    assert.ok(declaredStores("drizzle").includes("totp"));
    assert.ok(
      !declaredStores("mongoose").includes("totp"),
      "mongoose annonce un store TOTP : mettre à jour le describe de security.totp.store",
    );
    assert.ok(
      !declaredStores("redis").includes("totp"),
      "redis annonce un store TOTP : mettre à jour le describe de security.totp.store",
    );
  });

  it("sans adapter chargé, `memory` est le seul backend enregistré", () => {
    assert.deepEqual(listTotpStores(), ["memory"]);
  });

  it("le describe nomme la couverture réelle, pas la liste générique des autres briques", () => {
    const text = describeOf(["totp", "store"]);
    assert.ok(
      !/\|\s*mongoose/.test(text),
      "mongoose ne doit plus être présenté comme une valeur admise",
    );
    assert.ok(text.includes("drizzle"));
    assert.ok(
      text.toLowerCase().includes("memory"),
      "le repli volatil doit être nommé, c'est lui qui perd les secrets 2FA",
    );
  });
});

describe("promesses de config — attestation WebAuthn", () => {
  /** Boote le service et rend les lignes de journal émises au boot. */
  function bootWith(passkeys: Record<string, unknown>): string[] {
    const container = new Container();
    const handlers: Record<string, () => void> = {};
    const lines: string[] = [];
    container.set("kernel", {
      container,
      environment: "development",
      infra: {},
      once(ev: string, cb: () => void) {
        handlers[ev] = cb;
      },
      registerStoreResolution() {},
    });
    const module = {
      container,
      notificationsCenter: false,
      options: { passkeys: { enabled: true, store: "memory", ...passkeys } },
    } as unknown as Module;
    const svc = new WebAuthnService(module);
    const original = svc.log.bind(svc);
    // On observe sans remplacer : le journal réel garde son comportement (et son
    // type de retour), on ne fait que noter ce qui passe.
    svc.log = ((pci, severity, ...rest) => {
      lines.push(`${String(severity ?? "INFO")} ${String(pci)}`);
      return original(pci, severity, ...rest);
    }) as typeof svc.log;
    handlers.onBoot?.();
    svc.log = original;
    return lines;
  }

  const attestationWarning = (lines: string[]) =>
    lines.find((l) => l.startsWith("WARNING") && l.includes("attestation"));

  it("`direct` avertit que l'attestation n'est PAS vérifiée", () => {
    const warning = attestationWarning(bootWith({ attestation: "direct" }));
    assert.ok(warning, "aucun avertissement : l'app croirait tenir un AAL3");
    assert.match(warning, /MDS|AAGUID/);
  });

  it("`enterprise` avertit de la même façon", () => {
    assert.ok(attestationWarning(bootWith({ attestation: "enterprise" })));
  });

  it("`none` (défaut) n'avertit de rien — rien n'est promis", () => {
    assert.equal(attestationWarning(bootWith({})), undefined);
  });
});
