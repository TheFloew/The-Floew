/*
  News Wall frontend
  - 10 seconds per story
  - wheel / drag / arrow-key navigation
  - vertical slide transitions
  - no clickable UI
*/

const CONFIG = {
  // Replace this with your deployed Cloudflare Worker URL.
  API_URL: "https://thefloew.thefloewback.workers.dev/news",
  DISPLAY_MS: 10000,
  SWIPE_THRESHOLD: 70,
  POLL_MS: 120000
};

const slides = [
  document.getElementById("slide-a"),
  document.getElementById("slide-b")
];

const state = {
  stories: [],
  index: 0,
  activeSlide: 0,
  timer: null,
  isAnimating: false,
  startX: 0,
  startY: 0,
  startTime: 0,
  initialized: false
};

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dakika önce`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat önce`;

  return date.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function cleanStory(item) {
  return {
    title: String(item.title || "").trim(),
    source: String(item.source || "").trim(),
    image: String(item.image || "").trim(),
    link: String(item.link || "").trim(),
    published: item.published || ""
  };
}

function validStory(item) {
  return item.title && item.image;
}

function fillSlide(slide, story) {
  const img = slide.querySelector(".slide-image");
  const source = slide.querySelector(".source");
  const title = slide.querySelector("h1");
  const time = slide.querySelector(".time");

  img.src = story.image;
  img.alt = story.title;
  source.textContent = story.source;
  title.textContent = story.title;
  time.textContent = formatTime(story.published);
}

function resetTimer() {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => goTo(1), CONFIG.DISPLAY_MS);
}

function goTo(direction) {
  if (!state.stories.length || state.isAnimating) return;
  if (state.stories.length === 1) return;

  state.isAnimating = true;
  clearTimeout(state.timer);

  const nextIndex =
    (state.index + direction + state.stories.length) %
    state.stories.length;

  const current = slides[state.activeSlide];
  const next = slides[1 - state.activeSlide];

  fillSlide(next, state.stories[nextIndex]);

  current.classList.remove(
    "active", "enter-up", "exit-up", "enter-down", "exit-down"
  );
  next.classList.remove(
    "active", "enter-up", "exit-up", "enter-down", "exit-down"
  );

  // Force a style/layout read so a new animation always starts cleanly.
  void next.offsetWidth;

  if (direction > 0) {
    next.classList.add("enter-up");
    current.classList.add("exit-up");
  } else {
    next.classList.add("enter-down");
    current.classList.add("exit-down");
  }

  const finish = () => {
    next.classList.remove(
      "enter-up", "enter-down", "exit-up", "exit-down"
    );
    next.classList.add("active");
    current.classList.remove(
      "active", "enter-up", "enter-down", "exit-up", "exit-down"
    );

    state.activeSlide = 1 - state.activeSlide;
    state.index = nextIndex;
    state.isAnimating = false;
    resetTimer();
  };

  next.addEventListener("animationend", finish, { once: true });
}

function start() {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => goTo(1), CONFIG.DISPLAY_MS);
}

async function fetchStories() {
  if (CONFIG.API_URL.includes("YOUR-WORKER")) {
    showStatus(
      "Cloudflare Worker adresini app.js içindeki API_URL alanına ekleyin."
    );
    return;
  }

  try {
    const response = await fetch(CONFIG.API_URL, {
      cache: "no-store"
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const stories = Array.isArray(data)
      ? data.map(cleanStory).filter(validStory)
      : [];

    if (!stories.length) throw new Error("Görselli haber bulunamadı.");

    const previousLink = state.stories[state.index]?.link;

    state.stories = stories;

    if (!state.initialized) {
      state.index = 0;
      fillSlide(slides[0], state.stories[0]);
      slides[0].classList.add("active");
      state.initialized = true;
      hideStatus();
      start();
      return;
    }

    // Preserve the currently displayed story after a refresh if possible.
    if (previousLink) {
      const found = state.stories.findIndex(s => s.link === previousLink);
      if (found >= 0) state.index = found;
    }

    hideStatus();
  } catch (error) {
    console.error(error);
    if (!state.initialized) {
      showStatus("Haberler alınamadı. Worker adresini ve RSS kaynaklarını kontrol edin.");
    }
  }
}

function showStatus(message) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.hidden = false;
}

function hideStatus() {
  document.getElementById("status").hidden = true;
}

window.addEventListener("wheel", event => {
  event.preventDefault();
  if (Math.abs(event.deltaY) < 5) return;
  goTo(event.deltaY > 0 ? 1 : -1);
}, { passive: false });

window.addEventListener("keydown", event => {
  if (event.key === "ArrowDown" || event.key === "PageDown") {
    event.preventDefault();
    goTo(1);
  } else if (event.key === "ArrowUp" || event.key === "PageUp") {
    event.preventDefault();
    goTo(-1);
  }
});

window.addEventListener("pointerdown", event => {
  state.startX = event.clientX;
  state.startY = event.clientY;
  state.startTime = performance.now();
});

window.addEventListener("pointerup", event => {
  const dy = event.clientY - state.startY;
  const dx = event.clientX - state.startX;
  const elapsed = performance.now() - state.startTime;

  if (elapsed > 1000) return;
  if (Math.abs(dy) < CONFIG.SWIPE_THRESHOLD) return;
  if (Math.abs(dy) < Math.abs(dx)) return;

  goTo(dy < 0 ? 1 : -1);
});

fetchStories();
setInterval(fetchStories, CONFIG.POLL_MS);
