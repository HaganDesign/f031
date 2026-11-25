"use strict";
// F-030 ICC Orbit Sheet - online log. Same lock, key and admin password as the F-031 log (shared config.js).
// Its own file in the private data repo; it also reads the F-031 log (never writes it) for the machine list,
// the company name/logo and the last filter change on the ICC machine.

const APP="F-030 ICC Orbit Log";
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
const ICC_PATH=(CFG&&CFG.iccPath)||"f030-icc-log.json";
const f4=v=>(Math.round(v*10000)/10000).toFixed(4);
const num=v=>{ const x=parseFloat(String(v).trim()); return isFinite(x)?x:NaN; };

function blank(){ return {app:APP,v:1,pn:"1704612",form:"F-030",rev:"-",mach:"",
  spec:{orbit:0.0195,yp:0.512,ym:-0.465,step:0.0005,burns:5,per:8,filt:10},
  sets:[],stockLog:[],lowSets:8,boxSets:12,stockAt:new Date().toISOString(),deleted:[]}; }
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
  const d=Object.assign(blank(),a.d||{}); d.spec=Object.assign(blank().spec,d.spec||{}); return {d,sha:a.sha,f:b.d}; }
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
  try{ const p=await pull(); I=p.d; SHA=p.sha; F=p.f; setSync(); renderAll(); }catch(e){ failed(e); } }
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
$("sSign").addEventListener("change",()=>{ LS.set("f031sign",$("sSign").value.trim().toUpperCase()); if(!editId) $("bSign").value=mySign(); });

// ---------- tabs ----------
document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("on",x===b));
  ["entry","records","setup"].forEach(t=>$("tab-"+t).hidden=t!==b.dataset.tab);
  renderAll();
}));

// ---------- the rules: sets, expected values, electrodes, filters ----------
const curSet=()=>I.sets[I.sets.length-1]||null;
const setFull=s=>!s||s.burns.length>=s.spec.burns;
const expect=(spec,k)=>({orbit:spec.orbit+spec.step*(k-1), yp:spec.yp+spec.step*(k-1), ym:spec.ym-spec.step*(k-1)});
const setNo=s=>I.sets.indexOf(s)+1;
const openBurn=()=>{ const s=curSet(); const b=s&&s.burns[s.burns.length-1]; return b&&!b.rt&&!b.noTime?{s,b}:null; };
function nextBurn(){ const s=curSet(); if(setFull(s)) return {newSet:true,k:1,spec:I.spec}; return {newSet:false,set:s,k:s.burns.length+1,spec:s.spec}; }
// electrodes: last count + received - a full set per new set - chipped swaps - scrapped, since the count
// Good electrodes: last count + received - a full set per new set - chipped (set changes and found) - other scrap, since the count.
// Chipped pile: chipped at the last count + chipped since - reported/sent back to the maker since.
function eBase(){ const c=I.stockLog.filter(e=>e.kind==="count").sort((x,y)=>x.at<y.at?-1:1).pop(); return c?{qty:c.qty,chipped:c.chipped||0,at:c.at,by:c.by}:{qty:0,chipped:0,at:I.stockAt,by:""}; }
function chipList(after){ const L=[]; I.sets.forEach(s=>{ if(s.chip&&s.at>after) L.push({at:s.at,date:s.burns[0]?s.burns[0].date:dayOf(s.at),qty:s.chip,by:s.by,where:`Set ${setNo(s)} change`}); });
  I.stockLog.forEach(e=>{ if(e.kind==="chip"&&e.at>after) L.push({at:e.at,date:dayOf(e.at),qty:e.qty,by:e.by,where:e.note||"Found"}); }); return L.sort((x,y)=>x.at<y.at?-1:1); }
function eHand(){ const b=eBase(), day=dayOf(b.at); let recv=0, scrap=0, used=0, sets=0, chip=0, found=0, sent=0;
  I.stockLog.forEach(e=>{ if(e.at<=b.at) return; if(e.kind==="recv") recv+=e.qty; if(e.kind==="scrap") scrap+=e.qty; if(e.kind==="chip") found+=e.qty; if(e.kind==="vendor") sent+=e.qty; });
  I.sets.forEach(s=>{ const first=s.burns[0]; if(s.at>b.at&&(!first||first.date>=day)){ sets++; used+=s.per||s.spec.per; chip+=s.chip||0; } });
  return {qty:b.qty+recv-used-chip-found-scrap, pile:b.chipped+chip+found-sent, base:b,recv,scrap,sets,used,chip,found,sent}; }
const lastVendor=()=>I.stockLog.filter(e=>e.kind==="vendor").sort((x,y)=>x.at<y.at?-1:1).pop()||null;
// filters: burns on the ICC machine since its last F-031 filter change
function lastFilter(){ if(!F||!I.mach) return null; const others=F.others||[];
  return (F.entries||[]).filter(e=>e.mach===I.mach&&(e.filters||[]).some(n=>!others.includes(n))).sort((a,b)=>a.at<b.at?-1:1).pop()||null; }
function burnsSinceFilter(){ const lf=lastFilter(); if(!lf) return null; let n=0;
  // a cut runs on whatever filters are in when it finishes: go by when the run time went in (still cutting = now)
  const now=new Date().toISOString();
  I.sets.forEach(s=>s.burns.forEach(b=>{ const t=b.rtAt||(!b.rt&&!b.noTime?now:b.at); if(t>lf.at&&(b.date>=lf.date||t.slice(0,10)>=lf.date)) n++; })); return {n,lf}; }
const lowAt=()=>(I.lowSets||0)*(I.spec.per||8);   // reorder point, in electrodes
const machName=()=>{ const m=F&&(F.machines||[]).find(x=>x.id===I.mach); return m?m.name:""; };
const f031Link=()=>`index.html${I.mach?`?m=${encodeURIComponent(I.mach)}`:""}`;

// ---------- tally board: the dry-erase marks the shop used, four up and one across, two rows = filter change ----------
function tallyRow(n){ let s=""; for(let i=0;i<Math.min(n,4);i++) s+=`<line x1="${10+i*14}" y1="6" x2="${10+i*14}" y2="46"/>`;
  if(n>=5) s+=`<line x1="2" y1="40" x2="62" y2="12"/>`; return `<svg viewBox="0 0 66 52" width="66" height="52" aria-hidden="true"><g stroke="currentColor" stroke-width="4" stroke-linecap="round">${s}</g></svg>`; }
function tallyHtml(){ const fs=burnsSinceFilter(), s=curSet(), per=I.spec.burns||5, filt=I.spec.filt||10;
  const k=s&&!setFull(s)?s.burns.length:(s&&s.burns.length>=per&&openBurn()?per:0);
  let n=fs?fs.n:null;
  if(n===null){ return `<div class="tally"><div class="trow">${tallyRow(k)}<span>${k} of ${per} on this set</span></div></div>`; }
  const r1=Math.min(n,per), r2=Math.max(0,Math.min(n-per,per));
  const cut=!!openBurn();
  const msg=n>=filt?(cut&&n===filt?"Last burn before filters and electrodes":"Filters and electrodes due"):n>=per&&n%per===0?(cut?"Last burn on this set":"Electrodes due"):`${n} of ${filt} on these filters`;
  return `<div class="tally${n>=filt?" due":""}"><div class="trow">${tallyRow(r1)}${n>=per||r2?tallyRow(r2):""}</div><div class="tmsg">${msg}</div></div>`; }

// run time: two boxes (phone number pads have no colon), stored as h:mm
const rtGet=p=>{ const h=$(p+"h").value.trim(), m=$(p+"m").value.trim(); if(!h&&!m) return ""; if(!/^\d{0,3}$/.test(h)||!/^\d{0,2}$/.test(m)) return "x"; return `${+h||0}:${String(+m||0).padStart(2,"0")}`; };
const rtOk=s=>!s||(/^\d{1,3}:\d{2}$/.test(s)&&+s.split(":")[1]<60&&/^\d*$/.test(s.replace(":","")));
const rtSet=(p,s)=>{ const [h,m]=String(s||"").split(":"); $(p+"h").value=h||""; $(p+"m").value=m||""; };
// ---------- new burn ----------
let editId=null;
function fillVals(v){ $("bOrb").value=f4(v.orbit); $("bYp").value=f4(v.yp); $("bYm").value=f4(v.ym); }
function setDiff(on){ $("bDiff").checked=on; ["bOrb","bYp","bYm"].forEach(id=>$(id).readOnly=!on); }
function renderEntry(){
  document.querySelectorAll(".nBurns").forEach(e=>e.textContent=I.spec.burns); document.querySelectorAll(".nSet").forEach(e=>e.textContent=I.spec.per);
  const fs=burnsSinceFilter(), h=eHand();
  let ban="";
  if(fs&&I.spec.filt&&fs.n>=I.spec.filt) ban+=`<div class="banner bad"><b>Filters are due.</b> ${fs.n} burns since the last filter change on ${esc(machName())} (${fmtDate(fs.lf.date)}). Change them before the next burn and log it on F-031: <a href="${f031Link()}">open F-031 for ${esc(machName())}</a>.</div>`;
  else if(fs&&I.spec.filt&&fs.n>=I.spec.filt-I.spec.burns) ban+=`<div class="banner warn">Filters are due after this set: ${fs.n} of ${I.spec.filt} burns since the last change on ${fmtDate(fs.lf.date)}.</div>`;
  if(h.qty<(I.spec.per||8)) ban+=`<div class="banner bad">Only ${h.qty} electrodes on hand, less than one set. Tell the admin.</div>`;
  else if(lowAt()&&h.qty<=lowAt()) ban+=`<div class="banner warn"><b>Order electrodes.</b> ${h.qty} on hand, ${Math.floor(h.qty/I.spec.per)} set${Math.floor(h.qty/I.spec.per)===1?"":"s"} left (the reorder point is ${I.lowSets}). Let the admin know.</div>`;
  $("bBanner").innerHTML=ban; $("bTally").innerHTML=tallyHtml();
  if(editId){ const {s,b}=findBurn(editId)||{}; if(!s) return stopEdit();
    $("bHead").innerHTML=`<b>Editing burn ${s.burns.indexOf(b)+1} of set ${setNo(s)}</b><span class="hint">Change what you need and tap Save changes.</span>`; $("bNew").hidden=true; $("bChipBox").hidden=true; $("bFinish").hidden=true; $("bForm").hidden=false; return; }
  const ob=openBurn();
  $("bFinish").hidden=!ob; $("bForm").hidden=!!ob; if(ob){ $("bNew").hidden=true; $("bChipBox").hidden=true; }
  if(ob){ const k=ob.s.burns.length;
    $("bHead").innerHTML=`<b>Set ${setNo(ob.s)} &middot; burn ${k} of ${ob.s.spec.burns}</b><span class="hint">P/N ${esc(I.pn)}${machName()?` &middot; ${esc(machName())}`:""} &middot; ${h.qty} electrodes on hand</span>`;
    $("bFinTxt").innerHTML=`<b>Cutting now: S/N ${esc(ob.b.sn)}</b><br>Orbit ${f4(ob.b.orbit)} &middot; Y+ ${f4(ob.b.yp)} &middot; Y- ${f4(ob.b.ym)} &middot; started by ${esc(ob.b.sign)} ${shortDate(ob.b.date)}<br>When it's done cutting, enter the run time. The next part comes after that.`;
    if(!$("bFinSign").value) $("bFinSign").value=mySign(); return; }
  const nb=nextBurn();
  $("bHead").innerHTML=`<b>Set ${nb.newSet?I.sets.length+1:setNo(nb.set)} &middot; burn ${nb.k} of ${nb.spec.burns}</b><span class="hint">P/N ${esc(I.pn)}${machName()?` &middot; ${esc(machName())}`:""} &middot; ${h.qty} electrodes on hand</span>`;
  $("bNew").hidden=!nb.newSet; $("bChipBox").hidden=!nb.newSet; if(!nb.newSet) $("bChipBox").open=false;
  if(!$("bDiff").checked) fillVals(expect(nb.spec,nb.k));
  if(!$("bDate").value) $("bDate").value=today();
  if(!$("bSign").value) $("bSign").value=mySign();
  $("bStock").innerHTML=nb.newSet?`Starting this set takes ${I.spec.per} electrodes, plus any chipped ones swapped. Keep the chipped ones aside for the maker.`:"";
}
$("bDiff").addEventListener("change",()=>{ setDiff($("bDiff").checked); if(!$("bDiff").checked&&!editId){ const nb=nextBurn(); fillVals(expect(nb.spec,nb.k)); } });
async function finishBurn(rt,note){ const ob=openBurn(); if(!ob) return; const id=ob.b.id, by=$("bFinSign").value.trim().toUpperCase()||mySign(), now=new Date().toISOString();
  const ok=await commit(d=>{ for(const s of d.sets){ const b=s.burns.find(x=>x.id===id); if(b){ if(b.rt||b.noTime) return false; if(rt) b.rt=rt; else { b.noTime=true; b.note=[b.note,note].filter(Boolean).join(" / "); } b.rtBy=by; b.rtAt=now; return; } } return false; },
    rt?`ICC run time: ${ob.b.sn} ${rt} ${by}`:`ICC no time: ${ob.b.sn} ${by}`);
  if(ok==="skip"){ say($("bMsg"),"warn","Someone already closed that burn. Here's the latest."); renderEntry(); return; }
  if(!ok) return; rtSet("bFinRT",""); $("bFinNote").value=""; document.querySelector("#bFinish details").open=false; window.scrollTo(0,0);
  say($("bMsg"),"good",rt?`Run time ${esc(rt)} saved for S/N ${esc(ob.b.sn)}.`:`S/N ${esc(ob.b.sn)} closed without a time.`); renderEntry();
  const s=curSet(); if(setFull(s)){ const fs=burnsSinceFilter(); await dialog("Set finished",`<p>That was burn ${s.spec.burns}. The next part starts a new set of ${I.spec.per} electrodes, back at orbit ${f4(I.spec.orbit)}.</p>${fs&&I.spec.filt&&fs.n>=I.spec.filt?`<p><b>Filters are due now.</b> Change them and log it on F-031 before the next burn.</p>`:fs&&I.spec.filt&&fs.n+I.spec.burns>=I.spec.filt?`<p><b>Filters are due after the next set.</b></p>`:""}`,[{t:"OK",v:0}]); } }
$("bFinGo").addEventListener("click",()=>{ const rt=rtGet("bFinRT"); if(!rt||!rtOk(rt)) return say($("bMsg"),"bad","Enter the hours and minutes it ran (minutes 0 to 59)."); finishBurn(rt); });
["bFinRTh","bFinRTm"].forEach(id=>$(id).addEventListener("keydown",e=>{ if(e.key==="Enter") $("bFinGo").click(); }));
$("bFinNo").addEventListener("click",()=>{ const n=$("bFinNote").value.trim(); if(!n) return say($("bMsg"),"bad","Write what happened before closing it without a time."); finishBurn("",n); });
function findBurn(id){ for(const s of I.sets){ const b=s.burns.find(x=>x.id===id); if(b) return {s,b}; } return null; }
function startEdit(id){ const f=findBurn(id); if(!f) return; editId=id; document.querySelector('nav button[data-tab="entry"]').click();
  const b=f.b; $("bSN").value=b.sn; fillVals(b); setDiff(!!b.diff); rtSet("bRT",b.rt); $("bSign").value=b.sign; $("bDate").value=b.date; $("bNote").value=b.note||"";
  $("bSave").textContent="Save changes"; $("bCancel").hidden=false; document.querySelector('nav button[data-tab="entry"]').textContent="Edit burn"; say($("bMsg")); renderEntry(); window.scrollTo(0,0); }
function stopEdit(){ editId=null; $("bSave").textContent="Save burn"; $("bCancel").hidden=true; document.querySelector('nav button[data-tab="entry"]').textContent="New burn";
  ["bSN","bRTh","bRTm","bNote"].forEach(id=>$(id).value=""); $("bChip").value="0"; setDiff(false); $("bDate").value=today(); $("bSign").value=mySign(); }
$("bCancel").addEventListener("click",()=>{ stopEdit(); say($("bMsg")); renderEntry(); });

function dialog(title,html,buttons){ return new Promise(res=>{ $("dlgT").textContent=title; $("dlgB").innerHTML=html;
  $("dlgBtns").innerHTML=buttons.map((b,i)=>`<button type="button" class="btn${b.alt?" alt":""}" data-i="${i}">${esc(b.t)}</button>`).join("");
  $("dlg").hidden=false; $("dlgBtns").querySelectorAll("button").forEach(x=>x.onclick=()=>{ $("dlg").hidden=true; res(buttons[+x.dataset.i].v); }); }); }

$("bSave").addEventListener("click",async()=>{
  const sn=$("bSN").value.trim().toUpperCase(), rt=rtGet("bRT"), sign=$("bSign").value.trim().toUpperCase(), date=$("bDate").value, note=$("bNote").value.trim(), diff=$("bDiff").checked;
  const orbit=num($("bOrb").value), yp=num($("bYp").value), ym=num($("bYm").value);
  if(!sn) return say($("bMsg"),"bad","Enter the part serial number.");
  if(![orbit,yp,ym].every(isFinite)) return say($("bMsg"),"bad","The orbit and both depths have to be numbers.");
  if(!rtOk(rt)) return say($("bMsg"),"bad","Run time: hours in the first box, minutes (0 to 59) in the second.");
  if(!sign) return say($("bMsg"),"bad","Enter your initials.");
  if(!date) return say($("bMsg"),"bad","Enter the date.");
  if(diff&&!note) return say($("bMsg"),"bad","Different values were used, so write why in the note.");
  if(!mySign()) LS.set("f031sign",sign);
  const now=new Date().toISOString();
  if(editId){ const id=editId;
    const ok=await commit(d=>{ for(const s of d.sets){ const b=s.burns.find(x=>x.id===id); if(b){ (b.hist=b.hist||[]).push({sn:b.sn,orbit:b.orbit,yp:b.yp,ym:b.ym,diff:b.diff,rt:b.rt,sign:b.sign,date:b.date,note:b.note,ed:b.ed||b.at}); Object.assign(b,{sn,orbit,yp,ym,diff,rt,sign,date,note,ed:now}); return; } } return false; },`ICC edit: ${sn} ${sign}`);
    if(ok===true){ stopEdit(); say($("bMsg"),"good",`Changes saved for S/N ${esc(sn)}.`); renderEntry(); } return; }
  const due=burnsSinceFilter();
  if(due&&I.spec.filt&&due.n>=I.spec.filt){ const v=await dialog("Filters are overdue",`<p>${due.n} burns since the last filter change on ${esc(machName())} (${fmtDate(due.lf.date)}). The filters should be changed before this burn.</p><p>If they were changed, log it on F-031 first so the count resets.</p>`,[{t:"Open F-031 to log it",v:"f031"},{t:"Save this burn anyway",v:"go",alt:true},{t:"Cancel",v:"no",alt:true}]);
    if(v==="f031"){ location.href=f031Link(); return; } if(v!=="go") return; }
  const nb=nextBurn(), chip=nb.newSet?Math.max(0,Math.round(+$("bChip").value||0)):0, ex=expect(nb.spec,nb.k);
  if(nb.newSet){ const h=eHand().qty, take=I.spec.per+chip;
    const go=await dialog("Start a new electrode set?",`<p>Set ${I.sets.length+1}, burn 1. Load a fresh set of ${I.spec.per} electrodes and run the start values:</p><p class="big"><b>Orbit ${f4(ex.orbit)} &middot; Y+ ${f4(ex.yp)} &middot; Y- ${f4(ex.ym)}</b></p><p>This takes ${take} good electrode${take===1?"":"s"} from stock${chip?` (${chip} chipped go on the chipped pile for the maker)`:""}: ${h} on hand, ${h-take} after.</p>`,[{t:"Start the new set",v:true},{t:"Cancel",v:false,alt:true}]);
    if(!go) return; }
  const burn={id:uid(),sn,orbit,yp,ym,diff:diff||undefined,rt,sign,date,note,at:now};
  const ok=await commit(d=>{ const s=d.sets[d.sets.length-1], lb=s&&s.burns[s.burns.length-1];
    if(lb&&!lb.rt&&!lb.noTime) return false;   // another phone started a burn that's still cutting
    if(nb.newSet){ if(s&&s.burns.length<s.spec.burns) return false; d.sets.push({id:uid(),at:now,by:sign,spec:JSON.parse(JSON.stringify(d.spec)),per:d.spec.per,chip,burns:[burn]}); }
    else { if(!s||s.id!==nb.set.id||s.burns.length!==nb.k-1) return false; s.burns.push(burn); } },`ICC burn ${nb.k}: ${sn} ${sign}`);
  if(ok==="skip"){ say($("bMsg"),"warn","Someone else saved a burn at the same moment. Check the set and burn number above, then save again."); renderEntry(); return; }
  if(!ok) return;
  ["bSN","bRTh","bRTm","bNote"].forEach(id=>$(id).value=""); $("bChip").value="0"; $("bChipBox").open=false; setDiff(false);
  say($("bMsg"),"good",`Saved: burn ${nb.k} of set ${I.sets.length}, S/N ${esc(sn)}.${rt?"":" Enter the run time here when it's done cutting."}`); renderEntry();
  if(!rt) return;   // still cutting: the set-finished and filter messages come when the run time goes in
  const fs=burnsSinceFilter(), s=curSet();
  if(fs&&I.spec.filt&&fs.n>=I.spec.filt) await dialog("Filters are due",`<p>${fs.n} burns since the last filter change on ${esc(machName())}. Change the filters before the next burn, then log it on F-031.</p>`,[{t:"Open F-031",v:1},{t:"Later",v:0,alt:true}]).then(v=>{ if(v) location.href=f031Link(); });
  else if(setFull(s)) await dialog("Set finished",`<p>That was burn ${s.spec.burns}. The next burn starts a new set of ${I.spec.per} electrodes, back at orbit ${f4(I.spec.orbit)}.</p>${fs&&I.spec.filt&&fs.n+I.spec.burns>=I.spec.filt?`<p><b>Filters are due after the next set.</b></p>`:""}`,[{t:"OK",v:0}]);
});

// ---------- records / print ----------
const inRange=s=>{ const fr=$("pFrom").value, to=$("pTo").value; return s.burns.some(b=>(!fr||b.date>=fr)&&(!to||b.date<=to)); };
function renderRecords(){ const last=curSet();
  $("rList").innerHTML=I.sets.slice().reverse().map(s=>`<h3 style="margin:18px 0 6px">Set ${setNo(s)} <span class="hint" style="font-weight:normal">started ${fmtDate(s.burns[0]?s.burns[0].date:dayOf(s.at))} by ${esc(s.by)}${s.chip?` &middot; ${s.chip} chipped swapped`:""}</span></h3>
    <div class="tbl"><table class="log runtbl"><thead><tr><th>#</th><th>Serial Number</th><th>Orbit</th><th>Y+</th><th>Y-</th><th>Run Time</th><th>Initial/Date</th><th></th></tr></thead><tbody>
    ${s.burns.map((b,i)=>`<tr><td>${i+1}</td><td class="l">${esc(b.sn)}${b.note?`<div class="hint">${esc(b.note)}</div>`:""}</td><td class="${b.diff?"off":""}">${f4(b.orbit)}</td><td class="${b.diff?"off":""}">${f4(b.yp)}</td><td class="${b.diff?"off":""}">${f4(b.ym)}</td><td>${b.rt?esc(b.rt):b.noTime?`<span class="hint">no time</span>`:`<span class="hint">cutting</span>`}</td><td>${esc(b.sign)} ${shortDate(b.date)}${b.ed?` <span class="hint">(edited)</span>`:""}</td>
      <td style="white-space:nowrap"><button type="button" class="btn alt small" data-edit="${esc(b.id)}">Edit</button>${s===last&&i===s.burns.length-1?` <button type="button" class="btn danger small" data-del="${esc(b.id)}">Delete</button>`:""}</td></tr>`).join("")}
    </tbody></table></div>`).join("")||`<p class="hint">No burns yet.</p>`;
  $("rList").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>startEdit(b.dataset.edit)));
  $("rList").querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async()=>{ const f=findBurn(b.dataset.del); if(!f) return;
    if(!confirm(`Delete burn ${f.s.burns.length}, S/N ${f.b.sn}?${f.s.burns.length===1?` That removes set ${setNo(f.s)} too, and its electrodes go back on the count.`:""} It stays in the log's history on GitHub.`)) return;
    await commit(d=>{ const s=d.sets[d.sets.length-1]; if(!s||!s.burns.length||s.burns[s.burns.length-1].id!==f.b.id) return false; s.burns.pop(); if(!s.burns.length) d.sets.pop(); d.deleted.push(f.b.id); },`ICC delete: ${f.b.sn}`); })); }
function sheetHtml(s){ const rows=[]; for(let i=0;i<s.spec.burns;i++){ const b=s.burns[i];
    rows.push(b?`<tr><td>${i+1}</td><td class="sn">S/N ${esc(b.sn)}</td><td>${f4(b.orbit)}</td><td>${f4(b.yp)}</td><td>${f4(b.ym)}</td><td>${b.rt?esc(b.rt):b.noTime?`<span class="hint">no time</span>`:`<span class="hint">cutting</span>`}</td><td>${esc(b.sign)} ${shortDate(b.date)}</td></tr>`:`<tr><td>${i+1}</td><td class="sn">S/N</td><td></td><td></td><td></td><td></td><td></td></tr>`); }
  const notes=s.burns.map((b,i)=>b.note?`Burn ${i+1}: ${esc(b.note)}`:"").filter(Boolean);
  return `<div class="f30"><div class="ttl">ICC ORBIT SHEET P/N ${esc(I.pn)}</div>
    <table><colgroup><col style="width:5%"><col style="width:20%"><col style="width:13%"><col style="width:13%"><col style="width:13%"><col style="width:16%"><col style="width:20%"></colgroup>
    <tr><th></th><th>Serial Number</th><th>ORBIT</th><th>Y+ Depth</th><th>Y- Depth</th><th>Run Time</th><th>OPR. Initial/Date</th></tr>${rows.join("")}</table>
    ${notes.length?`<div class="sub">${notes.join(" &nbsp; ")}</div>`:""}
    <div class="ftr"><span>${esc(I.form)} Rev ${esc(I.rev)}</span><span>Confidential and Proprietary</span></div></div>`; }
$("pPrint").addEventListener("click",()=>{ const L=I.sets.filter(inRange); if(!L.length) return say($("rMsg"),"bad","No sets in those dates.");
  say($("rMsg")); $("printArea").innerHTML=L.map(sheetHtml).join(""); window.print(); });

// ---------- setup ----------
function renderSetup(){ adminView(); $("sSign").value=mySign(); if(!adminOK) return;
  $("sPN").value=I.pn; $("sForm").value=I.form; $("sRev").value=I.rev;
  $("sOrb").value=f4(I.spec.orbit); $("sYp").value=f4(I.spec.yp); $("sYm").value=f4(I.spec.ym); $("sStep").value=f4(I.spec.step);
  $("sBurns").value=I.spec.burns; $("sPer").value=I.spec.per; $("sFilt").value=I.spec.filt;
  const ms=(F&&F.machines)||[]; $("sMachF").innerHTML=`<option value="">Pick the ICC machine</option>`+ms.map(m=>`<option value="${esc(m.id)}"${m.id===I.mach?" selected":""}>${esc(m.name)}</option>`).join("");
  const h=eHand(), fmt=iso=>{ const d=new Date(iso); return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; }, per=I.spec.per, box=I.boxSets||12;
  const log=I.stockLog.slice().sort((x,y)=>x.at<y.at?1:-1).slice(0,8), lv=lastVendor(), CL=chipList(lv&&lv.at>h.base.at?lv.at:h.base.at);
  if(h.base.chipped&&!(lv&&lv.at>h.base.at)) CL.unshift({at:h.base.at,date:dayOf(h.base.at),qty:h.base.chipped,by:h.base.by,where:"Already held at the physical count"});
  const since=[h.recv?`+${h.recv} received`:"",h.sets?`-${h.used} in ${h.sets} new set${h.sets===1?"":"s"}`:"",h.chip+h.found?`-${h.chip+h.found} chipped`:"",h.scrap?`-${h.scrap} other scrap`:""].filter(Boolean).join(", ");
  const calc=(p)=>`<span class="hint" id="${p}Tot"></span>`;
  $("sStock").innerHTML=`<div class="stockcard"><div class="onhand${h.qty<per||(lowAt()&&h.qty<=lowAt())?" low":""}"><b>${h.qty}</b> good electrodes on hand <span class="hint">(${Math.floor(Math.max(0,h.qty)/per)} full set${Math.floor(Math.max(0,h.qty)/per)===1?"":"s"} worth)</span></div>
    <div class="hint">${h.base.by?`Counted ${h.base.qty} good on ${fmt(h.base.at)} by ${esc(h.base.by)}`:`Starting from 0, ${fmt(h.base.at)}`}${since?`. Since then: ${since}`:""}.</div>
    <div class="onhand" style="margin-top:12px"><b>${h.pile}</b> chipped held for the maker</div>
    <div class="hint">${lv?`Last reported ${lv.qty} on ${fmt(lv.at)} by ${esc(lv.by)}. `:""}${CL.length?`On the list: ${CL.reduce((t,x)=>t+x.qty,0)} chipped.`:""}</div>
    ${CL.length?`<details><summary>Chipped list for the maker</summary>${CL.map(x=>`<div class="hint">${fmtDate(x.date)} &middot; ${x.qty} &middot; ${esc(x.where)} &middot; ${esc(x.by)}</div>`).join("")}<div class="btns"><button type="button" class="btn alt small" id="sChipPrint">Print the chipped list</button></div></details>`:""}

    <h3 style="margin:16px 0 4px">Received</h3>
    <div class="cnt3"><label class="f">Boxes<input type="number" min="0" step="1" id="sRbx" inputmode="numeric"></label><label class="f">Sets<input type="number" min="0" step="1" id="sRst" inputmode="numeric"></label><label class="f">Loose<input type="number" min="0" step="1" id="sRls" inputmode="numeric"></label></div>
    <div class="row3">${calc("sR")}<button type="button" class="btn alt small" id="sRb">Add received</button></div>

    <h3 style="margin:16px 0 4px">Physical count</h3>
    <div class="cnt3"><label class="f">Full sets<input type="number" min="0" step="1" id="sCst" inputmode="numeric"></label><label class="f">Loose good<input type="number" min="0" step="1" id="sCls" inputmode="numeric"></label><label class="f">Chipped held<input type="number" min="0" step="1" id="sCch" inputmode="numeric"></label></div>
    <div class="row3">${calc("sC")}<button type="button" class="btn alt small" id="sCb">Set count</button></div>
    <div class="hint">Count wrapped sets, loose good ones (spares left from covering chipped ones) and the chipped ones kept aside. Chipped are never counted as good.</div>

    <h3 style="margin:16px 0 4px">Take off</h3>
    <div class="row3"><label class="f">Chipped found<input type="number" min="1" step="1" id="sKq" inputmode="numeric" placeholder="how many"></label><button type="button" class="btn alt small" id="sKb">Move to chipped</button></div>
    <div class="row3"><label class="f">Other scrap (broken, lost)<input type="number" min="1" step="1" id="sXq" inputmode="numeric" placeholder="how many"></label><button type="button" class="btn alt small" id="sXb">Take off</button></div>
    <div class="row3"><label class="f">Chipped reported or sent to the maker<input type="number" min="1" step="1" id="sVq" inputmode="numeric" value="${h.pile>0?h.pile:""}"></label><button type="button" class="btn alt small" id="sVb">Mark reported</button></div>

    <h3 style="margin:16px 0 4px">Settings</h3>
    <div class="cnt3"><label class="f">Sets per box<input type="number" min="1" step="1" id="sBox" value="${box}"></label><label class="f">Order more at (sets)<input type="number" min="0" step="1" id="sLow" value="${I.lowSets??""}"></label><span></span></div>
    <div class="hint">${I.lowSets?`Warns at ${lowAt()} good electrodes or fewer (${I.lowSets} sets of ${per}), so there is time to make and ship more.`:"Order more at 0 turns the reorder warning off."} Electrodes per set is under Start values.</div>
    ${log.length?`<details><summary>Counts, deliveries and take-offs</summary>${log.map(e=>`<div class="hint">${fmt(e.at)} &middot; ${e.kind==="count"?`counted ${e.qty} good, ${e.chipped||0} chipped`:e.kind==="recv"?`received ${e.qty}`:e.kind==="chip"?`${e.qty} chipped found`:e.kind==="vendor"?`${e.qty} chipped reported to the maker`:`${e.qty} other scrap`} &middot; ${esc(e.by)}</div>`).join("")}</details>`:""}</div>`;
  const who=()=>mySign()||"ADMIN", S=(op,msg)=>adminOK?commit(op,msg):(adminView(),false), n=id=>Math.max(0,Math.round(+$(id).value||0)), now=()=>new Date().toISOString();
  const rTot=()=>n("sRbx")*box*per+n("sRst")*per+n("sRls"), cTot=()=>n("sCst")*per+n("sCls");
  const showTot=()=>{ $("sRTot").textContent=rTot()?`= ${rTot()} electrodes (${n("sRbx")} x ${box} x ${per} + ${n("sRst")} x ${per} + ${n("sRls")})`:""; $("sCTot").textContent=(cTot()||n("sCch"))?`= ${cTot()} good (${n("sCst")} x ${per} + ${n("sCls")}), ${n("sCch")} chipped`:""; };
  ["sRbx","sRst","sRls","sCst","sCls","sCch"].forEach(id=>$(id).addEventListener("input",showTot));
  $("sRb").onclick=()=>{ const q=rTot(); if(!(q>0)) return say($("sMsg"),"bad","Enter the boxes, sets or loose electrodes that came in.");
    S(d=>{ d.stockLog.push({id:uid(),kind:"recv",qty:q,at:now(),by:who()}); },`ICC stock: received ${q}`); };
  $("sCb").onclick=()=>{ const q=cTot(), c=n("sCch"); if(["sCst","sCls","sCch"].every(id=>$(id).value==="")) return say($("sMsg"),"bad","Enter the full sets, loose good ones and chipped ones counted.");
    if((q!==h.qty||c!==h.pile)&&!confirm(`The log shows ${h.qty} good and ${h.pile} chipped. Set it to ${q} good and ${c} chipped, as counted? Everything from now on counts from here.`)) return;
    S(d=>{ d.stockLog.push({id:uid(),kind:"count",qty:q,chipped:c,at:now(),by:who()}); },`ICC stock: counted ${q} good, ${c} chipped`); };
  $("sKb").onclick=()=>{ const q=n("sKq"); if(!(q>0)) return say($("sMsg"),"bad","Enter how many chipped ones were found.");
    S(d=>{ d.stockLog.push({id:uid(),kind:"chip",qty:q,at:now(),by:who(),note:"Found in stock"}); },`ICC stock: ${q} chipped found`); };
  $("sXb").onclick=()=>{ const q=n("sXq"); if(!(q>0)) return say($("sMsg"),"bad","Enter how many to take off.");
    S(d=>{ d.stockLog.push({id:uid(),kind:"scrap",qty:q,at:now(),by:who()}); },`ICC stock: ${q} other scrap`); };
  $("sVb").onclick=()=>{ const q=n("sVq"); if(!(q>0)) return say($("sMsg"),"bad","Enter how many chipped ones were reported or sent back.");
    if(q>h.pile&&!confirm(`Only ${h.pile} chipped are held. Mark ${q} reported anyway?`)) return;
    S(d=>{ d.stockLog.push({id:uid(),kind:"vendor",qty:q,at:now(),by:who()}); },`ICC stock: ${q} chipped reported to the maker`); };
  $("sBox").onchange=()=>{ const q=n("sBox"); if(!(q>0)) return renderSetup(); S(d=>{ d.boxSets=q; },`ICC stock: ${q} sets per box`); };
  if($("sChipPrint")) $("sChipPrint").onclick=()=>{ const tot=CL.reduce((t,x)=>t+x.qty,0);
    $("printArea").innerHTML=`<div style="font-family:Arial,sans-serif;color:#000;width:7.5in"><h2 style="margin:0 0 4pt">Chipped electrodes, P/N ${esc(I.pn)}</h2><div style="margin:0 0 10pt">${lv?`Since the last report on ${fmt(lv.at)}`:"All recorded"} &middot; ${tot} chipped</div>
      <table style="width:100%;border-collapse:collapse">${["<tr><th>Date</th><th>Qty</th><th>Where found</th><th>By</th></tr>",...CL.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${x.qty}</td><td>${esc(x.where)}</td><td>${esc(x.by)}</td></tr>`)].join("").replace(/<t([hd])>/g,'<t$1 style="border:1px solid #000;padding:4pt 6pt;text-align:left">')}</table></div>`; window.print(); };
  $("sLow").onchange=()=>{ const q=Math.max(0,Math.round(+$("sLow").value||0)); S(d=>{ d.lowSets=q; delete d.low; },`ICC stock: reorder at ${q} sets`); };
}
const setSpec=(key,id,isInt)=>$(id).addEventListener("change",()=>{ if(!adminOK) return; const v=isInt?Math.round(+$(id).value):num($(id).value);
  if(!isFinite(v)||(isInt&&v<(key==="filt"?0:1))){ say($("sMsg"),"bad","That has to be a number."); return renderSetup(); }
  commit(d=>{ d.spec[key]=v; },`ICC setup: ${key} ${v}`); });
setSpec("orbit","sOrb"); setSpec("yp","sYp"); setSpec("ym","sYm"); setSpec("step","sStep"); setSpec("burns","sBurns",1); setSpec("per","sPer",1); setSpec("filt","sFilt",1);
[["pn","sPN"],["form","sForm"],["rev","sRev"]].forEach(([k,id])=>$(id).addEventListener("change",()=>{ if(!adminOK) return; const v=$(id).value.trim()||blank()[k]; commit(d=>{ d[k]=v; },`ICC setup: ${k}`); }));
$("sMachF").addEventListener("change",()=>{ if(!adminOK) return; const v=$("sMachF").value; commit(d=>{ d.mach=v; },"ICC setup: machine"); });
function qrSvg(text){ const q=new QRCode(-1,0); q.addData(text); q.make(); const n=q.getModuleCount(), b=4; let p="";
  for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(q.isDark(r,c)) p+=`M${c+b} ${r+b}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n+2*b} ${n+2*b}" shape-rendering="crispEdges" style="width:3in;height:3in;display:block;margin:0 auto"><rect width="100%" height="100%" fill="#fff"/><path d="${p}" fill="#000"/></svg>`; }
$("sQr").addEventListener("click",()=>{ if(!adminOK) return; if(location.protocol==="file:") return say($("sMsg"),"bad","Open the log from its web address first; the code points at whatever address this page has.");
  $("printArea").innerHTML=`<div style="text-align:center;font-family:Arial,sans-serif;padding-top:.5in">${qrSvg(location.href.split(/[?#]/)[0])}<div style="font-size:20pt;font-weight:bold;margin-top:.15in">ICC Orbit Sheet</div><div style="font-size:12pt">P/N ${esc(I.pn)} &middot; scan to log a burn (${esc(I.form)})</div></div>`; window.print(); });

window.formDirty=()=>!!($("bSN").value.trim()||$("bFinRTh").value.trim()||$("bFinRTm").value.trim()||$("bNote").value.trim()||editId);
function renderAll(){ showBrand(F); if(F) LS.set("f031brand",JSON.stringify({company:F.company||"",logo:F.logo||""}));
  $("ttl").textContent=`ICC Orbit Sheet P/N ${I.pn}`; formNav($("formLine"),I.rev,I.mach?{"index.html":"?m="+encodeURIComponent(I.mach)}:null);
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
