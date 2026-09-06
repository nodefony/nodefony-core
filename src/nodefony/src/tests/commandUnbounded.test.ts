/*
 *   NODEFONY FRAMEWORK UNIT TEST — MOCHA STYLE
 *   L'action d'une commande n'est PAS bornée par le délai de démarrage
 */

import { expect } from "chai";
import { EventEmitter } from "node:events";
import Event from "../Event";
import {
  isUnboundedListener,
  tagListener,
  tagUnboundedListener,
} from "../kernel/lifecycleTags";

/**
 * 🔴 Ce que ces cas gardent, et pourquoi ils existent.
 *
 * `doctor --deep` sortait en **0 au milieu de `npm run test`** : son action est
 * câblée sur `onPostReady`, et `Kernel.fireLifecycle` bornait CHAQUE écouteur au
 * délai de démarrage (20 s en développement). Passé ce délai la garde
 * abandonnait l'écouteur en fail-soft, le boot enchaînait sur `finishOrPark(0)`,
 * et le processus rendait un succès muet sans rapport. Un outil de diagnostic
 * qui ment sur son propre achèvement est pire qu'un outil absent.
 *
 * Le défaut était masqué tant que l'étage profond appelait `spawnSync` : un
 * appel synchrone bloque la boucle d'évènements, donc le minuteur de la garde ne
 * pouvait pas se déclencher. Le passage en asynchrone — fait pour que
 * l'animation d'attente tourne — l'a réveillé. La cause, elle, était là depuis
 * toujours et vaut pour TOUTE commande longue.
 */
describe("Une commande n'est pas un hook de boot — borne de temps", () => {
  it("marque puis relit — et le marquage traverse le wrapper `once`", () => {
    const action = (): void => {};
    expect(tagUnboundedListener(action)).to.equal(action); // marqué EN PLACE
    expect(isUnboundedListener(action)).to.equal(true);

    // Câblage réel d'une commande : `kernel.once(...)`. `rawListeners` rend le
    // wrapper interne de Node, sur lequel le marquage est invisible sans
    // déballage — c'est exactement ce qui rendrait le correctif inopérant.
    const bus = new EventEmitter();
    bus.once("onPostReady", action);
    const [wrapper] = bus.rawListeners("onPostReady");
    expect(wrapper).to.not.equal(action);
    expect(isUnboundedListener(wrapper)).to.equal(true);
  });

  it("un listener NON marqué reste borné", () => {
    const hook = (): void => {};
    expect(isUnboundedListener(hook)).to.equal(false);
    expect(isUnboundedListener(tagListener(hook, "un-module", true))).to.equal(
      false,
    );
    expect(isUnboundedListener(null)).to.equal(false);
    expect(isUnboundedListener(undefined)).to.equal(false);
  });

  it("la garde décide PAR écouteur : le hook tombe, l'action va au bout", async () => {
    const ev = new Event();
    const acheve: string[] = [];
    const lent = async (): Promise<string> => {
      await new Promise((r) => setTimeout(r, 60));
      acheve.push("hook");
      return "hook";
    };
    const action = tagUnboundedListener(async (): Promise<string> => {
      await new Promise((r) => setTimeout(r, 60));
      acheve.push("action");
      return "action";
    });
    ev.once("onPostReady", lent);
    ev.once("onPostReady", action);

    const r = await ev.emitAsyncGuarded(
      "onPostReady",
      // La politique du Kernel, à l'identique : borné, SAUF ce qui est marqué.
      { timeoutMs: (l) => (isUnboundedListener(l) ? 0 : 10) },
    );

    // Le hook est bien abandonné par la borne — la garde de boot fait son
    // travail, on ne l'a pas désarmée.
    expect(r.errors).to.have.length(1);
    expect(r.errors[0]?.timedOut).to.equal(true);
    // …et l'action, elle, a été ATTENDUE jusqu'au bout.
    expect(acheve).to.deep.equal(["hook", "action"]);
    expect(r.results).to.deep.equal(["action"]);
  });

  it("une borne NUMÉRIQUE s'applique à tout le monde (pas de régression)", async () => {
    const ev = new Event();
    ev.once(
      "e",
      tagUnboundedListener(async () => {
        await new Promise((r) => setTimeout(r, 60));
        return "trop tard";
      }),
    );
    const r = await ev.emitAsyncGuarded("e", { timeoutMs: 10 });
    expect(r.errors).to.have.length(1);
    expect(r.errors[0]?.timedOut).to.equal(true);
  });
});

/**
 * La CHAÎNE, pas la brique. Le marquage ne sert à rien tant que `setEvents` ne
 * le pose pas sur l'action réellement câblée — c'est le motif « la brique
 * éprouvée, la chaîne jamais », déjà payé deux fois sur ce dépôt.
 */
describe("Command.setEvents — l'action câblée porte le marquage", () => {
  it("le listener posé sur kernelEvent échappe à la borne, les hooks non", async () => {
    const { default: Command } = await import("../command/Command");
    const { default: Cli } = await import("../Cli");
    const cli = new Cli("NODE", {
      clear: false,
      asciify: false,
      autostart: false,
    });
    await cli.start();
    const cmd = new Command("borne-cmd", "", cli, {
      kernelEvent: "onPostReady",
    });
    // Un hook de cycle de vie, à côté de l'action : il doit RESTER borné.
    cmd.onKernelReady = async (): Promise<void> => {};
    const bus = new EventEmitter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cmd.kernel = bus as any;
    cmd.setEvents();

    const [action] = bus.rawListeners("onPostReady");
    expect(action, "l'action doit être câblée sur kernelEvent").to.not.equal(
      undefined,
    );
    expect(isUnboundedListener(action)).to.equal(true);

    const [hook] = bus.rawListeners("onReady");
    expect(hook).to.not.equal(undefined);
    expect(isUnboundedListener(hook)).to.equal(false);
  });
});
