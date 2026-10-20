// Témoin du banc h2c-vs-h1.sh : Node NU, sans framework — le coût de HTTP/2
// lui-même. HTTP/1.1 et h2c sur deux ports, même réponse triviale.
// Usage : node h2c-vs-h1-bare.mjs [port HTTP/1.1=5161] [port h2c=5163]
import http from "node:http";
import http2 from "node:http2";

const [h1Port = "5161", h2cPort = "5163"] = process.argv.slice(2);
const handler = (_req, res) => {
  res.setHeader("content-type", "text/plain");
  res.end("ok");
};
http.createServer(handler).listen(Number(h1Port), "127.0.0.1");
http2.createServer(handler).listen(Number(h2cPort), "127.0.0.1");
