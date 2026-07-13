{
  "name": "<%= it.pkgName %>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "<%= it.description %>",
  "main": "dist/index.js",
  "scripts": {
    "build": "rolldown -c rolldown.config.ts",
    "typecheck": "tsgo --noEmit",
    "test": "vitest run"
  },
  "peerDependencies": {
    "nodefony": "*",
    "@nodefony/framework": "*",
    "@nodefony/http": "*"<% if (it.needsRealtime) { %>,
    "@nodefony/realtime": "*"<% } %><% if (it.front) { %>,
    "@nodefony/frontend": "*"<% } %>
  },
  "dependencies": {
    "zod": "<%= it.pkg["zod"] %>"
  }
}
