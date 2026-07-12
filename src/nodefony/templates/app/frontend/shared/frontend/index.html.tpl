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
    <!--nodefony:frontend-->
  </head>
  <body>
    <%= it.front.mountNode %>
  </body>
</html>
