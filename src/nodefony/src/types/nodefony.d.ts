// // Importez chaque déclaration de type individuelle
// import Globals from "./globals";
// import Index from "../index";
// import Container from "../Container";
// import nodefonyError from "../Error";
// import Event from "../Event";
// import Fileclass from "../FileClass";
// import { KernelType } from "../Kernel/Kernel";
// import Module from "../kernel/Module";
// import CliKernel from "../kernel/CliKernel";
// import nodefony from "../Nodefony";
// import { DefaultOptionsService } from "../Service";
// import Tool from "../Tools";
// import Syslog from "../syslog/Syslog";
// import Pdu from "../syslog/Pdu";
// import File from "../finder/File";
// import FileResult from "../finder/FileResult";
// import Finder from "../finder/Finder";
// import Result from "../finder/Result";
// import Command from "../command/Command";
// import Builder from "../command/Builder";
// import Cli from "../Cli";

import { Nodefony } from "..";
import {
  nodefonyOptions,
  EnvironmentType,
  DebugType,
  JSONObject,
} from "./globals";

declare module "nodefony" {
  // Ajoutez vos déclarations de type ici
  export interface NodefonyType {
    nodefonyOptions: nodefonyOptions;
    EnvironmentType: EnvironmentType;
    DebugType: DebugType;
    JSONObject: JSONObject;
    generateV5Id(name: string, namespace?: string): string;
    generateId(): string;
  }
}

declare namespace Nodefony {}

// rapide
export * from "./globals";
export * from "../Container";
export * from "../Error";
export * from "../Event";
export * from "../FileClass";
export * from "../Service";
export * from "../Tools";
export * from "../syslog/Syslog";
export * from "../syslog/Pdu";
export * from "../finder/File";
export * from "../finder/FileResult";
export * from "../finder/Finder";
export * from "../finder/Result";
export * from "../command/Command";
export * from "../command/Builder";
export * from "../Cli";
export * from "../Nodefony";
export * from "../kernel/Kernel";
export * from "../kernel/Module";
export * from "../service/rollup/rollupService";

//export * from "../index";
