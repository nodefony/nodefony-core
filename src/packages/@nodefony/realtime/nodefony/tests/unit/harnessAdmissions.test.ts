import { afterEach, describe, expect, it } from "vitest";
import "reflect-metadata";
import { Container, Service, injectable } from "nodefony";
import type { IChannelAdmission, ISubscriberIdentity } from "nodefony";
import type { ContextType } from "@nodefony/http";
import { createTestIdentity } from "@nodefony/security/testing";
import { RealtimeChannel } from "../../decorators/realtimeDecorators";
import { RealtimeController } from "../../src/server/RealtimeController";
import { getRealtimeHub } from "../../src/server/RealtimeHub";
import { createRealtimeHarness } from "../../testing/index";
import type { IRealtimeHarness } from "../../testing/index";

/**
 * L'option `admissions` du harnais : une politique `allow: MaClasse` se résout
 * au démarrage, dans le conteneur du noyau — que le harnais n'a pas. Sans elle,
 * un controller gardé par une classe d'admission n'était pas testable avec
 * l'outil livré aux applications.
 */

/** L'admission lit SON service : ici, la liste des invités. */
@injectable()
class GuestList extends Service implements IChannelAdmission {
  constructor(readonly guests: ReadonlySet<string>) {
    super("guestList", new Container());
  }
  allow(_channel: string, who: ISubscriberIdentity): boolean {
    return who.id !== null && this.guests.has(who.id);
  }
}

class PartyRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("PartyRealtime", context);
  }
  @RealtimeChannel("party:*", { allow: GuestList })
  party(): () => void {
    return () => {};
  }
  override createRealtimeChannel(channel: string): (() => void) | null {
    return channel.startsWith("party:") ? () => {} : null;
  }
}

const open: IRealtimeHarness<PartyRealtime>[] = [];

async function connect(
  user: string,
  admissions?: readonly IChannelAdmission[],
): Promise<IRealtimeHarness<PartyRealtime>> {
  const h = createRealtimeHarness((ctx) => new PartyRealtime(ctx), {
    identity: createTestIdentity({ identifier: user }),
    resetHub: open.length === 0,
    ...(admissions === undefined ? {} : { admissions }),
  });
  await h.connect();
  open.push(h);
  return h;
}

describe("harnais — les classes d'admission fournies par le test", () => {
  afterEach(() => {
    for (const h of open.splice(0)) h.close();
    getRealtimeHub().clear();
  });

  it("l'instance du test tranche : l'invitée entre, l'inconnu est refusé", async () => {
    const guests = new GuestList(new Set(["alice"]));
    const alice = await connect("alice", [guests]);
    const bob = await connect("bob", [guests]);
    await alice.subscribe("party:1");
    await bob.subscribe("party:1");
    expect(alice.subscriptions()).toEqual(["party:1"]);
    expect(bob.subscriptions()).toEqual([]);
    expect(bob.denials().map((d) => d.channel)).toEqual(["party:1"]);
  });

  it("sans `admissions`, la classe n'est résolue par personne : la connexion est refusée (1011)", async () => {
    await expect(connect("alice")).rejects.toThrow(/code 1011/u);
  });
});
