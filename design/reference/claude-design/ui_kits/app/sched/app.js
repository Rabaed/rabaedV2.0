// Schedule module — app chrome: header, project tabs, role switcher, module nav, submissions inbox, guided tour (11 steps from data), persistence.
(function(){const C=SC,st=C.st,P=SD.project;
const ROLES=['own','oeng','cmgr','ceng','smgr','seng','mmgr','meng','kmgr','keng'];
C.PG={dash:'s5',contracts:'s1',inbox:'sx',build:'s2a',webupd:'s2c',mobile:'s2b',upload:'s3',review:'s4'};
const co=r=>C.U[r||st.role].co;
function nav(r){r=r||st.role;const c=co(r);
 if(c==='o')return [['dash','لوحة المشروع','ti-layout-dashboard'],['contracts','العقود','ti-briefcase'],['inbox','التقديمات','ti-file-text']];
 if(c==='c')return [['dash','لوحة المشروع','ti-layout-dashboard'],['inbox','التقديمات','ti-file-text'],['contracts','العقود','ti-briefcase']];
 if(c==='f')return [['dash','لوحة العقد','ti-layout-dashboard'],['build','جدول العقد','ti-calendar-stats'],['inbox','التقديمات','ti-file-text']];
 if(c==='m')return [['dash','لوحة العقد','ti-layout-dashboard'],['webupd','جدول العقد · التحديث','ti-calendar-stats'],['mobile','الجوال','ti-device-mobile'],['inbox','التقديمات','ti-file-text']];
 return [['dash','لوحة العقد','ti-layout-dashboard'],['upload','رفع ملف الجدول','ti-file-upload'],['inbox','التقديمات','ti-file-text']]}
C.allowed=(pg,r)=>{r=r||st.role;if(pg==='review')return co(r)==='c';return nav(r).some(n=>n[0]===pg)};
C.home=r=>({own:'dash',oeng:'contracts',ceng:'inbox',cmgr:'inbox',keng:'build',kmgr:'build',meng:'mobile',mmgr:'webupd',seng:'upload',smgr:'upload'})[r];
C.denied=()=>C.chrome(C.hdr({title:'لا تملك صلاحية لهذه الصفحة'}),`<section class="sc-card" style="padding:28px"><p class="sc-mut" style="margin:0 0 14px">هذه الصفحة ليست ضمن صلاحيات ${C.U[st.role].r}.</p><button class="sc-b pri" data-a="go" data-v="${C.home(st.role)}">العودة إلى صفحتك</button></section>`);
const S=k=>C.screens[k]&&C.screens[k].state;
const ok=d=>d==='ok'||d==='notes';
// ---------- contract status (one source for contracts, dashboard, inbox)
C.cStat=(c,long)=>{const x=S('s3'),a=S('s2a');
 if(c.id==='st'){if(x.launched){const d=st.stDec;return ok(d)?C.chip('U-15 مقبول','green'):d==='ret'?C.chip('U-15 مُرجَع','red'):C.chip('U-15 قيد المراجعة · قُدّم متأخراً '+C.dys(SD.xer.late),'violet')}
  return (long?C.chip('U-14 مقبول 17 سبتمبر','green')+' ':'')+C.chip('U-15 متأخر عن موعده '+C.dys(SD.xer.late),'red')}
 if(c.id==='me'){const d=st.meDec;return d==='ok'?C.chip('U-5 مقبول','green'):d==='notes'?C.chip('U-5 مقبول بملاحظات','green'):d==='ret'?C.chip('U-5 مُرجَع','red'):C.chip('U-5 قيد المراجعة'+(long?' · منذ 3 أيام · 4 أيام متبقية من 7':''),'violet')}
 if(c.id==='fi'){const d=st.blDec;if(ok(d))return C.chip('خط أساس معتمد · BL-0','green');if(d==='ret')return C.chip('BL-0 مُرجَع','red');if(a.launched)return C.chip('BL-0 قيد المراجعة','violet');return C.chip('بانتظار خط الأساس','amber')+(long?`<small class="sc-hist">مسودة داخلية · مطلوب قبل ${c.due}</small>`:'')}
 if(!c.co)return C.chip('تأخر تعاقد · '+C.dys(Math.max(0,C.days(c.ds,C.TODAY))),'amber');
 return C.chip('بانتظار خط الأساس','amber')};
C.subCount=()=>{const x=S('s3'),a=S('s2a');const R={ok:0,rev:0,ret:0,late:0,list:[]};const add=(k,l)=>{R[k]++;R.list.push(l)};
 if(x.launched){const d=st.stDec;d?add(ok(d)?'ok':'ret','الهيكل U-15'):add('rev','الهيكل U-15')}else{add('ok','الهيكل U-14');add('late','الهيكل U-15')}
 const m=st.meDec;m?add(ok(m)?'ok':'ret','الكهروميكانيكية U-5'):add('rev','الكهروميكانيكية U-5');
 const b=st.blDec;if(b)add(ok(b)?'ok':'ret','التشطيبات BL-0');else if(a.launched)add('rev','التشطيبات BL-0');
 return R};
// ---------- submissions inbox
function subs(){const a=S('s2a'),x=S('s3'),w=S('s2c');const L=[];const dec=d=>d==='ok'?['مقبول','green']:d==='notes'?['مقبول بملاحظات','green']:d==='ret'?['مُرجَع','red']:['قيد المراجعة','violet'];const v=S('s4').byV;
 const intC=b=>b.dec?null:b.ret&&!b.passed?'أُعيد — عند م. سارة':b.passed?'عند م. خالد':'عند م. سارة';
 L.push({id:'U-5',c:'me',type:'تحديث تقدّم',dd:SD.meRev.u5dd,ext:dec(st.meDec),int:intC(v.upd),resp:st.meDec?null:'4 أيام متبقية من 7',rv:'upd'});
 if(w.started)L.push(w.launched?{id:'U-6',c:'me',type:'تحديث تقدّم',dd:SD.u6.dd,ext:dec(null),resp:'7 أيام متبقية من 7'}:{id:'U-6',c:'me',type:'تحديث تقدّم',dd:SD.u6.dd,draft:true,int:w.sent?'عند م. طارق':w.ret?'أُعيد — عند م. نادر':'عند م. نادر',open:'webupd'});
 L.push({id:'U-4',c:'me',type:'تحديث تقدّم',dd:SD.meRev.u4dd,ext:['مقبول','green'],hist:1});
 if(a.launched)L.push({id:'BL-0',c:'fi',type:'خط أساس',ext:dec(st.blDec),int:intC(v.bl),resp:st.blDec?null:'14 يوماً متبقية من 14',rv:'bl'});
 else if(a.filled)L.push({id:'BL-0',c:'fi',type:'خط أساس',draft:true,int:a.sent?'عند م. فهد':a.ret?'أُعيد للتعديل — عند م. أحمد':'عند م. أحمد',open:'build'});
 if(x.launched)L.push({id:'U-15',c:'st',type:'تحديث تقدّم',dd:SD.xer.dd,ext:dec(st.stDec),int:intC(v.p6),resp:st.stDec?null:'7 أيام متبقية من 7',rv:'p6',late:1});
 else{if(x.file)L.push({id:'U-15',c:'st',type:'تحديث تقدّم',dd:SD.xer.dd,draft:true,int:x.sent?'عند م. عبدالله':'عند م. ياسر',open:'upload'});L.push({id:'U-15',c:'st',type:'تحديث تقدّم',dd:SD.xer.dd,overdue:1})}
 L.push({id:'U-14',c:'st',type:'تحديث تقدّم',dd:'2026-09-10',ext:['مقبول · 17 سبتمبر','green'],hist:1});
 return L}
C.subs=subs;
function inboxView(){const c=co();const own=c==='o',con=c==='c',ctr=!own&&!con;const mine={f:'fi',m:'me',s:'st'}[c];
 const L=subs().filter(q=>ctr?q.c===mine:!q.draft);const K=id=>SD.contracts.find(x=>x.id===id);
 const rows=L.map(q=>{const k=K(q.c);let actn='';
  if(con&&q.rv)actn=`<button class="sc-b ${st[{upd:'meDec',bl:'blDec',p6:'stDec'}[q.rv]]?'out':'pri'} sm" data-a="rev" data-v="${q.rv}">${st[{upd:'meDec',bl:'blDec',p6:'stDec'}[q.rv]]?'عرض القرار':'مراجعة'}</button>`;
  if(ctr&&q.draft)actn=`<button class="sc-b out sm" data-a="go" data-v="${q.open}">فتح المسودة</button>`;
  const status=q.overdue?C.chip('متأخر عن موعده · '+C.dys(SD.xer.late),'red'):q.draft?C.chip('مسودة داخلية','gray'):C.chip(q.ext[0],q.ext[1]);
  const internal=q.int&&((con&&!q.draft)||(ctr&&q.draft))?C.chip((q.draft?'':'مراجعة داخلية — ')+q.int,'blue'):'';
  return `<tr${q.overdue?' class="hl"':''}><td><span class="sc-id">${q.id}</span></td><td><b class="sc-cn" style="font-size:13.5px;white-space:nowrap">${k.n}</b>${own||con?`<small class="sc-hist">${k.co}</small>`:''}</td><td>${q.type}</td><td>${q.dd?C.fmt(q.dd):'<span class="sc-fnt">—</span>'}</td><td><div class="sc-dr" style="gap:5px">${status}${internal}${q.late&&!q.overdue?'<small class="sc-hist">قُدّم متأخراً 3 أيام</small>':''}</div></td><td>${q.resp?`<span class="sc-mut">${q.resp}</span>`:'<span class="sc-fnt">—</span>'}</td><td>${actn}</td></tr>`}).join('');
 const sub=own?'تعرض الحالة الخارجية فقط — المراجعة الداخلية للاستشاري لا تظهر لك.':con?'الوارد إليك من المقاولين. مدة الرد تُحسب من الإطلاق، وتستمر أثناء التبادل الداخلي.':'تقديمات عقدك. المسودة الداخلية لا يراها أحد خارج شركتك.';
 return C.chrome(C.hdr({title:'التقديمات',sub:`<span>${sub}</span>`}),`<section class="sc-card"><div class="sc-tbw"><table class="sc-tb"><thead><tr><th>التقديم</th><th>العقد</th><th>النوع</th><th>تاريخ البيانات</th><th>الحالة</th><th>مدة الرد</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`)}
C.screens.sx={view:inboxView,act(a,el){if(a==='rev'){C.go('review',el.dataset.v);return false}return false},state:{}};
// ---------- tasks (bell)
function tasks(r){r=r||st.role;const a=S('s2a'),x=S('s3'),v=S('s4').byV,w=S('s2c');const T=[];const ex=S('s1').cs.find(c=>c.id==='ex');
 if(r==='own'&&!ex.co)T.push(['الأعمال الخارجية غير موقّعة — تأخر تعاقد 26 يوماً','contracts']);
 if(r==='keng'&&!a.launched&&!a.sent)T.push([a.ret?'م. فهد أعاد الجدول للتعديل':'جدول التشطيبات: BL-0 مطلوب قبل 8 أكتوبر','build']);
 if(r==='kmgr'&&a.sent&&!a.launched)T.push(['م. أحمد أرسل BL-0 — أطلقه أو أرجعه','build']);
 if(r==='seng'&&!x.sent&&!x.launched)T.push(['U-15 متأخر 3 أيام — ارفع ملف XER','upload']);
 if(r==='smgr'&&x.sent&&!x.launched)T.push(['م. ياسر أرسل U-15 — أطلقه','upload']);
 if(r==='meng'&&!w.started)T.push(['ابدأ مسودة U-6 من الموقع','mobile']);
 if(r==='mmgr'&&w.sent&&!w.launched)T.push(['م. نادر أرسل U-6','webupd']);
 if(r==='ceng'){if(!v.upd.passed&&!st.meDec)T.push(['U-5 الكهروميكانيكية بانتظار مراجعتك','inbox']);if(a.launched&&!v.bl.passed&&!st.blDec)T.push(['BL-0 التشطيبات وصل','inbox']);if(x.launched&&!v.p6.passed&&!st.stDec)T.push(['U-15 الهيكل وصل','inbox'])}
 if(r==='cmgr'){if(v.upd.passed&&!st.meDec)T.push(['م. سارة مرّرت U-5 — القرار لك','inbox']);if(v.bl.passed&&!st.blDec)T.push(['م. سارة مرّرت BL-0 — القرار لك','inbox']);if(v.p6.passed&&!st.stDec)T.push(['م. سارة مرّرت U-15 — القرار لك','inbox'])}
 return T}
C.tasks=tasks;
function bellMenu(){if(st.menu!=='bell')return '';const T=tasks();return `<div class="menu sc-bmenu"><h6>مهامي في الجدول الزمني</h6>${T.length?T.map(([t,p])=>`<button class="mi" data-a="go" data-v="${p}"><i class="ti ti-point"></i><span style="white-space:normal">${t}</span></button>`).join(''):'<p class="sc-mut" style="margin:6px 10px 10px;font-size:13px">لا مهام الآن.</p>'}</div>`}
function roleMenu(){if(st.menu!=='role')return '';
 return `<div class="menu sc-rmenu">${['o','c','s','m','f'].map(g=>`<h6>${SD.cos[g][1]}</h6><small class="sc-rco">${SD.cos[g][0]}</small>${ROLES.filter(r=>C.U[r].co===g).map(r=>`<button class="mi${r===st.role?' on':''}" data-a="role" data-v="${r}">${C.av(C.U[r],26)}<span><b>${C.U[r].n}</b><small>${C.U[r].r}</small></span>${r===st.role?'<i class="ti ti-check ck"></i>':''}</button>`).join('')}`).join('<div class="sep"></div>')}</div>`}
const PALS={"neutral":["محايد","#f6f7f9","#1f2430"],"warm":["دافئ","#fdf9f5","#231b16"],"slate":["أردوازي","#f3f5f8","#111a2b"],"sage":["مريمية","#f4f6f3","#121a15"],"ocean":["محيطي","#f2f7f8","#0e1c1f"],"plum":["برقوقي","#f6f4f8","#17121e"]};
function setMenu(){if(st.menu!=='set')return '';const sg=(k,opts)=>`<div class="seg2 sc-setg">${opts.map(([v,l])=>`<button class="${st[k]===v?'on':''}" data-a="set" data-v="${k}:${v}">${l}</button>`).join('')}</div>`;
 return `<div class="menu sc-setm"><h6>اللغة</h6>${sg('lang',[['ar','عربي'],['en','English']])}<h6>المظهر</h6>${sg('mode',[['light','فاتح'],['dark','داكن']])}<h6>الألوان</h6><div class="sc-palg">${Object.entries(PALS).map(([k,[n,a,b]])=>`<button class="${st.pal===k?'on':''}" data-a="set" data-v="pal:${k}" title="${n}"><i style="background:linear-gradient(135deg,${a} 50%,${b} 50%)"></i>${n}</button>`).join('')}</div>${st.mode==='dark'?'':`<h6>الشريط الجانبي</h6>${sg('sb',[['dark','داكن'],['light','فاتح']])}`}</div>`}
C.chrome=(ph,body)=>{const RS_=RS.S;RS_.lang=st.lang;RS_.theme=st.sb;RS_.mode=st.mode;RS_.tab=11;RS_.project='rhn';const u=C.U[st.role];const T=tasks();const cmp=SD.cos[u.co];
 const hd=`<header class="hd"><button class="hd-back" data-act="back" aria-label="المشاريع"><i class="ti ti-arrow-left"></i></button><span class="hd-pav">ر</span><div class="hd-tt"><b>${P.n}</b><small>${P.owner}</small></div><div class="hd-sp"></div>
 <button class="srch" data-act="pal"><i class="ti ti-search"></i><span>بحث</span><kbd>⌘K</kbd></button>
 <div class="sc-bw"><button class="bell${T.length?'':' nb'}" data-a="bell" aria-label="المهام"><i class="ti ti-bell"></i>${T.length?`<span class="sc-bn">${T.length}</span>`:''}</button>${bellMenu()}</div>
 <div class="sc-bw"><button class="bell nb" data-a="setmenu" aria-label="إعدادات العرض" title="إعدادات العرض"><i class="ti ti-adjustments-horizontal"></i></button>${setMenu()}</div>
 <div class="sc-rp"><button class="sc-rpb" data-a="rolemenu">${C.av(u,34)}<span><small>تعرض كـ · ${cmp[1].split(' · ')[0]}</small><b>${u.n} · ${u.r}</b></span><i class="ti ti-chevron-down"></i></button>${roleMenu()}</div></header>`;
 const mn=`<div class="sc-mnav"><span class="sc-mn-t"><i class="ti ti-calendar-time"></i>الجدول الزمني</span>${nav().map(([k,l,ic])=>{const n=T.filter(t=>t[1]===k).length;return `<button class="${st.pg===k||(k==='inbox'&&st.pg==='review')?'on':''}" data-a="go" data-v="${k}"><i class="ti ${ic}"></i>${l}${n?`<span class="sc-mn-b">${n}</span>`:''}</button>`}).join('')}<span class="sp"></span><span class="sc-mn-d"><i class="ti ti-calendar"></i>اليوم ${C.fmt(C.TODAY)} · تاريخ البيانات ${C.fmt(P.dd)}</span>${C.gpill()}</div>`;
 let sb=RS.sidebar(RS_).replace(/<div class="uc">[\s\S]*?<button class="cbtn"/,`<div class="uc">${C.av(u,38)}<div class="uc-tx"><b>${u.n}</b><small>${u.r}</small></div><button class="cbtn"`).replace(/(<span class="ws-tx"><b>[^<]*<\/b><small>)[^<]*(<\/small>)/,'$1'+cmp[0]+'$2');
 return `<div class="rs${RS_.col?' col':''}${st.sb==='light'&&st.mode!=='dark'?' light':''}${st.mode==='dark'?' theme-dark':''} sc-app${st.guide?' gopen':''}" lang="${st.lang}" dir="${st.lang==='en'?'ltr':'rtl'}">${sb}<div class="mn">${hd}${RS.tabs(RS_)}${mn}<main class="ct sc-ct">${ph}${body}</main></div></div>`};
// ---------- guided tour (SD.tour)
const DONE=[()=>!!S('s1').cs.find(c=>c.id==='ex').co,()=>S('s2a').sent||S('s2a').launched,()=>S('s2a').launched,()=>S('s4').byV.bl.passed||!!st.blDec,()=>!!st.blDec,()=>S('s4').byV.upd.passed||!!st.meDec,()=>!!st.meDec,()=>S('s3').sent||S('s3').launched,()=>S('s3').launched,()=>S('s2c').started&&!!S('s2c').rows['M-020'],()=>S('s5').defSeen];
const APPLY=[
 ()=>S('s1').api.assign(),
 ()=>{const a=S('s2a');if(!a.filled)a.api.fill();a.api.sim();a.sent=true},
 ()=>{const a=S('s2a');a.sent=true;a.launched=true;a.ret=null},
 ()=>{const v=S('s4');v.api.addSeed('bl','F-700');v.byV.bl.passed=true},
 ()=>{S('s4').byV.bl.dec='ok';st.blDec='ok'},
 ()=>{const v=S('s4');v.api.addSeed('upd','M-050');v.api.addSeed('upd','M-020');v.byV.upd.passed=true},
 ()=>{S('s4').byV.upd.dec='notes';st.meDec='notes'},
 ()=>{const x=S('s3');x.file=true;x.err=false;x.step=3;Object.keys(x.miss).forEach(k=>x.miss[k]=x.miss[k]||'re');x.sent=true},
 ()=>{S('s3').launched=true},
 ()=>{const w=S('s2c');w.started=true;w.by='meng';Object.entries(SD.u6.upd).forEach(([id,p])=>{if(!w.rows[id])C.ME.setVal(id,Object.assign({},p),'mobile')})},
 ()=>{const d=S('s5');d.defSeen=true;d.def=true}];
function jump(i){for(let j=0;j<i;j++)if(!DONE[j]())APPLY[j]();const t=SD.tour[i];C.as(t[1],t[2],t[3])}
C.gpill=()=>{if(st.guide)return '';const done=DONE.map(f=>f());const curI=done.indexOf(false);const n=done.filter(Boolean).length;const N=SD.tour.length;const t=curI>=0?SD.tour[curI]:null;return `<button class="sc-mn-g" data-a="guide"><i class="ti ti-route"></i>الجولة ${n}/${N}${t?` · ${curI+1}. ${C.U[t[1]].n}`:' · اكتملت'}</button>`};
C.guide=()=>{const done=DONE.map(f=>f());const curI=done.indexOf(false);const n=done.filter(Boolean).length;const N=SD.tour.length;
 if(!st.guide)return '';
 let g='';return `<aside class="sc-guide" dir="rtl" lang="ar"><div class="sc-g-hd"><div><b>جولة الموديول</b><small>كل الخطوات يوم ${C.fmt(C.TODAY)} · ${n}/${N}</small></div><button class="sc-ib" data-a="guide" aria-label="تصغير"><i class="ti ti-minus"></i></button></div><div class="sc-g-pb"><i style="width:${n/N*100}%"></i></div>
 <ol class="sc-g-ls">${SD.tour.map((s,i)=>{const ph=s[0]!==g?`<li class="ph">${s[0]}</li>`:'';g=s[0];const u=C.U[s[1]];const on=i===curI;return ph+`<li class="${done[i]?'dn':''}${on?' on':''}"><span class="sc-g-n">${done[i]?'<i class="ti ti-check"></i>':i+1}</span><div><small>${C.av(u,18)}${u.n}</small><p>${s[4]}</p>${on?`<button class="sc-b pri sm" data-a="tour" data-v="${i}">ابدأ هذه الخطوة<i class="ti ti-arrow-left"></i></button>`:done[i]?'':`<button class="sc-lk" data-a="tour" data-v="${i}">انتقل — تُطبَّق الخطوات السابقة</button>`}</div></li>`}).join('')}</ol>
 <div class="sc-g-ft"><button class="sc-lk" data-a="reset"><i class="ti ti-refresh"></i>إعادة ضبط العرض</button></div></aside>`};
C.chromeAct=(a,el)=>{const v=el.dataset.v;
 if(a==='rolemenu'){st.menu=st.menu==='role'?null:'role';return 1}
 if(a==='bell'){st.menu=st.menu==='bell'?null:'bell';return 1}
 if(a==='setmenu'){st.menu=st.menu==='set'?null:'set';return 1}
 if(a==='set'){const [k,x]=v.split(':');st[k]=x;try{const sh=JSON.parse(localStorage.getItem(SK)||'{}');if(k==='lang')sh.lang=x;if(k==='mode')sh.mode=x;if(k==='sb')sh.theme=x;localStorage.setItem(SK,JSON.stringify(sh))}catch(e){}return 1}
 if(a==='role'){C.as(v,C.allowed(st.pg,v)?st.pg:null);return 1}
 if(a==='guide'){st.guide=!st.guide;return 1}
 if(a==='tour'){jump(+v);return 1}
 if(a==='reset'){try{localStorage.removeItem(KEY)}catch(e){}location.reload();return 1}
};
// ---------- system shell navigation
const SK='rb-shell-v1';
function goShell(o){let s={};try{s=JSON.parse(localStorage.getItem(SK)||'{}')}catch(e){}Object.assign(s,o);localStorage.setItem(SK,JSON.stringify(s));location.href='saas-shell.html'}
document.addEventListener('click',e=>{if(e.target.closest('[data-a]'))return;const b=e.target.closest('[data-nav],[data-tab],[data-act],[data-toggle],[data-menu],[data-theme]');
 if(!b){if(st.menu||RS.S.menu){st.menu=null;RS.S.menu=null;C.render()}return}const d=b.dataset;
 if(d.nav)return goShell({page:d.nav,project:null});
 if(d.tab!==undefined)return goShell({project:'rhn',tab:+d.tab});
 if(d.act==='back')return goShell({page:'projects',project:null});
 if(d.act==='pal')return goShell({project:'rhn',pal:false});
 if(d.act==='collapse'){RS.S.col=!RS.S.col;C.render();return}
 if(d.toggle){if(RS.S.col){RS.S.col=false;RS.S.open[d.toggle]=true}else RS.S.open[d.toggle]=!RS.S.open[d.toggle];C.render();return}
 if(d.menu){RS.S.menu=RS.S.menu===d.menu?null:d.menu;C.render();return}});
// ---------- persistence
const KEY='rb-sched-v3';const TRANS=['dr','sel','menu','pick'];
const clean=s=>{const o={};Object.keys(s).forEach(k=>{if(k!=='api')o[k]=s[k]});return o};
C.save=()=>{try{const o={st:{pg:st.pg,role:st.role,meDec:st.meDec,blDec:st.blDec,stDec:st.stDec,guide:st.guide,lang:st.lang,mode:st.mode,sb:st.sb,pal:st.pal}};Object.keys(C.screens).forEach(k=>{const s=C.screens[k].state;if(s)o[k]=clean(s)});localStorage.setItem(KEY,JSON.stringify(o));const sh=JSON.parse(localStorage.getItem(SK)||'{}');sh.col=RS.S.col;localStorage.setItem(SK,JSON.stringify(sh))}catch(e){}};
try{const sh=JSON.parse(localStorage.getItem(SK)||'{}');['col','theme','open','ws'].forEach(k=>{if(sh[k]!==undefined)RS.S[k]=sh[k]});if(sh.mode)st.mode=sh.mode;if(sh.theme)st.sb=sh.theme}catch(e){}
try{const o=JSON.parse(localStorage.getItem(KEY)||'null');if(o){Object.assign(st,o.st);Object.keys(C.screens).forEach(k=>{const s=C.screens[k].state;if(!o[k]||!s)return;const sv=o[k];Object.keys(sv).forEach(f=>{if(f==='ui'&&s.ui){Object.assign(s.ui,sv.ui);s.ui.edit=null;s.ui.more=false}else s[f]=sv[f]});TRANS.forEach(t=>{if(t in s)s[t]=null})})}}catch(e){console.error(e)}
if(S('s2a').filled&&S('s2a').acts)S('s2a').api.calc();
if(!C.allowed(st.pg))st.pg=C.home(st.role);
})();
