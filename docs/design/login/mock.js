// Maquette seulement : simule le déroulé que portera NodefonyLogin.
// Paramètres d'URL : ?step=identifier|password|mfa|authenticated|error&theme=light|dark&embed=1
const params = new URLSearchParams(location.search);
const root = document.documentElement;
if (params.get("embed") === "1") root.classList.add("embed");
if (params.get("theme") === "light" || params.get("theme") === "dark")
  root.dataset.theme = params.get("theme");

const ORDER = ["identifier", "password", "mfa", "authenticated"];
const msg = document.querySelector("[data-message]");
const alt = document.querySelector("[data-alt]");
const sub = document.getElementById("nf-sub");
const subDefault = sub.textContent;
let altOff = false;
let timer = null;

function go(step) {
  clearInterval(timer);
  for (const s of ORDER)
    document.querySelector(`[data-step="${s}"]`).hidden = s !== step;
  alt.hidden = altOff || step === "mfa" || step === "authenticated";
  msg.replaceChildren();
  const at = ORDER.indexOf(step);
  for (const li of document.querySelectorAll("[data-tab]")) {
    const i = ORDER.indexOf(li.dataset.tab);
    if (i === at) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
    li.classList.toggle("done", i < at);
  }
  document.querySelector('[data-tab="mfa"]').hidden = at < 2;
  sub.textContent =
    step === "mfa" ? "Un second facteur protège ce compte" : subDefault;
  for (const b of document.querySelectorAll(".mock [data-go]"))
    b.setAttribute("aria-pressed", String(b.dataset.go === step));
  if (!root.classList.contains("embed"))
    document.querySelector(`[data-step="${step}"] input`)?.focus();
}

function showAlert(code, text) {
  clearInterval(timer);
  const p = document.createElement("p");
  p.className = "nf-alert";
  p.setAttribute("role", "alert");
  const c = document.createElement("span");
  c.className = "code";
  c.textContent = code;
  const t = document.createElement("span");
  t.textContent = text;
  p.append(c, t);
  msg.replaceChildren(p);
  return t;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("button, a");
  if (!b) return;
  if (b.matches("a[href='#']")) e.preventDefault();
  if (b.dataset.go) go(b.dataset.go);
  if (b.dataset.err === "401")
    showAlert("401", "Identifiant ou mot de passe incorrect.");
  if (b.dataset.err === "429") {
    let left = 28;
    const t = showAlert("429", `Trop d'essais. Réessayez dans ${left} s.`);
    timer = setInterval(() => {
      left -= 1;
      t.textContent =
        left > 0
          ? `Trop d'essais. Réessayez dans ${left} s.`
          : "Vous pouvez réessayer.";
      if (left <= 0) clearInterval(timer);
    }, 1000);
  }
  if ("altToggle" in b.dataset) {
    altOff = !altOff;
    alt.hidden = altOff;
  }
  if ("themeToggle" in b.dataset) {
    const dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
  }
  if ("reveal" in b.dataset) {
    const input = b.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    b.setAttribute("aria-pressed", String(show));
    b.setAttribute(
      "aria-label",
      show ? "Masquer le mot de passe" : "Afficher le mot de passe",
    );
  }
});

const otp = [...document.querySelectorAll(".nf-otp input")];
otp.forEach((input, i) => {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(-1);
    if (input.value && i < otp.length - 1) otp[i + 1].focus();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !input.value && i > 0) otp[i - 1].focus();
  });
  input.addEventListener("paste", (e) => {
    const digits = (e.clipboardData?.getData("text") ?? "")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (digits.length < 2) return;
    e.preventDefault();
    digits.split("").forEach((d, k) => {
      if (otp[k]) otp[k].value = d;
    });
    otp[Math.min(digits.length, 5)].focus();
  });
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  go(
    ORDER[Math.min(ORDER.indexOf(e.target.dataset.step) + 1, ORDER.length - 1)],
  );
});

const start = params.get("step");
if (start === "error") {
  go("password");
  showAlert("401", "Identifiant ou mot de passe incorrect.");
} else go(ORDER.includes(start) ? start : "identifier");
