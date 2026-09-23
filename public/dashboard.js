/* ===== template ===== */
const TEMPLATE=[
  {line:"SMT",    color:"var(--c-smt)",  subs:[{sub:"Line 1",procs:["Bottom","TOP"]},{sub:"Line 2",procs:["Bottom","TOP"]}]},
  {line:"DIP/MI", color:"var(--c-dip)",  subs:[{sub:"Line 1",procs:["N/A"]},{sub:"Line 2",procs:["N/A"]}]},
  {line:"FATP",   color:"var(--c-fatp)", subs:[{sub:"Line 1",procs:["Assembly","Testing","Burn-in","Packaging"]},
                        {sub:"Line 2",procs:["Assembly","Testing","Burn-in","Packaging"]}]}
];
const SHIFTS=[
  {id:"A",name:"Shift A",hours:"06:00 – 14:00",color:"var(--c-shiftA)"},
  {id:"B",name:"Shift B",hours:"14:00 – 22:00",color:"var(--c-shiftB)"},
  {id:"C",name:"Shift C",hours:"22:00 – 06:00",color:"var(--c-shiftC)"}
];
const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
const rowKey=(l,s,p)=>l+"|"+s+"|"+p, subKey=(l,s)=>l+"|"+s;
const FLAT=[]; TEMPLATE.forEach(g=>g.subs.forEach(s=>s.procs.forEach(p=>FLAT.push({line:g.line,sub:s.sub,proc:p,key:rowKey(g.line,s.sub,p)}))));

/* ===== storage ===== */
const API="/api", LS="ehoome_mis_v2";
function lsAll(){try{return JSON.parse(localStorage.getItem(LS)||"{}")}catch(e){return {}}}
function lsPut(d,v){try{const a=lsAll();a[d]=v;localStorage.setItem(LS,JSON.stringify(a))}catch(e){}}
function lsDel(d){try{const a=lsAll();delete a[d];localStorage.setItem(LS,JSON.stringify(a))}catch(e){}}
async function apiRequest(path,options){
  let response;
  try{ response=await fetch(API+path,Object.assign({headers:{"Content-Type":"application/json"}},options||{})); }
  catch(e){ setDatabaseStatus(false); throw new Error("Cannot reach the MIS server"); }
  setDatabaseStatus(true);
  if(!response.ok){
    let detail=""; try{ detail=(await response.json()).error||""; }catch(e){}
    throw new Error(detail||("Database request failed ("+response.status+")"));
  }
  return response.status===204?null:response.json();
}
function setDatabaseStatus(online){
  const badge=document.getElementById("dbStatus"), label=document.getElementById("dbStatusText");
  if(!badge||!label) return;
  badge.classList.toggle("offline",!online);
  label.textContent=online?"Database online":"Database offline";
}
async function checkDatabaseHealth(){
  try{ await apiRequest("/health"); }catch(e){ setDatabaseStatus(false); }
}
async function saveDay(d,p){
  await apiRequest("/entries/"+encodeURIComponent(d),{method:"PUT",body:JSON.stringify(p)});
  lsPut(d,p);
}
async function deleteDay(d){
  await apiRequest("/entries/"+encodeURIComponent(d),{method:"DELETE"});
  lsDel(d);
}
async function loadAll(){
  const local=lsAll();
  let out;
  try{
    out=await apiRequest("/entries");
    for(const d of Object.keys(local)){
      if(!out[d]){ await saveDay(d,local[d]); out[d]=local[d]; }
    }
  }catch(e){
    console.warn("SQLite database unavailable; using browser cache",e);
    out=Object.assign({},local);
  }
  Object.keys(out).forEach(d=>{ out[d]=migrate(out[d],d); });
  return out;
}
function migrate(rec,date){
  if(rec && rec.shifts) return rec;
  const b=blankDay(date);
  if(rec && rec.rows){ // v1 single-sheet day -> Shift A
    Object.keys(b.shifts.A.rows).forEach(k=>{ if(rec.rows[k]) b.shifts.A.rows[k]=Object.assign({},b.shifts.A.rows[k],rec.rows[k]); });
    Object.keys(b.shifts.A.manpower).forEach(k=>{ if(rec.manpower&&rec.manpower[k]) b.shifts.A.manpower[k]=Object.assign({},rec.manpower[k]); });
    b.updatedAt=rec.updatedAt||null;
  }
  return b;
}

/* ===== dialogs (custom — native confirm/alert can be blocked in sandboxed previews) ===== */
function askConfirm(message,okLabel){
  return new Promise(resolve=>{
    const wrap=document.createElement("div"); wrap.className="modalwrap";
    wrap.innerHTML='<div class="modalcard"><p></p><div class="mbtns"><button class="mcancel">Cancel</button><button class="mok">'+(okLabel||"OK")+'</button></div></div>';
    wrap.querySelector("p").textContent=message;
    document.body.appendChild(wrap);
    const done=v=>{ wrap.remove(); resolve(v); };
    wrap.querySelector(".mcancel").onclick=()=>done(false);
    wrap.querySelector(".mok").onclick=()=>done(true);
    wrap.addEventListener("click",e=>{ if(e.target===wrap) done(false); });
    document.addEventListener("keydown",function esc(e){ if(e.key==="Escape"){ done(false); document.removeEventListener("keydown",esc); } });
    wrap.querySelector(".mok").focus();
  });
}
function showAlert(message){
  return new Promise(resolve=>{
    const wrap=document.createElement("div"); wrap.className="modalwrap";
    wrap.innerHTML='<div class="modalcard"><p></p><div class="mbtns"><button class="mok">OK</button></div></div>';
    wrap.querySelector("p").textContent=message;
    document.body.appendChild(wrap);
    const done=()=>{ wrap.remove(); resolve(); };
    wrap.querySelector(".mok").onclick=done;
    wrap.addEventListener("click",e=>{ if(e.target===wrap) done(); });
    wrap.querySelector(".mok").focus();
  });
}

function askTypedConfirm(message,requiredText,okLabel){
  return new Promise(resolve=>{
    const wrap=document.createElement("div"); wrap.className="modalwrap";
    wrap.innerHTML='<div class="modalcard"><p></p><label>Type "'+escapeHtml(requiredText)+'" to confirm</label>'
      +'<input id="tcInput" autocomplete="off"><div class="mbtns" style="margin-top:16px">'
      +'<button class="mcancel">Cancel</button><button class="mok" disabled>'+(okLabel||"Confirm")+'</button></div></div>';
    wrap.querySelector("p").textContent=message;
    document.body.appendChild(wrap);
    const done=v=>{ wrap.remove(); resolve(v); };
    const okBtn=wrap.querySelector(".mok"), input=wrap.querySelector("#tcInput");
    input.addEventListener("input",()=>{ okBtn.disabled = input.value!==requiredText; });
    input.addEventListener("keydown",e=>{ if(e.key==="Enter" && !okBtn.disabled) done(true); });
    wrap.querySelector(".mcancel").onclick=()=>done(false);
    okBtn.onclick=()=>done(true);
    wrap.addEventListener("click",e=>{ if(e.target===wrap) done(false); });
    document.addEventListener("keydown",function esc(e){ if(e.key==="Escape"){ done(false); document.removeEventListener("keydown",esc); } });
    input.focus();
  });
}

/* ===== auth ===== */
const SESS_KEY="ehoome_session_v1", ACC_LS="ehoome_accounts_v1", ATTEMPTS_LS="ehoome_login_attempts_v1", IMP_KEY="ehoome_impersonating_v1";
const PBKDF2_ITER=150000, SESSION_HOURS=12;
let session=null, accessWindow=null; // authenticated session and server-enforced active shift
async function sha256Hex(str){
  const buf=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function bytesToHex(bytes){ return Array.from(bytes).map(b=>b.toString(16).padStart(2,"0")).join(""); }
function hexToBytes(hex){ const out=new Uint8Array(hex.length/2); for(let i=0;i<out.length;i++) out[i]=parseInt(hex.substr(i*2,2),16); return out; }
function randomSaltHex(){ const a=new Uint8Array(16); crypto.getRandomValues(a); return bytesToHex(a); }
async function pbkdf2Hex(password,saltHex,iterations){
  const keyMaterial=await crypto.subtle.importKey("raw", new TextEncoder().encode(password), {name:"PBKDF2"}, false, ["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt:hexToBytes(saltHex), iterations}, keyMaterial, 256);
  return bytesToHex(new Uint8Array(bits));
}
async function newCredential(password){
  const salt=randomSaltHex();
  const passwordHash=await pbkdf2Hex(password,salt,PBKDF2_ITER);
  return {passwordHash,salt,iterations:PBKDF2_ITER};
}
/* Kept for validating legacy browser-local records during migration. */
async function verifyPassword(username,password,acc){
  if(acc.salt && acc.iterations){
    const hash=await pbkdf2Hex(password,acc.salt,acc.iterations);
    return hash===acc.passwordHash;
  }
  const legacy=await sha256Hex(password);
  return legacy===acc.passwordHash;
}
function escapeHtml(s){
  return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function strongEnough(pw){ return pw.length>=8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw); }
/* Client-side login throttling: slows down repeated guesses against one username. */
function accLsAll(){ try{ return JSON.parse(localStorage.getItem(ACC_LS)||"{}"); }catch(e){ return {}; } }
function accLsPut(u,v){ try{ const a=accLsAll(); a[u]=v; localStorage.setItem(ACC_LS,JSON.stringify(a)); }catch(e){} }
function accLsDel(u){ try{ const a=accLsAll(); delete a[u]; localStorage.setItem(ACC_LS,JSON.stringify(a)); }catch(e){} }
async function listAccounts(){ return apiRequest("/accounts"); }
async function createAccount(displayName,username,password,role){
  return apiRequest("/accounts",{method:"POST",body:JSON.stringify({displayName,username,password,role})});
}
async function updateAccount(username,changes){
  return apiRequest("/accounts/"+encodeURIComponent(username.toLowerCase()),{method:"PATCH",body:JSON.stringify(changes)});
}
async function deleteAccount(username){
  const key=username.toLowerCase();
  await apiRequest("/accounts/"+encodeURIComponent(key),{method:"DELETE"});
  accLsDel(key);
}
async function updateMyProfile(displayName){ return apiRequest("/me",{method:"PATCH",body:JSON.stringify({displayName})}); }
async function changeMyPassword(currentPassword,newPassword){ return apiRequest("/auth/password",{method:"POST",body:JSON.stringify({currentPassword,newPassword})}); }
function loadSession(){ try{ return JSON.parse(localStorage.getItem(SESS_KEY)||"null"); }catch(e){ return null; } }
function storeSession(s){ try{ localStorage.setItem(SESS_KEY, JSON.stringify(s)); }catch(e){} }
function clearSession(){ try{ localStorage.removeItem(SESS_KEY); }catch(e){} }
function loadImpersonator(){ try{ return JSON.parse(localStorage.getItem(IMP_KEY)||"null"); }catch(e){ return null; } }
function storeImpersonator(s){ try{ localStorage.setItem(IMP_KEY, JSON.stringify(s)); }catch(e){} }
function clearImpersonator(){ try{ localStorage.removeItem(IMP_KEY); }catch(e){} }

function authCardSetup(){
  const c=document.getElementById("authCard");
  c.innerHTML='<h2>Set up the master account</h2><p class="hint">No account exists yet for this MIS. Create the first master account — it can add more user and master accounts later.</p>'
    +'<label for="suName">Your name</label><input id="suName" autocomplete="name" maxlength="60" placeholder="e.g. Priya Sharma">'
    +'<label for="suUser">Username</label><input id="suUser" autocomplete="username" maxlength="24" placeholder="e.g. priya">'
    +'<label for="suPass">Password</label><input id="suPass" type="password" autocomplete="new-password" placeholder="At least 8 characters, with a letter and a number">'
    +'<button class="authbtn" id="suBtn">Create master account</button><div class="autherr" id="suErr"></div>';
  document.getElementById("suBtn").onclick=async()=>{
    const name=document.getElementById("suName").value.trim();
    const user=document.getElementById("suUser").value.trim();
    const pass=document.getElementById("suPass").value;
    const err=document.getElementById("suErr");
    if(!name||!user||!pass){ err.textContent="Fill in all fields."; return; }
    if(!/^[a-zA-Z0-9._-]{3,24}$/.test(user)){ err.textContent="Username: 3-24 letters, numbers, dot, underscore or dash."; return; }
    if(!strongEnough(pass)){ err.textContent="Password needs at least 8 characters, with a letter and a number."; return; }
    err.textContent="Creating secure account…";
    try{
      const result=await apiRequest("/auth/setup",{method:"POST",body:JSON.stringify({username:user,displayName:name,password:pass})});
      session=result.session; storeSession(session); startApp();
    }catch(e){ err.textContent=e.message; }
  };
}
function authCardLogin(errMsg){
  const c=document.getElementById("authCard");
  c.innerHTML='<h2>Sign in</h2><p class="hint">Ehoome · RREL production MIS</p>'
    +'<label for="liUser">Username</label><input id="liUser" autocomplete="username" maxlength="24" placeholder="Username">'
    +'<label for="liPass">Password</label><input id="liPass" type="password" autocomplete="current-password" placeholder="Password">'
    +'<button class="authbtn" id="liBtn">Sign in</button><div class="autherr" id="liErr">'+escapeHtml(errMsg||"")+'</div>';
  const go=async()=>{
    const typedUser=document.getElementById("liUser").value.trim();
    const pass=document.getElementById("liPass").value;
    const err=document.getElementById("liErr");
    if(!typedUser||!pass){ err.textContent="Enter your username and password."; return; }
    err.textContent="Checking…";
    try{
      const result=await apiRequest("/auth/login",{method:"POST",body:JSON.stringify({username:typedUser,password:pass})});
      session=result.session; storeSession(session);
      if(session.impersonator) storeImpersonator(session.impersonator); else clearImpersonator();
      startApp();
    }catch(e){ err.textContent=e.message; }
  };
  document.getElementById("liBtn").onclick=go;
  c.querySelectorAll("input").forEach(i=>i.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); }));
}
async function bootAuth(){
  try{
    let status=await apiRequest("/auth/status");
    const localAccounts=accLsAll();
    if(!status.hasAccounts && Object.keys(localAccounts).length){
      await apiRequest("/bootstrap/import",{method:"POST",body:JSON.stringify({accounts:localAccounts,entries:lsAll()})});
      status=await apiRequest("/auth/status");
    }
    if(status.session){
      session=status.session; storeSession(session);
      if(session.impersonator) storeImpersonator(session.impersonator); else clearImpersonator();
      startApp(); return;
    }
    clearSession(); clearImpersonator();
    if(!status.hasAccounts) authCardSetup(); else authCardLogin();
  }catch(e){
    document.getElementById("authCard").innerHTML='<h2>Service unavailable</h2><p class="hint">The MIS server or database could not be reached.</p><div class="autherr">'+escapeHtml(e.message)+'</div>';
    setDatabaseStatus(false);
  }
}
function applySessionToUI(){
  document.getElementById("ubName").textContent=session.displayName;
  const rb=document.getElementById("ubRole");
  rb.textContent=session.role==="master"?"Master":"User";
  rb.className="ub-role"+(session.role==="master"?" master":"");
  document.getElementById("tabUsers").hidden = session.role!=="master";
  document.getElementById("clearBtn").hidden = session.role!=="master";
  document.getElementById("copyShiftBtn").hidden = session.role!=="master";
  document.getElementById("copyPrevBtn").hidden = session.role!=="master";
  paintImpBanner();
  if(window.__sessionWatch) clearInterval(window.__sessionWatch);
  window.__sessionWatch=setInterval(()=>{
    if(session && session.expiresAt && session.expiresAt<=Date.now()){
      clearInterval(window.__sessionWatch);
      clearSession(); clearImpersonator(); session=null;
      document.getElementById("appRoot").hidden=true;
      document.getElementById("authOverlay").style.display="flex";
      authCardLogin("Your session expired. Please sign in again.");
    }
  },60000);
}
function paintImpBanner(){
  const bar=document.getElementById("impBanner");
  const imp=loadImpersonator();
  if(imp && session && imp.username!==session.username){
    bar.hidden=false;
    bar.innerHTML='⚠️ Viewing as <strong>'+escapeHtml(session.displayName)+'</strong> ('+(session.role==="master"?"Master":"User")+')'
      +'<button id="backToMasterBtn">Back to '+escapeHtml(imp.displayName)+'</button>';
    document.getElementById("backToMasterBtn").onclick=async()=>{
      try{
        const result=await apiRequest("/auth/stop-impersonation",{method:"POST",body:"{}"});
        session=result.session; storeSession(session); clearImpersonator();
        applySessionToUI(); switchView("dash");
      }catch(e){ await showAlert(e.message); }
    };
  }else{
    bar.hidden=true; bar.innerHTML="";
  }
}
function showEditNameModal(){
  const wrap=document.createElement("div"); wrap.className="modalwrap";
  wrap.innerHTML='<div class="modalcard"><h2 style="margin:0 0 4px; font-size:17px">Edit name</h2>'
    +'<p style="margin:0; font-size:13px; color:var(--ink-2)">Username: '+escapeHtml(session.username)+' (usernames can\'t be changed)</p>'
    +'<label for="enName">Name</label><input id="enName" maxlength="60" value="'+escapeHtml(session.displayName)+'">'
    +'<div class="dlgerr" id="enErr"></div>'
    +'<div class="mbtns" style="margin-top:16px"><button class="mcancel">Cancel</button><button class="mok">Save</button></div></div>';
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  wrap.querySelector(".mcancel").onclick=close;
  wrap.addEventListener("click",e=>{ if(e.target===wrap) close(); });
  document.addEventListener("keydown",function esc(e){ if(e.key==="Escape"){ close(); document.removeEventListener("keydown",esc); } });
  const submit=async()=>{
    const name=document.getElementById("enName").value.trim();
    const err=document.getElementById("enErr");
    if(!name){ err.textContent="Name can't be empty."; err.className="dlgerr"; return; }
    err.textContent="Saving…"; err.className="dlgerr";
    try{
      await updateMyProfile(name.slice(0,60));
      session.displayName=name.slice(0,60); storeSession(session); applySessionToUI();
      err.textContent="Name updated."; err.className="dlgerr dlgok";
      setTimeout(close,900);
    }catch(e){ err.textContent=e.message; err.className="dlgerr"; }
  };
  wrap.querySelector(".mok").onclick=submit;
  document.getElementById("enName").addEventListener("keydown",e=>{ if(e.key==="Enter") submit(); });
  document.getElementById("enName").focus(); document.getElementById("enName").select();
}
function showChangePasswordModal(){
  const wrap=document.createElement("div"); wrap.className="modalwrap";
  wrap.innerHTML='<div class="modalcard"><h2 style="margin:0 0 4px; font-size:17px">Change password</h2>'
    +'<p style="margin:0; font-size:13px; color:var(--ink-2)">Signed in as '+escapeHtml(session.displayName)+' ('+escapeHtml(session.username)+')</p>'
    +'<label for="cpCur">Current password</label><input id="cpCur" type="password" autocomplete="current-password">'
    +'<label for="cpNew">New password</label><input id="cpNew" type="password" autocomplete="new-password" placeholder="At least 8 characters, with a letter and a number">'
    +'<label for="cpConf">Confirm new password</label><input id="cpConf" type="password" autocomplete="new-password">'
    +'<div class="dlgerr" id="cpErr"></div>'
    +'<div class="mbtns" style="margin-top:16px"><button class="mcancel">Cancel</button><button class="mok">Update password</button></div></div>';
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  wrap.querySelector(".mcancel").onclick=close;
  wrap.addEventListener("click",e=>{ if(e.target===wrap) close(); });
  document.addEventListener("keydown",function esc(e){ if(e.key==="Escape"){ close(); document.removeEventListener("keydown",esc); } });
  const submit=async()=>{
    const cur=document.getElementById("cpCur").value;
    const nw=document.getElementById("cpNew").value;
    const conf=document.getElementById("cpConf").value;
    const err=document.getElementById("cpErr");
    if(!cur||!nw||!conf){ err.textContent="Fill in all fields."; err.className="dlgerr"; return; }
    if(!strongEnough(nw)){ err.textContent="New password needs at least 8 characters, with a letter and a number."; err.className="dlgerr"; return; }
    if(nw!==conf){ err.textContent="New passwords don't match."; err.className="dlgerr"; return; }
    if(nw===cur){ err.textContent="New password must be different from the current one."; err.className="dlgerr"; return; }
    err.textContent="Updating securely…"; err.className="dlgerr";
    try{
      await changeMyPassword(cur,nw);
      err.textContent="Password updated."; err.className="dlgerr dlgok";
      setTimeout(close,1100);
    }catch(e){ err.textContent=e.message; err.className="dlgerr"; }
  };
  wrap.querySelector(".mok").onclick=submit;
  wrap.querySelectorAll("input").forEach(i=>i.addEventListener("keydown",e=>{ if(e.key==="Enter") submit(); }));
  document.getElementById("cpCur").focus();
}
document.getElementById("editNameBtn").onclick=()=>showEditNameModal();
document.getElementById("changePassBtn").onclick=()=>showChangePasswordModal();
document.getElementById("logoutBtn").onclick=async()=>{
  if(!await askConfirm("Sign out of the MIS?","Sign out")) return;
  try{ await apiRequest("/auth/logout",{method:"POST",body:"{}"}); }catch(e){}
  if(window.__sessionWatch) clearInterval(window.__sessionWatch);
  if(window.__dayWatch) clearInterval(window.__dayWatch);
  clearSession(); clearImpersonator(); session=null;
  document.getElementById("appRoot").hidden=true;
  document.getElementById("authOverlay").style.display="flex";
  authCardLogin();
};

/* ===== users management (master only) ===== */
function usersPanelHTML(){
  return '<div class="panel" style="margin-top:20px"><div class="panel-head">'
    +'<div><h2>Accounts</h2><p>Master accounts can enter data, manage the day sheet and add or remove accounts. User accounts can enter and view data but cannot delete a day or manage accounts.</p></div></div>'
    +'<div class="pad"><div id="newAcctForm" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; align-items:end; margin-bottom:20px">'
    +'<div><label style="display:block; font-size:12.5px; color:var(--ink-2); margin-bottom:5px; font-weight:600">Name</label><input class="cell" id="naName" placeholder="Full name"></div>'
    +'<div><label style="display:block; font-size:12.5px; color:var(--ink-2); margin-bottom:5px; font-weight:600">Username</label><input class="cell" id="naUser" placeholder="username"></div>'
    +'<div><label style="display:block; font-size:12.5px; color:var(--ink-2); margin-bottom:5px; font-weight:600">Password</label><input class="cell" id="naPass" type="password" placeholder="At least 8 characters, letter + number"></div>'
    +'<div><label style="display:block; font-size:12.5px; color:var(--ink-2); margin-bottom:5px; font-weight:600">Role</label>'
    +'<select class="cell" id="naRole"><option value="user">User</option><option value="master">Master</option></select></div>'
    +'<button class="act primary" id="naBtn" style="height:38px">Add account</button></div>'
    +'<div class="status" id="naErr" style="margin-bottom:14px"></div>'
    +'<div id="acctList"></div></div></div>'
    +'<div class="panel" style="margin-top:20px"><div class="panel-head">'
    +'<div><h2>System administration</h2><p>Database health, recoverable backups and the latest security activity.</p></div>'
    +'<button class="act primary" id="backupBtn">Download database backup</button></div>'
    +'<div class="pad"><div class="sysgrid" id="systemStats"></div><h3 class="section-title" style="margin-top:0">Recent activity</h3><div id="auditList" class="audit-list"><div class="empty" style="padding:24px">Loading activity…</div></div></div></div>'
    +'<div class="panel" style="margin-top:20px; border-color:var(--bad)"><div class="panel-head">'
    +'<div><h2 style="color:var(--bad)">Danger zone</h2><p>Master-only actions that can\'t be undone.</p></div></div>'
    +'<div class="pad"><button class="act" id="clearAllBtn" style="border-color:var(--bad); color:var(--bad)">Clear all production data</button>'
    +'<p style="font-size:12.5px; color:var(--ink-2); margin-top:10px; max-width:52ch">Deletes every saved day sheet — all shifts, all lines, for every date — for everyone using this MIS. Accounts and logins are not affected.</p></div></div>';
}
async function renderUsers(){
  const host=document.getElementById("viewUsers");
  host.innerHTML=usersPanelHTML();
  document.getElementById("naBtn").onclick=async()=>{
    const name=document.getElementById("naName").value.trim();
    const user=document.getElementById("naUser").value.trim();
    const pass=document.getElementById("naPass").value;
    const role=document.getElementById("naRole").value;
    const err=document.getElementById("naErr");
    if(!name||!user||!pass){ err.textContent="Fill in name, username and password."; err.className="status err"; return; }
    if(!/^[a-zA-Z0-9._-]{3,24}$/.test(user)){ err.textContent="Username: 3-24 letters, numbers, dot, underscore or dash."; err.className="status err"; return; }
    if(!strongEnough(pass)){ err.textContent="Password needs at least 8 characters, with a letter and a number."; err.className="status err"; return; }
    err.textContent="Creating…"; err.className="status";
    try{
      await createAccount(name.slice(0,60),user,pass,role);
      err.textContent="Account created."; err.className="status ok";
      document.getElementById("naName").value=""; document.getElementById("naUser").value=""; document.getElementById("naPass").value="";
      paintAccountList(); renderSystemPanel();
    }catch(e){ err.textContent=e.message; err.className="status err"; }
  };
  await paintAccountList();
  await renderSystemPanel();
  document.getElementById("backupBtn").onclick=()=>{ window.location.href=API+"/backup"; setTimeout(renderSystemPanel,800); };
  document.getElementById("clearAllBtn").onclick=async()=>{
    const count=Object.keys(ALL).length;
    if(count===0){ await showAlert("There is no production data saved yet."); return; }
    const ok=await askTypedConfirm(
      "This permanently deletes all "+count+" saved day"+(count===1?"":"s")+" of production data — every shift, every line, for every date — for everyone. This can't be undone.",
      "DELETE ALL","Delete everything");
    if(!ok) return;
    const dates=Object.keys(ALL);
    for(const d of dates){ await deleteDay(d); }
    ALL={};
    weekAnchor=null; rangeFrom=null; rangeTo=null;
    loadInto(selected);
    await showAlert("All production data has been cleared.");
  };
}
async function renderSystemPanel(){
  const statsHost=document.getElementById("systemStats"), auditHost=document.getElementById("auditList");
  if(!statsHost||!auditHost||!session||session.role!=="master") return;
  try{
    const [stats,events]=await Promise.all([apiRequest("/system"),apiRequest("/audit")]);
    const cards=[
      [stats.entries.toLocaleString("en-IN"),"Saved production days"],
      [stats.accounts.toLocaleString("en-IN"),"Active accounts"],
      [stats.auditEvents.toLocaleString("en-IN"),"Audit events"],
      [formatBytes(stats.databaseBytes),"Database size"]
    ];
    statsHost.innerHTML=cards.map(c=>'<div class="syscard"><strong>'+escapeHtml(c[0])+'</strong><span>'+escapeHtml(c[1])+'</span></div>').join("");
    auditHost.innerHTML=events.length?events.slice(0,50).map(e=>{
      const label=e.action+' '+e.entity+(e.entityId?' · '+e.entityId:'');
      return '<div class="audit-row"><time>'+escapeHtml(new Date(e.occurredAt).toLocaleString())+'</time><span class="actor">'+escapeHtml(e.actor||"system")+'</span><span>'+escapeHtml(label)+'</span></div>';
    }).join(""):'<div class="empty" style="padding:24px">No activity recorded yet.</div>';
  }catch(e){
    auditHost.innerHTML='<div class="empty" style="padding:24px">'+escapeHtml(e.message)+'</div>';
  }
}
function formatBytes(bytes){
  if(bytes<1024) return bytes+" B";
  if(bytes<1024*1024) return (bytes/1024).toFixed(1)+" KB";
  return (bytes/(1024*1024)).toFixed(1)+" MB";
}
async function showEditAccountModal(username){
  const accs=await listAccounts();
  const acc=accs[username];
  if(!acc){ await showAlert("That account no longer exists."); paintAccountList(); return; }
  const isSelf=username===session.username;
  const masters=Object.keys(accs).filter(u=>accs[u].role==="master").length;
  const wrap=document.createElement("div"); wrap.className="modalwrap";
  wrap.innerHTML='<div class="modalcard"><h2 style="margin:0 0 4px; font-size:17px">Edit account</h2>'
    +'<p style="margin:0; font-size:13px; color:var(--ink-2)">Username: '+escapeHtml(username)+' (usernames can\'t be changed)</p>'
    +'<label for="eaName">Name</label><input id="eaName" maxlength="60" value="'+escapeHtml(acc.displayName||username)+'">'
    +'<label for="eaRole">Role</label><select id="eaRole"><option value="user"'+(acc.role!=="master"?" selected":"")+'>User</option><option value="master"'+(acc.role==="master"?" selected":"")+'>Master</option></select>'
    +'<div class="dlgerr" id="eaErr"></div>'
    +'<div class="mbtns" style="margin-top:16px"><button class="mcancel">Cancel</button><button class="mok">Save</button></div></div>';
  document.body.appendChild(wrap);
  const close=()=>wrap.remove();
  wrap.querySelector(".mcancel").onclick=close;
  wrap.addEventListener("click",e=>{ if(e.target===wrap) close(); });
  document.addEventListener("keydown",function esc(e){ if(e.key==="Escape"){ close(); document.removeEventListener("keydown",esc); } });
  const submit=async()=>{
    const name=document.getElementById("eaName").value.trim();
    const role=document.getElementById("eaRole").value;
    const err=document.getElementById("eaErr");
    if(!name){ err.textContent="Name can't be empty."; err.className="dlgerr"; return; }
    if(acc.role==="master" && role!=="master" && masters<=1){ err.textContent="Can't demote the only master account."; err.className="dlgerr"; return; }
    err.textContent="Saving…"; err.className="dlgerr";
    try{
      await updateAccount(username,{displayName:name.slice(0,60),role});
      if(isSelf){ session.displayName=name.slice(0,60); session.role=role; storeSession(session); applySessionToUI(); if(role!=="master"){ setTimeout(()=>switchView("dash"),950); } }
      err.textContent="Account updated."; err.className="dlgerr dlgok";
      setTimeout(()=>{ close(); paintAccountList(); renderSystemPanel(); },900);
    }catch(e){ err.textContent=e.message; err.className="dlgerr"; }
  };
  wrap.querySelector(".mok").onclick=submit;
  document.getElementById("eaName").addEventListener("keydown",e=>{ if(e.key==="Enter") submit(); });
  document.getElementById("eaName").focus(); document.getElementById("eaName").select();
}
async function paintAccountList(){
  const list=document.getElementById("acctList"); if(!list) return;
  const accs=await listAccounts();
  const rows=Object.keys(accs).sort();
  const masters=rows.filter(u=>accs[u].role==="master").length;
  list.innerHTML='<div class="scroller"><table class="report"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Created</th><th></th></tr></thead><tbody>'
    +rows.map(u=>{
      const a=accs[u];
      const isSelf=u===session.username;
      const canDelete = !isSelf && !(a.role==="master" && masters<=1);
      const uSafe=escapeHtml(u), nameSafe=escapeHtml(a.displayName||u);
      const btns='<button class="act" data-edit="'+uSafe+'" style="padding:5px 10px; font-size:12.5px; margin-right:6px">Edit</button>'
        +(isSelf?"":'<button class="act" data-loginas="'+uSafe+'" style="padding:5px 10px; font-size:12.5px; margin-right:6px">Log in as</button>')
        +(canDelete?'<button class="act" data-del="'+uSafe+'" style="padding:5px 10px; font-size:12.5px">Remove</button>':"");
      return '<tr><td>'+nameSafe+'</td><td>'+uSafe+(isSelf?' <span class="pill idle" style="padding:1px 6px">you</span>':'')+'</td>'
        +'<td><span class="ub-role'+(a.role==="master"?" master":"")+'" style="position:static">'+(a.role==="master"?"Master":"User")+'</span></td>'
        +'<td>'+(a.createdAt?new Date(a.createdAt).toLocaleDateString():"—")+'</td>'
        +'<td style="white-space:nowrap">'+btns+'</td></tr>';
    }).join("")
    +'</tbody></table></div>';
  list.querySelectorAll("[data-edit]").forEach(b=>{
    b.onclick=()=>showEditAccountModal(b.getAttribute("data-edit"));
  });
  list.querySelectorAll("[data-del]").forEach(b=>{
    b.onclick=async()=>{
      const u=b.getAttribute("data-del");
      if(!await askConfirm("Remove account \""+u+"\"? They will no longer be able to sign in.","Remove")) return;
      await deleteAccount(u); paintAccountList();
    };
  });
  list.querySelectorAll("[data-loginas]").forEach(b=>{
    b.onclick=async()=>{
      const u=b.getAttribute("data-loginas");
      const accsNow=await listAccounts(); const target=accsNow[u];
      if(!target){ await showAlert("That account no longer exists."); paintAccountList(); return; }
      const label=target.displayName||u;
      if(!await askConfirm("Sign in as \""+label+"\" ("+u+")? This switches your session away from your own master account without needing their password.","Log in as")) return;
      try{
        const result=await apiRequest("/auth/impersonate/"+encodeURIComponent(u),{method:"POST",body:"{}"});
        session=result.session; storeSession(session); storeImpersonator(session.impersonator);
        applySessionToUI(); switchView("dash");
      }catch(e){ await showAlert(e.message); }
    };
  });
}

/* ===== state ===== */
let ALL={}, current=null, selected=todayISO(), shift="A", dirty=false;
let sumMode="date", rangeFrom=null, rangeTo=null, dashShift="ALL", weekAnchor=null;
function weekStart(iso){
  const d=new Date(iso+"T00:00:00"); const dow=d.getDay(); const diff=(dow+6)%7;
  d.setDate(d.getDate()-diff);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function weekDates(monday){ const arr=[]; for(let i=0;i<7;i++) arr.push(shiftDateISO(monday,i)); return arr; }
function formatWeekLabel(monday){
  const sun=shiftDateISO(monday,6);
  const d1=new Date(monday+"T00:00:00"), d2=new Date(sun+"T00:00:00");
  const p1=String(d1.getDate()).padStart(2,"0"), p2=String(d2.getDate()).padStart(2,"0");
  if(d1.getMonth()===d2.getMonth()) return p1+"–"+p2+" "+MONTHS[d1.getMonth()].slice(0,3)+" "+d1.getFullYear();
  return p1+" "+MONTHS[d1.getMonth()].slice(0,3)+" – "+p2+" "+MONTHS[d2.getMonth()].slice(0,3)+" "+d2.getFullYear();
}
function dayTotals(d,ids){ const rec=ALL[d]; if(!rec) return {target:0,ach:0,gap:0,pct:null,off:0,cost:0}; return rollup(rec,ids); }
function todayISO(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function shiftDateISO(iso,delta){
  const d=new Date(iso+"T00:00:00"); d.setDate(d.getDate()+delta);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
let calMonth=null; // "YYYY-MM" currently shown in the popover
async function goToDate(v,fromCalendar){
  if(!v) return;
  if(session&&session.role!=="master"&&!document.getElementById("viewEntry").hidden&&accessWindow&&v!==accessWindow.date){
    await showAlert("Normal users can enter data only for the active Shift "+accessWindow.shift+" sheet dated "+prettyDate(accessWindow.date)+".");
    document.getElementById("dateInput").value=selected;
    return;
  }
  if(dirty && !document.getElementById("viewEntry").hidden && !await askConfirm("This day has unsaved changes. Leave without saving?","Leave")){
    if(!fromCalendar) document.getElementById("dateInput").value=selected;
    return;
  }
  selected=v; weekAnchor=weekStart(v); document.getElementById("dateInput").value=v; loadInto(v);
  if(document.getElementById("viewEntry").hidden) renderDash();
  closeCalendar();
}
function openCalendar(){
  calMonth=selected.slice(0,7);
  document.getElementById("calPop").hidden=false;
  document.getElementById("calBtn").setAttribute("aria-expanded","true");
  paintCalendar();
}
function closeCalendar(){
  const p=document.getElementById("calPop"); if(p) p.hidden=true;
  const b=document.getElementById("calBtn"); if(b) b.setAttribute("aria-expanded","false");
}
function paintCalendar(){
  const pop=document.getElementById("calPop"); if(!pop||pop.hidden) return;
  const [y,m]=calMonth.split("-").map(Number);
  const first=new Date(y,m-1,1), startDow=first.getDay();
  const daysInMonth=new Date(y,m,0).getDate();
  const daysPrevMonth=new Date(y,m-1,0).getDate();
  const today=todayISO();
  let html='<div class="calhead"><button id="calPrev" aria-label="Previous month">‹</button>'
    +'<span>'+MONTHS[m-1]+' '+y+'</span><button id="calNext" aria-label="Next month">›</button></div>'
    +'<div class="calgrid">'+["S","M","T","W","T","F","S"].map(d=>'<div class="dow">'+d+'</div>').join("");
  for(let i=0;i<startDow;i++){
    const dn=daysPrevMonth-startDow+1+i;
    html+='<button class="day outside" disabled>'+dn+'</button>';
  }
  for(let d=1; d<=daysInMonth; d++){
    const iso=y+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0");
    const has=!!ALL[iso];
    const cls="day"+(has?" has-data":"")+(iso===today?" today":"");
    html+='<button class="'+cls+'" aria-current="'+(iso===selected)+'" data-date="'+iso+'">'+d+'</button>';
  }
  const totalCells=startDow+daysInMonth, rem=(7-(totalCells%7))%7;
  for(let i=1;i<=rem;i++) html+='<button class="day outside" disabled>'+i+'</button>';
  html+='</div><div class="cf"><span class="dot"></span>Has saved data · today is outlined</div>';
  pop.innerHTML=html;
  document.getElementById("calPrev").onclick=()=>{ const dt=new Date(y,m-2,1); calMonth=dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0"); paintCalendar(); };
  document.getElementById("calNext").onclick=()=>{ const dt=new Date(y,m,1); calMonth=dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0"); paintCalendar(); };
  pop.querySelectorAll("button.day[data-date]").forEach(btn=>{
    btn.onclick=()=>goToDate(btn.getAttribute("data-date"),true);
  });
}
document.addEventListener("click",e=>{
  const pop=document.getElementById("calPop"), btn=document.getElementById("calBtn");
  if(!pop||pop.hidden) return;
  if(pop.contains(e.target)||btn.contains(e.target)) return;
  closeCalendar();
});
document.addEventListener("keydown",e=>{ if(e.key==="Escape") closeCalendar(); });
document.getElementById("calBtn").onclick=()=>{ const p=document.getElementById("calPop"); p.hidden?openCalendar():closeCalendar(); };
document.getElementById("prevDay").onclick=()=>goToDate(shiftDateISO(selected,-1));
document.getElementById("nextDay").onclick=()=>goToDate(shiftDateISO(selected,1));

function blankShift(){ const rows={},mp={};
  FLAT.forEach(f=>rows[f.key]={item:"",target:"",ach:""});
  TEMPLATE.forEach(g=>g.subs.forEach(s=>mp[subKey(g.line,s.sub)]={off:"",cost:""}));
  return {rows,manpower:mp}; }
function blankDay(date){
  const sh={}; SHIFTS.forEach(s=>sh[s.id]=blankShift());
  return {date, month:MONTHS[Number(date.slice(5,7))-1], year:date.slice(0,4), shifts:sh, updatedAt:null};
}
function cloneDay(rec,date){
  const b=blankDay(date); if(!rec) return b;
  SHIFTS.forEach(s=>{
    const src=(rec.shifts||{})[s.id]; if(!src) return;
    Object.keys(b.shifts[s.id].rows).forEach(k=>{ if(src.rows&&src.rows[k]) b.shifts[s.id].rows[k]=Object.assign({},b.shifts[s.id].rows[k],src.rows[k]); });
    Object.keys(b.shifts[s.id].manpower).forEach(k=>{ if(src.manpower&&src.manpower[k]) b.shifts[s.id].manpower[k]=Object.assign({},b.shifts[s.id].manpower[k],src.manpower[k]); });
  });
  b.updatedAt=rec.updatedAt||null; return b;
}
const num=v=>{const n=parseFloat(v); return isFinite(n)?n:null};
const stat=p=>p===null?"idle":p>=100?"good":p>=90?"warn":"bad";
const fmt=n=>(n===null||n===undefined||isNaN(n))?"—":Number(n).toLocaleString("en-IN");
const pctTxt=p=>p===null?"—":(Math.round(p*10)/10).toFixed(1)+"%";
const money=n=>"₹"+fmt(Math.round(n||0));
function prettyDate(iso){ if(!iso) return ""; const d=new Date(iso+"T00:00:00"); if(isNaN(d)) return iso;
  return String(d.getDate()).padStart(2,"0")+" "+MONTHS[d.getMonth()].slice(0,3)+" "+d.getFullYear(); }
function rowStats(r){ r=r||{}; const t=num(r.target),a=num(r.ach),planned=t!==null&&t>0;
  return {target:t,ach:a,planned,gap:planned?t-(a||0):null,pct:planned?(a||0)/t*100:null}; }

/* ===== rollups ===== */
function shiftIds(){ return dashShift==="ALL"?SHIFTS.map(s=>s.id):[dashShift]; }
function rollup(rec,ids){
  ids=ids||SHIFTS.map(s=>s.id);
  let t=0,a=0,planned=0,met=0,off=0,cost=0;
  ids.forEach(id=>{
    const sh=(rec.shifts||{})[id]; if(!sh) return;
    FLAT.forEach(f=>{ const st=rowStats(sh.rows[f.key]); if(st.planned){planned++;t+=st.target;a+=st.ach||0;if(st.pct>=100)met++;} });
    Object.values(sh.manpower||{}).forEach(m=>{off+=num(m.off)||0;cost+=num(m.cost)||0;});
  });
  return {target:t,ach:a,gap:t-a,pct:t>0?a/t*100:null,planned,met,off,cost};
}
function lineRollup(rec,ids,line){
  let t=0,a=0; ids.forEach(id=>{const sh=(rec.shifts||{})[id]; if(!sh)return;
    FLAT.filter(f=>f.line===line).forEach(f=>{const st=rowStats(sh.rows[f.key]); if(st.planned){t+=st.target;a+=st.ach||0;}});});
  return {t,a,pct:t>0?a/t*100:null};
}
function aggregate(dates,ids){
  let t=0,a=0,off=0,cost=0,days=0,met=0,planned=0;
  dates.forEach(d=>{const x=rollup(ALL[d],ids); t+=x.target;a+=x.ach;off+=x.off;cost+=x.cost;met+=x.met;planned+=x.planned;days++;});
  return {t,a,off,cost,days,met,planned,pct:t>0?a/t*100:null,gap:t-a};
}

/* ===== entry ===== */
function buildShiftSeg(){
  const seg=document.getElementById("shiftSeg"); seg.innerHTML="";
  const visible=(session&&session.role!=="master"&&accessWindow)?SHIFTS.filter(s=>s.id===accessWindow.shift):SHIFTS;
  if(visible.length&&!visible.some(s=>s.id===shift)) shift=visible[0].id;
  visible.forEach(s=>{
    const b=document.createElement("button");
    b.innerHTML='<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:'+s.color+';margin-right:6px;vertical-align:1px"></span>'+s.name;
    b.title=s.hours;
    b.setAttribute("aria-current",String(s.id===shift));
    b.onclick=()=>{ shift=s.id; buildShiftSeg(); buildEntry(); };
    seg.appendChild(b);
  });
}
function buildEntry(){
  const tb=document.getElementById("entryBody"); tb.innerHTML="";
  const S=current.shifts[shift];
  TEMPLATE.forEach(g=>{
    const lineRows=g.subs.reduce((n,s)=>n+s.procs.length,0); let first=true;
    g.subs.forEach(s=>{
      s.procs.forEach((p,pi)=>{
        const tr=document.createElement("tr");
        if(first){ const td=document.createElement("td"); td.className="grp"; td.rowSpan=lineRows; td.textContent=g.line; td.style.setProperty("--line-accent",g.color); tr.appendChild(td); first=false; }
        if(pi===0){
          const td=document.createElement("td"); td.className="subc"; td.rowSpan=s.procs.length; td.textContent=s.sub; tr.appendChild(td);
          const mk=subKey(g.line,s.sub);
          ["off","cost"].forEach(f=>{
            const c=document.createElement("td"); c.className="mp"; c.rowSpan=s.procs.length;
            const i=document.createElement("input"); i.className="cell n"; i.type="number"; i.min="0"; i.step="any";
            i.placeholder=f==="off"?"heads":"₹"; i.value=(S.manpower[mk]||{})[f]||"";
            i.addEventListener("input",()=>{S.manpower[mk][f]=i.value; markDirty();});
            c.appendChild(i); tr.appendChild(c);
          });
        }
        const k=rowKey(g.line,s.sub,p), idx=FLAT.findIndex(f=>f.key===k);
        const tdP=document.createElement("td"); tdP.textContent=p; tr.appendChild(tdP);
        const tdI=document.createElement("td");
        const ii=document.createElement("input"); ii.className="cell"; ii.placeholder="model / part"; ii.value=S.rows[k].item||"";
        ii.addEventListener("input",()=>{S.rows[k].item=ii.value; markDirty();});
        tdI.appendChild(ii); tr.appendChild(tdI);
        ["target","ach"].forEach(f=>{
          const td=document.createElement("td"); td.style.textAlign="right";
          const i=document.createElement("input"); i.className="cell n"; i.type="number"; i.min="0"; i.step="any"; i.placeholder="0";
          i.value=S.rows[k][f]||"";
          i.addEventListener("input",()=>{S.rows[k][f]=i.value; refreshCalc(k,idx); markDirty();});
          td.appendChild(i); tr.appendChild(td);
        });
        const g1=document.createElement("td"); g1.className="calc"; g1.id="gap-"+idx;
        const p1=document.createElement("td"); p1.style.textAlign="right"; p1.id="pct-"+idx;
        tr.appendChild(g1); tr.appendChild(p1); tb.appendChild(tr); refreshCalc(k,idx);
      });
    });
  });
}
function refreshCalc(k,idx){
  const g=document.getElementById("gap-"+idx), p=document.getElementById("pct-"+idx); if(!g||!p) return;
  const st=rowStats(current.shifts[shift].rows[k]);
  g.textContent=st.planned?fmt(st.gap):"—";
  g.style.color=(st.planned&&st.gap>0)?"var(--bad)":"var(--ink)";
  p.innerHTML='<span class="pill '+stat(st.pct)+'">'+(st.pct===null?"not planned":pctTxt(st.pct))+'</span>';
}
function markDirty(){dirty=true; setStatus("Unsaved changes","")}
function setStatus(m,k){const e=document.getElementById("saveStatus"); e.textContent=m; e.className="status "+(k||"")}

/* ===== trend chart ===== */
function svgTrend(points){
  const w=760,h=200,pl=42,pr=12,pt=14,pb=28; if(!points.length) return "";
  const max=Math.max(110,...points.map(p=>p.pct));
  const X=i=>pl+(points.length===1?(w-pl-pr)/2:i*(w-pl-pr)/(points.length-1));
  const Y=v=>pt+(1-v/max)*(h-pt-pb);
  let g="";
  [0,50,100].forEach(v=>{ if(v>max)return;
    g+='<line x1="'+pl+'" y1="'+Y(v)+'" x2="'+(w-pr)+'" y2="'+Y(v)+'" stroke="var(--line-2)"/>'
     +'<text x="'+(pl-8)+'" y="'+(Y(v)+4)+'" text-anchor="end" font-size="11" fill="var(--ink-3)" font-family="IBM Plex Mono,monospace">'+v+'%</text>'; });
  g+='<line x1="'+pl+'" y1="'+Y(100)+'" x2="'+(w-pr)+'" y2="'+Y(100)+'" stroke="var(--good)" stroke-dasharray="4 4" opacity=".7"/>';
  const path=points.map((p,i)=>(i?"L":"M")+X(i)+" "+Y(p.pct)).join(" ");
  const dots=points.map((p,i)=>'<circle cx="'+X(i)+'" cy="'+Y(p.pct)+'" r="3.5" fill="var(--surface)" stroke="var(--accent)" stroke-width="2"><title>'+p.label+" · "+pctTxt(p.pct)+'</title></circle>').join("");
  const every=Math.ceil(points.length/7);
  const lab=points.map((p,i)=>(i%every!==0&&i!==points.length-1)?"":'<text x="'+X(i)+'" y="'+(h-8)+'" text-anchor="middle" font-size="10.5" fill="var(--ink-3)" font-family="IBM Plex Mono,monospace">'+p.short+'</text>').join("");
  return '<svg class="trend" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" role="img" aria-label="Achievement percent trend">'
    +g+'<path d="'+path+'" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>'+dots+lab+'</svg>';
}

/* ===== summary (date / month / year / custom) ===== */
function allDates(){ return Object.keys(ALL).sort(); }
function inRange(d){ if(rangeFrom&&d<rangeFrom) return false; if(rangeTo&&d>rangeTo) return false; return true; }
function scopeDates(){ return sumMode==="custom"?allDates().filter(inRange):allDates(); }
function summaryGroups(){
  const dates=scopeDates();
  if(sumMode==="date"||sumMode==="custom") return dates.map(d=>({label:prettyDate(d),short:d.slice(8)+"/"+d.slice(5,7),dates:[d],key:d}));
  const keyOf=d=>sumMode==="week"?weekStart(d):sumMode==="month"?d.slice(0,7):d.slice(0,4);
  const order=[],map={};
  dates.forEach(d=>{const k=keyOf(d); if(!map[k]){map[k]=[];order.push(k)} map[k].push(d)});
  return order.map(k=>({key:k,dates:map[k],short:k,
    label: sumMode==="week" ? formatWeekLabel(k) : sumMode==="month" ? MONTHS[Number(k.slice(5,7))-1]+" "+k.slice(0,4) : k}));
}
function summaryTableHTML(){
  const groups=summaryGroups(), ids=shiftIds();
  if(!groups.length) return '<div class="empty"><p>No saved days in this view yet.</p></div>';
  const total=aggregate(scopeDates(),ids);
  let rows="";
  groups.forEach(g=>{
    const x=aggregate(g.dates,ids);
    const perUnit=(x.a>0&&x.cost>0)?x.cost/x.a:null;
    const isSel=(sumMode==="date"||sumMode==="custom")&&g.key===selected;
    rows+='<tr'+(isSel?' style="background:var(--accent-soft)"':'')+'>'
      +'<td>'+g.label+(g.dates.length>1?' <span style="color:var(--ink-3)">· '+g.dates.length+' days</span>':'')+'</td>'
      +'<td class="r">'+fmt(x.a)+'</td><td class="r">'+fmt(x.t)+'</td><td class="r">'+fmt(x.a)+'</td>'
      +'<td class="r"><span class="pill '+stat(x.pct)+'">'+(x.pct===null?"—":pctTxt(x.pct))+'</span></td>'
      +'<td class="r">'+fmt(x.off)+'</td><td class="r">'+money(x.cost)+'</td>'
      +'<td class="r">'+(perUnit===null?"—":"₹"+(Math.round(perUnit*100)/100))+'</td></tr>';
  });
  const totalPerUnit=(total.a>0&&total.cost>0)?total.cost/total.a:null;
  const overview='<div class="kpis" style="border:0;border-radius:0;box-shadow:none">'
    +'<div class="kpi headline"><h3>Overall achievement</h3><div class="v '+stat(total.pct)+'">'+pctTxt(total.pct)+'</div><div class="m">'+scopeDates().length+' recorded day'+(scopeDates().length===1?"":"s")+'</div></div>'
    +'<div class="kpi"><h3>Production output</h3><div class="v">'+fmt(total.a)+'</div><div class="m">against '+fmt(total.t)+' target</div></div>'
    +'<div class="kpi"><h3>Production gap</h3><div class="v '+(total.t-total.a>0?"bad":"good")+'">'+fmt(total.t-total.a)+'</div><div class="m">'+(total.t-total.a>0?"units below plan":"plan achieved")+'</div></div>'
    +'<div class="kpi"><h3>Cost per unit</h3><div class="v">'+(totalPerUnit===null?"—":"₹"+(Math.round(totalPerUnit*100)/100))+'</div><div class="m">'+money(total.cost)+' total cost</div></div></div>';
  return overview+'<div class="scroller"><table class="report"><thead><tr>'
    +'<th>'+(sumMode==="week"?"Week":sumMode==="month"?"Month":sumMode==="year"?"Year":"Date")+'</th>'
    +'<th style="text-align:right">Total production</th><th style="text-align:right">Target</th>'
    +'<th style="text-align:right">Achievement</th><th style="text-align:right">Achievement %</th>'
    +'<th style="text-align:right">Off-role man power</th><th style="text-align:right">Man power costing</th>'
    +'<th style="text-align:right">Cost / unit</th></tr></thead><tbody>'+rows+'</tbody>'
    +'<tfoot><tr><td>Total'+(dashShift==="ALL"?"":" · "+dashShift)+'</td><td class="r">'+fmt(total.a)+'</td><td class="r">'+fmt(total.t)+'</td>'
    +'<td class="r">'+fmt(total.a)+'</td><td class="r">'+pctTxt(total.pct)+'</td><td class="r">'+fmt(total.off)+'</td>'
    +'<td class="r">'+money(total.cost)+'</td>'
    +'<td class="r">'+((total.a>0&&total.cost>0)?"₹"+(Math.round(total.cost/total.a*100)/100):"—")+'</td></tr></tfoot></table></div>';
}
function shiftSummaryHTML(){
  const dates=scopeDates(); if(!dates.length) return "";
  const total=aggregate(dates,SHIFTS.map(s=>s.id));
  let rows="";
  SHIFTS.forEach(s=>{
    const x=aggregate(dates,[s.id]);
    rows+='<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+s.color+';margin-right:7px;vertical-align:1px"></span>'+s.name+' <span style="color:var(--ink-3)">'+s.hours+'</span></td>'
      +'<td class="r">'+fmt(x.a)+'</td><td class="r">'+fmt(x.t)+'</td>'
      +'<td class="r"><span class="pill '+stat(x.pct)+'">'+(x.pct===null?"—":pctTxt(x.pct))+'</span></td>'
      +'<td class="r">'+fmt(x.off)+'</td><td class="r">'+money(x.cost)+'</td></tr>';
  });
  return '<div class="scroller"><table class="report" style="min-width:640px"><thead><tr><th>Shift</th>'
    +'<th style="text-align:right">Total production</th><th style="text-align:right">Target</th>'
    +'<th style="text-align:right">Achievement %</th>'
    +'<th style="text-align:right">Off-role man power</th><th style="text-align:right">Man power costing</th></tr></thead><tbody>'+rows+'</tbody>'
    +'<tfoot><tr><td>All shifts · '+dates.length+' day'+(dates.length===1?"":"s")+'</td><td class="r">'+fmt(total.a)+'</td>'
    +'<td class="r">'+fmt(total.t)+'</td><td class="r">'+pctTxt(total.pct)+'</td>'
    +'<td class="r">'+fmt(total.off)+'</td><td class="r">'+money(total.cost)+'</td></tr></tfoot></table></div>';
}
function summaryPanelHTML(){
  const ds=allDates(), lo=ds[0]||"", hi=ds[ds.length-1]||"";
  if(rangeFrom===null) rangeFrom=lo; if(rangeTo===null) rangeTo=hi;
  return '<div class="panel" id="prodSummaryPanel" style="margin-top:28px"><div class="panel-head">'
    +'<div><h2>Production summary</h2><p>Executive performance view by date, week, month, year or a custom reporting period.</p></div>'
    +'<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">'
    +'<div class="seg" id="sumSeg"></div><button class="act primary" id="sumReport">Download management report</button><button class="act" id="sumCsv">Export data · CSV</button></div></div>'
    +'<div class="rangebar" id="rangeBar" '+(sumMode==="custom"?"":'hidden')+'>'
    +'<span>From</span><input type="date" id="rFrom" value="'+rangeFrom+'">'
    +'<span>to</span><input type="date" id="rTo" value="'+rangeTo+'">'
    +'<button class="act" id="rReset" style="padding:6px 12px">All dates</button></div>'
    +'<div id="summaryBody"></div>'
    +'<div class="panel-head" style="border-top:1px solid var(--line-2)"><div><h2>Shift comparison</h2>'
    +'<p>Same scope, split across the three shifts.</p></div></div>'
    +'<div id="shiftSummaryBody"></div></div>';
}
function paintSummary(){
  const seg=document.getElementById("sumSeg");
  if(seg){
    seg.innerHTML="";
    [["date","Date-wise"],["week","Week-wise"],["month","Month-wise"],["year","Year-wise"],["custom","Custom range"]].forEach(([m,l])=>{
      const b=document.createElement("button"); b.textContent=l; b.setAttribute("aria-current",String(sumMode===m));
      b.onclick=()=>{ sumMode=m; const rb=document.getElementById("rangeBar"); if(rb) rb.hidden=(m!=="custom"); paintSummary(); };
      seg.appendChild(b);
    });
  }
  const body=document.getElementById("summaryBody"); if(body) body.innerHTML=summaryTableHTML();
  const sb=document.getElementById("shiftSummaryBody"); if(sb) sb.innerHTML=shiftSummaryHTML();
  const f=document.getElementById("rFrom"), t=document.getElementById("rTo"), r=document.getElementById("rReset");
  if(f) f.onchange=()=>{rangeFrom=f.value; paintSummary();};
  if(t) t.onchange=()=>{rangeTo=t.value; paintSummary();};
  if(r) r.onclick=()=>{const ds=allDates(); rangeFrom=ds[0]||""; rangeTo=ds[ds.length-1]||"";
    const a=document.getElementById("rFrom"),b=document.getElementById("rTo"); if(a)a.value=rangeFrom; if(b)b.value=rangeTo; paintSummary();};
  const c=document.getElementById("sumCsv"); if(c) c.onclick=exportSummaryCSV;
  const r2=document.getElementById("sumReport"); if(r2) r2.onclick=exportSummaryReport;
}

function weekPanelHTML(){
  return '<div class="panel" style="margin-top:28px"><div class="panel-head">'
    +'<div><h2>Week at a glance</h2><p>All seven days of the week, side by side — click a day to open it.</p></div>'
    +'<div style="display:flex; gap:8px; align-items:center">'
    +'<button class="act" id="weekPrev" style="padding:7px 10px" aria-label="Previous week">‹</button>'
    +'<span class="status" id="weekLabel" style="min-width:170px; text-align:center; font-weight:600; color:var(--ink)"></span>'
    +'<button class="act" id="weekNext" style="padding:7px 10px" aria-label="Next week">›</button>'
    +'<button class="act" id="weekToday">This week</button></div></div>'
    +'<div id="weekPanelBody"></div></div>';
}
function paintWeekPanel(){
  const body=document.getElementById("weekPanelBody"), label=document.getElementById("weekLabel");
  if(!body) return;
  if(!weekAnchor) weekAnchor=weekStart(selected);
  const ids=shiftIds(), days=weekDates(weekAnchor), dayNames=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], today=todayISO();
  label.textContent=formatWeekLabel(weekAnchor);
  let rows="",tt=0,ta=0,toff=0,tcost=0;
  days.forEach((d,i)=>{
    const has=!!ALL[d], x=dayTotals(d,ids);
    tt+=x.target; ta+=x.ach; toff+=x.off; tcost+=x.cost;
    const isSel=d===selected;
    rows+='<tr class="wk-row" data-date="'+d+'" style="cursor:pointer;'+(isSel?'background:var(--accent-soft)':'')+'">'
      +'<td>'+dayNames[i]+' <span style="color:var(--ink-3)">'+d.slice(8)+'/'+d.slice(5,7)+'</span>'
      +(d===today?' <span class="pill idle" style="padding:1px 6px">today</span>':'')+'</td>'
      +'<td class="r">'+(has?fmt(x.target):"—")+'</td>'
      +'<td class="r">'+(has?fmt(x.ach):"—")+'</td>'
      +'<td class="r" style="color:'+((has&&x.target>0&&(x.target-x.ach)>0)?"var(--bad)":"var(--ink)")+'">'+((has&&x.target>0)?fmt(x.target-x.ach):"—")+'</td>'
      +'<td class="r"><span class="pill '+(has?stat(x.pct):"idle")+'">'+(has?(x.pct===null?"not planned":pctTxt(x.pct)):"no data")+'</span></td>'
      +'<td class="r">'+(has?fmt(x.off):"—")+'</td>'
      +'<td class="r">'+(has?money(x.cost):"—")+'</td></tr>';
  });
  const wpct=tt>0?ta/tt*100:null;
  body.innerHTML='<div class="scroller"><table class="report" style="min-width:660px"><thead><tr><th>Day</th>'
    +'<th style="text-align:right">Target</th><th style="text-align:right">Achievement</th>'
    +'<th style="text-align:right">Gap</th><th style="text-align:right">Achievement %</th>'
    +'<th style="text-align:right">Off-role man power</th><th style="text-align:right">Man power costing</th></tr></thead>'
    +'<tbody>'+rows+'</tbody><tfoot><tr><td>Week total</td><td class="r">'+fmt(tt)+'</td><td class="r">'+fmt(ta)+'</td>'
    +'<td class="r">'+fmt(tt-ta)+'</td><td class="r">'+pctTxt(wpct)+'</td><td class="r">'+fmt(toff)+'</td><td class="r">'+money(tcost)+'</td></tr></tfoot></table></div>';
  body.querySelectorAll("tr.wk-row").forEach(tr=>{ tr.onclick=()=>goToDate(tr.getAttribute("data-date")); });
  const pv=document.getElementById("weekPrev"), nx=document.getElementById("weekNext"), td2=document.getElementById("weekToday");
  if(pv) pv.onclick=()=>{ weekAnchor=shiftDateISO(weekAnchor,-7); paintWeekPanel(); };
  if(nx) nx.onclick=()=>{ weekAnchor=shiftDateISO(weekAnchor,7); paintWeekPanel(); };
  if(td2) td2.onclick=()=>{ weekAnchor=weekStart(selected); paintWeekPanel(); };
}

/* ===== dashboard ===== */
function renderDash(){
  const host=document.getElementById("viewDash");
  const rec=ALL[selected], dates=allDates(), ids=shiftIds();
  let html='<div class="section-title" style="display:flex; gap:12px; flex-wrap:wrap; align-items:center; justify-content:space-between">'
    +'<span>'+prettyDate(selected)+(rec&&rec.updatedAt?' · saved '+new Date(rec.updatedAt).toLocaleString():'')+'</span>'
    +'<span class="seg" id="dashShiftSeg"></span></div>';

  if(!rec){
    html+='<div class="panel"><div class="empty"><h2>Nothing recorded for '+prettyDate(selected)+'</h2>'
      +'<p>Open the day sheet and fill the shifts you ran. The dashboard builds itself from what you save.</p>'
      +'<button class="act primary" id="goEntry">Open the day sheet</button></div></div>';
    html+=summaryPanelHTML()+weekPanelHTML()+historyPanelHTML();
    host.innerHTML=html;
    const b=document.getElementById("goEntry"); if(b) b.onclick=()=>switchView("entry");
    paintDashShiftSeg(); paintWeekPanel(); paintSummary(); paintHistory(dates); return;
  }

  const R=rollup(rec,ids);
  const perUnit=(R.ach>0&&R.cost>0)?R.cost/R.ach:null;
  html+='<div class="kpis">'
    +'<div class="kpi headline"><h3>Achievement'+(dashShift==="ALL"?"":" · "+dashShift)+'</h3><div class="v '+stat(R.pct)+'">'+pctTxt(R.pct)+'</div>'
    +'<div class="m">'+R.met+' of '+R.planned+' processes hit target</div></div>'
    +'<div class="kpi"><h3>Target</h3><div class="v">'+fmt(R.target)+'</div><div class="m">planned units</div></div>'
    +'<div class="kpi"><h3>Total production</h3><div class="v">'+fmt(R.ach)+'</div><div class="m">units produced</div></div>'
    +'<div class="kpi"><h3>Gap</h3><div class="v '+(R.gap>0?"bad":"good")+'">'+fmt(R.gap)+'</div>'
    +'<div class="m">'+(R.gap>0?"short of plan":"plan met or exceeded")+'</div></div></div>';

  html+=summaryPanelHTML();

  /* man power */
  html+='<div class="panel" style="margin-top:28px"><div class="panel-head"><div><h2>Man power</h2>'
    +'<p>Off-role heads and costing, shift by shift.</p></div></div><div class="pad"><div class="kpis" style="border:0">'
    +'<div class="kpi"><h3>Off-role heads</h3><div class="v">'+fmt(R.off)+'</div><div class="m">total on the day</div></div>'
    +'<div class="kpi"><h3>Man power cost</h3><div class="v">'+money(R.cost)+'</div><div class="m">total on the day</div></div>'
    +'<div class="kpi"><h3>Cost per unit</h3><div class="v">'+(perUnit===null?"—":"₹"+(Math.round(perUnit*100)/100))+'</div><div class="m">cost ÷ units produced</div></div>'
    +'<div class="kpi"><h3>Units per head</h3><div class="v">'+(R.off>0?Math.round(R.ach/R.off*10)/10:"—")+'</div><div class="m">output per off-role head</div></div>'
    +'</div></div></div>';

  /* shift cards */
  html+='<div class="section-title">Shifts on this day</div><div class="shiftgrid">';
  SHIFTS.forEach(s=>{
    const x=rollup(rec,[s.id]);
    html+='<div class="shiftcard" style="border-left-color:'+(x.pct===null?"var(--idle)":x.pct>=100?"var(--good)":x.pct>=90?"var(--warn)":"var(--bad)")+'">'
      +'<h3><span class="dot" style="background:'+s.color+'"></span>'+s.name+' <span style="color:var(--ink-3); font-weight:400; font-size:12.5px">'+s.hours+'</span></h3>'
      +'<div class="big '+ (x.pct===null?"":"") +'">'+(x.pct===null?"not run":pctTxt(x.pct))+'</div>'
      +'<dl><dt>Target</dt><dd>'+fmt(x.target)+'</dd><dt>Produced</dt><dd>'+fmt(x.ach)+'</dd>'
      +'<dt>Gap</dt><dd>'+(x.planned?fmt(x.gap):"—")+'</dd>'
      +'<dt>Off-role heads</dt><dd>'+fmt(x.off)+'</dd><dt>Man power cost</dt><dd>'+money(x.cost)+'</dd></dl></div>';
  });
  html+='</div>';

  html+=weekPanelHTML();

  /* line cards */
  html+='<div class="section-title">By production line'+(dashShift==="ALL"?"":" · "+dashShift)+'</div><div class="linegrid">';
  TEMPLATE.forEach(g=>{
    const L=lineRollup(rec,ids,g.line); let bars="";
    g.subs.forEach(sb=>sb.procs.forEach(p=>{
      let t=0,a=0,any=false;
      ids.forEach(id=>{const st=rowStats(((rec.shifts||{})[id]||{rows:{}}).rows[rowKey(g.line,sb.sub,p)]); if(st.planned){t+=st.target;a+=st.ach||0;any=true;}});
      const pct=any&&t>0?a/t*100:null, w=pct===null?0:Math.min(100,pct);
      bars+='<div class="barrow"><span class="lbl">'+sb.sub.replace("Line","L")+' · '+p+'</span>'
        +'<span class="track"><span class="fill '+stat(pct)+'" style="width:'+w+'%"></span></span>'
        +'<span class="val">'+(pct===null?"—":pctTxt(pct))+'</span></div>';
    }));
    html+='<div class="linecard" style="--line-accent:'+g.color+'"><h3><span class="dot"></span>'+g.line+'</h3><div class="meta">'+fmt(L.a)+' of '+fmt(L.t)+' units · '
      +'<span class="pill '+stat(L.pct)+'">'+(L.pct===null?"not planned":pctTxt(L.pct))+'</span></div>'
      +'<div class="bars">'+bars+'</div></div>';
  });
  html+='</div>';

  /* detail */
  let body="",cur=null;
  FLAT.forEach(f=>{
    if(f.line!==cur){cur=f.line; const lc=(TEMPLATE.find(g=>g.line===f.line)||{}).color||"var(--accent)";
      body+='<tr class="group"><td colspan="'+(dashShift==="ALL"?9:8)+'" style="border-left:3px solid '+lc+'">'+f.line+'</td></tr>';}
    ids.forEach(id=>{
      const r=((rec.shifts||{})[id]||{rows:{}}).rows[f.key]||{}; const st=rowStats(r);
      body+='<tr>'+(dashShift==="ALL"?'<td>'+id+'</td>':'')
        +'<td>'+f.sub+'</td><td>'+f.proc+'</td><td>'+(r.item||"—")+'</td>'
        +'<td class="r">'+fmt(st.target)+'</td><td class="r">'+fmt(st.ach)+'</td>'
        +'<td class="r" style="color:'+((st.planned&&st.gap>0)?"var(--bad)":"var(--ink)")+'">'+(st.planned?fmt(st.gap):"—")+'</td>'
        +'<td class="r"><span class="pill '+stat(st.pct)+'">'+(st.pct===null?"not planned":pctTxt(st.pct))+'</span></td>'
        +'<td>'+(st.pct===null?"Not planned":st.pct>=100?"On target":st.pct>=90?"Near target":"Behind")+'</td></tr>';
    });
  });
  html+='<div class="panel" style="margin-top:28px"><div class="panel-head"><div><h2>Process detail</h2>'
    +'<p>The day sheet exactly as recorded.</p></div><button class="act" id="csvBtn">Download CSV</button></div>'
    +'<div class="scroller"><table class="report"><thead><tr>'+(dashShift==="ALL"?'<th>Shift</th>':'')
    +'<th>Sub-line</th><th>Stage</th><th>Item</th><th style="text-align:right">Target</th>'
    +'<th style="text-align:right">Achievement</th><th style="text-align:right">Gap</th>'
    +'<th style="text-align:right">Achievement %</th><th>Status</th></tr></thead><tbody>'+body+'</tbody>'
    +'<tfoot><tr><td colspan="'+(dashShift==="ALL"?4:3)+'">Day total</td><td class="r">'+fmt(R.target)+'</td>'
    +'<td class="r">'+fmt(R.ach)+'</td><td class="r">'+fmt(R.gap)+'</td><td class="r">'+pctTxt(R.pct)+'</td><td></td></tr></tfoot></table></div></div>';

  /* trend */
  const tPoints=dates.slice(-14).map(d=>{const x=rollup(ALL[d],ids); return {label:prettyDate(d),short:d.slice(8)+"/"+d.slice(5,7),pct:x.pct===null?0:x.pct};});
  html+='<div class="panel" style="margin-top:28px"><div class="panel-head"><div><h2>Recent trend</h2>'
    +'<p>Achievement % over the last '+tPoints.length+' recorded day'+(tPoints.length===1?"":"s")+'.</p></div></div>'
    +'<div class="pad">'+svgTrend(tPoints)
    +'<div class="legend"><span><span class="swatch" style="background:var(--accent)"></span>Daily achievement %</span>'
    +'<span><span class="swatch" style="background:var(--good)"></span>100% target line</span></div></div></div>';

  html+=historyPanelHTML();
  host.innerHTML=html;
  paintDashShiftSeg(); paintWeekPanel(); paintSummary(); paintHistory(dates);
  const c=document.getElementById("csvBtn"); if(c) c.onclick=()=>exportDayCSV(rec);
}
function paintDashShiftSeg(){
  const seg=document.getElementById("dashShiftSeg"); if(!seg) return;
  seg.innerHTML="";
  [["ALL","All shifts"]].concat(SHIFTS.map(s=>[s.id,s.name])).forEach(([id,label])=>{
    const b=document.createElement("button"); b.textContent=label; b.setAttribute("aria-current",String(dashShift===id));
    b.onclick=()=>{dashShift=id; renderDash();}; seg.appendChild(b);
  });
}
function historyPanelHTML(){
  return '<div class="panel" style="margin-top:28px"><div class="panel-head"><div><h2>Saved days</h2>'
    +'<p>Pick a day to load its sheet and dashboard.</p></div></div><div class="pad"><div class="history" id="hist"></div></div></div>';
}
function paintHistory(dates){
  const h=document.getElementById("hist"); if(!h) return;
  if(!dates.length){h.innerHTML='<span class="status">Nothing saved yet.</span>'; return;}
  h.innerHTML="";
  dates.slice().reverse().forEach(d=>{
    const b=document.createElement("button"), x=rollup(ALL[d],shiftIds());
    b.textContent=d+"  ·  "+(x.pct===null?"—":Math.round(x.pct)+"%");
    if(d===selected) b.setAttribute("aria-current","true");
    b.onclick=()=>{selected=d; document.getElementById("dateInput").value=d; loadInto(d); renderDash();};
    h.appendChild(b);
  });
}

/* ===== CSV ===== */
function csvEsc(v){const s=String(v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
async function deliver(name,content,mime){
  mime=mime||"text/csv";
  try{ const dl=await claude.use("downloads"); if(dl){await dl.save({filename:name,data:content}); return;} }catch(e){}
  try{const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([content],{type:mime})); a.download=name; a.click(); URL.revokeObjectURL(a.href);}
  catch(e){await showAlert("Download is not available here.")}
}
async function exportDayCSV(rec){
  const head=["Month","Date","Shift","Production Line","Sub-Line","Man Power Off Role","Man Power Costing","PCB side/Etc","Item","Target","Achievement","Gap","Achievement %"];
  const lines=[head.join(",")];
  shiftIds().forEach(id=>{
    const sh=(rec.shifts||{})[id]||{rows:{},manpower:{}};
    FLAT.forEach(f=>{
      const r=sh.rows[f.key]||{}, st=rowStats(r), mp=(sh.manpower||{})[subKey(f.line,f.sub)]||{};
      lines.push([rec.month,rec.date,"Shift "+id,f.line,f.sub,mp.off||"",mp.cost||"",f.proc,r.item||"",
        st.target===null?"":st.target, st.ach===null?"":st.ach, st.planned?st.gap:"", st.pct===null?"":Math.round(st.pct*10)/10].map(csvEsc).join(","));
    });
  });
  await deliver("MIS_RREL_Ehoome_"+rec.date+".csv",lines.join("\n"));
}
async function exportSummaryCSV(){
  const groups=summaryGroups(), ids=shiftIds();
  const label=sumMode==="week"?"Week":sumMode==="month"?"Month":sumMode==="year"?"Year":"Date";
  const lines=[[label,"Shift scope","Total Production","Target","Achievement","Achievement %","Off-Role Manpower","Manpower Costing","Cost per Unit"].join(",")];
  groups.forEach(g=>{
    const x=aggregate(g.dates,ids);
    lines.push([g.label, dashShift==="ALL"?"All shifts":"Shift "+dashShift, x.a,x.t,x.a,
      x.pct===null?"":Math.round(x.pct*10)/10, x.off, Math.round(x.cost),
      (x.a>0&&x.cost>0)?Math.round(x.cost/x.a*100)/100:""].map(csvEsc).join(","));
  });
  lines.push("");
  lines.push(["Shift","Total Production","Target","Achievement %","Off-Role Manpower","Manpower Costing"].join(","));
  SHIFTS.forEach(s=>{
    const x=aggregate(scopeDates(),[s.id]);
    lines.push(["Shift "+s.id,x.a,x.t,x.pct===null?"":Math.round(x.pct*10)/10, x.off, Math.round(x.cost)].map(csvEsc).join(","));
  });
  await deliver("MIS_RREL_Ehoome_"+sumMode+"_summary.csv",lines.join("\n"));
}

/* ===== visual report (charts) ===== */
function svgBarCompare(groups,ids){
  const w=860,h=300,pl=52,pr=16,pt=20,pb=54;
  const data=groups.map(g=>aggregate(g.dates,ids));
  const max=Math.max(1,...data.map(x=>Math.max(x.t,x.a)));
  const n=groups.length, gw=(w-pl-pr)/n, barW=Math.min(28,gw*0.32);
  const Y=v=>pt+(1-v/max)*(h-pt-pb);
  let grid="", bars="", labels="";
  [0,0.25,0.5,0.75,1].forEach(f=>{
    const v=max*f;
    grid+='<line x1="'+pl+'" y1="'+Y(v)+'" x2="'+(w-pr)+'" y2="'+Y(v)+'" stroke="#E6EBEF" stroke-width="1"/>'
      +'<text x="'+(pl-8)+'" y="'+(Y(v)+4)+'" text-anchor="end" font-size="11" fill="#7A8894" font-family="IBM Plex Mono,monospace">'+Math.round(v).toLocaleString("en-IN")+'</text>';
  });
  groups.forEach((g,i)=>{
    const x=pl+i*gw+gw/2, x1=x-barW-3, x2=x+3;
    const yT=Y(data[i].t), yA=Y(data[i].a);
    bars+='<rect x="'+x1+'" y="'+yT+'" width="'+barW+'" height="'+(h-pb-yT)+'" fill="#2563EB" rx="3"><title>'+g.label+' target: '+data[i].t.toLocaleString("en-IN")+'</title></rect>'
        +'<rect x="'+x2+'" y="'+yA+'" width="'+barW+'" height="'+(h-pb-yA)+'" fill="'+(data[i].a>=data[i].t&&data[i].t>0?"#0F766E":"#D97706")+'" rx="3"><title>'+g.label+' achieved: '+data[i].a.toLocaleString("en-IN")+'</title></rect>';
    const every=Math.max(1,Math.ceil(n/10));
    if(i%every===0||i===n-1) labels+='<text x="'+x+'" y="'+(h-pb+18)+'" text-anchor="middle" font-size="10.5" fill="#7A8894" font-family="IBM Plex Mono,monospace">'+String(g.short||g.label).slice(0,8)+'</text>';
  });
  return '<svg viewBox="0 0 '+w+' '+h+'" style="width:100%; height:auto" role="img">'+grid+bars+labels+'</svg>';
}
function svgLineCompare(groups,ids){
  const w=860,h=220,pl=48,pr=16,pt=18,pb=32;
  const pts=groups.map(g=>{const x=aggregate(g.dates,ids); return x.pct===null?0:x.pct;});
  const max=Math.max(110,...pts);
  const X=i=>groups.length===1?(w-pl-pr)/2+pl:pl+i*(w-pl-pr)/(groups.length-1);
  const Y=v=>pt+(1-v/max)*(h-pt-pb);
  let grid="";
  [0,50,100].forEach(v=>{ if(v>max) return;
    grid+='<line x1="'+pl+'" y1="'+Y(v)+'" x2="'+(w-pr)+'" y2="'+Y(v)+'" stroke="#E6EBEF"/>'
      +'<text x="'+(pl-8)+'" y="'+(Y(v)+4)+'" text-anchor="end" font-size="11" fill="#7A8894" font-family="IBM Plex Mono,monospace">'+v+'%</text>';
  });
  grid+='<line x1="'+pl+'" y1="'+Y(100)+'" x2="'+(w-pr)+'" y2="'+Y(100)+'" stroke="#12784A" stroke-dasharray="4 4" opacity=".6"/>';
  const path=pts.map((v,i)=>(i?"L":"M")+X(i)+" "+Y(v)).join(" ");
  const dots=pts.map((v,i)=>'<circle cx="'+X(i)+'" cy="'+Y(v)+'" r="3.5" fill="#fff" stroke="#2563EB" stroke-width="2"><title>'+groups[i].label+": "+(Math.round(v*10)/10)+'%</title></circle>').join("");
  return '<svg viewBox="0 0 '+w+' '+h+'" style="width:100%; height:auto" role="img">'+grid+'<path d="'+path+'" fill="none" stroke="#2563EB" stroke-width="2.5" stroke-linejoin="round"/>'+dots+'</svg>';
}
function svgShiftBars(dates){
  const w=860,h=180,pl=100,pr=16,pt=16,pb=16;
  const rows=SHIFTS.map(s=>({s,x:aggregate(dates,[s.id])}));
  const max=Math.max(1,...rows.map(r=>r.x.a));
  const rh=(h-pt-pb)/rows.length;
  let bars="";
  rows.forEach((r,i)=>{
    const y=pt+i*rh+rh*0.22, bh=rh*0.56;
    const bw=(w-pl-pr)*(r.x.a/max);
    bars+='<text x="'+(pl-10)+'" y="'+(y+bh*0.72)+'" text-anchor="end" font-size="12" fill="#16202B" font-family="IBM Plex Sans">'+r.s.name+'</text>'
      +'<rect x="'+pl+'" y="'+y+'" width="'+(w-pl-pr)+'" height="'+bh+'" fill="#E6EBEF" rx="4"/>'
      +'<rect x="'+pl+'" y="'+y+'" width="'+bw+'" height="'+bh+'" fill="'+r.s.color.replace("var(--c-shiftA)","#2563EB").replace("var(--c-shiftB)","#D97706").replace("var(--c-shiftC)","#0891B2")+'" rx="4"/>'
      +'<text x="'+(pl+bw+8)+'" y="'+(y+bh*0.72)+'" font-size="11.5" fill="#4A5A6A" font-family="IBM Plex Mono,monospace">'+r.x.a.toLocaleString("en-IN")+' units</text>';
  });
  return '<svg viewBox="0 0 '+w+' '+h+'" style="width:100%; height:auto" role="img">'+bars+'</svg>';
}
async function exportSummaryReport(){
  const groups=summaryGroups(), ids=shiftIds(), dates=scopeDates(), total=aggregate(dates,ids);
  const perUnit=(total.a>0&&total.cost>0)?total.cost/total.a:null;
  const scopeLabel=(sumMode==="week"?"Week-wise":sumMode==="month"?"Month-wise":sumMode==="year"?"Year-wise":sumMode==="custom"?"Custom range":"Date-wise")
    +" · "+(dashShift==="ALL"?"All shifts":"Shift "+dashShift);
  let rows="";
  groups.forEach(g=>{
    const x=aggregate(g.dates,ids);
    rows+='<tr><td>'+escapeHtml(g.label)+'</td><td class="r">'+fmt(x.t)+'</td><td class="r">'+fmt(x.a)+'</td>'
      +'<td class="r">'+(x.t-x.a>0?fmt(x.t-x.a):"0")+'</td><td class="r">'+pctTxt(x.pct)+'</td>'
      +'<td class="r">'+fmt(x.off)+'</td><td class="r">'+money(x.cost)+'</td></tr>';
  });
  const html='<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ehoome Production Report</title>'
    +'<style>'
    +'@page{size:A4 landscape;margin:12mm}'
    +'*{box-sizing:border-box} body{font-family:"Segoe UI",Arial,sans-serif;margin:0;background:#F3F6FA;color:#10243A;-webkit-font-smoothing:antialiased}'
    +'.wrap{max-width:1060px;margin:0 auto;padding:34px 26px 64px}'
    +'.hdr{position:relative;overflow:hidden;background:linear-gradient(120deg,#081B2E 0%,#103B5E 60%,#0B6671 100%);color:#fff;padding:30px 32px;border-radius:16px;margin-bottom:22px;box-shadow:0 16px 40px -24px #071625}'
    +'.hdr:after{content:"";position:absolute;width:240px;height:240px;border-radius:50%;right:-80px;top:-120px;background:rgba(255,255,255,.08)}'
    +'.brandrow{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:10px;font-weight:700;color:#93C5FD;margin-bottom:7px}'
    +'.hdr h1{margin:0 0 7px;font-size:25px;letter-spacing:-.02em}.hdr p{margin:0;color:#C2D6E8;font-size:13px}.docmeta{text-align:right;font-size:11px;color:#C2D6E8;line-height:1.65;white-space:nowrap}'
    +'.insight{display:flex;align-items:center;justify-content:space-between;gap:16px;background:#EAF1FF;border:1px solid #C9D9FF;color:#24436B;padding:13px 16px;border-radius:11px;margin-bottom:20px;font-size:13px}.insight strong{color:#163A6B}'
    +'.status{display:inline-block;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:700;background:'+((total.pct||0)>=100?'#E1F4F1;color:#0F766E':(total.pct||0)>=90?'#FFF1D6;color:#B45309':'#FDE8E6;color:#C2413A')+'}'
    +'.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}.kpi{background:#fff;padding:17px 18px;border:1px solid #D4DEE9;border-radius:12px;box-shadow:0 8px 24px -22px #10243A;border-top:3px solid #2563EB}'
    +'.kpi h3{margin:0 0 7px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:#7C8DA0}.kpi .v{font-family:"Consolas",monospace;font-size:25px;font-weight:700;color:#10243A}'
    +'.panel{background:#fff;border:1px solid #D4DEE9;border-radius:13px;padding:20px 22px;margin-bottom:22px;box-shadow:0 10px 28px -25px #10243A;break-inside:avoid}'
    +'.panel h2{margin:0 0 4px;font-size:16px;color:#10243A}.panel p.sub{margin:0 0 15px;font-size:12px;color:#7C8DA0}'
    +'.legend{font-size:11.5px;color:#4B6075;margin-top:9px}.sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}'
    +'table{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px;border:1px solid #D4DEE9;border-radius:9px;overflow:hidden}thead{display:table-header-group}'
    +'th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#5E7185;padding:9px 10px;border-bottom:1px solid #D4DEE9;background:#EEF3F8;white-space:nowrap}'
    +'td{padding:9px 10px;border-bottom:1px solid #E7EDF4}tbody tr:nth-child(even){background:#F9FBFD}tbody tr:last-child td{border-bottom:0}.r{text-align:right;font-family:"Consolas",monospace}'
    +'.footer{display:flex;justify-content:space-between;gap:20px;border-top:1px solid #D4DEE9;margin-top:28px;padding-top:12px;color:#7C8DA0;font-size:10.5px}'
    +'.printbtn{position:fixed;top:18px;right:18px;z-index:5;background:#2563EB;color:#fff;border:0;padding:11px 17px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 8px 22px -12px #10243A}'
    +'@media(max-width:760px){.kpis{grid-template-columns:repeat(2,1fr)}.brandrow{flex-direction:column}.docmeta{text-align:left}.wrap{padding:18px 12px}.panel{overflow:auto}}'
    +'@media print{body{background:#fff}.wrap{max-width:none;padding:0}.hdr,.panel,.kpi{box-shadow:none}.printbtn{display:none}.panel{break-inside:avoid}.footer{position:relative}}'
    +'</style></head><body>'
    +'<button class="printbtn" onclick="window.print()">Print / Save as PDF</button>'
    +'<div class="wrap">'
    +'<div class="hdr"><div class="brandrow"><div><div class="eyebrow">Management Information System</div><h1>RREL · Ehoome Production Performance</h1><p>'+escapeHtml(scopeLabel)+'</p></div>'
    +'<div class="docmeta"><strong>PRODUCTION REPORT</strong><br>Generated '+new Date().toLocaleString()+(session?'<br>Prepared by '+escapeHtml(session.displayName):'')+'</div></div></div>'
    +'<div class="insight"><span><strong>Executive summary:</strong> '+fmt(total.a)+' units produced against '+fmt(total.t)+' planned across '+dates.length+' recorded day'+(dates.length===1?'':'s')+'.</span><span class="status">'+(total.pct===null?'NOT PLANNED':total.pct>=100?'TARGET ACHIEVED':total.pct>=90?'NEAR TARGET':'ACTION REQUIRED')+'</span></div>'
    +'<div class="kpis">'
    +'<div class="kpi"><h3>Total production</h3><div class="v">'+fmt(total.a)+'</div></div>'
    +'<div class="kpi"><h3>Target</h3><div class="v">'+fmt(total.t)+'</div></div>'
    +'<div class="kpi"><h3>Achievement</h3><div class="v">'+pctTxt(total.pct)+'</div></div>'
    +'<div class="kpi"><h3>Cost / unit</h3><div class="v">'+(perUnit===null?"—":"₹"+(Math.round(perUnit*100)/100))+'</div></div>'
    +'</div>'
    +'<div class="panel"><h2>Target vs Achievement</h2><p class="sub">By '+(sumMode==="week"?"week":sumMode==="month"?"month":sumMode==="year"?"year":"date")+'</p>'
    +svgBarCompare(groups,ids)
    +'<div class="legend"><span class="sw" style="background:#2563EB"></span>Target &nbsp; <span class="sw" style="background:#0F766E"></span>Achieved (on target) &nbsp; <span class="sw" style="background:#D97706"></span>Achieved (below target)</div></div>'
    +'<div class="panel"><h2>Achievement % trend</h2><p class="sub">100% line shown in green</p>'+svgLineCompare(groups,ids)+'</div>'
    +'<div class="panel"><h2>Output by shift</h2><p class="sub">Total units produced in this scope</p>'+svgShiftBars(dates)+'</div>'
    +'<div class="panel"><h2>Data</h2><p class="sub">Underlying figures for every row in the chart above</p>'
    +'<table><thead><tr><th>'+(sumMode==="week"?"Week":sumMode==="month"?"Month":sumMode==="year"?"Year":"Date")+'</th>'
    +'<th class="r">Target</th><th class="r">Achievement</th><th class="r">Gap</th><th class="r">Achievement %</th>'
    +'<th class="r">Off-role man power</th><th class="r">Man power cost</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    +'<div class="footer"><span>RREL · Ehoome Production MIS</span><span>Internal management report · '+escapeHtml(scopeLabel)+'</span></div>'
    +'</div></body></html>';
  await deliver("RREL_Ehoome_Production_Report_"+sumMode+"_"+todayISO()+".html",html,"text/html");
}

/* ===== wiring ===== */
function switchView(v){
  if(v==="users" && (!session||session.role!=="master")) v="dash";
  if(v==="entry"&&session&&session.role!=="master"&&accessWindow){
    selected=accessWindow.date; shift=accessWindow.shift; document.getElementById("dateInput").value=selected; loadInto(selected);
  }
  const e=v==="entry", u=v==="users", d=!e&&!u;
  document.getElementById("viewEntry").hidden=!e;
  document.getElementById("viewDash").hidden=!d;
  document.getElementById("viewUsers").hidden=!u;
  document.getElementById("tabEntry").setAttribute("aria-selected",String(e));
  document.getElementById("tabDash").setAttribute("aria-selected",String(d));
  document.getElementById("tabUsers").setAttribute("aria-selected",String(u));
  const restricted=e&&session&&session.role!=="master";
  ["dateInput","prevDay","nextDay","calBtn"].forEach(id=>{ document.getElementById(id).disabled=!!restricted; });
  if(d) renderDash();
  if(u) renderUsers();
}
function loadInto(date){
  current=cloneDay(ALL[date],date); dirty=false;
  document.getElementById("entryTitle").textContent="Day sheet · "+prettyDate(date);
  const notice=document.getElementById("accessNotice");
  if(session&&session.role==="master") notice.textContent="Master access · You can manage every date and all three shifts.";
  else if(accessWindow) notice.textContent="Operator access · You can edit only Shift "+accessWindow.shift+" ("+accessWindow.hours+") for "+prettyDate(accessWindow.date)+" · "+accessWindow.timezone;
  else notice.textContent="Loading your active shift access…";
  buildShiftSeg(); buildEntry();
  setStatus(ALL[date]?("Saved"+(ALL[date].updatedAt?" "+new Date(ALL[date].updatedAt).toLocaleString():"")):"Not saved yet", ALL[date]?"ok":"");
}
document.getElementById("tabEntry").onclick=()=>switchView("entry");
document.getElementById("tabDash").onclick=()=>switchView("dash");
document.getElementById("tabUsers").onclick=()=>switchView("users");
document.getElementById("dateInput").addEventListener("change",e=>goToDate(e.target.value));
document.getElementById("saveBtn").onclick=async function(){
  this.disabled=true; setStatus("Saving…","");
  const p=JSON.parse(JSON.stringify(current));
  p.updatedAt=new Date().toISOString();
  p.month=MONTHS[Number(selected.slice(5,7))-1]; p.year=selected.slice(0,4);
  try{ await saveDay(selected,p); ALL[selected]=p; dirty=false;
    setStatus("Saved "+new Date(p.updatedAt).toLocaleTimeString(),"ok"); switchView("dash"); }
  catch(e){ setStatus("Could not save: "+((e&&e.message)||"unknown error")+". Your entries are still on screen.","err"); }
  this.disabled=false;
};
document.getElementById("clearBtn").onclick=async function(){
  if(!session||session.role!=="master"){ await showAlert("Only a master account can clear a day."); return; }
  if(!await askConfirm("Clear all three shifts for "+prettyDate(selected)+"?","Clear day")) return;
  await deleteDay(selected); delete ALL[selected]; loadInto(selected); renderDash();
};
document.getElementById("copyShiftBtn").onclick=function(){
  const src=JSON.parse(JSON.stringify(current.shifts[shift]));
  SHIFTS.forEach(s=>{ if(s.id!==shift) current.shifts[s.id]=JSON.parse(JSON.stringify(src)); });
  markDirty(); setStatus("Shift "+shift+" copied to the other two shifts. Edit each one as needed.","");
};
document.getElementById("copyPrevBtn").onclick=function(){
  const prev=Object.keys(ALL).filter(d=>d<selected).sort().pop();
  if(!prev){ setStatus("No earlier day saved to copy from.","err"); return; }
  const src=ALL[prev];
  SHIFTS.forEach(s=>{
    const ss=(src.shifts||{})[s.id]; if(!ss) return;
    Object.keys(current.shifts[s.id].rows).forEach(k=>{
      if(ss.rows&&ss.rows[k]){ current.shifts[s.id].rows[k].target=ss.rows[k].target||""; current.shifts[s.id].rows[k].item=ss.rows[k].item||""; }
    });
    Object.keys(current.shifts[s.id].manpower).forEach(k=>{ if(ss.manpower&&ss.manpower[k]) current.shifts[s.id].manpower[k]=Object.assign({},ss.manpower[k]); });
  });
  buildEntry(); markDirty();
  setStatus("Targets, items and man power copied from "+prev+" for all shifts. Achievement left blank.","");
};
async function refreshAccess(){
  accessWindow=await apiRequest("/access");
  if(session.role!=="master"){ selected=accessWindow.date; shift=accessWindow.shift; }
  return accessWindow;
}
async function startApp(){
  document.getElementById("authOverlay").style.display="none";
  document.getElementById("appRoot").hidden=false;
  applySessionToUI();
  try{ await refreshAccess(); await initApp(); }
  catch(e){ setDatabaseStatus(false); await showAlert("The application could not start: "+e.message); }
}
async function initApp(){
  document.getElementById("dateInput").value=selected;
  ALL=lsAll(); Object.keys(ALL).forEach(d=>ALL[d]=migrate(ALL[d],d));
  loadInto(selected); switchView("dash");
  try{ const old=JSON.parse(localStorage.getItem("ehoome_mis_v1")||"{}");
       Object.keys(old).forEach(d=>{ if(!ALL[d]) lsPut(d,migrate(old[d],d)); }); }catch(e){}
  ALL=await loadAll();
  const ds=allDates(); rangeFrom=ds[0]||todayISO(); rangeTo=ds[ds.length-1]||todayISO();
  loadInto(selected);
  if(document.getElementById("viewEntry").hidden) renderDash();
  startDayRollover();
}
/* If the app stays open across midnight, move the date forward to the new day automatically. */
async function checkDayRollover(){
  if(session&&session.role!=="master"){
    try{
      const previous=accessWindow?accessWindow.date+accessWindow.shift:"";
      await refreshAccess();
      if(!dirty&&previous!==accessWindow.date+accessWindow.shift){
        selected=accessWindow.date; shift=accessWindow.shift; document.getElementById("dateInput").value=selected; loadInto(selected);
      }
    }catch(e){ setDatabaseStatus(false); }
    return;
  }
  const now=todayISO();
  if(now!==selected && !dirty){ goToDate(now); }
}
function startDayRollover(){
  if(window.__dayWatch) clearInterval(window.__dayWatch);
  window.__dayWatch=setInterval(checkDayRollover,60000);
  if(!window.__dayWatchListeners){
    window.__dayWatchListeners=true;
    document.addEventListener("visibilitychange",()=>{ if(!document.hidden && session) checkDayRollover(); });
    window.addEventListener("focus",()=>{ if(session) checkDayRollover(); });
  }
}
window.addEventListener("beforeunload",e=>{
  if(dirty){ e.preventDefault(); e.returnValue=""; }
});
/* boot */
(async function(){
  checkDatabaseHealth();
  window.__healthWatch=setInterval(checkDatabaseHealth,30000);
  await bootAuth();
})();
