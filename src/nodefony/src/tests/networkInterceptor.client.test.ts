import { expect } from "chai";
import { afterEach, describe, it, vi } from "vitest";
import { installNetworkInterceptor } from "../client/debugbar/network";

/** XHR factice : seuls `open` et `send` du prototype comptent ici. */
function fakeXhrClass(): typeof XMLHttpRequest {
  class FakeXhr {
    open(): void {}
    send(): void {}
  }
  return FakeXhr as unknown as typeof XMLHttpRequest;
}

describe("installNetworkInterceptor — désinstallation chaînée", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restaure open/send natifs quand personne n'a patché par-dessus", () => {
    const XHR = fakeXhrClass();
    const { open, send } = XHR.prototype;
    vi.stubGlobal("window", { XMLHttpRequest: XHR });
    const uninstall = installNetworkInterceptor({ onChange: () => {} });
    expect(XHR.prototype.open).to.not.equal(open);
    uninstall();
    expect(XHR.prototype.open).to.equal(open);
    expect(XHR.prototype.send).to.equal(send);
  });

  it("n'écrase pas un patch posé APRÈS le nôtre", () => {
    const XHR = fakeXhrClass();
    vi.stubGlobal("window", { XMLHttpRequest: XHR });
    const uninstall = installNetworkInterceptor({ onChange: () => {} });
    const thirdOpen = function (): void {};
    const thirdSend = function (): void {};
    XHR.prototype.open = thirdOpen as XMLHttpRequest["open"];
    XHR.prototype.send = thirdSend as XMLHttpRequest["send"];
    uninstall();
    expect(XHR.prototype.open).to.equal(thirdOpen);
    expect(XHR.prototype.send).to.equal(thirdSend);
  });
});
