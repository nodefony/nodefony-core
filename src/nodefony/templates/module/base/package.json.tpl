{
  "name": "<%= it.pkgName %>",
  "version": "<%= it.version %>",
<% if (it.publishable) { %>  "type": "module",
  "description": "<%= it.description %>",
  "main": "./dist/index.js",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/types/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "docs"
  ],
  "scripts": {
    "build": "rolldown -c rolldown.config.ts && tsgo -p tsconfig.declarations.json",
    "typecheck": "tsgo --noEmit -p tsconfig.json && tsgo --noEmit -p tsconfig.tests.json",
    "test": "vitest run"
  },
<% } else { %>  "private": true,
  "type": "module",
  "description": "<%= it.description %>",
  "main": "dist/index.js",
  "scripts": {
    "build": "rolldown -c rolldown.config.ts",
    "typecheck": "tsgo --noEmit",
    "test": "vitest run"
  },
<% } %>  "peerDependencies": {
    "nodefony": "*",
    "@nodefony/framework": "*",
<% if (it.needsRealtime) { %>    "@nodefony/realtime": "*",
<% } %><% if (it.front) { %>    "@nodefony/frontend": "*",
<% } %><% if (it.publishable) { %>    "zod": "<%= it.pkg["zod"] %>",
<% } %>    "@nodefony/http": "*"
  },
<% if (it.publishable) { %>  "dependencies": {
    "tslib": "<%= it.pkg["tslib"] %>"
  }
<% } else { %>  "dependencies": {
    "zod": "<%= it.pkg["zod"] %>"
  }
<% } %>}
