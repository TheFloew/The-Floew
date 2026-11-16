(() => {
  "use strict";

  const state = {
    admin: false,
    ads: [],
    categories: [],
    today: "",
    editing: null,
    busy: false
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const feed = $("#feed");
  const empty = $("#empty");
  const loginModal = $("#login-modal");
  const editorModal = $("#editor-modal");
  const editorForm = $("#editor-form");
  const fileInput = $("#ad-file");

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof File) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
      cache: "no-store"
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || "İstek tamamlanamadı.");
    return data;
  }

  function showModal(modal) {
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function hideModal(modal) {
    modal.classList.add("hidden");
    if (loginModal.classList.contains("hidden") && editorModal.classList.contains("hidden")) {
      document.body.style.overflow = "";
    }
  }

  function toast(message) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.add("hidden"), 3000);
  }

  function dateLabel(value) {
    if (!value) return "";
    const parts = value.split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return value;
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("tr-TR", {
      day: "numeric", month: "long", year: "numeric"
    });
  }

  function statusFor(ad) {
    if (ad.end_date < state.today) return { label: "Süresi doldu", className: "expired" };
    if (!ad.active) return { label: "Pasif", className: "off" };
    if (ad.start_date > state.today) return { label: "Planlandı", className: "scheduled" };
    if (ad.live) return { label: "Yayında", className: "live" };
    return { label: "Beklemede", className: "" };
  }

  function render() {
    const ads = state.ads;
    $("#admin-note").classList.toggle("hidden", !state.admin);
    $("#login-open").classList.toggle("hidden", state.admin);
    $("#add-open").classList.toggle("hidden", !state.admin);
    $("#logout").classList.toggle("hidden", !state.admin);

    if (!ads.length) {
      feed.innerHTML = "";
      feed.classList.add("hidden");
      empty.classList.remove("hidden");
      return;
    }

    feed.classList.remove("hidden");
    empty.classList.add("hidden");
    feed.innerHTML = ads.map((ad) => {
      const status = statusFor(ad);
      const cardClass = !ad.active ? "is-inactive" : (status.className === "scheduled" ? "is-scheduled" : "");
      const mediaUrl = "/media/" + encodeURIComponent(ad.media_key);
      const media = ad.media_type === "video"
        ? '<video controls playsinline preload="metadata" src="' + escapeHTML(mediaUrl) + '"></video>'
        : '<img loading="lazy" src="' + escapeHTML(mediaUrl) + '" alt="' + escapeHTML(ad.title) + '">';
      const adminTools = state.admin
        ? '<div class="card-admin">' +
            '<label class="active-control"><input type="checkbox" data-action="toggle" data-id="' + escapeHTML(ad.id) + '"' + (ad.active ? " checked" : "") + '> Aktif</label>' +
            '<div class="admin-card-actions">' +
              '<span class="status-pill ' + status.className + '">' + status.label + '</span>' +
              '<button class="mini-button" type="button" data-action="edit" data-id="' + escapeHTML(ad.id) + '">Düzenle</button>' +
              '<button class="mini-button delete" type="button" data-action="delete" data-id="' + escapeHTML(ad.id) + '">Sil</button>' +
            '</div>' +
          '</div>'
        : "";
      return '<article class="ad-card ' + cardClass + '" id="' + escapeHTML(ad.id) + '">' +
        adminTools +
        '<div class="card-media">' + media + '</div>' +
        '<div class="card-body">' +
          '<div class="card-meta"><span class="category">' + escapeHTML(ad.category) + '</span><span>' + dateLabel(ad.start_date) + '</span></div>' +
          '<h2>' + escapeHTML(ad.title) + '</h2>' +
          (state.admin ? '<p class="card-dates">' + dateLabel(ad.start_date) + ' – ' + dateLabel(ad.end_date) + '</p>' : '') +
        '</div>' +
      '</article>';
    }).join("");
  }

  async function loadAds() {
    const data = await api("/api/ads");
    state.ads = data.ads || [];
    state.admin = Boolean(data.admin);
    state.today = data.today || new Date().toISOString().slice(0, 10);
    render();
  }

  async function boot() {
    try {
      const [session, categories] = await Promise.all([
        api("/api/session"),
        api("/api/categories")
      ]);
      state.admin = Boolean(session.authenticated);
      state.categories = categories.categories || [];
      $("#ad-category").innerHTML = '<option value="">Kategori seç</option>' +
        state.categories.map((category) => '<option value="' + escapeHTML(category) + '">' + escapeHTML(category) + '</option>').join("");
      await loadAds();
    } catch (error) {
      feed.innerHTML = '<div class="empty-state"><h2>Bağlantı kurulamadı</h2><p>' + escapeHTML(error.message) + '</p></div>';
    }
  }

  function openEditor(ad = null) {
    state.editing = ad;
    editorForm.reset();
    $("#editor-id").value = ad ? ad.id : "";
    $("#editor-title").textContent = ad ? "Reklamı düzenle" : "Yeni reklam ekle";
    $("#save-ad").textContent = ad ? "Değişiklikleri kaydet" : "Reklamı kaydet";
    $("#ad-title").value = ad ? ad.title : "";
    $("#ad-category").value = ad ? ad.category : "";
    const today = state.today || new Date().toISOString().slice(0, 10);
    const later = new Date(today + "T12:00:00");
    later.setDate(later.getDate() + 30);
    $("#ad-start").value = ad ? ad.start_date : today;
    $("#ad-end").value = ad ? ad.end_date : later.toISOString().slice(0, 10);
    fileInput.required = !ad;
    $("#file-hint").textContent = ad
      ? "Yeni dosya seçmezsen mevcut medya korunur. Dosya sınırı 10 MB."
      : "JPG, PNG, WebP, GIF, AVIF, MP4 veya WebM · En fazla 10 MB";
    $("#current-media").textContent = ad ? "Mevcut dosya: " + ad.media_name : "";
    $("#current-media").classList.toggle("hidden", !ad);
    $("#editor-error").classList.add("hidden");
    showModal(editorModal);
  }

  async function saveAd(event) {
    event.preventDefault();
    if (state.busy) return;

    const title = $("#ad-title").value.trim();
    const category = $("#ad-category").value;
    const startDate = $("#ad-start").value;
    const endDate = $("#ad-end").value;
    const file = fileInput.files[0];
    const existing = state.editing;

    if (!title || !category || !startDate || !endDate || startDate > endDate) {
      return showEditorError("Başlık, kategori ve yayın tarihlerini kontrol et.");
    }
    if (!file && !existing) return showEditorError("Bir görsel veya video seçmelisin.");
    if (file && file.size > 10 * 1024 * 1024) return showEditorError("Dosya 10 MB sınırını aşıyor.");
    if (file && !["image/jpeg","image/png","image/webp","image/gif","image/avif","video/mp4","video/webm","video/quicktime"].includes(file.type)) {
      return showEditorError("Bu dosya formatı desteklenmiyor.");
    }

    state.busy = true;
    const saveButton = $("#save-ad");
    saveButton.disabled = true;
    saveButton.textContent = file ? "Dosya yükleniyor…" : "Kaydediliyor…";

    try {
      let media = existing ? {
        mediaKey: existing.media_key,
        mediaName: existing.media_name,
        mediaType: existing.media_type,
        mediaContentType: existing.media_content_type,
        mediaSize: existing.media_size
      } : null;

      if (file) {
        const uploaded = await api("/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": file.type,
            "X-File-Name": encodeURIComponent(file.name)
          },
          body: file
        });
        media = {
          mediaKey: uploaded.mediaKey,
          mediaName: uploaded.mediaName,
          mediaType: uploaded.mediaType,
          mediaContentType: uploaded.mediaContentType,
          mediaSize: uploaded.mediaSize
        };
      }

      const payload = {
        title, category, startDate, endDate,
        mediaKey: media.mediaKey,
        mediaName: media.mediaName,
        mediaType: media.mediaType,
        mediaContentType: media.mediaContentType,
        mediaSize: media.mediaSize
      };
      if (existing) {
        await api("/api/ads/" + encodeURIComponent(existing.id), {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
      } else {
        await api("/api/ads", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }

      hideModal(editorModal);
      await loadAds();
      toast(existing ? "Reklam güncellendi." : "Reklam eklendi.");
    } catch (error) {
      showEditorError(error.message);
    } finally {
      state.busy = false;
      saveButton.disabled = false;
      saveButton.textContent = existing ? "Değişiklikleri kaydet" : "Reklamı kaydet";
    }
  }

  function showEditorError(message) {
    const node = $("#editor-error");
    node.textContent = message;
    node.classList.remove("hidden");
  }

  async function login(event) {
    event.preventDefault();
    const button = event.submitter || $("#login-form button[type=submit]");
    button.disabled = true;
    $("#login-error").classList.add("hidden");
    try {
      await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ password: $("#login-password").value })
      });
      hideModal(loginModal);
      $("#login-password").value = "";
      await loadAds();
      toast("Yönetici girişi yapıldı.");
    } catch (error) {
      $("#login-error").textContent = error.message;
      $("#login-error").classList.remove("hidden");
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    try {
      await api("/api/logout", { method: "POST" });
      state.admin = false;
      await loadAds();
      toast("Oturum kapatıldı.");
    } catch (error) {
      toast(error.message);
    }
  }

  async function handleFeedClick(event) {
    const control = event.target.closest("[data-action]");
    if (!control || !state.admin) return;
    const id = control.dataset.id;
    const ad = state.ads.find((item) => item.id === id);
    if (!ad) return;

    if (control.dataset.action === "edit") {
      openEditor(ad);
    } else if (control.dataset.action === "delete") {
      if (!confirm('"' + ad.title + '" reklamını silmek istiyor musun?')) return;
      try {
        await api("/api/ads/" + encodeURIComponent(id), { method: "DELETE" });
        await loadAds();
        toast("Reklam silindi.");
      } catch (error) {
        toast(error.message);
      }
    } else if (control.dataset.action === "toggle") {
      control.disabled = true;
      try {
        await api("/api/ads/" + encodeURIComponent(id), {
          method: "PATCH",
          body: JSON.stringify({ active: control.checked })
        });
        await loadAds();
        toast(control.checked ? "Reklam etkinleştirildi." : "Reklam yayından kaldırıldı.");
      } catch (error) {
        control.checked = !control.checked;
        toast(error.message);
      } finally {
        control.disabled = false;
      }
    }
  }

  $("#login-open").addEventListener("click", () => showModal(loginModal));
  $("#add-open").addEventListener("click", () => openEditor());
  $("#logout").addEventListener("click", logout);
  $("#login-form").addEventListener("submit", login);
  editorForm.addEventListener("submit", saveAd);
  feed.addEventListener("click", handleFeedClick);

  document.addEventListener("click", (event) => {
    const close = event.target.closest("[data-close]");
    if (!close) return;
    if (close.dataset.close === "login") hideModal(loginModal);
    if (close.dataset.close === "editor") hideModal(editorModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    hideModal(loginModal);
    hideModal(editorModal);
  });

  boot();
})();
