import { createHmac } from "node:crypto";
const [channel, secret] = process.argv.slice(2);
const msg = {
  channel,
  payload: { action: "faux évènement d audit", who: "attaquant" },
  originId: "evil",
};
const canonical = `${JSON.stringify(msg.originId)}\n${JSON.stringify(msg.channel)}\n${JSON.stringify(msg.payload)}`;
const sig = createHmac("sha256", secret).update(canonical).digest("base64url");
console.log(JSON.stringify({ ...msg, sig }));
