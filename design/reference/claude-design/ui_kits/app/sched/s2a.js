// Screen 2(a) — finishing contract BL-0 editor (plan → read after launch). Rules: 07-editing-rules.md
(function(){const C=SC,K=SD.contracts[2],E0=C.ED;
const s={filled:false,acts:null,sent:false,launched:false,ret:null,ui:{},src:null};
C.pd=v=>{v=String(v||'').trim();if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;const m=v.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);if(!m)return null;const d=+m[1],mo=+m[2];let y=m[3]?+m[3]:(mo>=8?2026:2027);if(y<100)y+=2000;if(mo<1||mo>12||d<1||d>31)return null;return y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0')};
// ---- CPM on the project calendar (workday indices)
const WD=[];(()=>{let d=K.cs;if(!C.isWork(C.D(d)))d=C.nextWork(d);for(let i=0;i<800;i++){WD.push(d);d=C.addWd(d,1)}})();
const idx=d=>{let lo=0,hi=WD.length-1;while(lo<hi){const m=(lo+hi)>>1;if(WD[m]<d)lo=m+1;else hi=m}return lo};
function calc(){const L=s.acts;const M={};L.forEach(a=>M[a.id]=a);const order=[],seen={};const vis=a=>{if(seen[a.id])return;seen[a.id]=1;a.pred.forEach(p=>M[p[0]]&&vis(M[p[0]]));order.push(a)};L.forEach(vis);
 order.forEach(a=>{let es=0,drv=null;a.pred.forEach(p=>{const q=M[p[0]];if(!q)return;const c=q.ef+1+(p[1]||0);if(c>es){es=c;drv=q.id}});a.es0=es;a.drv=drv;if(a.pin){const pi=idx(a.pin);if(pi>es)es=pi;else a.pin=null}a.es=es;a.ef=a.ms?es-1:es+a.dur-1;a.ps=WD[es];a.pe=a.ms?WD[es]:WD[a.ef]});
 const F=Math.max(...L.map(a=>a.ef));const succ={};L.forEach(a=>a.pred.forEach(p=>{(succ[p[0]]=succ[p[0]]||[]).push([a,p[1]||0])}));
 for(let i=order.length-1;i>=0;i--){const a=order[i];let lf=F;(succ[a.id]||[]).forEach(([b,l])=>{lf=Math.min(lf,b.ls-1-l)});a.lf=lf;a.ls=a.ms?lf+1:lf-a.dur+1;a.crit=a.ls-a.es<=0}}
function fill(src){s.acts=SD.fi.map(r=>({id:r[0],n:r[1],w:r[2],disc:r[3],zone:'Zone A',bld:'Building 1',fl:r[4],dur:r[5],pred:r[6].map(p=>p.slice()),ms:r[5]===0?1:0,pin:null,note:''}));s.filled=true;s.src=src;calc()}
const end=()=>s.acts.reduce((m,a)=>a.pe>m?a.pe:m,'0');
const role=()=>C.st.role==='kmgr'?'mgr':'eng';
const holder=()=>!s.launched&&(role()==='eng'?!s.sent:s.sent);
const mode=()=>!s.filled?'read':s.launched?'read':holder()?'plan':'read';
const byId=id=>s.acts.find(a=>a.id===id);
const DISC=[['','—'],...SD.dms.disc.map(d=>[d[0],d[0]])],FL=[['','—'],...SD.dms.floor.map(f=>[f,f])];
function setPin(a,d){if(!d)return 'تاريخ غير مفهوم — اكتب مثل 7/12';if(d<K.cs)return 'لا يبدأ قبل بداية العقد '+C.fmt(K.cs);calc();
 if(d<a.ps&&d<WD[a.es0]){const q=a.drv&&byId(a.drv);return q?'السابق '+q.id+' ينتهي '+C.fmt(q.pe,1):'لا يبدأ قبل بداية العقد '+C.fmt(K.cs)}
 const nd=C.nextWork(d);a.pin=nd<=WD[a.es0]?null:nd;calc()}
function parsePred(v){if(!v.trim())return [];const out=[];for(const t of v.split(/[,،\s]+/).filter(Boolean)){const m=t.toUpperCase().match(/^(F-\d+)(?:FS)?(?:\+(\d+))?$/);if(!m||!byId(m[1]))return null;out.push([m[1],m[2]?+m[2]:0])}return out}
const reach=(from,to)=>{const st=[from],seen={};while(st.length){const x=st.pop();if(x===to)return true;if(seen[x])continue;seen[x]=1;s.acts.filter(a=>a.pred.some(p=>p[0]===x)).forEach(a=>st.push(a.id))}return false};
const cols=()=>[
 {k:'h',l:'',w:30,type:'ro',v:a=>`<span class="e-hdl" data-ehd="${a.id}" title="اسحب لإعادة الترتيب"><i class="ti ti-grip-vertical"></i></span>`},
 {k:'id',l:'الرقم',w:72,type:'ro',v:a=>`<span class="sc-id">${a.id}</span>${a.isNew?'<span class="e-new">جديد</span>':''}`},
 {k:'n',l:'النشاط',w:220,ed:m=>m==='plan',raw:a=>a.n,set:(a,v)=>{if(!v.trim())return 'الاسم مطلوب';a.n=v.trim()},v:a=>`<span class="nm">${C.esc(a.n)}</span>`},
 {k:'dur',l:'المدة',w:56,cls:'num',type:'num',ed:(m,a)=>m==='plan'&&!a.ms,raw:a=>a.dur,set:(a,v)=>{const n=parseInt(v);if(!(n>=1&&n<=999))return 'المدة رقم من 1 إلى 999';a.dur=n;calc()},v:a=>a.ms?'<span class="sc-lz">معلم</span>':a.dur},
 {k:'s',l:'البداية',w:88,type:'date',ed:m=>m==='plan',raw:a=>a.ps,set:(a,v)=>setPin(a,C.pd(v)),v:a=>(a.pin?'<i class="ti ti-pin-filled" style="color:var(--tone-amber-solid);font-size:12px"></i>':'')+C.fmt(a.ps,1)},
 {k:'f',l:'النهاية',w:88,type:'date',ed:(m,a)=>m==='plan'&&!a.ms,raw:a=>a.pe,set:(a,v)=>{const d=C.pd(v);if(!d)return 'تاريخ غير مفهوم';if(d<a.ps)return 'النهاية قبل البداية';a.dur=Math.max(1,C.wdays(a.ps,d));calc()},v:a=>a.ms?'—':C.fmt(a.pe,1)},
 {k:'pred',l:'السابق',w:128,ed:m=>m==='plan',raw:a=>a.pred.map(p=>p[0]+(p[1]?'+'+p[1]:'')).join(', '),set:(a,v)=>{const p=parsePred(v);if(!p)return 'اكتب أرقام أنشطة موجودة مثل F-110, F-130+2';if(p.some(q=>q[0]===a.id||reach(a.id,q[0])))return 'العلاقة تُنشئ حلقة';a.pred=p;calc()},v:a=>a.pred.length?`<span class="sc-id">${a.pred.map(p=>p[0]+(p[1]?' +'+p[1]:'')).join(' · ')}</span>`:'<span class="sc-st t-amber">نشاط مفتوح</span>'},
 {k:'disc',l:'التخصص',w:66,type:'sel',opts:()=>DISC,ed:m=>m!=='read',raw:a=>a.disc||'',set:(a,v)=>{a.disc=v||null},v:a=>a.disc?`<span class="sc-id">${a.disc}</span>`:'<span class="sc-fnt">—</span>'},
 {k:'fl',l:'الطابق',w:58,type:'sel',opts:()=>FL,ed:m=>m!=='read',raw:a=>a.fl||'',set:(a,v)=>{a.fl=v||null},v:a=>a.fl?`<span class="sc-id">${a.fl}</span>`:'<span class="sc-fnt">—</span>'},
 {k:'w',l:'WBS',w:120,ed:m=>m==='plan',raw:a=>a.w,set:(a,v)=>{if(!v.trim())return 'WBS مطلوب';a.w=v.trim()},v:a=>`<span class="sc-mut nm">${C.esc(a.w)}</span>`},
 {k:'crit',l:'حرج',w:44,type:'ro',v:a=>a.crit?'<i class="g-cr" title="على المسار الحرج"></i>':''}];
function panel(a,m){const P=m==='plan',D=m!=='read';const dis=x=>x?'':' disabled';
 const sel=(k,opts,v,en)=>`<select class="sc-in" data-ep="${k}"${dis(en)}>${opts.map(([x,l])=>`<option value="${x}"${x===(v||'')?' selected':''}>${l}</option>`).join('')}</select>`;
 const Z=[['','—'],...SD.dms.zone.map(z=>[z,z])],B=[['','—'],...SD.dms.bld.map(z=>[z,z])];
 const others=s.acts.filter(x=>x.id!==a.id&&!a.pred.some(p=>p[0]===x.id)&&!reach(a.id,x.id));
 return `<div class="e-pf"><label>الاسم</label><input class="sc-in" data-ep="n" value="${C.esc(a.n)}"${dis(P)}></div>
 <div class="e-pf"><label>WBS</label><input class="sc-in" data-ep="w" value="${C.esc(a.w)}"${dis(P)}></div>
 <div class="e-pf"><span class="lb">معرّفات المشروع (من الـDMS)</span><div class="e-p2"><div class="e-pf"><label>التخصص</label>${sel('disc',[['','—'],...SD.dms.disc.map(d=>[d[0],d[0]+' · '+d[1]])],a.disc,D)}</div><div class="e-pf"><label>المنطقة</label>${sel('zone',Z,a.zone,D)}</div></div>
 <div class="e-p2"><div class="e-pf"><label>المبنى</label>${sel('bld',B,a.bld,D&&a.zone)}</div><div class="e-pf"><label>الطابق</label>${sel('fl',FL,a.fl,D&&a.bld)}</div></div><small class="sc-fnt">القيم من إعدادات المشروع في الـDMS. المعرّفات تُعدَّل في أي مسودة.</small></div>
 <div class="e-p2"><div class="e-pf"><label>المدة (أيام عمل)</label><input class="sc-in" type="number" min="1" data-ep="dur" value="${a.dur}"${dis(P&&!a.ms)}></div><div class="e-pf"><label>البداية → النهاية</label><input class="sc-in" readonly value="${C.fmt(a.ps,1)} → ${a.ms?'معلم':C.fmt(a.pe,1)}"></div></div>
 ${a.pin?`<div class="e-pin2"><i class="ti ti-pin-filled"></i><span>قيد «لا يبدأ قبل» ${C.fmt(a.pin)}</span><span class="sp"></span>${P?'<button class="sc-lk" data-a="s2a-unpin">إزالة القيد</button>':''}</div>`:''}
 <div class="e-pf"><span class="lb">السوابق</span><div class="e-pl">${a.pred.map((p,i)=>`<div class="e-pli"><span class="sc-id">${p[0]}</span><span class="sc-lz">FS</span><input class="sc-in" type="number" min="0" data-ep="lag:${i}" value="${p[1]||0}" title="lag"${dis(P)}>${P?`<button class="sc-ib" data-a="s2a-pdel" data-v="${i}" aria-label="حذف العلاقة"><i class="ti ti-x"></i></button>`:'<span></span>'}</div>`).join('')||'<span class="sc-st t-amber" style="align-self:flex-start">نشاط مفتوح — بلا سابق</span>'}
 ${P?`<select class="sc-in" data-ep="padd"><option value="">+ إضافة سابق</option>${others.map(x=>`<option value="${x.id}">${x.id} · ${C.esc(x.n)}</option>`).join('')}</select>`:''}</div></div>
 <div class="e-pf"><span class="lb">اللواحق</span><div class="sc-chips">${s.acts.filter(x=>x.pred.some(p=>p[0]===a.id)).map(x=>`<span class="sc-id">${x.id}</span>`).join(' · ')||'<span class="sc-fnt">—</span>'}</div></div>
 <div class="e-pf"><label>ملاحظة</label><textarea class="sc-in" rows="2" data-ep="note"${dis(P)}>${C.esc(a.note||'')}</textarea></div>`}
function onPanel(a,f,v){if(f==='n'){if(!v.trim())return 'الاسم مطلوب';a.n=v.trim();return}if(f==='w'){a.w=v.trim()||a.w;return}if(f==='note'){a.note=v;return}
 if(f==='disc'){a.disc=v||null;return}if(f==='zone'){a.zone=v||null;a.bld=null;a.fl=null;return}if(f==='bld'){a.bld=v||null;a.fl=null;return}if(f==='fl'){a.fl=v||null;return}
 if(f==='dur'){const n=parseInt(v);if(!(n>=1))return 'المدة رقم موجب';a.dur=n;calc();return}
 if(f.startsWith('lag:')){a.pred[+f.slice(4)][1]=Math.max(0,parseInt(v)||0);calc();return}
 if(f==='padd'&&v){a.pred.push([v,0]);calc();return}}
const E=E0.create({pg:'build',ui:s.ui,acts:()=>s.acts||[],mode,cols,panel,onPanel,ce:K.ce,dd:()=>null,
 range:()=>['2026-10-25',C.addD([end(),K.ce].sort().pop(),12)],
 bar:a=>({s:a.ps,e:a.pe,ms:a.ms,crit:a.crit,pin:a.pin}),rowCls:a=>a.isNew?'chg':'',
 snap:()=>JSON.stringify(s.acts),restore:x=>{s.acts=JSON.parse(x);calc()},after:()=>{},
 onPin:(a,d)=>setPin(a,d),onDur:(a,n)=>{a.dur=n;calc()},
 onLink:(f,t)=>{const b=byId(t);if(b.pred.some(p=>p[0]===f))return 'العلاقة موجودة';if(reach(t,f))return 'العلاقة تُنشئ حلقة';b.pred.push([f,0]);calc()},
 onMove:(id,to,gk)=>{const L=s.acts;const i=L.findIndex(a=>a.id===id);const a=L.splice(i,1)[0];let j=to?L.findIndex(x=>x.id===to):-1;const G=q=>q.w.split(' / ')[0];
  if(gk!=null&&s.ui.group==='wbs'){const seg=a.w.split(' / ')[1];a.w=gk+(seg?' / '+seg:'');j=L.findIndex(x=>G(x)===gk)}else if(j>=0&&s.ui.group==='wbs'&&G(L[j])!==G(a)){const seg=a.w.split(' / ')[1];a.w=G(L[j])+(seg?' / '+seg:'')}
  L.splice(j<0?L.length:j,0,a)},
 onAdd:after=>{const L=s.acts;const i=after?L.findIndex(a=>a.id===after):L.length-1;const b=L[i]||{w:'الأرضي / جدران',zone:'Zone A',bld:'Building 1'};let n=parseInt((b.id||'F-100').slice(2))+1;while(L.some(a=>a.id==='F-'+n))n++;
  const a={id:'F-'+n,n:'نشاط جديد',w:b.w,disc:b.disc||'AR',zone:b.zone,bld:b.bld,fl:b.fl,dur:5,pred:b.id?[[b.id,0]]:[],ms:0,pin:null,note:'',isNew:1};L.splice(i+1,0,a);calc();s.ui.sel={id:a.id,k:'n'};s.ui.edit={val:''}},
 onDel:id=>del(id),
 more:()=>[{a:'s2a-replace',ic:'ti-replace',l:'استبدال الجدول',dis:mode()!=='plan'?'متاح في مسودة BL-0 فقط':null}]});
function del(id){const a=byId(id);const su=s.acts.filter(x=>x.pred.some(p=>p[0]===id));
 C.st.modal={title:'حذف '+id,ok:'حذف النشاط',tone:'dan',body:`<p>سيُحذف <b>${C.esc(a.n)}</b> من مسودة BL-0.</p>${su.length?`<div class="sc-note t-amber"><i class="ti ti-alert-triangle"></i><div>${su.map(x=>`سيُربط <span class="sc-id">${x.id}</span> ${a.pred.length?'بالسابق التالي <span class="sc-id">'+a.pred.map(p=>p[0]).join('، ')+'</span>':'ويصبح نشاطاً مفتوحاً'}`).join('<br>')}</div></div>`:''}`,
 fn:()=>{E.mut(()=>{su.forEach(x=>{const rest=x.pred.filter(p=>p[0]!==id);a.pred.forEach(p=>{if(!rest.some(q=>q[0]===p[0]))rest.push([p[0],0])});x.pred=rest});s.acts=s.acts.filter(x=>x.id!==id);if(s.ui.sel&&s.ui.sel.id===id)s.ui.sel=null;calc()});C.toast('حُذف '+id+' — Ctrl+Z للتراجع')}}}
function empty(){const o=[['tpl','ti-template','ابدأ من قالب','تشطيبات مبنى سكني · مكتبة النظام'],['xls','ti-file-spreadsheet','استيراد إكسل','قالب ربائد'],['copy','ti-copy','نسخ من مشروع سابق','جدول سابق لنفس الشركة'],['man','ti-file-pencil','إدخال يدوي','ابدأ بجدول فارغ']];
 return `<section class="sc-card g-empty"><div><h3>ابدأ جدول عقد التشطيبات</h3><p class="sc-mut">اختر مصدراً. تُحسب التواريخ من بداية العقد ${C.fmt(K.cs)} بتقويم المشروع. مصادر البداية تظهر هنا فقط، ما دام الجدول فارغاً.</p></div><div class="g-src">${o.map(([k,i,l,d])=>`<button data-a="s2a-src" data-v="${k}"${mode()==='read'&&role()==='mgr'?' disabled':''}><i class="ti ${i}"></i><b>${l}</b><small>${d}</small></button>`).join('')}</div></section>`}
function view(){const m=mode();const mgr=role()==='mgr';const dec=C.st.blDec;
 const ext=s.launched?(dec==='ok'?C.chip('خط أساس معتمد · BL-0','green'):dec==='ret'?C.chip('مُرجَع','red'):C.chip('تم التقديم — قيد المراجعة','violet')):null;
 const intl=s.launched?'':s.ret&&!s.sent?C.chip('أُعيد للتعديل — عند م. أحمد يوسف','amber'):C.chip(s.sent?'مسودة داخلية — عند م. فهد':'مسودة داخلية — عند م. أحمد','gray');
 const h=C.hdr({title:K.n+' · خط الأساس <span class="sc-bi">BL-0</span>',chips:C.lz('داخل ربائد')+(ext||intl)+C.chip(m==='plan'?'وضع التخطيط':'وضع القراءة',m==='plan'?'blue':'gray',1),sub:`<span>${K.co}</span><span>التعاقدي: <b>${C.fmt(K.cs)} – ${C.fmt(K.ce)}</b></span>${s.launched?'':`<span>BL-0 مطلوب قبل <b>${K.due}</b></span>`}<span><i class="ti ti-calendar"></i>تقويم المشروع · الجمعة عطلة</span>`});
 const ban=s.ret&&!s.sent&&!s.launched?`<div class="e-banner"><i class="ti ti-arrow-back-up"></i><div><b>أعاده م. فهد الدوسري للتعديل · ${C.fmt(C.TODAY)}</b><br>${C.esc(s.ret)}</div></div>`:'';
 if(!s.filled)return C.shell(h,ban+empty());
 const hold=!holder()&&!s.launched?`<div class="sc-note t-gray"><i class="ti ti-lock"></i>المسودة ${s.sent?'عند م. فهد الدوسري لمراجعتها':'عند م. أحمد يوسف'} — تعرضها للقراءة فقط.</div>`:'';
 const tb=m==='plan'?`<button class="sc-b out sm" data-a="s2a-add"><i class="ti ti-plus"></i>نشاط</button><button class="sc-b ter sm" data-a="s2a-del"${s.ui.sel?'':' disabled'}><i class="ti ti-trash"></i>حذف</button><button class="sc-ib" data-a="s2a-undo" title="تراجع Ctrl+Z" aria-label="تراجع"><i class="ti ti-arrow-back-up"></i></button><button class="sc-ib" data-a="s2a-redo" title="إعادة Ctrl+Y" aria-label="إعادة"><i class="ti ti-arrow-forward-up"></i></button>`:'';
 const e=end(),dv=C.days(K.ce,e),crit=s.acts.filter(a=>a.crit).length;
 const warn=dv>0?`<div class="sc-note t-amber"><i class="ti ti-alert-triangle"></i><div>نهاية الجدول تتجاوز النهاية التعاقدية بـ <b>${C.dys(dv)}</b>. تحذير ولا يمنع الإطلاق.</div></div>`:'';
 let act;if(s.launched)act=`<span class="it2">أطلقه م. فهد الدوسري · ${C.fmt(C.TODAY)}</span>${dec==='ok'||dec==='notes'?'<button class="sc-b out" data-a="s2a-oos" data-v="upd">بدء تحديث</button><button class="sc-b out" data-a="s2a-oos" data-v="rev">طلب تعديل خط الأساس</button>':C.handoff('ceng','review','عرض من جهة الاستشاري — م. سارة','bl')}`;
 else if(mgr)act=s.sent?`<span class="it2">أرسله م. أحمد يوسف</span><button class="sc-b out" data-a="s2a-ret"><i class="ti ti-arrow-back-up"></i>إرجاع للمهندس</button><button class="sc-b pri" data-a="s2a-launch"><i class="ti ti-send"></i>إطلاق كخط أساس BL-0</button>`:`<span class="it2">لم يُرسل إليك بعد</span>${C.handoff('keng','build','التبديل إلى م. أحمد')}`;
 else act=s.sent?`<span class="it2"><i class="ti ti-check"></i>أُرسل لمدير المشروع</span>${C.handoff('kmgr','build')}`:`<button class="sc-b pri" data-a="s2a-send"><i class="ti ti-send"></i>إرسال لمدير المشروع</button>`;
 const bot=`<div class="sc-bar"><span class="it2"><i class="ti ti-flag"></i>نهاية الجدول: <b>${C.fmt(e)}</b> — ${dv===0?'مطابقة للتعاقدي':dv>0?`<span class="sc-num warn">بعد التعاقدي بـ ${C.dys(dv)}</span>`:`<span class="sc-num ok">قبل التعاقدي بـ ${C.dys(dv)}</span>`}</span><span class="dv"></span><span class="it2"><i class="ti ti-list"></i><b>${s.acts.length}</b> نشاطاً · المسار الحرج <b>${crit}</b> ${crit<=10?'أنشطة':'نشاطاً'}</span><span class="sp"></span>${act}</div>`;
 return C.shell(h,ban+hold+warn+E.view(tb)+bot)}
function act(a,el){if(E.act(a,el))return;const v=el.dataset.v;
 if(a==='s2a-src'){if(v==='man'){s.acts=[{id:'F-110',n:'نشاط جديد',w:'الأرضي / جدران',disc:'AR',zone:'Zone A',bld:'Building 1',fl:'G',dur:5,pred:[],ms:0,pin:null,note:'',isNew:1}];s.filled=true;s.src='man';calc();s.ui.sel={id:'F-110',k:'n'};return}fill(v);C.toast(v==='xls'?'استُورد ملف الإكسل — 22 نشاطاً':v==='copy'?'نُسخ الجدول — 22 نشاطاً':'امتلأ الجدول من القالب — 22 نشاطاً، التواريخ محسوبة بمحرّك ربائد');return}
 if(a==='s2a-add'){E.mut(()=>E.o.onAdd(s.ui.sel&&s.ui.sel.id));return}
 if(a==='s2a-del'){s.ui.sel&&del(s.ui.sel.id);return}
 if(a==='s2a-undo'){E.undo();return}if(a==='s2a-redo'){E.redo();return}
 if(a==='s2a-unpin'){const x=byId(s.ui.sel.id);E.mut(()=>{x.pin=null;calc()});C.toast('أُزيل القيد — عاد '+x.id+' لتاريخه المحسوب');return}
 if(a==='s2a-pdel'){const x=byId(s.ui.sel.id);E.mut(()=>{x.pred.splice(+v,1);calc()});return}
 if(a==='s2a-replace'){s.ui.more=false;C.st.modal={title:'استبدال الجدول',ok:'استبدال',tone:'dan',body:'<p>ستُحذف كل أنشطة المسودة ويعود الجدول فارغاً لتختار مصدراً جديداً. لا يمكن التراجع.</p>',fn:()=>{s.filled=false;s.acts=null;s.ui.sel=null;C.toast('الجدول فارغ — اختر مصدراً')}};return}
 if(a==='s2a-send'){s.sent=true;s.ui.edit=null;C.toast('أُرسل الجدول لمدير المشروع م. فهد الدوسري');return}
 if(a==='s2a-ret'){C.st.modal={title:'إرجاع للمهندس',ok:'إرجاع',body:`<p>تعود المسودة قابلة للتحرير عند م. أحمد يوسف. الاستشاري لا يرى أي تغيير.</p><div class="sc-f"><label>ملاحظة <span class="m-req">إلزامية</span></label><textarea class="sc-in" id="ret-note" rows="3" style="height:auto;padding:10px" placeholder="ما المطلوب تعديله؟"></textarea></div>`,fn:()=>{const n=(document.getElementById('ret-note')||{}).value||'';if(!n.trim()){C.toast('الملاحظة إلزامية');return false}s.ret=n.trim();s.sent=false;C.toast('أُعيد للتعديل — عند م. أحمد يوسف')}};return}
 if(a==='s2a-launch'){C.st.modal={title:'إطلاق كخط أساس BL-0',ok:'إطلاق',body:`<p>سيصل الاستشاري تقديم خط أساس BL-0 بنهاية ${C.fmt(end())}. بعد الإطلاق يتحوّل الجدول إلى وضع القراءة، ولا يُعدَّل إلا بطلب تعديل خط الأساس.</p><div class="sc-note t-gray"><i class="ti ti-camera"></i>تُؤخذ لقطة ثابتة من الجدول ويُسجَّل مَن أطلق ومتى.</div>`,fn:()=>{s.launched=true;s.ret=null;s.ui.edit=null;C.toast('تم التقديم — قيد المراجعة')}};return}
 if(a==='s2a-oos'){C.toast(v==='upd'?'تبدأ مسودة تحديث تقدّم — الأعمدة المخططة تُقفل':'تبدأ مسودة طلب تعديل خط الأساس — التغييرات تُميَّز');return}
 return false}
// tour helpers
s.api={fill:()=>fill('tpl'),sim:()=>{const a=byId(SD.fiSim[0]);a.dur=SD.fiSim[1];calc()},calc,end};
C.screens.s2a={view,act,state:s,enter:()=>{if(s.filled)calc()}};
})();
