// Hôte VOYOU (ADR-0030 §D6) : parle le canal `nf-held` sans `serveHeldService`,
// pour éprouver ce que le TENEUR refuse quand un hôte enfreint le protocole.
const CHANNEL = "nf-held";
const send = (message) => {
  if (process.connected) process.send(message, () => {});
};
const ready = (data) =>
  send({
    channel: CHANNEL,
    type: "report",
    state: "ready",
    data,
    reason: null,
  });

let keep = null;

process.on("message", (message) => {
  if (message?.channel !== CHANNEL) return;
  if (message.type === "ping") {
    send({ channel: CHANNEL, type: "pong", seq: message.seq });
    return;
  }
  if (message.type === "stop") {
    // Sort après un délai : un `ready` peut partir pendant ce temps.
    setTimeout(() => process.exit(0), message.spec?.stopMs ?? 400);
    return;
  }
  if (message.type !== "start") return;
  keep = setInterval(() => {}, 1_000);
  const { mode } = message.spec;
  if (mode === "ready-after-stop") {
    // Rapporte `ready` quoi qu'il arrive, même après un `stop`.
    setTimeout(() => ready({ late: true }), message.spec.readyMs);
    return;
  }
  if (mode === "forged") {
    send({ channel: "nf-dev", type: "held-state", owner: "x" });
    send({ channel: CHANNEL, type: "bogus" });
    send({
      channel: CHANNEL,
      type: "report",
      state: "ready",
      data: [],
      reason: null,
    });
    ready({ blob: "x".repeat(message.spec.hugeSize) });
    ready({ n: 1 });
    for (let n = 2; n <= 200; n++) ready({ n });
    send({
      channel: CHANNEL,
      type: "report",
      state: "failed",
      data: null,
      reason: "tardif",
    });
  }
});
process.on("disconnect", () => {
  if (keep) clearInterval(keep);
  process.exit(0);
});
