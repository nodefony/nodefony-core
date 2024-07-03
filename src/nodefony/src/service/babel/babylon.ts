/* eslint-disable @typescript-eslint/ban-ts-comment */
import { parse, ParserOptions, ParseResult } from "@babel/parser";
import generate, { GeneratorOptions } from "@babel/generator";
import traverse, { NodePath } from "@babel/traverse";
import {
  File,
  Node,
  Comment,
  Expression,
  ClassDeclaration,
  ClassExpression,
  ClassMethod,
  Identifier,
  Decorator,
  CallExpression,
  ImportDeclaration,
  //OptionalMemberExpression,
} from "@babel/types";
//import util from "util";
import { extend } from "../../Tools";
import Kernel from "../../kernel/Kernel";
import Service from "../../Service";
import Container from "../../Container";
import Event from "../../Event";
import FileClass from "../../FileClass";

const defaultSettings: ParserOptions = {
  sourceType: "module",
  // strictMode: false,
  // tokens: true,
  plugins: ["estree", "typescript", "decorators-legacy"],
};
//const regClass = new RegExp("^(.*)Controller$");
//const regAction = new RegExp("^(.*)Action$");

type ParserType =
  | Node[]
  | Node
  | Comment[]
  | Identifier
  | Expression
  | ClassDeclaration
  | ClassExpression
  | ClassMethod;

class Babylon extends Service {
  constructor(kernel: Kernel) {
    super(
      "babylon",
      kernel.container as Container,
      kernel.notificationsCenter as Event,
      extend({}, defaultSettings)
    );
  }

  // override logger(res: any, deep: boolean) {
  //   if (deep) {
  //     console.log(
  //       util.inspect(res, {
  //         depth: 10,
  //       })
  //     );
  //     return;
  //   }
  //   console.log(res);
  // }

  async parseFile(
    file: string | FileClass,
    options: ParserOptions = {}
  ): Promise<ParseResult<File>> {
    return new Promise((resolve, reject) => {
      try {
        if (file) {
          const opt: ParserOptions = extend({}, this.options, options);
          switch (true) {
            case file instanceof FileClass:
              opt.sourceFilename = file.path as string;
              file
                .readAsync()
                .then((str) => {
                  const res = parse(str.toString(), opt);
                  return resolve(res);
                })
                .catch((e) => reject(e));
              break;
            case typeof file === "string":
              try {
                const myfile = new FileClass(file);
                opt.sourceFilename = myfile.path as string;
                myfile
                  .readAsync()
                  .then((str) => {
                    try {
                      const res = parse(str.toString(), opt);
                      return resolve(res);
                    } catch (e) {
                      console.error(e);
                      throw e;
                    }
                  })
                  .catch((e) => reject(e));
              } catch (e) {
                const res = parse(file, opt);
                return resolve(res);
              }
              break;
            default:
              return reject(new Error("babylon parse error bad argument type"));
          }
        } else {
          return reject(new Error("babylon parse error no file argument"));
        }
      } catch (e) {
        return reject(e);
      }
    });
  }

  parseClassNode(node: ParserType, obj: any) {
    console.log(node, obj);
  }

  parseDecorators(node: Node): string[] {
    const decorators: string[] = [];
    //@ts-ignore
    traverse.default(node, {
      ClassDeclaration(path: NodePath<ClassDeclaration>) {
        path.node.decorators?.forEach((decorator: Decorator) => {
          if (decorator.expression.type === "CallExpression") {
            const callee = decorator.expression.callee;
            if (callee.type === "Identifier" && callee.name === "modules") {
              const args = decorator.expression.arguments;
              if (args.length > 0 && args[0].type === "ArrayExpression") {
                const elements = args[0].elements;
                elements.forEach((element) => {
                  //@ts-ignore
                  //console.log(element);
                  if (element?.type === "Literal") {
                    //@ts-ignore
                    decorators.push(element.value);
                  }
                });
              }
            }
          }
        });
      },
    });
    return decorators;
  }

  parseAddModule(node: Node): string[] {
    const tab: string[] = [];
    //@ts-ignore
    traverse.default(node, {
      CallExpression(path: NodePath<CallExpression>) {
        if (
          path.node.callee.type === "MemberExpression" &&
          path.node.callee.object.type === "ThisExpression" &&
          path.node.callee.property.type === "Identifier" &&
          path.node.callee.property.name === "addModule"
        ) {
          const args = path.node.arguments;
          if (args.length > 0 && args[0].type === "Literal") {
            tab.push(args[0].value);
            console.log(
              `Found a call to this.loadModule with argument: ${args[0].value}`
            );
          }
        }
      },
    });
    return tab;
  }

  parseLoadModule(node: Node): string[] {
    const modulesChargement: string[] = [];
    //@ts-ignore
    traverse.default(node, {
      enter(path: NodePath<Node>) {
        if (path.node.type === "ClassDeclaration") {
          //console.log(path.node.body.body);
          for (let ele: NodePath of path.node.body.body) {
            //console.log(ele.value);
          }
        }
      },
      CallExpression(path: NodePath<CallExpression>) {
        const { callee, arguments: args } = path.node;
        // Identification optimisée de l'expression d'appel

        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "MemberExpression" &&
          callee.object.property.type === "Identifier" &&
          callee.object.property.name === "kernel" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "loadModule"
        ) {
          // Vérification de la présence et de la validité des arguments
          if (args.length > 0 && args[0].type === "StringLiteral") {
            modulesChargement.push(args[0].value);
            console.log(
              `Appel à this.kernel.loadModule avec l'argument : ${args[0].value}`
            );
          } else {
            console.warn(
              "Argument invalide ou manquant pour l'appel this.kernel.loadModule"
            );
          }
        }
      },
    });
    return modulesChargement;
  }

  parseImport(node: Node): string[] {
    const tab: string[] = [];
    //@ts-ignore
    traverse.default(node, {
      ImportDeclaration(path: NodePath<ImportDeclaration>) {
        //console.log(`Found an import: ${path.node.source.value}`);
        tab.push(path.node.source.value);
      },
    });
    return tab;
  }

  async parseModule(file: string) {
    return this.parseFile(file).then((ast: Node) => {
      const obj = {
        ast,
        modules: {
          import: this.parseImport(ast),
          decorators: this.parseDecorators(ast),
          loadModule: this.parseLoadModule(ast),
          addModule: this.parseAddModule(ast),
        },
      };
      return obj;
    });
  }

  async modifyModulesDecorator(file: string, moduleToAdd: string) {
    return this.parseFile(file).then((ast: Node) => {
      traverse.default(ast, {
        ClassDeclaration(path: NodePath<ClassDeclaration>) {
          const decorators = path.node.decorators;
          if (decorators) {
            let modulesDecoratorFound = false;

            for (let i = 0; i < decorators.length; i++) {
              const decorator = decorators[i];
              if (
                decorator.expression.type === "CallExpression" &&
                decorator.expression.callee.name === "modules"
              ) {
                // Add module to existing array
                decorator.expression.arguments[0].elements.push({
                  type: "StringLiteral",
                  value: moduleToAdd,
                });
                modulesDecoratorFound = true;
                break;
              }
            }
            // If decorator not found, create a new one
            if (!modulesDecoratorFound) {
              decorators.push({
                type: "Decorator",
                expression: {
                  type: "CallExpression",
                  callee: { type: "Identifier", name: "modules" },
                  arguments: [
                    {
                      type: "ArrayExpression",
                      elements: [{ type: "StringLiteral", value: moduleToAdd }],
                    },
                  ],
                },
              });
            }
          }
        },
      });

      const options: GeneratorOptions = {};
      //@ts-ignoredefault
      const modifiedCode = generate.default(ast, options, file);
      console.log(modifiedCode);
      return modifiedCode.code;
    });
  }

  // async parseController(file: string) {
  //   return this.parseFile(file).then((ast: Node) => {
  //     const obj = {
  //       ast,
  //     };
  //     //this.parseClassNode(ast, obj);
  //     return obj;
  //   });
  // }
}

export default Babylon;
