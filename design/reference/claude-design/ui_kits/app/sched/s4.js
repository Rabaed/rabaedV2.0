// Screen 4 — consultant review: BL-0 finishing (from 2a) · U-5 MEP · U-15 structure (P6). Table + timeline by default.
(function(){const C=SC,RV=SD.meRev,X=SD.xer;
const V0=()=>({passed:false,dec:null,open:null,only:true,ret:null});
const s={v:'upd',view:'tl',rep:true,byV:{bl:V0(),upd:V0(),p6:V0()},cm:{bl:[],upd:[],p6:[]},k:0,draft:{},dhid:{}};
const B=()=>s.byV[s.v];const cms=()=>s.cm[s.v];
const role=()=>C.st.role==='cmgr'?'mgr':'eng';
const avail=v=>v==='bl'?C.screens.s2a.state.launched:v==='p6'?C.screens.s3.state.launched:true;
const K=()=>SD.contracts[s.v==='bl'?2:s.v==='p6'?0:1];
const decKey={bl:'blDec',upd:'meDec',p6:'stDec'};
// ---- rows
const stx=(o,ms)=>{if(!o)return '—';if(o.f)return 'انتهى '+C.fmt(o.f,1);if(o.a&&o.xf)return `جارٍ ${o.p}% · متوقع ${C.fmt(o.xf,1)}`;if(o.a)return `بدأ ${C.fmt(o.a,1)} · ${o.p}%`;if(o.xs)return C.fmt(o.xs,1)+' – '+C.fmt(o.xf,1);if(o.xf)return C.fmt(o.xf,1);return 'لم يبدأ'};
const span=(a,o)=>{o=o||{};const s0=o.a||o.xs||a.ps;let e=o.f||o.xf||(o.a&&!o.xf?null:a.pe);if(!e)e=C.TODAY>a.pe?C.TODAY:a.pe;return [s0,e]};
function rowsUpd(){return SD.me.filter(a=>!B().only||a.ch).map(a=>({id:a.id,n:a.n,w:a.w,disc:a.disc,fl:a.fl,ms:a.ms,oos:a.oos,
 cells:[C.fmt(a.ps,1)+(a.ms?'':' – '+C.fmt(a.pe,1)),stx(a.u4),`<b>${stx(a.u5)}</b>`],d:a.d,why:a.why,r:a.r,ev:a.ev,evN:a.evN,
 ref:a.ch?span(a,a.u4):[a.ps,a.pe],sub:a.ch?span(a,a.u5):[a.ps,a.pe]}))}
function rowsBl(){const L=C.screens.s2a.state.acts||[];return L.map(a=>({id:a.id,n:a.n,w:a.w,disc:a.disc,fl:a.fl,ms:a.ms,dur:a.dur,pred:a.pred,crit:a.crit,cells:[a.ms?'معلم':a.dur,C.fmt(a.ps,1),a.ms?'—':C.fmt(a.pe,1)],sub:[a.ps,a.pe]}))}
function rowsP6(){return X.shifted.map(r=>({id:r[0],n:r[1],w:'[…]',cells:[C.fmt(r[2],1),`<b>${C.fmt(r[3],1)}</b>`],d:r[4],r:r[5],why:r[6],refE:r[2],subE:r[3]}))}
const rows=()=>s.v==='bl'?rowsBl():s.v==='p6'?rowsP6():rowsUpd();
const RANGE={upd:['2026-08-12','2026-10-22'],bl:['2026-10-28','2027-05-06'],p6:['2026-09-24','2026-11-15']};
function tlHead(){const [a,b]=RANGE[s.v];const sc=C.scale(a,b);return `<div class="r-tlh">${sc.months.map(m=>`<span style="left:${sc.p(m)}%">${C.mon(m)}</span>`).join('')}</div>`}
function tl(r){const [g0,g1]=RANGE[s.v];const sc=C.scale(g0,g1);const cl=d=>d<g0?g0:d>g1?g1:d;const out=[];const dd=sc.p(s.v==='bl'?g0:SD.project.dd);
 if(s.v!=='bl')out.push(`<i class="r-dd" style="left:${dd}%"></i>`);
 if(r.refE){const x1=sc.p(r.refE),x2=sc.p(r.subE);out.push(`<i class="r-ref" style="left:0;width:${x1}%"></i><i class="r-var" style="left:${Math.min(x1,x2)}%;width:${Math.abs(x2-x1)}%"></i><i class="r-sube" style="left:${x2}%"></i>`);return out.join('')}
 const bar=(sp,cls)=>{const s1=cl(sp[0]),e1=cl(sp[1]);const over=sp[1]>g1;return `<i class="${cls}" style="left:${sc.p(s1)}%;width:${Math.max(.8,sc.w(s1,e1))}%"></i>${over&&cls==='r-sub'?`<span class="r-ov">← ${C.fmt(sp[1],1)}</span>`:''}`};
 if(r.ms){const e=r.sub[1];const over=e>g1;if(over)return out.join('')+`<span class="r-ov">← ${C.fmt(e,1)}</span>`;return out.join('')+`<i class="r-msd" style="left:${sc.p(e)}%"></i>`}
 if(r.ref){out.push(bar(r.ref,'r-ref'));const [a1,b1]=r.ref,[a2,b2]=r.sub;if(b2!==b1&&b2<=g1){const x=sc.p(cl(b1<b2?b1:b2)),y=sc.p(cl(b1<b2?b2:b1));out.push(`<i class="r-var" style="left:${x}%;width:${y-x}%"></i>`)}if(a2<a1){const x=sc.p(cl(a2)),y=sc.p(cl(a1));out.push(`<i class="r-var e" style="left:${x}%;width:${y-x}%"></i>`)}}
 out.push(bar(r.sub,'r-sub'+(r.crit?' crit':'')));return out.join('')}
// ---- comments
function thread(id){const L=cms().filter(c=>c.a===id);const open=!B().dec;const seed=(SD.seed[s.v]||{})[id];const mine=L.some(c=>c.seed);
 const dv=s.draft[id]!=null?s.draft[id]:seed&&!mine&&role()==='eng'?seed.t:'';const dh=s.dhid[id]!=null?s.dhid[id]:seed&&!mine?seed.hid:false;
 return `<div class="r-th">${L.map(c=>{const u=C.U[c.by];return `<div class="r-cm${c.hid?' hid':''}">${C.av(u,30)}<div class="r-cmb"><div class="r-cmh"><b>${u.n}</b><small>${C.fmt(C.TODAY)}</small>${c.hid?'<span class="sc-st t-gray"><i class="ti ti-eye-off"></i>مخفي عن المقاول</span>':'<span class="sc-st t-blue"><i></i>منشور عند الإطلاق</span>'}<span class="sp"></span><label class="sc-swl">إخفاء عن المقاول ${C.sw(c.hid,'r-hide',c.id,!open)}</label></div><p>${C.esc(c.t)}</p></div></div>`}).join('')||'<p class="sc-mut" style="margin:0">لا تعليقات على هذا النشاط.</p>'}
 ${open?`<div class="r-cmp"><textarea class="sc-in" rows="2" data-in="r-draft" data-v="${id}" placeholder="اكتب تعليقاً على ${id}…">${C.esc(dv)}</textarea><div class="r-cmpa"><label class="sc-swl">إخفاء عن المقاول ${C.sw(dh,'r-dhid',id)}</label><button class="sc-b out sm" data-a="r-add" data-v="${id}">إضافة تعليق</button></div></div>`:''}</div>`}
const cc=id=>{const n=cms().filter(c=>c.a===id).length;return `<button class="r-cc${n?'':' z'}" data-a="r-open" data-v="${id}"><i class="ti ti-message-circle"></i>${n}</button>`};
const evDot=r=>r.ev?`<span class="r-ev ${r.ev}" title="${r.evN||''}"></span><small class="r-evn">${r.evN||(r.ev==='g'?'فحص معتمد':'')}</small>`:'<span class="sc-fnt">—</span>';
function table(){const R=rows();const tlOn=s.view==='tl';const v=s.v;
 const H=v==='bl'?['الرقم','النشاط','WBS','المدة','البداية','النهاية','حرج']:v==='p6'?['الرقم','النشاط','النهاية في U-14','في U-15','الفرق','السبب']:['الرقم','النشاط','WBS','مخطط BL-0','في U-4','في U-5','الفرق','سبب المقاول','دليل'];
 const n=H.length+1+(tlOn?1:0);
 const body=R.map(r=>{const op=B().open===r.id;let c;
  if(v==='bl')c=`<td class="r-nw">${r.cells[0]}</td><td class="r-nw">${r.cells[1]}</td><td class="r-nw">${r.cells[2]}</td><td>${r.crit?'<i class="g-cr"></i>':''}</td>`;
  else if(v==='p6')c=`<td class="r-nw">${r.cells[0]}</td><td class="r-nw">${r.cells[1]}</td><td><span class="sc-num bad">${C.sd(r.d)}</span></td><td>${r.r?C.rs(r.r)+' ':''}<small class="sc-hist" style="display:inline">${r.why}</small></td>`;
  else c=`<td class="r-nw">${r.cells[0]}</td><td class="r-nw sc-mut">${r.cells[1]}</td><td class="r-nw">${r.cells[2]}</td><td class="r-nw">${typeof r.d==='number'?`<span class="sc-num ${r.d>0?'bad':''}">${r.d?C.sd(r.d):'0'}</span>`:r.d?`<span class="sc-mut" style="font-size:12.5px">${r.d}</span>`:'—'}</td><td class="r-nw">${r.r?C.rs(r.r)+' ':''}${r.why?`<small class="sc-hist" style="display:inline">${r.why}</small>`:r.r?'':'<span class="sc-fnt">—</span>'}</td><td class="r-nw">${evDot(r)}</td>`;
  return `<tr class="clk${op?' open':''}" data-a="r-open" data-v="${r.id}"><td><span class="sc-id">${r.id}</span></td><td class="r-nmc"><b class="r-nm" title="${C.esc(r.n)}">${C.esc(r.n)}</b>${r.oos?'<span class="sc-st t-amber" style="height:20px">خارج التسلسل</span>':''}</td>${v==='p6'?'':`<td class="r-nw sc-mut">${C.esc(r.w)}</td>`}${c}<td>${cc(r.id)}</td>${tlOn?`<td class="r-tlc">${tl(r)}</td>`:''}</tr>${op?`<tr class="r-exp"><td colspan="${n}">${thread(r.id)}</td></tr>`:''}`}).join('');
 const more=v==='upd'&&B().only?`<tr><td colspan="${n}" class="sc-mut" style="text-align:center;font-size:13px">${RV.total-RV.changed-1} أنشطة بلا تغيير — أطفئ «ما تغيّر فقط» لعرضها</td></tr>`:v==='p6'?`<tr><td colspan="${n}" class="sc-mut" style="text-align:center;font-size:13px">${X.acts-X.shifted.length} نشاطاً آخر في الملف — […]</td></tr>`:'';
 return `<table class="sc-tb r-tb"><thead><tr>${H.map(h=>`<th>${h}</th>`).join('')}<th>تعليقات</th>${tlOn?`<th class="r-tlc">${tlHead()}<div class="r-tll">${v==='bl'?'<span><i class="r-sub"></i>التقديم</span>':v==='p6'?'<span><i class="r-ref"></i>U-14</span><span><i class="r-sube"></i>U-15</span><span><i class="r-var"></i>المتغيّر</span>':'<span><i class="r-ref"></i>U-4</span><span><i class="r-sub"></i>U-5</span><span><i class="r-var"></i>المتغيّر</span>'}</div></th>`:''}</tr></thead><tbody>${body}${more}</tbody></table>`}
function report(){const it=(l,v,sub)=>`<div class="r-ri"><span>${l}</span><b>${v}</b>${sub?`<small>${sub}</small>`:''}</div>`;let items,sum;
 if(s.v==='bl'){const L=C.screens.s2a.state.acts||[];const e=L.reduce((m,a)=>a.pe>m?a.pe:m,'0');const K2=SD.contracts[2];const dv=C.days(K2.ce,e);const rel=L.reduce((n,a)=>n+a.pred.length,0);
  sum=`النهاية ${C.fmt(e)} · ${dv<0?'قبل التعاقدي بـ '+C.dys(dv):C.sd(dv)} · ${L.length} نشاطاً`;
  items=it('النهاية المقدَّمة',C.fmt(e),dv<0?'قبل التعاقدي بـ '+C.dys(dv):dv===0?'مطابقة للتعاقدي':C.sd(dv)+' عن التعاقدي')+it('الشبكة',L.length+' نشاطاً · '+rel+' علاقة','FS · محرّك ربائد · تقويم المشروع')+it('بلا سابق',L.filter(a=>!a.pred.length).length,'بداية العقد')+it('المسار الحرج',L.filter(a=>a.crit).length+' نشاطاً','')}
 else if(s.v==='p6'){const Ks=SD.contracts[0];sum=`نهاية الملف ${C.fmt(X.end)} · ${C.sd(X.vsC)} عن التعاقدي · ${C.sd(X.vsU14)} عن U-14`;
  items=it('الإنجاز',Ks.act+'% / '+Ks.pl+'%','فعلي / مخطط')+it('نهاية الجدول في الملف',C.fmt(X.end),`<span class="sc-num bad">${C.sd(X.vsC)}</span> عن التعاقدي · ${C.sd(X.vsU14)} عن U-14`)+it('المطابقة',X.matched+' مُطابَق',`${X.added} جديدة · ${X.missing.length} اختفت (${X.missing.join('، ')}) · أُعيد إسنادها`)+`<div class="r-ri"><span>جودة الشبكة</span><div class="r-q">${X.q.map(([l,n])=>`<div><span>${l}</span><b>${n}</b></div>`).join('')}</div></div>`+it('الملف',`<span class="sc-id">${X.file}</span>`,`${X.size} · قُدّم متأخراً ${C.dys(X.late)}`)}
 else{sum=`${RV.act}% / ${RV.pl}% · النهاية ${C.fmt(RV.fe)} (${C.sd(RV.vsC)}) · ${RV.changed} من ${RV.total} تغيّرت`;
  items=`<div class="r-ri"><span>الإنجاز</span><div class="r-db"><div><small>فعلي</small><i><b style="width:${RV.act}%"></b></i><em>${RV.act}%</em></div><div><small>مخطط</small><i class="p"><b style="width:${RV.pl}%"></b></i><em>${RV.pl}%</em></div></div></div>`+it('النهاية المتوقعة',C.fmt(RV.fe),`<span class="sc-num bad">${C.sd(RV.vsC)}</span> عن التعاقدي · <span class="sc-num warn">${C.sd(RV.vsU4)}</span> عن U-4`)+it('تغيّرت منذ U-4',RV.changed+' من '+RV.total,'')+it('خارج التسلسل',RV.oos.length,RV.oos.join('، '))+it('بلا دليل معتمد',RV.noEv.length,RV.noEv.join('، '))+`<div class="r-ri"><span>أسباب التأخير المعلنة (تراكمي)</span><div class="sc-chips">${RV.reasons.map(([r,n])=>`<span class="sc-rs t-${C.RT[r]}">${r} ${C.dys(n)}</span>`).join('')}</div><small><span class="r-ev y"></span> فحص مقدّم لم يُعتمد · <span class="r-ev r"></span> بلا طلب فحص — إرشادية لا تمنع القرار</small></div>`}
 return `<section class="sc-card r-rep2${s.rep?'':' cl'}"><button class="r-rh" data-a="r-rep"><i class="ti ti-report-analytics"></i><b>تقرير المراجعة الآلي</b>${s.rep?'':`<span class="sc-mut">${sum}</span>`}<span class="sp"></span><i class="ti ti-chevron-${s.rep?'up':'down'}"></i></button>${s.rep?`<div class="r-rg">${items}</div>`:''}</section>`}
function decBar(){const b=B();const L=cms();const pub=L.filter(c=>!c.hid).length,hid=L.length-pub;const mgr=role()==='mgr';
 if(b.dec){const lab={ok:'مقبول',notes:'مقبول بملاحظات',ret:'مُرجَع'}[b.dec];const who=s.v==='bl'?['keng','build','ما يراه المقاول — م. أحمد']:s.v==='p6'?['seng','upload','ما يراه المقاول — م. ياسر']:['meng','webupd','ما يراه المقاول — م. نادر'];
  return `<div class="sc-bar"><span class="it2"><i class="ti ti-circle-check" style="color:var(--tone-green-solid)"></i>أُطلق القرار: <b>${lab}</b> · ${C.U.cmgr.n} · ${C.fmt(C.TODAY)} · وصل المقاول ${pub} ${pub===1?'تعليق منشور':pub===2?'تعليقان منشوران':'تعليقات منشورة'}</span><span class="sp"></span>${C.handoff(...who)}${C.handoff('own','dash','لوحة المالك — م. محمد')}</div>`}
 if(!mgr)return b.passed?`<div class="sc-bar"><span class="it2"><i class="ti ti-check"></i>مُرِّر إلى م. خالد الحربي — الحالة الخارجية ما زالت «قيد المراجعة».</span><span class="sp"></span>${C.handoff('cmgr','review','التبديل إلى م. خالد الحربي',s.v)}</div>`:`<div class="sc-bar"><span class="it2"><i class="ti ti-lock"></i>مراجعة داخلية — المقاول لا يرى التعليقات حتى يُطلق مدير المشروع القرار.</span><span class="sp"></span><button class="sc-b pri" data-a="r-pass"><i class="ti ti-send"></i>تمرير لمدير المشروع</button></div>`;
 if(!b.passed)return `<div class="sc-bar"><span class="it2"><i class="ti ti-hourglass"></i>المراجعة الداخلية ${b.ret?'أُعيدت إلى':'عند'} م. سارة العتيبي — لم تُمرَّر إليك بعد.</span><span class="sp"></span>${C.handoff('ceng','review','التبديل إلى م. سارة',s.v)}</div>`;
 return `<div class="sc-bar"><span class="it2"><i class="ti ti-message-circle"></i>سيصل المقاول ${pub} ${pub===1?'تعليق منشور':pub===2?'تعليقان منشوران':'تعليقات منشورة'}${hid?`، و${hid===1?'تعليق واحد مخفي':hid+' مخفية'}`:''}</span><span class="sp"></span><button class="sc-b ter" data-a="r-back"><i class="ti ti-arrow-back-up"></i>إرجاع لـ م. سارة</button><span class="dv"></span><button class="sc-b dan" data-a="r-dec" data-v="ret">إرجاع للمقاول</button>${s.v==='bl'?'':'<button class="sc-b out" data-a="r-dec" data-v="notes">قبول بملاحظات</button>'}<button class="sc-b pri" data-a="r-dec" data-v="ok"><i class="ti ti-check"></i>قبول</button></div>`}
function view(){const v=s.v,b=B(),k=K();const mgr=role()==='mgr';
 const tabs=`<div class="sc-seg r-vt">${[['upd','الكهروميكانيكية · U-5'],['bl','التشطيبات · BL-0'],['p6','الهيكل · U-15']].map(([x,l])=>`<button class="${v===x?'on':''}" data-a="r-var" data-v="${x}">${l}</button>`).join('')}</div>`;
 const title=k.n+' · '+(v==='bl'?'خط الأساس <span class="sc-bi">BL-0</span>':v==='p6'?'تحديث التقدّم <span class="sc-bi">U-15</span>':'تحديث التقدّم <span class="sc-bi">U-5</span>');
 if(!avail(v))return C.shell(C.hdr({title,right:tabs}),`<section class="sc-card" style="padding:28px"><p class="sc-mut" style="margin:0">لم يصل هذا التقديم بعد — ${v==='bl'?'م. فهد الدوسري لم يُطلق BL-0.':'م. عبدالله الشهري لم يُطلق U-15.'}</p></section>`);
 const ext=b.dec==='ok'?C.chip('مقبول','green'):b.dec==='notes'?C.chip('مقبول بملاحظات','green'):b.dec==='ret'?C.chip('مُرجَع','red'):C.chip('قيد المراجعة','violet');
 const intl=b.dec?'':C.chip(b.ret&&!b.passed?'أُعيد — عند م. سارة':'مراجعة داخلية — عند '+(b.passed?'م. خالد':'م. سارة'),b.ret&&!b.passed?'amber':'blue');
 const cnt=b.dec?'':C.chip(v==='bl'?'مدة الرد: 14 يوماً متبقية من 14':v==='p6'?'مدة الرد: 7 أيام متبقية من 7':`مدة الرد: ${RV.left} أيام متبقية من ${RV.resp}`,v==='upd'?'amber':'gray');
 const h=C.hdr({title,chips:ext+intl+cnt,sub:`<span>${k.co}</span><span>${C.lz(v==='p6'?'من P6':'داخل ربائد')}</span><span>تاريخ البيانات: <b>${v==='bl'?'—':C.fmt(v==='p6'?X.dd:RV.u5dd)}</b></span>`,right:tabs});
 const cmp=`<div class="r-cmp0"><i class="ti ti-arrows-diff"></i>مقارنةً بـ: ${v==='bl'?`<b>النهاية التعاقدية ${C.fmt(k.ce)}</b> · أول تقديم لخط الأساس`:v==='p6'?`<b>التحديث المقبول <span class="sc-bi">U-14</span> (17 سبتمبر)</b> · <b>خط الأساس النشط <span class="sc-bi">BL-0</span></b>`:`<b>التحديث المقبول <span class="sc-bi">U-4</span> (بيانات ${C.fmt(RV.u4dd,1)})</b> · <b>خط الأساس النشط <span class="sc-bi">BL-0</span> (اعتُمد ${k.blD})</b>`}</div>`;
 const ban=b.ret&&!b.passed&&!b.dec?`<div class="e-banner"><i class="ti ti-arrow-back-up"></i><div><b>أعادها م. خالد الحربي لك</b> — التعليقات ما زالت مسودات لم تُنشر.<br>${C.esc(b.ret)}</div></div>`:'';
 const n=v==='bl'?(C.screens.s2a.state.acts||[]).length+' نشاطاً':v==='p6'?X.shifted.length+' أنشطة انزاحت':B().only?RV.changed+' أنشطة تغيّرت':RV.total+' نشاطاً';
 const main=`<section class="sc-card r-main"><div class="sc-card-hd"><h3>${v==='bl'?'أنشطة خط الأساس':'الأنشطة'}</h3><span class="sc-mut" style="font-size:13px">${n}</span><span class="sp"></span>${v==='upd'?`<label class="sc-swl">ما تغيّر فقط ${C.sw(b.only,'r-only')}</label>`:''}${C.seg([['tl','جدول + زمني'],['tb','جدول']],s.view,'r-view')}</div><div class="sc-tbw">${table()}</div>${v==='p6'?'<div class="r-p6n"><i class="ti ti-lock"></i>عقد «من P6»: لا تعديل داخل المنصة — التعديل بإعادة رفع الملف فقط.</div>':''}</section>`;
 return C.shell(h,ban+cmp+report()+main+decBar())}
function act(a,el){const v=el.dataset.v,b=B();
 if(a==='r-var'){s.v=v;return}
 if(a==='r-view'){s.view=v;return}
 if(a==='r-rep'){s.rep=!s.rep;return}
 if(a==='r-only'){b.only=!b.only;return}
 if(a==='r-open'){if(el.closest('.r-exp'))return false;b.open=b.open===v&&el.tagName==='TR'?null:v;return}
 if(a==='r-hide'){const c=cms().find(q=>q.id===+v);c.hid=!c.hid;return}
 if(a==='r-dhid'){const seed=(SD.seed[s.v]||{})[v];const cur=s.dhid[v]!=null?s.dhid[v]:!!(seed&&seed.hid&&!cms().some(c=>c.seed&&c.a===v));s.dhid[v]=!cur;return}
 if(a==='r-add'){const ta=document.querySelector(`[data-in="r-draft"][data-v="${v}"]`);const t=(ta?ta.value:s.draft[v]||'').trim();if(!t)return false;const seed=(SD.seed[s.v]||{})[v];const hid=s.dhid[v]!=null?s.dhid[v]:!!(seed&&seed.hid&&!cms().some(c=>c.seed&&c.a===v));cms().push({id:++s.k,a:v,by:role()==='eng'?'ceng':'cmgr',t,hid,seed:!!seed});s.draft[v]='';delete s.dhid[v];return}
 if(a==='r-pass'){b.passed=true;b.ret=null;C.toast('مُرِّر لمدير المشروع م. خالد الحربي — الحالة الخارجية لم تتغيّر');return}
 if(a==='r-back'){C.st.modal={title:'إرجاع لـ م. سارة العتيبي',ok:'إرجاع',body:`<p>تعود المراجعة إلى م. سارة. التعليقات تبقى مسودات، والمقاول لا يرى أي تغيير، وعدّاد مدة الرد مستمر.</p><div class="sc-f"><label>ملاحظة <span class="m-req">إلزامية</span></label><textarea class="sc-in" id="ret-note" rows="3" style="height:auto;padding:10px"></textarea></div>`,fn:()=>{const t=(document.getElementById('ret-note')||{}).value||'';if(!t.trim()){C.toast('الملاحظة إلزامية');return false}b.ret=t.trim();b.passed=false;C.toast('أُعيدت المراجعة إلى م. سارة')}};return}
 if(a==='r-dec'){const lab={ok:'قبول',notes:'قبول بملاحظات',ret:'إرجاع للمقاول'}[v];C.st.modal={title:lab,ok:'إطلاق القرار',tone:v==='ret'?'dan':'pri',body:`<p>سيُطلق القرار للمقاول والمالك، وتُنشر التعليقات غير المخفية. القرار نهائي على هذا التقديم.</p>`,fn:()=>{b.dec=v;C.st[decKey[s.v]]=v;C.toast('أُطلق القرار: '+lab)}};return}
 return false}
function inp(k,el){if(k==='r-draft')s.draft[el.dataset.v]=el.value}
function open(v){if(v)s.v=v}
s.api={addSeed:(v,id)=>{const sd=SD.seed[v][id];if(!s.cm[v].some(c=>c.a===id&&c.seed))s.cm[v].push({id:++s.k,a:id,by:'ceng',t:sd.t,hid:sd.hid,seed:true})}};
C.screens.s4={view,act,inp,open,state:s};
})();
