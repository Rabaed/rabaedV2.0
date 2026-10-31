// Screen 3 — XER / Excel upload + import summary (structure contract, from P6)
(function(){const C=SC,K=SD.contracts[0],X=SD.xer;
const s={sent:false,step:1,file:false,err:false,type:'upd',reason:null,note:'',miss:{A1040:null,A2210:null},pick:null,role:'eng',launched:false,saved:false,
 rows:X.shifted.map(r=>({id:r[0],n:r[1],pe:r[2],ne:r[3],d:r[4],r:r[5],why:r[6],dep:!r[5],ev:false}))};
const unresolved=()=>Object.keys(s.miss).filter(k=>!s.miss[k]);
const endDiff=C.days(K.ce,X.end);
function stepper(){const L=['الرفع','ملخص الاستيراد','المراجعة الداخلية والإطلاق'];
 return `<ol class="x-stp">${L.map((l,i)=>`<li class="${s.step===i+1?'on':s.step>i+1?'dn':''}"><span>${s.step>i+1?'<i class="ti ti-check"></i>':i+1}</span>${l}</li>`).join('')}</ol>`}
function step1(){
 const dz=s.err?`<div class="x-dz err"><i class="ti ti-file-alert"></i><b>تعذّر قراءة الملف</b><span>ترميز الملف غير مقروء. صدّر XER من P6 مرة أخرى بترميز UTF-8 ثم أعد المحاولة.</span><button class="sc-b out sm" data-a="retry"><i class="ti ti-refresh"></i>إعادة المحاولة</button></div>`
 :s.file?`<div class="x-file"><i class="ti ti-file"></i><div><b class="sc-id">${X.file}</b><small>${X.size} · جاهز للتحليل</small></div><button class="sc-ib" data-a="rmfile" aria-label="إزالة الملف"><i class="ti ti-x"></i></button></div>`
 :`<button class="x-dz" data-a="drop"><i class="ti ti-cloud-upload"></i><b>اسحب ملف XER أو إكسل هنا</b><span>أو اضغط للاختيار من جهازك</span></button>`;
 const card=(k,t,d,ic)=>`<button class="x-opt${s.type===k?' on':''}" data-a="type" data-v="${k}"><i class="ti ${ic}"></i><div><b>${t}</b><small>${d}</small></div><span class="x-rd"></span></button>`;
 return `${dz}<div class="x-row"><button class="sc-lk" data-a="tplx"><i class="ti ti-download"></i>تنزيل قالب الإكسل</button>${!s.file&&!s.err?'<button class="sc-lk x-demo" data-a="bad">(نموذج) ملف بترميز غير مقروء</button>':''}</div>
 <div class="sc-f"><span class="lb">نوع التقديم <span class="m-req">إلزامي</span></span><div class="x-opts">${card('upd','تحديث تقدّم','يُقارَن بآخر تحديث مقبول وبخط الأساس النشط','ti-progress')}${card('bl','طلب تعديل خط الأساس','يحتاج سبباً إلزامياً ويعتمده الاستشاري','ti-arrows-diff')}</div></div>
 ${s.type==='bl'?`<div class="sc-f"><span class="lb">سبب التعديل <span class="m-req">إلزامي</span></span><div class="sc-chips">${C.REASONS.map(r=>`<button class="sc-chipb t-${C.RT[r]}${s.reason===r?' on':''}" data-a="reason" data-v="${r}">${r}</button>`).join('')}</div><input class="sc-in" data-in="note" value="${C.esc(s.note)}" placeholder="سطر يشرح السبب […]"></div>`:''}`}
function step2(){const st=(v,l,ic)=>`<div class="x-stat"><i class="ti ${ic}"></i><b>${v}</b><span>${l}</span></div>`;
 const miss=Object.keys(s.miss).map(k=>{const r=s.miss[k];return `<div class="x-mrow"><span class="sc-id">${k}</span>${r?`<span class="sc-st t-green"><i></i>${r==='unlink'?'فُكّ الرابط':'أُعيد الإسناد إلى […]'}</span><button class="sc-lk" data-a="undo" data-v="${k}">تراجع</button>`:s.pick===k?`<select class="sc-in" data-ch="re" data-v="${k}" style="width:220px;height:34px"><option value="">اختر النشاط البديل</option><option>[…]</option></select><button class="sc-lk" data-a="pick" data-v="">إلغاء</button>`:`<button class="sc-b out sm" data-a="pick" data-v="${k}">إعادة الإسناد</button><button class="sc-b ter sm" data-a="unlink" data-v="${k}">فكّ الرابط</button>`}</div>`}).join('');
 return `<div class="x-stats">${st(X.acts,'نشاطاً','ti-list')}${st(X.rels,'علاقة','ti-git-branch')}${st(C.fmt(X.dd),'تاريخ البيانات في الملف','ti-calendar')}${`<div class="x-stat warn"><i class="ti ti-flag"></i><b>${C.fmt(X.end)}</b><span>نهاية الجدول — بعد التعاقدي بـ ${C.dys(endDiff)} · ${C.sd(X.vsU14)} عن U-14</span></div>`}</div>
 <div class="x-sec"><h4>المطابقة برقم النشاط</h4><div class="x-match"><div><b>${X.matched}</b><span>مُطابَق</span></div><div><b>${X.added}</b><span>جديدة</span></div><div class="bad"><b>${X.missing.length}</b><span>اختفت</span></div></div>
 <div class="x-miss${unresolved().length?'':' ok'}"><div class="x-mhd"><i class="ti ${unresolved().length?'ti-alert-triangle':'ti-circle-check'}"></i><div><b>رقمان اختفيا من الملف: <span class="sc-id">A1040</span> و<span class="sc-id">A2210</span></b><small>مرتبطان بتعليقات أو أدلة؛ أعد الإسناد أو فكّ الرابط قبل الإطلاق.</small></div></div>${miss}</div></div>
 <div class="x-sec"><h4>فحص جودة الشبكة</h4><div class="x-q">${X.q.map(([l,n])=>`<div><span>${l}</span><b>${n}</b></div>`).join('')}</div><small class="sc-mut">علاقات SS/FF والقيود تُعرض كما في الملف ولا تُحسب. التواريخ والعائم والمسار الحرج من الملف كما هي.</small></div>`}
function step3(){const un=unresolved();
 return `<div class="x-sec"><h4>الأنشطة التي انزاحت عن التحديث السابق</h4><div class="sc-tbw"><table class="sc-tb"><thead><tr><th>الرقم</th><th>الاسم</th><th>النهاية السابقة</th><th>الجديدة</th><th>الفرق</th><th>سبب التأخير</th><th>رابط دليل</th></tr></thead><tbody>
 ${s.rows.map((r,i)=>`<tr><td><span class="sc-id">${r.id}</span></td><td><b class="sc-cn" style="font-size:13.5px;white-space:nowrap">${r.n}</b></td><td class="r-nw">${C.fmt(r.pe,1)}</td><td class="r-nw"><b>${C.fmt(r.ne,1)}</b></td><td><span class="sc-num bad">${C.sd(r.d)}</span></td>
 <td><select class="sc-in x-rsel" data-ch="rr" data-v="${i}"${s.launched?' disabled':''}><option value="">${r.dep?'تبعاً — بلا سبب مستقل':'اختر السبب'}</option>${C.REASONS.map(q=>`<option${r.r===q?' selected':''}>${q}</option>`).join('')}</select><small class="sc-hist">${r.why}</small></td>
 <td>${r.ev?'<span class="sc-st t-green"><i></i>طلب فحص […]</span>':`<button class="sc-lk" data-a="ev" data-v="${i}"${s.launched?' disabled':''}><i class="ti ti-link"></i>ربط</button>`}</td></tr>`).join('')}</tbody></table></div>
 <small class="sc-mut">أسباب التأخير وروابط الأدلة طبقة داخل ربائد لا يحملها الملف، وتبقى مربوطة برقم النشاط عبر الرفعات.</small></div>
 ${un.length?`<div class="sc-note t-red"><i class="ti ti-lock"></i><div>الإطلاق معطّل: <span class="sc-id">${un.join('</span> و<span class="sc-id">')}</span> بلا إسناد. <button class="sc-lk" data-a="to2">إعادة الإسناد</button></div></div>`:''}`}
function done(){return `<div class="x-done"><span class="sc-st t-violet" style="height:30px;font-size:13px"><i></i>تم التقديم — قيد المراجعة</span><h3>${s.type==='bl'?'طلب تعديل خط الأساس':'التحديث U-15'} في وارد الاستشاري</h3><p class="sc-mut">أطلقه ${C.U.smgr.n} · ${C.fmt(C.TODAY)} · قُدّم متأخراً ${C.dys(X.late)} · مدة الرد ${s.type==='bl'?14:7} ${s.type==='bl'?'يوماً':'أيام'} تبدأ من الإطلاق.</p>${C.handoff('ceng','review','عرض من جهة الاستشاري — م. سارة','p6')}</div>`}
function view(){s.role=C.st.role==='smgr'?'mgr':'eng';const u=s.role==='eng'?C.U.seng:C.U.smgr;const un=unresolved();const mgr=s.role==='mgr';
 const h=C.hdr({title:K.n,chips:C.lz('من P6')+C.lz('BL-0')+(s.launched?C.chip('تم التقديم — قيد المراجعة','violet'):C.chip(s.saved?'مسودة داخلية — محفوظة':'مسودة داخلية','gray')),sub:`<span>${K.co}</span><span>آخر تحديث مقبول: <b><span class="sc-bi">U-14</span> · 17 سبتمبر</b></span>${s.launched?'':`<span style="color:var(--tone-red-fg)"><i class="ti ti-clock-exclamation"></i>U-15 مستحق ${C.fmt(X.dd,1)} — متأخر ${C.dys(X.late)}</span>`}<span>النهاية التعاقدية: <b>${C.fmt(K.ce)}</b></span>`,right:'',user:u});
 const can1=s.file&&!s.err&&(s.type==='upd'||s.reason);
 const ft=s.launched?'':s.step===1?`<div class="x-ft"><span class="sp"></span><button class="sc-b pri" data-a="next"${can1?'':' disabled'}>تحليل الملف<i class="ti ti-arrow-left"></i></button></div>`
 :s.step===2?`<div class="x-ft"><button class="sc-b ter" data-a="back"><i class="ti ti-arrow-right"></i>رجوع</button><span class="sp"></span><button class="sc-b pri" data-a="next">متابعة<i class="ti ti-arrow-left"></i></button></div>`
 :`<div class="x-ft"><button class="sc-b ter" data-a="back"><i class="ti ti-arrow-right"></i>رجوع</button><span class="sp"></span><button class="sc-b out" data-a="save">حفظ كمسودة داخلية</button>${!mgr?(s.sent?`<span class="it2" style="font-size:13px">أُرسل لمدير المشروع</span>${C.handoff('smgr','upload','التبديل إلى مدير المشروع')}`:`<button class="sc-b pri" data-a="send"${un.length?' disabled title="أعد إسناد الرقمين أولاً"':''}><i class="ti ti-send"></i>إرسال لمدير المشروع</button>`):''}<button class="sc-b pri" data-a="launch" style="${mgr?'':'display:none'}"${!mgr||un.length||s.rows.some(r=>!r.r&&!r.dep)?' disabled':''} title="${!mgr?'الإطلاق لمدير مشروع المقاول':un.length?'أعد إسناد '+un.join(' و')+' أولاً':s.rows.some(r=>!r.r&&!r.dep)?'سبب التأخير إلزامي على كل نشاط منزاح':''}"><i class="ti ti-send"></i>${s.type==='bl'?'إطلاق طلب التعديل':'إطلاق التحديث U-15'}</button></div>`;
 const body=`<div class="x-card sc-card">${s.launched?done():stepper()+`<div class="x-bd">${s.step===1?step1():s.step===2?step2():step3()}</div>`+ft}</div>`;
 return C.shell(h,body)}
function act(a,el){const v=el.dataset.v;
 if(a==='send'){s.sent=true;C.toast('أُرسل لمدير المشروع — المسودة داخلية');return}
 if(a==='drop'){s.file=true;s.err=false;return}
 if(a==='bad'){s.err=true;return}
 if(a==='retry'){s.err=false;s.file=false;return}
 if(a==='rmfile'){s.file=false;return}
 if(a==='tplx'){C.toast('نُزّل قالب الإكسل');return}
 if(a==='type'){s.type=v;return}
 if(a==='reason'){s.reason=s.reason===v?null:v;return}
 if(a==='next'){s.step++;return}
 if(a==='back'){s.step--;return}
 if(a==='to2'){s.step=2;return}
 if(a==='pick'){s.pick=v||null;return}
 if(a==='unlink'){s.miss[v]='unlink';return}
 if(a==='undo'){s.miss[v]=null;return}
 if(a==='ev'){s.rows[+v].ev=true;return}
 if(a==='save'){s.saved=true;C.toast('حُفظ كمسودة داخلية — لا يراه أحد خارج الشركة');return}
 if(a==='launch'){C.st.modal={title:s.type==='bl'?'إطلاق طلب تعديل خط الأساس':'إطلاق التحديث U-15',ok:'إطلاق',body:`<p>سيصل الاستشاري ${s.type==='bl'?'طلب تعديل خط الأساس':'تحديث التقدّم U-15'} بتاريخ بيانات ${C.fmt(X.dd)}، ويُبلَّغ المالك بحالة «قيد المراجعة».</p><div class="sc-note t-gray"><i class="ti ti-camera"></i>تُؤخذ لقطة ثابتة من الملف ولا تُعدَّل بعد الإطلاق.</div>`,fn:()=>{s.launched=true;C.toast('تم التقديم — قيد المراجعة')}};return}
 return false}
function inp(k,el){if(k==='note')s.note=el.value}
function ch(k,el){if(k==='re'&&el.value){s.miss[el.dataset.v]='re';s.pick=null}if(k==='rr')s.rows[+el.dataset.v].r=el.value||null}
C.screens.s3={view,act,inp,ch,state:s};
})();
