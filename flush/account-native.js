/* Flüsh account settings. No credentials are saved in browser storage. */
(()=>{
 "use strict";
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 function mountSelf(host,api,user,onUpdated){
  const recovery=Boolean(user.isRecovery),isSuper=user.role==="superadmin";
  host.innerHTML=[
   '<div class="account-heading"><div class="fn-eyebrow">FLÜSH / HESAP</div><h2>Hesabım</h2><p>Kullanıcı adını ve parolanı güvenle yönet.</p></div>',
   '<div class="account-self-cards">',
   '<section class="user-box"><h2>Hesap bilgileri</h2><p>Bu hesap: <b>',esc(user.username),'</b> · ',esc(isSuper?"Superadmin":"Kullanıcı"),recovery?' · Korumalı yedek yönetici':'','</p>',
   '<form id="accountNameForm"><label class="field">Yeni kullanıcı adı<input id="accountNewUsername" type="text" autocomplete="username" minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]{3,40}" value="',esc(user.username),'" required spellcheck="false"></label>',
   '<label class="field">Mevcut parolan<input id="accountNamePassword" type="password" autocomplete="current-password" required></label>',
   '<p class="account-hint">Ad değiştirildiğinde diğer açık Flüsh oturumların kapatılır. Bu oturum açık kalır.</p>',
   '<button class="primary-btn" id="accountSaveName" type="submit">Kullanıcı adını güncelle</button>',
   '<p class="user-msg" role="status" id="accountNameStatus"></p></form></section>',
   '<section class="user-box"><h2>Parola değiştir</h2><p>En az 12 karakterli, yalnızca bu hesapta kullandığın bir parola seç.</p>',
   '<form id="accountPasswordForm"><label class="field">Mevcut parolan<input id="accountCurrentPassword" type="password" autocomplete="current-password" required></label>',
   '<label class="field">Yeni parola<input id="accountNewPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>',
   '<label class="field">Yeni parola tekrar<input id="accountConfirmPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>',
   '<p class="account-hint">Parola güncellenince diğer oturumların kapatılır. Hiçbir parola bu sayfada sonradan görüntülenemez.</p>',
   '<button class="primary-btn" id="accountSavePassword" type="submit">Parolayı değiştir</button>',
   '<p class="user-msg" role="status" id="accountPasswordStatus"></p></form></section></div>'
  ].join("");
  const el=id=>host.querySelector("#"+id);
  el("accountNameForm").addEventListener("submit",async event=>{
   event.preventDefault();
   const btn=el("accountSaveName"),msg=el("accountNameStatus");
   msg.textContent="";btn.disabled=true;
   try{
    const newUsername=el("accountNewUsername").value.trim().toLowerCase();
    if(newUsername===user.username)throw Error("Kullanıcı adı değişmedi.");
    const result=await api("/api/me/username",{method:"PATCH",body:JSON.stringify({newUsername,currentPassword:el("accountNamePassword").value})});
    el("accountNamePassword").value="";
    user=result.user;
    onUpdated(result.user);
    msg.textContent="Kullanıcı adı güncellendi. Sonraki girişlerinde yeni adı kullan.";
    host.querySelector(".user-box p b").textContent=result.user.username;
   }catch(error){el("accountNamePassword").value="";msg.textContent=error.message}
   finally{btn.disabled=false}
  });
  el("accountPasswordForm").addEventListener("submit",async event=>{
   event.preventDefault();
   const btn=el("accountSavePassword"),msg=el("accountPasswordStatus");
   const old=el("accountCurrentPassword"),fresh=el("accountNewPassword"),confirm=el("accountConfirmPassword");
   msg.textContent="";
   if(fresh.value!==confirm.value){msg.textContent="Yeni parolalar eşleşmiyor.";return}
   if(fresh.value===old.value){msg.textContent="Yeni parola eskisinden farklı olmalı.";return}
   btn.disabled=true;
   try{
    await api("/api/password",{method:"POST",body:JSON.stringify({currentPassword:old.value,newPassword:fresh.value})});
    old.value="";fresh.value="";confirm.value="";
    msg.textContent="Parola güncellendi. Diğer oturumların kapatıldı.";
   }catch(error){msg.textContent=error.message}
   finally{btn.disabled=false}
  });
 }
 function mountAdmin(list,api,onSaved){
  const cards=[...list.querySelectorAll(".user-item")].filter(x=>x.querySelector(".manage-login"));
  for(const card of cards){
   const toggle=card.querySelector(".manage-login"),id=card.dataset.id;
   const currentName=card.querySelector(".user-head strong")?.textContent||"";
   const space=document.createElement("div");
   space.className="account-manage-wrap";
   space.hidden=true;
   const slug=Math.random().toString(36).slice(2); // display-only field ID suffix, not a credential
   space.innerHTML=[
    '<div class="account-manager-grid">',
    '<form class="account-manager-form account-rename-form"><h3>Kullanıcı adını değiştir</h3>',
    '<label class="field">Yeni kullanıcı adı<input name="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]{3,40}" autocomplete="off" value="',esc(currentName),'"></label>',
    '<label class="field">Senin yönetici parolan<input name="adminPassword" type="password" autocomplete="current-password" required></label>',
    '<button class="outline-link" type="submit">Kullanıcı adını kaydet</button>',
    '<p class="user-msg" role="status"></p></form>',
    '<form class="account-manager-form account-reset-form"><h3>Geçici parola belirle</h3>',
    '<label class="field">Yeni geçici parola<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>',
    '<label class="field">Geçici parola tekrar<input name="confirm" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>',
    '<label class="field">Senin yönetici parolan<input name="adminPassword" type="password" autocomplete="current-password" required></label>',
    '<button class="outline-link" type="submit">Parolayı sıfırla</button>',
    '<p class="user-msg" role="status"></p></form>',
    '</div><p class="account-hint">Bu değişiklikler kullanıcının oturumlarını kapatır. Geçici parola ilk girişte değiştirilir.</p>'
   ].join("");
   card.appendChild(space);
   toggle.setAttribute("aria-expanded","false");
   toggle.addEventListener("click",()=>{
    space.hidden=!space.hidden;
    toggle.setAttribute("aria-expanded",String(!space.hidden));
    toggle.textContent=space.hidden?"Giriş bilgilerini yönet":"Giriş bilgilerini kapat";
   });
   const rename=space.querySelector(".account-rename-form");
   rename.addEventListener("submit",async event=>{
    event.preventDefault();
    const msg=rename.querySelector(".user-msg"),btn=rename.querySelector("button");
    msg.textContent="";btn.disabled=true;
    const input=rename.elements.namedItem("username"),admin=rename.elements.namedItem("adminPassword");
    try{
     const username=String(input.value||"").trim().toLowerCase();
     if(username===currentName)throw Error("Kullanıcı adı değişmedi.");
     if(!window.confirm("Kullanıcı adı değişsin ve kullanıcının diğer oturumları kapatılsın mı?"))return;
     await api("/api/users/"+encodeURIComponent(id)+"/username",{method:"PATCH",body:JSON.stringify({username,adminPassword:admin.value})});
     admin.value="";
     msg.textContent="Kullanıcı adı güncellendi. Yeni adla giriş yapılacak.";
     card.querySelector(".user-head strong").textContent=username;
     input.defaultValue=username;
    }catch(error){msg.textContent=error.message}
    finally{admin.value="";btn.disabled=false}
   });
   const reset=space.querySelector(".account-reset-form");
   reset.addEventListener("submit",async event=>{
    event.preventDefault();
    const msg=reset.querySelector(".user-msg"),btn=reset.querySelector("button");
    const password=reset.elements.namedItem("password"),confirm=reset.elements.namedItem("confirm"),admin=reset.elements.namedItem("adminPassword");
    msg.textContent="";
    if(password.value!==confirm.value){msg.textContent="Geçici parolalar eşleşmiyor.";return}
    if(!window.confirm("Kullanıcının parolası sıfırlansın ve tüm oturumları kapatılsın mı?"))return;
    btn.disabled=true;
    try{
     await api("/api/users/"+encodeURIComponent(id)+"/password",{method:"POST",body:JSON.stringify({password:password.value,adminPassword:admin.value})});
     msg.textContent="Geçici parola kaydedildi. Kullanıcının oturumları kapatıldı.";
     password.value="";confirm.value="";
    }catch(error){msg.textContent=error.message}
    finally{admin.value="";btn.disabled=false}
   });
  }
 }
 window.FlushAccountNative={mountSelf,mountAdmin};
})();
