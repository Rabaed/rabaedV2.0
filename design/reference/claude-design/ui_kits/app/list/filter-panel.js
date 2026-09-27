// Rabaed — filter panel (Basic/Advanced, saved filters, field list + values). mountFilter(el, {fields, saved, preset, extra, sel, L, onChange, onDone})
(function(){
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const dotsHtml=p=>'<span class="fdots">'+p.split('').map(c=>'<i class="'+(c==='_'?'':c)+'"></i>').join('')+'</span>';
window.mountFilter=function(root,o){o=o||{};const L=o.L||((e)=>e);
 const S={tab:'basic',field:o.fields.find(f=>!f.sep).k,sel:o.sel||{},q:'',saved:false,sq:'',active:null,fields:o.fields.slice(),addOpen:false};
 const count=()=>Object.values(S.sel).filter(v=>v&&v.length).length;
 const lab=op=>op.l||op[0];
 function optMark(f,op){const x=op[1];
  if(f.mark==='dot')return '<span class="fsd" style="background:'+x+'"></span>';
  if(f.mark==='chip')return '<span class="chip" style="height:20px;font-size:11px;background:var(--tone-'+x+'-tint);color:var(--tone-'+x+'-fg)">'+esc(op[2]||'')+'</span>';
  if(f.mark==='av')return '<span class="fav" style="background:'+x+'">'+(op.av||op[3]||op[0]).split(' ').slice(0,2).map(w=>w[0]).join('')+'</span>';
  if(f.mark==='days')return dotsHtml(x);
  if(f.mark==='ic')return '<i class="ti '+x+'"></i>';
  return '<i class="ti '+(f.icon||'ti-file-text')+'"></i>';}
 function render(){
  const f=S.fields.find(x=>x.k===S.field)||S.fields.find(x=>!x.sep),sel=S.sel[f.k]||[];
  const opts=f.opts.filter(op=>(op[3]||op[0]).toLowerCase().includes(S.q.toLowerCase()));
  const savedList=(arr)=>arr.filter(n=>n.toLowerCase().includes(S.sq.toLowerCase())).map(n=>'<button class="fp-sv'+(S.active===n?' on':'')+'" data-sv="'+esc(n)+'">'+esc(n)+(S.active===n?'<i class="ti ti-check"></i>':'')+'</button>').join('');
  const n=count();
  root.innerHTML=
  '<div class="fp">'+
   '<div class="fp-hd">'+
    '<div class="fp-tabs"><button data-tab="basic" class="'+(S.tab==='basic'?'on':'')+'">'+L('Basic','أساسي')+'</button><button data-tab="adv" class="'+(S.tab==='adv'?'on':'')+'">'+L('Advanced','متقدم')+'</button></div>'+
    '<div class="fp-act"><div class="fp-svw"><button class="fp-svb'+(S.saved?' on':'')+'" data-a="saved">'+(S.active?esc(S.active):L('Saved filters','الفلاتر المحفوظة'))+'<i class="ti ti-chevron-down"></i></button>'+
     (S.saved?'<div class="fp-svm"><label class="fp-srch"><i class="ti ti-search"></i><input data-i="sq" placeholder="'+L('Search filters','ابحث في الفلاتر')+'" value="'+esc(S.sq)+'"></label><div class="fp-svl"><div class="fp-gh"><i class="ti ti-star"></i>'+L('Starred filters','الفلاتر المميزة')+'</div>'+savedList(o.saved.starred)+'<div class="fp-gh"><i class="ti ti-user"></i>'+L('My filters','فلاتري')+'</div>'+savedList(o.saved.mine)+'</div><button class="fp-all" data-a="all"><i class="ti ti-list"></i>'+L('View all saved filters','عرض كل الفلاتر المحفوظة')+'<i class="ti ti-arrow-right"></i></button></div>':'')+
    '</div><button class="fp-save" data-a="save"'+(n?'':' disabled')+'><i class="ti ti-star"></i>'+L('Save','حفظ')+'</button></div>'+
   '</div>'+
   (S.tab==='basic'?
   '<div class="fp-bd"><div class="fp-fields">'+
     S.fields.map(x=>x.sep?'<div class="fp-sep"></div>':'<button class="fp-f'+(x.k===f.k?' on':'')+'" data-f="'+x.k+'"><span>'+x.n+'<small>'+x.a+'</small></span>'+((S.sel[x.k]||[]).length?'<b>'+S.sel[x.k].length+'</b>':'')+'</button>').join('')+
     ((o.extra||[]).some(e=>!S.fields.some(x=>x.k===e.k))?'<div class="fp-addw"><button class="fp-add" data-a="add"><i class="ti ti-plus"></i>'+L('Add field','إضافة حقل')+'</button>'+(S.addOpen?'<div class="fp-addm">'+o.extra.filter(e=>!S.fields.some(x=>x.k===e.k)).map(e=>'<button data-ad="'+e.k+'">'+e.n+'<small>'+e.a+'</small></button>').join('')+'</div>':'')+'</div>':'')+
     '<button class="fp-clear" data-a="clear"'+(n?'':' disabled')+'>'+L('Clear all','مسح الكل')+'</button>'+
   '</div><div class="fp-opts">'+
     '<div class="fp-oh">'+f.n+'<small>'+f.a+'</small>'+(sel.length?'<button data-a="clrf">'+L('Clear','مسح')+'</button>':'')+'</div>'+
     (f.opts.length>5?'<label class="fp-srch sm"><i class="ti ti-search"></i><input data-i="q" placeholder="'+L('Search','بحث')+'" value="'+esc(S.q)+'"></label>':'')+
     '<div class="fp-ol">'+opts.map(op=>{const on=sel.includes(op[0]);return '<button class="fp-o'+(on?' on':'')+'" data-o="'+esc(op[0])+'"><span class="fck'+(f.single?' rd':'')+'">'+(on?'<i class="ti ti-check"></i>':'')+'</span>'+optMark(f,op)+'<span class="fpl">'+esc(op[3]||op[0])+'</span></button>'}).join('')+(opts.length?'':'<div class="fp-none">'+L('No matches','لا نتائج')+'</div>')+'</div>'+
   '</div></div>'
   :
   '<div class="fp-adv">'+(Object.entries(S.sel).filter(([k,v])=>v&&v.length).map(([k,v],i)=>{const f2=S.fields.find(x=>x.k===k)||{n:k};return '<div class="fp-rule"><span class="w'+(i?' and':'')+'">'+(i?L('AND','و'):L('Where','حيث'))+'</span><span class="pill">'+f2.n+'</span><span class="op">'+(v.length>1?L('is any of','أي من'):L('is','يساوي'))+'</span><span class="pill v">'+esc(v.map(x=>{const op=(f2.opts||[]).find(p=>p[0]===x);return op&&op[3]||x}).join(', '))+'</span></div>'}).join('')||'<div class="fp-none">'+L('No rules yet — pick values in Basic, or add a rule.','لا قواعد بعد')+'</div>')+'<button class="fp-add"><i class="ti ti-plus"></i>'+L('Add rule','إضافة قاعدة')+'</button></div>')+
   '<div class="fp-ft"><span>'+(n?n+' '+L(n>1?'filters applied':'filter applied','فلاتر مطبقة'):L('No filters applied','لا فلاتر مطبقة'))+'</span><button class="fp-done" data-a="done">'+L('Done','تم')+'</button></div>'+
  '</div>';
 }
 const emit=()=>o.onChange&&o.onChange(S.sel,count());
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;e.stopPropagation();
  if(b.dataset.tab){S.tab=b.dataset.tab}
  else if(b.dataset.f){S.field=b.dataset.f;S.q=''}
  else if(b.dataset.o){const f=S.fields.find(x=>x.k===S.field),cur=S.sel[f.k]||[],v=b.dataset.o;S.sel[f.k]=f.single?(cur[0]===v?[]:[v]):(cur.includes(v)?cur.filter(x=>x!==v):cur.concat(v));S.active=null;emit()}
  else if(b.dataset.sv){S.active=b.dataset.sv;S.sel=JSON.parse(JSON.stringify((o.preset||{})[S.active]||{}));S.saved=false;emit()}
  else if(b.dataset.ad){const e2=o.extra.find(x=>x.k===b.dataset.ad);S.fields.push(e2);S.field=e2.k;S.addOpen=false}
  else{const a=b.dataset.a;
   if(a==='saved'){S.saved=!S.saved;S.sq=''}
   if(a==='add')S.addOpen=!S.addOpen;
   if(a==='clear'){S.sel={};S.active=null;emit()}
   if(a==='clrf'){S.sel[S.field]=[];S.active=null;emit()}
   if(a==='save'){b.innerHTML='<i class="ti ti-check"></i>'+L('Saved','تم الحفظ');return}
   if(a==='done'){o.onDone&&o.onDone();return}
   if(a==='all'){S.saved=false}}
  render();
 });
 root.addEventListener('input',e=>{const i=e.target.dataset.i;if(!i)return;S[i]=e.target.value;const pos=e.target.selectionStart;render();const n=root.querySelector('[data-i="'+i+'"]');if(n){n.focus();n.setSelectionRange(pos,pos)}});
 render();
 return {S,count,render,set(sel){S.sel=sel;render()}};
};
// popover helper: toggles a single floating panel under a button
window.FPop={el:null,api:null,btn:null,
 open(btn,opts){this.close();const el=document.createElement('div');el.className='fpop';document.body.appendChild(el);this.el=el;this.btn=btn;
  const scope=btn.closest('.rs');if(scope){el.className='fpop '+[...scope.classList].filter(c=>c==='theme-dark').join(' ');el.dir=scope.getAttribute('dir')||'ltr';el.setAttribute('lang',scope.getAttribute('lang')||'en');['--t','--ink','--ink2','--mut','--faint','--line','--line2'].forEach(v=>el.style.setProperty(v,getComputedStyle(scope).getPropertyValue(v)))}
  const done=opts.onDone;opts.onDone=()=>{this.close();done&&done()};this.api=mountFilter(el,opts);this.place();return this.api},
 place(){if(!this.el||!this.btn||!document.body.contains(this.btn))return;const r=this.btn.getBoundingClientRect(),w=Math.min(600,innerWidth-16);const rtl=this.el.dir==='rtl';let x=rtl?r.right-w:r.left;x=Math.max(8,Math.min(x,innerWidth-w-8));this.el.style.left=x+'px';this.el.style.top=Math.min(r.bottom+8,innerHeight-200)+'px';this.el.style.maxHeight=(innerHeight-r.bottom-16)+'px'},
 close(){if(this.el){this.el.remove();this.el=null;this.api=null}},
 isOpen(){return !!this.el}};
addEventListener('resize',()=>FPop.place());
document.addEventListener('mousedown',e=>{if(FPop.el&&!FPop.el.contains(e.target)&&!(e.target.closest&&e.target.closest('[data-fpop]')))FPop.close()});
})();
