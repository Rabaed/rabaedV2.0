// Workflows — data + diagram renderer. Exposes window.WF.
(function(){
const STG={drafts:['Drafts','المسودات','gray'],internal:['Internal Review','مراجعة داخلية','blue'],pending:['Pending Approval','بانتظار الاعتماد','violet'],ends:['Outcome','النتيجة','green']};
const BANDS=[['drafts',0,250],['internal',250,500],['pending',500,1070],['ends',1070,1320]];
const END={A:['Approved','معتمد','green','ti-check'],C:['Revise & Resubmit','مراجعة وإعادة تقديم','orange','ti-refresh'],D:['Rejected','مرفوض','red','ti-x'],X:['Cancelled','ملغى','gray','ti-ban']};
const CO={ctr:['TMC Constructions','تي إم سي للمقاولات','Contractor','المقاول'],cns:['Design Consultants LLC','ديزاين للاستشارات','Consultant','الاستشاري'],own:['Al Futtaim PMC','الفطيم لإدارة المشاريع','Owner Representative','ممثل المالك']};
const S0={
 s1:{en:'Contractor Engineer',ar:'مهندس المقاول',stage:'drafts',co:'ctr',perm:'Create',out:'none',x:30,y:250,ic:'ti-user'},
 s2:{en:'Contractor PM review',ar:'مراجعة مدير مشروع المقاول',stage:'internal',co:'ctr',perm:'Review',out:'none',x:280,y:250,ic:'ti-user-check'},
 s3:{en:'Consultant Engineer review',ar:'مراجعة مهندس الاستشاري',stage:'pending',co:'cns',perm:'Review',out:'recommend',x:530,y:130,ic:'ti-user-search'},
 s4:{en:'Consultant Manager decision',ar:'قرار مدير الاستشاري',stage:'pending',co:'cns',perm:'Approve',out:'final',x:810,y:130,ic:'ti-gavel'},
 s5:{en:'Owner Representative approval',ar:'اعتماد ممثل المالك',stage:'pending',co:'own',perm:'Approve',out:'none',x:810,y:420,ic:'ti-building',cond:1},
 eA:{end:'A',x:1110,y:70},eC:{end:'C',x:1110,y:230},eD:{end:'D',x:1110,y:380},eX:{end:'X',x:1110,y:540}};
const T0={
 t1:{f:'s1',to:'s2',en:'Send for Review',ar:'إرسال للمراجعة',type:'send'},
 t2:{f:'s2',to:'s1',en:'Return',ar:'إرجاع',type:'return'},
 t3:{f:'s2',to:'s3',en:'Submit',ar:'تقديم',type:'submit',sign:1},
 t4:{f:'s3',to:'s4',en:'Send to Manager',ar:'إرسال للمدير',type:'send'},
 t5:{f:'s4',to:'s3',en:'Return to Engineer',ar:'إرجاع للمهندس',type:'return'},
 t6:{f:'s4',to:'eA',en:'Approve – Code A',ar:'اعتماد – Code A',type:'close',code:'A',sign:1},
 t7:{f:'s4',to:'eA',en:'Approve with Comments – Code B',ar:'اعتماد مع ملاحظات – Code B',type:'close',code:'B',sign:1},
 t8:{f:'s4',to:'eC',en:'Revise & Resubmit – Code C',ar:'مراجعة وإعادة تقديم – Code C',type:'close',code:'C',sign:1},
 t9:{f:'s4',to:'eD',en:'Reject – Code D',ar:'رفض – Code D',type:'close',code:'D',sign:1},
 t10:{f:'s4',to:'s5',en:'Send to Owner Rep',ar:'إرسال لممثل المالك',type:'submit',sign:1,cond:[{f:'cost_impact',op:'>',v:'500000'}]},
 t11:{f:'s5',to:'eA',en:'Owner Approve',ar:'اعتماد المالك',type:'close',code:'A',sign:1},
 t12:{f:'s5',to:'s4',en:'Owner Return',ar:'إرجاع المالك',type:'return'},
 t13:{f:'s1',to:'eX',en:'Cancel',ar:'إلغاء',type:'cancel'}};
const FIELDS=['cost_impact','trade','location','quantity','supplier'];
const v1S=['s1','s2','s4','eA','eC','eD','eX'],v1T=['t1','t2','t3v1','t6','t7','t8','t9','t13'];
T0.t3v1=Object.assign({},T0.t3,{to:'s4'});
const clone=o=>JSON.parse(JSON.stringify(o));
const pick=(ids,src)=>Object.fromEntries(ids.map(i=>[i,clone(src[i])]));
const v2S=[...v1S,'s3'],v2T=['t1','t2','t3','t4','t5','t6','t7','t8','t9','t13'];
const v3S=[...v2S,'s5'],v3T=[...v2T,'t10','t11','t12'];
const S1=pick(v1S,S0);S1.s4.x=530;S1.s4.y=160;
const VERS=[
 {v:1,st:'pub',by:'Sara Al Mansoori',date:'11 Jan 2026',note:['Initial workflow: Engineer → PM → Consultant Manager.','سير العمل الأولي: المهندس ← المدير ← مدير الاستشاري.'],run:2,S:S1,T:pick(v1T,T0)},
 {v:2,st:'pub',by:'Sara Al Mansoori',date:'02 Apr 2026',note:['Added Consultant Engineer review before the manager.','إضافة مراجعة مهندس الاستشاري قبل المدير.'],run:14,S:pick(v2S,S0),T:pick(v2T,T0)},
 {v:3,st:'pub',by:'Mohammed Al Shamsi',date:'14 Aug 2026',note:['Owner Representative approval when cost impact > 500,000 SAR.','اعتماد ممثل المالك عندما يتجاوز أثر التكلفة 500,000 ريال.'],run:31,S:pick(v3S,S0),T:pick(v3T,T0)}];
// v4 draft: seeded with issues for validation demo
const d4={S:pick(v3S,S0),T:pick(v3T,T0)};d4.T.t11.sign=0;d4.T.t10.cond=[{f:'cost_impact_sar',op:'>',v:'500000'}];d4.S.s6={en:'Consultant QA check',ar:'تدقيق الجودة للاستشاري',stage:'pending',co:'cns',perm:'Review',out:'none',x:530,y:420,ic:'ti-clipboard-check'};d4.T.t14={f:'s3',to:'s6',en:'Send to QA',ar:'إرسال للجودة',type:'send'};d4.T.t15={f:'s2',to:'s3',en:'Return to Consultant',ar:'إرجاع للاستشاري',type:'return'};
VERS.push({v:4,st:'draft',by:'Sara Al Mansoori',date:'—',note:['',''],run:0,S:d4.S,T:d4.T});
const LIB={project:[{id:'mat',en:'Material Submittal – 2-tier review',ar:'اعتماد المواد – مراجعة على مستويين',types:['MAR','SAR'],runs:[2,14,31],draft:4,by:'Mohammed Al Shamsi',date:'14 Aug 2026',live:1},{id:'doc',en:'Document Review – single tier',ar:'مراجعة المستندات – مستوى واحد',types:['DAR'],runs:[0,9],by:'Sara Al Mansoori',date:'03 Jun 2026'},{id:'ir',en:'Inspection Request – site inspection',ar:'طلب الفحص – فحص الموقع',types:['IR'],runs:[22],by:'Sara Al Mansoori',date:'20 Feb 2026'}],
 company:[{id:'c1',en:'Material Submittal – 2-tier review',ar:'اعتماد المواد – مراجعة على مستويين',types:[],runs:[],by:'Sara Al Mansoori',date:'14 Aug 2026',lib:1},{id:'c2',en:'Shop Drawing – with Owner sign-off',ar:'المخططات التنفيذية – مع توقيع المالك',types:[],runs:[],by:'Ahmed bin Said',date:'09 Jul 2026',lib:1}],
 rabaed:[{id:'r1',en:'Submittal – single consultant review',ar:'تقديم – مراجعة استشاري واحدة',types:[],runs:[],by:'Rabaed',date:'—',ro:1},{id:'r2',en:'Submittal – 2-tier review',ar:'تقديم – مراجعة على مستويين',types:[],runs:[],by:'Rabaed',date:'—',ro:1},{id:'r3',en:'Inspection Request – standard',ar:'طلب فحص – قياسي',types:[],runs:[],by:'Rabaed',date:'—',ro:1},{id:'r4',en:'Snag – fix & verify',ar:'ملاحظة – إصلاح وتحقق',types:[],runs:[],by:'Rabaed',date:'—',ro:1}]};
/* ---------- renderer ---------- */
const W=1320,H=660,CW=200,CH=78,EW=170,EH=46;
const box=s=>s.end?{w:EW,h:EH}:{w:CW,h:CH};
function renderDiagram(o){const L=o.L,S=o.S,T=o.T,rtl=o.rtl;const fx=(x,w)=>rtl?W-x-w:x;
 const hidden=o.hide||{};const grp=o.groups||[];
 const pos=id=>{const g=grp.find(g=>g.ids.includes(id));if(g)return {x:g.x,y:g.y,w:g.w,h:g.h};const s=S[id],b=box(s);return {x:fx(s.x,b.w),y:s.y,w:b.w,h:b.h}};
 const bands=BANDS.map(([k,a,b])=>{const c=STG[k][2];const x=rtl?W-b:a;return `<div class="wb" style="left:${x}px;width:${b-a}px;background:var(--tone-${c}-tint)"><span style="color:var(--tone-${c}-fg)">${L(STG[k][0],STG[k][1])}</span></div>`}).join('');
 const pairs={};const edges=[],labels=[];
 Object.entries(T).forEach(([id,t])=>{if(!S[t.f]||!S[t.to])return;if(hidden[id])return;const a=pos(t.f),b=pos(t.to);const k=[t.f,t.to].sort().join('|');const n=(pairs[k]=(pairs[k]||0)+1)-1;
  const back=rtl?(a.x<b.x):(a.x>b.x);const same=Math.abs(a.x-b.x)<5;let d,lx,ly;const off=n*24;
  if(same){const x1=a.x+a.w/2,y1=a.y+(a.y<b.y?a.h:0),x2=b.x+b.w/2,y2=b.y+(a.y<b.y?0:b.h);d=`M${x1+(n?20:0)} ${y1} L${x2+(n?20:0)} ${y2}`;lx=x1+(n?20:0);ly=(y1+y2)/2}
  else if(!back){const x1=rtl?a.x:a.x+a.w,y1=a.y+a.h/2+off-(n?12:0),x2=rtl?b.x+b.w:b.x,y2=b.y+b.h/2+(n?off/2:0);const m=(x1+x2)/2;d=`M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}`;lx=m;ly=(y1+y2)/2}
  else{const x1=a.x+a.w/2,y1=a.y+a.h,x2=b.x+b.w/2,y2=b.y+b.h;const yy=Math.max(y1,y2)+44+off;d=`M${x1} ${y1} C${x1} ${yy} ${x2} ${yy} ${x2} ${y2}`;lx=(x1+x2)/2;ly=yy-10}
  const cl=(o.ecls&&o.ecls[id])||'';const sel=o.sel===id?' sel':'';const col=t.type==='return'?'var(--tone-orange-solid)':t.type==='submit'?'var(--btn-pri)':t.code?`var(--tone-${t.code==='C'?'orange':t.code==='D'?'red':'green'}-solid)`:t.type==='cancel'?'var(--tone-gray-solid)':'var(--ui-text-2)';
  edges.push(`<path class="we ${cl}${sel}" d="${d}" style="--ec:${col}" marker-end="url(#wa)"${t.type==='return'?' stroke-dasharray="6 4"':''}></path><path class="wh" d="${d}" data-t="${id}"></path>`);
  labels.push(`<button class="wl ${cl}${sel}" data-t="${id}" style="left:${lx}px;top:${ly}px;--ec:${col}">${t.sign?'<i class="ti ti-signature"></i>':''}${t.cond?'<i class="ti ti-filter"></i>':''}${esc(L(t.en,t.ar))}</button>`)});
 const cards=Object.entries(S).map(([id,s])=>{if(grp.some(g=>g.ids.includes(id))||hidden[id])return '';const p=pos(id);const cl=((o.scls&&o.scls[id])||'')+(o.sel===id?' sel':'');const an=o.annot&&o.annot[id];
  if(s.end){const e=END[s.end];return `<div class="wn wend ${cl}" data-s="${id}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;--nc:var(--tone-${e[2]}-solid);--nt:var(--tone-${e[2]}-tint)"><i class="ti ${e[3]}"></i>${L(e[0],e[1])}${an?`<small>${an}</small>`:''}</div>`}
  return `<div class="wn ${cl}" data-s="${id}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;min-height:${p.h}px;--nc:var(--tone-${STG[s.stage][2]}-solid)"><span class="ic"><i class="ti ${s.ic||'ti-user'}"></i></span><div class="tx"><b>${esc(L(s.en,s.ar))}</b><small>${L(CO[s.co][2],CO[s.co][3])} · ${s.perm}</small>${s.out!=='none'&&!o.hideOut?`<span class="om">${s.out==='recommend'?L('Recommends code','يوصي بالرمز'):s.out==='final'?L('Issues final code','يصدر الرمز النهائي'):L('Inspection result','نتيجة الفحص')}</span>`:''}${an?`<div class="an">${an}</div>`:''}</div>${s.cond?'<span class="cd"><i class="ti ti-filter"></i></span>':''}</div>`}).join('');
 const gh=grp.map(g=>`<div class="wn wgrp ${g.cls||''}" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px"><span class="ic"><i class="ti ti-lock"></i></span><div class="tx"><b>${esc(g.title)}</b><small>${esc(g.sub)}</small>${g.an?`<div class="an">${g.an}</div>`:''}</div></div>`).join('');
 return `<div class="wworld" style="width:${W}px;height:${H}px">${bands}<svg class="wsvg" viewBox="0 0 ${W} ${H}"><defs><marker id="wa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"></path></marker></defs>${edges.join('')}</svg>${gh}${cards}${labels.join('')}</div>`}
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
// Snag + Daily Site Report workflows
const SNAGWF={S:{o:{en:'Open',ar:'مفتوح',stage:'drafts',co:'ctr',perm:'Fix',out:'none',x:30,y:250,ic:'ti-alert-triangle'},p:{en:'In Progress',ar:'قيد التنفيذ',stage:'internal',co:'ctr',perm:'Fix',out:'none',x:280,y:250,ic:'ti-tool'},c:{en:'Done · under confirmation',ar:'منجز · قيد التأكيد',stage:'pending',co:'cns',perm:'Verify',out:'none',x:560,y:250,ic:'ti-user-check'},r:{en:'Reopened',ar:'أعيد فتحه',stage:'pending',co:'ctr',perm:'Fix',out:'none',x:560,y:470,ic:'ti-refresh'},eA:{end:'A',x:1110,y:266}},T:{a:{f:'o',to:'p',en:'Start work',ar:'بدء العمل',type:'send'},b:{f:'p',to:'c',en:'Mark done',ar:'تحديد كمنجز',type:'submit',sign:1},c:{f:'c',to:'eA',en:'Confirm & close',ar:'تأكيد وإغلاق',type:'close',sign:1},d:{f:'c',to:'r',en:'Reopen',ar:'إعادة فتح',type:'return'},e:{f:'r',to:'p',en:'Resume work',ar:'استئناف العمل',type:'send'}}};
const DSRWF={S:{d:{en:'Site Engineer · draft',ar:'مهندس الموقع · مسودة',stage:'drafts',co:'ctr',perm:'Create',out:'none',x:30,y:250,ic:'ti-report'},r1:{en:'Site Manager review',ar:'مراجعة مدير الموقع',stage:'internal',co:'ctr',perm:'Review',out:'none',x:280,y:250,ic:'ti-user-check'},r2:{en:'Consultant review',ar:'مراجعة الاستشاري',stage:'pending',co:'cns',perm:'Review',out:'none',x:560,y:170,ic:'ti-user-search'},r3:{en:'Owner Rep review',ar:'مراجعة ممثل المالك',stage:'pending',co:'own',perm:'Review',out:'none',x:810,y:330,ic:'ti-building'},eA:{end:'A',x:1110,y:266}},T:{a:{f:'d',to:'r1',en:'Send for review',ar:'إرسال للمراجعة',type:'send'},b:{f:'r1',to:'r2',en:'Submit',ar:'تقديم',type:'submit',sign:1},c:{f:'r2',to:'r3',en:'Reviewed',ar:'تمت المراجعة',type:'submit'},d:{f:'r3',to:'eA',en:'Reviewed · file',ar:'تمت المراجعة · أرشفة',type:'close',sign:1},e:{f:'r1',to:'d',en:'Return',ar:'إرجاع',type:'return'}}};
LIB.project.push({id:'snag',en:'Snag – fix & confirm',ar:'الملاحظة – إصلاح وتأكيد',types:['SNG','CMT'],runs:[38],by:'Sara Al Mansoori',date:'10 Mar 2026',wf:SNAGWF},{id:'dsr',en:'Daily Site Report – review chain',ar:'تقرير الموقع اليومي – سلسلة مراجعة',types:['DSR'],runs:[112],by:'Sara Al Mansoori',date:'10 Mar 2026',wf:DSRWF});
window.WF={SNAGWF,DSRWF,STG,BANDS,END,CO,S0,T0,FIELDS,VERS,LIB,W,H,CW,CH,renderDiagram,clone,box};
})();
