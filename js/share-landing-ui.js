/*
  Flöw Share Landing UI v1.0
  Sadece paylaşılan haber sayfasındaki mevcut aksiyon butonlarını
  işaretler; tıklama olaylarına, haber içeriğine, linklere ve
  Worker'ın paylaşım/QR/KV mantığına müdahale etmez.

  Share Worker HTML head bölümüne eklenecek tek satır:
  <script defer src="https://xn--flw-tna.tr/js/share-landing-ui.js?v=1"></script>
*/
(function () {
  "use strict";

  const root = document.documentElement;
  if (root.dataset.floewShareUi === "1") return;
  root.dataset.floewShareUi = "1";

  const scriptSource =
    document.currentScript && document.currentScript.src
      ? document.currentScript.src
      : "https://xn--flw-tna.tr/js/share-landing-ui.js";

  const cssUrl = new URL("../css/share-landing.css?v=1", scriptSource).href;

  if (!document.querySelector('link[data-floew-share-ui-css]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssUrl;
    link.dataset.floewShareUiCss = "1";
    document.head.appendChild(link);
  }

  function classify(control) {
    const classes = control.classList;
    const label = (
      (control.getAttribute("aria-label") || "") + " " +
      (control.getAttribute("title") || "")
    ).toLocaleLowerCase("tr");
    const text = (control.textContent || "").replace(/[\uFE0E\uFE0F]/g, "").trim();
    const textLower = text.toLocaleLowerCase("tr");

    if (
      classes.contains("share-link") ||
      classes.contains("share-button") ||
      /haberi paylaş|bağlantıyı paylaş|tekrar paylaş/.test(label) ||
      text === "⤴"
    ) return "share";

    if (
      classes.contains("feedback-inline-link") ||
      /geri bildirim/.test(label)
    ) return "feedback";

    if (
      classes.contains("source-viewer-close") ||
      classes.contains("close-button") ||
      classes.contains("share-close") ||
      /^(kapat|pencereyi kapat)$/.test(label.trim()) ||
      /^[×✕✖]$/.test(text)
    ) return "close";

    if (
      classes.contains("back-link") ||
      /^(geri|geri dön)$/.test(label.trim()) ||
      text === "↩"
    ) return "back";

    if (
      classes.contains("source-link") ||
      classes.contains("source-viewer-external") ||
      /kaynağa git|kaynağı gör|haberi kaynağında aç|kaynağı yeni sekmede aç/.test(label) ||
      /kaynağa git|kaynağı gör|haberi kaynağında aç/.test(textLower) ||
      text === "⎋"
    ) return "source";

    if (
      classes.contains("external-link") ||
      /dış bağlantı|yeni sekmede aç/.test(label) ||
      text === "↗"
    ) return "external";

    return "";
  }

  function iconOnly(control) {
    const text = (control.textContent || "")
      .replace(/[\uFE0E\uFE0F]/g, "")
      .replace(/\s+/g, "");

    if (!text) return true;
    if (/^[⤴⎋↗×✕✖✓✔↩⎘]+$/.test(text) && text.length <= 3) return true;

    /* Ekran okuyucu için metin + yalnızca SVG ikon. */
    const readable = control.querySelector(".sr-only,.visually-hidden");
    if (readable && control.querySelector("svg,img")) {
      const nonA11yText = text.replace(
        (readable.textContent || "").replace(/\s+/g, ""),
        ""
      );
      return nonA11yText === "";
    }

    return false;
  }

  function synchronize() {
    document.querySelectorAll("button,a,[role='button']").forEach((control) => {
      const kind = classify(control);
      if (!kind) return;

      if (control.dataset.floewShareControl !== kind) {
        control.dataset.floewShareControl = kind;
      }

      const value = iconOnly(control) ? "true" : "false";
      if (control.dataset.floewShareIconOnly !== value) {
        control.dataset.floewShareIconOnly = value;
      }

      if (value === "true" && !control.hasAttribute("aria-label")) {
        const names = {
          share:"Haberi paylaş",
          source:"Kaynağa git",
          external:"Kaynağı yeni sekmede aç",
          close:"Kapat",
          feedback:"Geri bildirim",
          back:"Geri dön"
        };
        control.setAttribute("aria-label", names[kind]);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", synchronize, { once:true });
  } else {
    synchronize();
  }

  if (typeof MutationObserver === "function") {
    const observer = new MutationObserver(synchronize);
    observer.observe(document.documentElement, {
      childList:true,
      subtree:true,
      characterData:true
    });
  }

  // One Share Worker script tag now installs both the shared icon styling
  // and the separate Flöra/share/source/feed behavioral parity layer.
  if (!document.querySelector('script[data-floew-share-parity]')) {
    const script = document.createElement("script");
    script.src = new URL("share-landing-parity.js?v=1", scriptSource).href;
    script.dataset.floewShareParity = "1";
    document.head.appendChild(script);
  }
})();