// Screen 1 — Project contracts (owner)
(function(){const C=SC,P=SD.project;
const s={cs:JSON.parse(JSON.stringify(SD.contracts)),dr:null,f:{},e:{},k:0};
const T0='2026-03-01',T1='2027-07-01';
const late=c=>Math.max(0,C.days(c.ds,C.TODAY));
const stat=c=>C.cStat(c,1);
const dr=(a,b)=>a?`<div class="sc-dr"><span>${C.fmt(a)}</span><span>${C.fmt(b)}</span></div>`:'<span class="sc-fnt">—</span>';
function gap(c){if(!c.ce)return '<span class="sc-fnt">—</span>';const g=C.days(c.de,c.ce);return `<span class="sc-num ${g>0?'warn':'ok'}">${C.sd(g)}</span>`}
const R=()=>C.st.role,canEdit=()=>R()==='own'||R()==='oeng';
function action(c){
 if(!c.co)return canEdit()?`<button class="sc-b out sm" data-a="assign" data-v="${c.id}"${R()==='own'?'':' disabled title="الإسناد لمدير مشروع المالك"'}><i class="ti ti-user-plus"></i>إسناد العقد</button>`:'<span class="sc-fnt">—</span>';
 return `<button class="sc-b ter sm" data-a="go" data-v="s5">عرض على اللوحة</button>`;
}
function row(c){return `<tr${!c.co&&late(c)>0?' class="hl"':''}>
 <td><b class="sc-cn">${C.esc(c.n)}</b></td>
 <td>${c.co?C.esc(c.co):'<span class="sc-mut">لم يُسند</span>'}</td>
 <td><div class="sc-dcell">${dr(c.ds,c.de)}${!c.co&&canEdit()?`<button class="sc-ib" data-a="edit" data-v="${c.id}" title="تعديل التاريخ الافتراضي" aria-label="تعديل التاريخ الافتراضي"><i class="ti ti-pencil"></i></button>`:''}</div>${c.hist?`<small class="sc-hist"><i class="ti ti-history"></i> السابق: ${C.fmt(c.hist[0])} – ${C.fmt(c.hist[1])}</small>`:''}</td>
 <td>${dr(c.cs,c.ce)}</td><td>${gap(c)}</td>
 <td>${c.mode?C.lz(c.mode==='p6'?'من P6':'داخل ربائد'):'<span class="sc-fnt">—</span>'}</td>
 <td>${c.cyc||'<span class="sc-fnt">—</span>'}</td><td>${stat(c)}</td><td>${action(c)}</td></tr>`}
function mini(){const sc=C.scale(T0,T1),dd=sc.p(P.dd);
 const grid=sc.months.map(m=>`<i class="sc-gl" style="left:${sc.p(m)}%"></i>`).join('');
 const rows=s.cs.map(c=>`<div class="sc-tl-r"><div class="sc-tl-n"><b>${C.esc(c.n)}</b><small>${c.co?C.esc(c.co):'لم يُسند'}</small></div><div class="sc-tl-t">${grid}<i class="sc-ddl" style="left:${dd}%"></i>
  ${c.co?`<i class="tl-def" style="left:${sc.p(c.ds)}%;width:${sc.w(c.ds,c.de)}%;top:18px"></i><i class="tl-con" style="left:${sc.p(c.cs)}%;width:${sc.w(c.cs,c.ce)}%;top:28px"></i>`:`<i class="tl-emp" style="left:${sc.p(c.ds)}%;width:${sc.w(c.ds,c.de)}%;top:22px"></i>`}</div></div>`).join('');
 return `<section class="sc-card"><div class="sc-card-hd"><h3>العقود على الزمن</h3><span class="sp"></span><div class="sc-lg"><span><i class="lg-def"></i>الافتراضي</span><span><i class="lg-con"></i>التعاقدي</span><span><i class="lg-emp"></i>غير موقّع</span><span><i class="lg-dd"></i>تاريخ البيانات ${C.fmt(P.dd)}</span></div></div>
 <div class="sc-card-bd"><div class="sc-tl"><div></div><div class="sc-tl-ax">${(()=>{const ms=sc.months,st=ms.length>12?3:ms.length>8?2:1,sh=ms.filter((m,i)=>i%st===0);return sh.map((m,i)=>{const l=sc.p(m),r=i<sh.length-1?sc.p(sh[i+1]):100;const d=SC.D(m);return `<span style="left:${l}%;width:${r-l}%">${SC.M[d.getUTCMonth()]}${i===0||SC.D(sh[i-1]).getUTCFullYear()!==d.getUTCFullYear()?`<small>${d.getUTCFullYear()}</small>`:''}</span>`}).join('')})()}</div>${rows}</div></div></section>`}
function drawer(){if(!s.dr)return '';const f=s.f;
 if(s.dr==='add')return `<div class="sc-scrim" data-a="dclose"></div><aside class="sc-drw"><div class="sc-drw-hd"><div><small>المخطط الافتراضي</small><h3>إضافة عقد</h3></div><button class="sc-ib" data-a="dclose" aria-label="إغلاق"><i class="ti ti-x"></i></button></div>
 <div class="sc-drw-bd"><div class="sc-f"><label>اسم العقد</label><input class="sc-in" data-in="n" value="${C.esc(f.n||'')}" placeholder="[…]"></div>
 <div class="sc-2c"><div class="sc-f"><label>البداية الافتراضية</label><input class="sc-in" type="date" data-ch="ds" value="${f.ds||''}"></div><div class="sc-f"><label>النهاية الافتراضية</label><input class="sc-in" type="date" data-ch="de" value="${f.de||''}"></div></div>
 <div class="sc-note t-gray"><i class="ti ti-info-circle"></i>يُحفظ المخطط نسخةً مؤرَّخة تُقارَن بها التواريخ التعاقدية لاحقاً. لا يراه المقاولون.</div></div>
 <div class="sc-drw-ft"><button class="sc-b ter" data-a="dclose">إلغاء</button><button class="sc-b pri" data-a="doadd"${f.ds&&f.de?'':' disabled'}>إضافة العقد</button></div></aside>`;
 const c=s.cs.find(x=>x.id===s.dr);const ok=f.co&&f.cs&&f.ce;const g=f.ce?C.days(c.de,f.ce):null;
 return `<div class="sc-scrim" data-a="dclose"></div><aside class="sc-drw"><div class="sc-drw-hd"><div><small>إسناد العقد</small><h3>${C.esc(c.n)}</h3></div><button class="sc-ib" data-a="dclose" aria-label="إغلاق"><i class="ti ti-x"></i></button></div>
 <div class="sc-drw-bd">
 <dl class="sc-kv"><dt>الافتراضي</dt><dd>${C.fmt(c.ds)} – ${C.fmt(c.de)}</dd></dl>
 <div class="sc-f"><label>شركة المقاول</label><select class="sc-in" data-ch="co"><option value="">اختر من شركات المشروع</option>${SD.companies.map(o=>`<option${f.co===o?' selected':''}>${o}</option>`).join('')}</select></div>
 <div class="sc-2c"><div class="sc-f"><label>البداية التعاقدية</label><input class="sc-in" type="date" data-ch="cs" value="${f.cs||''}"></div><div class="sc-f"><label>النهاية التعاقدية</label><input class="sc-in" type="date" data-ch="ce" value="${f.ce||''}"></div></div>
 ${g!==null?`<div class="sc-note ${g>0?'t-amber':'t-green'}"><i class="ti ti-arrows-diff"></i>الفارق عن النهاية الافتراضية: <b>${C.sd(g)}</b></div>`:''}
 <div class="sc-f"><span class="lb">دورة التحديث</span>${C.seg([['أسبوعية','أسبوعية'],['نصف شهرية','نصف شهرية']],f.cyc||'أسبوعية','cyc')}</div>
 <div class="sc-f"><span class="lb">مدة ردّ الاستشاري لكل نوع تقديم</span><div class="sc-2c"><div class="sc-f"><small>خط أساس</small><div class="sc-sfx"><input class="sc-in" type="number" min="1" data-in="rbl" value="${f.rbl||14}"><span>يوماً</span></div></div><div class="sc-f"><small>تحديث تقدّم</small><div class="sc-sfx"><input class="sc-in" type="number" min="1" data-in="rup" value="${f.rup||7}"><span>أيام</span></div></div></div></div>
 <div class="sc-swrow">${C.sw(f.end,'tg','end')}<div><b>إقرار المالك على قرارات الاستشاري</b><small>حين يُفعَّل لا يصير قرار الاستشاري نافذاً حتى يُقرّه مدير مشروع المالك.</small></div></div>
 <div class="sc-swrow">${C.sw(f.sil,'tg','sil')}<div><b>الصمت قبول</b><small>إن مرّت مدة الرد بلا قرار يُعدّ التقديم مقبولاً. مطفأ افتراضياً.</small></div></div>
 </div><div class="sc-drw-ft"><button class="sc-b ter" data-a="dclose">إلغاء</button><button class="sc-b pri" data-a="doassign"${ok?'':' disabled'}>إسناد العقد</button></div></aside>`}
function view(){
 const h=C.hdr({title:P.n,chips:'',sub:`<span><b>${s.cs.length}</b> عقود</span><span>المالك: ${P.owner}</span><button class="sc-lk" data-a="cal"><i class="ti ti-calendar"></i>تقويم المشروع: أيام العمل والعطل</button>`,right:canEdit()?`<button class="sc-b pri" data-a="add"><i class="ti ti-plus"></i>إضافة عقد</button>`:C.chip('قراءة فقط','gray',1),user:C.U.own});
 const body=`<section class="sc-card"><div class="sc-card-hd"><h3>عقود المشروع</h3><span class="sc-mut" style="font-size:13px">الفارق = النهاية التعاقدية مقابل الافتراضية</span></div><div class="sc-tbw"><table class="sc-tb"><thead><tr><th>العقد</th><th>شركة المقاول</th><th>الافتراضي</th><th>التعاقدي</th><th>الفارق</th><th>النمط</th><th>دورة التحديث</th><th>الحالة</th><th></th></tr></thead><tbody>${s.cs.map(row).join('')}</tbody></table></div></section>${mini()}`;
 return C.shell(h,body)+drawer()}
function act(a,el){const v=el.dataset.v;
 if(a==='add'){s.dr='add';s.f={};return}
 if(a==='assign'){s.dr=v;s.f={cyc:'أسبوعية',rbl:14,rup:7,end:false,sil:false};if(v==='ex')Object.assign(s.f,{cs:SD.exAssign.cs,ce:SD.exAssign.ce});return}
 if(a==='dclose'){s.dr=null;return}
 if(a==='cyc'){s.f.cyc=v;return}
 if(a==='tg'){s.f[v]=!s.f[v];return}
 if(a==='doadd'){if(!s.f.n){C.toast('أدخل اسم العقد');return}s.cs.push({id:'n'+(++s.k),n:s.f.n,co:null,mode:null,ds:s.f.ds,de:s.f.de});s.dr=null;C.toast('أُضيف العقد إلى المخطط الافتراضي');return}
 if(a==='doassign'){const c=s.cs.find(x=>x.id===s.dr);Object.assign(c,{co:s.f.co,cs:s.f.cs,ce:s.f.ce,cyc:s.f.cyc,pending:true,mode:null});s.dr=null;C.toast('أُسند العقد — مساحة الجدول فُتحت للمقاول');return}
 if(a==='edit'){const c=s.cs.find(x=>x.id===v);s.e={id:v,ds:c.ds,de:c.de};
  C.st.modal={title:'تعديل التاريخ الافتراضي',ok:'حفظ التعديل',body:`<p><b>${C.esc(c.n)}</b></p><div class="sc-2c"><div class="sc-f"><label>البداية الافتراضية</label><input class="sc-in" type="date" data-in="eds" value="${c.ds}"></div><div class="sc-f"><label>النهاية الافتراضية</label><input class="sc-in" type="date" data-in="ede" value="${c.de}"></div></div><div class="sc-note t-blue"><i class="ti ti-history"></i>سيُحفظ التاريخ السابق في السجل.</div>`,
  fn:()=>{const c2=s.cs.find(x=>x.id===s.e.id);if(s.e.ds===c2.ds&&s.e.de===c2.de)return;c2.hist=[c2.ds,c2.de];c2.ds=s.e.ds;c2.de=s.e.de;C.toast('حُدّث التاريخ الافتراضي وحُفظ السابق في السجل')}};return}
 if(a==='cal'){C.st.modal={title:'تقويم المشروع',ok:'إغلاق',noCancel:true,body:`<dl class="sc-kv"><dt>أيام العمل</dt><dd>6 أيام — السبت إلى الخميس</dd><dt>العطلة الأسبوعية</dt><dd>الجمعة</dd><dt>العطل</dt><dd>${SD.holL.map(h=>h[1]+' — '+C.fmt(h[0])).join('<br>')}</dd></dl><div class="sc-note t-gray"><i class="ti ti-info-circle"></i>العقود «داخل ربائد» ترث هذا التقويم، ويضيف المقاول عطله الخاصة داخل BL-0 فيراجعها الاستشاري.</div>`};return}
 return false}
function inp(k,el){if(k==='eds'||k==='ede')s.e[k.slice(1)]=el.value;else s.f[k]=el.value}
function ch(k,el){s.f[k]=el.value}
s.api={assign:()=>{const c=s.cs.find(x=>x.id==='ex');Object.assign(c,{co:SD.exAssign.co,cs:SD.exAssign.cs,ce:SD.exAssign.ce,cyc:SD.exAssign.cyc,pending:true})}};
C.screens.s1={view,act,inp,ch,state:s};
})();
