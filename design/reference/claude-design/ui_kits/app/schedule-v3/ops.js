// Schedule module v3 — state operations (the cycle). Every screen and the tour go through these.
(function(){const S=SV,st=S.st,L=S.L,N=S.N;const O=S.ops={};
const P=()=>st.P,sch=S.sch,today=()=>P().today;
const cp=x=>JSON.parse(JSON.stringify(x));
O.baseActs=s=>{const A=S.blActs(s)||[];A.forEach(a=>{if(a.dur==null)a.dur=a.ms?0:S.wdays(a.ps,a.pe)});return A};
O.calc=s=>{const d=S.draft(s);if(d&&d.acts&&s.mode==='rab'&&d.type!=='up')d.end=S.cpm(d.acts,s.contract.s);return d};
O.end=acts=>acts.filter(a=>!a.del).reduce((m,a)=>a.pe>m?a.pe:m,'0');
// ---------- owner
O.create=(n,sc,s,e)=>{const id='s'+Date.now().toString(36);P().schedules.push({id,n,scope:sc,planned:{s,e,ok:false,hist:[{s,e,by:st.user,at:today()+'T'+S.clock()}]},ctr:null,contract:null,cycle:null,resp:{bl:14,up:7},ack:false,sil:false,mode:null,versions:[],groups:[],acts:[]});return id};
O.approvePlanned=sid=>{const s=sch(sid);s.planned.ok=true;const h=s.planned.hist[s.planned.hist.length-1];if(h)h.ok=st.user};
O.editPlanned=(sid,a,b)=>{const s=sch(sid);s.planned.s=a;s.planned.e=b;s.planned.hist.push({s:a,e:b,by:st.user,at:today()+'T'+S.clock()});if(S.coType(S.myCo())==='owner'&&!S.isPM())s.planned.ok=false};
O.assign=(sid,co,a,b,cy,o)=>{o=o||{};const s=sch(sid);Object.assign(s,{ctr:co,contract:{s:a,e:b},cycle:cy,assigned:today(),resp:o.resp||{bl:14,up:7},ack:!!o.ack,sil:!!o.sil,due:S.addD(today(),28),mode:null})};
// ---------- contractor: sources
function newDraft(s,type,extra){const v=Object.assign({id:type==='up'?S.nextNo(s,'up'):type==='bl'?'BL-0':S.nextNo(s,'rev'),type,ext:'draft',int:{h:S.peOf(s.ctr)},log:[],cm:[]},extra||{});const prevRet=[...s.versions].reverse().find(x=>x.ext==='ret'&&x.type===type);if(prevRet)v.resub=prevRet.id;s.versions.push(v);return v}
O.srcTpl=sid=>{const s=sch(sid);if(s.versions.some(v=>v.ext!=='draft'))return 0;const T=SVD.tplFinishes();s.mode='rab';const v=S.draft(s)||newDraft(s,'bl');v.acts=T.acts;v.groups=T.groups;v.src='tpl';O.calc(s);return v.acts.length};
O.srcManual=sid=>{const s=sch(sid);if(s.versions.some(v=>v.ext!=='draft'))return;s.mode='rab';const v=S.draft(s)||newDraft(s,'bl');v.groups=[{id:'G1',n:L('المرحلة 1','Phase 1')}];v.acts=[{id:'A-100',n:L('نشاط جديد','New activity'),g:'G1',ws:null,disc:null,zone:null,bld:null,fl:null,dur:1,pred:[]}];v.src='man';O.calc(s)};
O.srcXer=sid=>{const s=sch(sid);if(s.versions.some(v=>v.ext!=='draft'))return;s.mode='p6';const T=SVD.tplFinishes();const v=S.draft(s)||newDraft(s,'bl');v.acts=T.acts;v.groups=[{id:'P6',n:['من ملف P6','From the P6 file']}];v.acts.forEach(a=>a.g='P6');S.cpm(v.acts,s.contract.s);v.p6={file:'Finishes_BL0.xer',step:1,type:'bl',miss:{},loaded:false};v.src='xer'};
O.replace=sid=>{const s=sch(sid);const v=S.draft(s);if(v&&v.type==='bl'&&!s.versions.some(x=>x!==v&&x.type==='bl'))s.versions.splice(s.versions.indexOf(v),1);else if(v){v.acts=null;v.groups=[]}s.mode=null;S.hist={}};
O.setDur=(sid,id,n)=>{const s=sch(sid);const v=S.draft(s);const a=v.acts.find(x=>x.id===id);a.dur=n;O.calc(s)};
// ---------- internal cycle (any company)
O.send=sid=>{const s=sch(sid);const v=S.draft(s);v.int={h:S.pmOf(s.ctr),from:st.user,ret:null}};
O.returnPE=(sid,note)=>{const s=sch(sid);const v=S.draft(s);v.int={h:S.peOf(s.ctr),ret:{note,by:st.user,at:today()}}};
O.canRelease=s=>{const v=S.draft(s);if(!v)return L('لا مسودة','No draft');if(S.review(s).some(x=>(x.type==='up')===(v.type==='up')))return L('طلب واحد معلّق من كل نوع — بانتظار قرار الاستشاري على ','One pending version per type — awaiting the consultant decision on ')+S.review(s).find(x=>(x.type==='up')===(v.type==='up')).id;
 if(v.type==='up'&&v.acts==null&&!v.p6){const R=O.fc(s);const miss=Object.keys(R).filter(k=>R[k].slip&&!R[k].kn&&!R[k].r);if(miss.length)return L('سبب التأخير إلزامي: ','Delay reason required: ')+miss.join('، ')}
 if(v.p6){const m=Object.keys(v.p6.miss||{}).filter(k=>!v.p6.miss[k]);if(m.length)return L('أعد إسناد أو فكّ ربط ','Reassign or unlink ')+m.join('، ');if(v.p6.shifted&&v.p6.shifted.some(x=>!x[2]&&!x[3]))return L('سبب التأخير إلزامي على كل نشاط منزاح','A delay reason is required on every shifted activity')}
 if(v.type==='rev'&&v.acts){const del=v.acts.filter(a=>a.del&&(v.base[a.id]||{}).hasCm&&!a.reas);if(del.length)return L('أعد إسناد التعليقات أو الأدلة لـ ','Reassign comments or evidence for ')+del.map(a=>a.id).join('، ')}return null};
O.release=sid=>{const s=sch(sid);const v=S.draft(s);const err=O.canRelease(s);if(err)return err;
 if(v.type==='up'&&!v.p6){const R=O.fc(s);const pv=O.prevUp(s);const full=cp(pv&&pv.prog||{});v.changed=Object.keys(v.prog);Object.keys(v.prog).forEach(k=>{full[k]=Object.assign(full[k]||{},v.prog[k])});Object.keys(R).forEach(k=>{const r=R[k],x=full[k]=full[k]||{};if(!r.a&&!r.f&&(r.s!==(x.xs||null)||r.e!==(x.xf||null))&&(x.xs||r.kn)){x.xs=r.s;x.xf=r.e;if(r.kn)x.kn=r.kn}else if(r.a&&!r.f)x.xf=r.e});v.prog=full;v.fe=Object.values(R).reduce((m,r)=>r.e>m?r.e:m,'0');v.act=s.cur&&s.cur.act;v.pl=s.cur&&s.cur.pl}
 if(v.type!=='up'&&s.mode==='rab'){O.calc(s);v.end=O.end(v.acts)}
 if(v.p6&&v.type==='up'){v.fe=SVD.XER.end;v.dd=SVD.XER.dd;s.nextDue=S.addD(v.dd,14)}
 v.ext='review';v.rel=today();v.int={h:S.peOf('cons')};S.addLog(v,v.resub?'resub':'rel');return null};
// ---------- consultant
O.comment=(sid,vi,aid,t,hid)=>{const v=sch(sid).versions[vi];v.cm.push({id:(v.cm.reduce((m,c)=>Math.max(m,c.id),0)+1),a:aid,by:st.user,t,hid:!!hid,at:today()})};
O.seedCm=(sid,vi,aid)=>{const x=SVD.seedCm[sid][aid];const v=sch(sid).versions[vi];if(v.cm.some(c=>c.a===aid&&c.seed))return;v.cm.push({id:v.cm.length+1,a:aid,by:'cpe',t:[x[0],x[1]],hid:x[2],at:today(),seed:1})};
O.pass=(sid,vi)=>{const v=sch(sid).versions[vi];v.int={h:S.pmOf('cons'),from:st.user}};
O.consReturn=(sid,vi,note)=>{const v=sch(sid).versions[vi];v.int={h:S.peOf('cons'),ret:{note,by:st.user,at:today()}}};
function apply(s,v,dec,by){v.ext=dec;v.dec=today();v.decBy=by;v.int=null;
 if(dec==='ret'){const d=newDraft(s,v.type,{});if(v.acts){d.acts=cp(v.acts);d.groups=cp(v.groups||s.groups);d.base=v.base}if(v.prog){d.prog=cp(v.prog);d.dd=v.dd;d.prevDD=v.prevDD}if(v.p6)d.p6=cp(v.p6);d.id=v.id;d.retFrom=s.versions.indexOf(v);return}
 if(v.type!=='up'){s.acts=v.acts;s.groups=v.groups;if(v.type==='bl'&&s.mode==='rab'&&v.acts){s.cur={act:0,pl:0,fe:O.end(v.acts)}}if(v.type==='rev'){v.acts=v.acts.filter(a=>!a.del);s.cur=Object.assign({},s.cur||{},{fe:O.end(v.acts)});s.revNote={id:v.id,r:v.reason,at:today()}}}
 else{s.cur=Object.assign({},s.cur||{},{fe:v.fe||(s.cur||{}).fe});if(v.fe&&s.trend)s.trend.push([v.id,v.dd,v.fe])}}
O.decide=(sid,vi,dec,note)=>{const s=sch(sid);const v=s.versions[vi];v.decNote=note||null;S.addLog(v,'dec',dec);if(s.ack){v.pendAck={dec,by:st.user};v.int={h:null};return}apply(s,v,dec,st.user)};
O.ack=(sid,vi)=>{const s=sch(sid);const v=s.versions[vi];const d=v.pendAck;v.pendAck=null;S.addLog(v,'ack');apply(s,v,d.dec,d.by)};
O.withdraw=(sid,vi)=>{const s=sch(sid);const v=s.versions[vi];S.addLog(v,'wd');v.ext='draft';v.int={h:S.pmOf(s.ctr)};delete v.rel};
// ---------- progress update
O.prevUp=s=>{for(let i=s.versions.length-1;i>=0;i--){const v=s.versions[i];if(v.type==='up'&&v.ext!=='draft'&&v.ext!=='ret')return v}return null};
O.startUpdate=sid=>{const s=sch(sid);if(S.draft(s))return;const pv=O.prevUp(s);const pdd=pv?pv.dd:S.addD(s.contract.s,-1);let dd=S.addD(pdd,s.cycle==='f'?14:7);if(!pv){dd=S.addD(P().dd,7)}newDraft(s,'up',{dd,prevDD:pdd,prog:{}})};
O.fc=s=>{const d=S.draft(s);const pv=O.prevUp(s);const up=d&&d.type==='up'&&d.prog;return S.forecast(O.baseActs(s),pv&&pv.prog||{},up?d.prog:{},up?d.dd:(pv?pv.dd:P().dd))};
O.prog=(sid,aid,patch,src)=>{const s=sch(sid);const v=S.draft(s);const x=v.prog[aid]=Object.assign(v.prog[aid]||{},patch);if(x.f){x.p=100;x.rem=0;if(!x.a)x.a=x.f}x.src=src||'web';x.srcD=today()};
O.progDemo=sid=>{O.prog(sid,'M-020',{f:'2026-09-26'},'mobile');O.prog(sid,'M-070',{a:'2026-09-27',p:40},'mobile');O.prog(sid,'M-050',{p:60,r:'ctr'},'mobile');const R=O.fc(sch(sid));if(R['M-070'].slip)O.prog(sid,'M-070',{r:'ctr'},'mobile')};
O.setDD=(sid,dd)=>{const v=S.draft(sch(sid));v.dd=dd};
// ---------- baseline revision
O.reqRev=(sid,reason,desc)=>{const s=sch(sid);const A=cp(O.baseActs(s));const base={};A.forEach(a=>{base[a.id]=cp(a);const c=s.versions.some(v=>(v.cm||[]).some(q=>q.a===a.id));if(c)base[a.id].hasCm=1});newDraft(s,'rev',{acts:A,groups:cp(s.groups),base,reason,desc});if(s.mode==='rab')O.calc(s)};
// ---------- P6 / XER
O.xerLoad=(sid,type,reason)=>{const s=sch(sid);let v=S.draft(s);const X=SVD.XER;if(!v)v=newDraft(s,type==='rev'?'rev':'up',{});v.type=type==='rev'?'rev':'up';v.id=v.type==='up'?S.nextNo(s,'up',v):S.nextNo(s,'rev');v.reason=reason||null;v.dd=X.dd;v.p6={file:X.file,step:2,type,loaded:true,miss:{A1040:null,A2210:null},shifted:X.shifted.map(r=>[r[0],r[1],r[2],r[3]])};return v};
O.xerReassign=(sid,id,how)=>{const v=S.draft(sch(sid));v.p6.miss[id]=how};
O.xerAll=sid=>{const v=O.xerLoad(sid,'up');O.xerReassign(sid,'A1040','A1310');O.xerReassign(sid,'A2210','unlink');v.p6.step=3};
O.late=s=>s.nextDue&&s.nextDue<today()&&!s.versions.some(v=>v.type==='up'&&v.ext!=='draft'&&v.dd>=s.nextDue)?S.days(s.nextDue,today()):0;
})();
