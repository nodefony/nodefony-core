// index.ts
import  nodefony, {kernel} from './Nodefony'; // Importe l'instance partagée de Nodefony

// Utilisation du style ES6 pour les modules (import)
export default nodefony;
export { kernel, nodefony};

// Utilisation du style CommonJS (require)
//module.exports =  nodefony ;
