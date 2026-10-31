// Schedule module v3 — shared grid + Gantt editor. Modes: plan (BL-0 draft) · rev (baseline revision) · upd (progress update) · read.
// Time direction follows the UI language (Arabic: earliest date on the right). Exposes SV.ED.view(key,cfg).
(function(){const S=SV,st=S.st,L=S.L,N=S.N,esc=S.esc,ic=S.ic;
const RH=34,ZP={d:24,w:7,m:2.4,q:.9};S.hist={};S.pw={};S.EDS={};
const defUI={sel:null,multi:[],edit:null,zoom:'w',links:true,fold:[],cols:null,show:{},split:44,panel:false,group:'wbs',filt:{},fs:false};
const GBY=[['wbs','WBS','WBS'],['disc','التخصص','Discipline'],['zone','المنطقة','Zone'],['bld','المبنى','Building'],['fl','الطابق','Floor']];
const ZL={d:['أيام','Days'],w:['أسابيع','Weeks'],m:['أشهر','Months'],q:['أرباع','Quarters']};
const UI=key=>{let u=st.ui[key];if(!u)u=st.ui[key]=JSON.parse(JSON.stringify(defUI));for(const k in defUI)if(!(k in u))u[k]=JSON.parse(JSON.stringify(defUI[k]));return u};
const H=key=>S.hist[key]||(S.hist[key]={u:[],r:[]});
function mut(I,fn){const h=H(I.key);h.u.push(I.cfg.snap());if(h.u.length>80)h.u.shift();h.r=[];const r=fn();if(typeof r==='string'){I.cfg.restore(h.u.pop())}I.cfg.recalc&&I.cfg.recalc();return r}
function undo(I){const h=H(I.key);if(!h.u.length)return S.toast(L('لا شيء للتراجع','Nothing to undo'));h.r.push(I.cfg.snap());I.cfg.restore(h.u.pop());I.cfg.recalc&&I.cfg.recalc()}
function redo(I){const h=H(I.key);if(!h.r.length)return;h.u.push(I.cfg.snap());I.cfg.restore(h.r.pop());I.cfg.recalc&&I.cfg.recalc()}
S.edMut=(key,fn)=>{const I=S.EDS[key];return I?mut(I,fn):fn()};
const edits=I=>I.cfg.mode==='plan'||I.cfg.mode==='rev';
// ---------- columns & rows
function cols(I){const all=(edits(I)?[{k:'_h',l:'',w:44,fixed:1,type:'ro'}]:[]).concat(I.cfg.cols);const ui=I.ui;const vis=c=>c.fixed||c.k==='id'||c.k==='n'||(ui.show[c.k]!=null?ui.show[c.k]:c.def!==false);
 let ord=all.map(c=>c.k);if(ui.cols){const o=ui.cols.filter(k=>ord.includes(k));ord.forEach(k=>{if(!o.includes(k))o.push(k)});ord=o;const hi=ord.indexOf('_h');if(hi>0){ord.splice(hi,1);ord.unshift('_h')}}
 return ord.map(k=>all.find(c=>c.k===k)).filter(vis)}
const gk={wbs:a=>a.g||'—',disc:a=>a.disc||'—',zone:a=>a.zone||'—',bld:a=>a.bld||'—',fl:a=>a.fl||'—'};
function gLabel(I,k){const g=I.ui.group;if(g==='wbs'){const x=(I.cfg.groups()||[]).find(q=>q.id===k);return x?N(x.n):'—'}if(g==='disc'&&k!=='—'){const d=SVD.DMS.disc.find(x=>x[0]===k);return k+' · '+L(d[1],d[2])}if(g==='fl'&&k!=='—')return L('الطابق ','Floor ')+k;return k}
function passes(I,a){const f=I.ui.filt;for(const k in f){const v=f[k];if(v&&v.length&&!v.includes(a[k]||'—'))return false}return true}
function rows(I){const L0=I.cfg.rows().filter(a=>passes(I,a));const g=I.ui.group;const order=[],map={};
 if(g==='wbs')(I.cfg.groups()||[]).forEach(x=>{order.push(x.id);map[x.id]=[]});
 L0.forEach(a=>{const k=gk[g](a);if(!map[k]){map[k]=[];order.push(k)}map[k].push(a)});
 const R=[];order.forEach(k=>{if(g!=='wbs'&&!map[k].length)return;const fold=I.ui.fold.includes(g+':'+k);R.push({t:'g',k,list:map[k],fold});if(!fold)map[k].forEach(a=>R.push({t:'a',a}))});return R}
const actRows=I=>rows(I).filter(r=>r.t==='a').map(r=>r.a);
const byId=(I,id)=>I.cfg.rows().find(a=>a.id===id);
// ---------- geometry (mirrored in RTL)
function geo(I){let [g0,g1]=I.cfg.range();const z=I.ui.zoom;if(z==='m'||z==='q'){const d=S.D(g0);g0=S.iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)))}else if(z==='w'){while(S.D(g0).getUTCDay()!==6)g0=S.addD(g0,-1)}
 const n=S.days(g0,g1)+1;let P=ZP[z];const pw=(S.pw[I.key]||0)-2;if(n*P<pw)P=pw/n;const W=Math.ceil(n*P);const rtl=S.rtl();
 const X=d=>S.days(g0,d)*P;const span=(a,b)=>{const l=X(a),r=X(S.addD(b,1));return rtl?[W-r,r-l]:[l,r-l]};const pt=d=>rtl?W-X(d):X(d);
 return {g0,g1,P,W,X,span,pt,rtl}}
function tiers(G,z){const t1=[],t2=[];let d=G.g0;const MS=m=>S.mon(m,1);
 while(d<=G.g1){const q=S.D(d),dd=q.getUTCDate(),m=q.getUTCMonth(),y=q.getUTCFullYear(),dw=q.getUTCDay();const first=d===G.g0;
  if(z==='d'||z==='w'){if(dd===1||first)t1.push([d,MS(m)+' '+y]);if(z==='d')t2.push([d,dd]);else if(dw===6||first)t2.push([d,dd])}
  else{if((m===0&&dd===1)||first)t1.push([d,y]);if(z==='m'&&(dd===1||first))t2.push([d,MS(m)]);if(z==='q'&&(first||(dd===1&&m%3===0)))t2.push([d,(st.lang==='en'?'Q':'ر')+(Math.floor(m/3)+1)])}d=S.addD(d,1)}
 const row=(T,c)=>T.map((t,i)=>{const e=i<T.length-1?S.addD(T[i+1][0],-1):G.g1;const [l,w]=G.span(t[0],e);return `<span style="left:${l}px;width:${w}px">${t[1]}</span>`}).join('');
 return `<div class="et-t1">${row(t1)}</div><div class="et-t2${z==='d'?' dd':''}">${row(t2)}</div>`}
function overlay(I,G,h){let s='';if(I.ui.zoom==='d'||I.ui.zoom==='w'){for(let d=G.g0;d<=G.g1;d=S.addD(d,1))if(!S.isWork(d)){const [l,w]=G.span(d,d);s+=`<i class="et-off" style="left:${l}px;width:${Math.max(1,w)}px"></i>`}}
 const dd=I.cfg.dd&&I.cfg.dd();if(dd&&dd>=G.g0&&dd<=G.g1)s+=`<i class="et-dd" style="left:${G.pt(S.addD(dd,1))}px"><b>${L('تاريخ البيانات','Data date')} ${S.fmt(dd,'s')}</b></i>`;
 const ce=I.cfg.ce&&I.cfg.ce();if(ce&&ce>=G.g0&&ce<=G.g1)s+=`<i class="et-ce" style="left:${G.pt(S.addD(ce,1))}px"><b>${L('النهاية التعاقدية','Contractual finish')}</b></i>`;
 return `<div class="et-ov" style="height:${h}px">${s}</div>`}
function bars(I,a,G){const b=I.cfg.bar(a);if(!b)return '';let h='';const sel=I.ui.sel&&I.ui.sel.id===a.id;const dg=edits(I)&&!a.del;
 if(b.base&&b.base.s){if(b.base.ms){h+=`<i class="et-bms" style="left:${G.pt(b.base.s)+(G.rtl?-G.P/2:G.P/2)-4}px"></i>`}else{const [l,w]=G.span(b.base.s,b.base.e);h+=`<i class="et-base" style="left:${l}px;width:${Math.max(2,w)}px"></i>`}}
 if(!b.s)return h;
 if(b.ms){const x=G.pt(b.s)+(G.rtl?-G.P/2:G.P/2)-7;return h+`<i class="et-ms${b.crit?' cr':''}${sel?' on':''}${b.cls?' '+b.cls:''}" data-eb="${a.id}" style="left:${x}px" title="${a.id} · ${S.fmt(b.s)}"></i>`}
 const [l,w]=G.span(b.s,b.e);
 return h+`<div class="et-bar${b.crit?' cr':''}${b.cls?' '+b.cls:''}${sel?' on':''}${dg?' dg':''}" data-eb="${a.id}" style="left:${l}px;width:${Math.max(3,w)}px" title="${a.id} · ${S.fmt(b.s)} – ${S.fmt(b.e)}">${b.pct?`<i class="pc" style="width:${b.pct}%"></i>`:''}${b.pin?`<span class="pin" title="${L('لا يبدأ قبل','Start no earlier than')} ${S.fmt(b.pin)}">${ic('pin-filled')}</span>`:''}${dg?`<i class="rz" data-ez="end" title="${L('اسحب لتغيير المدة','Drag to change duration')}"></i><i class="lh" data-ez="link" title="${L('اسحب إلى نشاط آخر لإنشاء علاقة FS','Drag onto another activity to link FS')}"></i>`:''}</div>`}
function links(I,R,G){if(!I.ui.links)return '';const y={};R.forEach((r,i)=>{if(r.t==='a')y[r.a.id]=i*RH+RH/2});const sg=G.rtl?-1:1;let p='';
 R.forEach(r=>{if(r.t!=='a'||r.a.del)return;const a=r.a,b=I.cfg.bar(a);if(!b||!b.s)return;(a.pred||[]).forEach(q=>{if(y[q[0]]==null)return;const pa=byId(I,q[0]);if(!pa||pa.del)return;const pb=I.cfg.bar(pa);if(!pb||!pb.e)return;
  const x1=pb.ms?G.pt(pb.e)+sg*G.P/2+sg*7:G.pt(S.addD(pb.e,1)),y1=y[q[0]],x2=b.ms?G.pt(b.s)+sg*G.P/2-sg*7:G.pt(b.s),y2=y[a.id];const cr=b.crit&&pb.crit;
  const d=sg*(x2-x1)>=10?`M${x1} ${y1}H${x1+sg*5}V${y2}H${x2-sg}`:`M${x1} ${y1}H${x1+sg*5}V${y2+(y2>y1?-RH/2:RH/2)}H${x2-sg*8}V${y2}H${x2-sg}`;
  p+=`<path d="${d}" class="${cr?'cr':''}" marker-end="url(#ea${cr?'c':''})"></path>`})});
 return `<svg class="et-lk" width="${G.W}" height="${R.length*RH}"><defs><marker id="ea" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6z" fill="var(--ui-muted)"></path></marker><marker id="eac" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6z" fill="var(--tone-red-solid)"></path></marker></defs>${p}</svg>`}
// ---------- cells
function cellHtml(I,a,c){const ui=I.ui;const on=ui.sel&&ui.sel.id===a.id&&ui.sel.k===c.k;const lk=c.lock&&c.lock(a);
 if(c.k==='_h')return `<div class="ec h"><span class="rh" data-rh="${a.id}" title="${L('اسحب لإعادة الترتيب','Drag to reorder')}">${ic('grip-vertical')}</span><span class="rmw"><button class="rmb" data-a="menu" data-v="rm:${I.key}:${a.id}" aria-label="${L('قائمة الصف','Row menu')}">${ic('dots')}</button>${S.menu('rm:'+I.key+':'+a.id,rowMenu(I,a),{w:220})}</span></div>`;
 let inner;const ed=on&&ui.edit;
 if(ed){if(c.type==='list'){const opts=c.opts(a).filter(o=>!ed.q||String(o[1]).toLowerCase().includes(ed.q.toLowerCase())||String(o[0]).toLowerCase().includes(ed.q.toLowerCase()));ed.n=opts.length;const ai=Math.min(ed.ai||0,Math.max(0,opts.length-1));
   inner=`<span class="nm">${c.v(a)}</span><div class="dd-pop"><label class="dd-q">${ic('search')}<input id="ed-in" data-in="ed-q" value="${esc(ed.q||'')}" placeholder="${L('بحث','Search')}" autocomplete="off"></label><div class="dd-ol">${opts.map((o,i)=>`<button class="${i===ai?'ai':''}${String(o[0])===String(c.raw(a)||'')?' cur':''}" data-a="ed-opt" data-v="${esc(o[0])}" data-stay>${esc(o[1])}</button>`).join('')||`<p>${L('لا نتائج','No matches')}</p>`}</div></div>`;I._opts=opts}
  else inner=`<input class="e-in" id="ed-in" type="${c.type==='date'?'date':'text'}"${c.type==='num'?' inputmode="numeric"':''} value="${esc(ed.val)}" data-in="ed-v"${c.type==='date'&&c.min?` min="${c.min(a)}"`:''}${c.type==='date'&&c.max?` max="${c.max(a)}"`:''}>`}
 else inner=c.v(a);
 return `<div class="ec${c.cls?' '+c.cls:''}${lk?' lk':''}${on?' on':''}${I.cfg.chg&&I.cfg.chg(a,c.k)?' chg':''}" data-a="ed-cell" data-v="${I.key}|${a.id}|${c.k}">${inner}${lk&&on?ic('lock','lki'):''}</div>`}
function rowMenu(I,a){const plan=edits(I);return [{a:'ed-add',v:I.key+'|act|'+a.id,ic:'plus',l:L('إضافة نشاط تحته','Add activity below'),dis:!plan},{a:'ed-dup',v:I.key+'|'+a.id,ic:'copy',l:L('تكرار','Duplicate'),k:'Ctrl+D',dis:!plan},'-',{a:'ed-del',v:I.key+'|'+a.id,ic:'trash',l:L('حذف','Delete'),dan:1,dis:!plan}]}
function groupRow(I,r,TW){const g=I.ui.group;const n=r.list.length;const pl=edits(I)&&g==='wbs';const key=I.key;
 return `<div class="eg-g" style="width:${TW}px" data-grow="${esc(r.k)}">${pl?`<span class="rh" data-gh="${esc(r.k)}" title="${L('اسحب لإعادة ترتيب المجموعة','Drag to reorder group')}">${ic('grip-vertical')}</span>`:''}<button class="fold" data-a="ed-fold" data-v="${key}|${esc(r.k)}" aria-label="${L('طيّ/توسيع','Collapse/expand')}">${ic(r.fold?(S.rtl()?'chevron-left':'chevron-right'):'chevron-down')}</button><b data-a="ed-gsel" data-v="${key}|${esc(r.k)}">${esc(gLabel(I,r.k))}</b><small>${n}</small>${pl?`<span class="rmw gm"><button class="rmb" data-a="menu" data-v="gm:${key}:${esc(r.k)}" aria-label="${L('قائمة المجموعة','Group menu')}">${ic('dots')}</button>${S.menu('gm:'+key+':'+r.k,[{a:'ed-gadd',v:key+'|'+r.k,ic:'plus',l:L('إضافة نشاط في المجموعة','Add activity in group')},{a:'ed-gren',v:key+'|'+r.k,ic:'pencil',l:L('إعادة تسمية','Rename')},{a:'ed-gdup',v:key+'|'+r.k,ic:'copy',l:L('نسخ المجموعة','Copy group')},'-',{a:'ed-gdel',v:key+'|'+r.k,ic:'trash',l:L('حذف المجموعة','Delete group'),dan:1}],{w:230})}</span>`:''}</div>`}
// ---------- view
S.ED={view(key,cfg){const ui=UI(key);const I={key,cfg,ui};S.EDS[key]=I;S.curEd=key;S.A['ed-zoom:'+key]=v=>{S.EDS[key].ui.zoom=v};
 const CS=cols(I),R=rows(I),G=geo(I);I.G=G;const gt=CS.map(c=>c.w+'px').join(' '),TW=CS.reduce((n,c)=>n+c.w,0);
 const hd=`<div class="eg-hr" style="grid-template-columns:${gt};width:${TW}px">${CS.map(c=>`<div class="eh${c.lock?' lk':''}${c.cls?' '+c.cls:''}" draggable="${c.k!=='_h'}" data-ecol="${key}|${c.k}" title="${c.k==='_h'?'':L('اسحب لإعادة ترتيب الأعمدة','Drag to reorder columns')}">${c.lock?ic('lock'):''}${c.l}</div>`).join('')}</div>`;
 const body=R.map(r=>r.t==='g'?groupRow(I,r,TW):`<div class="eg-r${ui.sel&&ui.sel.id===r.a.id?' sel':''}${ui.multi.includes(r.a.id)?' mul':''}${cfg.rowCls?' '+cfg.rowCls(r.a):''}" data-row="${r.a.id}" style="grid-template-columns:${gt};width:${TW}px">${CS.map(c=>cellHtml(I,r.a,c)).join('')}</div>`).join('')||`<div class="eg-empty">${L('لا أنشطة تطابق الفلتر','No activities match the filter')}</div>`;
 const gb=R.map(r=>{if(r.t==='g'){const B=r.list.filter(a=>!a.del).map(a=>cfg.bar(a)).filter(b=>b&&b.s);if(!B.length)return '<div class="et-r g"></div>';const s=B.reduce((m,b)=>b.s<m?b.s:m,'9'),e=B.reduce((m,b)=>(b.e||b.s)>m?(b.e||b.s):m,'0');const [l,w]=G.span(s,e);return `<div class="et-r g"><i class="et-sum" style="left:${l}px;width:${w}px"></i></div>`}
  return `<div class="et-r${ui.sel&&ui.sel.id===r.a.id?' sel':''}${cfg.rowCls?' '+cfg.rowCls(r.a):''}">${bars(I,r.a,G)}</div>`}).join('');
 const sa=ui.panel&&ui.sel&&byId(I,ui.sel.id);
 const pn=ui.panel?`<aside class="ed-pn"><div class="pn-hd">${sa?`<div><small class="id">${sa.id}</small><b>${esc(N(sa.n))}</b></div>`:`<div><b>${L('تفاصيل النشاط','Activity details')}</b></div>`}${S.ib('x',{a:'ed-pclose',v:key,title:L('إغلاق','Close')})}</div><div class="pn-bd">${sa?cfg.panel(sa):`<p class="mut">${L('اختر نشاطاً من الجدول أو الغانت.','Pick an activity in the table or the Gantt.')}</p>`}</div></aside>`:'';
 const nf=Object.values(ui.filt).filter(v=>v&&v.length).length;
 const more=[{h:L('التجميع حسب','Group by')},...GBY.map(g=>({a:'ed-group',v:key+'|'+g[0],l:L(g[1],g[2]),on:ui.group===g[0]})),'-',{a:'ed-links',v:key,ic:'arrows-right-left',l:L('أسهم العلاقات','Link arrows'),on:ui.links},{a:'ed-foldall',v:key+'|'+(ui.fold.length?'open':'close'),ic:ui.fold.length?'fold-down':'fold-up',l:ui.fold.length?L('توسيع الكل','Expand all'):L('طيّ الكل','Collapse all')},{a:'menu',v:'cols:'+key,ic:'columns',l:L('الأعمدة…','Columns…'),stay:1},{a:'ed-fs',v:key,ic:'maximize',l:L('ملء الشاشة','Full screen')}].concat(edits(I)?['-',{a:'ed-undo',v:key,ic:'arrow-back-up',l:L('تراجع','Undo'),k:'Ctrl+Z'},{a:'ed-redo',v:key,ic:'arrow-forward-up',l:L('إعادة','Redo'),k:'Ctrl+Y'}]:[]).concat(cfg.more?cfg.more():[]);
 const colMenu=st.menu==='cols:'+key?`<div class="mn2 colm"><h6>${L('الأعمدة','Columns')}</h6>${[{k:'_x'}].concat(cfg.cols).filter(c=>c.k!=='_x'&&c.k!=='id'&&c.k!=='n').map(c=>{const on=ui.show[c.k]!=null?ui.show[c.k]:c.def!==false;return `<button class="mi" data-a="ed-col" data-v="${key}|${c.k}" data-stay><span class="ccb${on?' on':''}">${on?ic('check'):''}</span><span>${c.l||c.k}</span></button>`}).join('')}<div class="sep"></div><button class="mi" data-a="ed-colreset" data-v="${key}">${ic('refresh')}<span>${L('استعادة الترتيب الافتراضي','Restore default order')}</span></button></div>`:'';
 const tb=`<div class="ed-tb">${cfg.tools||''}<button class="b sec${nf?' act':''}" data-a="ed-filter" data-v="${key}" data-fpop>${ic('filter')}<span>${L('فلتر','Filter')}${nf?' · '+nf:''}</span></button>${S.seg(Object.keys(ZL).map(k=>[k,N(ZL[k])]),ui.zoom,'ed-zoom:'+key)}<span class="sp"></span>${cfg.tbEnd||''}${ui.fs?S.btn(L('إغلاق ملء الشاشة','Exit full screen'),{a:'ed-fs',v:key,ic:'minimize',k:'sec'}):''}<span class="mw">${S.ib('dots',{a:'menu',v:'more:'+key,title:L('المزيد','More')})}${S.menu('more:'+key,more.map(x=>x.stay?x:x),{w:250})}${colMenu}</span></div>`;
 return `<div class="ed-wrap${ui.fs?' fs':''}">${tb}<div class="ed" id="ed-${key}" style="--split:${ui.split}%"><div class="ed-g"><div class="eg-h" data-sync="gh">${hd}</div><div class="eg-b" data-keep="gb-${key}" data-sync="gb"><div class="eg-in" style="width:${TW}px">${body}</div></div></div><div class="ed-sp" data-esplit="${key}"><i></i></div><div class="ed-t"><div class="et-h" data-sync="th"><div style="width:${G.W}px;position:relative">${tiers(G,ui.zoom)}</div></div><div class="et-b" data-keep="tb-${key}" data-sync="tb"><div class="et-in" style="width:${G.W}px;height:${Math.max(R.length*RH,1)}px">${overlay(I,G,R.length*RH)}${links(I,R,G)}${gb}</div></div></div>${pn}</div></div>`}};
// ---------- helpers for actions
const E=v=>{const [k,...r]=String(v).split('|');return [S.EDS[k],...r]};
function move(I,dr,dc){const A=actRows(I),C=cols(I).filter(c=>c.k!=='_h');if(!A.length)return;let s=I.ui.sel||{id:A[0].id,k:C[0].k};let r=A.findIndex(a=>a.id===s.id);if(r<0)r=0;let c=C.findIndex(x=>x.k===s.k);if(c<0)c=0;
 r=Math.max(0,Math.min(A.length-1,r+dr));c=Math.max(0,Math.min(C.length-1,c+dc));I.ui.sel={id:A[r].id,k:C[c].k};I.ui.edit=null;I.ui.multi=[];if(I.ui.panel===false&&0)I.ui.panel=true;scrollSel(I)}
function scrollSel(I){S.after.push(function f(){S.after.splice(S.after.indexOf(f),1);const el=document.querySelector(`#ed-${I.key} .ec.on`),gb=document.querySelector(`#ed-${I.key} .eg-b`);if(!el||!gb)return;const r=el.getBoundingClientRect(),p=gb.getBoundingClientRect();if(r.top<p.top+2)gb.scrollTop-=p.top-r.top+4;else if(r.bottom>p.bottom-2)gb.scrollTop+=r.bottom-p.bottom+4;if(r.left<p.left)gb.scrollLeft-=p.left-r.left+6;else if(r.right>p.right)gb.scrollLeft+=r.right-p.right+6})}
const lockedMsg=()=>L('مقفل في وضع التحديث. يُغيَّر عبر طلب تعديل خط الأساس.','Locked in update mode. Change it through a baseline revision request.');
function startEdit(I,init){const s=I.ui.sel;if(!s)return;const a=byId(I,s.id),c=cols(I).find(x=>x.k===s.k);if(!a||!c||c.k==='_h')return;
 if(c.lock&&c.lock(a)){S.toast(I.cfg.mode==='upd'?lockedMsg():L('هذه الخلية للقراءة فقط','This cell is read-only'));return}
 if(I.cfg.mode==='read'||!c.set||a.del){S.toast(I.cfg.mode==='read'?L('الجدول للقراءة فقط','The schedule is read-only'):L('هذه الخلية للقراءة فقط','This cell is read-only'));return}
 if(c.type==='list')I.ui.edit={q:init||'',ai:0};else I.ui.edit={val:init!=null&&c.type!=='date'?init:(c.raw?c.raw(a):'')??''}}
function commit(I,val){const s=I.ui.sel,e=I.ui.edit;if(!s||!e)return;const a=byId(I,s.id),c=cols(I).find(x=>x.k===s.k);I.ui.edit=null;if(!a||!c)return;const v=val!=null?val:e.val;if(String(v)===String(c.raw?c.raw(a)??'':''))return;const err=mut(I,()=>c.set(a,v));if(err)S.toast(err,'red')}
S.A['ed-cell']=(v,el,ev)=>{const [I,id,k]=E(v);if(!I)return;const ui=I.ui;if(ui.edit&&ui.sel&&ui.sel.id===id&&ui.sel.k===k)return false;if(ui.edit){const inp=document.getElementById('ed-in');if(inp&&inp.dataset.in==='ed-v')commit(I,inp.value);else ui.edit=null}
 if(ev.shiftKey&&ui.sel){const A=actRows(I).map(a=>a.id);const i0=A.indexOf(ui.sel.id),i1=A.indexOf(id);ui.multi=A.slice(Math.min(i0,i1),Math.max(i0,i1)+1);return}
 ui.multi=[];ui.sel={id,k:k==='_h'?'n':k};ui.panel=true};
S.A['ed-opt']=(v,el)=>{const I=S.EDS[S.curEd];if(!I)return;commit(I,v)};
S.IN['ed-v']=el=>{const I=S.EDS[S.curEd];if(I&&I.ui.edit)I.ui.edit.val=el.value};
S.IN['ed-q']=el=>{const I=S.EDS[S.curEd];if(I&&I.ui.edit){I.ui.edit.q=el.value;I.ui.edit.ai=0;return true}};
S.A['ed-pclose']=v=>{S.EDS[v].ui.panel=false};
S.A['ed-fold']=v=>{const [I,k]=E(v);const f=I.ui.group+':'+k,i=I.ui.fold.indexOf(f);i<0?I.ui.fold.push(f):I.ui.fold.splice(i,1)};
S.A['ed-foldall']=v=>{const [I,x]=E(v);if(x==='open')I.ui.fold=[];else I.ui.fold=rows(I).filter(r=>r.t==='g').map(r=>I.ui.group+':'+r.k)};
S.A['ed-gsel']=v=>{const [I,k]=E(v);const r=rows(I).find(x=>x.t==='g'&&x.k===k);if(!r||!r.list.length)return;I.ui.multi=r.list.map(a=>a.id);I.ui.sel={id:r.list[0].id,k:'n'}};
S.A['ed-group']=v=>{const [I,g]=E(v);I.ui.group=g;I.ui.fold=[]};
S.A['ed-links']=v=>{const I=S.EDS[v];I.ui.links=!I.ui.links};
S.A['ed-fs']=v=>{const I=S.EDS[v];I.ui.fs=!I.ui.fs};
S.A['ed-undo']=v=>undo(S.EDS[v]);S.A['ed-redo']=v=>redo(S.EDS[v]);
S.A['ed-col']=v=>{const [I,k]=E(v);const c=I.cfg.cols.find(x=>x.k===k);const on=I.ui.show[k]!=null?I.ui.show[k]:c.def!==false;I.ui.show[k]=!on;st.menu='cols:'+I.key};
S.A['ed-colreset']=v=>{const I=S.EDS[v];I.ui.cols=null;I.ui.show={};S.toast(L('استُعيد ترتيب الأعمدة الافتراضي','Default column order restored'))};
S.A['ed-filter']=(v,el)=>{const I=S.EDS[v];const D=SVD.DMS;const used=k=>[...new Set(I.cfg.rows().map(a=>a[k]||'—'))];
 const fields=[{k:'disc',n:L('التخصص','Discipline'),a:'DMS',opts:used('disc').map(x=>{const d=D.disc.find(q=>q[0]===x);return [x,'','',d?x+' · '+L(d[1],d[2]):x]})},{k:'zone',n:L('المنطقة','Zone'),a:'DMS',opts:used('zone').map(x=>[x,'','',x])},{k:'bld',n:L('المبنى','Building'),a:'DMS',opts:used('bld').map(x=>[x,'','',x])},{k:'fl',n:L('الطابق','Floor'),a:'DMS',opts:used('fl').map(x=>[x,'','',x==='—'?x:L('الطابق ','Floor ')+x])}];
 FPop.open(el,{fields,saved:{starred:[],mine:[]},sel:JSON.parse(JSON.stringify(I.ui.filt)),L:(en,ar)=>L(ar,en),onChange:sel=>{I.ui.filt=JSON.parse(JSON.stringify(sel));SV.render();FPop.btn=document.querySelector(`[data-a="ed-filter"][data-v="${I.key}"]`);FPop.place()}});return false};
// plan-mode structure ops
const data=I=>I.cfg.data();
function newId(I,near){const A=data(I).acts;const m=(near||'').match(/^([A-Za-z]+-?)(\d+)$/)||[null,I.cfg.prefix||'A-',String(100)];let n=+m[2]+1;while(A.some(a=>a.id===m[1]+n))n++;return m[1]+n}
function add(I,kind,gid){const d=data(I),sel=I.ui.sel&&byId(I,I.ui.sel.id);if(kind==='grp'){const id='G'+Date.now().toString(36);const gi=sel?d.groups.findIndex(g=>g.id===sel.g):d.groups.length-1;d.groups.splice(gi+1,0,{id,n:L('مجموعة جديدة','New group')});renameGroup(I,id);return}
 const g=gid||(sel?sel.g:(d.groups[0]||{}).id);const ref=gid?d.acts.filter(a=>a.g===gid).pop():sel;const a={id:newId(I,ref?ref.id:null),n:kind==='ms'?L('معلم جديد','New milestone'):L('نشاط جديد','New activity'),g,ws:null,disc:ref?ref.disc:null,zone:ref?ref.zone:null,bld:ref?ref.bld:null,fl:ref?ref.fl:null,dur:kind==='ms'?0:1,ms:kind==='ms'?1:0,pred:[],isNew:1};
 const i=ref?d.acts.indexOf(ref):d.acts.length-1;d.acts.splice(i+1,0,a);I.ui.sel={id:a.id,k:'n'};I.ui.panel=true;I.ui.edit={val:N(a.n)};scrollSel(I)}
function renameGroup(I,gid){const g=data(I).groups.find(x=>x.id===gid);S.modal({title:L('اسم المجموعة','Group name'),ok:L('حفظ','Save'),body:S.field(L('الاسم (مرحلة WBS)','Name (WBS phase)'),`<input class="in" id="g-name" value="${esc(N(g.n))}">`),onOk:()=>{const v=S.mv('g-name').trim();if(!v)return L('الاسم مطلوب','Name is required');mut(I,()=>{g.n=v})}})}
function copyActs(I,ids){const A=data(I).acts;return ids.map(id=>A.find(a=>a.id===id)).filter(Boolean).map(a=>JSON.parse(JSON.stringify(a)))}
function paste(I,clip,afterId){if(!clip||!clip.length)return;const d=data(I);const map={};let last=afterId||clip[clip.length-1].id;
 const items=clip.map(a=>{const id=newId(I,last);last=id;map[a.id]=id;return Object.assign({},a,{id,isNew:1,pin:null,del:0})});
 items.forEach(x=>{x.pred=x.pred.filter(p=>map[p[0]]).map(p=>[map[p[0]],p[1]])});const i=d.acts.findIndex(a=>a.id===afterId);d.acts.splice(i<0?d.acts.length:i+1,0,...items);I.ui.multi=items.map(x=>x.id);I.ui.sel={id:items[0].id,k:'n'};S.toast(L('لُصق ','Pasted ')+items.length+L(' — الروابط الخارجية لا تُنسخ',' — outside links not copied'))}
function del(I,ids,label){const d=data(I);const set=new Set(ids);const succ=d.acts.filter(a=>!set.has(a.id)&&a.pred.some(p=>set.has(p[0])));const rev=I.cfg.mode==='rev';
 S.modal({title:label||L('حذف ','Delete ')+ids[0],ok:L('حذف','Delete'),kind:'dan',body:()=>`<p>${label?(L('ستُحذف المجموعة «','Group «')+label.split('«')[1]):ids.length===1?L('سيُحذف النشاط ','Activity ')+`<b>${ids[0]}</b>`+L('.',' will be deleted.'):ids.length+L(' أنشطة ستُحذف.',' activities will be deleted.')}</p>${succ.length?`<div class="nt t-amber">${ic('alert-triangle')}<span>${L('له لواحق: ','Has successors: ')}${succ.map(a=>`<b class="id">${a.id}</b>`).join('، ')}${L(' — ستفقد هذا السابق وتظهر «نشاط مفتوح» إن لم يبقَ لها سابق.',' — they lose this predecessor and show "Open activity" if none remain.')}</span></div>`:''}${rev?S.field(L('سبب الحذف','Reason for deletion'),`<input class="in" id="del-r">`,{req:1,hint:L('يبقى النشاط ظاهراً مشطوباً حتى اعتماد التعديل.','The activity stays visible, struck through, until the revision is approved.')}):''}`,
  onOk:()=>{let r=null;if(rev){r=S.mv('del-r').trim();if(!r)return L('سبب الحذف إلزامي','A reason is required')}mut(I,()=>{if(rev){d.acts.forEach(a=>{if(set.has(a.id)){if(a.isNew){d.acts.splice(d.acts.indexOf(a),1)}else{a.del=1;a.delR=r}}})}else{d.acts=d.acts.filter(a=>!set.has(a.id))}d.acts.forEach(a=>{a.pred=a.pred.filter(p=>!set.has(p[0]))})});I.ui.multi=[];if(I.ui.sel&&set.has(I.ui.sel.id)&&!rev)I.ui.sel=null;S.toast(L('حُذف — Ctrl+Z للتراجع','Deleted — Ctrl+Z to undo'))}})}
S.edDel=(key,ids)=>{const I=S.EDS[key];if(I)del(I,ids)};
S.A['ed-add']=v=>{const [I,k,id]=E(v);st.menu=null;if(id)I.ui.sel={id,k:'n'};mut(I,()=>add(I,k))};
S.A['ed-dup']=v=>{const [I,id]=E(v);const c=copyActs(I,[id]);mut(I,()=>paste(I,c,id))};
S.A['ed-del']=v=>{const [I,id]=E(v);del(I,I.ui.multi.length>1&&I.ui.multi.includes(id)?I.ui.multi:[id])};
S.A['ed-gadd']=v=>{const [I,g]=E(v);mut(I,()=>add(I,'act',g))};
S.A['ed-gren']=v=>{const [I,g]=E(v);renameGroup(I,g)};
S.A['ed-gdup']=v=>{const [I,g]=E(v);const ids=data(I).acts.filter(a=>a.g===g).map(a=>a.id);S.clip=copyActs(I,ids);S.toast(L('نُسخت المجموعة — اختر صفاً ثم Ctrl+V','Group copied — pick a row, then Ctrl+V'))};
S.A['ed-gdel']=v=>{const [I,g]=E(v);const d=data(I);const ids=d.acts.filter(a=>a.g===g).map(a=>a.id);const gn=N(d.groups.find(x=>x.id===g).n);
 if(!ids.length){mut(I,()=>{d.groups=d.groups.filter(x=>x.id!==g)});return}
 del(I,ids,L('حذف المجموعة «'+gn+'» و'+ids.length+' أنشطة فيها','Delete group «'+gn+'» and its '+ids.length+' activities'));const m=st.modal,ok=m.onOk;m.onOk=()=>{const r=ok();if(r)return r;if(I.cfg.mode!=='rev'){d.groups=d.groups.filter(x=>x.id!==g)}}};
// ---------- keyboard
document.addEventListener('keydown',e=>{const I=S.EDS[S.curEd];if(!I||st.modal||!document.getElementById('ed-'+I.key))return;const ui=I.ui,t=e.target,inEd=t&&t.id==='ed-in';
 if(t&&!inEd&&t.closest&&t.closest('input,textarea,select'))return;const k=e.key,ctrl=e.ctrlKey||e.metaKey;const pl=edits(I);
 if(k==='Escape'&&ui.fs&&!ui.edit){ui.fs=false;return S.render()}
 if(ctrl&&!inEd&&(k==='z'||k==='Z')){if(!pl)return;e.preventDefault();e.shiftKey?redo(I):undo(I);return S.render()}
 if(ctrl&&!inEd&&(k==='y'||k==='Y')){if(!pl)return;e.preventDefault();redo(I);return S.render()}
 if(inEd){const c=cols(I).find(x=>x.k===ui.sel.k);
  if(k==='Escape'){e.preventDefault();ui.edit=null;return S.render()}
  if(c&&c.type==='list'){if(k==='ArrowDown'||k==='ArrowUp'){e.preventDefault();ui.edit.ai=Math.max(0,Math.min((ui.edit.n||1)-1,(ui.edit.ai||0)+(k==='ArrowDown'?1:-1)));return S.render()}
   if(k==='Enter'||k==='Tab'){e.preventDefault();const o=I._opts&&I._opts[Math.min(ui.edit.ai||0,I._opts.length-1)];if(o)commit(I,o[0]);else ui.edit=null;move(I,k==='Enter'?1:0,k==='Tab'?(e.shiftKey?-1:1):0);return S.render()}return}
  if(k==='Enter'||k==='Tab'){e.preventDefault();ui.edit.val=t.value;commit(I);move(I,k==='Enter'?1:0,k==='Tab'?(e.shiftKey?-1:1):0);return S.render()}return}
 if(ctrl&&(k==='c'||k==='C')&&ui.sel){e.preventDefault();S.clip=copyActs(I,ui.multi.length?ui.multi:[ui.sel.id]);S.toast(L('نُسخ ','Copied ')+S.clip.length);return}
 if(ctrl&&(k==='v'||k==='V')&&pl&&S.clip){e.preventDefault();mut(I,()=>paste(I,S.clip,ui.sel?ui.sel.id:null));return S.render()}
 if(ctrl&&(k==='d'||k==='D')&&pl&&ui.sel){e.preventDefault();const c=copyActs(I,[ui.sel.id]);mut(I,()=>paste(I,c,ui.sel.id));return S.render()}
 if((k==='Delete'||(ctrl&&k==='Backspace'))&&pl&&ui.sel){e.preventDefault();del(I,ui.multi.length?ui.multi:[ui.sel.id]);return S.render()}
 const rt=S.rtl();const mv={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,rt?1:-1],ArrowRight:[0,rt?-1:1]}[k];
 if(mv){e.preventDefault();st.menu=null;if(e.shiftKey&&mv[0]&&ui.sel){const A=actRows(I).map(a=>a.id);const i=A.indexOf(ui.sel.id),j=Math.max(0,Math.min(A.length-1,i+mv[0]));const base=ui.multi.length?ui.multi:[ui.sel.id];ui.multi=[...new Set(base.concat(A[j]))];ui.sel={id:A[j],k:ui.sel.k};return S.render()}move(I,mv[0],mv[1]);return S.render()}
 if(k==='Tab'){e.preventDefault();move(I,0,e.shiftKey?-1:1);return S.render()}
 if(k==='Enter'||k==='F2'){if(!ui.sel)return;e.preventDefault();startEdit(I);return S.render()}
 if(k.length===1&&!ctrl&&!e.altKey&&ui.sel){const c=cols(I).find(x=>x.k===ui.sel.k);if(c&&c.type!=='ro'&&c.type!=='date'){e.preventDefault();startEdit(I,k);return S.render()}}});
document.addEventListener('dblclick',e=>{const el=e.target.closest('[data-a="ed-cell"]');if(!el)return;const [I,id,k]=E(el.dataset.v);if(!I)return;I.ui.sel={id,k};startEdit(I);S.render()});
S.after.push(()=>{const el=document.getElementById('ed-in');if(el&&document.activeElement!==el){el.focus();if(el.type==='text'&&el.setSelectionRange)try{el.setSelectionRange(el.value.length,el.value.length)}catch(x){}}});
document.addEventListener('focusout',e=>{const t=e.target;if(!t||t.id!=='ed-in'||t.dataset.in!=='ed-v')return;setTimeout(()=>{const I=S.EDS[S.curEd];if(!I||!I.ui.edit||!document.contains(t)||document.activeElement===t)return;I.ui.edit.val=t.value;commit(I);S.render()},150)});
// ---------- scroll sync + width measure
S.after.push(()=>{const I=S.EDS[S.curEd];if(!I)return;const root=document.getElementById('ed-'+I.key);if(!root)return;const q=s=>root.querySelector('[data-sync="'+s+'"]');const gb=q('gb'),tb=q('tb'),gh=q('gh'),th=q('th');
 let lock=0;gb.onscroll=()=>{gh.scrollLeft=gb.scrollLeft;if(lock)return;lock=1;tb.scrollTop=gb.scrollTop;requestAnimationFrame(()=>lock=0)};tb.onscroll=()=>{th.scrollLeft=tb.scrollLeft;if(lock)return;lock=1;gb.scrollTop=tb.scrollTop;requestAnimationFrame(()=>lock=0)};gh.scrollLeft=gb.scrollLeft;th.scrollLeft=tb.scrollLeft;
 const w=root.querySelector('.ed-t').clientWidth;if(Math.abs(w-(S.pw[I.key]||0))>4){S.pw[I.key]=w;requestAnimationFrame(()=>S.render())}});
let rz;addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(()=>S.render(),150)});
// ---------- column drag (header)
let dc=null;
document.addEventListener('dragstart',e=>{const h=e.target.closest&&e.target.closest('[data-ecol]');if(!h)return;dc=h.dataset.ecol;e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',dc)}catch(x){}h.classList.add('drg')});
document.addEventListener('dragover',e=>{const h=e.target.closest&&e.target.closest('[data-ecol]');if(!h||!dc)return;e.preventDefault();document.querySelectorAll('.eh.dov').forEach(x=>x.classList.remove('dov'));h.classList.add('dov')});
document.addEventListener('drop',e=>{const h=e.target.closest&&e.target.closest('[data-ecol]');if(!h||!dc)return;e.preventDefault();const [key,from]=dc.split('|'),to=h.dataset.ecol.split('|')[1];const I=S.EDS[key];dc=null;if(!I||from===to||to==='_h')return S.render();const ord=cols(I).map(c=>c.k);const all=[...new Set((I.ui.cols||[]).concat(ord,I.cfg.cols.map(c=>c.k)))];const f=all.indexOf(from);all.splice(f,1);all.splice(all.indexOf(to),0,from);I.ui.cols=all;S.toast(L('حُفظ ترتيب الأعمدة لك فقط','Column order saved for you only'));S.render()});
document.addEventListener('dragend',()=>{dc=null;document.querySelectorAll('.eh.drg,.eh.dov').forEach(x=>x.classList.remove('drg','dov'))});
// ---------- pointer: divider, bars, row/group handles
let P=null;const tip=(e,s)=>{let t=document.getElementById('ed-tip');if(!t){t=document.createElement('div');t.id='ed-tip';t.className='ed-tip';document.body.appendChild(t)}t.textContent=s||'';t.style.display=s?'block':'none';if(e){t.style.left=(e.clientX+12)+'px';t.style.top=(e.clientY-36)+'px'}};
document.addEventListener('pointerdown',e=>{if(e.button!==0)return;const t=e.target;const sp=t.closest('[data-esplit]');
 if(sp){const I=S.EDS[sp.dataset.esplit];const ed=document.getElementById('ed-'+I.key);P={k:'split',I,ed,r:ed.getBoundingClientRect()};e.preventDefault();return}
 const rh=t.closest('[data-rh],[data-gh]');if(rh){const I=S.EDS[S.curEd];if(!I||!edits(I))return;P={k:rh.dataset.rh?'row':'grp',I,id:rh.dataset.rh||rh.dataset.gh,y0:e.clientY,mv:0};e.preventDefault();return}
 const b=t.closest('[data-eb]');if(!b)return;const I=S.EDS[S.curEd];if(!I)return;const id=b.dataset.eb,a=byId(I,id);const z=t.dataset.ez;
 if(!edits(I)||a.del||(b.classList.contains('et-ms')&&!z)){P={k:'click',I,id};return}
 const inn=b.closest('.et-in'),ir=inn.getBoundingClientRect();P={k:z==='end'?'end':z==='link'?'link':'move',I,id,a,b,x0:e.clientX,y0:e.clientY,l0:b.offsetLeft,w0:b.offsetWidth,mv:0,ir,inn};
 if(P.k==='link'){const sv=document.createElementNS('http://www.w3.org/2000/svg','svg');sv.setAttribute('class','et-tmp');sv.innerHTML='<line></line>';inn.appendChild(sv);P.ln=sv.firstChild;P.sx=S.rtl()?b.offsetLeft:b.offsetLeft+b.offsetWidth;P.sy=b.parentElement.offsetTop+RH/2}e.preventDefault()});
document.addEventListener('pointermove',e=>{if(!P)return;
 if(P.k==='split'){const r=P.r;let x=S.rtl()?r.right-e.clientX:e.clientX-r.left;let p=Math.max(20,Math.min(70,x/r.width*100));P.p=p;P.ed.style.setProperty('--split',p+'%');return}
 if(P.k==='row'||P.k==='grp'){if(Math.abs(e.clientY-P.y0)>4)P.mv=1;document.querySelectorAll('.ins').forEach(x=>x.classList.remove('ins'));const el=document.elementFromPoint(e.clientX,e.clientY);const r=el&&el.closest('.eg-r,.eg-g');if(r){r.classList.add('ins');P.to=r}return}
 if(P.k==='click')return;const dx=e.clientX-P.x0;if(Math.abs(dx)>3||Math.abs(e.clientY-P.y0)>3)P.mv=1;const G=P.I.G,sg=G.rtl?-1:1;const dd=Math.round(sg*dx/G.P);P.dd=dd;const bb=P.I.cfg.bar(P.a);
 if(P.k==='move'){P.b.style.left=(P.l0+sg*dd*G.P)+'px';tip(e,dd?(dd>0?'+':'')+dd+' · '+L('البداية ','Start ')+S.fmt(S.addD(bb.s,dd)):'')}
 if(P.k==='end'){const w=Math.max(G.P,P.w0+dd*G.P);P.b.style.width=w+'px';if(G.rtl)P.b.style.left=(P.l0-(w-P.w0))+'px';const ne=S.addD(bb.e,dd);tip(e,L('النهاية ','Finish ')+S.fmt(ne)+' · '+S.dn(Math.max(1,S.wdays(bb.s,ne))))}
 if(P.k==='link'){P.ln.setAttribute('x1',P.sx);P.ln.setAttribute('y1',P.sy);P.ln.setAttribute('x2',e.clientX-P.ir.left+P.inn.parentElement.scrollLeft*0);P.ln.setAttribute('y2',e.clientY-P.ir.top);document.querySelectorAll('.lt').forEach(q=>q.classList.remove('lt'));const el=document.elementFromPoint(e.clientX,e.clientY);const tb=el&&el.closest('[data-eb]');if(tb&&tb.dataset.eb!==P.id)tb.classList.add('lt')}});
document.addEventListener('pointerup',e=>{if(!P)return;const p=P;P=null;tip(null,'');const I=p.I;
 if(p.k==='split'){if(p.p)I.ui.split=Math.round(p.p);return S.render()}
 if(p.k==='row'||p.k==='grp'){document.querySelectorAll('.ins').forEach(x=>x.classList.remove('ins'));if(!p.mv||!p.to)return;const d=data(I);
  if(p.k==='grp'){const tg=p.to.dataset.grow||(byId(I,p.to.dataset.row)||{}).g;if(!tg||tg===p.id)return;mut(I,()=>{const i=d.groups.findIndex(g=>g.id===p.id);const g=d.groups.splice(i,1)[0];d.groups.splice(d.groups.findIndex(x=>x.id===tg),0,g)});return S.render()}
  const a=byId(I,p.id);let gi=p.to.dataset.grow,before=p.to.dataset.row;if(before===p.id)return;
  mut(I,()=>{d.acts.splice(d.acts.indexOf(a),1);if(gi!=null){if(I.ui.group==='wbs')a.g=gi;const f=d.acts.findIndex(x=>x.g===gi);d.acts.splice(f<0?d.acts.length:f,0,a)}else{const b=d.acts.find(x=>x.id===before);if(I.ui.group==='wbs'&&b.g!==a.g){a.g=b.g;a.ws=b.ws}d.acts.splice(d.acts.indexOf(b),0,a)}});S.toast(L('نُقل الصف — المنطق والتواريخ لم تتغيّر','Row moved — logic and dates unchanged'));return S.render()}
 const sel=()=>{I.ui.sel={id:p.id,k:(I.ui.sel&&I.ui.sel.k)||'n'};I.ui.panel=true;I.ui.edit=null;I.ui.multi=[]};
 if(p.k==='click'||!p.mv){if(p.ln)p.ln.parentNode.remove();sel();return S.render()}
 if(p.k==='move'&&p.dd){const bb=I.cfg.bar(p.a);const ns=S.onOrNext(S.addD(bb.s,p.dd));if(ns<p.a.minStart){const q=p.a.drv;S.toast(q?L('لا يبدأ قبل انتهاء السابق ','Cannot start before predecessor ')+q+L(' ('+S.fmt(byId(I,q).pe)+')',' finishes ('+S.fmt(byId(I,q).pe)+')'):L('لا يبدأ قبل بداية الجدول','Cannot start before the schedule start'),'amber');sel();return S.render()}mut(I,()=>{p.a.pin=ns<=p.a.minStart?null:ns});sel();return S.render()}
 if(p.k==='end'&&p.dd){const bb=I.cfg.bar(p.a);const ne=S.addD(bb.e,p.dd);mut(I,()=>{p.a.dur=Math.max(1,S.wdays(bb.s,ne))});sel();return S.render()}
 if(p.k==='link'){p.ln&&p.ln.parentNode.remove();document.querySelectorAll('.lt').forEach(q=>q.classList.remove('lt'));const el=document.elementFromPoint(e.clientX,e.clientY);const tb=el&&el.closest('[data-eb]');if(tb&&tb.dataset.eb!==p.id){const to=byId(I,tb.dataset.eb);const err=mut(I,()=>I.cfg.link(p.id,to));S.toast(err||L('أُنشئت علاقة ','Linked ')+p.id+' → '+to.id+' FS',err?'red':null)}return S.render()}
 S.render()});
S.reach=(acts,from,to)=>{const stck=[from],seen={};while(stck.length){const x=stck.pop();if(x===to)return true;if(seen[x])continue;seen[x]=1;acts.filter(a=>a.pred.some(p=>p[0]===x)).forEach(a=>stck.push(a.id))}return false};
})();
