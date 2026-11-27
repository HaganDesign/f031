// The shop's online forms, for the switcher under each page title.
// To add a department form: upload its page files, then add one line here.
//   id    = form number, name = short description, page = the html file
window.SHOP_FORMS=[
  {id:"F-030", name:"ICC Orbit Sheet",      page:"icc.html"},
  {id:"F-031", name:"EDM Filter / Maint.",  page:"index.html"},
  {id:"F-036", name:"CNC Mills Daily",      page:"mills.html"},
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

// Paid holidays. Daily checklists (CMM, mills) print the holiday name on these days instead of
// counting them as missed. Weekend holidays: when the shop votes on the day off, add that date
// to SHOP_HOLIDAY_EXTRA (yyyy-mm-dd) so it shows as the holiday too.
window.SHOP_HOLIDAY_EXTRA=[
  // "2027-07-05",   example: July 4th 2027 falls on a Sunday, observed Monday
];
window.shopHoliday=function(ds){ // ds = "yyyy-mm-dd"; returns the holiday name or ""
  var p=ds.split("-"), y=+p[0], m=+p[1], d=+p[2], dt=new Date(y,m-1,d), wd=dt.getDay();
  function nth(mo,wday,n){ var x=new Date(y,mo-1,1); x.setDate(1+((wday-x.getDay()+7)%7)+7*(n-1)); return x.getDate(); }
  function last(mo,wday){ var x=new Date(y,mo,0); x.setDate(x.getDate()-((x.getDay()-wday+7)%7)); return x.getDate(); }
  var tg=nth(11,4,4);
  var L=[[1,1,"New Year's Day"],[5,last(5,1),"Memorial Day"],[7,4,"July 4th"],[9,nth(9,1,1),"Labor Day"],[11,tg,"Thanksgiving Day"],[11,tg+1,"Friday after Thanksgiving"],[12,24,"Christmas Eve"],[12,25,"Christmas Day"],[12,31,"New Year's Eve"]];
  for(var i=0;i<L.length;i++) if(L[i][0]===m&&L[i][1]===d) return L[i][2];
  if((window.SHOP_HOLIDAY_EXTRA||[]).indexOf(ds)>=0) return "Holiday (observed)";
  return "";
};
