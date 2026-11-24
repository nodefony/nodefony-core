import { useState } from "react";

/** Témoin : un composant React à hook, qui DOIT recevoir la signature de rafraîchissement. */
export function Hooked() {
  const [value] = useState(0);
  return <p>{value}</p>;
}
