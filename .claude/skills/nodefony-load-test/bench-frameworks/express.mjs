// Express 5 — scan linéaire des routes (comme le Router Nodefony actuel).
import express from "express";
import { state, BENCH_PATH, dummyRoutes } from "./payload.mjs";

const app = express();
app.set("env", "production");
app.disable("x-powered-by");

const { before, after } = dummyRoutes();
for (const p of before)
  app.get(p, (req, res) => res.json({ id: req.params.id }));
app.get(BENCH_PATH, (_req, res) => res.json(state));
for (const p of after)
  app.get(p, (req, res) => res.json({ id: req.params.id }));

const port = Number(process.env.PORT ?? 5162);
app.listen(port, "127.0.0.1", () => console.log(`express :${port}`));
