// Rabaed — Kanban filter panel (vanilla). mountFilter(el, {onChange})
(function(){
const FIELDS=[
 {k:'status',n:'Status',a:'الحالة',opts:[['Internal Review','#2f6fe0'],['Revised & Resubmitted','#f0a93c'],['Pending Approval','#27b86e'],['Approved','#9aa0ad'],['Rejected','#e5492c'],['Cancelled','#3a3f4b']]},
 {k:'trade',n:'Trade',a:'التخصص',opts:[['Civil Works (CV)','cv'],['Electrical Works (EL)','el'],['Mechanical Works (ME)','me']]},
 {k:'type',n:'Document type',a:'نوع المستند',opts:[['MAR'],['SAR'],['DAR']]},
 {k:'owner',n:'Owner',a:'المسؤول',opts:[['Ahmed bin Said','#3d6db5'],['Abdullah Al Saadi','#7a5c3a'],['Nasser Al Kaabi','#e98b45'],['Mohammed Al Shamsi','#3d6db5'],['Sarah Al Mansoori','#b5455a'],['Khalid Al Dhaheri','#6b5ad8']]},
 {k:'role',n:'Role',a:'الدور',opts:[['Contractor Engineer','#2f6fe0'],['Contractor Project Manager','#7a5af0']]},
 {sep:1},
 {k:'zone',n:'Zone',a:'المنطقة',opts:[['Zone A'],['Zone B'],['Zone C']]},
 {k:'bldg',n:'Building',a:'المبنى',opts:[['Building 1'],['Building 2'],['Building 3']]},
 {k:'floor',n:'Floor',a:'الطابق',opts:[['B2'],['B1'],['G'],['1'],['2'],['3'],['4'],['5'],['R']]},
 {sep:1},
 {k:'created',n:'Created date',a:'تاريخ الإنشاء',single:1,opts:[['Today'],['Last 7 days'],['Last 30 days'],['This month'],['Custom range…']]},
 {k:'days',n:'Days in column',a:'الأيام في العمود',single:1,opts:[['2+ days','g___'],['3+ days','y___'],['5+ days','r___'],['8+ days','rr__'],['12+ days','rrr_'],['20+ days','rrrr']]}
];
const EXTRA=[['contractor','Contractor','المقاول'],['rev','Revision','رقم المراجعة'],['code','Approval code','رمز الاعتماد']];
const SAVED={starred:['My overdue MEP items','Zone A — this week'],mine:['All Electrical MAR','Rejected — R2 and above','Pending with Project Manager','Building 2 · Floors 3–5','Created last 7 days','Civil Works — Basement']};
const PRESET={'My overdue MEP items':{trade:['Mechanical Works (ME)','Electrical Works (EL)'],days:['8+ days']},'Zone A — this week':{zone:['Zone A'],created:['Last 7 days']},'All Electrical MAR':{trade:['Electrical Works (EL)'],type:['MAR']},'Rejected — R2 and above':{status:['Rejected']},'Pending with Project Manager':{status:['Pending Approval'],role:['Contractor Project Manager']},'Building 2 · Floors 3–5':{bldg:['Building 2'],floor:['3','4','5']},'Created last 7 days':{created:['Last 7 days']},'Civil Works — Basement':{trade:['Civil Works (CV)'],floor:['B1','B2']}};
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const dotsHtml=p=>'<span class="fdots">'+p.split('').map(c=>'<i class="'+(c==='_'?'':c)+'"></i>').join('')+'</span>';
window.mountFilter=function(root,o){o=o||{};
 const S={tab:'basic',field:'status',sel:{status:['Pending Approval','Rejected'],trade:['Electrical Works (EL)']},q:'',saved:false,sq:'',active:null,fields:FIELDS.slice(),addOpen:false};
 const count=()=>Object.values(S.sel).filter(v=>v&&v.length).length;
 function optMark(f,opt){const [label,x]=opt;
  if(f.k==='status'||f.k==='role')return '<span class="fsd" style="background:'+x+'"></span>';
  if(f.k==='trade')return '<span class="fchip '+x+'">'+x.toUpperCase()+'</span>';
  if(f.k==='owner')return '<span class="fav" style="background:'+x+'">'+label.split(' ').slice(0,2).map(w=>w[0]).join('')+'</span>';
  if(f.k==='days')return dotsHtml(x);
  if(f.k==='zone')return '<i class="ti ti-map"></i>';if(f.k==='bldg')return '<i class="ti ti-building"></i>';if(f.k==='floor')return '<i class="ti ti-stairs"></i>';
  if(f.k==='created')return '<i class="ti ti-calendar-event"></i>';return '<i class="ti ti-file-text"></i>';}
 function render(){
  const f=S.fields.find(x=>x.k===S.field)||S.fields[0],sel=S.sel[f.k]||[];
  const opts=f.opts.filter(op=>op[0].toLowerCase().includes(S.q.toLowerCase()));
  const savedList=(arr)=>arr.filter(n=>n.toLowerCase().includes(S.sq.toLowerCase())).map(n=>'<button class="fp-sv'+(S.active===n?' on':'')+'" data-sv="'+esc(n)+'">'+esc(n)+(S.active===n?'<i class="ti ti-check"></i>':'')+'</button>').join('');
  root.innerHTML=
  '<div class="fp">'+
   '<div class="fp-hd">'+
    '<div class="fp-tabs"><button data-tab="basic" class="'+(S.tab==='basic'?'on':'')+'">Basic</button><button data-tab="adv" class="'+(S.tab==='adv'?'on':'')+'">Advanced</button></div>'+
    '<div class="fp-act"><div class="fp-svw"><button class="fp-svb'+(S.saved?' on':'')+'" data-a="saved">'+(S.active?esc(S.active):'Saved filters')+'<i class="ti ti-chevron-down"></i></button>'+
     (S.saved?'<div class="fp-svm"><label class="fp-srch"><i class="ti ti-search"></i><input data-i="sq" placeholder="Search filters" value="'+esc(S.sq)+'"></label><div class="fp-svl"><div class="fp-gh"><i class="ti ti-star"></i>Starred filters</div>'+savedList(SAVED.starred)+'<div class="fp-gh"><i class="ti ti-user"></i>My filters</div>'+savedList(SAVED.mine)+'</div><button class="fp-all" data-a="all"><i class="ti ti-list"></i>View all saved filters<i class="ti ti-arrow-right"></i></button></div>':'')+
    '</div><button class="fp-save" data-a="save"'+(count()?'':' disabled')+'><i class="ti ti-star"></i>Save</button></div>'+
   '</div>'+
   (S.tab==='basic'?
   '<div class="fp-bd"><div class="fp-fields">'+
     S.fields.map(x=>x.sep?'<div class="fp-sep"></div>':'<button class="fp-f'+(x.k===f.k?' on':'')+'" data-f="'+x.k+'"><span>'+x.n+'<small>'+x.a+'</small></span>'+((S.sel[x.k]||[]).length?'<b>'+S.sel[x.k].length+'</b>':'')+'</button>').join('')+
     '<div class="fp-addw"><button class="fp-add" data-a="add"><i class="ti ti-plus"></i>Add field</button>'+(S.addOpen?'<div class="fp-addm">'+EXTRA.filter(e=>!S.fields.some(x=>x.k===e[0])).map(e=>'<button data-ad="'+e[0]+'">'+e[1]+'<small>'+e[2]+'</small></button>').join('')+'</div>':'')+'</div>'+
     '<button class="fp-clear" data-a="clear"'+(count()?'':' disabled')+'>Clear all</button>'+
   '</div><div class="fp-opts">'+
     '<div class="fp-oh">'+f.n+'<small>'+f.a+'</small>'+(sel.length?'<button data-a="clrf">Clear</button>':'')+'</div>'+
     (f.opts.length>5?'<label class="fp-srch sm"><i class="ti ti-search"></i><input data-i="q" placeholder="Search '+f.n.toLowerCase()+'" value="'+esc(S.q)+'"></label>':'')+
     '<div class="fp-ol">'+opts.map(op=>{const on=sel.includes(op[0]);return '<button class="fp-o'+(on?' on':'')+'" data-o="'+esc(op[0])+'"><span class="fck'+(f.single?' rd':'')+'">'+(on?'<i class="ti ti-check"></i>':'')+'</span>'+optMark(f,op)+'<span class="fl">'+esc(op[0])+'</span></button>'}).join('')+(opts.length?'':'<div class="fp-none">No matches</div>')+'</div>'+
   '</div></div>'
   :
   '<div class="fp-adv"><div class="fp-rule"><span class="w">Where</span><span class="pill">Status</span><span class="op">is any of</span><span class="pill v">Pending Approval, Rejected</span></div><div class="fp-rule"><span class="w and">AND</span><span class="pill">Trade</span><span class="op">is</span><span class="pill v">Electrical Works (EL)</span></div><div class="fp-rule"><span class="w and">AND</span><span class="pill">Days in column</span><span class="op">≥</span><span class="pill v">5</span></div><button class="fp-add"><i class="ti ti-plus"></i>Add rule</button></div>')+
   '<div class="fp-ft"><span>'+(count()?count()+' filter'+(count()>1?'s':'')+' applied':'No filters applied')+'</span><button class="fp-done" data-a="done">Done</button></div>'+
  '</div>';
  o.onChange&&o.onChange(count());
 }
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;e.stopPropagation();
  if(b.dataset.tab){S.tab=b.dataset.tab}
  else if(b.dataset.f){S.field=b.dataset.f;S.q=''}
  else if(b.dataset.o){const f=S.fields.find(x=>x.k===S.field),cur=S.sel[f.k]||[],v=b.dataset.o;S.sel[f.k]=f.single?(cur[0]===v?[]:[v]):(cur.includes(v)?cur.filter(x=>x!==v):cur.concat(v));S.active=null}
  else if(b.dataset.sv){S.active=b.dataset.sv;S.sel=JSON.parse(JSON.stringify(PRESET[S.active]||{}));S.saved=false}
  else if(b.dataset.ad){const e2=EXTRA.find(x=>x[0]===b.dataset.ad);S.fields.push({k:e2[0],n:e2[1],a:e2[2],opts:e2[0]==='contractor'?[['Al Futtaim Construction Co.'],['Arabtec'],['ALEC']]:e2[0]==='rev'?[['R0'],['R1'],['R2'],['R3+']]:[['Code A'],['Code B'],['Code C'],['Code D']]});S.field=e2[0];S.addOpen=false}
  else{const a=b.dataset.a;
   if(a==='saved'){S.saved=!S.saved;S.sq=''}
   if(a==='add')S.addOpen=!S.addOpen;
   if(a==='clear'){S.sel={};S.active=null}
   if(a==='clrf'){S.sel[S.field]=[];S.active=null}
   if(a==='save'){b.textContent='Saved ✓'}
   if(a==='done'){o.onDone&&o.onDone()}
   if(a==='all'){S.saved=false}
   if(a==='save')return;}
  render();
 });
 root.addEventListener('input',e=>{const i=e.target.dataset.i;if(!i)return;S[i]=e.target.value;const pos=e.target.selectionStart;render();const n=root.querySelector('[data-i="'+i+'"]');if(n){n.focus();n.setSelectionRange(pos,pos)}});
 render();
 return {count};
};
})();
