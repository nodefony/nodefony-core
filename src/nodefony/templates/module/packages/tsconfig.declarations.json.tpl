{
  "extends": "./tsconfig.json",
  "include": ["index.ts", "nodefony/**/*.ts"],
  "exclude": [
    "node_modules",
    "dist",
    "tests/**",
    "**/*.test.ts",
    "**/*.spec.ts"
  ],
  "compilerOptions": {
    "declaration": true,
    "emitDeclarationOnly": true,
    "declarationDir": "./dist/types",
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "skipLibCheck": true
  }
}
