(() => {
  document.addEventListener("error", event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.closest(".salon-card-media, #womenGrid .card-cover")) return;
    if (image.dataset.saloPlaceholder === "true") return;
    image.dataset.saloPlaceholder = "true";
    image.src = "./assets/salo-salon-placeholder.svg";
  }, true);
})();
