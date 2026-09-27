// Multiple View → Map View. Exposes window.MV {V, view, bind}.
(function(){
const S=RS.S,{ST,ORDER,TRADES,COS,TYPES,PHASES,ROLES,Z,LOCS}=MD;
const L=(e,a)=>S.lang==='ar'?a:e;const esc=RS.esc;const clone=o=>JSON.parse(JSON.stringify(o));
const KEY='rb-map-v1';const W=1000,H=640;
const sample=()=>Z.map(z=>({id:z.id,en:z.en,ar:z.ar,pts:clone(z.pts),m:clone(z.m),loc:z.loc,color:null}));
let saved=null;try{saved=JSON.parse(localStorage.getItem(KEY))}catch(e){}
let qv=(new URLSearchParams(location.search).get('v'))||'map';if(qv==='floor'){location.replace('floor-view.html');qv='map'}
const V={view:['floor','map','plan'].includes(qv)?qv:'map',role:'admin',f:{tr:'',type:'',co:'',ph:''},sel:null,exec:false,prevMode:null,edit:false,tool:'select',draft:[],
 layout:saved&&saved.layout||sample(),img:saved&&saved.img||null,empty:false,panelOpen:false,menu:null,picker:false,pq:'',k:1,tx:0,ty:0,auto:true,tablet:false,toast:null,dirty:false,backup:null};
const data=id=>Z.find(z=>z.id===id);
const nm=z=>L(z.en,z.ar);const short=z=>nm(z).split(' – ')[0];
const role=()=>ROLES[V.role];
function visible(it){const r=role();if(r.co&&!r.co.includes(it.co))return false;if(r.tr&&!r.tr.includes(it.tr))return false;
 const f=V.f;if(f.tr&&it.tr!==f.tr)return false;if(f.type&&it.type!==f.type)return false;if(f.co&&it.co!==f.co)return false;return true}
function counts(z){const d=data(z.id);const c={snag:0,failed:0,pending:0,passed:0,items:[]};if(!d)return c;d.items.filter(visible).forEach(it=>{c[it.kind]++;c.items.push(it)});c.open=c.snag+c.failed;c.total=c.items.length;return c}
function status(z,c){const d=data(z.id);if(!c.total)return 'ns';if(d&&d.done&&!c.snag&&!c.failed&&!c.pending)return 'done';if(c.failed>=2||c.snag>=4)return 'iss';if(c.snag||c.failed||c.pending>=3)return 'att';return 'ok'}
const isOff=z=>{const d=data(z.id);return V.f.ph&&(!d||d.ph!==V.f.ph)};
function model(){return V.layout.map(z=>{const c=counts(z);return {z,c,s:status(z,c),off:isOff(z)}})}
const col=(m)=>m.z.color||ST[m.s].c;
const why=(s,c)=>({ok:L(`${c.passed} inspections passed, nothing failing.`,`${c.passed} فحصًا ناجحًا، ولا يوجد فشل.`),att:L(`${c.snag} open snag${c.snag===1?'':'s'}, ${c.failed} failed inspection${c.failed===1?'':'s'}, ${c.pending} submittal${c.pending===1?'':'s'} pending.`,`${c.snag} ملاحظة مفتوحة، ${c.failed} فحص راسب، ${c.pending} تقديم معلّق.`),iss:L(`${c.snag} open snags and ${c.failed} failed inspections — above the Issues threshold.`,`${c.snag} ملاحظة مفتوحة و${c.failed} فحص راسب — فوق حدّ المشكلات.`),done:L('Every inspection passed and nothing is open.','اجتازت جميع الفحوصات ولا يوجد شيء مفتوح.'),ns:L('No Work Items you can see in this zone yet.','لا توجد عناصر عمل مرئية لك في هذه المنطقة بعد.')})[s];
/* ---------- toolbar ---------- */
function fsel(key,label,opts){const cur=V.f[key];const o=opts.find(x=>x[0]===cur);return `<span class="rel"><button class="cb fbtn${cur?' set':''}" data-menu="f-${key}">${label}<span class="v">${o?': '+o[1]:''}</span><i class="ti ti-chevron-down"></i></button>${V.menu==='f-'+key?`<div class="pop" data-stop><h6>${label}</h6><button class="mi${!cur?' on':''}" data-f="${key}:">${L('All','الكل')}${!cur?'<i class="ti ti-check ck"></i>':''}</button>${opts.map(x=>`<button class="mi${cur===x[0]?' on':''}" data-f="${key}:${x[0]}">${x[2]||''}${x[1]}${cur===x[0]?'<i class="ti ti-check ck"></i>':''}</button>`).join('')}</div>`:''}</span>`}
function toolbar(){
 if(V.edit)return `<div class="editbar"><b><i class="ti ti-pencil"></i>${L('Editing site layout','تحرير مخطط الموقع')}</b><span class="tools"><button class="cb sm ter${V.tool==='select'?' on':''}" data-tool="select" title="V"><i class="ti ti-arrows-maximize"></i>${L('Select & edit','تحديد وتعديل')}</button><button class="cb sm ter${V.tool==='draw'?' on':''}" data-tool="draw" title="P"><i class="ti ti-polygon"></i>${L('Draw zone','رسم منطقة')}</button></span><button class="cb sm" data-act="upload"><i class="ti ti-upload"></i>${V.img?L('Replace site map','استبدال خريطة الموقع'):L('Upload site map','رفع خريطة الموقع')}</button>${V.sel?`<button class="cb sm" data-act="delzone" style="color:var(--tone-red-fg)"><i class="ti ti-trash"></i>${L('Delete zone','حذف المنطقة')}</button>`:''}<span class="sp"></span><span style="font-size:12.5px;font-weight:600">${V.layout.length} ${L('zones','مناطق')}${V.dirty?' · '+L('unsaved','غير محفوظ'):''}</span><button class="cb sm ter" data-act="canceledit" style="color:inherit">${L('Cancel','إلغاء')}</button><button class="cb sm pri" data-act="save"><i class="ti ti-check"></i>${L('Save layout','حفظ المخطط')}</button></div>`;
 const vr=role(),tr=Object.keys(TRADES).filter(k=>!vr.tr||vr.tr.includes(k)),co=Object.keys(COS).filter(k=>!vr.co||vr.co.includes(k));
 const segs=[['floor','ti-stairs',L('Floor','الطوابق')],['map','ti-map',L('Map','الخريطة')],['plan','ti-vector',L('Plan','المخطط')]];
 return `<div class="mv-bar"><span class="segv">${segs.map(s=>`<button class="${V.view===s[0]?'on':''}" data-view="${s[0]}"><i class="ti ${s[1]}"></i>${s[2]}</button>`).join('')}</span>
 ${V.view==='map'&&!V.empty?`${fsel('tr',L('Trade','التخصص'),tr.map(k=>[k,L(TRADES[k][0],TRADES[k][1])]))}${fsel('type',L('Work Item Type','نوع العنصر'),Object.keys(TYPES).map(k=>[k,L(TYPES[k][0],TYPES[k][1])]))}${fsel('co',L('Company','الشركة'),co.map(k=>[k,L(COS[k][0],COS[k][1]),`<span class="av" style="width:18px;height:18px;font-size:8px;background:${COS[k][2]}">${RS.ini(COS[k][0])}</span>`]))}${fsel('ph',L('Phase','المرحلة'),Object.keys(PHASES).map(k=>[k,L(PHASES[k][0],PHASES[k][1])]))}${Object.values(V.f).some(Boolean)?`<button class="cb ter sm" data-act="clearf">${L('Clear','مسح')}</button>`:''}`:''}
 <span class="sp"></span>
 <span class="rel"><button class="vis" data-menu="role" title="${L('Counts include only what your company can see','تشمل الأرقام فقط ما يُسمح لشركتك برؤيته')}"><i class="ti ti-eye"></i>${L(vr.en,vr.ar)}<small>· ${L(vr.sub[0],vr.sub[1])}</small><i class="ti ti-chevron-down"></i></button>${V.menu==='role'?`<div class="pop end" data-stop style="min-width:300px"><h6>${L('Demo · view as','عرض توضيحي · العرض بصفة')}</h6>${Object.entries(ROLES).map(([k,r])=>`<button class="mi${V.role===k?' on':''}" data-role="${k}" style="white-space:normal"><i class="ti ${k==='admin'?'ti-shield':k==='owner'?'ti-building':'ti-user-circle'}"></i><span><b style="display:block;font-weight:600">${L(r.en,r.ar)}</b><span style="font-size:11.5px;color:var(--ui-muted)">${L(r.sub[0],r.sub[1])}</span></span></button>`).join('')}</div>`:''}</span>
 ${V.view==='map'&&!V.empty?`<span class="tgl" data-act="exec"><span class="swc${V.exec?' on':''}"></span>${L('Executive view','العرض التنفيذي')}</span>`:''}
 ${role().edit&&V.view==='map'&&!V.empty?`<button class="cb" data-act="edit"><i class="ti ti-pencil"></i>${L('Edit layout','تحرير المخطط')}</button>`:''}
 ${V.view==='map'&&!V.empty?`<button class="cb tbl-only${V.panelOpen?' on':''}" data-act="panel"><i class="ti ti-layout-dashboard"></i>${L('Overview','نظرة عامة')}</button>`:''}
 <span class="rel"><button class="cb ic" data-menu="demo" title="${L('Demo states','حالات العرض')}"><i class="ti ti-dots"></i></button>${V.menu==='demo'?`<div class="pop end" data-stop><h6>${L('Demo states','حالات العرض')}</h6><button class="mi" data-act="empty"><i class="ti ti-photo"></i>${L('Empty state','الحالة الفارغة')}</button><button class="mi${V.tablet?' on':''}" data-act="tablet"><i class="ti ti-device-tablet"></i>${L('Tablet preview (1024px)','معاينة الجهاز اللوحي')}${V.tablet?'<i class="ti ti-check ck"></i>':''}</button><div class="sep"></div><button class="mi" data-act="reset"><i class="ti ti-refresh"></i>${L('Reset sample layout','إعادة ضبط المخطط')}</button></div>`:''}</span>
 </div>`}
/* ---------- exec strip ---------- */
function kstrip(M){const A=M.filter(m=>!m.off),sum=k=>A.reduce((a,m)=>a+m.c[k],0);const good=A.filter(m=>m.s==='ok'||m.s==='done').length;
 const K=[[L('Zones on track','مناطق ضمن المسار'),`${good}<small> / ${A.length}</small>`,good/Math.max(1,A.length),'var(--tone-blue-solid)'],[L('Open snags','ملاحظات مفتوحة'),sum('snag')],[L('Failed inspections','فحوصات راسبة'),sum('failed')],[L('Submittals pending approval','تقديمات بانتظار الاعتماد'),sum('pending')],[L('Inspections passed','فحوصات ناجحة'),sum('passed')]];
 return `<div class="kstrip">${K.map(k=>`<div class="kbig"><span>${k[0]}</span><b>${k[1]}</b>${k[2]!=null?`<span class="bar"><i style="width:${Math.round(k[2]*100)}%;background:${k[3]}"></i></span>`:''}</div>`).join('')}</div>`}
/* ---------- canvas ---------- */
const pts=p=>p.map(x=>x.join(',')).join(' ');
const pc=(x,y)=>`left:${x/W*100}%;top:${y/H*100}%`;
function canvas(M){
 if(V.empty)return `<div class="mv-canvas"><div class="mv-empty">${emptyState()}</div></div>`;
 const selM=M.find(m=>m.z.id===V.sel);
 const polys=M.map(m=>{const s=m.s,c=col(m);const pat=s==='iss'?'url(#pt-iss)':s==='att'?'url(#pt-att)':'';return `<g class="zp ${s}${V.sel===m.z.id?' sel':''}${m.off?' off':''}${V.edit?' edit':''}" data-z="${m.z.id}"><polygon class="hal" points="${pts(m.z.pts)}"></polygon><polygon class="fil" points="${pts(m.z.pts)}" style="fill:${c}"></polygon>${pat?`<polygon class="pat" points="${pts(m.z.pts)}" fill="${pat}"></polygon>`:''}<polygon class="lin" points="${pts(m.z.pts)}" style="stroke:${c}"></polygon></g>`}).join('');
 const marks=M.map(m=>{const st=ST[m.s];return `<div class="mk${V.sel===m.z.id?' sel':''}${m.off?' off':''}" data-z="${m.z.id}" style="${pc(m.z.m[0],m.z.m[1])}"><span class="dot" style="background:${m.z.color||st.c}"><i class="ti ${st.ic}"></i>${m.c.open?`<span class="cn">${m.c.open}</span>`:''}</span><span class="nm">${esc(short(m.z))}</span></div>`}).join('');
 const vx=V.edit&&selM&&V.tool==='select'?selM.z.pts.map((p,i)=>`<span class="vx" data-vx="${i}" style="${pc(p[0],p[1])}"></span>`).join(''):'';
 const dr=V.draft.length?`<polygon class="draw-f" points="${pts(V.draft)}"></polygon><polyline class="draw-l" points="${pts(V.draft)}"></polyline><line id="dl" class="draw-l" x1="${V.draft.at(-1)[0]}" y1="${V.draft.at(-1)[1]}" x2="${V.draft.at(-1)[0]}" y2="${V.draft.at(-1)[1]}"></line>`:'';
 const dvx=V.draft.map((p,i)=>`<span class="vx${i===0?' first':''}" style="${pc(p[0],p[1])}"></span>`).join('');
 const cnt={};M.filter(m=>!m.off).forEach(m=>cnt[m.s]=(cnt[m.s]||0)+1);
 return `<div class="mv-canvas" dir="ltr"><div class="mv-stage${V.edit&&V.tool==='draw'?' draw':''}" id="stage"><div class="mv-world${selM&&!V.edit?' has-sel':''}" id="world">
  <div class="mv-base">${V.img?`<img src="${V.img}" alt="">`:`<span class="wm">${L('Sample site plan','مخطط موقع تجريبي')}</span>`}</div>
  <svg class="mv-svg" viewBox="0 0 ${W} ${H}"><defs><pattern id="pt-iss" patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(45)"><rect width="4" height="12" style="fill:var(--tone-red-solid)"></rect></pattern><pattern id="pt-att" patternUnits="userSpaceOnUse" width="12" height="12"><circle cx="6" cy="6" r="2" style="fill:var(--tone-orange-solid)"></circle></pattern></defs>${polys}${dr}</svg>
  <div class="mv-marks">${marks}${vx}${dvx}</div></div></div>
  ${!V.img?`<span class="mv-samp"><i class="ti ti-info-circle"></i>${L('Sample base — upload your masterplan in Edit layout','خلفية تجريبية — ارفع المخطط العام من تحرير المخطط')}</span>`:''}
  ${V.edit&&V.tool==='draw'?`<div class="mv-hint"><i class="ti ti-polygon"></i>${L('Click to add points','انقر لإضافة النقاط')} · ${L('click the first point or','انقر النقطة الأولى أو')} <kbd>Enter</kbd> ${L('to close','للإغلاق')} · <kbd>⌫</kbd> ${L('undo','تراجع')} · <kbd>Esc</kbd> ${L('cancel','إلغاء')}</div>`:''}
  <div class="mv-ctl"><div class="grp"><button data-zoom="in" title="${L('Zoom in','تكبير')}"><i class="ti ti-zoom-in"></i></button><button data-zoom="out" title="${L('Zoom out','تصغير')}"><i class="ti ti-zoom-out"></i></button></div><div class="grp"><button data-zoom="fit" title="${L('Fit to screen','ملاءمة الشاشة')}"><i class="ti ti-maximize"></i></button></div><span class="zl" id="zl">100%</span></div>
  <div class="mv-leg" dir="${S.lang==='ar'?'rtl':'ltr'}">${ORDER.map(k=>{const s=ST[k];return `<span class="lg-i"><span class="sw" style="background:${s.c}"><i class="ti ${s.ic}"></i></span><span class="lb">${L(s.en,s.ar)}</span><span class="n">${cnt[k]||0}</span><span class="tipx"><b>${L(s.en,s.ar)}</b>${L(s.den,s.dar)}</span></span>`}).join('')}</div>
  <div class="mv-tip" id="mvtip"></div></div>`}
function emptyState(){const adm=role().edit;
 return `<div class="emp"><span class="ic"><i class="ti ti-map"></i></span><h2>${adm?L('Upload a site map to get started','ارفع خريطة الموقع للبدء'):L('No site map yet','لا توجد خريطة للموقع بعد')}</h2><p>${adm?L('Use a masterplan or aerial render of Al Nakheel Villas Compound. You’ll draw zones on it and link each one to a Location, so everyone sees status by area.','استخدم المخطط العام أو صورة جوية لمجمع فلل النخيل. سترسم عليها المناطق وتربط كل منطقة بموقع، ليرى الجميع الحالة حسب المنطقة.'):L('Your Project Admin hasn’t uploaded a site map for this project. You’ll see zone statuses here once they do.','لم يرفع مسؤول المشروع خريطة الموقع بعد. ستظهر حالات المناطق هنا بمجرد رفعها.')}</p>
 ${adm?`<div class="drop" id="drop"><i class="ti ti-file-upload" style="font-size:24px;color:var(--ui-muted)"></i><span style="font-size:13px;color:var(--ui-text-2)">${L('Drag an image here, or','اسحب صورة إلى هنا، أو')}</span><span class="row"><button class="cb pri" data-act="upload"><i class="ti ti-upload"></i>${L('Upload site map','رفع خريطة الموقع')}</button><button class="cb" data-act="reset">${L('Use sample layout','استخدام المخطط التجريبي')}</button></span><span class="fmt">PNG · JPG · WEBP — ${L('up to 20 MB, at least 2000px wide','حتى 20 ميجابايت، وعرض 2000 بكسل على الأقل')}</span></div>
 <div class="steps"><div><span class="n">1</span>${L('Upload the masterplan or aerial image.','ارفع المخطط العام أو الصورة الجوية.')}</div><div><span class="n">2</span>${L('Draw a polygon around each Zone, Phase, Building or Villa cluster.','ارسم مضلعًا حول كل منطقة أو مرحلة أو مبنى أو مجموعة فلل.')}</div><div><span class="n">3</span>${L('Link each polygon to a Location — statuses fill in automatically.','اربط كل مضلع بموقع — تظهر الحالات تلقائيًا.')}</div></div>`:`<button class="cb" data-act="reset">${L('Show sample layout','عرض المخطط التجريبي')}</button>`}</div>`}
/* ---------- panels ---------- */
function tiles(c){return `<div class="tiles"><div class="tl${c.snag?' hot':''}"><b>${c.snag}</b><span><i class="ti ti-flag"></i>${L('Open snags','ملاحظات مفتوحة')}</span></div><div class="tl${c.failed?' hot':''}"><b>${c.failed}</b><span><i class="ti ti-circle-x"></i>${L('Failed inspections','فحوصات راسبة')}</span></div><div class="tl${c.pending>=3?' warm':''}"><b>${c.pending}</b><span><i class="ti ti-hourglass-high"></i>${L('Pending approval','بانتظار الاعتماد')}</span></div><div class="tl"><b>${c.passed}</b><span><i class="ti ti-circle-check"></i>${L('Inspections passed','فحوصات ناجحة')}</span></div></div>`}
const chipS=s=>`<span class="zs" style="background:${ST[s].t};color:${ST[s].f}"><i class="ti ${ST[s].ic}"></i>${L(ST[s].en,ST[s].ar)}</span>`;
const units=d=>d?`${d.units[0]} ${L(d.units[1],d.units[2])}`:L('Not linked to data yet','غير مرتبط بالبيانات بعد');
function overview(M){const A=M.filter(m=>!m.off);const T={snag:0,failed:0,pending:0,passed:0};A.forEach(m=>Object.keys(T).forEach(k=>T[k]+=m.c[k]));
 const cnt={};A.forEach(m=>cnt[m.s]=(cnt[m.s]||0)+1);const sc=m=>m.c.failed*3+m.c.snag*2+m.c.pending;
 const rank=[...A].sort((a,b)=>sc(b)-sc(a)||ORDER.indexOf(a.s)-ORDER.indexOf(b.s));
 const iss=A.filter(m=>m.s==='iss'),att=A.filter(m=>m.s==='att'),good=A.filter(m=>m.s==='ok'||m.s==='done');
 const names=a=>a.map(m=>`<b>${esc(short(m.z))}</b>`).join(L(' and ',' و'));
 const sum=A.length?`${L(`${good.length} of ${A.length} zones are on track or complete.`,`${good.length} من ${A.length} مناطق ضمن المسار أو مكتملة.`)} ${iss.length?L(`${names(iss)} need action now — ${iss.reduce((a,m)=>a+m.c.snag,0)} open snags and ${iss.reduce((a,m)=>a+m.c.failed,0)} failed inspections between them.`,`${names(iss)} تحتاج إلى إجراء فوري — ${iss.reduce((a,m)=>a+m.c.snag,0)} ملاحظات مفتوحة و${iss.reduce((a,m)=>a+m.c.failed,0)} فحوصات راسبة.`):''} ${att.length?L(`Keep an eye on ${names(att)}.`,`تابع ${names(att)}.`):''} ${T.pending?L(`${T.pending} submittals are waiting for approval across the site.`,`${T.pending} تقديمات بانتظار الاعتماد في الموقع.`):''}`:L('No zones match the current filters.','لا توجد مناطق مطابقة للتصفية الحالية.');
 return `<div class="mp-hd"><div><h3>${L('Project overview','نظرة عامة على المشروع')}</h3><small>${A.length} ${L('zones','مناطق')} · 113 ${L('villas','فيلا')} · ${L('visible to','مرئي لـ')} ${L(role().en,role().ar)}</small></div><button class="cb ter sm ic x tbl-only" data-act="panel"><i class="ti ti-x"></i></button></div>
 <div class="mp-bd">
 <div class="sec"><h6>${L('Totals','الإجماليات')}</h6>${tiles(T)}</div>
 <div class="sec"><h6>${L('Zone status','حالة المناطق')}</h6><div class="sbar">${ORDER.filter(k=>cnt[k]).map(k=>`<i style="flex:${cnt[k]};background:${ST[k].c}"></i>`).join('')}</div><div class="slist">${ORDER.filter(k=>cnt[k]).map(k=>`<span><i style="background:${ST[k].c}"></i>${L(ST[k].en,ST[k].ar)} <b>${cnt[k]}</b></span>`).join('')}</div></div>
 <div class="sec"><h6>${L('Executive summary','الملخص التنفيذي')}</h6><div class="exec">${sum}</div></div>
 ${V.exec?`<div class="sec"><h6>${L('Schedule & budget','الجدول والميزانية')}<small>${L('Coming soon','قريبًا')}</small></h6><div class="soons">${[['ti-calendar-time',L('Schedule progress','تقدم الجدول الزمني'),'—%',L('Available with Schedule module','متاح مع وحدة الجدول الزمني')],['ti-cash',L('Budget utilisation','استخدام الميزانية'),'—%',L('Available with Financial module','متاح مع الوحدة المالية')],['ti-calendar-event',L('Forecast finish date','تاريخ الإنجاز المتوقع'),'— — —',L('Available with Schedule module','متاح مع وحدة الجدول الزمني')]].map(x=>`<div class="soon"><span class="h"><i class="ti ${x[0]}"></i>${x[1]}</span><b>${x[2]}</b><small><i class="ti ti-lock"></i>${x[3]}</small></div>`).join('')}</div></div>`:''}
 <div class="sec"><h6>${L('Zone ranking','ترتيب المناطق')}<small>${L('Most issues first','الأكثر مشكلات أولًا')}</small></h6><div class="rank">${rank.map((m,i)=>`<button class="rk" data-sel="${m.z.id}"><span class="no">${i+1}</span><span class="ic" style="background:${ST[m.s].c}"><i class="ti ${ST[m.s].ic}"></i></span><span class="tx"><b>${esc(nm(m.z))}</b><small>${m.c.total?`${m.c.snag} ${L('snags','ملاحظات')} · ${m.c.failed} ${L('failed','راسب')} · ${m.c.pending} ${L('pending','معلّق')}`:L(ST[m.s].en,ST[m.s].ar)}</small></span><span class="n" style="color:${m.c.open?ST[m.s].f:'var(--ui-faint)'}">${m.c.open}</span></button>`).join('')}</div></div>
 </div>`}
function zoneP(m){const d=data(m.z.id),c=m.c;const loc=LOCS.find(l=>l.id===m.z.loc);
 const top=c.items.filter(it=>it.kind==='failed'||it.kind==='snag').sort((a,b)=>(b.kind==='failed')-(a.kind==='failed')||b.age-a.age).slice(0,3);
 return `<div class="mp-hd"><button class="cb ter sm ic bk" data-act="desel" title="${L('Back to overview','العودة للنظرة العامة')}"><i class="ti ti-arrow-left"></i></button><div style="min-width:0"><h3>${esc(nm(m.z))}</h3><small>${units(d)}${d?' · '+L(PHASES[d.ph][0],PHASES[d.ph][1]):''}</small></div><button class="cb ter sm ic x" data-act="desel"><i class="ti ti-x"></i></button></div>
 <div class="mp-bd">
 <div class="sec" style="display:flex;flex-direction:column;gap:8px">${chipS(m.s)}<div class="why"><i class="ti ti-info-circle"></i>${why(m.s,c)}</div>${loc?`<div class="crumb"><i class="ti ti-map-pin"></i>${L('Al Nakheel','النخيل')}<i class="ti ti-chevron-right"></i>${esc(L(loc.en,loc.ar))}</div>`:''}</div>
 <div class="sec"><h6>${L('Work items','عناصر العمل')}${V.role!=='admin'?`<small><i class="ti ti-eye" style="font-size:12px"></i> ${L('Visible to you only','المرئي لك فقط')}</small>`:''}</h6>${tiles(c)}</div>
 <div class="sec"><h6>${L('Top open issues','أهم المشكلات المفتوحة')}<small>${c.open}</small></h6>${top.length?`<div class="iss">${top.map(it=>{const t=TRADES[it.tr],f=it.kind==='failed';return `<div class="is"><span class="ic" style="background:${f?'var(--tone-red-tint)':'var(--tone-orange-tint)'};color:${f?'var(--tone-red-fg)':'var(--tone-orange-fg)'}"><i class="ti ${f?'ti-circle-x':'ti-flag'}"></i></span><div class="tx"><b>${esc(L(it.t[0],it.t[1]))}</b><div class="mt"><span class="chip" style="height:20px;font-size:11px;background:var(--tone-${t[2]}-tint);color:var(--tone-${t[2]}-fg)">${L(t[0],t[1])}</span><span>${f?L('Failed inspection','فحص راسب'):L('Snag','ملاحظة')}</span><span>·</span><span>${L(COS[it.co][0],COS[it.co][1])}</span><span>·</span><span>${it.age}${L('d open','ي مفتوحة')}</span></div></div></div>`}).join('')}</div>`:`<div class="none">${L('No open issues in this zone.','لا توجد مشكلات مفتوحة في هذه المنطقة.')}</div>`}</div>
 </div>
 <div class="mp-ft"><button class="cb pri" data-act="floor"><i class="ti ti-stairs"></i>${L('Open Floor View','فتح عرض الطوابق')}</button><a class="cb" href="submittals-list.html"><i class="ti ti-list"></i>${L('Open in list','فتح في القائمة')}</a></div>`}
function editP(M){const m=M.find(x=>x.z.id===V.sel);
 if(!m)return `<div class="mp-hd"><div><h3>${L('Site layout','مخطط الموقع')}</h3><small>${L('Select a zone to edit it, or draw a new one.','حدّد منطقة لتعديلها أو ارسم منطقة جديدة.')}</small></div></div><div class="mp-bd"><div class="steps"><div><span class="n">1</span>${L('Choose Draw zone and click around an area on the map.','اختر رسم منطقة وانقر حول مساحة على الخريطة.')}</div><div><span class="n">2</span>${L('Close the shape on the first point.','أغلق الشكل عند النقطة الأولى.')}</div><div><span class="n">3</span>${L('Link it to a Location and set its name.','اربطه بموقع وحدد اسمه.')}</div></div><div class="sec"><h6>${L('Zones','المناطق')}<small>${V.layout.length}</small></h6><div class="zlist">${M.map(x=>`<button class="rk" data-sel="${x.z.id}"><span class="ic" style="background:${col(x)}"><i class="ti ti-polygon"></i></span><span class="tx"><b>${esc(nm(x.z))}</b><small>${x.z.loc?esc(L(LOCS.find(l=>l.id===x.z.loc).en,LOCS.find(l=>l.id===x.z.loc).ar)):`<span style="color:var(--tone-orange-fg)">${L('No location linked','لا يوجد موقع مرتبط')}</span>`}</small></span></button>`).join('')}</div></div></div>`;
 const loc=LOCS.find(l=>l.id===m.z.loc);const q=V.pq.trim().toLowerCase();
 const SW=[null,'var(--tone-blue-solid)','var(--tone-violet-solid)','var(--tone-cyan-solid)','var(--tone-amber-solid)','var(--tone-tomato-solid)','var(--tone-gray-solid)'];
 const picker=V.picker?`<div class="picker"><div class="ps"><i class="ti ti-search"></i><input id="pq" placeholder="${L('Search locations','ابحث في المواقع')}" value="${esc(V.pq)}"></div><div class="pl">${LOCS.filter(l=>!q||(l.en+' '+l.ar).toLowerCase().includes(q)).map(l=>{const used=V.layout.find(z=>z.loc===l.id&&z.id!==m.z.id);const grp=l.d===0||l.group;return `<button class="lo${grp?' grp':''}${m.z.loc===l.id?' on':''}${used?' used':''}" ${grp?'':`data-loc="${l.id}"`} style="padding-inline-start:${8+l.d*16}px"><i class="ti ${l.d===0?'ti-buildings':grp?'ti-folder':'ti-map-pin'}"></i>${esc(L(l.en,l.ar))}${used?`<small>${L('Linked','مرتبط')} · ${esc(short(used))}</small>`:l.s?`<small>${L(l.s[0],l.s[1])}</small>`:''}</button>`}).join('')}</div></div>`:'';
 return `<div class="mp-hd"><button class="cb ter sm ic bk" data-act="desel"><i class="ti ti-arrow-left"></i></button><div><h3>${L('Zone properties','خصائص المنطقة')}</h3><small>${m.z.pts.length} ${L('points · drag the handles to reshape','نقاط · اسحب المقابض لتعديل الشكل')}</small></div></div>
 <div class="mp-bd">
 <div class="fld2"><label>${L('Name','الاسم')} (EN)</label><input data-name="en" value="${esc(m.z.en)}"></div>
 <div class="fld2"><label>${L('Name','الاسم')} (AR)</label><input data-name="ar" dir="rtl" value="${esc(m.z.ar)}"></div>
 <div class="fld2"><label>${L('Linked location','الموقع المرتبط')}</label><button class="locbtn${loc?'':' need'}" data-act="picker"><i class="ti ${loc?'ti-map-pin':'ti-alert-circle'}"></i>${loc?esc(L(loc.en,loc.ar)):L('Link a Location from the project tree','اربط موقعًا من شجرة المشروع')}<i class="ti ti-chevron-${V.picker?'up':'down'}"></i></button>${picker}${!loc?`<div class="warnx"><i class="ti ti-info-circle"></i>${L('Statuses appear once the zone is linked to a Location.','تظهر الحالات بمجرد ربط المنطقة بموقع.')}</div>`:''}</div>
 <div class="fld2"><label>${L('Colour','اللون')}</label><div class="cols">${SW.map(c=>c?`<button class="cs${m.z.color===c?' on':''}" data-color="${c}" style="background:${c}">${m.z.color===c?'<i class="ti ti-check"></i>':''}</button>`:`<button class="cs auto${!m.z.color?' on':''}" data-color="">${L('Auto · by status','تلقائي · حسب الحالة')}</button>`).join('')}</div></div>
 </div>
 <div class="mp-ft"><button class="cb" data-act="delzone" style="color:var(--tone-red-fg)"><i class="ti ti-trash"></i>${L('Delete zone','حذف المنطقة')}</button><button class="cb pri" data-act="desel"><i class="ti ti-check"></i>${L('Done','تم')}</button></div>`}
function subview(){const m=V.layout.find(z=>z.id===V.sel);const k=V.view==='floor';
 return `<div class="subv"><div class="emp"><span class="ic"><i class="ti ${k?'ti-stairs':'ti-vector'}"></i></span><div class="crumb" style="justify-content:center"><button class="cb ter sm" data-view="map"><i class="ti ti-map"></i>${L('Map View','عرض الخريطة')}</button>${m?`<i class="ti ti-chevron-right"></i><span>${esc(nm(m))}</span>`:''}<i class="ti ti-chevron-right"></i><b style="color:var(--ui-text)">${k?L('Floor View','عرض الطوابق'):L('Plan View','عرض المخطط')}</b></div><h2>${k?L('Floor View is designed next','عرض الطوابق هو التالي في التصميم'):L('Plan View is designed next','عرض المخطط هو التالي في التصميم')}</h2><p>${k?L('Shows each building’s floors with status, drilled in from a zone on the Map View.','يعرض طوابق كل مبنى مع حالتها، انطلاقًا من منطقة في عرض الخريطة.'):L('Shows a floor’s plan drawing with Work Items pinned to rooms.','يعرض مخطط الطابق مع عناصر العمل مثبتة على الغرف.')}</p><button class="cb pri" data-view="map"><i class="ti ti-arrow-left"></i>${L('Back to Map View','العودة إلى عرض الخريطة')}</button></div></div>`}
function view(){const M=model();if(V.view!=='map')return `${toolbar()}${subview()}${V.toast?`<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>`:''}`;
 const selM=M.find(m=>m.z.id===V.sel);const panel=V.empty?'':V.edit?editP(M):selM?zoneP(selM):overview(M);
 const shut=!(V.sel||V.panelOpen||V.edit);
 return `${toolbar()}${V.exec&&!V.edit&&!V.empty?kstrip(M):''}<div class="mv-body${V.empty?' nopanel':''}">${canvas(M)}${panel?`<aside class="mv-panel${shut?' shut':''}">${panel}</aside>`:''}</div>${V.toast?`<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>`:''}`}
/* ---------- transform ---------- */
function applyT(){const w=document.getElementById('world');if(!w)return;w.style.transform=`translate(${V.tx}px,${V.ty}px) scale(${V.k})`;w.style.setProperty('--inv',1/V.k);const z=document.getElementById('zl');if(z)z.textContent=Math.round(V.k*100)+'%'}
function fit(){const s=document.getElementById('stage');if(!s)return;const r=s.getBoundingClientRect();if(!r.width)return;V.k=Math.min(r.width/W,r.height/H)*.94;V.tx=(r.width-W*V.k)/2;V.ty=(r.height-H*V.k)/2;V.auto=true;applyT()}
function zoomAt(f,cx,cy){const k2=Math.max(.4,Math.min(5,V.k*f));V.tx=cx-(cx-V.tx)*(k2/V.k);V.ty=cy-(cy-V.ty)*(k2/V.k);V.k=k2;V.auto=false;applyT()}
function toWorld(e){const r=document.getElementById('stage').getBoundingClientRect();return [Math.round((e.clientX-r.left-V.tx)/V.k),Math.round((e.clientY-r.top-V.ty)/V.k)]}
const cen=p=>[Math.round(p.reduce((a,x)=>a+x[0],0)/p.length),Math.round(p.reduce((a,x)=>a+x[1],0)/p.length)];
/* ---------- bind ---------- */
function bind(root,R){let tt;
 const flash=m=>{V.toast=m;R.inner();clearTimeout(tt);tt=setTimeout(()=>{V.toast=null;R.inner()},2200)};
 const mark=()=>{V.dirty=true};
 function closeDraft(){if(V.draft.length<3)return;const n=V.layout.filter(z=>z.isNew).length+1;const z={id:'n'+Date.now(),en:'New zone '+n,ar:'منطقة جديدة '+n,pts:V.draft,m:cen(V.draft),loc:null,color:null,isNew:1};V.layout.push(z);V.draft=[];V.sel=z.id;V.tool='select';V.picker=true;V.pq='';mark();R.inner()}
 const file=document.createElement('input');file.type='file';file.accept='image/*';file.style.display='none';document.body.appendChild(file);
 function loadImg(f){if(!f||!/^image\//.test(f.type))return;const rd=new FileReader();rd.onload=()=>{const fromEmpty=V.empty;V.img=rd.result;if(fromEmpty){V.empty=false;V.layout=[];V.edit=true;V.backup={layout:[],img:null};V.tool='draw'}mark();V.auto=true;R.inner();flash(L('Site map uploaded','تم رفع خريطة الموقع'))};rd.readAsDataURL(f)}
 file.addEventListener('change',()=>{loadImg(file.files[0]);file.value=''});
 root.addEventListener('click',e=>{const b=e.target.closest('[data-menu],[data-f],[data-role],[data-act],[data-view],[data-tool],[data-zoom],[data-sel],[data-loc],[data-color]');
  if(!b){if(V.menu&&!e.target.closest('[data-stop]')){V.menu=null;R.inner()}return}
  if(b.closest('.hd,.tabs,.sb'))return;
  const d=b.dataset;
  if(d.menu){e.stopPropagation();V.menu=V.menu===d.menu?null:d.menu;return R.inner()}
  if(d.f!==undefined){const [k,v]=d.f.split(':');V.f[k]=v;V.menu=null;return R.inner()}
  if(d.role){V.role=d.role;V.menu=null;const r=ROLES[d.role];if(r.co&&V.f.co&&!r.co.includes(V.f.co))V.f.co='';if(r.tr&&V.f.tr&&!r.tr.includes(V.f.tr))V.f.tr='';if(!r.edit&&V.edit){V.edit=false;V.draft=[]}return R.inner()}
  if(d.view){if(d.view==='floor'){location.href='floor-view.html';return}if(d.view==='plan'){location.href='plan-view.html';return}V.view=d.view;S.mv=d.view;V.menu=null;history.replaceState(null,'','?v='+d.view);V.auto=true;return R.full()}
  if(d.tool){V.tool=d.tool;V.draft=[];if(d.tool==='draw')V.sel=null;return R.inner()}
  if(d.zoom){const s=document.getElementById('stage').getBoundingClientRect();if(d.zoom==='fit')return fit();return zoomAt(d.zoom==='in'?1.3:1/1.3,s.width/2,s.height/2)}
  if(d.sel){V.sel=d.sel;V.picker=false;return R.inner()}
  if(d.loc){const z=V.layout.find(z=>z.id===V.sel);const l=LOCS.find(x=>x.id===d.loc);z.loc=d.loc;if(z.isNew&&/^New zone/.test(z.en)){z.en=l.en.replace(' — ',' – ');z.ar=l.ar.replace(' — ',' – ')}V.picker=false;mark();return R.inner()}
  if(d.color!==undefined){const z=V.layout.find(z=>z.id===V.sel);z.color=d.color||null;mark();return R.inner()}
  const a=d.act;V.menu=null;
  if(a==='exec'){V.exec=!V.exec;if(V.exec){V.prevMode=S.mode;S.mode='dark'}else S.mode=V.prevMode||'light';return R.full()}
  if(a==='edit'){V.edit=true;V.exec&&(V.exec=false,S.mode=V.prevMode||'light');V.backup={layout:clone(V.layout),img:V.img};V.dirty=false;V.tool='select';return R.full()}
  if(a==='canceledit'){V.layout=V.backup.layout;V.img=V.backup.img;V.edit=false;V.draft=[];V.sel=null;V.dirty=false;return R.inner()}
  if(a==='save'){V.draft=[];V.edit=false;V.dirty=false;V.sel=null;try{localStorage.setItem(KEY,JSON.stringify({layout:V.layout,img:V.img}))}catch(err){try{localStorage.setItem(KEY,JSON.stringify({layout:V.layout}))}catch(e2){}}return flash(L('Layout saved — everyone on the project sees it now','تم حفظ المخطط — يراه الجميع في المشروع الآن'))}
  if(a==='upload')return file.click();
  if(a==='delzone'){V.layout=V.layout.filter(z=>z.id!==V.sel);V.sel=null;mark();return R.inner()}
  if(a==='desel'){V.sel=null;V.picker=false;return R.inner()}
  if(a==='picker'){V.picker=!V.picker;V.pq='';R.inner();const i=document.getElementById('pq');i&&i.focus();return}
  if(a==='floor'){location.href='floor-view.html';return}
  if(a==='clearf'){V.f={tr:'',type:'',co:'',ph:''};return R.inner()}
  if(a==='panel'){V.panelOpen=!V.panelOpen;if(!V.panelOpen)V.sel=null;return R.inner()}
  if(a==='empty'){V.empty=true;V.edit=false;V.sel=null;V.exec&&(V.exec=false,S.mode=V.prevMode||'light');return R.full()}
  if(a==='tablet'){V.tablet=!V.tablet;V.auto=true;return R.full()}
  if(a==='reset'){V.layout=sample();V.img=null;V.empty=false;V.edit=false;V.sel=null;V.draft=[];try{localStorage.removeItem(KEY)}catch(e){}V.auto=true;return R.inner()}
 });
 root.addEventListener('input',e=>{const i=e.target;if(i.id==='pq'){V.pq=i.value;const p=i.selectionStart;R.inner();const n=document.getElementById('pq');n.focus();n.setSelectionRange(p,p)}
  if(i.dataset.name){const z=V.layout.find(z=>z.id===V.sel);z[i.dataset.name]=i.value;mark();const mk=root.querySelector(`.mk[data-z="${z.id}"] .nm`);if(mk)mk.textContent=short(z)}});
 root.addEventListener('dragover',e=>{const dz=e.target.closest('#drop');if(dz){e.preventDefault();dz.classList.add('over')}});
 root.addEventListener('dragleave',e=>{const dz=e.target.closest('#drop');dz&&dz.classList.remove('over')});
 root.addEventListener('drop',e=>{const dz=e.target.closest('#drop');if(dz){e.preventDefault();loadImg(e.dataTransfer.files[0])}});
 // pan / zoom / pick / draw
 let P=null;
 root.addEventListener('pointerdown',e=>{if(e.button!==0)return;const st=e.target.closest('#stage');if(!st)return;const vx=e.target.closest('[data-vx]');P={x:e.clientX,y:e.clientY,tx:V.tx,ty:V.ty,moved:false,vx:vx?+vx.dataset.vx:null,t:e.target};});
 addEventListener('pointermove',e=>{const tip=document.getElementById('mvtip'),st=document.getElementById('stage');if(!st)return;
  if(P){const dx=e.clientX-P.x,dy=e.clientY-P.y;if(!P.moved&&Math.hypot(dx,dy)>4){P.moved=true;if(P.vx==null)st.classList.add('panning')}
   if(P.moved){if(P.vx!=null){const z=V.layout.find(z=>z.id===V.sel);z.pts[P.vx]=toWorld(e);const g=root.querySelector(`.zp[data-z="${z.id}"]`);g&&g.querySelectorAll('polygon').forEach(p=>p.setAttribute('points',pts(z.pts)));const h=root.querySelector(`[data-vx="${P.vx}"]`);if(h){h.style.left=z.pts[P.vx][0]/W*100+'%';h.style.top=z.pts[P.vx][1]/H*100+'%'}}else{V.tx=P.tx+dx;V.ty=P.ty+dy;V.auto=false;applyT()}}
   if(tip)tip.style.display='none';return}
  const dl=document.getElementById('dl');if(dl&&st.contains(e.target)){const w=toWorld(e);dl.setAttribute('x2',w[0]);dl.setAttribute('y2',w[1])}
  if(!tip)return;const g=e.target.closest&&e.target.closest('#stage [data-z]');if(!g||V.edit&&V.tool==='draw'){tip.style.display='none';return}
  const m=model().find(x=>x.z.id===g.dataset.z);if(!m){tip.style.display='none';return}
  const r=st.getBoundingClientRect();tip.innerHTML=`<b>${esc(nm(m.z))}</b> · ${m.c.open} ${L(m.c.open===1?'open issue':'open issues','مشكلات مفتوحة')}<div class="s"><i style="background:${ST[m.s].c}"></i>${L(ST[m.s].en,ST[m.s].ar)}${m.c.pending?` · ${m.c.pending} ${L('pending approval','بانتظار الاعتماد')}`:''}</div>`;tip.style.display='block';
  let x=e.clientX-r.left+14,y=e.clientY-r.top+14;const tw=tip.offsetWidth;if(x+tw>r.width-8)x=e.clientX-r.left-tw-14;tip.style.left=x+'px';tip.style.top=y+'px'});
 addEventListener('pointerup',e=>{if(!P)return;const p=P;P=null;const st=document.getElementById('stage');st&&st.classList.remove('panning');
  if(p.moved){if(p.vx!=null){const z=V.layout.find(z=>z.id===V.sel);if(z.id.startsWith('n')||!['road'].includes(z.id))z.m=cen(z.pts);mark();R.inner()}return}
  if(V.edit&&V.tool==='draw'){const w=toWorld(e);if(V.draft.length>=3){const f=V.draft[0];if(Math.hypot((f[0]-w[0])*V.k,(f[1]-w[1])*V.k)<14)return closeDraft()}V.draft.push(w);return R.inner()}
  const g=p.t.closest&&p.t.closest('[data-z]');V.sel=g?g.dataset.z:null;V.picker=false;R.inner()});
 root.addEventListener('wheel',e=>{const st=e.target.closest('#stage');if(!st)return;e.preventDefault();const r=st.getBoundingClientRect();zoomAt(e.deltaY<0?1.12:1/1.12,e.clientX-r.left,e.clientY-r.top)},{passive:false});
 addEventListener('resize',()=>{if(V.auto)fit()});
 document.addEventListener('keydown',e=>{if(e.target.closest&&e.target.closest('input'))return;
  if(V.edit&&V.tool==='draw'){if(e.key==='Enter'){e.preventDefault();return closeDraft()}if(e.key==='Backspace'&&V.draft.length){e.preventDefault();V.draft.pop();return R.inner()}if(e.key==='Escape'){V.draft.length?V.draft=[]:V.tool='select';return R.inner()}}
  if(V.edit&&(e.key==='v'||e.key==='V')){V.tool='select';V.draft=[];return R.inner()}if(V.edit&&(e.key==='p'||e.key==='P')){V.tool='draw';V.sel=null;return R.inner()}
  if(e.key==='Escape'&&(V.sel||V.menu)){V.sel=null;V.menu=null;R.inner()}
  if((e.key==='+'||e.key==='=')&&document.getElementById('stage')){const s=document.getElementById('stage').getBoundingClientRect();zoomAt(1.3,s.width/2,s.height/2)}
  if(e.key==='-'&&document.getElementById('stage')){const s=document.getElementById('stage').getBoundingClientRect();zoomAt(1/1.3,s.width/2,s.height/2)}});
}
function after(){if(V.auto)fit();else applyT()}
window.MV={V,view,bind,after};
})();
