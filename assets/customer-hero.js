(() => {
  const hero = document.querySelector("[data-salo-hero]");
  if (!hero) return;

  const intentButtons = [...hero.querySelectorAll("[data-hero-intent]")];
  const accessibleCopy = {
    de: { intent: "Art der Suche", search: "Salon, Service oder Ort suchen" },
    en: { intent: "Discovery intent", search: "Search for a salon, service, or location" },
    ar: { intent: "نوع البحث", search: "ابحث عن صالون أو خدمة أو موقع" },
  };

  function syncAccessibleCopy() {
    const language = document.documentElement.lang;
    const copy = accessibleCopy[language] || accessibleCopy.de;
    hero.querySelector(".salo-hero-intents")?.setAttribute("aria-label", copy.intent);
    hero.querySelector("#heroSearchInput")?.setAttribute("aria-label", copy.search);
  }

  function selectIntent(selectedButton) {
    intentButtons.forEach(button => {
      button.setAttribute("aria-pressed", String(button === selectedButton));
    });
  }

  intentButtons.forEach(button => {
    button.addEventListener("click", () => {
      selectIntent(button);
      const intent = button.dataset.heroIntent || "";
      window.dispatchEvent(new CustomEvent("salo:hero-intent", { detail: { intent } }));
      const targetSelector = button.dataset.heroTarget;
      if (!targetSelector) {
        if (intent === "now") {
          document.querySelector("#salonDirectory")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return;
      }
      document.querySelector(targetSelector)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  syncAccessibleCopy();
  new MutationObserver(syncAccessibleCopy).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
})();