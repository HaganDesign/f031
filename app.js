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
function blank(){ return {app:APP,v:1,machines:[],options:["Filters changed"],others:[],form:"F-031",rev:"-",entries:[],deleted:[]}; }
let D=blank(), SHA=null, TOKEN=null;
const mySign=()=>LS.get("f031sign")||"";
const hrs=v=>{ const m=/^\s*(\d+(?:\.\d+)?)(?::(\d{1,2}))?\s*$/.exec(String(v??"")); return m?(+m[1])+(m[2]?+m[2]/60:0):NaN; };
const isOther=n=>(D.others||[]).includes(n);
const fCol=e=>(e.filters||[]).filter(n=>!isOther(n)).join(", ");
const oCol=e=>[...(e.filters||[]).filter(isOther),e.other].filter(Boolean).join(", ");
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
async function commit(op,msg){
  if(busy) return false; busy=true; document.body.classList.add("busy"); setSync("Saving...");
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
function showLock(msg){ $("app").hidden=true; $("lockScreen").hidden=false; say($("lkMsg"),msg?"warn":"",msg||""); setTimeout(()=>$("lkPw").focus(),50); }
async function open_(){ $("lockScreen").hidden=true; $("app").hidden=false; setSync("Loading the log...");
  try{ const {d,sha}=await pull(); D=d; SHA=sha; setSync(); renderAll(); pickFromLink();
    if(!D.machines.length){ document.querySelector('nav button[data-tab="setup"]').click(); say($("sMsg"),"warn",adminOK?"First time here: add your machines, then go to New entry.":"No machines yet. Unlock settings with the admin password to add them."); } }
  catch(e){ failed(e); } }
$("sAdGo").addEventListener("click",async()=>{ const pw=$("sAdPw").value; if(!pw) return;
  const h=await adminHash(pw); if(h!==CFG.admin.hash) return say($("sAdMsg"),"bad","That isn't the admin password.");
  adminOK=true; $("sAdPw").value=""; say($("sAdMsg")); if($("sAdKeep").checked) LS.set("f031admin",h); adminView(); renderSetup(); });
$("sAdPw").addEventListener("keydown",e=>{ if(e.key==="Enter") $("sAdGo").click(); });
$("sAdLock").addEventListener("click",()=>{ adminOK=false; LS.del("f031admin"); adminView(); say($("sMsg")); });
$("lkGo").addEventListener("click",async()=>{ const pw=$("lkPw").value; if(!pw) return;
  try{ TOKEN=await unlockToken(pw); }catch(e){ return say($("lkMsg"),"bad","That isn't the shop password."); }
  if($("lkRemember").checked) LS.set("f031token",TOKEN); $("lkPw").value=""; open_(); });
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
  const grp=(el,list,none)=>{ el.innerHTML=list.map((o,i)=>`<button type="button" class="chip${picked.has(o)?" on":""}" data-i="${i}">${esc(o)}</button>`).join("")||`<span class="hint">${none}</span>`;
    el.querySelectorAll(".chip").forEach(c=>c.addEventListener("click",()=>{ const o=list[+c.dataset.i]; picked.has(o)?picked.delete(o):picked.add(o); renderChips(); })); };
  grp($("eChips"),D.options,"Add filter buttons in Setup."); grp($("eChipsO"),D.others||[],"Add Other buttons in Setup, or write it below."); }
function rowHtml(e,act){ return `<tr><td class="mono">${esc(e.hours)}</td><td class="mono">${fmtDate(e.date)}</td><td>${esc(e.sign)}</td><td>${esc(fCol(e))}</td><td>${esc(oCol(e))}${e.ed?` <span class="hint">(edited)</span>`:""}</td>${act?`<td style="white-space:nowrap"><button type="button" class="btn alt small" data-edit="${esc(e.id)}">Edit</button> <button type="button" class="btn danger small" data-del="${esc(e.id)}">Delete</button></td>`:""}</tr>`; }
function renderEntry(){ fillMach($("eMach")); renderChips();
  if(!$("eDate").value) $("eDate").value=today();
  if(!$("eSign").value) $("eSign").value=mySign();
  const L=D.entries.filter(e=>e.mach===$("eMach").value).sort((a,b)=>(a.ed||a.at||"")<(b.ed||b.at||"")?1:-1).slice(0,5);
  $("eRecent").innerHTML=L.length?L.map(e=>rowHtml(e,false)).join(""):`<tr><td colspan="5" class="hint">No entries yet for this machine.</td></tr>`; }
$("eMach").addEventListener("change",()=>{ LS.set("f031mach",$("eMach").value); if(!editId) say($("eMsg")); renderEntry(); });
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
  if(id){ stopEdit(); say($("eMsg"),"good",`Changes saved to the log for ${esc(machName(mach))}.`); }
  else { picked.clear(); $("eHours").value=""; $("eMins").value=""; $("eOther").value=""; say($("eMsg"),"good",`Saved to the log for ${esc(machName(mach))}.`); }
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
    if(same) (d.entries||[]).forEach(e=>{ if(e.mach===m.id) e.mach=same.id; }); else D.machines.push({id:m.id,name:String(m.name||"Machine")}); });
  D.others=D.others||[];
  (d.others||[]).forEach(o=>{ if(!o) return; D.options=D.options.filter(x=>x!==o); if(!D.others.includes(o)) D.others.push(o); });
  (d.options||[]).forEach(o=>{ if(o&&!D.options.includes(o)&&!D.others.includes(o)) D.options.push(o); });
  (d.deleted||[]).forEach(id=>{ if(!D.deleted.includes(id)) D.deleted.push(id); });
  const dead=new Set(D.deleted); D.entries=D.entries.filter(e=>!dead.has(e.id));
  (d.entries||[]).forEach(e=>{ if(!e||!e.id||dead.has(e.id)) return; const i=D.entries.findIndex(x=>x.id===e.id);
    if(i<0){ D.entries.push(e); added++; } else if((e.ed||e.at||"")>(D.entries[i].ed||D.entries[i].at||"")){ D.entries[i]=e; upd++; } });
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
  $("sMach").innerHTML=D.machines.map((m,i)=>`<div class="item">${ud("m",i,D.machines.length)}<input data-mi="${i}" value="${esc(m.name)}" aria-label="Machine name"><button type="button" class="btn danger small" data-mdel="${i}">Remove</button></div>`).join("")||`<p class="hint">No machines yet.</p>`;
  const blist=(k,a,other)=>a.map((o,i)=>`<div class="item">${ud(k,i,a.length)}<input data-bi="${k},${i}" value="${esc(o)}" aria-label="Button text"><button type="button" class="btn alt small" data-bmv="${k},${i}">${other?"To Filter":"To Other"}</button><button type="button" class="btn danger small" data-bdel="${k},${i}" aria-label="Remove">&#10005;</button></div>`).join("")||`<p class="hint">No buttons yet.</p>`;
  $("sOpt").innerHTML=blist("o",D.options,false); $("sOth").innerHTML=blist("t",D.others||[],true);
  $("sSign").value=mySign(); $("sForm").value=D.form; $("sRev").value=D.rev;
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
  $("sMach").querySelectorAll("[data-mdel]").forEach(b=>b.addEventListener("click",()=>{ const m=D.machines[+b.dataset.mdel], n=D.entries.filter(e=>e.mach===m.id).length;
    if(n) return say($("sMsg"),"bad",`${esc(m.name)} has ${n} entr${n===1?"y":"ies"}, so it stays. Rename it instead if it changed.`);
    S(d=>{ d.machines=d.machines.filter(q=>q.id!==m.id); },`Setup: remove machine ${m.name}`); }));
  document.querySelectorAll("#tab-setup [data-bi]").forEach(el=>el.addEventListener("change",()=>{ const [k,i]=el.dataset.bi.split(","), old=arr(D,k)[+i], v=el.value.trim(); if(!v){ el.value=old; return; }
    S(d=>{ const a=arr(d,k), x=a.indexOf(old); if(x<0) return false; a[x]=v; },`Setup: rename button to ${v}`); }));
  document.querySelectorAll("#tab-setup [data-bdel]").forEach(b=>b.addEventListener("click",()=>{ const [k,i]=b.dataset.bdel.split(","), name=arr(D,k)[+i];
    S(d=>{ const a=arr(d,k), x=a.indexOf(name); if(x<0) return false; a.splice(x,1); },`Setup: remove button ${name}`); }));
  document.querySelectorAll("#tab-setup [data-bmv]").forEach(b=>b.addEventListener("click",()=>{ const [k,i]=b.dataset.bmv.split(","), name=arr(D,k)[+i];
    S(d=>{ const a=arr(d,k), x=a.indexOf(name); if(x<0) return false; a.splice(x,1); arr(d,k==="o"?"t":"o").push(name); },`Setup: move ${name} to ${k==="o"?"Other":"Filter"}`); }));
}
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

function renderAll(){ renderEntry(); renderRecords(); renderSetup(); }

// ---------- start ----------
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") refresh(true); });   // back to the page: pick up others' entries
if(!CFG||!CFG.lock) { document.body.innerHTML='<div class="lock"><h2>Not set up yet</h2><p class="hint">config.js is missing. Make it with the F-031 setup page and put it next to this page.</p></div>'; }
else { adminOK=!CFG.admin||LS.get("f031admin")===CFG.admin.hash; TOKEN=LS.get("f031token"); if(TOKEN) open_(); else showLock(); }
