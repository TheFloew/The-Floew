/* Flöw micro motion: presentation only; no score/title/feed logic is replaced. */
(function(){
  "use strict";

  var reducedMotion=window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  function motionOff(){return !!(reducedMotion&&reducedMotion.matches);}

  // 1) A single indicator follows the actually selected tab, including
  // temporary category/source tabs and responsive changes in tab widths.
  var tabs=document.getElementById("feed-tabs");
  if(tabs){
    var indicator=document.createElement("span");
    indicator.className="flow-feed-indicator";
    indicator.setAttribute("aria-hidden","true");
    tabs.appendChild(indicator);
    var tabFrame=0;
    var watchedTabs=new Set();
    var tabResize=typeof ResizeObserver==="function"
      ? new ResizeObserver(scheduleTabIndicator)
      : null;

    function updateTabIndicator(){
      tabFrame=0;
      var active=tabs.querySelector(".feed-tab.active:not(.is-leaving)");
      if(!active){
        indicator.style.opacity="0";
        return;
      }
      var navRect=tabs.getBoundingClientRect();
      var activeRect=active.getBoundingClientRect();
      if(!navRect.width||!activeRect.width)return;
      indicator.style.setProperty("--flow-indicator-x",
        (activeRect.left-navRect.left)+"px");
      indicator.style.width=activeRect.width+"px";
      indicator.style.opacity="1";
      if(!indicator.classList.contains("is-ready")){
        requestAnimationFrame(function(){indicator.classList.add("is-ready");});
      }
    }
    function scheduleTabIndicator(){
      if(!tabFrame)tabFrame=requestAnimationFrame(updateTabIndicator);
    }
    function observeTabWidths(){
      if(!tabResize)return;
      var present=new Set(tabs.querySelectorAll(".feed-tab"));
      watchedTabs.forEach(function(node){
        if(!present.has(node)){tabResize.unobserve(node);watchedTabs.delete(node);}
      });
      present.forEach(function(node){
        if(!watchedTabs.has(node)){watchedTabs.add(node);tabResize.observe(node);}
      });
    }
    new MutationObserver(function(){
      observeTabWidths();
      scheduleTabIndicator();
    }).observe(tabs,{
      subtree:true,
      childList:true,
      attributes:true,
      attributeFilter:["class","aria-pressed"]
    });
    if(tabResize){tabResize.observe(tabs);observeTabWidths();}
    window.addEventListener("resize",scheduleTabIndicator,{passive:true});
    if(document.fonts&&document.fonts.ready){
      document.fonts.ready.then(scheduleTabIndicator).catch(function(){});
    }
    scheduleTabIndicator();
  }


  // 2) Count up a visual copy of the existing Flöra score. Preserve the
  // authoritative value, labels and click handler. Start only after the
  // initial loading veil has disappeared, and observe late score arrivals.
  var runningScores=new WeakMap();
  var lastStoryBySlide=new WeakMap();

  function stopScore(slide){
    var task=runningScores.get(slide);
    if(!task)return;
    cancelAnimationFrame(task.frame);
    task.overlay.remove();
    task.value.classList.remove("flow-flora-value-hidden");
    runningScores.delete(slide);
  }

  function showScore(slide){
    if(!slide.classList.contains("active")){
      stopScore(slide);
      lastStoryBySlide.delete(slide);
      return;
    }
    if(!window.__floewInitialReady&&document.getElementById("loading-screen")){
      return;
    }

    var box=slide.querySelector(".flora-inline.has-score");
    var value=box&&box.querySelector(".flora-inline-value");
    var key=box&&box.dataset.floraStoryKey;
    if(!box||!value||!key)return;

    var score=Number((value.textContent||"").trim().replace(",","."));
    if(!Number.isFinite(score))return;
    if(lastStoryBySlide.get(slide)===key)return;

    stopScore(slide);
    lastStoryBySlide.set(slide,key);
    if(motionOff()||score<=0)return;

    var style=getComputedStyle(value);
    var overlay=document.createElement("span");
    overlay.className="flow-flora-count";
    overlay.setAttribute("aria-hidden","true");
    overlay.style.left=value.offsetLeft+"px";
    overlay.style.top=value.offsetTop+"px";
    overlay.style.fontFamily=style.fontFamily;
    overlay.style.fontSize=style.fontSize;
    overlay.style.fontWeight=style.fontWeight;
    overlay.style.lineHeight=style.lineHeight;
    overlay.style.letterSpacing=style.letterSpacing;
    overlay.style.color=style.color;
    overlay.textContent="0.0";
    box.appendChild(overlay);
    value.classList.add("flow-flora-value-hidden");

    var task={overlay:overlay,value:value,frame:0};
    runningScores.set(slide,task);
    var start=null;
    function step(now){
      if(start===null)start=now;
      if(!slide.classList.contains("active")||!overlay.isConnected){
        stopScore(slide);
        return;
      }
      var progress=Math.min(1,(now-start)/800);
      var eased=1-Math.pow(1-progress,3);
      overlay.textContent=(score*eased).toFixed(1);
      if(progress<1){
        task.frame=requestAnimationFrame(step);
      }else{
        stopScore(slide);
      }
    }
    task.frame=requestAnimationFrame(step);
  }

  ["a","b"].forEach(function(id){
    var slide=document.getElementById(id);
    if(!slide)return;
    var box=slide.querySelector(".flora-inline");
    var value=box&&box.querySelector(".flora-inline-value");
    var pendingFrame=0;
    function scheduleScore(){
      if(!pendingFrame){
        pendingFrame=requestAnimationFrame(function(){
          pendingFrame=0;
          showScore(slide);
        });
      }
    }

    new MutationObserver(scheduleScore).observe(slide,{
      attributes:true,attributeFilter:["class","data-story-key"]
    });
    if(box){
      new MutationObserver(scheduleScore).observe(box,{
        attributes:true,attributeFilter:["class","data-flora-story-key"]
      });
    }
    if(value){
      new MutationObserver(scheduleScore).observe(value,{
        childList:true,characterData:true,subtree:true
      });
    }
    window.addEventListener("floew:ready",scheduleScore);
    scheduleScore();

    // 3) BaitBuster changes the H1 node's textContent synchronously inside
    // its own toggle handler. Watch that real change instead of guessing
    // event order. Guard against preload/automatic headline updates.
    var heading=slide.querySelector("h1");
    if(!heading)return;
    var previousTitle=heading.textContent;
    var lastHeadlineAnimation=null;
    new MutationObserver(function(){
      var nextTitle=heading.textContent;
      if(nextTitle===previousTitle)return;
      previousTitle=nextTitle;
      if(motionOff()||!slide.classList.contains("active"))return;
      if(!window.__floewInitialReady&&document.getElementById("loading-screen"))return;
      if(heading.dataset.baitbusterApplied!=="1")return;
      if(!slide.querySelector(".baitbuster-rewrite-mark"))return;
      if(typeof heading.animate!=="function")return;

      if(lastHeadlineAnimation)lastHeadlineAnimation.cancel();
      // H1 is inline for the β marker layout; opacity works on inline
      // text without changing width/wrapping, unlike transform/flip.
      lastHeadlineAnimation=heading.animate(
        [{opacity:.18,filter:"blur(1.5px)"},
         {opacity:1,filter:"blur(0px)"}],
        {duration:300,easing:"cubic-bezier(.16,1,.3,1)"}
      );
    }).observe(heading,{
      childList:true,characterData:true,subtree:true
    });
  });
})();
