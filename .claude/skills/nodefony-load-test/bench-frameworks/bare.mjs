// node:http nu — plafond machine (référence haute, 0 routing).
import http from "node:http";
import { state, BENCH_PATH } from "./payload.mjs";

const port = Number(process.env.PORT ?? 5161);
http
  .createServer((req, res) => {
    if (req.url === BENCH_PATH) {
      const body = JSON.stringify(state);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(port, "127.0.0.1", () => console.log(`bare :${port}`));
// Sortie propre sur SIGINT (flush du log V8 --prof).
process.on("SIGINT", () => process.exit(0));
