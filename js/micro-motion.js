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

  // 2) Animate a VISUAL COPY of Flöra's score. The real score text stays
  // untouched, so sharing, aria labels, and other consumers keep the truth.
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
    if(!slide.classList.contains("active")){stopScore(slide);return;}
    var box=slide.querySelector(".flora-inline.has-score");
    var value=box&&box.querySelector(".flora-inline-value");
    var storyKey=box&&(box.dataset.floraStoryKey||slide.dataset.storyKey);
    if(!box||!value||!storyKey)return;
    if(lastStoryBySlide.get(slide)===storyKey)return;
    var target=Number((value.textContent||"").trim().replace(",","."));
    if(!Number.isFinite(target))return;
    lastStoryBySlide.set(slide,storyKey);
    if(motionOff()||target<=0)return;

    stopScore(slide);
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
      var progress=Math.min(1,(now-start)/560);
      var eased=1-Math.pow(1-progress,3);
      overlay.textContent=(target*eased).toFixed(1);
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
    var frame=0;
    new MutationObserver(function(){
      if(frame)return;
      frame=requestAnimationFrame(function(){frame=0;showScore(slide);});
    }).observe(slide,{attributes:true,attributeFilter:["class","data-story-key"]});
    showScore(slide);
  });

  // 3) After BaitBuster's own pointer/keyboard handler changes the heading,
  // briefly introduce the new title. No interception of its click logic.
  function animateBaitbusterToggle(event){
    if(event.type==="keydown"&&event.key!=="Enter"&&event.key!==" ")return;
    var marker=event.target&&event.target.closest
      ? event.target.closest(".baitbuster-rewrite-mark")
      : null;
    if(!marker)return;
    var slide=marker.closest(".slide");
    var heading=slide&&slide.querySelector("h1");
    if(!heading)return;
    var previous=heading.textContent;
    queueMicrotask(function(){
      if(motionOff()||!heading.isConnected||heading.textContent===previous)return;
      if(typeof heading.animate==="function"){
        heading.animate(
          [{opacity:.4,transform:"translateY(3px)"},
           {opacity:1,transform:"translateY(0)"}],
          {duration:190,easing:"ease-out"}
        );
      }
    });
  }
  document.addEventListener("pointerup",animateBaitbusterToggle,true);
  document.addEventListener("keydown",animateBaitbusterToggle,true);
})();
