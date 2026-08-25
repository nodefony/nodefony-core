import WebSocket from "ws";
const cookie = process.argv[2];
const ws = new WebSocket("wss://127.0.0.1:5152/nodefony/studio/api/realtime", {
  headers: { Cookie: cookie },
  rejectUnauthorized: false,
});
let jobId = null;
const send = (m) => ws.send(JSON.stringify(m));
ws.on("open", () =>
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "scaffold:run",
    params: {
      type: "app",
      answers: {
        name: "demo-archive",
        preset: "minimal",
        frontend: "none",
        delivery: "download",
      },
      steps: [],
    },
  }),
);
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id === 1) {
    if (m.error) {
      console.error("ERREUR:", m.error.message);
      process.exit(1);
    }
    jobId = m.result.id;
    console.log("job", jobId);
    send({
      jsonrpc: "2.0",
      method: "subscribe",
      params: { channel: `scaffold:job@${jobId}` },
    });
    return;
  }
  const ev = m.params?.data ?? m.params?.payload ?? m.params;
  if (ev?.kind === "line") console.log(`[${ev.line.stream}] ${ev.line.text}`);
  if (ev?.kind === "state" && ev.state.status !== "running") {
    console.log(
      "STATUT:",
      ev.state.status,
      "| archive:",
      JSON.stringify(ev.state.archive),
    );
    console.log("JOBID=" + jobId);
    ws.close();
    process.exit(ev.state.status === "done" ? 0 : 1);
  }
});
setTimeout(() => {
  console.error("timeout");
  process.exit(1);
}, 60000);
