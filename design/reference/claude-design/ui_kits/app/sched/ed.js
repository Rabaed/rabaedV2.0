// Schedule editor — shared table + Gantt used by 2(a) plan/read and 2(c) update. Rules: 07-editing-rules.md. Exposes SC.ED
(function(){const C=SC;
const ZM={d:[22,'الأيام'],w:[6,'الأسابيع'],m:[2.2,'الأشهر'],q:[.8,'الأرباع']};const RH=34;
const GB=[['wbs','WBS'],['disc','التخصص'],['zone','المنطقة'],['bld','المبنى'],['floor','الطابق']];
const GK={wbs:a=>a.w.split(' / ')[0],disc:a=>a.disc||'—',zone:a=>a.zone||'—',bld:a=>a.bld||'—',floor:a=>a.fl||'—'};
const DL=Object.fromEntries(SD.dms.disc);
const gLabel=(g,k)=>g==='disc'&&DL[k]?k+' · '+DL[k]:g==='floor'&&k!=='—'?'الطابق '+k:k;
const MS=['ينا','فبر','مار','أبر','ماي','يون','يول','أغس','سبت','أكت','نوف','ديس'];
const inst=[];
const defUI=()=>({sel:null,edit:null,panel:false,zoom:'w',group:'wbs',fold:[],cols:null,split:46,links:true,more:false,filter:'period'});
function create(o){const ui=o.ui;Object.keys(defUI()).forEach(k=>{if(!(k in ui))ui[k]=defUI()[k]});
 const U=[],R=[];
 const I={o,ui};inst.push(I);
 const cols=()=>{const all=o.cols();const ord=ui.cols&&ui.cols.length===all.length&&all.every(c=>ui.cols.includes(c.k))?ui.cols:all.map(c=>c.k);return ord.map(k=>all.find(c=>c.k===k))};
 const mode=()=>o.mode();
 const canEd=(a,c)=>{const m=mode();if(m==='read')return false;return c.ed?c.ed(m,a):false};
 function rows(){const L=o.acts();const g=ui.group,f=GK[g];const order=[],map={};L.forEach(a=>{const k=f(a);if(!map[k]){map[k]=[];order.push(k)}map[k].push(a)});
  const out=[];order.forEach(k=>{const fold=ui.fold.includes(g+':'+k);out.push({t:'g',k,list:map[k],fold});if(!fold)map[k].forEach(a=>out.push({t:'a',a}))});return out}
 const selRows=()=>rows().filter(r=>r.t==='a').map(r=>r.a);
 const byId=id=>o.acts().find(a=>a.id===id);
 function mut(fn){U.push(o.snap());if(U.length>60)U.shift();R.length=0;const r=fn();o.after&&o.after();return r}
 I.mut=mut;
 function undo(){if(!U.length)return C.toast('لا شيء للتراجع');R.push(o.snap());o.restore(U.pop());o.after&&o.after()}
 function redo(){if(!R.length)return;U.push(o.snap());o.restore(R.pop());o.after&&o.after()}
 // ---- gantt geometry
 const px=()=>ZM[ui.zoom][0];
 function geo(){let [g0,g1]=o.range();if(ui.zoom==='m'||ui.zoom==='q'){const d=C.D(g0);g0=C.iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)))}const N=C.days(g0,g1);let P=px();const pw=(I.pw||0)-2;if(N*P<pw)P=pw/N;return {g0,g1,P,W:Math.ceil(N*P),x:d=>C.days(g0,d)*P}}
 function gHead(G){const t1=[],t2=[];const z=ui.zoom;let d=C.D(G.g0);const end=C.D(G.g1);const push=(arr,s,l)=>arr.push([C.iso(s),l]);
  for(let q=new Date(d);q<=end;q=new Date(q.getTime()+864e5)){const s=C.iso(q),dd=q.getUTCDate(),m=q.getUTCMonth(),dw=q.getUTCDay();
   if(z==='d'||z==='w'){if(dd===1||s===G.g0)push(t1,q,C.M[m]+' '+q.getUTCFullYear());if(z==='d')push(t2,q,dd);else if(dw===6)push(t2,q,dd+' '+MS[m])}
   else{if((m===0&&dd===1)||s===G.g0)push(t1,q,q.getUTCFullYear());if(z==='m'&&(dd===1||s===G.g0))push(t2,q,C.M[m]);if(z==='q'&&((dd===1&&m%3===0)||s===G.g0))push(t2,q,'ر'+(Math.floor(m/3)+1)+' '+q.getUTCFullYear())}}
  const tier=(arr,cls)=>arr.map((t,i)=>{const l=G.x(t[0]),r=i<arr.length-1?G.x(arr[i+1][0]):G.W;return `<span class="${cls}" style="left:${l}px;width:${r-l}px">${t[1]}</span>`}).join('');
  return `<div class="e-gh" style="width:${G.W}px"><div class="e-gh1">${tier(t1,'')}</div><div class="e-gh2${z==='d'?' dd':''}">${tier(t2,'')}</div></div>`}
 function gOver(G,h){let s='';if(ui.zoom==='d'||ui.zoom==='w'){for(let i=0;i<C.days(G.g0,G.g1);i++){const d=C.addD(G.g0,i);if(!C.isWork(C.D(d)))s+=`<i class="e-off" style="left:${i*G.P}px;width:${Math.max(1,G.P)}px"></i>`}}
  const dd=o.dd&&o.dd();if(dd)s+=`<i class="e-ddl" style="left:${G.x(dd)+G.P}px" data-l="تاريخ البيانات ${C.fmt(dd,1)}"></i>`;
  if(o.ce)s+=`<i class="e-ce" style="left:${G.x(o.ce)+G.P}px" data-l="النهاية التعاقدية"></i>`;return `<div class="e-go">${s}</div>`}
 function bar(a,G,m){const b=o.bar(a);const sel=ui.sel&&ui.sel.id===a.id;const dragable=m==='plan';
  let h='';if(b.bs){h+=b.bms?`<i class="e-bms" style="left:${G.x(b.bs)+G.P/2-4}px"></i>`:`<i class="e-bl" style="left:${G.x(b.bs)}px;width:${Math.max(2,(C.days(b.bs,b.be)+1)*G.P)}px"></i>`}
  if(b.ms)return h+`<i class="e-ms${b.crit?' crit':''}${sel?' on':''}" data-eb="${a.id}" style="left:${G.x(b.s)+G.P/2-7}px" title="${a.id} · ${C.fmt(b.s)}"></i>`;
  if(!b.s)return h;const w=Math.max(3,(C.days(b.s,b.e)+1)*G.P);
  return h+`<div class="e-bar${b.crit?' crit':''}${b.cls?' '+b.cls:''}${sel?' on':''}${dragable?' dg':''}" data-eb="${a.id}" style="left:${G.x(b.s)}px;width:${w}px" title="${a.id} · ${C.fmt(b.s,1)} – ${C.fmt(b.e,1)}">${b.pct?`<i class="e-pc" style="width:${b.pct}%"></i>`:''}${b.pin?'<span class="e-pin" title="لا يبدأ قبل '+C.fmt(b.pin,1)+'"><i class="ti ti-pin-filled"></i></span>':''}${dragable?'<i class="e-rz" data-ez="end"></i><i class="e-lkh" data-ez="link" title="اسحب إلى نشاط آخر لإنشاء علاقة FS"></i>':''}</div>`}
 function links(R,G){if(!ui.links)return '';const y={},xs={};R.forEach((r,i)=>{if(r.t==='a')y[r.a.id]=i*RH+RH/2});let p='';
  R.forEach(r=>{if(r.t!=='a')return;const a=r.a,b=o.bar(a);if(!b.s)return;(a.pred||[]).forEach(q=>{if(y[q[0]]===undefined)return;const pb=o.bar(byId(q[0]));if(!pb||!pb.e)return;
   const x1=G.x(pb.e)+G.P*(pb.ms?.5:1),y1=y[q[0]],x2=G.x(b.s)+(b.ms?G.P/2-7:0),y2=y[a.id];const cr=b.crit&&pb.crit;
   const d=x2-x1>=10?`M${x1} ${y1}H${x1+5}V${y2}H${x2-1}`:`M${x1} ${y1}H${x1+5}V${y2+(y2>y1?-RH/2:RH/2)}H${x2-8}V${y2}H${x2-1}`;
   p+=`<path d="${d}" class="${cr?'cr':''}" marker-end="url(#ea${cr?'c':''})"></path>`})});
  return `<svg class="e-lk" width="${G.W}" height="${R.length*RH}"><defs><marker id="ea" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6z" fill="var(--ui-muted)"></path></marker><marker id="eac" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6z" fill="var(--tone-red-solid)"></path></marker></defs>${p}</svg>`}
 function cell(a,c,m){const lk=!canEd(a,c)&&m!=='read'&&c.lockable;const on=ui.sel&&ui.sel.id===a.id&&ui.sel.k===c.k;const ed=on&&ui.edit;
  let inner;if(ed){const v=C.esc(ui.edit.val);inner=c.type==='sel'?`<select class="e-in" id="e-in">${c.opts(a).map(([k,l])=>`<option value="${k}"${k===ui.edit.val?' selected':''}>${l}</option>`).join('')}</select>`:`<input class="e-in" id="e-in" value="${v}"${c.type==='date'?' placeholder="2026-09-27"':''}${c.type==='num'?' inputmode="numeric"':''}>`}
  else inner=c.v(a,m);
  return `<div class="e-c${c.cls?' '+c.cls:''}${lk?' lk':''}${on?' on':''}" data-a="ed-cell" data-v="${a.id}|${c.k}">${inner}${lk&&on?'<i class="ti ti-lock e-lkc"></i>':''}</div>`}
 function view(tb){const m=mode();const CS=cols();const R=rows();const G=geo();const gt=CS.map(c=>c.w+'px').join(' ');const TW=CS.reduce((n,c)=>n+c.w,0);
  const hd=`<div class="e-r e-hr" style="grid-template-columns:${gt};width:${TW}px">${CS.map(c=>`<div class="e-hc${c.lockable&&m==='update'&&!c.ed('update',{})?' lk':''}" draggable="true" data-ecol="${c.k}" title="اسحب لإعادة ترتيب الأعمدة">${c.l}</div>`).join('')}</div>`;
  const tr=R.map(r=>{if(r.t==='g'){const n=r.list.length;return `<div class="e-r e-gr" style="width:${TW}px"><button class="e-fold" data-a="ed-gtog" data-v="${C.esc(r.k)}" aria-label="طيّ/توسيع"><i class="ti ti-chevron-${r.fold?'left':'down'}"></i></button><b>${C.esc(gLabel(ui.group,r.k))}</b><small>${n} ${n===1?'نشاط':n<=10?'أنشطة':'نشاطاً'}</small></div>`}
   const a=r.a;const on=ui.sel&&ui.sel.id===a.id;return `<div class="e-r${on?' sel':''}${o.rowCls?' '+o.rowCls(a):''}" data-erow="${a.id}" style="grid-template-columns:${gt};width:${TW}px">${CS.map(c=>cell(a,c,m)).join('')}</div>`}).join('');
  const gr=R.map(r=>{if(r.t==='g'){const L=r.list.map(a=>o.bar(a)).filter(b=>b.s);if(!L.length)return '<div class="e-grow g"></div>';const s=L.reduce((x,b)=>b.s<x?b.s:x,'9'),e=L.reduce((x,b)=>(b.e||b.s)>x?(b.e||b.s):x,'0');return `<div class="e-grow g"><i class="e-sum" style="left:${G.x(s)}px;width:${(C.days(s,e)+1)*G.P}px"></i></div>`}
   return `<div class="e-grow${ui.sel&&ui.sel.id===r.a.id?' sel':''}">${bar(r.a,G,m)}</div>`}).join('');
  const zs=`<div class="sc-seg e-zoom">${Object.keys(ZM).map(k=>`<button class="${ui.zoom===k?'on':''}" data-a="ed-zoom" data-v="${k}">${ZM[k][1]}</button>`).join('')}</div>`;
  const more=o.more?o.more():[];
  const bar2=`<div class="e-tb">${tb||''}<span class="sp"></span><label class="e-gb"><span>التجميع حسب</span><select class="sc-in" data-edg="1">${GB.map(([k,l])=>`<option value="${k}"${ui.group===k?' selected':''}>${l}</option>`).join('')}</select></label>
   <button class="sc-b ter sm" data-a="ed-fold" data-v="${ui.fold.length?'open':'close'}"><i class="ti ti-${ui.fold.length?'fold-down':'fold-up'}"></i>${ui.fold.length?'توسيع الكل':'طيّ الكل'}</button>${zs}
   <label class="sc-swl">الروابط ${C.sw(ui.links,'ed-links')}</label><button class="sc-b ${ui.panel?'out':'ter'} sm" data-a="ed-panel"><i class="ti ti-layout-sidebar-left"></i>لوحة النشاط</button>
   <div class="e-dd"><button class="sc-ib" data-a="ed-more" aria-label="المزيد"><i class="ti ti-dots"></i></button>${ui.more?`<div class="menu e-menu">${more.map(x=>`<button class="mi${x.dis?' dis':''}" data-a="${x.a}"${x.dis?' disabled title="'+x.dis+'"':''}><i class="ti ${x.ic}"></i>${x.l}</button>`).join('')}<button class="mi" data-a="ed-resetcols"><i class="ti ti-columns"></i>استعادة ترتيب الأعمدة الافتراضي</button></div>`:''}</div></div>`;
  const sa=ui.panel&&ui.sel&&byId(ui.sel.id);
  const pn=sa?`<aside class="e-pn" data-ep-root="1"><div class="e-pn-hd"><div><small class="sc-id">${sa.id}</small><b>${C.esc(sa.n)}</b></div><button class="sc-ib" data-a="ed-close" aria-label="إغلاق"><i class="ti ti-x"></i></button></div><div class="e-pn-bd">${o.panel(sa,m)}</div></aside>`:ui.panel?`<aside class="e-pn"><div class="e-pn-hd"><b>لوحة النشاط</b><button class="sc-ib" data-a="ed-close" aria-label="إغلاق"><i class="ti ti-x"></i></button></div><div class="e-pn-bd"><p class="sc-mut">اختر نشاطاً من الجدول أو الغانت.</p></div></aside>`:'';
  const keys=`<div class="e-keys"><span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> تنقّل</span><span><kbd>Enter</kbd> تحرير</span><span><kbd>Tab</kbd> العمود التالي</span><span><kbd>Esc</kbd> إلغاء</span><span><kbd>Ctrl</kbd>+<kbd>Z</kbd> تراجع</span>${m==='plan'?'<span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> نشاط جديد</span><span><kbd>Ctrl</kbd>+<kbd>Delete</kbd> حذف</span>':''}</div>`;
  return bar2+`<section class="sc-card e-card"><div class="e-ed" id="e-ed" style="--tw:${ui.split}%"><div class="e-tp" data-keep="et-${o.pg}"><div class="e-tw" style="width:${TW}px">${hd}${tr}</div></div><div class="e-sp" data-esplit="1" title="اسحب لتغيير العرض"><i></i></div><div class="e-gp" data-keep="eg-${o.pg}"><div class="e-gw" style="width:${G.W}px">${gHead(G)}<div class="e-gb2" style="min-height:${R.length*RH}px">${gOver(G,R.length*RH)}${links(R,G)}${gr}</div></div></div>${pn}</div></section>`+keys}
 // ---- selection / editing
 function move(dr,dc){const L=selRows(),CS=cols();if(!L.length)return;let s=ui.sel||{id:L[0].id,k:CS[0].k};let r=L.findIndex(a=>a.id===s.id);if(r<0)r=0;let c=CS.findIndex(x=>x.k===s.k);if(c<0)c=0;
  r=Math.max(0,Math.min(L.length-1,r+dr));c=Math.max(0,Math.min(CS.length-1,c+dc));ui.sel={id:L[r].id,k:CS[c].k};ui.edit=null;scrollSel()}
 function scrollSel(){C.after.push(function f(){C.after.splice(C.after.indexOf(f),1);const el=document.querySelector('.e-c.on');const tp=document.querySelector('.e-tp');if(!el||!tp)return;const r=el.getBoundingClientRect(),p=tp.getBoundingClientRect();if(r.left<p.left)tp.scrollLeft-=p.left-r.left+8;else if(r.right>p.right)tp.scrollLeft+=r.right-p.right+8;const vr=el.getBoundingClientRect();if(vr.top<120)scrollBy(0,vr.top-140);else if(vr.bottom>innerHeight-80)scrollBy(0,vr.bottom-innerHeight+100)})}
 function startEdit(init){const s=ui.sel;if(!s)return false;const a=byId(s.id),c=cols().find(x=>x.k===s.k);if(!a||!c)return false;
  if(!canEd(a,c)){C.toast(mode()==='read'?'الجدول في وضع القراءة':mode()==='update'?'المدة والتواريخ المخططة مقفلة في وضع التحديث':'هذه الخلية لا تُحرَّر');return true}
  ui.edit={val:init!=null&&c.type!=='sel'?init:c.raw?c.raw(a):''};return true}
 function commit(){const s=ui.sel,e=ui.edit;if(!s||!e)return;const a=byId(s.id),c=cols().find(x=>x.k===s.k);ui.edit=null;if(!a||!c)return;const old=c.raw?c.raw(a):'';if(String(e.val)===String(old))return;
  const err=mut(()=>c.set(a,e.val));if(err){C.toast(err)}}
 C.after.push(()=>{if(C.st.pg!==o.pg)return;const gp=document.querySelector('.e-gp');if(!gp)return;const w=gp.clientWidth;if(Math.abs(w-(I.pw||0))>4){I.pw=w;requestAnimationFrame(()=>C.render())}});
 C.after.push(()=>{const el=document.getElementById('e-in');if(el&&document.activeElement!==el){el.focus();if(el.setSelectionRange&&el.value)try{el.setSelectionRange(el.value.length,el.value.length)}catch(x){}}});
 function act(a,el){const v=el.dataset.v;if(!a.startsWith('ed-'))return false;
  if(a==='ed-cell'){const [id,k]=v.split('|');if(ui.edit&&ui.sel&&ui.sel.id===id&&ui.sel.k===k)return true;if(ui.edit)commit();ui.sel={id,k};if(k==='id'||k==='n')ui.panel=true;return true}
  if(a==='ed-zoom'){ui.zoom=v;return true}
  if(a==='ed-links'){ui.links=!ui.links;return true}
  if(a==='ed-panel'){ui.panel=!ui.panel;if(ui.panel&&!ui.sel){const L=selRows();if(L[0])ui.sel={id:L[0].id,k:'n'}}return true}
  if(a==='ed-close'){ui.panel=false;return true}
  if(a==='ed-gtog'){const k=ui.group+':'+v;const i=ui.fold.indexOf(k);i<0?ui.fold.push(k):ui.fold.splice(i,1);return true}
  if(a==='ed-fold'){if(v==='open')ui.fold=[];else{const L=o.acts(),f=GK[ui.group];ui.fold=[...new Set(L.map(x=>ui.group+':'+f(x)))]}return true}
  if(a==='ed-more'){ui.more=!ui.more;return true}
  if(a==='ed-resetcols'){ui.cols=null;ui.more=false;C.toast('استُعيد ترتيب الأعمدة الافتراضي');return true}
  return false}
 I.act=act;I.view=view;I.undo=undo;I.redo=redo;I.move=move;I.startEdit=startEdit;I.commit=commit;I.cols=cols;I.byId=byId;I.mode=mode;I.geo=geo;I.selRows=selRows;
 return I}
const cur=()=>inst.find(i=>i.o.pg===C.st.pg&&C.allowed(C.st.pg)&&(!i.o.on||i.o.on()));
// keyboard
document.addEventListener('keydown',e=>{const I=cur();if(!I||C.st.modal)return;const ui=I.ui,t=e.target;const inEd=t&&t.id==='e-in';
 if(t&&!inEd&&t.closest&&t.closest('input,textarea,select'))return;
 const k=e.key,ctrl=e.ctrlKey||e.metaKey;const m=I.mode();
 if(ctrl&&(k==='z'||k==='Z')&&!inEd){e.preventDefault();if(m==='read')return;e.shiftKey?I.redo():I.undo();return C.render()}
 if(ctrl&&(k==='y'||k==='Y')&&!inEd){e.preventDefault();if(m!=='read')I.redo();return C.render()}
 if(inEd){if(k==='Escape'){e.preventDefault();ui.edit=null;return C.render()}
  if(k==='Enter'||k==='Tab'){e.preventDefault();ui.edit.val=t.value;I.commit();I.move(k==='Enter'?1:0,k==='Tab'?(e.shiftKey?-1:1):0);return C.render()}
  return}
 if(ctrl&&k==='Enter'){if(m!=='plan'||!I.o.onAdd)return;e.preventDefault();I.mut(()=>I.o.onAdd(ui.sel&&ui.sel.id));return C.render()}
 if(ctrl&&(k==='Delete'||k==='Backspace')){if(m!=='plan'||!ui.sel||!I.o.onDel)return;e.preventDefault();I.o.onDel(ui.sel.id);return C.render()}
 const L2R=document.documentElement.dir==='ltr';const mv={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,L2R?-1:1],ArrowRight:[0,L2R?1:-1]}[k];
 if(mv){e.preventDefault();ui.more=false;I.move(mv[0],mv[1]);return C.render()}
 if(k==='Tab'){e.preventDefault();I.move(0,e.shiftKey?-1:1);return C.render()}
 if(k==='Enter'||k==='F2'){if(!ui.sel)return;e.preventDefault();I.startEdit();return C.render()}
 if(k==='Escape'){if(ui.panel){ui.panel=false;return C.render()}if(ui.more){ui.more=false;return C.render()}return}
 if(k.length===1&&!ctrl&&!e.altKey&&ui.sel){const c=I.cols().find(x=>x.k===ui.sel.k);if(c&&c.type!=='sel'&&c.type!=='ro'){e.preventDefault();I.startEdit(k);return C.render()}}
});
document.addEventListener('dblclick',e=>{const I=cur();const el=e.target.closest('[data-a="ed-cell"]');if(!I||!el)return;const [id,k]=el.dataset.v.split('|');I.ui.sel={id,k};I.startEdit();C.render()});
document.addEventListener('change',e=>{const I=cur();if(!I)return;const t=e.target;
 if(t.dataset&&t.dataset.edg){I.ui.group=t.value;I.ui.fold=[];C.render();return}
 if(t.id==='e-in'&&t.tagName==='SELECT'){I.ui.edit.val=t.value;I.commit();C.render();return}
 const f=t.closest&&t.closest('[data-ep]');if(f&&I.o.onPanel&&I.ui.sel){const a=I.byId(I.ui.sel.id);const err=I.mut(()=>I.o.onPanel(a,f.dataset.ep,f.value,f));if(err)C.toast(err);C.render()}});
document.addEventListener('focusout',e=>{const t=e.target;if(t&&t.id==='e-in'&&t.tagName==='INPUT'){const I=cur();if(!I||!I.ui.edit)return;setTimeout(()=>{if(document.getElementById('e-in')===t&&document.activeElement!==t&&document.contains(t)){I.ui.edit.val=t.value;I.commit();C.render()}},120)}});
// column reorder (header drag)
let dragCol=null;
document.addEventListener('dragstart',e=>{const h=e.target.closest&&e.target.closest('[data-ecol]');if(!h)return;dragCol=h.dataset.ecol;e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',dragCol)}catch(x){}h.classList.add('drg')});
document.addEventListener('dragover',e=>{const h=e.target.closest&&e.target.closest('[data-ecol]');if(!h||!dragCol)return;e.preventDefault();document.querySelectorAll('.e-hc.dov').forEach(x=>x.classList.remove('dov'));h.classList.add('dov')});
document.addEventListener('drop',e=>{const h=e.target.closest&&e.target.closest('[data-ecol]');const I=cur();if(!h||!dragCol||!I)return;e.preventDefault();const ord=I.cols().map(c=>c.k);const f=ord.indexOf(dragCol),t=ord.indexOf(h.dataset.ecol);if(f<0||t<0||f===t){dragCol=null;return C.render()}ord.splice(t,0,ord.splice(f,1)[0]);I.ui.cols=ord;dragCol=null;C.toast('حُفظ ترتيب الأعمدة لك فقط — لا يتغيّر ما يراه غيرك');C.render()});
document.addEventListener('dragend',()=>{dragCol=null;document.querySelectorAll('.e-hc.drg,.e-hc.dov').forEach(x=>x.classList.remove('drg','dov'))});
// pointer: splitter, bars, row handle
let P=null;
document.addEventListener('pointerdown',e=>{const I=cur();if(!I||e.button!==0)return;const t=e.target;
 if(t.closest('[data-esplit]')){const ed=document.getElementById('e-ed');P={k:'split',I,ed,r:ed.getBoundingClientRect()};e.preventDefault();return}
 const hd=t.closest('[data-ehd]');if(hd&&I.mode()==='plan'){P={k:'row',I,id:hd.dataset.ehd,y0:e.clientY,moved:false};e.preventDefault();return}
 const b=t.closest('[data-eb]');if(!b)return;const id=b.dataset.eb;const z=t.dataset.ez;
 if(I.mode()!=='plan'||b.classList.contains('e-ms')&&!z){P={k:'click',I,id};return}
 const G=I.geo();P={k:z==='end'?'end':z==='link'?'link':'move',I,id,b,x0:e.clientX,y0:e.clientY,l0:b.offsetLeft,w0:b.offsetWidth,G,moved:false};
 if(P.k==='link'){const gb=b.closest('.e-gb2');const r=gb.getBoundingClientRect();P.gb=gb;P.gr=r;const ln=document.createElementNS('http://www.w3.org/2000/svg','svg');ln.setAttribute('class','e-tmp');ln.innerHTML='<line></line>';gb.appendChild(ln);P.ln=ln.firstChild;P.sx=b.offsetLeft+b.offsetWidth;P.sy=b.parentElement.offsetTop+RH/2}
 e.preventDefault()});
document.addEventListener('pointermove',e=>{if(!P)return;
 if(P.k==='split'){const r=P.r;let tw=(document.documentElement.dir==='ltr'?e.clientX-r.left:r.right-e.clientX)/r.width*100;tw=Math.max(22,Math.min(50,tw));P.tw=tw;P.ed.style.setProperty('--tw',tw+'%');return}
 if(P.k==='row'){if(Math.abs(e.clientY-P.y0)>4)P.moved=true;document.querySelectorAll('.e-r.dov').forEach(x=>x.classList.remove('dov'));const el=document.elementFromPoint(e.clientX,e.clientY);const r=el&&el.closest('.e-tp .e-r:not(.e-hr)');if(r){r.classList.add('dov');P.to=r}return}
 if(P.k==='click')return;const dx=e.clientX-P.x0;if(Math.abs(dx)>3||Math.abs(e.clientY-P.y0)>3)P.moved=true;
 const dd=Math.round(dx/P.G.P);
 if(P.k==='move'){P.b.style.left=(P.l0+dd*P.G.P)+'px';P.dd=dd;tip(e,dd?(dd>0?'+':'')+dd+' يوم · البداية '+C.fmt(C.addD(P.I.o.bar(P.I.byId(P.id)).s,dd),1):'')}
 if(P.k==='end'){P.b.style.width=Math.max(P.G.P,P.w0+dd*P.G.P)+'px';P.dd=dd;const b=P.I.o.bar(P.I.byId(P.id));const ne=C.addD(b.e,dd);tip(e,'النهاية '+C.fmt(ne,1)+' · '+Math.max(1,C.wdays(b.s,ne))+' يوم عمل')}
 if(P.k==='link'){const x=e.clientX-P.gr.left,y=e.clientY-P.gr.top;P.ln.setAttribute('x1',P.sx);P.ln.setAttribute('y1',P.sy);P.ln.setAttribute('x2',x);P.ln.setAttribute('y2',y);document.querySelectorAll('.e-bar.lt,.e-ms.lt').forEach(q=>q.classList.remove('lt'));const el=document.elementFromPoint(e.clientX,e.clientY);const tb=el&&el.closest('[data-eb]');if(tb&&tb.dataset.eb!==P.id)tb.classList.add('lt')}});
function tip(e,s){let t=document.getElementById('e-tip');if(!t){t=document.createElement('div');t.id='e-tip';t.className='e-tip';document.body.appendChild(t)}t.textContent=s;t.style.display=s?'block':'none';t.style.left=(e.clientX+12)+'px';t.style.top=(e.clientY-34)+'px'}
document.addEventListener('pointerup',e=>{if(!P)return;const p=P;P=null;const I=p.I;tip(e,'');
 if(p.k==='split'){if(p.tw){I.ui.split=Math.round(p.tw)}return C.render()}
 if(p.k==='row'){document.querySelectorAll('.e-r.dov').forEach(x=>x.classList.remove('dov'));if(p.moved&&p.to){const to=p.to.dataset.erow;const gk=p.to.classList.contains('e-gr')?p.to.querySelector('[data-a="ed-gtog"]').dataset.v:null;if(to!==p.id){I.mut(()=>I.o.onMove(p.id,to,gk));C.toast('أُعيد ترتيب الصف — المنطق والتواريخ لم تتغيّر')}}return C.render()}
 const sel=()=>{I.ui.sel={id:p.id,k:(I.ui.sel&&I.ui.sel.k)||'n'};I.ui.panel=true;I.ui.edit=null};
 if(p.k==='click'||!p.moved){sel();return C.render()}
 if(p.k==='move'&&p.dd){const a=I.byId(p.id);const b=I.o.bar(a);const err=I.mut(()=>I.o.onPin(a,C.nextWork(C.addD(b.s,p.dd))));if(err)C.toast(err);sel();return C.render()}
 if(p.k==='end'&&p.dd){const a=I.byId(p.id);const b=I.o.bar(a);const ne=C.addD(b.e,p.dd);const n=Math.max(1,C.wdays(b.s,ne));I.mut(()=>I.o.onDur(a,n));sel();return C.render()}
 if(p.k==='link'){p.ln&&p.ln.parentNode.remove();document.querySelectorAll('.lt').forEach(q=>q.classList.remove('lt'));const el=document.elementFromPoint(e.clientX,e.clientY);const tb=el&&el.closest('[data-eb]');if(tb&&tb.dataset.eb!==p.id){const err=I.mut(()=>I.o.onLink(p.id,tb.dataset.eb));C.toast(err||('أُنشئت علاقة '+p.id+' ← '+tb.dataset.eb+' FS بلا lag'))}return C.render()}
 C.render()});
document.addEventListener('click',e=>{const I=cur();if(I&&I.ui.more&&!e.target.closest('.e-dd')){I.ui.more=false;C.render()}},true);
let rz;addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(()=>{if(cur())C.render()},150)});
C.ED={create,RH,GB,DL};
})();
