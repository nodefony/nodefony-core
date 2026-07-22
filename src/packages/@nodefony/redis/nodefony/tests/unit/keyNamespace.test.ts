import { describe, it, expect } from "vitest";
import { resolveKeyPrefix } from "../../src/keyNamespace";

/**
 * **Deux applications sur un même Redis ne doivent pas se voir.**
 *
 * Le `database` Redis ne cloisonne pas grand-chose et vaut `0` par défaut : deux
 * applications déployées côte à côte partagent alors l'espace de clés. Les clés
 * étant nommées en dur (`nf:sess:<id>`), la session d'une application porte le
 * même nom que celle d'une autre — et l'écran Sessions de l'une **liste les
 * sessions de l'autre**, parce qu'il balaie `nf:sess:*`.
 *
 * C'est la même classe de défaut que le cross-talk du bus temps réel, corrigé par
 * `backplane.namespace` — mais ici sur des données d'identité, ce qui la rend plus
 * grave : ce ne sont pas des messages qui fuient, ce sont des sessions.
 *
 * La cloison porte donc le même nom et suit la même règle : une cloison explicite,
 * sinon le nom de l'application. Le préfixe la place **en tête**, avant le type de
 * donnée : un opérateur peut ainsi tout voir — ou tout purger — application par
 * application, ce qu'un namespace en fin de préfixe ne permet pas.
 */
describe("Cloison des clés Redis par application", () => {
  it("place l'application AVANT le type de donnée", () => {
    expect(resolveKeyPrefix("nf:sess", "boutique")).to.equal(
      "nf:boutique:sess",
    );
    expect(resolveKeyPrefix("nf:tok", "boutique")).to.equal("nf:boutique:tok");
    expect(resolveKeyPrefix("nf:wac", "boutique")).to.equal("nf:boutique:wac");
  });

  it("deux applications ne partagent AUCUN préfixe (le cœur du sujet)", () => {
    const boutique = resolveKeyPrefix("nf:sess", "boutique");
    const intranet = resolveKeyPrefix("nf:sess", "intranet");
    expect(boutique).to.not.equal(intranet);
    // Et surtout : le balayage de l'une ne peut pas atteindre l'autre.
    expect(intranet.startsWith(`${boutique}:`)).to.equal(false);
    expect(boutique.startsWith(`${intranet}:`)).to.equal(false);
  });

  it("sans cloison, garde le préfixe historique (mono-application)", () => {
    // Une application seule sur son Redis n'a rien à cloisonner, et son espace de
    // clés ne doit pas changer sous ses pieds.
    expect(resolveKeyPrefix("nf:sess", undefined)).to.equal("nf:sess");
    expect(resolveKeyPrefix("nf:sess", "")).to.equal("nf:sess");
    expect(resolveKeyPrefix("nf:sess", "   ")).to.equal("nf:sess");
  });

  it("refuse une cloison qui contient un séparateur de clé", () => {
    // `:` est le séparateur : l'accepter permettrait de fabriquer un préfixe qui
    // en recouvre un autre (`a:b` sous `nf:` recouvrirait l'application `a`).
    expect(() => resolveKeyPrefix("nf:sess", "bou:tique")).to.throw(/cloison/i);
    expect(() => resolveKeyPrefix("nf:sess", "bou tique")).to.throw(/cloison/i);
    expect(() => resolveKeyPrefix("nf:sess", "bou*")).to.throw(/cloison/i);
  });

  it("accepte les noms d'application usuels", () => {
    for (const name of ["mon-app", "mon_app", "app.v2", "App42"]) {
      expect(resolveKeyPrefix("nf:sess", name)).to.equal(`nf:${name}:sess`);
    }
  });

  it("un motif de balayage ne peut pas déborder sur une application voisine", () => {
    // La régression redoutée : `SCAN nf:sess:*` d'avant voyait tout le monde.
    // Le motif dérivé du préfixe cloisonné ne matche que sa propre application.
    const prefix = resolveKeyPrefix("nf:sess", "boutique");
    const scan = `${prefix}:*`;
    const cleVoisine = `${resolveKeyPrefix("nf:sess", "intranet")}:abc123`;
    const clePropre = `${prefix}:abc123`;
    const matches = (pattern: string, key: string): boolean =>
      new RegExp(`^${pattern.replace(/\*/g, ".*")}$`).test(key);
    expect(matches(scan, clePropre)).to.equal(true);
    expect(matches(scan, cleVoisine)).to.equal(false);
  });
});
