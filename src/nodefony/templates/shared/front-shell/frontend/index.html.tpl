<!DOCTYPE html>
<!--
  Coquille HTML de ton app — TA page, pas celle du framework : ajoute ici tes
  meta, polices, favicons, scripts externes. Le framework injecte ses balises
  (entry Vite + HMR en dev, bundle fingerprinté en prod, nonce CSP propagé)
  au marqueur ci-dessous — laisse-le en place.
-->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title><%= it.appName %></title>
    <!-- favicon inline (⬡) : remplace par ton fichier — évite le 404 /favicon.ico -->
    <link
      rel="icon"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ctext y='13' font-size='13'%3E%E2%AC%A1%3C/text%3E%3C/svg%3E"
    />
    <!--nodefony:frontend-->
  </head>
  <body>
    <%= it.front.mountNode %>
  </body>
</html>
