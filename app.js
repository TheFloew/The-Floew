const API_URL =
  "https://thefloew.thefloewback.workers.dev/news";

const DISPLAY_TIME = 10000;
const REFRESH_TIME = 120000;
const SWIPE_DISTANCE = 70;

const slides = [
  document.getElementById("slide-a"),
  document.getElementById("slide-b")
];

const newsWall = document.getElementById("news-wall");

const state = {
  stories: [],
  index: 0,
  activeSlide: 0,

  timer: null,
  animating: false,

  pointerStartX: 0,
  pointerStartY: 0,
  pointerStartTime: 0,

  moved: false
};


/*
   DURUM / HATA
*/

function showStatus(message) {
  const status = document.getElementById("status");

  status.textContent = message;
  status.hidden = false;
}


function hideStatus() {
  const status = document.getElementById("status");

  status.hidden = true;
}


/*
   TARİH
*/

function formatTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const difference =
    Math.max(0, Date.now() - date.getTime());

  const minutes =
    Math.floor(difference / 60000);

  if (minutes < 1) {
    return "az önce";
  }

  if (minutes < 60) {
    return `${minutes} dakika önce`;
  }

  const hours =
    Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} saat önce`;
  }

  return date.toLocaleDateString(
    "tr-TR",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  );
}


/*
   HABERİ SLIDE'A YERLEŞTİR
*/

function fillSlide(slide, story) {
  const image =
    slide.querySelector(".slide-image");

  const source =
    slide.querySelector(".source");

  const title =
    slide.querySelector("h1");

  const time =
    slide.querySelector(".time");

  image.src = story.image;
  image.alt = story.title || "";

  source.textContent =
    story.source || "";

  title.textContent =
    story.title || "";

  time.textContent =
    formatTime(story.published);
}


/*
   OTOMATİK SAYACI
*/

function restartTimer() {
  clearTimeout(state.timer);

  state.timer =
    setTimeout(
      () => {
        move(1);
      },
      DISPLAY_TIME
    );
}


/*
   HABER DEĞİŞTİR
*/

function move(direction) {
  if (state.animating) {
    return;
  }

  if (state.stories.length < 2) {
    return;
  }

  state.animating = true;

  clearTimeout(state.timer);

  const nextIndex =
    (
      state.index +
      direction +
      state.stories.length
    ) %
    state.stories.length;

  const currentSlide =
    slides[state.activeSlide];

  const nextSlide =
    slides[1 - state.activeSlide];

  fillSlide(
    nextSlide,
    state.stories[nextIndex]
  );

  currentSlide.className = "slide";
  nextSlide.className = "slide";

  void nextSlide.offsetWidth;

  if (direction > 0) {
    nextSlide.classList.add("enter-up");
    currentSlide.classList.add("exit-up");
  } else {
    nextSlide.classList.add("enter-down");
    currentSlide.classList.add("exit-down");
  }

  nextSlide.addEventListener(
    "animationend",
    () => {
      nextSlide.className = "slide active";
      currentSlide.className = "slide";

      state.activeSlide =
        1 - state.activeSlide;

      state.index =
        nextIndex;

      state.animating =
        false;

      restartTimer();
    },
    {
      once: true
    }
  );
}


/*
   HABERLERİ WORKER'DAN AL
*/

async function loadNews() {
  try {
    const response =
      await fetch(
        API_URL,
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        `Worker HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    const stories =
      Array.isArray(data)
        ? data.filter(
            story =>
              story &&
              story.title &&
              story.image
          )
        : [];

    if (!stories.length) {
      throw new Error(
        "Worker görselli haber döndürmedi."
      );
    }

    /*
       İlk yükleme
    */

    if (!state.stories.length) {
      state.stories = stories;
      state.index = 0;

      fillSlide(
        slides[0],
        state.stories[0]
      );

      slides[0].className =
        "slide active";

      hideStatus();
      restartTimer();

      return;
    }

    /*
       Mevcut haberi mümkünse koru.
    */

    const currentLink =
      state.stories[state.index]?.link;

    state.stories =
      stories;

    if (currentLink) {
      const sameStory =
        state.stories.findIndex(
          story =>
            story.link === currentLink
        );

      if (sameStory >= 0) {
        state.index =
          sameStory;
      }
    }

    hideStatus();

  } catch (error) {
    console.error(
      "NEWS WALL ERROR:",
      error
    );

    if (!state.stories.length) {
      showStatus(
        "Haberler alınamadı. " +
        "Cloudflare Worker bağlantısını kontrol edin."
      );
    }
  }
}


/*
   MOUSE TEKERLEĞİ
*/

window.addEventListener(
  "wheel",
  event => {
    event.preventDefault();

    if (Math.abs(event.deltaY) < 5) {
      return;
    }

    move(
      event.deltaY > 0
        ? 1
        : -1
    );
  },
  {
    passive: false
  }
);


/*
   KLAVYE
*/

window.addEventListener(
  "keydown",
  event => {
    if (
      event.key === "ArrowDown" ||
      event.key === "PageDown"
    ) {
      event.preventDefault();
      move(1);
      return;
    }

    if (
      event.key === "ArrowUp" ||
      event.key === "PageUp"
    ) {
      event.preventDefault();
      move(-1);
    }
  }
);


/*
   MOUSE / TOUCH BAŞLANGICI
*/

window.addEventListener(
  "pointerdown",
  event => {
    if (event.button !== 0) {
      return;
    }

    state.pointerStartX =
      event.clientX;

    state.pointerStartY =
      event.clientY;

    state.pointerStartTime =
      performance.now();

    state.moved = false;
  }
);


/*
   MOUSE / TOUCH BIRAKMA
*/

window.addEventListener(
  "pointerup",
  event => {
    if (event.button !== 0) {
      return;
    }

    const deltaY =
      event.clientY -
      state.pointerStartY;

    const deltaX =
      event.clientX -
      state.pointerStartX;

    const duration =
      performance.now() -
      state.pointerStartTime;

    /*
       Sürükleme
    */

    if (
      Math.abs(deltaY) >= SWIPE_DISTANCE &&
      Math.abs(deltaY) >= Math.abs(deltaX) &&
      duration <= 1000
    ) {
      state.moved = true;

      move(
        deltaY < 0
          ? 1
          : -1
      );

      return;
    }

    /*
       Normal tıklama:
       Sayfanın HER YERİ sonraki habere geçer.

       Logo da pointer-events:none olduğu için
       tıklama olayını engellemez.
    */

    if (
      !state.moved &&
      duration <= 1000 &&
      Math.abs(deltaX) < 10 &&
      Math.abs(deltaY) < 10
    ) {
      move(1);
    }

    state.moved = false;
  }
);


/*
   TARAYICININ GÖRSELİ SÜRÜKLEMESİNİ
   EK GÜVENLİK OLARAK ENGELLE
*/

window.addEventListener(
  "dragstart",
  event => {
    event.preventDefault();
  }
);


/*
   İLK YÜKLEME
*/

loadNews();


/*
   HABER LİSTESİNİ 2 DAKİKADA BİR YENİLE
*/

setInterval(
  loadNews,
  REFRESH_TIME
);
