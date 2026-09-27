// Submittals — Kanban view, sharing data/toolbar with list.js
(function(){
const LV=window.LV,V=LV.V,S=RS.S;const L=(e,a)=>S.lang==='ar'?a:e;const esc=RS.esc;
LV.mode='kanban';
const COLS=['draft','internal','resub','pending','approved','rejected'];
const ROLE={ce:['Contractor Engineer','مهندس المقاول','blue'],cpm:['Contractor PM','مدير مشروع المقاول','violet'],cons:['Consultant','الاستشاري','green'],coe:['Consultant Engineer','مهندس الاستشاري','green'],copm:['Consultant PM','مدير مشروع الاستشاري','cyan']};
const STROLES={draft:[],internal:['ce','cpm'],resub:['ce','cpm'],pending:['coe','copm'],approved:[],rejected:['coe','copm']};
{const cnt={};LV.rows.forEach(r=>{const rl=STROLES[r.st];cnt[r.st]=(cnt[r.st]||0)+1;r.role=rl.length?rl[cnt[r.st]%rl.length]:null})}
V.kopen=V.kopen||{};
function roleOf(r){const rl=STROLES[r.st];return rl.includes(r.role)?r.role:rl[0]}
function card(r){const d=LV.DISC[r.disc],c=r.code&&LV.CODE[r.code];const p=LV.PEOPLE[r.owner];
 const end=c?`<span class="chip" style="height:22px;background:var(--tone-${c[0]}-${c[1]?'solid':'tint'});color:${c[1]?'#fff':`var(--tone-${c[0]}-fg)`}"><span class="ti ${c[2]}"></span>Code ${r.code}</span>`:r.rev!=='R0'?`<span class="chip" style="height:22px;background:var(--rev-pill-bg);color:var(--rev-pill-fg);font-weight:700">${r.rev}</span>`:'';
 return `<div class="kc${r.st==='approved'&&r.code==='A'?' ok':''}" draggable="true" data-card="${r.id}">
 <div class="r1"><i class="ti ti-file-text"></i>${r.id}<span class="end">${LV.cell(r,'days').split('</span>')[0]}</span>${end}</span></div>
 <div class="tt">${esc(LV.val(r,'title'))}</div>
 <div class="r2"><span class="chip" style="background:var(--tone-${d[2]}-tint);color:var(--tone-${d[2]}-fg)">${L(d[0],d[1])} (${r.disc})</span><span class="doc">${r.type}</span></div>
 <div class="loc"><span class="lt"><i class="ti ti-map"></i>${L('Zone','المنطقة')} ${r.zone}</span><span class="lt"><i class="ti ti-building"></i>${L('Building','المبنى')} ${r.bldg}</span><span class="lt"><i class="ti ti-stairs"></i>${L('Floor','الطابق')} ${r.floor}</span></div>
 <div class="r3"><span class="av" style="width:22px;height:22px;font-size:9px;background:${p[2]}">${RS.ini(p[0])}</span><span class="nm">${L(p[0],p[1])}</span><span class="dt"><i class="ti ti-calendar-event"></i>${LV.fmtD(r.created)}</span></div>
 </div>`}
function board(){const list=LV.filtered();const g=V.kgroup;
 return `<div class="kb">${COLS.map(st=>{const s=LV.ST[st];const rs=list.filter(r=>r.st===st);
  let inner='';
  if(!rs.length)inner=`<div class="kempty">${L('No submittals','لا توجد تقديمات')}</div>`;
  else if(!STROLES[st].length){if(g){const grp={};rs.forEach(r=>{const k=LV.val(r,g);(grp[k]=grp[k]||[]).push(r)});inner=Object.entries(grp).map(([k,b])=>`<div class="klane">${esc(k)}<span class="gcnt">${b.length}</span></div>${b.map(card).join('')}`).join('')}else inner=`<div class="krb">${rs.map(card).join('')}</div>`}
  else inner=STROLES[st].map(rk=>{const a=rs.filter(r=>roleOf(r)===rk);if(!a.length)return '';const R=ROLE[rk],key=st+':'+rk,open=V.kopen[key]!==false;
   let cards;if(g){const grp={};a.forEach(r=>{const k=LV.val(r,g);(grp[k]=grp[k]||[]).push(r)});cards=Object.entries(grp).map(([k,b])=>`<div class="klane">${esc(k)}<span class="gcnt">${b.length}</span></div>${b.map(card).join('')}`).join('')}else cards=a.map(card).join('');
   return `<div class="krole${open?' open':''}"><button class="krh" data-krole="${key}" aria-expanded="${open}"><span class="rd" style="background:var(--tone-${R[2]}-solid)"></span>${L(R[0],R[1])}<span class="rc">${a.length}</span><i class="ti ti-chevron-down"></i></button>${open?`<div class="krb">${cards}</div>`:''}</div>`}).join('');
  return `<section class="kcol" data-colst="${st}"><div class="kch"><span class="d" style="background:var(--status-${s[2]}-dot)"></span>${L(s[0],s[1])}<span class="n">${rs.length}</span><button class="cb ter sm ic" title="${L('Add','إضافة')}"><i class="ti ti-plus"></i></button></div><div class="klist">${inner}</div></section>`}).join('')}</div>`}
LV.kview=()=>`${LV.toolbar('kanban')}${board()}${V.toast?`<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>`:''}`;
LV.kbind=(root)=>{let drag=null;
 root.addEventListener('click',e=>{const b=e.target.closest('[data-krole]');if(!b)return;e.stopPropagation();const k=b.dataset.krole;V.kopen[k]=V.kopen[k]===false;LV.render()},true);
 root.addEventListener('dragstart',e=>{const c=e.target.closest('.kc');if(!c)return;drag=c.dataset.card;c.classList.add('drag');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',drag)});
 root.addEventListener('dragover',e=>{if(!drag)return;const col=e.target.closest('.kcol');if(!col)return;e.preventDefault();root.querySelectorAll('.kcol.over').forEach(x=>x!==col&&x.classList.remove('over'));col.classList.add('over')});
 root.addEventListener('drop',e=>{if(!drag)return;const col=e.target.closest('.kcol');if(!col)return;e.preventDefault();const r=LV.rows.find(x=>x.id===drag);const to=col.dataset.colst;
  if(r&&r.st!==to){r.st=to;r.role=STROLES[to][0]||null;if(to!=='approved'&&to!=='rejected')r.code='';else if(!r.code)r.code=to==='approved'?'A':'D';r.days=1;drag=null;LV.flash(L(`${r.id} moved to ${LV.ST[to][0]}`,`تم نقل ${r.id} إلى ${LV.ST[to][1]}`));return}drag=null;LV.render()});
 root.addEventListener('dragend',()=>{drag=null;root.querySelectorAll('.drag,.over').forEach(x=>x.classList.remove('drag','over'))});};
})();
