(function(root){
  "use strict";

  const STORAGE_KEY="thefloew.baitbusterEnabled.v1";
  const AI_TOOLTIP="Bu haberin manşeti β BaitBuster ile değiştirildi. Orijinal metni görmek için tıklayın.";
  const ORIGINAL_TOOLTIP="Bu haberin manşeti β BaitBuster ile değiştirildi. Yapay zeka versiyonunu görmek için tıklayın.";

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

  function markerText(){
    return "Β";
  }

  function stopNavigationEvent(event){
    event?.preventDefault?.();
    event?.stopPropagation?.();
  }

  function loadEnabled(storage){
    try{
      const raw=storage?.getItem?.(STORAGE_KEY);
      return raw!=="0"&&raw!=="false";
    }catch{
      return true;
    }
  }

  function saveEnabled(storage,enabled){
    try{
      storage?.setItem?.(STORAGE_KEY,enabled?"1":"0");
    }catch{}
    return Boolean(enabled);
  }

  function settingLabel(enabled){
    return enabled?"Açık":"Kapalı";
  }

  root.BaitBusterUI={
    nextMode,
    headlineForMode,
    markerTitleForMode,
    markerText,
    stopNavigationEvent,
    loadEnabled,
    saveEnabled,
    settingLabel
  };
})(globalThis);
