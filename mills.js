"use strict";
// F-036 CNC Mills Daily Checklist - online log. Same lock, key and admin password as the F-031 log (shared config.js).
// Its own file in the private data repo; it reads the F-031 log (never writes it) only for the company name/logo.

const APP="F-036 CNC Mills Daily Checklist";
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const today=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const dayOf=iso=>{ const d=new Date(iso); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
const fmtDate=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||"");return m?`${+m[2]}/${+m[3]}/${m[1]}`:esc(s)};
const shortDate=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||"");return m?`${+m[2]}/${+m[3]}/${m[1].slice(2)}`:esc(s)};
const say=(el,cls,txt)=>{el.innerHTML=txt?`<div class="msg ${cls}">${txt}</div>`:"";};
const LS={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}},del:k=>{try{localStorage.removeItem(k)}catch(e){}}};
const CFG=window.F031_CONFIG||null;
const ICC_PATH=(CFG&&CFG.millsPath)||"f036-mills-log.json";

function blank(){ return {app:APP,v:1,form:"F-036",rev:"-",title:"CNC MILLS DAILY CHECKLIST",
  note:"UNLESS OTHERWISE SPECIFIED BY ENGINEERING THE COOLANT CONCENTRATION IS TO BETWEEN 7-9",
  lo:7,hi:9,uC:"%",uW:"gal",machines:[],off:[0,6],entries:[],deleted:[]}; }
let I=blank(), SHA=null, F=null, TOKEN=null, adminOK=false;
const mySign=()=>LS.get("f031sign")||"";

// ---------- GitHub ----------
const b64e=s=>{ const b=new TextEncoder().encode(s); let t=""; for(let i=0;i<b.length;i+=0x8000) t+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000)); return btoa(t); };
const b64d=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g,"")),c=>c.charCodeAt(0)));
const enc=p=>encodeURIComponent(p).replace(/%2F/g,"/");
const api=(path,opt={})=>fetch(`https://api.github.com/repos/${CFG.owner}/${CFG.repo}/${path}`,{...opt,headers:{"Authorization":"Bearer "+TOKEN,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",...(opt.headers||{})}});
async function pullFile(path){
  const r=await api(`contents/${enc(path)}?ref=${encodeURIComponent(CFG.branch||"main")}&t=${Date.now()}`,{cache:"no-store"});
  if(r.status===404) return {d:null,sha:null};
  if(r.status===401||r.status===403) throw Object.assign(new Error("auth"),{auth:true});
  if(!r.ok) throw new Error("GitHub answered "+r.status);
  const j=await r.json(); try{ return {d:JSON.parse(b64d(j.content)),sha:j.sha}; }catch(e){ throw new Error("A log file on GitHub isn't readable."); }
}
async function pull(){ const [a,b]=await Promise.all([pullFile(ICC_PATH),pullFile(CFG.path)]);
  const d=Object.assign(blank(),a.d||{}); return {d,sha:a.sha,f:b.d}; }
async function push(d,sha,msg){
  const body={message:msg,content:b64e(JSON.stringify(d,null,1)),branch:CFG.branch||"main"}; if(sha) body.sha=sha;
  const r=await api(`contents/${enc(ICC_PATH)}`,{method:"PUT",body:JSON.stringify(body),headers:{"Content-Type":"application/json"}});
  if(r.status===409||r.status===422) return null;
  if(r.status===401||r.status===403) throw Object.assign(new Error("auth"),{auth:true});
  if(!r.ok) throw new Error("GitHub answered "+r.status);
  return (await r.json()).content.sha;
}
let busy=false;
// saves line up one after another, so a change made while another is still saving is never lost
let saveChain=Promise.resolve();
function commit(op,msg){ const p=saveChain.then(()=>commitNow(op,msg)); saveChain=p.catch(()=>{}); return p; }
async function commitNow(op,msg){
  busy=true; document.body.classList.add("busy"); setSync("Saving...");
  try{
    for(let tries=0;tries<4;tries++){
      let d,sha; if(tries){ const p=await pull(); d=p.d; sha=p.sha; F=p.f||F; } else { d=JSON.parse(JSON.stringify(I)); sha=SHA; }
      if(op(d)===false) return "skip";
      const ns=await push(d,sha,msg);
      if(ns){ I=d; SHA=ns; setSync(); renderAll(); return true; }
    }
    throw new Error("The log kept changing while saving. Try again.");
  }catch(e){ failed(e); return false; }
  finally{ busy=false; document.body.classList.remove("busy"); }
}
async function refresh(quiet){
  if(busy||!TOKEN) return; try{ const p=await pull(); I=p.d; SHA=p.sha; F=p.f; renderAll(); setSync(); }
  catch(e){ if(!quiet) failed(e); else setSync("Couldn't reach the log. Check the Wi-Fi."); }
}
function failed(e){
  if(e&&e.auth){ TOKEN=null; LS.del("f031token"); showLock("The log refused this device's key, probably because the key was changed. Enter the shop password again."); return; }
  setSync(`<span style="color:var(--bad)">Not saved: ${esc(e&&e.message||e)}. Nothing was lost on this screen; try again.</span>`);
}
function setSync(t){ $("syncLine").innerHTML=t||`Online log &middot; up to date ${new Date().toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})} &middot; <a href="#" id="syncNow">refresh</a>`;
  const a=$("syncNow"); if(a) a.onclick=ev=>{ev.preventDefault();refresh(false);}; }

// ---------- unlock / admin ----------
async function unlockToken(pw){ const L=CFG.lock, u=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveKey"]);
  const key=await crypto.subtle.deriveKey({name:"PBKDF2",salt:u(L.salt),iterations:L.iter,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:u(L.iv)},key,u(L.ct))); }
async function adminHash(pw){ const A=CFG.admin, u=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pw),"PBKDF2",false,["deriveBits"]);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt:u(A.salt),iterations:A.iter,hash:"SHA-256"},base,256));
  return btoa(String.fromCharCode(...bits)); }
function adminView(){ $("sAdminLock").hidden=adminOK; $("sAdmin").hidden=!adminOK; }
function showBrand(src){ const co=((src&&src.company)||"").trim(), lg=(src&&src.logo)||"";
  [["coBrand","coLogo","coName"],["lkBrand","lkLogo","lkCo"]].forEach(([b,i,n])=>{ $(n).textContent=co; $(n).hidden=!co; $(i).hidden=!lg; if(lg) $(i).src=lg; else $(i).removeAttribute("src"); $(b).hidden=!co&&!lg; }); }
function showLock(msg){ try{ showBrand(JSON.parse(LS.get("f031brand")||"null")); }catch(e){}
  $("app").hidden=true; $("lockScreen").hidden=false; say($("lkMsg"),msg?"warn":"",msg||""); setTimeout(()=>$("lkPw").focus(),50); }
async function open_(){ $("lockScreen").hidden=true; $("app").hidden=false; setSync("Loading the log...");
  try{ const p=await pull(); I=p.d; SHA=p.sha; F=p.f; pickFromLink(); setSync(); renderAll(); }catch(e){ failed(e); } }
$("lkGo").addEventListener("click",async()=>{ const pw=$("lkPw").value; if(!pw) return;
  try{ TOKEN=await unlockToken(pw); }catch(e){ return say($("lkMsg"),"bad","That isn't the shop password."); }
  if($("lkRemember").checked) LS.set("f031token",TOKEN); $("lkPw").value=""; hidePw(); open_(); });
$("lkPw").addEventListener("keydown",e=>{ if(e.key==="Enter") $("lkGo").click(); });
$("sAdGo").addEventListener("click",async()=>{ const pw=$("sAdPw").value; if(!pw) return;
  const h=await adminHash(pw); if(h!==CFG.admin.hash) return say($("sAdMsg"),"bad","That isn't the admin password.");
  adminOK=true; $("sAdPw").value=""; hidePw(); say($("sAdMsg")); if($("sAdKeep").checked) LS.set("f031admin",h); adminView(); renderSetup(); });
$("sAdPw").addEventListener("keydown",e=>{ if(e.key==="Enter") $("sAdGo").click(); });
$("sAdLock").addEventListener("click",()=>{ adminOK=false; LS.del("f031admin"); adminView(); });
$("sForget").addEventListener("click",()=>{ LS.del("f031token"); TOKEN=null; showLock("Signed out on this device."); });
$("sSign").addEventListener("change",()=>{ LS.set("f031sign",$("sSign").value.trim().toUpperCase()); if(!editId) $("eSign").value=mySign(); });

// ---------- tabs ----------
document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("on",x===b));
  ["entry","records","setup"].forEach(t=>$("tab-"+t).hidden=t!==b.dataset.tab);
  renderAll();
}));

// ---------- days ----------
const DAYN=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const pd=s=>{ const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
const ymd=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const dow=s=>pd(s).getDay();
const hol=s=>(window.shopHoliday?window.shopHoliday(s):"");
const isOff=s=>(I.off||[]).includes(dow(s))||!!hol(s);
const entryFor=(mid,date)=>I.entries.find(e=>e.mach===mid&&e.date===date)||null;
const num=v=>{ const t=String(v??"").trim(); if(t==="") return null; const x=parseFloat(t); return isFinite(x)&&/^-?\d*\.?\d+$/.test(t)?x:NaN; };
const nf=x=>x==null?"":String(x);
const rangeOf=mid=>{ const m=I.machines.find(x=>x.id===mid)||{}; return {lo:m.lo??I.lo, hi:m.hi??I.hi, own:m.lo!=null||m.hi!=null}; };
const inR=(x,r)=>x>=r.lo&&x<=r.hi;
function fillMach(sel){ const cur=sel.value||LS.get("f036mach"); sel.innerHTML=I.machines.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")||`<option value="">Add a mill in Setup</option>`;
  if(I.machines.some(m=>m.id===cur)) sel.value=cur; }
const machName=id=>(I.machines.find(m=>m.id===id)||{}).name||"(removed)";
const COLS=["Waylube","Coolant lvl","Conc.","Coolant add","Water add","Other"];
const added=(x,u)=>x==null?"&mdash;":`${esc(nf(x))}${u?" "+esc(u):""}`;
function cells(e,date,screen,mid){ const N=6;
  if(e) return `<td class="ck">${e.way?"&#10003;":"&mdash;"}</td><td class="ck">${e.cool?"&#10003;":"&mdash;"}</td><td${screen&&e.conc!=null&&!inR(e.conc,rangeOf(e.mach))?' class="miss"':''}>${e.conc==null?"":esc(nf(e.conc))}</td><td>${added(e.cAdd,I.uC)}</td><td>${added(e.wAdd,I.uW)}</td><td class="l">${esc(e.other||"")}</td>`;
  if(isOff(date)) return `<td colspan="${N}">${hol(date)?esc(hol(date))+" - ":""}N/A</td>`;
  if(screen&&date<today()&&firstDay(mid)&&date>firstDay(mid)) return `<td colspan="${N}"><span class="miss">missed</span></td>`;
  return Array(N).fill("<td></td>").join(""); }
const firstDay=mid=>I.entries.filter(e=>e.mach===mid).reduce((m,e)=>!m||e.date<m?e.date:m,"");

// ---------- today ----------
let way=false, cool=false, editId=null;
function tiles(){ [["tWay",way],["tCool",cool]].forEach(([id,on])=>{ $(id).classList.toggle("on",on); $(id).querySelector(".bx").innerHTML=on?"&#10003;":""; }); }
$("tWay").addEventListener("click",()=>{ way=!way; tiles(); });
$("tCool").addEventListener("click",()=>{ cool=!cool; tiles(); });
function badge(){ const mid=$("eMach").value, r=rangeOf(mid), x=num($("eConc").value), b=$("eBadge");
  if(x==null){ b.className="badge none"; b.textContent=`Target ${r.lo}-${r.hi}`; }
  else if(isNaN(x)){ b.className="badge out"; b.textContent="Numbers only"; }
  else if(inR(x,r)){ b.className="badge ok"; b.textContent=`In range ${r.lo}-${r.hi}`; }
  else { b.className="badge out"; b.textContent=`${x<r.lo?"Low":"High"}: target ${r.lo}-${r.hi}`; } }
$("eConc").addEventListener("input",badge);
function clearForm(){ way=false; cool=false; ["eConc","eCAdd","eWAdd","eOther"].forEach(id=>$(id).value=""); tiles(); }
function loadForm(e){ way=!!e.way; cool=!!e.cool; $("eConc").value=nf(e.conc); $("eCAdd").value=nf(e.cAdd); $("eWAdd").value=nf(e.wAdd); $("eOther").value=e.other||""; tiles(); }
function renderEntry(){ fillMach($("eMach")); const mid=$("eMach").value;
  $("uC").textContent=I.uC||""; $("uW").textContent=I.uW||"";
  if(!$("eDate").value) $("eDate").value=today(); if(!$("eSign").value) $("eSign").value=mySign();
  const date=$("eDate").value, e=mid&&entryFor(mid,date);
  if(editId){ $("eDay").innerHTML=`<div class="daycard part">Changing the ${DAYN[dow(date)]} ${fmtDate(date)} entry. Fix what's needed and tap Save.</div>`; $("eCancel").hidden=false; }
  else if(e){ const r=rangeOf(e.mach);
    $("eDay").innerHTML=`<div class="daycard ${e.conc!=null&&!inR(e.conc,r)?"part":"done"}"><b>${DAYN[dow(date)]} ${fmtDate(date)} is logged</b> by ${esc(e.sign)}: waylube ${e.way?"&#10003;":"&mdash;"} &middot; coolant level ${e.cool?"&#10003;":"&mdash;"} &middot; concentration ${e.conc==null?"none":esc(nf(e.conc))}${e.cAdd!=null?` &middot; coolant +${added(e.cAdd,I.uC)}`:""}${e.wAdd!=null?` &middot; water +${added(e.wAdd,I.uW)}`:""}${e.other?` &middot; ${esc(e.other)}`:""}${e.ed?` <span class="hint">(edited)</span>`:""}<div class="btns" style="margin-top:8px"><button type="button" class="btn alt small" id="eEdit">Change it</button></div></div>`;
    $("eEdit").onclick=()=>{ editId=e.id; loadForm(e); renderEntry(); }; $("eCancel").hidden=true; }
  else $("eDay").innerHTML=isOff(date)?`<div class="daycard off">${hol(date)?esc(hol(date))+" is a paid holiday":DAYN[dow(date)]+" is normally a day off"}, so it prints N/A unless someone logs it. Working today? Log it below.</div>`:"";
  $("eForm").hidden=!!(e&&!editId); badge();
  $("eWkH").innerHTML=`<tr><th>Date</th><th>Sign</th>${COLS.map(t=>`<th>${t}</th>`).join("")}</tr>`;
  const rows=[]; for(let i=0;i<14;i++){ const d=new Date(); d.setDate(d.getDate()-i); const s=ymd(d), en=mid&&entryFor(mid,s);
    rows.push(`<tr><td class="l">${DAYN[d.getDay()].slice(0,3)} ${fmtDate(s)}</td><td>${en?esc(en.sign):""}</td>${cells(en,s,true,mid)}</tr>`); }
  $("eWk").innerHTML=rows.join(""); }
$("eMach").addEventListener("change",()=>{ LS.set("f036mach",$("eMach").value); $("rMach").value=$("eMach").value; stopEdit(); say($("eMsg")); renderEntry(); });
$("eDate").addEventListener("change",()=>{ stopEdit(); say($("eMsg")); renderEntry(); });
function stopEdit(){ if(editId) clearForm(); editId=null; $("eCancel").hidden=true; }
$("eCancel").addEventListener("click",()=>{ stopEdit(); renderEntry(); });
$("eSave").addEventListener("click",async()=>{
  const mid=$("eMach").value, date=$("eDate").value, sign=$("eSign").value.trim().toUpperCase(), other=$("eOther").value.trim();
  const conc=num($("eConc").value), cAdd=num($("eCAdd").value), wAdd=num($("eWAdd").value);
  if(!mid) return say($("eMsg"),"bad","Add a mill in Setup first.");
  if(!date) return say($("eMsg"),"bad","Pick the date.");
  if(date>today()) return say($("eMsg"),"bad","That date hasn't happened yet.");
  if(!sign) return say($("eMsg"),"bad","Enter your initials.");
  if([conc,cAdd,wAdd].some(x=>x!==null&&isNaN(x))) return say($("eMsg"),"bad","Concentration and the amounts added have to be numbers, like 8 or 2.5.");
  if(!way&&!cool&&conc==null&&cAdd==null&&wAdd==null&&!other) return say($("eMsg"),"bad","Nothing filled in yet.");
  const r=rangeOf(mid);
  if(conc==null&&!confirm("No coolant concentration reading. Save without it?")) return;
  if(conc!=null&&!inR(conc,r)&&!confirm(`Concentration ${conc} is ${conc<r.lo?"below":"above"} the ${r.lo}-${r.hi} range. Save it as read? Note in Other what was done about it.`)) return;
  if(!mySign()) LS.set("f031sign",sign);
  const now=new Date().toISOString(), id=editId, rec={sign,way,cool,conc,cAdd,wAdd,other};
  const ok=await commit(d=>{ let e=id?d.entries.find(x=>x.id===id):d.entries.find(x=>x.mach===mid&&x.date===date);
    if(e&&!id) return false;
    if(e){ (e.hist=e.hist||[]).push({sign:e.sign,way:e.way,cool:e.cool,conc:e.conc,cAdd:e.cAdd,wAdd:e.wAdd,other:e.other,ed:e.ed||e.at}); Object.assign(e,rec,{ed:now}); }
    else d.entries.push(Object.assign({id:uid(),mach:mid,date,at:now},rec)); },`Mill ${machName(mid)} ${fmtDate(date)} ${sign}`);
  if(ok==="skip"){ say($("eMsg"),"warn","That day was just logged from another phone. Here it is; use Change it if it needs fixing."); editId=null; clearForm(); renderEntry(); return; }
  if(!ok) return; editId=null; clearForm(); $("eCancel").hidden=true;
  say($("eMsg"),"good",`Saved: ${esc(machName(mid))}, ${DAYN[dow(date)]} ${fmtDate(date)}.`); renderEntry(); });

// ---------- records / print ----------
function monthDays(m){ const [y,mo]=m.split("-").map(Number), n=new Date(y,mo,0).getDate(), L=[]; for(let i=1;i<=n;i++) L.push(ymd(new Date(y,mo-1,i))); return L; }
function renderRecords(){ fillMach($("rMach")); if(!$("rMonth").value) $("rMonth").value=today().slice(0,7);
  const mid=$("rMach").value, days=monthDays($("rMonth").value);
  $("rH").innerHTML=`<tr><th>Date</th><th>Sign</th>${COLS.map(t=>`<th>${t}</th>`).join("")}<th></th></tr>`;
  $("rBody").innerHTML=days.map(s=>{ const e=mid&&entryFor(mid,s); return `<tr><td class="l">${DAYN[dow(s)].slice(0,3)} ${fmtDate(s)}</td><td>${e?esc(e.sign):""}</td>${cells(e,s,true,mid)}<td style="white-space:nowrap">${e?`<button type="button" class="btn alt small" data-edit="${esc(e.id)}">Edit</button> <button type="button" class="btn danger small" data-del="${esc(e.id)}">Delete</button>`:s<=today()?`<button type="button" class="btn alt small" data-log="${s}">Log</button>`:""}</td></tr>`; }).join("");
  const go=(date,id)=>{ document.querySelector('nav button[data-tab="entry"]').click(); $("eMach").value=mid; $("eDate").value=date; clearForm();
    if(id){ const e=I.entries.find(x=>x.id===id); editId=id; loadForm(e); } renderEntry(); window.scrollTo(0,0); };
  $("rBody").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>{ const e=I.entries.find(x=>x.id===b.dataset.edit); if(e) go(e.date,e.id); }));
  $("rBody").querySelectorAll("[data-log]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.log)));
  $("rBody").querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async()=>{ const e=I.entries.find(x=>x.id===b.dataset.del); if(!e) return;
    if(!confirm(`Delete the ${fmtDate(e.date)} entry signed ${e.sign}? It stays in the log's history on GitHub.`)) return;
    await commit(d=>{ d.entries=d.entries.filter(x=>x.id!==e.id); d.deleted.push(e.id); },`Mill delete: ${machName(e.mach)} ${fmtDate(e.date)}`); })); }
$("rMach").addEventListener("change",renderRecords); $("rMonth").addEventListener("change",renderRecords);
function sheetHtml(mid,m){ const days=monthDays(m), [y,mo]=m.split("-").map(Number), mname=new Date(y,mo-1,1).toLocaleString("en-US",{month:"long",year:"numeric"}), r=rangeOf(mid);
  const note=r.own?`COOLANT CONCENTRATION FOR THIS MACHINE (SPECIFIED BY ENGINEERING): ${r.lo}-${r.hi}`:I.note;
  return `<div class="f36"><div class="top"><span class="ttl">${esc(I.title)}</span><span class="mach">MACHINE: <b>${esc(machName(mid))}</b> &nbsp; ${esc(mname)}</span></div>
  <div class="note">${esc(note)}</div>
  <table><colgroup><col style="width:10.5%"><col style="width:11.5%"><col style="width:7%"><col style="width:8.5%"><col style="width:8.5%"><col style="width:10.5%"><col style="width:8.5%"><col style="width:8.5%"><col style="width:26.5%"></colgroup>
  <tr><th>DATE</th><th>DAY</th><th>SIGN</th><th>WAYLUBE LEVEL</th><th>COOLANT LEVEL</th><th>COOLANT CONCENTRATION</th><th>COOLANT ADDED</th><th>WATER ADDED</th><th>OTHER</th></tr>
  ${days.map(s=>{ const e=entryFor(mid,s); return `<tr><td>${fmtDate(s)}</td><td>${DAYN[dow(s)]}</td><td>${e?esc(e.sign):""}</td>${cells(e,s,false,mid)}</tr>`; }).join("")}</table>
  <div class="ftr"><span>${esc(I.form)} Rev ${esc(I.rev)}</span><span>Confidential and Proprietary</span></div></div>`; }
function doPrint(ids){ const m=$("rMonth").value; if(!ids.length||!m) return; $("printArea").innerHTML=ids.map(id=>sheetHtml(id,m)).join(""); window.print(); }
$("pOne").addEventListener("click",()=>doPrint($("rMach").value?[$("rMach").value]:[]));
$("pAll").addEventListener("click",()=>doPrint(I.machines.map(m=>m.id)));

// ---------- setup ----------
function renderSetup(){ adminView(); $("sSign").value=mySign(); if(!adminOK) return;
  $("sTitle").value=I.title; $("sForm").value=I.form; $("sRev").value=I.rev; $("sLo").value=I.lo; $("sHi").value=I.hi; $("sUC").value=I.uC; $("sUW").value=I.uW; $("sNote").value=I.note;
  const S=(op,msg)=>adminOK?commit(op,msg):(adminView(),false);
  const ud=(i,n)=>`<button type="button" class="btn alt small" data-up="${i}"${i?"":" disabled"} aria-label="Move up">&#9650;</button><button type="button" class="btn alt small" data-dn="${i}"${i<n-1?"":" disabled"} aria-label="Move down">&#9660;</button>`;
  $("sMach").innerHTML=I.machines.map((m,i)=>`<div class="item">${ud(i,I.machines.length)}<input data-mi="${i}" value="${esc(m.name)}" aria-label="Mill name"><button type="button" class="btn danger small" data-mdel="${i}">Remove</button></div>
    <div class="shows">Own coolant range: <span class="rng"><input data-mlo="${i}" inputmode="decimal" placeholder="${I.lo}" value="${m.lo??""}" aria-label="Low" class="tybox">to<input data-mhi="${i}" inputmode="decimal" placeholder="${I.hi}" value="${m.hi??""}" aria-label="High" class="tybox"></span><span class="hint">${m.lo!=null||m.hi!=null?"engineering range":"blank = shop range"}</span></div>`).join("")||`<p class="hint">No mills yet.</p>`;
  $("sOff").innerHTML=DAYN.map((d,i)=>`<button type="button" class="chip${(I.off||[]).includes(i)?" on":""}" data-off="${i}">${d}</button>`).join("");
  $("sMach").querySelectorAll("[data-up],[data-dn]").forEach(b=>b.addEventListener("click",()=>{ const up=!!b.dataset.up, key=I.machines[+(b.dataset.up||b.dataset.dn)].id;
    S(d=>{ const a=d.machines, x=a.findIndex(m=>m.id===key), y=x+(up?-1:1); if(x<0||y<0||y>=a.length) return false; [a[x],a[y]]=[a[y],a[x]]; },"Mills setup: reorder"); }));
  $("sMach").querySelectorAll("[data-mi]").forEach(el=>el.addEventListener("change",()=>{ const m=I.machines[+el.dataset.mi], v=el.value.trim(); if(!v){ el.value=m.name; return; }
    S(d=>{ const x=d.machines.find(q=>q.id===m.id); if(!x) return false; x.name=v; },`Mills setup: rename ${v}`); }));
  [["mlo","lo"],["mhi","hi"]].forEach(([a,k])=>$("sMach").querySelectorAll(`[data-${a}]`).forEach(el=>el.addEventListener("change",()=>{ const m=I.machines[+el.dataset[a]], v=num(el.value);
    if(v!==null&&isNaN(v)){ say($("sMsg"),"bad","The range has to be numbers."); return renderSetup(); }
    S(d=>{ const x=d.machines.find(q=>q.id===m.id); if(!x) return false; if(v===null) delete x[k]; else x[k]=v; },`Mills setup: ${m.name} range`); })));
  $("sMach").querySelectorAll("[data-mdel]").forEach(b=>b.addEventListener("click",()=>{ const m=I.machines[+b.dataset.mdel], n=I.entries.filter(e=>e.mach===m.id).length;
    if(n) return say($("sMsg"),"bad",`${esc(m.name)} has ${n} entr${n===1?"y":"ies"}, so it stays. Rename it instead.`);
    S(d=>{ d.machines=d.machines.filter(q=>q.id!==m.id); },`Mills setup: remove ${m.name}`); }));
  $("sOff").querySelectorAll("[data-off]").forEach(b=>b.addEventListener("click",()=>{ const i=+b.dataset.off;
    S(d=>{ d.off=(d.off||[]).includes(i)?d.off.filter(x=>x!==i):[...(d.off||[]),i]; },`Mills setup: days off`); })); }
$("sMachAdd").addEventListener("click",()=>{ if(!adminOK) return; commit(d=>{ d.machines.push({id:uid(),name:"New mill"}); },"Mills setup: add mill"); });
[["lo","sLo"],["hi","sHi"]].forEach(([k,id])=>$(id).addEventListener("change",()=>{ if(!adminOK) return; const v=num($(id).value); if(v===null||isNaN(v)){ say($("sMsg"),"bad","The shop range has to be numbers."); return renderSetup(); } commit(d=>{ d[k]=v; },`Mills setup: shop range ${k}`); }));
[["title","sTitle"],["form","sForm"],["rev","sRev"],["uC","sUC"],["uW","sUW"],["note","sNote"]].forEach(([k,id])=>$(id).addEventListener("change",()=>{ if(!adminOK) return; const v=$(id).value.trim(); commit(d=>{ d[k]=v||(k==="uC"||k==="uW"?"":blank()[k]); },`Mills setup: ${k}`); }));
function qrSvg(text){ const q=new QRCode(-1,0); q.addData(text); q.make(); const n=q.getModuleCount(), b=4; let p="";
  for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(q.isDark(r,c)) p+=`M${c+b} ${r+b}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n+2*b} ${n+2*b}" shape-rendering="crispEdges" style="width:2.4in;height:2.4in;display:block;margin:0 auto"><rect width="100%" height="100%" fill="#fff"/><path d="${p}" fill="#000"/></svg>`; }
$("sQr").addEventListener("click",()=>{ if(!adminOK) return; if(location.protocol==="file:") return say($("sMsg"),"bad","Open the log from its web address first; the codes point at whatever address this page has.");
  const base=location.href.split(/[?#]/)[0];
  $("printArea").innerHTML=`<div class="qrs">${I.machines.map(m=>`<div class="qc">${qrSvg(base+"?m="+encodeURIComponent(m.id))}<div class="qn">${esc(m.name)}</div><div class="qt">Scan for the daily mill checklist (${esc(I.form)})</div></div>`).join("")}</div>`; window.print(); });

function pickFromLink(){ const m=new URLSearchParams(location.search).get("m"); if(m&&I.machines.some(x=>x.id===m)){ LS.set("f036mach",m); $("eMach").value=m; $("rMach").value=m; } }
window.formDirty=()=>!!(way||cool||$("eConc").value.trim()||$("eCAdd").value.trim()||$("eWAdd").value.trim()||$("eOther").value.trim()||editId);
function renderAll(){ showBrand(F); if(F) LS.set("f031brand",JSON.stringify({company:F.company||"",logo:F.logo||""}));
  $("ttl").textContent="CNC Mills Daily Checklist"; formNav($("formLine"),I.rev);
  renderEntry(); renderRecords(); renderSetup(); }
// ---------- start ----------
const hidePw=()=>document.querySelectorAll(".pwwrap").forEach(w=>{ const i=w.querySelector("input"), b=w.querySelector("button"); i.type="password"; b.textContent="Show"; b.setAttribute("aria-label","Show password"); });
document.querySelectorAll('input[type="password"]').forEach(inp=>{ const w=document.createElement("span"); w.className="pwwrap";
  inp.parentNode.insertBefore(w,inp); w.appendChild(inp); const b=document.createElement("button"); b.type="button"; b.className="pwbtn"; b.textContent="Show"; b.setAttribute("aria-label","Show password");
  b.addEventListener("click",()=>{ const show=inp.type==="password"; inp.type=show?"text":"password"; b.textContent=show?"Hide":"Show"; b.setAttribute("aria-label",(show?"Hide":"Show")+" password"); inp.focus(); });
  w.appendChild(b); });
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible"&&!editId) refresh(true); });
if(!CFG||!CFG.lock){ document.body.innerHTML='<div class="lock"><h2>Not set up yet</h2><p class="hint">config.js is missing. It is the same config.js the F-031 log uses; put this page next to it.</p></div>'; }
else { adminOK=!CFG.admin||LS.get("f031admin")===CFG.admin.hash; TOKEN=LS.get("f031token"); if(TOKEN) open_(); else showLock(); }
