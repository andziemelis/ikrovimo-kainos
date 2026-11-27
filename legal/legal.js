// Language (same choice as in the app) and the owner's details.
(function () {
  let lang = new URLSearchParams(location.search).get("lang");
  if (!lang) { try { lang = JSON.parse(localStorage.getItem("lang")); } catch {} }
  if (lang !== "en" && lang !== "lt") lang = (navigator.language || "").toLowerCase().startsWith("lt") ? "lt" : "en";
  const set = l => {
    document.documentElement.lang = l;
    document.querySelectorAll(".lang button").forEach(b => b.classList.toggle("on", b.dataset.set === l));
    const t = document.querySelector(`[data-l="${l}"] h1`); if (t) document.title = t.textContent + " – Įkrovimo kainos";
    try { localStorage.setItem("lang", JSON.stringify(l)); } catch {}
  };
  document.addEventListener("DOMContentLoaded", () => {
    const o = window.OWNER || {};
    document.querySelectorAll("[data-owner]").forEach(el => {
      const lt = document.documentElement.lang === "lt";
      if (o.name) el.textContent = o.name;
      else { el.textContent = el.closest('[data-l="en"]') ? "[name to be added]" : "[vardas bus nurodytas]"; el.classList.add("missing"); }
    });
    document.querySelectorAll("[data-email]").forEach(el => {
      if (o.email) { el.textContent = o.email; el.href = "mailto:" + o.email; }
      else { el.textContent = el.closest('[data-l="en"]') ? "[email to be added]" : "[el. paštas bus nurodytas]"; el.classList.add("missing"); el.removeAttribute("href"); }
    });
    document.querySelectorAll("[data-updated]").forEach(el => el.textContent = o.updated || "");
    document.querySelectorAll(".lang button").forEach(b => b.onclick = () => set(b.dataset.set));
    set(lang);
  });
})();
