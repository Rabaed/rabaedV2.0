// Screen 2(c) — web progress update (MEP contract, U-6 draft). Same editor as 2(a) in update mode: planned locked, actuals editable.
(function(){const C=SC,K=SD.contracts[1],U6=SD.u6,RV=SD.meRev;
const s={started:false,sent:false,launched:false,ret:null,rows:{},ids:{},ui:{},by:null};
const MA=SD.me.map(x=>Object.assign({},x,{zone:'Zone A',bld:'Building 1',dur:x.dur!=null?x.dur:C.wdays(x.ps,x.pe)}));
const acts0=()=>MA.map(a=>Object.assign(a,s.ids[a.id]||{}));
const MAX=C.TODAY<U6.dd?C.TODAY:U6.dd;
// current value = U-5 accepted state + U-6 draft overrides
function val(id){const a=MA.find(x=>x.id===id);const b=a.u5||{};const d=s.rows[id]||{};const v={a:b.a||null,f:b.f||null,p:b.f?100:(b.p||0),xs:b.xs||null,xf:b.xf||null};Object.assign(v,d);if(v.f){v.p=100;v.rem=0}
 if(v.rem==null)v.rem=v.f?0:v.xf?Math.max(0,C.wdays(C.addD(U6.dd,1),v.xf)):Math.round(a.dur*(1-v.p/100));
 v.fe=v.f||(d.rem!=null?C.addWd(U6.dd,d.rem):v.xf||(v.a?C.addWd(v.a,a.dur-1):a.pe));v.fs=v.a||v.xs||a.ps;v.prev=b.f||b.xf||a.pe;v.shift=v.fe>v.prev&&!a.ms;v.src=d.src||null;v.srcD=d.srcD||null;return v}
function setVal(id,patch,src){const r=s.rows[id]=Object.assign(s.rows[id]||{},patch);r.src=src;r.srcD=C.TODAY;if(r.f){r.p=100;r.rem=0}}
function bound(d){if(!d)return 'تاريخ غير مفهوم — اكتب مثل 26/9';if(d>MAX)return 'لا يُقبل تاريخ فعلي بعد تاريخ البيانات أو في المستقبل (حتى '+C.fmt(MAX,1)+')';if(d<U6.min)return 'التاريخ الفعلي يقع بعد تاريخ البيانات السابق ('+C.fmt(U6.min,1)+' فأحدث)';return null}
const period=()=>MA.filter(a=>{const b=a.u5||{};if(b.f)return false;const st=b.a||b.xs||a.ps,en=b.xf||a.pe;return st<=U6.dd&&en>=RV.u5dd});
const role=()=>C.st.role==='mmgr'?'mgr':'eng';
const holder=()=>s.started&&!s.launched&&(role()==='eng'?!s.sent:s.sent);
const mode=()=>holder()?'update':'read';
const REA=[['','—'],...C.REASONS.map(r=>[r,r])];
const lockC={lockable:1,ed:()=>false};
const cols=()=>[
 {k:'id',l:'الرقم',w:72,type:'ro',v:a=>`<span class="sc-id">${a.id}</span>`},
 {k:'n',l:'النشاط',w:210,type:'ro',v:a=>`<span class="nm">${C.esc(a.n)}</span>`},
 Object.assign({k:'dur',l:'المدة',w:52,cls:'num',type:'ro',v:a=>a.ms?'<span class="sc-lz">معلم</span>':a.dur},lockC),
 Object.assign({k:'ps',l:'بداية مخططة',w:86,type:'ro',v:a=>C.fmt(a.ps,1)},lockC),
 Object.assign({k:'pe',l:'نهاية مخططة',w:86,type:'ro',v:a=>a.ms?C.fmt(a.pe,1):C.fmt(a.pe,1)},lockC),
 {k:'as',l:'بداية فعلية',w:88,type:'date',ed:(m,a)=>m==='update'&&!a.ms,raw:a=>val(a.id).a||'',set:(a,v)=>{if(!v.trim()){setVal(a.id,{a:null},'web');return}const d=C.pd(v),e=bound(d);if(e)return e;setVal(a.id,{a:d,p:Math.max(val(a.id).p,10)},'web')},v:a=>{const x=val(a.id);return x.a?C.fmt(x.a,1):'<span class="sc-fnt">—</span>'}},
 {k:'af',l:'نهاية فعلية',w:88,type:'date',ed:(m,a)=>m==='update'&&!a.ms,raw:a=>val(a.id).f||'',set:(a,v)=>{if(!v.trim()){setVal(a.id,{f:null},'web');return}const d=C.pd(v),e=bound(d);if(e)return e;const x=val(a.id);if(x.a&&d<x.a)return 'النهاية الفعلية قبل البداية';setVal(a.id,{f:d,a:x.a||d},'web')},v:a=>{const x=val(a.id);return x.f?C.fmt(x.f,1):'<span class="sc-fnt">—</span>'}},
 {k:'p',l:'النسبة',w:60,cls:'num',type:'num',ed:(m,a)=>m==='update'&&!a.ms,raw:a=>val(a.id).p,set:(a,v)=>{const n=parseInt(v);if(!(n>=0&&n<=100))return 'النسبة من 0 إلى 100';const x=val(a.id);if(n>0&&!x.a)return 'أدخل البداية الفعلية أولاً';setVal(a.id,n===100?{p:100,f:x.f||MAX}:{p:n,f:null},'web')},v:a=>val(a.id).p+'%'},
 {k:'rem',l:'المتبقية',w:62,cls:'num',type:'num',ed:(m,a)=>m==='update'&&!a.ms&&!val(a.id).f,raw:a=>val(a.id).rem,set:(a,v)=>{const n=parseInt(v);if(!(n>=0))return 'رقم صفر أو أكبر';setVal(a.id,{rem:n},'web')},v:a=>val(a.id).rem},
 {k:'fe',l:'نهاية متوقعة',w:90,type:'ro',v:a=>{const x=val(a.id);return `<span class="${x.shift?'sc-num warn':''}">${C.fmt(x.fe,1)}</span>`}},
 {k:'r',l:'سبب التأخير',w:96,type:'sel',opts:()=>REA,ed:m=>m==='update',raw:a=>(s.rows[a.id]||{}).r||'',set:(a,v)=>{setVal(a.id,{r:v||null},'web')},v:a=>{const x=val(a.id),r=(s.rows[a.id]||{}).r;return r?C.rs(r):x.shift?'<span class="sc-st t-amber">مطلوب</span>':'<span class="sc-fnt">—</span>'}},
 {k:'src',l:'المصدر',w:150,type:'ro',v:a=>{const x=val(a.id);return x.src?`<span class="e-src"><i class="ti ${x.src==='mobile'?'ti-device-mobile':'ti-world'}"></i> حُدّث من ${x.src==='mobile'?'الجوال':'الويب'} · ${C.fmt(x.srcD,1)}</span>`:'<span class="sc-fnt">—</span>'}},
 {k:'disc',l:'التخصص',w:64,type:'sel',opts:()=>[['','—'],...SD.dms.disc.map(d=>[d[0],d[0]])],ed:m=>m==='update',raw:a=>a.disc||'',set:(a,v)=>{(s.ids[a.id]=s.ids[a.id]||{}).disc=v||null;a.disc=v||null},v:a=>a.disc?`<span class="sc-id">${a.disc}</span>`:'<span class="sc-fnt">—</span>'},
 {k:'fl',l:'الطابق',w:56,type:'sel',opts:()=>[['','—'],...SD.dms.floor.map(f=>[f,f])],ed:m=>m==='update',raw:a=>a.fl||'',set:(a,v)=>{(s.ids[a.id]=s.ids[a.id]||{}).fl=v||null;a.fl=v||null},v:a=>a.fl?`<span class="sc-id">${a.fl}</span>`:'<span class="sc-fnt">—</span>'}];
function panel(a,m){const U=m==='update'&&!a.ms,x=val(a.id);const dis=q=>q?'':' disabled';
 return `<div class="e-pf"><span class="lb">المخطط (BL-0) — مقفل في وضع التحديث</span><div class="e-p2"><input class="sc-in" readonly value="${a.ms?'معلم':a.dur+' يوم عمل'}"><input class="sc-in" readonly value="${C.fmt(a.ps,1)} → ${C.fmt(a.pe,1)}"></div></div>
 <div class="e-pf"><span class="lb">الفعلي · تاريخ البيانات ${C.fmt(U6.dd)}</span><div class="e-p2"><div class="e-pf"><label>بداية فعلية</label><input class="sc-in" type="date" min="${U6.min}" max="${MAX}" data-ep="a" value="${x.a||''}"${dis(U&&!(a.u5||{}).a)}></div><div class="e-pf"><label>نهاية فعلية</label><input class="sc-in" type="date" min="${U6.min}" max="${MAX}" data-ep="f" value="${x.f||''}"${dis(U)}></div></div>
 <div class="e-p2"><div class="e-pf"><label>النسبة %</label><input class="sc-in" type="number" min="0" max="100" data-ep="p" value="${x.p}"${dis(U)}></div><div class="e-pf"><label>المتبقية (أيام)</label><input class="sc-in" type="number" min="0" data-ep="rem" value="${x.rem}"${dis(U&&!x.f)}></div></div>
 <small class="sc-fnt">التواريخ الفعلية بين ${C.fmt(U6.min,1)} و${C.fmt(MAX,1)} — لا مستقبل. النهاية الفعلية تجعل النسبة 100% والمتبقية صفراً.</small></div>
 <div class="e-pf"><label>سبب التأخير ${x.shift?'<span class="m-req">إلزامي — النهاية انزاحت</span>':''}</label><select class="sc-in" data-ep="r"${dis(m==='update')}>${REA.map(([k,l])=>`<option value="${k}"${k===((s.rows[a.id]||{}).r||'')?' selected':''}>${l}</option>`).join('')}</select></div>
 <div class="e-pf"><label>ربط طلب فحص <span class="sc-fnt">(اختياري)</span></label><select class="sc-in" data-ep="ir"${dis(m==='update')}><option value="">بلا ربط</option><option${(s.rows[a.id]||{}).ir?' selected':''} value="1">طلب فحص […]</option></select></div>
 <div class="e-pf"><span class="lb">معرّفات المشروع (من الـDMS)</span><div class="e-p2"><input class="sc-in" readonly value="${a.disc||'—'} · ${a.fl?'الطابق '+a.fl:'—'}"><input class="sc-in" readonly value="${a.zone} · ${a.bld}"></div></div>
 ${x.src?`<div class="sc-note t-gray"><i class="ti ${x.src==='mobile'?'ti-device-mobile':'ti-world'}"></i>حُدّث من ${x.src==='mobile'?'الجوال':'الويب'} · ${C.fmt(x.srcD)}</div>`:''}
 <div class="e-pf"><span class="lb">السوابق</span><div class="sc-chips">${a.pred.map(p=>`<span class="sc-id">${p[0]} FS</span>`).join(' · ')||'<span class="sc-fnt">—</span>'}</div></div>`}
function onPanel(a,f,v){const x=val(a.id);
 if(f==='a'){const e=bound(v);if(e)return e;setVal(a.id,{a:v,p:Math.max(x.p,10)},'web');return}
 if(f==='f'){if(!v){setVal(a.id,{f:null},'web');return}const e=bound(v);if(e)return e;if(x.a&&v<x.a)return 'النهاية الفعلية قبل البداية';setVal(a.id,{f:v,a:x.a||v},'web');return}
 if(f==='p'){const n=Math.max(0,Math.min(100,parseInt(v)||0));if(n>0&&!x.a)return 'أدخل البداية الفعلية أولاً';setVal(a.id,n===100?{p:100,f:x.f||MAX}:{p:n,f:null},'web');return}
 if(f==='rem'){setVal(a.id,{rem:Math.max(0,parseInt(v)||0)},'web');return}
 if(f==='r'){setVal(a.id,{r:v||null},'web');return}if(f==='ir'){setVal(a.id,{ir:v||null},'web');return}}
const list=()=>{const L=acts0();return s.ui.filter==='all'?L:L.filter(a=>period().some(p=>p.id===a.id))};
const E=C.ED.create({pg:'webupd',ui:s.ui,acts:list,mode,cols,panel,onPanel,ce:K.ce,dd:()=>s.started?U6.dd:RV.u5dd,
 range:()=>[s.ui.filter==='all'?'2026-08-09':'2026-08-30',s.ui.filter==='all'?'2027-03-31':'2026-11-01'],
 bar:a=>{const x=val(a.id);if(a.ms)return {s:x.fe,e:x.fe,ms:1,bs:a.ps,be:a.pe,bms:1};return {s:x.fs,e:x.fe,bs:a.ps,be:a.pe,pct:x.f?0:x.p,cls:'fc'+(x.f?' done':'')}},
 rowCls:a=>s.rows[a.id]?'chg':'',snap:()=>JSON.stringify([s.rows,s.ids]),restore:q=>{const r=JSON.parse(q);s.rows=r[0];s.ids=r[1]}});
const upd=()=>{const P=period();return [P.filter(a=>s.rows[a.id]).length,P.length]};
const missing=()=>period().filter(a=>val(a.id).shift&&!(s.rows[a.id]||{}).r);
function view(){const m=mode();const mgr=role()==='mgr';const meDec=C.st.meDec;
 const intl=s.launched?C.chip('U-6 تم التقديم — قيد المراجعة','violet'):!s.started?'':s.ret&&!s.sent?C.chip('أُعيد للتعديل — عند م. نادر حداد','amber'):C.chip(s.sent?'مسودة داخلية — عند م. طارق':'مسودة داخلية — عند م. نادر','gray');
 const h=C.hdr({title:K.n+' · تحديث التقدّم <span class="sc-bi">U-6</span>',chips:C.lz('داخل ربائد')+C.lz('BL-0')+intl+C.chip(m==='update'?'وضع التحديث':'وضع القراءة',m==='update'?'blue':'gray',1),sub:`<span>${K.co}</span><span>تاريخ البيانات: <b>${s.started?C.fmt(U6.dd):'—'}</b></span><span>آخر تقديم: <b><span class="sc-bi">U-5</span> ${meDec==='ok'||meDec==='notes'?'مقبول بملاحظات':'قيد المراجعة'}</b></span><span>تقويم المشروع · الجمعة عطلة</span>`});
 if(!s.started)return C.shell(h,`<section class="sc-card g-empty"><div><h3>لا توجد مسودة تحديث مفتوحة</h3><p class="sc-mut">الجدول معتمد وفي وضع القراءة. ابدأ مسودة U-6 بتاريخ بيانات ${C.fmt(U6.dd)} — من هنا أو من الجوال، فكلاهما يكتب في المسودة نفسها.</p></div><div class="sc-chips"><button class="sc-b pri" data-a="s2c-start"><i class="ti ti-player-play"></i>بدء تحديث</button><button class="sc-b out" data-a="go" data-v="mobile"><i class="ti ti-device-mobile"></i>فتح على الجوال</button><button class="sc-b ter" data-a="s2c-oos"><i class="ti ti-arrows-diff"></i>طلب تعديل خط الأساس</button></div></section>`);
 const ban=s.ret&&!s.sent&&!s.launched?`<div class="e-banner"><i class="ti ti-arrow-back-up"></i><div><b>أعاده م. طارق العنزي للتعديل</b><br>${C.esc(s.ret)}</div></div>`:'';
 const hold=!holder()&&!s.launched?`<div class="sc-note t-gray"><i class="ti ti-lock"></i>المسودة ${s.sent?'عند م. طارق العنزي':'عند م. نادر حداد'} — تعرضها للقراءة فقط.</div>`:'';
 const fl=C.seg([['period','أنشطة الفترة'],['all','كل الأنشطة']],s.ui.filter,'s2c-f');
 const [n,N]=upd();const dv=C.days(K.ce,K.fe);const miss=missing();
 let act;if(s.launched)act=`<span class="it2">أطلقه م. طارق العنزي · ${C.fmt(C.TODAY)}</span>`;
 else if(mgr)act=s.sent?`<button class="sc-b out" data-a="s2c-ret"><i class="ti ti-arrow-back-up"></i>إرجاع للمهندس</button><button class="sc-b pri" data-a="s2c-launch"${meDec?'':' disabled title="طلب واحد معلّق من كل نوع — بانتظار قرار الاستشاري على U-5"'}><i class="ti ti-send"></i>إطلاق U-6</button>`:`<span class="it2">لم يُرسل إليك بعد</span>`;
 else act=s.sent?`<span class="it2"><i class="ti ti-check"></i>أُرسل لمدير المشروع</span>${C.handoff('mmgr','webupd')}`:`<button class="sc-b pri" data-a="s2c-send"${miss.length?' disabled title="سبب التأخير إلزامي عند انزياح النهاية: '+miss.map(a=>a.id).join('، ')+'"':''}><i class="ti ti-send"></i>إرسال لمدير المشروع</button>`;
 const bot=`<div class="sc-bar"><span class="it2"><i class="ti ti-checklist"></i>حُدّث <b>${n}</b> من <b>${N}</b></span><span class="dv"></span><span class="it2"><i class="ti ti-flag"></i>النهاية المتوقعة: <b>${C.fmt(K.fe)}</b> <span class="sc-num warn">(${C.sd(dv)})</span></span>${miss.length?`<span class="dv"></span><span class="it2" style="color:var(--tone-amber-fg)"><i class="ti ti-alert-triangle"></i>${miss.length} بلا سبب تأخير</span>`:''}<span class="sp"></span>${act}</div>`;
 return C.shell(h,ban+hold+E.view(fl+`<span class="sc-mut" style="font-size:12.5px"><i class="ti ti-lock" style="vertical-align:-2px"></i> الأعمدة المخططة مقفلة</span>`)+bot)}
function act(a,el){if(E.act(a,el))return;const v=el.dataset.v;
 if(a==='s2c-f'){s.ui.filter=v;return}
 if(a==='s2c-start'){s.started=true;s.by=C.st.role;C.toast('بدأت مسودة U-6 · تاريخ البيانات '+C.fmt(U6.dd));return}
 if(a==='s2c-oos'){C.toast('طلب تعديل خط الأساس يفتح الجدول في وضع التخطيط');return}
 if(a==='s2c-send'){s.sent=true;s.ui.edit=null;C.toast('أُرسل لمدير المشروع م. طارق العنزي');return}
 if(a==='s2c-ret'){C.st.modal={title:'إرجاع للمهندس',ok:'إرجاع',body:`<p>تعود المسودة قابلة للتحرير عند م. نادر حداد. الاستشاري لا يرى أي تغيير.</p><div class="sc-f"><label>ملاحظة <span class="m-req">إلزامية</span></label><textarea class="sc-in" id="ret-note" rows="3" style="height:auto;padding:10px"></textarea></div>`,fn:()=>{const t=(document.getElementById('ret-note')||{}).value||'';if(!t.trim()){C.toast('الملاحظة إلزامية');return false}s.ret=t.trim();s.sent=false;C.toast('أُعيد للتعديل — عند م. نادر حداد')}};return}
 if(a==='s2c-launch'){C.st.modal={title:'إطلاق U-6',ok:'إطلاق',body:`<p>سيصل الاستشاري تحديث التقدّم U-6 بتاريخ بيانات ${C.fmt(U6.dd)}.</p>`,fn:()=>{s.launched=true;C.toast('تم التقديم — قيد المراجعة')}};return}
 return false}
s.api=null;
C.ME={val,setVal,bound,period,MA,MAX,state:s,acts0};
C.screens.s2c={view,act,state:s};
})();
