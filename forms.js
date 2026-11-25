// The shop's online forms, for the switcher under each page title.
// To add a department form: upload its page files, then add one line here.
//   id    = form number, name = short description, page = the html file
window.SHOP_FORMS=[
  {id:"F-030", name:"ICC Orbit Sheet",      page:"icc.html"},
  {id:"F-031", name:"EDM Filter / Maint.",  page:"index.html"},
  {id:"F-037", name:"CMM Daily Maint.",     page:"cmm.html"}
];

// Draws the switcher into el. rev = this form's revision. links = extra address bits per page, e.g. {"index.html":"?m=abc"}.
// window.formDirty(), if a page defines it, says whether something typed would be lost by leaving.
window.formNav=function(el,rev,links){
  var here=(location.pathname.split("/").pop()||"index.html"), F=window.SHOP_FORMS||[], esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});};
  var cur=F.filter(function(f){return f.page===here;})[0];
  el.innerHTML='<select class="formnav" aria-label="Switch to another form">'+F.map(function(f){return '<option value="'+esc(f.page)+'"'+(f===cur?" selected":"")+'>'+esc(f.id+"  "+f.name)+'</option>';}).join("")+'</select><span class="formrev">Rev '+esc(rev||"-")+'</span>';
  var s=el.querySelector("select");
  s.onchange=function(){ var p=s.value; if(p===here) return;
    if(window.formDirty&&window.formDirty()&&!confirm("Something typed here isn't saved yet. Leave this form anyway?")){ s.value=here; return; }
    location.href=p+((links&&links[p])||""); };
};
