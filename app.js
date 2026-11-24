"use strict";
// F-031 Sinker Filter Change / Maintenance - online log.
// The page is public and holds no records. The log is one JSON file in a private GitHub repo, read and written with a
// token that only reaches that repo. The token is stored here encrypted with the shop password (config.js), and
// "Remember me" keeps the unlocked token on this device only. Every save is a commit, so GitHub keeps the full history.

const APP="F-031 Filter Change Log";
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const today=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const fmtDate=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||"");return m?`${+m[2]}/${+m[3]}/${m[1]}`:esc(s)};
const say=(el,cls,txt)=>{el.innerHTML=txt?`<div class="msg ${cls}">${txt}</div>`:"";};
const LS={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}},del:k=>{try{localStorage.removeItem(k)}catch(e){}}};
const CFG=window.F031_CONFIG||null;

// ---------- the shared log ----------
function blank(){ return {app:APP,v:1,company:"",logo:"",btnTypes:{},btnStock:{},stock:[],stockLog:[],machines:[],options:["Filters changed"],others:[],form:"F-031",rev:"-",entries:[],deleted:[]}; }
let D=blank(), SHA=null, TOKEN=null;
const mySign=()=>LS.get("f031sign")||"";
const hrs=v=>{ const m=/^\s*(\d+(?:\.\d+)?)(?::(\d{1,2}))?\s*$/.exec(String(v??"")); return m?(+m[1])+(m[2]?+m[2]/60:0):NaN; };
const isOther=n=>(D.others||[]).includes(n);
const fCol=e=>(e.filters||[]).filter(n=>!isOther(n)).join(", ");
const oCol=e=>[...(e.filters||[]).filter(isOther),e.other].filter(Boolean).join(", ");
// machine types: a machine's own Type, or its name without the number on the end ("CHMER 4" -> CHMER)
const autoType=n=>{ const w=String(n||"").trim().split(/\s+/)[0]||""; return w.replace(/[#._-]*\d+[a-z]?$/i,"")||w; };   // first word: "CHMER CM 655C-3" -> CHMER
const typeOf=m=>(m&&(m.type||"").trim())||autoType(m&&m.name);
const sameT=(a,b)=>String(a).trim().toLowerCase()===String(b).trim().toLowerCase();
const allTypes=()=>{ const s=[]; D.machines.forEach(m=>{ const t=typeOf(m); if(t&&!s.some(x=>sameT(x,t))) s.push(t); }); return s; };
const btnOn=(o,t)=>{ const T=allTypes(), L=((D.btnTypes||{})[o]||[]).filter(x=>T.some(y=>sameT(x,y)));   // types no machine has any more are ignored
  return !L.length||L.some(x=>sameT(x,t)); };   // no types picked = shows on every machine
// ---------- filter stock: on hand = last physical count + received since - used by entries since ----------
// Usage is worked out from the entries every time, so editing or deleting an entry corrects the count by itself.
// An entry counts against stock only if it was entered after the count AND is dated on or after the count's day,
// so typing in old paper records never touches the stock.
const dayOf=iso=>{ const d=new Date(iso); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
const btnUse=o=>{ const u=(D.btnStock||{})[o]; return u&&(D.stock||[]).some(s=>s.id===u.item)&&u.qty>0?u:null; };
function stockBase(it){ const c=(D.stockLog||[]).filter(e=>e.item===it.id&&e.kind==="count").sort((x,y)=>x.at<y.at?-1:1).pop();
  return c?{qty:c.qty,at:c.at,by:c.by}:{qty:0,at:it.at,by:""}; }
function stockUsed(it,b){ const day=dayOf(b.at); let n=0, list=[];
  D.entries.forEach(e=>{ if(!(e.at>b.at&&e.date>=day)) return; let q=0; (e.filters||[]).forEach(o=>{ const u=btnUse(o); if(u&&u.item===it.id) q+=u.qty; }); if(q){ n+=q; list.push({e,q}); } });
  return {n,list}; }
function onHand(it){ const b=stockBase(it), recv=(D.stockLog||[]).filter(e=>e.item===it.id&&e.kind==="recv"&&e.at>b.at).reduce((s,e)=>s+e.qty,0);
  return {qty:b.qty+recv-stockUsed(it,b).n, base:b, recv}; }
const machName=id=>(D.machines.find(m=>m.id===id)||{}).name||"(removed machine)";
const sorted=mid=>D.entries.filter(e=>e.mach===mid).sort((a,b)=>(a.date<b.date?-1:a.date>b.date?1:0)||((hrs(a.hours)||0)-(hrs(b.hours)||0))||(a.at<b.at?-1:1));

// ---------- GitHub ----------
const b64e=s=>{ const b=new TextEncoder().encode(s); let t=""; for(let i=0;i<b.length;i+=0x8000) t+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000)); return btoa(t); };
const b64d=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g,"")),c=>c.charCodeAt(0)));
const api=(path,opt={})=>fetch(`https://api.github.com/repos/${CFG.owner}/${CFG.repo}/${path}`,{...opt,headers:{"Authorization":"Bearer "+TOKEN,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",...(opt.headers||{})}});
async function pull(){ // read the log; a missing file is an empty log
  const r=await api(`contents/${encodeURIComponent(CFG.path).replace(/%2F/g,"/")}?ref=${encodeURIComponent(CFG.branch||"main")}&t=${Date.now()}`,{cache:"no-store"});
  if(r.status===404) return {d:blank(),sha:null};
  if(r.status===401||r.status===403) throw Object.assign(new Error("auth"),{auth:true});
  if(!r.ok) throw new Error("GitHub answered "+r.status);
  const j=await r.json(); let d; try{ d=JSON.parse(b64d(j.content)); }catch(e){ throw new Error("The log file on GitHub isn't readable."); }
  return {d:Object.assign(blank(),d),sha:j.sha};
}
async function push(d,sha,msg){
  const body={message:msg,content:b64e(JSON.stringify(d,null,1)),branch:CFG.branch||"main"}; if(sha) body.sha=sha;
  const r=await api(`contents/${encodeURIComponent(CFG.path).replace(/%2F/g,"/")}`,{method:"PUT",body:JSON.stringify(body),headers:{"Content-Type":"application/json"}});
  if(r.status===409||r.status===422) return null;          // someone saved first: pull and apply again
  if(r.status===401||r.status===403) throw Object.assign(new Error("auth"),{auth:true});
  if(!r.ok) throw new Error("GitHub answered "+r.status);
  return (await r.json()).content.sha;
}
// every change is a small function applied to the newest log; if another device saved in between, it's applied again on top of theirs
let busy=false;
// saves line up one after another, so a change made while another is still saving is never lost
let saveChain=Promise.resolve();
function commit(op,msg){ const p=saveChain.then(()=>commitNow(op,msg)); saveChain=p.catch(()=>{}); return p; }
async function commitNow(op,msg){
  busy=true; document.body.classList.add("busy"); setSync("Saving...");
  try{
    for(let tries=0;tries<4;tries++){
      const {d,sha}=tries?await pull():{d:JSON.parse(JSON.stringify(D)),sha:SHA};
      if(op(d)===false) return false;
      const ns=await push(d,sha,msg);
      if(ns){ D=d; SHA=ns; setSync(); renderAll(); return true; }
    }
    throw new Error("The log kept changing while saving. Try again.");
  }catch(e){ failed(e); return false; }
  finally{ busy=false; document.body.classList.remove("busy"); }
}
async function refresh(quiet){
  if(busy||!TOKEN) return; try{ const {d,sha}=await pull(); if(sha!==SHA){ D=d; SHA=sha; renderAll(); } setSync(); }
  catch(e){ if(!quiet) failed(e); else setSync("Couldn't reach the log. Check the Wi-Fi."); }
}
function failed(e){
  if(e&&e.auth){ TOKEN=null; LS.del("f031token"); showLock("The log refused this device's key, probably because the key was changed. Enter the shop password again."); return; }
  setSync(`<span style="color:var(--bad)">Not saved: ${esc(e&&e.message||e)}. Nothing was lost on this screen; try again.</span>`);
}
function setSync(t){ $("syncLine").innerHTML=t||`Online log &middot; up to date ${new Date().toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})} &middot; <a href="#" id="syncNow">refresh</a>`;
  const a=$("syncNow"); if(a) a.onclick=ev=>{ev.preventDefault();refresh(false);}; }

// ---------- unlock ----------
async function unlockToken(pw){ const L=CFG.lock, u=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]);
  const key=await crypto.subtle.deriveKey({name:"PBKDF2",salt:u(L.salt),iterations:L.iter,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:u(L.iv)},key,u(L.ct))); }
// settings (machines, buttons, form, import) need the admin password; its check value is in config.js, which the shop key can't change
let adminOK=false;
async function adminHash(pw){ const A=CFG.admin, u=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveBits"]);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt:u(A.salt),iterations:A.iter,hash:"SHA-256"},base,256));
  return btoa(String.fromCharCode(...bits)); }
function adminView(){ $("sAdminLock").hidden=adminOK; $("sAdmin").hidden=!adminOK; document.querySelectorAll(".adminOnly").forEach(e=>e.hidden=!adminOK); }
function showLock(msg){ try{ const c=JSON.parse(LS.get("f031brand")||"null"); if(c&&!TOKEN){ const k=D; D=Object.assign(blank(),c); showBrand(); D=k; } }catch(e){} $("app").hidden=true; $("lockScreen").hidden=false; say($("lkMsg"),msg?"warn":"",msg||""); setTimeout(()=>$("lkPw").focus(),50); }
async function open_(){ $("lockScreen").hidden=true; $("app").hidden=false; setSync("Loading the log...");
  try{ const {d,sha}=await pull(); D=d; SHA=sha; setSync(); renderAll(); pickFromLink();
    if(!D.machines.length){ document.querySelector('nav button[data-tab="setup"]').click(); say($("sMsg"),"warn",adminOK?"First time here: add your machines, then go to New entry.":"No machines yet. Unlock settings with the admin password to add them."); } }
  catch(e){ failed(e); } }
$("sAdGo").addEventListener("click",async()=>{ const pw=$("sAdPw").value; if(!pw) return;
  const h=await adminHash(pw); if(h!==CFG.admin.hash) return say($("sAdMsg"),"bad","That isn't the admin password.");
  adminOK=true; $("sAdPw").value=""; hidePw(); say($("sAdMsg")); if($("sAdKeep").checked) LS.set("f031admin",h); adminView(); renderSetup(); });
$("sAdPw").addEventListener("keydown",e=>{ if(e.key==="Enter") $("sAdGo").click(); });
$("sAdLock").addEventListener("click",()=>{ adminOK=false; LS.del("f031admin"); adminView(); say($("sMsg")); });
$("lkGo").addEventListener("click",async()=>{ const pw=$("lkPw").value; if(!pw) return;
  try{ TOKEN=await unlockToken(pw); }catch(e){ return say($("lkMsg"),"bad","That isn't the shop password."); }
  if($("lkRemember").checked) LS.set("f031token",TOKEN); $("lkPw").value=""; hidePw(); open_(); });
$("lkPw").addEventListener("keydown",e=>{ if(e.key==="Enter") $("lkGo").click(); });
$("sForget").addEventListener("click",()=>{ LS.del("f031token"); TOKEN=null; showLock("Signed out on this device."); });

// ---------- tabs ----------
document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("on",x===b));
  ["entry","records","setup"].forEach(t=>$("tab-"+t).hidden=t!==b.dataset.tab);
  renderAll();
}));
function fillMach(sel,keep){ const cur=keep||sel.value||LS.get("f031mach");
  sel.innerHTML=D.machines.length?D.machines.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join(""):`<option value="">Add a machine in Setup first</option>`;
  if(D.machines.some(m=>m.id===cur)) sel.value=cur; }

// ---------- new entry / edit ----------
let picked=new Set(), editId=null;
function renderChips(){
  const mt=typeOf(D.machines.find(m=>m.id===$("eMach").value));
  const grp=(el,all,none)=>{ const list=all.filter(o=>picked.has(o)||btnOn(o,mt)); el.innerHTML=list.map((o,i)=>`<button type="button" class="chip${picked.has(o)?" on":""}" data-i="${i}">${esc(o)}</button>`).join("")||`<span class="hint">${none}</span>`;
    el.querySelectorAll(".chip").forEach(c=>c.addEventListener("click",()=>{ const o=list[+c.dataset.i]; picked.has(o)?picked.delete(o):picked.add(o); renderChips(); })); };
  const need={}; [...picked].forEach(o=>{ const u=btnUse(o); if(u) need[u.item]=(need[u.item]||0)+u.qty; });
  $("eStock").innerHTML=Object.entries(need).map(([id,q])=>{ const it=D.stock.find(s=>s.id===id), h=onHand(it).qty, left=editId?null:h-q;
    return `<div class="stockln${left!==null&&left<0?" bad":left!==null&&it.low&&left<=it.low?" warn":""}">Takes ${q} ${esc(it.name)} from stock &middot; ${h} on hand${left!==null?` &middot; ${left} after this entry`:""}${left!==null&&left<0?" (more than the count shows; tell the admin)":left!==null&&it.low&&left<=it.low?" (low, time to order)":""}</div>`; }).join("");
  grp($("eChips"),D.options,`No filter buttons set for ${esc(mt||"this machine")}. Add them in Setup.`); grp($("eChipsO"),D.others||[],"Nothing set here for this machine type. Write it below."); }
function rowHtml(e,act){ return `<tr><td class="mono">${esc(e.hours)}</td><td class="mono">${fmtDate(e.date)}</td><td>${esc(e.sign)}</td><td>${esc(fCol(e))}</td><td>${esc(oCol(e))}${e.ed?` <span class="hint">(edited)</span>`:""}</td>${act?`<td style="white-space:nowrap"><button type="button" class="btn alt small" data-edit="${esc(e.id)}">Edit</button> <button type="button" class="btn danger small" data-del="${esc(e.id)}">Delete</button></td>`:""}</tr>`; }
function renderEntry(){ fillMach($("eMach")); renderChips();
  if(!$("eDate").value) $("eDate").value=today();
  if(!$("eSign").value) $("eSign").value=mySign();
  const L=D.entries.filter(e=>e.mach===$("eMach").value).sort((a,b)=>(a.ed||a.at||"")<(b.ed||b.at||"")?1:-1).slice(0,5);
  $("eRecent").innerHTML=L.length?L.map(e=>rowHtml(e,false)).join(""):`<tr><td colspan="5" class="hint">No entries yet for this machine.</td></tr>`; }
$("eMach").addEventListener("change",()=>{ LS.set("f031mach",$("eMach").value); $("rMach").value=$("eMach").value; if(!editId){ say($("eMsg")); const mt=typeOf(D.machines.find(m=>m.id===$("eMach").value)); [...picked].forEach(o=>{ if(!btnOn(o,mt)) picked.delete(o); }); } renderEntry(); });
function editMode(on){ $("eSave").textContent=on?"Save changes":"Save entry"; $("eCancel").hidden=!on; document.querySelector('nav button[data-tab="entry"]').textContent=on?"Edit entry":"New entry"; }
function startEdit(id){ const e=D.entries.find(x=>x.id===id); if(!e) return; editId=id; document.querySelector('nav button[data-tab="entry"]').click();
  $("eMach").value=e.mach; const [h,m]=String(e.hours).split(":"); $("eHours").value=h||""; $("eMins").value=m||"";
  $("eDate").value=e.date; $("eSign").value=e.sign; $("eOther").value=e.other||""; picked=new Set(e.filters||[]); renderChips(); editMode(true);
  say($("eMsg"),"warn",`Editing the ${fmtDate(e.date)} entry, hour meter ${esc(e.hours)}. Change what you need and tap Save changes.`); window.scrollTo(0,0); }
function stopEdit(){ editId=null; editMode(false); picked.clear(); $("eHours").value=""; $("eMins").value=""; $("eOther").value=""; $("eDate").value=today(); $("eSign").value=mySign(); renderChips(); }
$("eCancel").addEventListener("click",()=>{ stopEdit(); say($("eMsg")); renderEntry(); });
$("eSave").addEventListener("click",async()=>{
  const hIn=$("eHours").value.trim(), mIn=$("eMins").value.trim(), hours=mIn?`${hIn}:${mIn.padStart(2,"0")}`:hIn;
  const mach=$("eMach").value, date=$("eDate").value, sign=$("eSign").value.trim().toUpperCase(), other=$("eOther").value.trim(), filters=[...D.options,...(D.others||[])].filter(o=>picked.has(o));
  if(!mach) return say($("eMsg"),"bad","Add a machine in Setup first.");
  if(!/^\d+$/.test(hIn)) return say($("eMsg"),"bad","Enter the hour meter hours, numbers only.");
  if(mIn&&!(/^\d{1,2}$/.test(mIn)&&+mIn<60)) return say($("eMsg"),"bad","Minutes have to be 0 to 59.");
  if(!date) return say($("eMsg"),"bad","Enter the date.");
  if(!sign) return say($("eMsg"),"bad","Enter your initials.");
  if(!filters.length&&!other) return say($("eMsg"),"bad","Tap what was done, or write it under Other.");
  const prev=sorted(mach).filter(e=>e.date<=date&&e.id!==editId).pop();
  if(prev&&hrs(hours)<hrs(prev.hours)&&!confirm(`The hour meter (${hours}) is lower than the last entry for this machine (${prev.hours} on ${fmtDate(prev.date)}). Save it anyway?`)) return;
  if(!mySign()) LS.set("f031sign",sign);
  const now=new Date().toISOString(), id=editId;
  const ok=await commit(d=>{
    if(id){ const e=d.entries.find(x=>x.id===id); if(!e) return false;
      (e.hist=e.hist||[]).push({mach:e.mach,hours:e.hours,date:e.date,sign:e.sign,filters:e.filters,other:e.other,ed:e.ed||e.at});
      Object.assign(e,{mach,hours,date,sign,filters,other,ed:now}); }
    else d.entries.push({id:uid(),mach,hours,date,sign,filters,other,at:now});
  },`${id?"Edit":"Entry"}: ${machName(mach)} ${hours} ${fmtDate(date)} ${sign}`);
  if(!ok) return;
  if(id){ stopEdit(); say($("eMsg"),"good",`Changes saved: ${esc(machName(mach))}, hour meter ${esc(hours)}, dated ${fmtDate(date)}.`); }
  else { picked.clear(); $("eHours").value=""; $("eMins").value=""; $("eOther").value=""; say($("eMsg"),"good",`Saved: ${esc(machName(mach))}, hour meter ${esc(hours)}, dated ${fmtDate(date)}.`); }
  if(D.machines.some(m=>m.id===mach)) $("rMach").value=mach;   // Records follows the machine being entered
  const used=[...new Set(filters.map(o=>(btnUse(o)||{}).item).filter(Boolean))].map(id=>D.stock.find(s=>s.id===id)).filter(Boolean);
  if(used.length) $("eMsg").insertAdjacentHTML("beforeend",used.map(it=>{ const h=onHand(it).qty; return `<div class="msg ${h<0||(it.low&&h<=it.low)?"warn":"good"}" style="margin-top:6px">${esc(it.name)}: ${h} left in stock${h<0?". That's below zero, so the count needs checking.":it.low&&h<=it.low?". Low, time to order.":"."}</div>`; }).join(""));
  renderEntry();
});

// ---------- records ----------
function renderRecords(){ fillMach($("rMach")); const L=sorted($("rMach").value);
  $("rBody").innerHTML=L.length?L.map(e=>rowHtml(e,true)).join(""):`<tr><td colspan="6" class="hint">No entries for this machine.</td></tr>`;
  $("rBody").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>startEdit(b.dataset.edit)));
  $("rBody").querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async()=>{ const e=D.entries.find(x=>x.id===b.dataset.del); if(!e) return;
    if(!confirm(`Delete the entry for ${fmtDate(e.date)}, hour meter ${e.hours}, signed ${e.sign}? It stays in the log's history on GitHub.`)) return;
    if(await commit(d=>{ d.entries=d.entries.filter(x=>x.id!==e.id); if(!d.deleted.includes(e.id)) d.deleted.push(e.id); },`Delete: ${machName(e.mach)} ${e.hours} ${fmtDate(e.date)} ${e.sign}`)) say($("rMsg"),"good","Deleted."); })); }
$("rMach").addEventListener("change",renderRecords);

// ---------- print: each page filled by measuring ----------
const PAGE_H=9.6*96;
function sheetsFor(mid,meas){ const fr=$("pFrom").value, to=$("pTo").value, L=sorted(mid).filter(e=>(!fr||e.date>=fr)&&(!to||e.date<=to));
  const rng=fr||to?`${fr?fmtDate(fr):"first entry"} to ${to?fmtDate(to):"latest entry"}`:"";
  const row=e=>`<tr><td>${esc(e.hours)}</td><td>${fmtDate(e.date)}</td><td>${esc(e.sign)}</td><td>${esc(fCol(e))}</td><td>${esc(oCol(e))}</td></tr>`;
  const empty="<tr><td></td><td></td><td></td><td></td><td></td></tr>";
  const shell=()=>{ const d=document.createElement("div"); d.className="sheet"; d.innerHTML=`<div class="ttl">Sinker Filter Change / Maintenance</div>
    <div class="mach">MACHINE: <b>${esc(machName(mid))}</b></div>
    <table><colgroup><col style="width:20.9%"><col style="width:12.9%"><col style="width:12.1%"><col style="width:17.1%"><col style="width:37%"></colgroup>
    <tbody><tr><th>HOUR METER</th><th>DATE</th><th>SIGN</th><th>FILTER CHANGE</th><th>OTHER</th></tr></tbody></table>
    <div class="ftr"><span>${esc(D.form)} Rev ${esc(D.rev)}</span><span class="pg">${rng?esc(rng)+" &nbsp; ":""}Page 0 of 0</span><span>Confidential and Proprietary</span></div>`; meas.appendChild(d); return d; };
  const pages=[]; let pg=shell(), tb=pg.querySelector("tbody"), n=0; pages.push(pg);
  L.forEach(e=>{ tb.insertAdjacentHTML("beforeend",row(e)); n++;
    if(pg.offsetHeight>PAGE_H&&n>1){ tb.lastElementChild.remove(); pg=shell(); tb=pg.querySelector("tbody"); pages.push(pg); tb.insertAdjacentHTML("beforeend",row(e)); n=1; } });
  pages.forEach(p=>{ const b=p.querySelector("tbody"); for(;;){ b.insertAdjacentHTML("beforeend",empty); if(p.offsetHeight>PAGE_H){ b.lastElementChild.remove(); break; } } });
  pages.forEach((p,i)=>{ const t=p.querySelector(".pg"); t.innerHTML=t.innerHTML.replace("Page 0 of 0",`Page ${i+1} of ${pages.length}`); });
  return pages.map(p=>p.outerHTML).join(""); }
function sheetHtml(mid){ const meas=document.createElement("div"); meas.className="measure"; document.body.appendChild(meas); try{ return sheetsFor(mid,meas); } finally{ meas.remove(); } }
function doPrint(ids){ if(!ids.length) return say($("rMsg"),"bad","Add a machine in Setup first."); $("printArea").innerHTML=ids.map(sheetHtml).join(""); window.print(); }
$("pOne").addEventListener("click",()=>doPrint($("rMach").value?[$("rMach").value]:[]));
$("pAll").addEventListener("click",()=>doPrint(D.machines.map(m=>m.id)));

// ---------- backup / import ----------
$("xSave").addEventListener("click",()=>{ const blob=new Blob([JSON.stringify(D,null,1)],{type:"application/json"}), a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=`${D.form||"F-031"}_log_${today()}.json`; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500);
  say($("xMsg"),"good",`Saved a backup of ${D.entries.length} entr${D.entries.length===1?"y":"ies"}.`); });
function merge(D,d){ let added=0, upd=0;
  (d.machines||[]).forEach(m=>{ if(!m||!m.id) return; if(D.machines.find(x=>x.id===m.id)) return;
    const same=D.machines.find(x=>x.name.trim().toLowerCase()===String(m.name||"").trim().toLowerCase());
    if(same) (d.entries||[]).forEach(e=>{ if(e.mach===m.id) e.mach=same.id; }); else D.machines.push(m.type?{id:m.id,name:String(m.name||"Machine"),type:String(m.type)}:{id:m.id,name:String(m.name||"Machine")}); });
  D.others=D.others||[];
  (d.others||[]).forEach(o=>{ if(!o) return; D.options=D.options.filter(x=>x!==o); if(!D.others.includes(o)) D.others.push(o); });
  (d.options||[]).forEach(o=>{ if(o&&!D.options.includes(o)&&!D.others.includes(o)) D.options.push(o); });
  (d.deleted||[]).forEach(id=>{ if(!D.deleted.includes(id)) D.deleted.push(id); });
  const dead=new Set(D.deleted); D.entries=D.entries.filter(e=>!dead.has(e.id));
  (d.entries||[]).forEach(e=>{ if(!e||!e.id||dead.has(e.id)) return; const i=D.entries.findIndex(x=>x.id===e.id);
    if(i<0){ D.entries.push(e); added++; } else if((e.ed||e.at||"")>(D.entries[i].ed||D.entries[i].at||"")){ D.entries[i]=e; upd++; } });
  if(!(D.stock||[]).length&&(d.stock||[]).length){ D.stock=d.stock; D.stockLog=d.stockLog||[]; D.btnStock=d.btnStock||{}; }
  Object.entries(d.btnTypes||{}).forEach(([k,L])=>{ D.btnTypes=D.btnTypes||{}; if(!D.btnTypes[k]&&Array.isArray(L)) D.btnTypes[k]=L.slice(); });
  return {added,upd}; }
$("xLoad").addEventListener("change",async ev=>{ const files=[...ev.target.files]; ev.target.value=""; if(!files.length||!adminOK) return;
  const ds=[], bad=[]; for(const f of files){ try{ const d=JSON.parse(await f.text()); if(!d||d.app!==APP) throw 0; ds.push(d); }catch(e){ bad.push(f.name); } }
  let r={added:0,upd:0};
  if(ds.length&&!(await commit(x=>{ r={added:0,upd:0}; ds.forEach(d=>{ const q=merge(x,JSON.parse(JSON.stringify(d))); r.added+=q.added; r.upd+=q.upd; }); },`Import ${ds.length} file${ds.length===1?"":"s"}`))) return;
  say($("xMsg"),bad.length?"warn":"good",`Added ${r.added} entr${r.added===1?"y":"ies"}${r.upd?`, updated ${r.upd}`:""} to the log.${bad.length?` Not a filter change log file: ${bad.map(esc).join(", ")}.`:""}`); });

// ---------- setup (shared: machines, buttons, form) ----------
function renderSetup(){
  adminView(); $("sSign").value=mySign(); $("formLine").textContent=`${D.form||"F-031"} Rev ${D.rev||"-"}`; if(!adminOK) return;
  const ud=(k,i,n)=>`<button type="button" class="btn alt small" data-up="${k},${i}" aria-label="Move up"${i?"":" disabled"}>&#9650;</button><button type="button" class="btn alt small" data-dn="${k},${i}" aria-label="Move down"${i<n-1?"":" disabled"}>&#9660;</button>`;
  $("sMach").innerHTML=D.machines.map((m,i)=>`<div class="item">${ud("m",i,D.machines.length)}<input data-mi="${i}" value="${esc(m.name)}" aria-label="Machine name"><button type="button" class="btn danger small" data-mdel="${i}">Remove</button></div><div class="shows">Type: <input data-mt="${i}" list="typeList" value="${esc(typeOf(m))}" aria-label="Machine type for ${esc(m.name)}" class="tybox"></div>`).join("")||`<p class="hint">No machines yet.</p>`;
  const TY=allTypes(); $("typeList").innerHTML=TY.map(t=>`<option value="${esc(t)}">`).join("");
  const blist=(k,a,other)=>a.map((o,i)=>`<div class="item">${ud(k,i,a.length)}<input data-bi="${k},${i}" value="${esc(o)}" aria-label="Button text"><button type="button" class="btn alt small" data-bmv="${k},${i}">${other?"To Filter":"To Other"}</button><button type="button" class="btn danger small" data-bdel="${k},${i}" aria-label="Remove">&#10005;</button></div>${TY.length>1?`<div class="shows">Shows on: <button type="button" class="chip mini${TY.some(t=>((D.btnTypes||{})[o]||[]).some(x=>sameT(x,t)))?"":" on"}" data-bt="${k},${i},*">All</button>${TY.map((t,j)=>`<button type="button" class="chip mini${(D.btnTypes||{})[o]&&D.btnTypes[o].some(x=>sameT(x,t))?" on":""}" data-bt="${k},${i},${j}">${esc(t)}</button>`).join("")}</div>`:""}${(D.stock||[]).length?`<div class="shows">Takes from stock: <select data-bs="${k},${i}" aria-label="Stock item for ${esc(o)}"><option value="">Nothing</option>${D.stock.map(s=>`<option value="${esc(s.id)}"${((D.btnStock||{})[o]||{}).item===s.id?" selected":""}>${esc(s.name)}</option>`).join("")}</select>${btnUse(o)?` <input data-bq="${k},${i}" type="number" min="1" step="1" value="${btnUse(o).qty}" aria-label="How many" class="qbox"> each time`:""}</div>`:""}`).join("")||`<p class="hint">No buttons yet.</p>`;
  $("sOpt").innerHTML=blist("o",D.options,false); $("sOth").innerHTML=blist("t",D.others||[],true);
  $("sSign").value=mySign(); $("sForm").value=D.form; $("sRev").value=D.rev; $("sCo").value=D.company||"";
  $("sLogoClear").hidden=!D.logo; $("sLogoPrev").innerHTML=D.logo?`<img src="${D.logo}" alt="Current logo"><span class="hint">Current logo</span>`:`<span class="hint">No logo yet. PNG with a transparent background looks best.</span>`;
  $("formLine").textContent=`${D.form||"F-031"} Rev ${D.rev||"-"}`;
  const arr=(d,k)=>k==="m"?d.machines:k==="o"?d.options:(d.others=d.others||[]);
  // changes go by name or id, not position, so they still land right if another device changed the lists meanwhile
  const keyOf=(k,i)=>k==="m"?D.machines[i].id:arr(D,k)[i];
  const at=(d,k,key)=>k==="m"?d.machines.findIndex(m=>m.id===key):arr(d,k).indexOf(key);
  const S=(op,msg)=>adminOK?commit(op,msg):(adminView(),false);
  document.querySelectorAll("#tab-setup [data-up],#tab-setup [data-dn]").forEach(b=>b.addEventListener("click",()=>{ const up=!!b.dataset.up, [k,i]=(b.dataset.up||b.dataset.dn).split(","), key=keyOf(k,+i);
    S(d=>{ const a=arr(d,k), x=at(d,k,key), y=x+(up?-1:1); if(x<0||y<0||y>=a.length) return false; [a[x],a[y]]=[a[y],a[x]]; },"Setup: reorder"); }));
  $("sMach").querySelectorAll("[data-mi]").forEach(el=>el.addEventListener("change",()=>{ const m=D.machines[+el.dataset.mi], v=el.value.trim(); if(!v){ el.value=m.name; return; }
    S(d=>{ const x=d.machines.find(q=>q.id===m.id); if(!x) return false; x.name=v; },`Setup: rename machine to ${v}`); }));
  $("sMach").querySelectorAll("[data-mt]").forEach(el=>el.addEventListener("change",()=>{ const m=D.machines[+el.dataset.mt], old=typeOf(m), v=el.value.trim()||autoType(m.name);
    if(sameT(v,old)&&v===old) return;
    S(d=>{ const x=d.machines.find(q=>q.id===m.id); if(!x) return false; x.type=v;
      // the last machine of the old type: buttons that pointed at it follow the new name
      if(!d.machines.some(q=>q.id!==m.id&&sameT(typeOf(q),old))) Object.values(d.btnTypes||{}).forEach(L=>L.forEach((t,j)=>{ if(sameT(t,old)) L[j]=v; }));
    },`Setup: ${m.name} type ${v}`); }));
  document.querySelectorAll("#tab-setup [data-bt]").forEach(b=>b.addEventListener("click",()=>{ const [k,i,j]=b.dataset.bt.split(","), name=arr(D,k)[+i], t=j==="*"?null:TY[+j];
    S(d=>{ const bt=d.btnTypes=d.btnTypes||{}; if(!t){ delete bt[name]; return; }
      let L=(bt[name]||[]).slice(); L=L.some(x=>sameT(x,t))?L.filter(x=>!sameT(x,t)):[...L,t]; if(L.length) bt[name]=L; else delete bt[name]; },`Setup: ${name} shows on ${t||"all"}`); }));
  document.querySelectorAll("#tab-setup [data-bs]").forEach(el=>el.addEventListener("change",()=>{ const [k,i]=el.dataset.bs.split(","), name=arr(D,k)[+i], v=el.value;
    S(d=>{ const bs=d.btnStock=d.btnStock||{}; if(!v) delete bs[name]; else bs[name]={item:v,qty:(bs[name]&&bs[name].qty)||1}; },`Setup: ${name} takes from stock`); }));
  document.querySelectorAll("#tab-setup [data-bq]").forEach(el=>el.addEventListener("change",()=>{ const [k,i]=el.dataset.bq.split(","), name=arr(D,k)[+i], q=Math.round(+el.value);
    if(!(q>0)){ el.value=(btnUse(name)||{}).qty||1; return; }
    S(d=>{ const u=(d.btnStock||{})[name]; if(!u) return false; u.qty=q; },`Setup: ${name} takes ${q}`); }));
  renderStock(S);
  $("sMach").querySelectorAll("[data-mdel]").forEach(b=>b.addEventListener("click",()=>{ const m=D.machines[+b.dataset.mdel], n=D.entries.filter(e=>e.mach===m.id).length;
    if(n) return say($("sMsg"),"bad",`${esc(m.name)} has ${n} entr${n===1?"y":"ies"}, so it stays. Rename it instead if it changed.`);
    S(d=>{ d.machines=d.machines.filter(q=>q.id!==m.id); },`Setup: remove machine ${m.name}`); }));
  document.querySelectorAll("#tab-setup [data-bi]").forEach(el=>el.addEventListener("change",()=>{ const [k,i]=el.dataset.bi.split(","), old=arr(D,k)[+i], v=el.value.trim(); if(!v){ el.value=old; return; }
    S(d=>{ const a=arr(d,k), x=a.indexOf(old); if(x<0) return false; a[x]=v; const bt=d.btnTypes||{}; if(bt[old]){ bt[v]=bt[old]; delete bt[old]; } const bs=d.btnStock||{}; if(bs[old]){ bs[v]=bs[old]; delete bs[old]; } },`Setup: rename button to ${v}`); }));
  document.querySelectorAll("#tab-setup [data-bdel]").forEach(b=>b.addEventListener("click",()=>{ const [k,i]=b.dataset.bdel.split(","), name=arr(D,k)[+i];
    S(d=>{ const a=arr(d,k), x=a.indexOf(name); if(x<0) return false; a.splice(x,1); if(d.btnTypes) delete d.btnTypes[name]; if(d.btnStock) delete d.btnStock[name]; },`Setup: remove button ${name}`); }));
  document.querySelectorAll("#tab-setup [data-bmv]").forEach(b=>b.addEventListener("click",()=>{ const [k,i]=b.dataset.bmv.split(","), name=arr(D,k)[+i];
    S(d=>{ const a=arr(d,k), x=a.indexOf(name); if(x<0) return false; a.splice(x,1); arr(d,k==="o"?"t":"o").push(name); },`Setup: move ${name} to ${k==="o"?"Other":"Filter"}`); }));
}
function renderStock(S){
  const fmt=iso=>{ const d=new Date(iso); return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; };
  $("sStock").innerHTML=(D.stock||[]).map((it,i)=>{ const h=onHand(it), u=stockUsed(it,h.base);
    const log=(D.stockLog||[]).filter(e=>e.item===it.id).sort((x,y)=>x.at<y.at?1:-1).slice(0,4);
    const btns=Object.entries(D.btnStock||{}).filter(([o,v])=>v.item===it.id).map(([o,v])=>`${esc(o)} (${v.qty})`).join(", ");
    return `<div class="stockcard"><div class="item"><input data-sn="${i}" value="${esc(it.name)}" aria-label="Stock item name"><button type="button" class="btn danger small" data-sdel="${i}">Remove</button></div>
    <div class="onhand${h.qty<0||(it.low&&h.qty<=it.low)?" low":""}"><b>${h.qty}</b> on hand</div>
    <div class="hint">Counted ${h.base.by?`${h.base.qty} on ${fmt(h.base.at)} by ${esc(h.base.by)}`:`from 0 when added ${fmt(h.base.at)}`}${h.recv||u.n?`. Since then: ${[h.recv?`+${h.recv} received`:"",u.n?`-${u.n} used in ${u.list.length} entr${u.list.length===1?"y":"ies"}`:""].filter(Boolean).join(", ")}`:""}.${btns?` Taken by: ${btns}.`:` No button takes from it yet: pick it just below and tap Link.`}</div>
    ${(()=>{ const all=[...D.options,...(D.others||[])], key=(it.name.trim().split(/\s+/)[0]||"").toLowerCase(), linked=Object.keys(D.btnStock||{}).filter(o=>(D.btnStock[o]||{}).item===it.id);
      const cand=all.filter(o=>!linked.includes(o)); if(!cand.length) return "";
      const best=cand.find(o=>key&&o.toLowerCase().includes(key))||cand[0];
      return `<div class="row3"><label class="f">${linked.length?"Link another button":"Which button takes from it"}<select data-slb="${i}">${cand.map(o=>`<option${o===best?" selected":""}>${esc(o)}</option>`).join("")}</select></label><label class="f" style="flex:0 0 90px">Each time<input type="number" min="1" step="1" data-slq="${i}" value="6"></label><button type="button" class="btn alt small" data-sl="${i}">Link</button></div>`; })()}
    <div class="row3"><label class="f">Received<input type="number" min="1" step="1" data-srq="${i}" placeholder="how many"></label><button type="button" class="btn alt small" data-srb="${i}">Add received</button></div>
    <div class="row3"><label class="f">Physical count<input type="number" min="0" step="1" data-scq="${i}" placeholder="counted on the shelf"></label><button type="button" class="btn alt small" data-scb="${i}">Set count</button></div>
    <div class="row3"><label class="f">Warn when down to<input type="number" min="0" step="1" data-slow="${i}" value="${it.low||""}" placeholder="e.g. 12"></label></div>
    ${u.list.length?`<details><summary>Entries counted since the last count (${u.list.length})</summary>${u.list.slice(-15).reverse().map(x=>`<div class="hint">${fmtDate(x.e.date)} &middot; ${esc(machName(x.e.mach))} &middot; ${esc(x.e.sign)} &middot; -${x.q}</div>`).join("")}</details>`:""}
    ${log.length?`<details><summary>Counts and deliveries</summary>${log.map(e=>`<div class="hint">${fmt(e.at)} &middot; ${e.kind==="count"?`counted ${e.qty}`:`received ${e.qty}`} &middot; ${esc(e.by)}</div>`).join("")}</details>`:""}</div>`; }).join("")||`<p class="hint">No stock items yet.</p>`;
  const who=()=>mySign()||"ADMIN";
  $("sStock").querySelectorAll("[data-sn]").forEach(el=>el.addEventListener("change",()=>{ const it=D.stock[+el.dataset.sn], v=el.value.trim(); if(!v){ el.value=it.name; return; }
    S(d=>{ const x=d.stock.find(q=>q.id===it.id); if(!x) return false; x.name=v; },`Stock: rename to ${v}`); }));
  $("sStock").querySelectorAll("[data-sdel]").forEach(b=>b.addEventListener("click",()=>{ const it=D.stock[+b.dataset.sdel];
    if(!confirm(`Remove ${it.name} from stock tracking? Buttons stop taking from it. Entries are not changed.`)) return;
    S(d=>{ d.stock=d.stock.filter(q=>q.id!==it.id); d.stockLog=(d.stockLog||[]).filter(e=>e.item!==it.id); Object.keys(d.btnStock||{}).forEach(o=>{ if(d.btnStock[o].item===it.id) delete d.btnStock[o]; }); },`Stock: remove ${it.name}`); }));
  $("sStock").querySelectorAll("[data-sl]").forEach(b=>b.addEventListener("click",()=>{ const i=+b.dataset.sl, it=D.stock[i], o=document.querySelector(`[data-slb="${i}"]`).value, q=Math.round(+document.querySelector(`[data-slq="${i}"]`).value);
    if(!(q>0)) return say($("sMsg"),"bad","Enter how many come out each time.");
    Promise.resolve(S(d=>{ (d.btnStock=d.btnStock||{})[o]={item:it.id,qty:q}; },`Stock: ${o} takes ${q} ${it.name}`)).then(ok=>{ if(ok===true) say($("sMsg"),"good",`Linked: ${esc(o)} takes ${q} ${esc(it.name)} each time. Entries since the last count are taken off now.`); }); }));
  $("sStock").querySelectorAll("[data-srb]").forEach(b=>b.addEventListener("click",()=>{ const i=+b.dataset.srb, it=D.stock[i], q=Math.round(+document.querySelector(`[data-srq="${i}"]`).value);
    if(!(q>0)) return say($("sMsg"),"bad","Enter how many came in.");
    S(d=>{ (d.stockLog=d.stockLog||[]).push({id:uid(),item:it.id,kind:"recv",qty:q,at:new Date().toISOString(),by:who()}); },`Stock: received ${q} ${it.name}`); }));
  $("sStock").querySelectorAll("[data-scb]").forEach(b=>b.addEventListener("click",()=>{ const i=+b.dataset.scb, it=D.stock[i], el=document.querySelector(`[data-scq="${i}"]`), q=Math.round(+el.value);
    if(el.value===""||!(q>=0)) return say($("sMsg"),"bad","Enter the number counted on the shelf.");
    const h=onHand(it).qty; if(q!==h&&!confirm(`The log shows ${h} on hand. Set it to ${q}, as counted? Everything entered from now on counts down from ${q}.`)) return;
    S(d=>{ (d.stockLog=d.stockLog||[]).push({id:uid(),item:it.id,kind:"count",qty:q,at:new Date().toISOString(),by:who()}); },`Stock: counted ${q} ${it.name}`); }));
  $("sStock").querySelectorAll("[data-slow]").forEach(el=>el.addEventListener("change",()=>{ const it=D.stock[+el.dataset.slow], q=Math.max(0,Math.round(+el.value||0));
    S(d=>{ const x=d.stock.find(s=>s.id===it.id); if(!x) return false; x.low=q; },`Stock: warn at ${q} ${it.name}`); }));
}
$("sStockAdd").addEventListener("click",async()=>{ if(!adminOK) return adminView(); await commit(d=>{ (d.stock=d.stock||[]).push({id:uid(),name:"New stock item",low:0,at:new Date().toISOString()}); },"Stock: add item");
  const ins=$("sStock").querySelectorAll("[data-sn]"), i=ins[ins.length-1]; if(i){ i.focus(); i.select(); } });
async function addItem(k,txt){ if(!adminOK) return adminView(); const ok=await commit(d=>{ if(k==="m") d.machines.push({id:uid(),name:txt}); else (k==="o"?d.options:(d.others=d.others||[])).push(txt); },`Setup: add ${txt}`);
  if(!ok) return; const box=k==="m"?$("sMach"):k==="o"?$("sOpt"):$("sOth"), ins=box.querySelectorAll("input"), i=ins[ins.length-1]; if(i){ i.focus(); i.select(); } }
$("sMachAdd").addEventListener("click",()=>addItem("m","New machine"));
$("sOptAdd").addEventListener("click",()=>addItem("o","New filter"));
$("sOthAdd").addEventListener("click",()=>addItem("t","New button"));
$("sSign").addEventListener("change",()=>{ LS.set("f031sign",$("sSign").value.trim().toUpperCase()); $("eSign").value=mySign(); });
$("sForm").addEventListener("change",()=>{ if(!adminOK) return; const v=$("sForm").value.trim()||"F-031"; commit(d=>{ d.form=v; },"Setup: form ID"); });
$("sRev").addEventListener("change",()=>{ if(!adminOK) return; const v=$("sRev").value.trim()||"-"; commit(d=>{ d.rev=v; },"Setup: revision"); });

// ---------- QR codes: one per machine; ?m= picks the machine when scanned ----------
function qrSvg(text){ const q=new QRCode(-1,0); q.addData(text); q.make(); const n=q.getModuleCount(), b=4; let p="";
  for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(q.isDark(r,c)) p+=`M${c+b} ${r+b}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n+2*b} ${n+2*b}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${p}" fill="#000"/></svg>`; }
const pageUrl=()=>location.href.split(/[?#]/)[0];
$("sQr").addEventListener("click",()=>{ if(!adminOK) return;
  if(location.protocol==="file:") return say($("sMsg"),"bad","Open the log from its web address first; the codes point at whatever address this page has.");
  if(!D.machines.length) return say($("sMsg"),"bad","Add a machine first.");
  $("printArea").innerHTML=`<div class="qrs">${D.machines.map(m=>`<div class="qc">${qrSvg(pageUrl()+"?m="+encodeURIComponent(m.id))}<div class="qn">${esc(m.name)}</div><div class="qt">Scan to log a filter change or maintenance (${esc(D.form)})</div></div>`).join("")}</div>`;
  window.print(); });
function pickFromLink(){ const m=new URLSearchParams(location.search).get("m"); if(!m||editId) return;
  const x=D.machines.find(q=>q.id===m); if(!x) return; LS.set("f031mach",x.id); $("eMach").value=x.id; $("rMach").value=x.id; renderEntry(); renderRecords(); }

// ---------- company name and logo (shared, admin only; cached so the lock screen can show it too) ----------
function showBrand(){ const co=(D.company||"").trim(), lg=D.logo||"";
  [["coBrand","coLogo","coName"],["lkBrand","lkLogo","lkCo"]].forEach(([b,i,n])=>{ $(n).textContent=co; $(n).hidden=!co; $(i).hidden=!lg; if(lg) $(i).src=lg; else $(i).removeAttribute("src"); $(b).hidden=!co&&!lg; });
  if(TOKEN) LS.set("f031brand",JSON.stringify({company:co,logo:lg})); }
function setBrand(patch,msg){ if(!adminOK) return; commit(d=>{ Object.assign(d,patch); },msg); }
$("sCo").addEventListener("change",()=>setBrand({company:$("sCo").value.trim()},"Setup: company name"));
$("sLogoClear").addEventListener("click",()=>setBrand({logo:""},"Setup: remove logo"));
$("sLogoFile").addEventListener("change",e=>{ const f=e.target.files&&e.target.files[0]; e.target.value=""; if(!f||!adminOK) return;
  const rd=new FileReader(); rd.onload=()=>{ const im=new Image();
    im.onload=()=>{ const sc=Math.min(1,160/(im.naturalHeight||160),640/(im.naturalWidth||640)), cw=Math.max(1,Math.round((im.naturalWidth||640)*sc)), ch=Math.max(1,Math.round((im.naturalHeight||160)*sc));
      const c=document.createElement("canvas"); c.width=cw; c.height=ch; c.getContext("2d").drawImage(im,0,0,cw,ch); let u; try{ u=c.toDataURL("image/png"); }catch(err){ u=rd.result; } setBrand({logo:u},"Setup: logo"); };
    im.onerror=()=>say($("sMsg"),"bad","That file couldn't be read as an image. Try a PNG or JPG."); im.src=rd.result; }; rd.readAsDataURL(f); });
$("sCalcSet").addEventListener("change",async e=>{ const f=e.target.files&&e.target.files[0]; e.target.value=""; if(!f||!adminOK) return;
  let d; try{ d=JSON.parse(await f.text()); }catch(err){ d=null; }
  if(!d||!("company" in d||"logo" in d)) return say($("sMsg"),"bad","That isn't a settings file with a company name or logo. In the calculator or Part Checker, save the settings file, then pick that file here.");
  const p={}; if(d.company) p.company=String(d.company); if(d.logo&&/^data:image\//.test(d.logo)) p.logo=d.logo;
  if(!Object.keys(p).length) return say($("sMsg"),"bad","That settings file has no company name or logo filled in.");
  setBrand(p,"Setup: company from settings file"); say($("sMsg"),"good",`Copied the ${[p.company&&"company name",p.logo&&"logo"].filter(Boolean).join(" and ")}.`); });

function renderAll(){ showBrand(); renderEntry(); renderRecords(); renderSetup(); }

const hidePw=()=>document.querySelectorAll(".pwwrap").forEach(w=>{ const i=w.querySelector("input"), b=w.querySelector("button"); i.type="password"; b.textContent="Show"; b.setAttribute("aria-label","Show password"); });
// ---------- start ----------
// a Show / Hide button beside every password box, so it can be checked before tapping on
document.querySelectorAll('input[type="password"]').forEach(inp=>{ const w=document.createElement("span"); w.className="pwwrap";
  inp.parentNode.insertBefore(w,inp); w.appendChild(inp); const b=document.createElement("button"); b.type="button"; b.className="pwbtn"; b.textContent="Show"; b.setAttribute("aria-label","Show password");
  b.addEventListener("click",()=>{ const show=inp.type==="password"; inp.type=show?"text":"password"; b.textContent=show?"Hide":"Show"; b.setAttribute("aria-label",(show?"Hide":"Show")+" password"); inp.focus(); });
  w.appendChild(b); });

document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") refresh(true); });   // back to the page: pick up others' entries
if(!CFG||!CFG.lock) { document.body.innerHTML='<div class="lock"><h2>Not set up yet</h2><p class="hint">config.js is missing. Make it with the F-031 setup page and put it next to this page.</p></div>'; }
else { adminOK=!CFG.admin||LS.get("f031admin")===CFG.admin.hash; TOKEN=LS.get("f031token"); if(TOKEN) open_(); else showLock(); }
