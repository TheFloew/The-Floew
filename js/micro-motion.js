/* Flöw micro motion: presentation only; no score/title/feed logic is replaced. */
(function(){
  "use strict";

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


})();
