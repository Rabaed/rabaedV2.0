// Screen 2(b) — mobile progress update (MEP site engineer, U-6 draft). Writes into the same draft as 2(c).
(function(){const C=SC,K=SD.contracts[1],U6=SD.u6;
const s={tab:'week',sel:null,dr:null,pick:null,net:true,q:[]};
const M=()=>C.ME,D=()=>C.ME.state;
function stLbl(v,x){if(x.ms)return C.chip('معلم','gray',1);if(v.f)return C.chip('منتهٍ '+C.fmt(v.f,1),'green');if(v.a)return C.chip('جارٍ '+v.p+'%','blue');return C.chip('لم يبدأ','gray')}
function card(x){const v=M().val(x.id);const miss=v.shift&&!(D().rows[x.id]||{}).r;const q=s.q.includes(x.id);
 return `<button class="m-card${miss?' warn':''}" data-a="m-open" data-v="${x.id}"><div class="m-c1"><b>${C.esc(x.n)}</b><span class="sc-id">${x.id}</span></div>
 <div class="m-c2"><span><i class="ti ti-map-pin"></i>${x.fl?'الطابق '+x.fl:C.esc(x.w)}</span><span><i class="ti ti-calendar"></i>${C.fmt(x.ps,1)} – ${C.fmt(x.pe,1)}</span></div>
 <div class="m-c3">${stLbl(v,x)}${v.shift?`<span class="sc-num warn">متوقع ${C.fmt(v.fe,1)}</span>`:''}<span class="sp"></span>${q?'<span class="m-q"><i class="ti ti-cloud-upload"></i>سيُحفظ عند الاتصال</span>':v.src?`<span class="m-ok"><i class="ti ti-check"></i>حُدّث ${C.fmt(v.srcD,1)}${v.src==='web'?' · ويب':''}</span>`:'<span class="sc-fnt">بانتظار التحديث</span>'}</div>
 ${miss?'<div class="m-miss"><i class="ti ti-alert-triangle"></i>انزاحت النهاية بلا سبب تأخير</div>':''}</button>`}
function dateRow(k,lbl){const d=s.dr;const v=d[k];return `<div class="m-dt"><span>${lbl}</span><b>${v?C.fmt(v):'—'}</b>${s.pick===k?`<input class="sc-in" type="date" min="${U6.min}" max="${M().MAX}" value="${v||M().MAX}" data-ch="m-date" data-v="${k}">`:`<button class="sc-lk" data-a="m-pick" data-v="${k}">${v?'تاريخ آخر':'اختر تاريخاً'}</button>`}</div>`}
function sheet(){if(!s.sel)return '';const x=M().MA.find(a=>a.id===s.sel),d=s.dr;const base=M().val(x.id);
 const fe=d.f||(d.rem!=null&&d.rem!==base.rem?C.addWd(U6.dd,d.rem):base.fe);const shift=fe>base.prev;const need=shift&&!d.r;
 return `<div class="m-scrim" data-a="m-close"></div><div class="m-sheet"><div class="m-grab"></div><div class="m-sh-hd"><div><small class="sc-id">${x.id}</small><b>${C.esc(x.n)}</b><small>المخطط: ${C.fmt(x.ps,1)} – ${C.fmt(x.pe,1)} · ${x.dur} ${C.unit(x.dur)}</small></div><button class="sc-ib" data-a="m-close" aria-label="إغلاق"><i class="ti ti-x"></i></button></div>
 <div class="m-sh-bd">
 <div class="m-2b"><button class="m-big${d.a?' on':''}" data-a="m-started"${base.a?' disabled':''}><i class="ti ti-player-play"></i>${d.a?'بدأ':'بدأ اليوم'}</button><button class="m-big${d.f?' on':''}" data-a="m-finished"${base.f?' disabled':''}><i class="ti ti-square-check"></i>${d.f?'انتهى':'انتهى اليوم'}</button></div>
 ${d.a&&!base.a?dateRow('a','البداية الفعلية'):''}${d.f&&!base.f?dateRow('f','النهاية الفعلية'):''}
 <small class="sc-fnt" style="display:block;margin:-4px 0 4px">يقترح اليوم ${C.fmt(C.TODAY,1)}. أي تاريخ آخر بين ${C.fmt(U6.min,1)} و${C.fmt(M().MAX,1)} — لا مستقبل.</small>
 <div class="sc-f"><div class="m-lbl"><span class="lb">نسبة الإنجاز</span><b id="m-pct">${d.p}%</b></div><input type="range" class="m-rng" min="0" max="100" step="10" value="${d.p}" data-ch="m-pct" data-in="m-pct" aria-label="نسبة الإنجاز"${d.a?'':' disabled'}></div>
 <div class="sc-f"><label>المدة المتبقية (أيام)</label><div class="m-rem"><button class="m-stp" data-a="m-rem" data-v="-1" aria-label="إنقاص"${d.f?' disabled':''}>−</button><input class="sc-in" type="number" min="0" value="${d.f?0:d.rem}" data-ch="m-remv"${d.f?' disabled':''}><button class="m-stp" data-a="m-rem" data-v="1" aria-label="زيادة"${d.f?' disabled':''}>+</button></div><small>النهاية المتوقعة ${C.fmt(fe,1)}</small></div>
 ${shift?`<div class="sc-f"><span class="lb">سبب التأخير <span class="m-req">إلزامي</span></span><div class="m-note t-amber"><i class="ti ti-alert-triangle"></i>النهاية انزاحت عن ${C.fmt(base.prev,1)} — اختر السبب</div><div class="sc-chips">${C.REASONS.map(r=>`<button class="sc-chipb t-${C.RT[r]}${d.r===r?' on':''}" data-a="m-reason" data-v="${r}">${r}</button>`).join('')}</div></div>`:''}
 <div class="sc-f"><label>ربط طلب فحص <span class="sc-fnt">(اختياري)</span></label><select class="sc-in" data-ch="m-ir"><option value="">بلا ربط</option><option value="1"${d.ir?' selected':''}>طلب فحص […]</option></select></div>
 </div><div class="m-sh-ft"><button class="sc-b pri lg" data-a="m-save"${need?' disabled':''} style="width:100%">${need?'اختر سبب التأخير للحفظ':'حفظ'}</button></div></div>`}
function view(){const st=D();const P=M().period();const all=M().acts0();const list=s.tab==='week'?P:all;const n=P.filter(a=>st.rows[a.id]).length;
 const ph=C.hdr({title:'التحديث من الجوال',chips:C.lz('داخل ربائد')+C.chip('مسودة U-6','gray',1),sub:`<span>${K.n} · ${K.co}</span><span>دورة التحديث: <b>أسبوعية</b></span>`});
 const locked=st.sent||st.launched;
 const body=!st.started?`<div class="m-list" style="display:flex;flex-direction:column;gap:12px;padding:24px 18px;text-align:center"><i class="ti ti-calendar-plus" style="font-size:34px;color:var(--ui-muted)"></i><b style="font-size:16px">لا توجد مسودة تحديث</b><span class="sc-mut" style="font-size:13.5px">ابدأ مسودة U-6 بتاريخ بيانات ${C.fmt(U6.dd)}.</span><button class="sc-b pri lg" data-a="m-start">بدء مسودة U-6</button></div>`
 :`<div class="m-sum"><div><b>${P.length}</b> أنشطة الفترة · <b>${n}</b> حُدّثت · <b>${P.length-n}</b> متبقية</div><div class="m-pb"><i style="width:${P.length?n/P.length*100:0}%"></i></div></div>
 <div class="m-tabs"><button class="${s.tab==='week'?'on':''}" data-a="m-tab" data-v="week">أنشطة الفترة</button><button class="${s.tab==='all'?'on':''}" data-a="m-tab" data-v="all">كل الأنشطة</button></div>
 <div class="m-list" data-keep="ml">${list.map(card).join('')}</div>
 <div class="m-foot"><div class="m-fc"><small>النهاية المتوقعة للعقد</small><b>${C.fmt(K.fe)} <span class="sc-num bad">(${C.sd(C.days(K.ce,K.fe))})</span></b></div><button class="sc-b ${locked?'out':'pri'} lg" data-a="m-send"${locked||C.st.role!=='meng'?' disabled':''}>${locked?'<i class="ti ti-check"></i>أُرسل':'إرسال لمدير المشروع'}</button></div>`;
 return C.shell(ph,`<div class="m-canvas"><div class="m-side"><b>جوال مهندس الموقع</b><span>ما تحفظه هنا يظهر فوراً في شاشة التحديث على الويب بمصدره «حُدّث من الجوال».</span>${st.started?`<div style="margin-top:10px">${C.handoff(C.st.role,'webupd','فتح المسودة على الويب')}</div>`:''}${st.sent?`<div class="sc-note t-green" style="margin-top:10px"><i class="ti ti-circle-check"></i>أُرسل لمدير المشروع م. طارق العنزي</div>`:''}<small style="margin-top:10px">معاينة 390 × 844</small></div>
 <div class="m-phone"><div class="m-scr">
 <header class="m-hd"><div class="m-hd1"><div><h1>تحديث U-6</h1><small>${K.n} · تاريخ البيانات ${C.fmt(U6.dd)}</small></div><button class="sc-ib m-net${s.net?'':' off'}" data-a="m-net" aria-label="حالة الشبكة" title="${s.net?'متصل':'شبكة ضعيفة'}"><i class="ti ${s.net?'ti-wifi':'ti-antenna-bars-5'}"></i></button></div>
 ${s.net?'':'<div class="m-off"><i class="ti ti-cloud"></i>شبكة ضعيفة — التعديلات تُحفظ عند الاتصال</div>'}</header>
 ${body}
 <nav class="m-nav"><button><i class="ti ti-home"></i>الرئيسية</button><button class="on"><i class="ti ti-calendar-stats"></i>الجدول</button><button><i class="ti ti-file-text"></i>التقديمات</button><button><i class="ti ti-bell"></i>التنبيهات</button></nav>
 ${sheet()}</div></div></div>`)}
function act(a,el){const v=el.dataset.v,d=s.dr;
 if(a==='m-tab'){s.tab=v;return}
 if(a==='m-start'){D().started=true;D().by='meng';C.toast('بدأت مسودة U-6 — مسودة داخلية لا يراها الاستشاري');return}
 if(a==='m-net'){s.net=!s.net;if(s.net&&s.q.length){s.q=[];C.toast('حُفظت التعديلات المعلّقة')}return}
 if(a==='m-open'){if(D().sent||D().launched){C.toast('المسودة عند مدير المشروع — للقراءة فقط');return false}const b=M().val(v);s.sel=v;s.pick=null;s.dr={a:b.a,f:b.f,p:b.p,rem:b.rem,r:(D().rows[v]||{}).r||null,ir:(D().rows[v]||{}).ir||null};return}
 if(a==='m-close'){s.sel=null;return}
 if(a==='m-started'){if(!d.a){d.a=C.TODAY;if(!d.p)d.p=10}return}
 if(a==='m-finished'){if(!d.a)d.a=C.TODAY;d.f=C.TODAY;d.p=100;d.rem=0;return}
 if(a==='m-pick'){s.pick=v;return}
 if(a==='m-rem'){d.rem=Math.max(0,(d.rem||0)+ +v);return}
 if(a==='m-reason'){d.r=d.r===v?null:v;return}
 if(a==='m-save'){const b=M().val(s.sel);const p={};['a','f','p','r','ir'].forEach(k=>{if(d[k]!==(k==='r'||k==='ir'?(D().rows[s.sel]||{})[k]||null:b[k]))p[k]=d[k]});if(d.rem!==b.rem&&!d.f)p.rem=d.rem;
  if(Object.keys(p).length){if(p.a){const e=M().bound(p.a);if(e){C.toast(e);return}}if(p.f){const e=M().bound(p.f);if(e){C.toast(e);return}}M().setVal(s.sel,p,'mobile');if(!s.net)s.q.push(s.sel)}s.sel=null;C.toast(s.net?'حُفظ — يظهر على الويب «حُدّث من الجوال»':'سيُحفظ عند الاتصال');return}
 if(a==='m-send'){D().sent=true;C.toast('أُرسل لمدير المشروع م. طارق العنزي');return}
 return false}
function inp(k,el){if(k==='m-pct'){const o=document.getElementById('m-pct');o&&(o.textContent=el.value+'%')}}
function ch(k,el){const d=s.dr;if(!d)return false;
 if(k==='m-pct'){d.p=+el.value;if(d.p===100){d.f=d.f||C.TODAY;d.rem=0}else d.f=null;const x=M().MA.find(q=>q.id===s.sel);if(!d.f)d.rem=Math.round(x.dur*(1-d.p/100))}
 if(k==='m-remv'){d.rem=Math.max(0,parseInt(el.value)||0)}
 if(k==='m-ir')d.ir=el.value||null;
 if(k==='m-date'){const e=M().bound(el.value);if(e){C.toast(e);return}d[el.dataset.v]=el.value;s.pick=null}}
C.screens.s2b={view,act,inp,ch,state:s};
})();
