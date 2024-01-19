#!/usr/bin/env node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
//import { CliKernel } from "../dist/node/index.js";
import Cli from "../Cli";
import CliKernel from "../kernel/CliKernel";

new CliKernel().start().then((cli: Cli) => {
  cli.parse();
});
