// Screen 5 — owner dashboard (opening state → after the tour, computed from what happened)
(function(){const C=SC,P=SD.project;
const s={def:false,defSeen:false,sel:null,dev:'desk'};
const CS=()=>C.screens.s1.state.cs;
const T0='2026-03-01',T1='2027-06-01';
const fiOk=()=>C.st.blDec==='ok'||C.st.blDec==='notes';
function info(c){if(c.id==='fi')return fiOk()?{bl:true,act:0,pl:0,fe:C.screens.s2a.state.api.end()}:{bl:false};if(!c.co||c.id==='ex')return {bl:false};return {bl:true,act:c.act,pl:c.pl,fe:c.fe}}
function kpi(){const cs=CS();const B=cs.filter(c=>info(c).bl);const W=c=>C.days(c.cs,c.ce);const tw=B.reduce((n,c)=>n+W(c),0);
 const act=Math.round(B.reduce((n,c)=>n+info(c).act*W(c),0)/tw),pl=Math.round(B.reduce((n,c)=>n+info(c).pl*W(c),0)/tw);
 const noBL=cs.filter(c=>!info(c).bl);const complete=fiOk();const fe=complete?B.reduce((m,c)=>info(c).fe>m?info(c).fe:m,'0'):P.ce;
 const late=B.filter(c=>info(c).fe>c.ce).length;const S=C.subCount();return {act,pl,fe,noBL,complete,late,B,S}}
const tone=d=>d>15?'red':d>0?'amber':'green';
function rowTL(c,sc,own){const dd=sc.p(P.dd);const grid=sc.months.map(m=>`<i class="sc-gl" style="left:${sc.p(m)}%"></i>`).join('');const I=info(c);
 const head=`<div class="sc-tl-n"><b>${c.n}</b><small>${c.co?C.esc(c.co):'لم يُسند'}</small><div class="row">${C.cStat(c)}</div></div>`;
 const def=own&&s.def?`<i class="tl-def" style="left:${sc.p(c.ds)}%;width:${sc.w(c.ds,c.de)}%;top:14px"></i>`:'';
 if(!c.co)return `<div class="sc-tl-r clk" data-a="d-sel" data-v="${c.id}">${head}<div class="sc-tl-t">${grid}<i class="sc-ddl" style="left:${dd}%"></i>${def}<i class="tl-emp" style="left:${sc.p(c.ds)}%;width:${sc.w(c.ds,c.de)}%;top:24px"></i></div><div class="sc-tl-e"><span class="sc-fnt">—</span></div></div>`;
 if(!I.bl)return `<div class="sc-tl-r clk" data-a="d-sel" data-v="${c.id}">${head}<div class="sc-tl-t">${grid}<i class="sc-ddl" style="left:${dd}%"></i>${def}<i class="tl-con" style="left:${sc.p(c.cs)}%;width:${sc.w(c.cs,c.ce)}%;top:24px"></i></div><div class="sc-tl-e"><span class="sc-fnt">بلا خط أساس</span></div></div>`;
 const dv=C.days(c.ce,I.fe);
 return `<div class="sc-tl-r clk" data-a="d-sel" data-v="${c.id}">${head}<div class="sc-tl-t">${grid}<i class="sc-ddl" style="left:${dd}%"></i>${def}<i class="tl-con" style="left:${sc.p(c.cs)}%;width:${sc.w(c.cs,c.ce)}%;top:24px" title="التعاقدي ${C.fmt(c.cs)} – ${C.fmt(c.ce)}"><i style="width:${I.act}%"></i></i><i class="tl-fc t-${tone(dv)}" style="left:${sc.p(c.cs)}%;width:${sc.w(c.cs,I.fe)}%;top:44px" title="المتوقع ${C.fmt(I.fe)}"></i></div>
 <div class="sc-tl-e"><span class="sc-num ${dv>15?'bad':dv>0?'warn':'ok'}">${C.sd(dv)}</span><span>${C.fmt(I.fe)}</span><small class="sc-fnt">${I.act}% / ${I.pl}%</small></div></div>`}
function axis(sc){const ms=sc.months,st=ms.length>12?3:ms.length>8?2:1,sh=ms.filter((m,i)=>i%st===0);return sh.map((m,i)=>{const l=sc.p(m),r=i<sh.length-1?sc.p(sh[i+1]):100;const d=C.D(m);return `<span style="left:${l}%;width:${r-l}%">${C.M[d.getUTCMonth()]}${i===0||C.D(sh[i-1]).getUTCFullYear()!==d.getUTCFullYear()?`<small>${d.getUTCFullYear()}</small>`:''}</span>`}).join('')}
function timeline(list,own,a,b){const sc=C.scale(a,b);
 return `<section class="sc-card"><div class="sc-card-hd"><h3>العقود على الزمن</h3><span class="sp"></span><div class="sc-lg">${own&&s.def?'<span><i class="lg-def"></i>الافتراضي</span>':''}<span><i class="lg-con"></i>التعاقدي</span><span><i class="lg-act"></i>الفعلي</span><span><i class="lg-fc"></i>المتوقع</span>${own?'<span><i class="lg-emp"></i>غير موقّع</span>':''}<span><i class="lg-dd"></i>تاريخ البيانات ${C.fmt(P.dd)}</span></div></div>
 <div class="sc-card-bd"><div class="sc-tl x3"><div></div><div class="sc-tl-ax">${axis(sc)}</div><div class="sc-tl-e" style="border:0;font-weight:600">الفارق · المتوقعة</div>${list.map(c=>rowTL(c,sc,own)).join('')}</div></div></section>`}
function subsChips(S){return `${S.ok?C.chip('مقبول '+S.ok,'green'):''}${S.rev?C.chip('قيد المراجعة '+S.rev,'violet'):''}${S.ret?C.chip('مُرجَع '+S.ret,'red'):''}${S.late?C.chip('متأخر عن موعده '+S.late,'red'):''}`}
function answers(k){const dv=C.days(P.ce,k.fe);const ex=CS().find(c=>c.id==='ex');
 const when=k.complete?`<b>${C.fmt(k.fe)}</b><div>${dv<0?`<span class="sc-num ok">قبل التعاقدي بـ ${C.dys(dv)}</span>`:dv>0?`<span class="sc-num bad">${C.sd(dv)}</span>`:'مطابق للتعاقدي'}</div>${k.noBL.length?`<div class="sc-note t-amber" style="padding:7px 10px"><i class="ti ti-alert-triangle"></i>${k.noBL.map(c=>c.n).join('، ')} بلا خط أساس بعد</div>`:''}`
  :`<b>${C.fmt(k.fe)}</b><div class="sc-mut">مطابق للتعاقدي</div><div class="sc-note t-amber" style="padding:7px 10px"><i class="ti ti-alert-triangle"></i><div><b>غير مكتمل:</b> ${k.noBL.length===2?'عقدان':k.noBL.length+' عقود'} بلا جدول معتمد (${k.noBL.map(c=>c.n.replace('الأعمال ','').replace(' والتنسيق','')).join('، ')})</div></div><small class="sc-mut">أكبر تأخير قائم: الهيكل <span class="sc-num bad">+22 يوماً</span></small>`;
 return `<div class="d-ans">
 <div class="sc-card d-a"><span class="d-q">متى ننتهي؟</span>${when}</div>
 <div class="sc-card d-a"><span class="d-q">هل نحن متأخرون؟</span><b>${k.act}% <small>فعلي</small> · ${k.pl}% <small>مخطط</small></b><div class="r-db"><div><small>فعلي</small><i><b style="width:${k.act}%"></b></i></div><div><small>مخطط</small><i class="p"><b style="width:${k.pl}%"></b></i></div></div><small class="sc-fnt">موزونة بالمدة التعاقدية · العقود التي لها خط أساس معتمد فقط${fiOk()?' · التشطيبات لم تبدأ (0%)':''}</small></div>
 <div class="sc-card d-a"><span class="d-q">أين التأخير؟</span><b>${k.late} من ${k.B.length} عقود مُجدولة متأخرة</b>${ex.co?'<div class="sc-note t-green" style="padding:7px 10px"><i class="ti ti-circle-check"></i>الأعمال الخارجية أُسندت — بانتظار خط الأساس</div>':`<div class="sc-note t-amber" style="padding:7px 10px"><i class="ti ti-alert-triangle"></i>الأعمال الخارجية غير موقّعة · تأخر تعاقد ${C.dys(C.days(ex.ds,C.TODAY))}</div>`}</div>
 <div class="sc-card d-a"><span class="d-q">ما حالة التقديمات؟</span><div class="sc-chips">${subsChips(k.S)}</div><small class="sc-mut">${k.S.list.join(' · ')}</small></div></div>`}
function side(){const tot=SD.reasons.reduce((n,r)=>n+r[1],0);
 const tr=SD.trend,y0='2027-01-10',y1='2027-02-10',H=132,Wd=300,yp=d=>12+(1-C.days(y0,d)/C.days(y0,y1))*(H-24),xp=i=>24+i*(Wd-48)/(tr.length-1);const ce=SD.contracts[0].ce;
 const pts=tr.map((t,i)=>`${xp(i)},${yp(t[2])}`).join(' ');
 return `<aside class="d-side">
 <section class="sc-card"><div class="sc-card-hd"><h3>أكبر أسباب التأخير القائمة</h3></div><ol class="d-top">${SD.top5.map((t,i)=>`<li><span class="d-n">${i+1}</span><div><b>${t.n}</b><small>${t.c} — ${t.why}</small></div>${C.rs(t.r)}<span class="sc-num bad">${C.sd(t.d)}</span></li>`).join('')}</ol></section>
 <section class="sc-card"><div class="sc-card-hd"><h3>اتجاه النهاية المتوقعة — الهيكل</h3><span class="sc-mut" style="font-size:12.5px">U-9 → U-14</span></div><div class="sc-card-bd"><svg class="d-tr" viewBox="0 0 ${Wd} ${H+22}" direction="ltr">
  <line x1="12" x2="${Wd-12}" y1="${yp(ce)}" y2="${yp(ce)}" class="ref"></line><text x="${Wd-12}" y="${yp(ce)+14}" text-anchor="end" class="rl">التعاقدية ${C.fmt(ce,1)}</text>
  <polyline points="${pts}" class="ln"></polyline>
  ${tr.map((t,i)=>`<g class="tp"><circle cx="${xp(i)}" cy="${yp(t[2])}" r="12" class="hit"></circle><circle cx="${xp(i)}" cy="${yp(t[2])}" r="4" class="pt"></circle><text x="${xp(i)}" y="${H+16}" text-anchor="middle" class="xl">${t[0]}</text><g class="tt"><rect x="${Math.min(Wd-124,Math.max(0,xp(i)-62))}" y="${yp(t[2])-36}" width="124" height="24" rx="6"></rect><text x="${Math.min(Wd-62,Math.max(62,xp(i)))}" y="${yp(t[2])-20}" text-anchor="middle">${C.fmt(t[2])} · بيانات ${C.fmt(t[1],1)}</text></g></g>`).join('')}
 </svg></div></section>
 <section class="sc-card"><div class="sc-card-hd"><h3>أسباب التأخير مجمّعة</h3><span class="sc-mut" style="font-size:12.5px">على المسارات الحرجة · ${tot} يوماً</span></div><div class="sc-card-bd"><div class="d-stack">${SD.reasons.map(([r,n])=>`<i class="t-${C.RT[r]}" style="flex:${n}" title="${r} ${n}"></i>`).join('')}</div><div class="d-sl">${SD.reasons.map(([r,n])=>`<span><i class="t-${C.RT[r]}"></i>${r}<b>${n}</b></span>`).join('')}</div>
 <div class="d-by">${SD.reasonsBy.map(([c,L,t])=>`<div><b>${c}</b><span>${L.map(([r,n])=>r+' '+n).join(' · ')} = ${t} ${C.unit(t)}</span></div>`).join('')}<small class="sc-fnt">الكهروميكانيكية: تأخر المقاول يومان، ويوم منهما وقع على عطلة الجمعة.</small></div></div></section></aside>`}
function drawer(){if(!s.sel)return '';const c=CS().find(x=>x.id===s.sel);const I=info(c);const own=['o','c'].includes(C.U[C.st.role].co);
 const kv=`<dl class="sc-kv">${c.co?`<dt>شركة المقاول</dt><dd>${C.esc(c.co)}</dd>`:''}${own?`<dt>الافتراضي</dt><dd>${C.fmt(c.ds)} – ${C.fmt(c.de)}</dd>`:''}${c.cs?`<dt>التعاقدي</dt><dd>${C.fmt(c.cs)} – ${C.fmt(c.ce)}</dd>`:''}${I.bl?`<dt>النهاية المتوقعة</dt><dd>${C.fmt(I.fe)} <span class="sc-num ${I.fe>c.ce?'bad':'ok'}">(${C.sd(C.days(c.ce,I.fe))})</span></dd><dt>الفعلي / المخطط</dt><dd>${I.act}% / ${I.pl}%</dd>`:''}${c.cyc?`<dt>دورة التحديث</dt><dd>${c.cyc}</dd>`:''}<dt>الحالة</dt><dd>${C.cStat(c,1)}</dd></dl>`;
 return `<div class="sc-scrim" data-a="d-close"></div><aside class="sc-drw"><div class="sc-drw-hd"><div><small>ملخص العقد</small><h3>${c.n}</h3></div><button class="sc-ib" data-a="d-close" aria-label="إغلاق"><i class="ti ti-x"></i></button></div><div class="sc-drw-bd">${kv}${c.co?'':'<button class="sc-b out" data-a="go" data-v="contracts">إسناد العقد من شاشة العقود</button>'}</div></aside>`}
function mobile(k){const cs=CS();const dv=C.days(P.ce,k.fe);
 const card=c=>{const I=info(c);const d=I.bl?C.days(c.ce,I.fe):null;return `<button class="dm-c" data-a="d-sel" data-v="${c.id}"><div class="dm-c1"><div><b>${c.n}</b><small>${c.co?C.esc(c.co):'لم يُسند'}</small></div>${d!=null?`<span class="sc-num ${d>15?'bad':d>0?'warn':'ok'}">${C.sd(d)}</span>`:''}</div><div class="dm-c2">${C.cStat(c)}</div>${I.bl?`<div class="dm-bar"><i style="width:${I.act}%"></i></div><div class="dm-c3"><span>فعلي ${I.act}% · مخطط ${I.pl}%</span><span>المتوقعة ${C.fmt(I.fe)}</span></div>`:''}</button>`};
 return C.shell(C.hdr({title:'لوحة المشروع',chips:C.chip('معاينة الجوال','gray',1),right:devSeg()}),`<div class="m-canvas"><div class="m-side"><b>لوحة المالك — الجوال</b><span>الأجوبة الأربعة وقائمة العقود.</span><small>معاينة 390 × 844</small></div>
 <div class="m-phone"><div class="m-scr"><header class="dm-hd"><div><h1>${P.n}</h1><small>${cs.length} عقود · تاريخ البيانات ${C.fmt(P.dd)}</small></div></header>
 <div class="dm-bd" data-keep="dm">
 <div class="dm-a"><span class="d-q">متى ننتهي؟</span><b>${C.fmt(k.fe)}</b><div class="sc-mut">${k.complete?(dv<0?'قبل التعاقدي بـ '+C.dys(dv):C.sd(dv)):'غير مكتمل · '+k.noBL.length+' بلا جدول معتمد'}</div></div>
 <div class="dm-2"><div class="dm-a"><span class="d-q">هل نحن متأخرون؟</span><b>${k.act}% <small>/ ${k.pl}%</small></b></div><div class="dm-a"><span class="d-q">أين التأخير؟</span><b>${k.late} من ${k.B.length}</b><div class="sc-mut">عقود مُجدولة متأخرة</div></div></div>
 <div class="dm-a"><span class="d-q">حالة التقديمات</span><div class="sc-chips">${subsChips(k.S)}</div></div>
 <div class="dm-h">العقود</div>${cs.map(card).join('')}</div>
 <nav class="m-nav"><button class="on"><i class="ti ti-layout-dashboard"></i>اللوحة</button><button><i class="ti ti-file-text"></i>التقديمات</button><button><i class="ti ti-bell"></i>التنبيهات</button><button><i class="ti ti-dots"></i>المزيد</button></nav></div></div></div>`)}
const devSeg=()=>C.seg([['desk','سطح المكتب'],['mob','الجوال']],s.dev,'d-dev');
function view(){const rc=C.U[C.st.role].co;const own=rc==='o'||rc==='c';const k=kpi();if(s.dev==='mob'&&own)return mobile(k);
 if(!own){const c=SD.contracts[{s:0,m:1,f:2}[rc]];const I=info(c);const h=C.hdr({title:'لوحة العقد · '+c.n,chips:C.lz(c.mode==='p6'?'من P6':'داخل ربائد')+C.cStat(c),sub:`<span>${c.co}</span><span>تاريخ البيانات: <b>${P.ddL}</b></span>`});
  const body=I.bl?`<div class="d-ans c3"><div class="sc-card d-a"><span class="d-q">النهاية المتوقعة</span><b>${C.fmt(I.fe)}</b><div><span class="sc-num ${I.fe>c.ce?'bad':'ok'}">${C.sd(C.days(c.ce,I.fe))}</span> <span class="sc-mut">عن التعاقدية ${C.fmt(c.ce)}</span></div></div><div class="sc-card d-a"><span class="d-q">الإنجاز</span><b>${I.act}% <small>فعلي</small> · ${I.pl}% <small>مخطط</small></b></div><div class="sc-card d-a"><span class="d-q">آخر تقديم</span><div class="sc-chips">${C.cStat(c)}</div></div></div>`:`<div class="sc-note t-amber"><i class="ti ti-alert-triangle"></i>لا خط أساس معتمد بعد — ${C.cStat(c,1)}</div>`;
  return C.shell(h,`<div class="sc-note t-blue"><i class="ti ti-eye"></i>عرض المقاول: عقدك فقط بالتعاقدي والمتوقع — بلا الخط الافتراضي وبلا العقود الأخرى.</div>${body}${timeline([c],false,c.id==='st'?'2026-02-01':'2026-08-01',c.id==='st'?'2027-04-01':'2027-06-01')}`)+drawer()}
 const h=C.hdr({title:P.n,chips:k.complete?C.chip('بعد الجولة','green',1):C.chip('الحالة الافتتاحية','gray',1),sub:`<span><b>${SD.contracts.length}</b> عقود</span><span>اليوم: <b>${P.todayL}</b></span><span>تاريخ البيانات: <b>${P.ddL}</b></span><label class="sc-swl">إظهار الخط الافتراضي ${C.sw(s.def,'d-def')}</label>`,right:devSeg()+`<button class="sc-b pri" data-a="d-exp"><i class="ti ti-file-download"></i>تصدير التقرير الأسبوعي</button>`});
 return C.shell(h,answers(k)+`<div class="d-grid"><div class="d-mainc">${timeline(CS(),true,T0,T1)}<p class="d-foot"><i class="ti ti-info-circle"></i>تأخّر الهيكل لا ينتقل آلياً إلى التشطيبات. إن أثّر على بدايتها، يقدّم مقاولها طلب تعديل خط أساس بعد اعتماد BL-0.</p></div>${side()}</div>`)+drawer()}
function act(a,el){const v=el.dataset.v;
 if(a==='d-dev'){s.dev=v;s.sel=null;return}
 if(a==='d-def'){s.def=!s.def;s.defSeen=true;return}
 if(a==='d-sel'){s.sel=v;return}
 if(a==='d-close'){s.sel=null;return}
 if(a==='d-exp'){C.toast('جارٍ تجهيز التقرير الأسبوعي — '+P.ddL);return}
 return false}
C.screens.s5={view,act,state:s};
})();
