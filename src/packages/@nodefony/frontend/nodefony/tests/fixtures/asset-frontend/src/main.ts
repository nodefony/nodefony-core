// Fixture #526 : une image IMPORTÉE et une image référencée en CSS — les deux
// URLs que Vite fabrique relatives au document.
import pixel from "./pixel.png";
import "./style.css";

const img = document.createElement("img");
img.src = pixel;
document.body.append(img);
