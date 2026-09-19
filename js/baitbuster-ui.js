(function(root){
  "use strict";

  const AI_TOOLTIP="Bu haberin manşeti Flöw yapay zekası ile değiştirildi. Orijinal metni görmek için tıklayın.";
  const ORIGINAL_TOOLTIP="Bu haberin manşeti Flöw yapay zekası ile değiştirildi. Yapay zeka versiyonunu görmek için tıklayın.";

  function nextMode(mode){
    return mode==="original"?"ai":"original";
  }

  function headlineForMode(state,mode){
    if(!state)return "";
    return mode==="original"
      ? String(state.originalTitle||"")
      : String(state.flowTitle||"");
  }

  function markerTitleForMode(mode){
    return mode==="original"?ORIGINAL_TOOLTIP:AI_TOOLTIP;
  }

  root.BaitBusterUI={
    nextMode,
    headlineForMode,
    markerTitleForMode
  };
})(globalThis);
