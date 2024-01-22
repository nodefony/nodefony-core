// index.ts
import nodefony from "./Nodefony";
//import nodefony, { Nodefony, kernel } from "./Nodefony";
// import Kernel from "./kernel/Kernel";
// import Module from "./kernel/Module";
// import CliKernel from "./kernel/CliKernel";
// import Container from "./Container";
// import Syslog from "./syslog/Syslog";
// import Pdu from "./syslog/Pdu";
// import Error from "./Error";
// import Service from "./Service";
// import Command from "./command/Command";
// import Cli from "./Cli";
// import Event from "./Event";
// import Builder from "./command/Builder";
// import Finder from "./finder/Finder";
// import File from "./finder/File";
// import Result from "./finder/Result";
// import FileClass from "./FileClass";
// import FileResult from "./finder/FileResult";

// Vérifie si module.exports est défini (module CommonJS)
if (typeof module !== "undefined" && module.exports) {
  // Exporte directement l'objet nodefony
  module.exports = nodefony;
}

export default nodefony;
export * from "./Nodefony";

// export {
//   Nodefony,
//   kernel,
//   Kernel,
//   Module,
//   CliKernel,
//   Syslog,
//   Service,
//   Container,
//   Cli,
//   Event,
//   Command,
//   Pdu,
//   Builder,
//   Finder,
//   File,
//   FileClass,
//   FileResult,
//   Result,
//   Error,
// };
