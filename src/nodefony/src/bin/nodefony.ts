#!/usr/bin/env node
import { CliKernel } from "nodefony";
import { exit } from "process";

const kernel = new CliKernel().start().catch((e) => {
  exit(e.code || 1);
});
export default kernel;
