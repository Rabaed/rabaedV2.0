// Schedule module v3 — app chrome (platform shell), module nav, tasks, prototype dock (view-as · tour · scenario), persistence.
(function(){const S=SV,st=S.st,L=S.L,N=S.N,esc=S.esc,ic=S.ic;
const KEY='rb-sched-v3b';
function nav(){const t=S.myType();const I={dash:['layout-dashboard',L('لوحة المشروع','Project dashboard')],list:['list-details',t==='ctr'?L('جداولي','My schedules'):L('الجداول','Schedules')],vers:['versions',L('إصدارات الجدول','Schedule versions')]};
 const ord=t==='owner'?['dash','list','vers']:t==='cons'?['vers','dash','list']:['list','vers'];const cur={sch:'list',p6:'list',mob:'list',ver:'vers'}[st.pg]||st.pg;const T=S.tasks();
 return `<nav class="sv-nav">${ord.map(k=>{const n=T.filter(x=>x.pg===k).length;return `<button class="${cur===k?'on':''}" data-a="go" data-v="${k}">${ic(I[k][0])}${I[k][1]}${n?`<span class="cnt">${n}</span>`:''}</button>`}).join('')}</nav>`}
S.home=u=>{const t=S.coType(S.coOf(u));if(t==='owner')return ['dash'];if(t==='cons')return ['vers'];const s=st.P.schedules.find(x=>x.ctr===S.coOf(u));return s?['sch',s.id]:['list']};
S.allowed=pg=>{const t=S.myType();if(pg==='ovw')return true;if(pg==='dash')return t!=='ctr';if(pg==='sch'||pg==='p6'||pg==='mob'){const s=S.sch((st.arg||'').split('|')[0]);return s&&S.canSee(s)&&(pg==='sch'||S.mine(s))}if(pg==='ver'){const [sid,i]=(st.arg||'').split('|');const s=S.sch(sid);const v=s&&s.versions[+i];return v&&S.canSee(s)&&(v.ext!=='draft'||S.mine(s))}return true};
// ---------- tasks
S.tasks=()=>{const u=st.user,co=S.myCo(),t=S.myType(),pm=S.isPM(),T=[];const P=st.P;
 P.schedules.forEach(s=>{const n=N(s.n);
  if(t==='owner'){if(!s.planned.ok&&pm)T.push({t:L('اعتمد التواريخ الافتراضية — '+n,'Approve planned dates — '+n),pg:'list'});if(!s.ctr&&s.planned.ok&&s.planned.s<P.today&&pm)T.push({t:L(n+' غير مُسند — تأخر تعاقد '+S.dn(S.days(s.planned.s,P.today)),n+' unassigned — contract delay '+S.dn(S.days(s.planned.s,P.today))),pg:'list'});
   s.versions.forEach((v,i)=>{if(v.pendAck&&pm)T.push({t:L('أقرّ قرار الاستشاري — '+n+' '+v.id,'Acknowledge the consultant decision — '+n+' '+v.id),pg:'ver',arg:s.id+'|'+i})})}
  if(t==='cons')s.versions.forEach((v,i)=>{if(v.ext==='review'&&!v.pendAck&&v.int&&v.int.h===u)T.push({t:(pm?L('القرار لك — ','Your decision — '):L('بانتظار مراجعتك — ','Awaiting your review — '))+n+' '+v.id,pg:'ver',arg:s.id+'|'+i})});
  if(t==='ctr'&&s.ctr===co){const d=S.draft(s);if(d&&d.int&&d.int.h===u)T.push({t:(d.int.ret&&!pm?L('أُعيد للتعديل — ','Returned for edits — '):pm?L('أرسله المهندس — ','Sent by your engineer — '):L('مسودة مفتوحة — ','Open draft — '))+n+' '+d.id,pg:s.mode==='p6'&&d.type==='up'?'p6':'sch',arg:s.id});
   if(!pm&&!d&&s.mode==null&&!s.versions.length)T.push({t:L('ابنِ خط الأساس BL-0 — مطلوب قبل '+S.fmt(s.due),'Build baseline BL-0 — due '+S.fmt(s.due)),pg:'sch',arg:s.id});
   if(!pm&&s.mode==='p6'&&s.nextDue&&s.nextDue<P.today&&!d&&!S.review(s).some(v=>v.type==='up'))T.push({t:L('تحديث متأخر '+S.dn(S.days(s.nextDue,P.today))+' — ارفع ملف XER','Update '+S.dn(S.days(s.nextDue,P.today))+' late — upload the XER'),pg:'p6',arg:s.id});
   s.versions.forEach((v,i)=>{if(v.ext==='ret'&&!v.seen&&!pm)T.push({t:L('أرجع الاستشاري ','Consultant returned ')+n+' '+v.id,pg:'ver',arg:s.id+'|'+i})})}});
 return T};
function bell(){const T=S.tasks();return `<div class="sv-bw mw"><button class="bell${T.length?'':' nb'}" data-a="menu" data-v="bell" aria-label="${L('المهام','Tasks')}">${ic('bell')}${T.length?`<span class="sv-bn">${T.length}</span>`:''}</button>${st.menu==='bell'?`<div class="mn2 tsk"><h6>${L('مهامي في الجدول الزمني','My schedule tasks')}</h6>${T.length?T.map(x=>`<button class="mi" data-a="go" data-v="${x.pg}${x.arg?':'+x.arg:''}">${ic('point')}<span>${x.t}</span></button>`).join(''):`<p class="mut" style="margin:6px 10px 10px;font-size:13px">${L('لا مهام الآن.','No tasks right now.')}</p>`}</div>`:''}</div>`}
function meMenu(){const u=st.user;return `<div class="me mw"><button class="me-btn" data-a="menu" data-v="me">${S.av(u,34)}<span class="nm">${esc(S.uN(u))}</span>${ic('chevron-down')}</button>${st.menu==='me'?`<div class="mn2" style="width:260px"><div class="mhd" style="display:flex;gap:10px;align-items:center;padding:10px">${S.av(u,38)}<div><b style="display:block;font-size:13.5px">${esc(S.uN(u))}</b><small class="mut">${S.isPM(u)?L('مدير المشروع','Project Manager'):L('مهندس المشروع','Project Engineer')} · ${esc(S.coN(S.coOf(u)))}</small></div></div><div class="sep"></div><h6>${L('اللغة','Language')}</h6><div class="seg2"><button class="${st.lang==='ar'?'on':''}" data-a="lang" data-v="ar" data-stay>عربي</button><button class="${st.lang==='en'?'on':''}" data-a="lang" data-v="en" data-stay>English</button></div><h6>${L('المظهر','Appearance')}</h6><div class="seg2"><button class="${st.theme!=='dark'?'on':''}" data-a="theme" data-v="light" data-stay>${L('فاتح','Light')}</button><button class="${st.theme==='dark'?'on':''}" data-a="theme" data-v="dark" data-stay>${L('داكن','Dark')}</button></div></div>`:''}</div>`}
S.A.lang=v=>{st.lang=v};S.A.theme=v=>{st.theme=v};
S.chrome=()=>{const R=RS.S;R.lang=st.lang;R.mode=st.theme;R.tab=st.pg==='ovw'?0:11;R.project='rhn';R.menu=null;
 let sb=RS.sidebar(R).replace(/<div class="uc">[\s\S]*?<button class="cbtn"/,`<div class="uc">${S.av(st.user,38)}<div class="uc-tx"><b>${esc(S.uN(st.user))}</b><small>${S.isPM()?L('مدير المشروع','Project Manager'):L('مهندس المشروع','Project Engineer')}</small></div><button class="cbtn"`).replace(/(<span class="ws-tx"><b>[^<]*<\/b><small>)[^<]*(<\/small>)/,'$1'+esc(S.coN(S.myCo()))+'$2');
 const hd=`<header class="hd"><button class="hd-back" data-a="shell" data-v="projects" aria-label="${L('المشاريع','Projects')}">${ic('arrow-left')}</button><span class="hd-pav">${st.lang==='en'?'R':'ر'}</span><div class="hd-tt"><b>${esc(N(st.P.n))}</b><small>${esc(S.coN('own'))}</small></div><div class="hd-sp"></div><button class="srch" data-a="noop">${ic('search')}<span>${L('بحث','Search')}</span><kbd>⌘K</kbd></button>${bell()}${meMenu()}</header>`;
 const tabs=RS.tabs(R).replace('href="schedule.html"','href="#" data-a="go-sch"').replace('data-tab="0"','data-a="go" data-v="ovw"');
 if(!S.allowed(st.pg)){const h=S.home(st.user);st.pg=h[0];st.arg=h[1]||null}
 S.fillPage=false;S.curEd=null;S.EDS={};const scr=S.screens[st.pg];const body=scr?scr(st.arg):'';
 return `<div class="rs${R.col?' col':''}${st.theme==='dark'?' theme-dark':''}" lang="${st.lang}" dir="${S.rtl()?'rtl':'ltr'}">${sb}<div class="mn">${hd}${tabs}<main class="ct sv-ct"><div class="sv${S.fillPage?' fill':''}">${st.pg==='ovw'?'':nav()}${body}</div></main></div>${S.modalHtml()}${st.toast?`<div class="tst ${st.toast.tone||''}" role="status">${esc(st.toast.t)}</div>`:''}${dock()}</div>`};
S.A.noop=()=>false;S.A['go-sch']=()=>{const h=S.home(st.user);st.pg=h[0];st.arg=h[1]||null};
S.A.shell=v=>{location.href='saas-shell.html';return false};
document.addEventListener('click',e=>{const b=e.target.closest('[data-nav],[data-tab],[data-act],[data-toggle],[data-menu]');if(!b||b.closest('[data-a]'))return;const d=b.dataset;
 if(d.act==='collapse'){RS.S.col=!RS.S.col;S.render();return}if(d.toggle){RS.S.open[d.toggle]=!RS.S.open[d.toggle];S.render();return}
 if(d.nav||d.tab!=null){location.href='saas-shell.html';return}});
// ---------- prototype dock
const TD=[()=>!!S.sch('ex').ctr,()=>{const s=S.sch('fi');return s.versions.length&&(s.versions[0].ext!=='draft'||(s.versions[0].int||{}).h==='fpm')},()=>{const s=S.sch('fi');return s.versions.length&&s.versions[0].ext!=='draft'},
 ()=>{const v=S.sch('fi').versions[0];return v&&v.ext!=='draft'&&(v.ext!=='review'||(v.int||{}).h==='cpm')},()=>{const v=S.sch('fi').versions[0];return v&&(v.ext==='acc'||v.ext==='ret')},
 ()=>{const v=S.sch('me').versions.find(x=>x.id==='U-5');return v.ext!=='review'||v.int.h==='cpm'},()=>{const v=S.sch('me').versions.find(x=>x.id==='U-5');return v.ext!=='review'},
 ()=>{const s=S.sch('st');const v=s.versions.find(x=>x.id==='U-15');return !!v&&(v.ext!=='draft'||(v.int||{}).h==='spm')},()=>{const v=S.sch('st').versions.find(x=>x.id==='U-15');return !!v&&v.ext!=='draft'},
 ()=>{const v=S.sch('me').versions.find(x=>x.id==='U-6');return !!v&&!!(v.prog||{})['M-020']},()=>!!(st.ui.dash&&st.ui.dash.pl)];
const TR=[['list'],['sch','fi'],['sch','fi'],['ver','fi|0'],['ver','fi|0'],['ver','me|5'],['ver','me|5'],['p6','st'],['p6','st'],['mob','me'],['dash']];
function tourJump(i){const O=S.ops;const A=[()=>O.assign('ex','wah','2026-10-15','2027-04-30','w'),()=>{O.srcTpl('fi');O.setDur('fi','F-110',24);O.send('fi')},()=>O.release('fi'),
 ()=>{O.seedCm('fi',0,'F-700');O.pass('fi',0)},()=>O.decide('fi',0,'acc'),()=>{O.seedCm('me',5,'M-050');O.seedCm('me',5,'M-020');O.pass('me',5)},()=>O.decide('me',5,'accc'),
 ()=>{O.xerAll('st');O.send('st')},()=>O.release('st'),()=>{O.startUpdate('me');O.progDemo('me')},()=>{(st.ui.dash=st.ui.dash||{}).pl=true}];
 const cu=st.user;for(let j=0;j<i;j++)if(!TD[j]()){try{A[j]()}catch(e){console.error('tour',j,e)}}st.user=cu;const t=SVD.tour[i];st.user=t[1];S.go(TR[i][0],TR[i][1])}
function dock(){const U=SVD.U;const done=st.scen==='seed'?TD.map(f=>{try{return f()}catch(e){return false}}):[];const cur=done.indexOf(false);
 if(!st.dock)return `<div class="dock"><button class="dock-p" data-a="dock">${S.av(st.user,28)}<span>${L('نموذج أولي','Prototype')} <small>· ${esc(S.uN(st.user))}${st.scen==='seed'?' · '+L('الجولة ','Tour ')+done.filter(Boolean).length+'/11':''}</small></span></button></div>`;
 const cos=['own','cons','bin','taq','lam'];
 return `<div class="dock"><div class="dock-w" dir="${S.rtl()?'rtl':'ltr'}"><div class="bdy"><h5>${ic('eye')}${L('عرض كـ — لعرض السلوك فقط، ليس جزءاً من المنتج','View as — for demonstrating behaviour only, not part of the product')}</h5><div class="dock-u">${cos.map(c=>`<div class="dock-co">${esc(S.coN(c))}</div>`+Object.keys(U).filter(k=>U[k][2]===c).map(k=>`<button class="${st.user===k?'on':''}" data-a="as" data-v="${k}">${S.av(k,24)}<span><b>${esc(S.uN(k))}</b><small>${U[k][3]==='pm'?L('مدير المشروع','PM'):L('مهندس المشروع','PE')}</small></span></button>`).join('')).join('')}</div>
 <h5>${ic('route')}${L('السيناريو','Scenario')}</h5><div class="dock-r"><button class="${st.scen==='seed'?'on':''}" data-a="scen" data-v="seed">${L('مشروع ببيانات','Seeded project')}</button><button class="${st.scen==='empty'?'on':''}" data-a="scen" data-v="empty">${L('مشروع فارغ','Empty project')}</button><button data-a="reset">${ic('refresh')} ${L('إعادة الضبط','Reset')}</button></div>
 ${st.scen==='seed'?`<h5>${ic('list-numbers')}${L('الجولة — كل الخطوات يوم 27 سبتمبر','Tour — all steps on 27 Sep')} · ${done.filter(Boolean).length}/11</h5><ol class="tour">${SVD.tour.map((t,i)=>`<li class="${done[i]?'dn':''}${i===cur?' on':''}"><span class="n">${done[i]?ic('check'):i+1}</span><div><small>${S.av(t[1],16)}${esc(S.uN(t[1]))}</small><p>${L(t[2],t[3])}</p>${i===cur?`<button class="go" data-a="tour" data-v="${i}">${L('ابدأ هذه الخطوة','Start this step')}</button>`:done[i]?'':`<button class="jmp" data-a="tour" data-v="${i}">${L('انتقل — تُطبَّق الخطوات السابقة','Jump — earlier steps are applied')}</button>`}</div></li>`).join('')}</ol>`:''}</div></div><button class="dock-p" data-a="dock">${ic('x')}<span>${L('إغلاق','Close')}</span></button></div>`}
S.A.dock=()=>{st.dock=!st.dock};
S.A.as=v=>{st.user=v;st.menu=null;const h=S.home(v);if(!S.allowed(st.pg)){st.pg=h[0];st.arg=h[1]||null}S.toast(L('تعرض الآن كـ ','Now viewing as ')+S.uN(v))};
S.A.tour=v=>{tourJump(+v);st.dock=true};
S.A.scen=v=>{st.scen=v;st.P=v==='empty'?SVD.empty():SVD.seed();st.ui={};S.hist={};st.user='ope';S.go(v==='empty'?'list':'dash');if(v==='seed')st.user='opm'};
S.A.reset=()=>{try{localStorage.removeItem(KEY)}catch(e){}location.reload();return false};
// ---------- persistence
S.save=()=>{try{localStorage.setItem(KEY,JSON.stringify({P:st.P,user:st.user,pg:st.pg,arg:st.arg,lang:st.lang,theme:st.theme,ui:st.ui,scen:st.scen,dock:st.dock}))}catch(e){}};
S.boot=()=>{let o=null;try{o=JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){}
 try{const sh=JSON.parse(localStorage.getItem('rb-shell-v1')||'{}');['col','open','ws'].forEach(k=>{if(sh[k]!==undefined)RS.S[k]=sh[k]});if(!o&&sh.mode)st.theme=sh.mode}catch(e){}
 if(o&&o.P){Object.assign(st,{P:o.P,user:o.user,pg:o.pg,arg:o.arg,lang:o.lang,theme:o.theme,ui:o.ui||{},scen:o.scen||'seed',dock:!!o.dock});Object.values(st.ui).forEach(u=>{if(u){u.edit=null;u.fs=false}})}else st.P=SVD.seed();
 S.render()};
})();
