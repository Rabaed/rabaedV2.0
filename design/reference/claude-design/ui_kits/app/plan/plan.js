// Plan View core (PC) + desktop view (PV).
(function(){
const S=RS.S,{W,H,TYPE,STAT,STAGE,TR,CO,ROLES,ROOMS,FLOORS,PINS,SHEETS,drawing}=PD;
const L=(e,a)=>S.lang==='ar'?a:e;const esc=RS.esc;
/* ---------- core ---------- */
function shape(type,c,sz){sz=sz||24;const s=`fill:${c}`;const m=type==='snag'?`<circle class="s" cx="12" cy="12" r="9" style="${s}"></circle>`:type==='insp'?`<rect class="s" x="5" y="5" width="14" height="14" rx="2" transform="rotate(45 12 12)" style="${s}"></rect>`:`<rect class="s" x="3.5" y="3.5" width="17" height="17" rx="3" style="${s}"></rect>`;return `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" style="overflow:visible">${m}</svg>`}
const shapeFlat=(type,c,sz)=>shape(type,c,sz).replace(/class="s"/,'stroke="#fff" stroke-width="2"');
const sheetsFor=fl=>SHEETS[fl]||[{id:'A',no:'A-10'+(FLOORS.findIndex(f=>f.id===fl)),en:FLOORS.find(f=>f.id===fl).en+' Plan',ar:'مخطط '+FLOORS.find(f=>f.id===fl).ar,rev:'A',cur:1,date:'20 Aug 2026'}];
const onSheet=(p,fl,sh)=>SHEETS[fl]?p.rev===sh:true;
const canSee=(p,role)=>{const r=ROLES[role];return !r.co||p.co===r.co};
function filt(p,F){if(F.type.size&&!F.type.has(p.type))return false;if(F.tr.size&&!F.tr.has(p.tr))return false;if(F.st.size&&!F.st.has(p.st))return false;if(F.mine&&!p.mine)return false;if(F.dr!=='all'&&p.d>+F.dr)return false;return true}
const weeks=p=>Math.min(4,Math.max(1,Math.ceil(p.age/7)));
const ageDots=p=>`<span class="agd">${[1,2,3,4].map(i=>`<i class="${i<=weeks(p)?'on':''}"></i>`).join('')}<em>${p.age<7?L(p.age+' days','منذ '+p.age+' أيام'):L(Math.floor(p.age/7)+(Math.floor(p.age/7)===1?' week':' weeks'),Math.floor(p.age/7)+' أسابيع')}${p.age>=21?L(' at this step',' في هذه الخطوة'):''}</em></span>`;
const stc=st=>`<span class="stc" style="background:${STAT[st].t};color:${STAT[st].f}"><i></i>${L(STAT[st].en,STAT[st].ar)}</span>`;
const trc=tr=>`<span class="chip" style="height:22px;font-size:11.5px;background:var(--tone-${TR[tr][2]}-tint);color:var(--tone-${TR[tr][2]}-fg)">${L(TR[tr][0],TR[tr][1])}</span>`;
const coAv=co=>`<span class="av" style="background:${CO[co][2]}">${RS.ini(CO[co][0])}</span>`;
const roomAt=(x,y)=>ROOMS.filter(r=>x>=r.r[0]&&x<=r.r[0]+r.r[2]&&y>=r.r[1]&&y<=r.r[1]+r.r[3]).sort((a,b)=>a.r[2]*a.r[3]-b.r[2]*b.r[3])[0];
const RANK={failed:0,open:1,review:2,draft:3,closed:4};
function cluster(pins,k,R){const out=[];pins.forEach(p=>{const sx=p.x*k,sy=p.y*k;const c=out.find(c=>Math.hypot(c.sx-sx,c.sy-sy)<R);if(c){c.p.push(p);c.sx=(c.sx*(c.p.length-1)+sx)/c.p.length;c.sy=(c.sy*(c.p.length-1)+sy)/c.p.length}else out.push({sx,sy,p:[p]})});return out}
function badges(fl,role){const ps=PINS[fl].filter(p=>canSee(p,role));const c={os:ps.filter(p=>p.type==='snag'&&p.st==='open').length,sn:ps.filter(p=>p.type==='snag').length,ins:ps.filter(p=>p.type==='insp').length,com:ps.filter(p=>p.type==='com').length,fail:ps.filter(p=>p.st==='failed').length,old:ps.filter(p=>p.age>=21&&p.st!=='closed').length};return c}
window.PC={shape,shapeFlat,sheetsFor,onSheet,canSee,filt,weeks,ageDots,stc,trc,coAv,roomAt,RANK,cluster,badges};
/* ---------- desktop ---------- */
const qs=new URLSearchParams(location.search);
const V={fl:FLOORS.some(f=>f.id===qs.get('fl'))?qs.get('fl'):'02',sheet:null,role:'admin',F:{type:new Set(),tr:new Set(),st:new Set(),mine:false,dr:'all'},list:true,sel:null,k:1,tx:0,ty:0,auto:true,adding:false,add:null,form:null,menu:null,toast:null,tablet:false};
V.sheet=sheetsFor(V.fl).find(s=>s.cur).id;
const fl=()=>FLOORS.find(f=>f.id===V.fl);const sheet=()=>sheetsFor(V.fl).find(s=>s.id===V.sheet);
const vis=()=>PINS[V.fl].filter(p=>canSee(p,V.role)&&onSheet(p,V.fl,V.sheet)&&filt(p,V.F));
const fname=f=>L(f.en,f.ar);
function fsel(key,label,opts){const set=V.F[key];const n=set.size;return `<span class="rel"><button class="cb fbtn${n?' set':''}" data-menu="f-${key}">${label}<span class="v">${n?': '+(n===1?opts.find(o=>set.has(o[0]))[1]:n):''}</span><i class="ti ti-chevron-down"></i></button>${V.menu==='f-'+key?`<div class="pop" data-stop style="min-width:230px"><h6>${label}</h6>${opts.map(o=>`<button class="mi${set.has(o[0])?' on':''}" data-fk="${key}:${o[0]}">${o[2]||''}${o[1]}${set.has(o[0])?'<i class="ti ti-check ck"></i>':''}</button>`).join('')}${n?`<div class="sep"></div><button class="mi" data-fclr="${key}">${L('Clear','مسح')}</button>`:''}</div>`:''}</span>`}
function top(){const f=fl(),i=FLOORS.indexOf(f),sh=sheet(),segs=[['floor','ti-stairs',L('Floor','الطوابق')],['map','ti-map',L('Map','الخريطة')],['plan','ti-vector',L('Plan','المخطط')]];
 const up=FLOORS[i-1],dn=FLOORS[i+1];
 return `<div class="pv-bar"><span class="segv">${segs.map(s=>`<button class="${s[0]==='plan'?'on':''}" data-view="${s[0]}"><i class="ti ${s[1]}"></i>${s[2]}</button>`).join('')}</span>
 <nav class="bc"><span>${L('Dubai Marina Tower – Phase 2','برج دبي مارينا – المرحلة ٢')}</span><i class="ti ti-chevron-right"></i><span>${L('Tower 1','البرج ١')}</span><i class="ti ti-chevron-right"></i></nav>
 <span class="flsw"><button class="cb ter sm ic" ${dn?`data-fl="${dn.id}" title="${fname(dn)}"`:'disabled'}><i class="ti ti-chevron-down"></i></button><b>${fname(f)}</b><button class="cb ter sm ic" ${up?`data-fl="${up.id}" title="${fname(up)}"`:'disabled'}><i class="ti ti-chevron-up"></i></button></span>
 <span class="rel"><button class="dsel" data-menu="sheet"><i class="ti ti-file-text" style="color:var(--ui-muted)"></i><code>${sh.no}</code>${L(sh.en,sh.ar)} – Rev ${sh.rev}${sh.cur?`<span class="cur">${L('current','الحالي')}</span>`:`<span class="old">${L('superseded','مستبدل')}</span>`}<i class="ti ti-chevron-down" style="color:var(--ui-muted)"></i></button>${V.menu==='sheet'?`<div class="pop" data-stop style="min-width:320px"><h6>${L('Drawings · ','المخططات · ')}${fname(f)}</h6>${sheetsFor(V.fl).map(s=>{const n=PINS[V.fl].filter(p=>canSee(p,V.role)&&onSheet(p,V.fl,s.id)).length;return `<button class="mi${s.id===V.sheet?' on':''}" data-sheet="${s.id}"><i class="ti ti-file-text"></i><span><b style="font-weight:600">${s.no} – Rev ${s.rev}</b> ${s.cur?`<span class="cur" style="font-size:10.5px;font-weight:700;color:var(--tone-green-fg);background:var(--tone-green-tint);border-radius:4px;padding:0 5px">${L('current','الحالي')}</span>`:''}<br><span style="font-size:11.5px;color:var(--ui-muted)">${s.date} · ${n} ${L('pins','دبابيس')}</span></span>${s.id===V.sheet?'<i class="ti ti-check ck"></i>':''}</button>`}).join('')}<div class="sep"></div><button class="mi" data-fl="__elev"><i class="ti ti-building-skyscraper"></i>A-201 ${L('Tower 1 Elevation','واجهة البرج ١')}<small>${L('Use as floor picker','استخدمها لاختيار الطابق')}</small></button></div>`:''}</span>
 <span class="sp"></span>
 <span class="rel"><button class="vis" data-menu="role"><i class="ti ti-eye"></i>${L(ROLES[V.role].en,ROLES[V.role].ar)}<i class="ti ti-chevron-down"></i></button>${V.menu==='role'?`<div class="pop end" data-stop style="min-width:270px"><h6>${L('Demo · view as','عرض توضيحي · العرض بصفة')}</h6>${Object.entries(ROLES).map(([k,r])=>`<button class="mi${V.role===k?' on':''}" data-role="${k}" style="white-space:normal"><i class="ti ${k==='admin'?'ti-shield':'ti-user-circle'}"></i><span><b style="display:block;font-weight:600">${L(r.en,r.ar)}</b><span style="font-size:11.5px;color:var(--ui-muted)">${L(r.sub[0],r.sub[1])}</span></span></button>`).join('')}</div>`:''}</span>
 <span class="rel"><button class="cb ic" data-menu="demo"><i class="ti ti-dots"></i></button>${V.menu==='demo'?`<div class="pop end" data-stop><h6>${L('Demo states','حالات العرض')}</h6><button class="mi" data-act="d-pop"><i class="ti ti-map-pin"></i>${L('Open example pin','فتح الدبوس المثال')}</button><button class="mi" data-act="d-clu"><i class="ti ti-zoom-out"></i>${L('Zoomed out · clusters','تصغير · التجميع')}</button><button class="mi" data-act="d-add"><i class="ti ti-plus"></i>${L('Adding a new snag','إضافة ملاحظة جديدة')}</button><div class="sep"></div><a class="mi" href="plan-view-mobile.html"><i class="ti ti-device-mobile"></i>${L('Mobile version','نسخة الجوال')}<i class="ti ti-arrow-right ck"></i></a></div>`:''}</span></div>
 <div class="pv-bar fbar">${fsel('type',L('Type','النوع'),Object.keys(TYPE).map(k=>[k,L(TYPE[k].en,TYPE[k].ar),shapeFlat(k,'var(--ui-muted)',14)]))}${fsel('tr',L('Trade','التخصص'),Object.keys(TR).map(k=>[k,L(TR[k][0],TR[k][1]),`<i style="width:8px;height:8px;border-radius:3px;background:var(--tone-${TR[k][2]}-solid)"></i>`]))}${fsel('st',L('Stage','المرحلة'),Object.keys(STAT).filter(k=>k!=='draft').map(k=>[k,L(STAT[k].en,STAT[k].ar),`<i style="width:8px;height:8px;border-radius:50%;background:${STAT[k].c}"></i>`]))}
 <span class="rel"><button class="cb fbtn${V.F.dr!=='all'?' set':''}" data-menu="dr"><i class="ti ti-calendar"></i>${V.F.dr==='all'?L('Any date','أي تاريخ'):L('Last '+V.F.dr+' days','آخر '+V.F.dr+' يومًا')}<i class="ti ti-chevron-down"></i></button>${V.menu==='dr'?`<div class="pop" data-stop>${[['all',L('Any date','أي تاريخ')],['7',L('Last 7 days','آخر 7 أيام')],['14',L('Last 14 days','آخر 14 يومًا')],['30',L('Last 30 days','آخر 30 يومًا')]].map(o=>`<button class="mi${V.F.dr===o[0]?' on':''}" data-dr="${o[0]}">${o[1]}${V.F.dr===o[0]?'<i class="ti ti-check ck"></i>':''}</button>`).join('')}</div>`:''}</span>
 <span class="tgl" data-act="mine"><span class="swc${V.F.mine?' on':''}"></span>${L('Assigned to me','مسند إليّ')}</span>
 ${(V.F.type.size||V.F.tr.size||V.F.st.size||V.F.mine||V.F.dr!=='all')?`<button class="cb ter sm" data-act="clearf">${L('Clear all','مسح الكل')}</button>`:''}
 <span class="sp"></span>
 <button class="cb${V.list?' on':''}" data-act="list"><i class="ti ti-list"></i>${L('List','القائمة')}</button>
 <button class="cb pri${V.adding||V.add?' on':''}" data-act="add"><i class="ti ti-plus"></i>${L('Add pin','إضافة دبوس')}</button></div>`}
function plans(){const f=fl();const up=[...FLOORS];
 return `<aside class="pcard"><div class="pvh"><i class="ti ti-stack-2"></i>${L('Plans','المخططات')}<span class="r">${L('Tower 1','البرج ١')}</span></div>
 <div class="elev"><h6>${L('Elevation','الواجهة')}<code>A-201</code></h6>${up.map(x=>{const b=badges(x.id,V.role);return `<button class="${x.id==='rf'?'rf ':''}${x.id===V.fl?'on':''}" data-fl="${x.id}">${x.lv}${b.os+b.fail?'<i></i>':''}</button>${x.id==='gf'?'<div class="grd"></div>':''}`}).join('')}</div>
 <div class="flist">${FLOORS.map(x=>{const b=badges(x.id,V.role);return `<button class="fr${x.id===V.fl?' on':''}" data-fl="${x.id}"><span class="h"><b>${fname(x)}</b><code>${sheetsFor(x.id).find(s=>s.cur).no}</code></span><span class="bdg">${b.os?`<span class="bg" style="background:${STAT.open.c}" title="${L('Open snags','ملاحظات مفتوحة')}">${shapeFlat('snag','transparent',9)}${b.os}</span>`:''}${b.fail?`<span class="bg" style="background:${STAT.failed.c}" title="${L('Failed','راسب')}">${shapeFlat('insp','transparent',9)}${b.fail}</span>`:''}${b.ins-b.fail>0?`<span class="bg" style="background:${STAT.review.c}">${shapeFlat('insp','transparent',9)}${b.ins-b.fail}</span>`:''}${b.com?`<span class="bg" style="background:${STAT.draft.c}" title="${L('Comments','تعليقات')}">${shapeFlat('com','transparent',9)}${b.com}</span>`:''}${!(b.sn+b.ins+b.com)?`<span style="font-size:11.5px;color:var(--ui-faint)">${L('No items','لا توجد عناصر')}</span>`:''}</span>${b.old?`<span class="old"><span class="agd"><i class="on"></i><i class="on"></i><i class="on"></i><i></i></span>${b.old} ${L('at their step 3+ weeks','في خطوتها منذ 3+ أسابيع')}</span>`:''}</button>`}).join('')}</div></aside>`}
function pinsHtml(){const ps=vis();const cl=cluster(ps,V.k,26);const drafts=V.add?`<div class="pin draft new" style="left:${V.add.x}px;top:${V.add.y}px"><span class="g">${shape(V.add.type||'snag','var(--btn-pri)')}</span></div>`:'';
 return cl.map(c=>{if(c.p.length===1){const p=c.p[0];return `<div class="pin${V.sel===p.id?' sel':''}${p.fresh?' new':''}" data-pin="${p.id}" style="left:${p.x}px;top:${p.y}px"><span class="g">${shape(p.type,STAT[p.st].c)}${p.age>=21&&p.st!=='closed'?'<span class="old"></span>':''}</span></div>`}
  const w=c.p.slice().sort((a,b)=>RANK[a.st]-RANK[b.st])[0];return `<div class="clu" data-clu="${c.sx/V.k},${c.sy/V.k}" style="left:${c.sx/V.k}px;top:${c.sy/V.k}px;--c:${STAT[w.st].c}"><span>${c.p.length}</span></div>`}).join('')+drafts}
function popHtml(){const p=V.sel&&PINS[V.fl].find(x=>x.id===V.sel);if(!p||V.add)return '';const room=ROOMS.find(r=>r.id===p.room);
 return `<div class="ppop" id="ppop" data-stop><div class="ph">${shape(p.type,STAT[p.st].c,22)}<div class="tx"><code>${p.no}</code><b>${esc(L(p.t[0],p.t[1]))}</b></div><button class="cb ter sm ic x" data-act="desel"><i class="ti ti-x"></i></button></div>
 <div class="pb"><div class="row">${stc(p.st)}<span style="font-size:12px;color:var(--ui-muted)">${L(STAGE[p.st][0],STAGE[p.st][1])}</span></div>
 <div class="kv"><span>${L('Type','النوع')}</span><b>${L(TYPE[p.type].en,TYPE[p.type].ar)}</b><span>${L('Trade','التخصص')}</span><b>${trc(p.tr)}</b><span>${L('Assigned to','مسند إلى')}</span><b>${coAv(p.co)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${L(CO[p.co][0],CO[p.co][1])}</span></b><span>${L('Location','الموقع')}</span><b>${fname(fl())} · ${L(room.en,room.ar)}</b><span>${L('Age','العمر')}</span><b>${ageDots(p)}</b></div>
 <div class="thumb">${p.photos?`<i class="ti ti-photo" style="font-size:18px"></i>${L('Site photo','صورة الموقع')}<span class="n">${p.photos}</span>`:`<i class="ti ti-photo-off"></i>${L('No photos','لا توجد صور')}`}${p.img?`<img src="${p.img}" alt="">`:''}</div></div>
 <div class="pf"><button class="cb sm" data-act="locate"><i class="ti ti-focus-2"></i>${L('Centre','توسيط')}</button><button class="cb sm pri" data-open="${p.id}"><i class="ti ti-external-link"></i>${L('Open','فتح')}</button></div></div>`}
function typePick(){if(!V.add||V.add.step!=='type')return '';return `<div class="tpick" id="tpick" data-stop><h6>${L('What are you adding?','ماذا تضيف؟')}</h6>${Object.keys(TYPE).map(k=>`<button data-ptype="${k}">${shape(k,k==='snag'?STAT.open.c:k==='insp'?STAT.review.c:STAT.draft.c,18)}${L(TYPE[k].en,TYPE[k].ar)}<small>${TYPE[k].code}</small></button>`).join('')}<div class="sep" style="height:1px;background:var(--ui-border-2);margin:4px"></div><button data-act="canceladd"><i class="ti ti-x" style="font-size:16px;color:var(--ui-muted)"></i>${L('Cancel','إلغاء')}</button></div>`}
function canvas(){const sh=sheet(),total=PINS[V.fl].filter(p=>canSee(p,V.role)).length,here=PINS[V.fl].filter(p=>canSee(p,V.role)&&onSheet(p,V.fl,V.sheet)).length;
 return `<section class="pv-canvas" dir="ltr"><div class="pv-stage${V.adding?' adding':''}" id="pstage"><div class="pv-world" id="pworld">${drawing(sh)}<div class="pins" id="pins">${pinsHtml()}</div></div>${popHtml()}${typePick()}</div>
 <div class="pv-sheet glass"><i class="ti ti-file-text"></i><code>${sh.no}</code>Rev ${sh.rev} · ${here} ${L('pins','دبابيس')}</div>
 ${V.adding?`<div class="pv-hint"><i class="ti ti-map-pin"></i>${L('Click a point on the plan to drop a pin','انقر على نقطة في المخطط لوضع دبوس')}<button class="cb sm" data-act="canceladd" style="background:rgba(255,255,255,.12);color:#fff">${L('Cancel','إلغاء')}</button></div>`:!sh.cur?`<div class="pv-warn"><i class="ti ti-alert-triangle"></i>${L(`Superseded sheet · ${total-here} pins live on the current revision`,`مخطط مستبدل · ${total-here} دبابيس على المراجعة الحالية`)}<button class="cb sm" data-sheet="${sheetsFor(V.fl).find(s=>s.cur).id}">${L('Go to Rev C','الانتقال إلى Rev C')}</button></div>`:''}
 <div class="pv-leg glass" dir="${S.lang==='ar'?'rtl':'ltr'}">${Object.keys(TYPE).map(k=>`<span>${shapeFlat(k,'#6a6e7a',13)}<span class="lb">${L(TYPE[k].en,TYPE[k].ar)}</span></span>`).join('')}<span class="sep"></span>${['open','review','failed','closed'].map(k=>`<span><i class="d" style="background:${STAT[k].c}"></i><span class="lb">${L(STAT[k].en,STAT[k].ar)}</span></span>`).join('')}<span class="sep"></span><span><span class="agd"><i class="on"></i><i class="on"></i><i></i><i></i></span><span class="lb">${L('Age in weeks','العمر بالأسابيع')}</span></span></div>
 <div class="pv-ctl glass"><button data-zoom="out" title="${L('Zoom out','تصغير')}"><i class="ti ti-zoom-out"></i></button><span class="zl" id="pzl">100%</span><button data-zoom="in" title="${L('Zoom in','تكبير')}"><i class="ti ti-zoom-in"></i></button><button data-zoom="fit" title="${L('Fit','ملاءمة')}"><i class="ti ti-maximize"></i></button></div></section>`}
function listP(){const ps=vis().sort((a,b)=>RANK[a.st]-RANK[b.st]||b.age-a.age);const c={open:0,failed:0,review:0,closed:0};ps.forEach(p=>c[p.st]=(c[p.st]||0)+1);
 return `<aside class="pcard"><div class="pvh"><i class="ti ti-list"></i>${L('Pinned items','العناصر المثبتة')}<span class="r">${ps.length}</span></div><div class="lsum">${['open','failed','review','closed'].filter(k=>c[k]).map(k=>`<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${STAT[k].c};margin-inline-end:5px"></i>${L(STAT[k].en,STAT[k].ar)} <b>${c[k]}</b></span>`).join('')}</div>
 <div class="ilist">${ps.length?ps.map(p=>`<div class="ir${V.sel===p.id?' sel':''}" data-row="${p.id}">${shape(p.type,STAT[p.st].c,18)}<div class="tx"><b>${esc(L(p.t[0],p.t[1]))}</b><div class="mt"><code>${p.no}</code><span>${L(TR[p.tr][0],TR[p.tr][1])}</span><span>·</span><span>${L(ROOMS.find(r=>r.id===p.room).en,ROOMS.find(r=>r.id===p.room).ar)}</span></div></div><div class="r">${stc(p.st)}<span class="agd">${[1,2,3,4].map(i=>`<i class="${i<=weeks(p)?'on':''}"></i>`).join('')}</span></div></div>`).join(''):`<div class="none">${L('No pins match these filters.','لا توجد دبابيس مطابقة للتصفية.')}</div>`}</div></aside>`}
function formP(){const a=V.add,fm=V.form,room=roomAt(a.x,a.y),sh=sheet();const r=ROLES[V.role];const cos=Object.keys(CO).filter(k=>!r.co||k===r.co);
 return `<aside class="pcard slidein"><div class="pvh">${shape(a.type,a.type==='snag'?STAT.open.c:a.type==='insp'?STAT.review.c:STAT.draft.c,18)}${L('New ','جديد: ')}${L(TYPE[a.type].en,TYPE[a.type].ar)}<span class="r"><button class="cb ter sm ic" data-act="canceladd"><i class="ti ti-x"></i></button></span></div>
 <div class="form">
 <div class="fld2"><label>${L('Location','الموقع')}</label><div class="locs"><span class="lc"><i class="ti ti-building-skyscraper"></i>${L('Tower 1','البرج ١')}</span><span class="lc"><i class="ti ti-stairs"></i>${fname(fl())}</span>${room?`<span class="lc"><i class="ti ti-map-pin"></i>${L(room.en,room.ar)}</span>`:''}<span class="lc"><i class="ti ti-file-text"></i>${sh.no} Rev ${sh.rev}</span></div></div>
 <div class="fld2"><label>${L('Title','العنوان')} <span class="rq">*</span></label><input id="ftitle" class="${fm.err?'err':''}" value="${esc(fm.title)}" placeholder="${L('e.g. Cable tray not bonded','مثال: حامل الكابلات غير موصول')}"></div>
 <div class="fld2"><label>${L('Trade','التخصص')}</label><div class="chipsel">${Object.keys(TR).map(k=>`<button class="${fm.tr===k?'on':''}" data-ftr="${k}"><i class="d" style="background:var(--tone-${TR[k][2]}-solid)"></i>${L(TR[k][0],TR[k][1])}</button>`).join('')}</div></div>
 <div class="fld2"><label>${L('Assign to','إسناد إلى')}</label><select id="fco">${cos.map(k=>`<option value="${k}"${fm.co===k?' selected':''}>${L(CO[k][0],CO[k][1])}</option>`).join('')}</select></div>
 <div class="fld2"><label>${L('Description','الوصف')}</label><textarea id="fdesc" rows="3" placeholder="${L('What’s wrong, and what needs to happen?','ما المشكلة وما المطلوب؟')}">${esc(fm.desc)}</textarea></div>
 <div class="fld2"><label>${L('Photos','الصور')}</label><div class="photos">${fm.photos.map(src=>`<img class="ph-img" src="${src}" alt="">`).join('')}<button class="ph-add" data-act="photo"><i class="ti ti-camera"></i>${L('Add photo','إضافة صورة')}</button></div></div>
 </div><div class="fft"><button class="cb" data-act="canceladd">${L('Cancel','إلغاء')}</button><button class="cb pri" data-act="create"><i class="ti ti-check"></i>${L('Create ','إنشاء ')}${L(TYPE[a.type].en.split(' ')[0].toLowerCase(),TYPE[a.type].ar)}</button></div></aside>`}
function view(){const side=V.add&&V.add.step==='form'?formP():V.list?listP():'';
 return `${top()}<div class="pv-body${side?'':' nolist'}">${plans()}${canvas()}${side}</div>${V.toast?`<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>`:''}`}
/* ---------- transform ---------- */
let raf=0;
function applyT(){const w=document.getElementById('pworld');if(!w)return;w.style.transform=`translate(${V.tx}px,${V.ty}px) scale(${V.k})`;w.style.setProperty('--inv',1/V.k);const z=document.getElementById('pzl');if(z)z.textContent=Math.round(V.k*100)+'%';
 cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{const p=document.getElementById('pins');if(p)p.innerHTML=pinsHtml();place()})}
function place(){const st=document.getElementById('pstage');if(!st)return;const r=st.getBoundingClientRect();
 const put=(el,x,y)=>{if(!el)return;const sx=V.tx+x*V.k,sy=V.ty+y*V.k,w=el.offsetWidth,h=el.offsetHeight;let left=sx+22,top=sy-40;if(left+w>r.width-10)left=sx-w-22;if(left<10)left=10;if(top+h>r.height-10)top=r.height-h-10;if(top<10)top=10;el.style.left=left+'px';el.style.top=top+'px'};
 const p=V.sel&&PINS[V.fl].find(x=>x.id===V.sel);if(p)put(document.getElementById('ppop'),p.x,p.y);if(V.add)put(document.getElementById('tpick'),V.add.x,V.add.y)}
function fit(){const s=document.getElementById('pstage');if(!s)return;const r=s.getBoundingClientRect();if(!r.width)return;V.k=Math.min(r.width/W,r.height/H)*.96;V.tx=(r.width-W*V.k)/2;V.ty=(r.height-H*V.k)/2;V.auto=true;applyT()}
function zoomAt(f,cx,cy){const k2=Math.max(.25,Math.min(4,V.k*f));V.tx=cx-(cx-V.tx)*(k2/V.k);V.ty=cy-(cy-V.ty)*(k2/V.k);V.k=k2;V.auto=false;applyT()}
function center(x,y,k){const s=document.getElementById('pstage').getBoundingClientRect();if(k)V.k=k;V.tx=s.width/2-x*V.k;V.ty=s.height/2-y*V.k;V.auto=false;applyT()}
const toWorld=e=>{const r=document.getElementById('pstage').getBoundingClientRect();return [Math.round((e.clientX-r.left-V.tx)/V.k),Math.round((e.clientY-r.top-V.ty)/V.k)]};
let ro=null,roEl=null;
function after(){const s=document.getElementById('pstage');if(s&&s!==roEl){ro&&ro.disconnect();roEl=s;ro=new ResizeObserver(()=>{if(V.auto)fit();else place()});ro.observe(s)}if(V.auto)fit();else applyT()}
/* ---------- bind ---------- */
function bind(root,R){let tt;const flash=m=>{V.toast=m;R.inner();clearTimeout(tt);tt=setTimeout(()=>{V.toast=null;R.inner()},2400)};
 const file=document.createElement('input');file.type='file';file.accept='image/*';file.multiple=true;file.style.display='none';document.body.appendChild(file);
 file.addEventListener('change',()=>{[...file.files].forEach(f=>{const rd=new FileReader();rd.onload=()=>{V.form.photos.push(rd.result);R.inner()};rd.readAsDataURL(f)});file.value=''});
 const startAdd=()=>{V.adding=true;V.add=null;V.sel=null;V.menu=null};
 const saveForm=()=>{if(!V.form)return;const t=document.getElementById('ftitle'),d=document.getElementById('fdesc'),c=document.getElementById('fco');if(t)V.form.title=t.value;if(d)V.form.desc=d.value;if(c)V.form.co=c.value};
 root.addEventListener('click',e=>{const b=e.target.closest('[data-menu],[data-fk],[data-fclr],[data-dr],[data-role],[data-act],[data-view],[data-fl],[data-sheet],[data-zoom],[data-ptype],[data-ftr],[data-open],[data-row]');
  if(!b){if(V.menu&&!e.target.closest('[data-stop]')){V.menu=null;R.inner()}return}
  if(b.closest('.hd,.tabs,.sb'))return;const d=b.dataset;saveForm();
  if(d.menu){V.menu=V.menu===d.menu?null:d.menu;return R.inner()}
  if(d.fk){const [k,v]=d.fk.split(':');V.F[k].has(v)?V.F[k].delete(v):V.F[k].add(v);return R.inner()}
  if(d.fclr){V.F[d.fclr]=new Set();V.menu=null;return R.inner()}
  if(d.dr){V.F.dr=d.dr;V.menu=null;return R.inner()}
  if(d.role){V.role=d.role;V.menu=null;V.sel=null;return R.inner()}
  if(d.view){if(d.view==='floor')location.href='floor-view.html';if(d.view==='map')location.href='map-view.html';return}
  if(d.fl){if(d.fl==='__elev'){V.menu=null;return flash(L('Tip: the elevation in the Plans panel picks a floor','تلميح: الواجهة في لوحة المخططات تختار الطابق'))}V.fl=d.fl;V.sheet=sheetsFor(V.fl).find(s=>s.cur).id;V.sel=null;V.add=null;V.adding=false;V.auto=true;V.menu=null;history.replaceState(null,'','?fl='+d.fl);return R.inner()}
  if(d.sheet){V.sheet=d.sheet;V.menu=null;V.sel=null;return R.inner()}
  if(d.zoom){const s=document.getElementById('pstage').getBoundingClientRect();if(d.zoom==='fit')return fit();return zoomAt(d.zoom==='in'?1.3:1/1.3,s.width/2,s.height/2)}
  if(d.ptype){V.add.type=d.ptype;V.add.step='form';const rm=roomAt(V.add.x,V.add.y);V.form={title:'',tr:d.ptype==='insp'?'EL':'EL',co:ROLES[V.role].co||'tmc',desc:'',photos:[],err:false};return R.inner()}
  if(d.ftr){V.form.tr=d.ftr;return R.inner()}
  if(d.open){const p=PINS[V.fl].find(x=>x.id===d.open);return flash(L(`Opening ${p.no}…`,`جارٍ فتح ${p.no}…`))}
  if(d.row){const p=PINS[V.fl].find(x=>x.id===d.row);V.sel=p.id;R.inner();if(V.k<.9)center(p.x,p.y,1.2);else center(p.x,p.y);return}
  const a=d.act;
  if(a==='desel'){V.sel=null;return R.inner()}
  if(a==='locate'){const p=PINS[V.fl].find(x=>x.id===V.sel);return center(p.x,p.y,Math.max(V.k,1.4))}
  if(a==='mine'){V.F.mine=!V.F.mine;return R.inner()}
  if(a==='clearf'){V.F={type:new Set(),tr:new Set(),st:new Set(),mine:false,dr:'all'};return R.inner()}
  if(a==='list'){V.list=!V.list;V.auto=V.auto;return R.inner()}
  if(a==='add'){if(V.adding||V.add){V.adding=false;V.add=null;return R.inner()}startAdd();return R.inner()}
  if(a==='canceladd'){V.adding=false;V.add=null;V.form=null;return R.inner()}
  if(a==='photo')return file.click();
  if(a==='create'){if(!V.form.title.trim()){V.form.err=true;R.inner();document.getElementById('ftitle').focus();return}
   const co=V.form.co,tr=V.form.tr,type=V.add.type,key=CO[co][3]+'-'+tr+'-'+TYPE[type].code;const n=PINS[V.fl].filter(p=>p.no.startsWith('TWR-'+key)).length+15;
   const p={id:V.fl+'-n'+Date.now(),fl:V.fl,no:'TWR-'+key+'-'+String(n).padStart(3,'0'),type,st:'open',tr,co,room:(roomAt(V.add.x,V.add.y)||ROOMS[5]).id,x:V.add.x,y:V.add.y,t:[V.form.title,V.form.title],age:0,photos:V.form.photos.length,img:V.form.photos[0],mine:true,rev:V.sheet,d:0,fresh:1};
   PINS[V.fl].push(p);V.add=null;V.adding=false;V.form=null;V.sel=p.id;V.list=true;return flash(L(`${p.no} created`,`تم إنشاء ${p.no}`))}
  if(a==='d-pop'){V.menu=null;V.fl='02';V.sheet='C';V.sel=PINS['02'][0].id;R.inner();const s=document.getElementById('pstage').getBoundingClientRect();return center(712,520,Math.max(Math.min(s.width/W,s.height/H)*1.6,.6))}
  if(a==='d-clu'){V.menu=null;V.sel=null;R.inner();const s=document.getElementById('pstage').getBoundingClientRect();V.k=Math.min(s.width/W,s.height/H)*.62;V.tx=(s.width-W*V.k)/2;V.ty=(s.height-H*V.k)/2;V.auto=false;return applyT()}
  if(a==='d-add'){V.menu=null;V.adding=false;V.sel=null;V.add={x:560,y:392,step:'form',type:'snag'};V.form={title:'Door closer missing',tr:'AR',co:ROLES[V.role].co||'dry',desc:'',photos:[],err:false};return R.inner()}
 });
 root.addEventListener('input',e=>{if(e.target.id==='ftitle'&&V.form){V.form.title=e.target.value;if(V.form.err&&e.target.value){V.form.err=false;e.target.classList.remove('err')}}});
 root.addEventListener('mouseover',e=>{const r=e.target.closest('[data-row]'),p=e.target.closest('[data-pin]');root.querySelectorAll('.pin.hl,.ir.hl').forEach(x=>x.classList.remove('hl'));const id=r?r.dataset.row:p?p.dataset.pin:null;if(!id)return;root.querySelector(`[data-pin="${id}"]`)?.classList.add('hl');root.querySelector(`[data-row="${id}"]`)?.classList.add('hl')});
 let P=null;
 root.addEventListener('pointerdown',e=>{if(e.button!==0)return;const st=e.target.closest('#pstage');if(!st||e.target.closest('#ppop,#tpick'))return;P={x:e.clientX,y:e.clientY,tx:V.tx,ty:V.ty,moved:false,t:e.target}});
 addEventListener('pointermove',e=>{if(!P)return;const dx=e.clientX-P.x,dy=e.clientY-P.y;if(!P.moved&&Math.hypot(dx,dy)>4){P.moved=true;document.getElementById('pstage')?.classList.add('panning')}if(P.moved){V.tx=P.tx+dx;V.ty=P.ty+dy;V.auto=false;applyT()}});
 addEventListener('pointerup',e=>{if(!P)return;const p=P;P=null;document.getElementById('pstage')?.classList.remove('panning');if(p.moved)return;saveForm();
  if(V.adding){const [x,y]=toWorld(e);if(x<0||y<0||x>W||y>H)return;V.adding=false;V.add={x,y,step:'type',type:'snag'};return R.inner()}
  const c=p.t.closest&&p.t.closest('[data-clu]');if(c){const [x,y]=c.dataset.clu.split(',').map(Number);const s=document.getElementById('pstage').getBoundingClientRect();return zoomAt(2,V.tx+x*V.k,V.ty+y*V.k)}
  const pin=p.t.closest&&p.t.closest('[data-pin]');if(V.add&&V.add.step==='form'&&!pin){const [x,y]=toWorld(e);V.add.x=x;V.add.y=y;return R.inner()}
  V.sel=pin?pin.dataset.pin:null;if(!pin&&V.add&&V.add.step==='type')V.add=null;R.inner()});
 root.addEventListener('wheel',e=>{const st=e.target.closest('#pstage');if(!st||e.target.closest('#ppop'))return;e.preventDefault();const r=st.getBoundingClientRect();zoomAt(e.deltaY<0?1.12:1/1.12,e.clientX-r.left,e.clientY-r.top)},{passive:false});
 addEventListener('resize',()=>{if(V.auto)fit();else place()});
 document.addEventListener('keydown',e=>{if(e.target.closest&&e.target.closest('input,textarea,select'))return;if(e.key==='Escape'){V.adding=false;V.add=null;V.sel=null;V.menu=null;R.inner()}if(e.key==='+'||e.key==='=')document.querySelector('[data-zoom=in]')?.click();if(e.key==='-')document.querySelector('[data-zoom=out]')?.click();if(e.key==='n'||e.key==='N'){startAdd();R.inner()}});
}
window.PV={V,view,bind,after};
})();
