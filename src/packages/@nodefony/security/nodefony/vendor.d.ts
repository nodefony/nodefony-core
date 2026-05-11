declare module "rollup-sourcemap-path-transform" {
  export function createPathTransform(options: {
    prefixes: Record<string, string>;
  }): (relativePath: string, sourceMapPath: string) => string;
}
