// Schedule module v3 — core: state, i18n, dates & project calendar, CPM + progress engine, permissions, UI primitives, render loop.
(function(){
const SV=window.SV={A:{},IN:{},CH:{},after:[],screens:{}};
const st=SV.st={lang:'ar',theme:'light',user:'opm',pg:'dash',arg:null,modal:null,toast:null,menu:null,dock:false,scen:'seed',ui:{},P:null};
SV.L=(a,e)=>st.lang==='en'?e:a;
SV.N=x=>x==null?'':typeof x==='string'?x:(st.lang==='en'?x[1]:x[0]);
const esc=SV.esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
SV.rtl=()=>st.lang!=='en';
// ---------- dates
const D=SV.D=s=>{const a=s.split('-').map(Number);return new Date(Date.UTC(a[0],a[1]-1,a[2]))};
const iso=SV.iso=d=>d.toISOString().slice(0,10);
const addD=SV.addD=(s,n)=>iso(new Date(D(s).getTime()+n*864e5));
const days=SV.days=(a,b)=>Math.round((D(b)-D(a))/864e5);
const MA=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'],ME=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
SV.mon=(m,short)=>st.lang==='en'?ME[m]:(short?MA[m]:MA[m]);
SV.fmt=(s,o)=>{if(!s)return '—';const d=D(s),m=d.getUTCMonth(),y=d.getUTCFullYear();const sy=o==='s'||(o!=='y'&&y===2026&&o==='a');return d.getUTCDate()+' '+SV.mon(m)+(o==='s'?'':' '+y)};
SV.fmtT=s=>{const [d,t]=s.split('T');return SV.fmt(d)+' · '+t};
SV.dn=n=>{n=Math.abs(n);return st.lang==='en'?n+(n===1?' day':' days'):n===1?'يوم واحد':n===2?'يومان':n<=10?n+' أيام':n+' يوماً'};
SV.sd=n=>(n>0?'+':n<0?'−':'')+Math.abs(n);
// ---------- calendar
const P=()=>st.P;
const isWork=SV.isWork=s=>{const c=P().cal,d=D(s);return !c.off.includes(d.getUTCDay())&&!c.hol.some(h=>h[0]===s)};
const nx=SV.nx=s=>{let d=addD(s,1);while(!isWork(d))d=addD(d,1);return d};
SV.onOrNext=s=>isWork(s)?s:nx(s);
const addWd=SV.addWd=(s,n)=>{let d=s;for(let i=0;i<n;i++)d=nx(d);return d};
const wdays=SV.wdays=(a,b)=>{if(b<a)return 0;let n=0,d=a;while(d<=b){if(isWork(d))n++;d=addD(d,1)}return n};
// ---------- CPM (FS + lag, SNET pins). Mutates: ps, pe, crit, drv(driving predecessor), es0 (earliest by logic)
SV.cpm=(acts,start)=>{const L=acts.filter(a=>!a.del);const M={};L.forEach(a=>M[a.id]=a);
 const s0=SV.onOrNext(start);const WD=[s0];const idx={};idx[s0]=0;const W=i=>{while(WD.length<=i){const n=nx(WD[WD.length-1]);idx[n]=WD.length;WD.push(n)}return WD[i]};
 const ix=d=>{d=SV.onOrNext(d);if(d<s0)return 0;W(0);while(!(d in idx))W(WD.length);return idx[d]};
 const order=[],seen={},on={};const vis=a=>{if(seen[a.id])return;if(on[a.id])return;on[a.id]=1;a.pred.forEach(p=>M[p[0]]&&vis(M[p[0]]));seen[a.id]=1;order.push(a)};L.forEach(vis);
 order.forEach(a=>{let es=0,drv=null;a.pred.forEach(p=>{const q=M[p[0]];if(!q)return;const c=q._f+1+(p[1]||0);if(c>es){es=c;drv=q.id}});a.es0=es;a.drv=drv;if(a.pin){const pi=ix(a.pin);if(pi>es)es=pi}a._s=es;a._f=a.ms?es-1:es+Math.max(1,a.dur)-1;a.ps=W(es);a.pe=a.ms?W(es):W(a._f);a.minStart=W(a.es0)});
 const E=Math.max(0,...L.map(a=>a.ms?a._s:a._f));const succ={};L.forEach(a=>a.pred.forEach(p=>{if(M[p[0]])(succ[p[0]]=succ[p[0]]||[]).push([a,p[1]||0])}));
 for(let i=order.length-1;i>=0;i--){const a=order[i];let lf=a.ms?E-1:E;(succ[a.id]||[]).forEach(([b,l])=>{lf=Math.min(lf,b._ls-1-l)});a._ls=a.ms?lf+1:lf-a.dur+1;a.crit=a._ls-a._s<=0?1:0}
 return L.reduce((m,a)=>a.pe>m?a.pe:m,s0)};
// ---------- progress engine (update drafts). prev = previous accepted update progress map; d = draft edits; dd = data date
SV.prevFin=(a,p)=>p&&(p.f||p.xf)||(p&&p.a?addWd(p.a,Math.max(0,a.dur-1)):a.pe);
SV.prevSt=(a,p)=>p&&(p.a||p.xs)||a.ps;
SV.forecast=(acts,prev,d,dd)=>{const M={},R={};acts.forEach(a=>M[a.id]=a);const order=[],seen={};const vis=a=>{if(seen[a.id])return;seen[a.id]=1;a.pred.forEach(p=>M[p[0]]&&vis(M[p[0]]));order.push(a)};acts.forEach(vis);
 order.forEach(a=>{const p=prev[a.id]||{},x=d[a.id]||{};const v=Object.assign({},p,x);const pf=SV.prevFin(a,p),ps=SV.prevSt(a,p);let s,e,kn=null,rem;
  if(v.f){s=v.a||v.f;e=v.f;rem=0}
  else if(v.a){s=v.a;if(x.rem!=null||x.p!=null){rem=x.rem!=null?x.rem:Math.ceil(a.dur*(1-(v.p||0)/100));e=rem>0?addWd(nx(dd),rem-1):dd}else{e=pf;rem=wdays(nx(dd),e)}}
  else{let req=null,drv=null;a.pred.forEach(q=>{const r=R[q[0]];if(!r)return;const c=addWd(nx(r.e),q[1]||0);if(!req||c>req){req=c;drv=q[0]}});
   if(req&&req>ps){s=req;e=a.ms?s:addWd(s,Math.max(0,wdays(ps,pf)-1));kn=drv}else{s=ps;e=pf}rem=a.ms?0:wdays(s,e)}
  const slip=e>pf;R[a.id]={s,e,a:v.a||null,f:v.f||null,p:v.f?100:(v.p||0),rem,slip,kn:slip&&!x.a&&!x.f&&x.p==null&&x.rem==null?kn:null,pf,r:v.r||null,rn:v.rn||null,ev:v.ev||null,src:x.src||null,srcD:x.srcD||null,oos:v.oos,xs:v.xs,xf:v.xf}});
 return R};
SV.dateOk=(d,prevDD,dd)=>{if(!d)return SV.L('تاريخ غير صالح','Invalid date');const max=dd<st.P.today?dd:st.P.today;if(d<=prevDD)return SV.L('التاريخ الفعلي يجب أن يكون بعد تاريخ البيانات السابق '+SV.fmt(prevDD),'Actual dates must be after the previous data date '+SV.fmt(prevDD));if(d>max)return SV.L('لا يُقبل تاريخ بعد '+SV.fmt(max)+' — لا تواريخ مستقبلية','Not after '+SV.fmt(max)+' — no future dates');return null};
// ---------- people & permissions
SV.U=id=>SVD.U[id];SV.uN=id=>id?SV.N(SVD.U[id]):'';SV.coOf=id=>SVD.U[id][2];SV.isPM=id=>SVD.U[(id||st.user)][3]==='pm';
SV.me=()=>st.user;SV.myCo=()=>SV.coOf(st.user);SV.coType=co=>SVD.CO[co][1];SV.myType=()=>SV.coType(SV.myCo());
SV.coN=co=>co?SV.N(SVD.CO[co][0]):'';
SV.pmOf=co=>Object.keys(SVD.U).find(k=>SVD.U[k][2]===co&&SVD.U[k][3]==='pm');SV.peOf=co=>Object.keys(SVD.U).find(k=>SVD.U[k][2]===co&&SVD.U[k][3]==='pe');
SV.sch=id=>st.P.schedules.find(s=>s.id===id);
SV.canSee=s=>{const t=SV.myType();return t!=='ctr'||s.ctr===SV.myCo()};
SV.mine=s=>s.ctr===SV.myCo();
SV.draft=s=>s.versions.find(v=>v.ext==='draft');
SV.review=s=>s.versions.filter(v=>v.ext==='review');
SV.lastAcc=(s,type)=>{for(let i=s.versions.length-1;i>=0;i--){const v=s.versions[i];if((v.ext==='acc'||v.ext==='accc')&&(!type||(type==='bl'?v.type!=='up':v.type===type)))return v}return null};
SV.activeBL=s=>SV.lastAcc(s,'bl');
SV.blActs=s=>{const v=SV.activeBL(s);if(!v)return null;return v.acts||s.base||s.acts};
SV.lastUp=s=>SV.lastAcc(s,'up');
SV.remain=(s,v)=>{const R=v.type==='up'?s.resp.up:s.resp.bl;return R-days(v.rel,st.P.today)};
SV.visibleVersion=v=>v.ext!=='draft'||false;
SV.nextNo=(s,type,ex)=>{if(type==='up'){const n=s.versions.filter(v=>v.type==='up'&&v!==ex).length;return 'U-'+(n+1)}const n=s.versions.filter(v=>v.type!=='up'&&(v.ext==='acc'||v.ext==='accc')).length;return 'BL-'+(type==='bl'?0:n)};
SV.addLog=(v,ev,note)=>{v.log.push({ev,by:st.user,at:st.P.today+'T'+SV.clock(),note:note||null})};
SV.clock=()=>{const n=(st.P.tick=(st.P.tick||0)+1);const m=9*60+10+n*7;return String(Math.floor(m/60)%24).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
SV.reasonN=k=>{const r=SVD.REASONS.find(x=>x[0]===k);return r?SV.L(r[1],r[2]):''};
SV.RT={ctr:'red',own:'amber',cons:'violet',wx:'cyan',fm:'gray',oth:'orange',co:'blue'};
// ---------- UI primitives (mirror the design-system components)
const ic=SV.ic=(n,c)=>`<i class="ti ti-${n}${c?' '+c:''}"></i>`;
SV.btn=(label,o)=>{o=o||{};return `<button class="b ${o.k||'sec'}${o.sm?' sm':''}${o.lg?' lg':''}${o.cls?' '+o.cls:''}"${o.a?` data-a="${o.a}"`:''}${o.v!=null?` data-v="${esc(o.v)}"`:''}${o.dis?' disabled':''}${o.title?` title="${esc(o.title)}"`:''}${o.id?` id="${o.id}"`:''}>${o.ic?ic(o.ic):''}${label?`<span>${label}</span>`:''}${o.caret?ic('chevron-down','cr'):''}</button>`};
SV.ib=(icn,o)=>{o=o||{};return `<button class="ib${o.cls?' '+o.cls:''}"${o.a?` data-a="${o.a}"`:''}${o.v!=null?` data-v="${esc(o.v)}"`:''} title="${esc(o.title||'')}" aria-label="${esc(o.title||'')}"${o.dis?' disabled':''}>${ic(icn)}</button>`};
SV.bd=(t,tone,o)=>`<span class="bd t-${tone||'gray'}${o&&o.dot?' dot':''}"${o&&o.title?` title="${esc(o.title)}"`:''}>${o&&o.ic?ic(o.ic):''}${t}</span>`;
SV.seg=(opts,val,a)=>`<span class="seg" role="radiogroup">${opts.map(([k,l])=>`<button class="${val===k?'on':''}" data-a="${a}" data-v="${k}" role="radio" aria-checked="${val===k}">${l}</button>`).join('')}</span>`;
SV.sw=(on,a,v,dis)=>`<button class="sw${on?' on':''}" data-a="${a}"${v!=null?` data-v="${esc(v)}"`:''} role="switch" aria-checked="${!!on}"${dis?' disabled':''}><i></i></button>`;
SV.av=(id,s)=>{s=s||28;const u=SVD.U[id];const hue={own:'tomato',cons:'violet',bin:'green',taq:'blue',lam:'orange',wah:'cyan'}[u[2]];const n=u[1].replace('Eng. ','');return `<span class="av" style="width:${s}px;height:${s}px;font-size:${Math.round(s*.4)}px;background:var(--tone-${hue}-solid)">${n.split(' ').map(w=>w[0]).slice(0,2).join('')}</span>`};
SV.tag=code=>code?`<span class="tg t-${{CV:'amber',AR:'violet',EL:'cyan',ME:'green',SU:'orange'}[code]||'gray'}">${code}</span>`:'<span class="fnt">—</span>';
SV.menu=(key,items,o)=>st.menu!==key?'':`<div class="mn2${o&&o.start?' st':''}"${o&&o.w?` style="width:${o.w}px"`:''}>${items.map(x=>x==='-'?'<div class="sep"></div>':x.h?`<h6>${x.h}</h6>`:`<button class="mi${x.on?' on':''}${x.dan?' dan':''}" data-a="${x.a}"${x.v!=null?` data-v="${esc(x.v)}"`:''}${x.dis?' disabled title="'+esc(x.dis===true?'':x.dis)+'"':''}>${x.ic?ic(x.ic):''}<span>${x.l}</span>${x.on?ic('check','ck'):''}${x.k?`<kbd>${x.k}</kbd>`:''}</button>`).join('')}</div>`;
SV.toast=(t,tone)=>{st.toast={t,tone};clearTimeout(SV._tt);SV._tt=setTimeout(()=>{st.toast=null;SV.render()},3200)};
SV.modal=o=>{st.modal=o};
SV.field=(label,inner,o)=>`<label class="fl${o&&o.cls?' '+o.cls:''}"><span class="fl-l">${label}${o&&o.req?` <em>${SV.L('إلزامي','Required')}</em>`:''}</span>${inner}${o&&o.hint?`<small>${o.hint}</small>`:''}</label>`;
// ---------- render loop
SV.render=()=>{const app=document.getElementById('app');const keep={};app.querySelectorAll('[data-keep]').forEach(e=>keep[e.dataset.keep]=[e.scrollTop,e.scrollLeft]);const wy=scrollY;
 const H=document.documentElement;H.lang=st.lang;H.dir=SV.rtl()?'rtl':'ltr';H.classList.toggle('theme-dark',st.theme==='dark');
 app.innerHTML=SV.chrome();app.querySelectorAll('[data-keep]').forEach(e=>{const k=keep[e.dataset.keep];if(k){e.scrollTop=k[0];e.scrollLeft=k[1]}});scrollTo(0,wy);
 SV.save&&SV.save();SV.after.slice().forEach(f=>{try{f()}catch(err){console.error(err)}})};
document.addEventListener('click',e=>{const el=e.target.closest('[data-a]');if(!el){if(st.menu&&!e.target.closest('.mn2,.dd-pop')){st.menu=null;SV.render()}return}if(el.disabled)return;const a=el.dataset.a;const f=SV.A[a];if(!f){console.warn('no action',a);return}
 if(st.menu&&a!=='menu'&&!el.hasAttribute('data-stay'))st.menu=null;const r=f(el.dataset.v,el,e);if(r!==false)SV.render()});
document.addEventListener('input',e=>{const el=e.target.closest('[data-in]');if(!el)return;const f=SV.IN[el.dataset.in];if(f&&f(el,e)===true)SV.render()});
document.addEventListener('change',e=>{const el=e.target.closest('[data-ch]');if(!el)return;const f=SV.CH[el.dataset.ch];if(f&&f(el,e)!==false)SV.render()});
SV.A.menu=v=>{st.menu=st.menu===v?null:v};
SV.A.x=()=>{st.modal=null};
SV.A.ok=()=>{const m=st.modal;if(!m)return;const r=m.onOk?m.onOk():null;if(r===false)return;if(typeof r==='string'){m.err=r;return}if(st.modal===m)st.modal=null};
SV.A.go=v=>{const [pg,arg]=v.split(':');SV.go(pg,arg)};
SV.go=(pg,arg)=>{st.pg=pg;st.arg=arg||null;st.menu=null;scrollTo(0,0)};
SV.modalHtml=()=>{const m=st.modal;if(!m)return '';const body=typeof m.body==='function'?m.body():m.body;return `<div class="scrim" data-a="x"></div><div class="md${m.wide?' wide':''}" role="dialog" aria-modal="true"><div class="md-hd"><h3>${m.title}</h3>${SV.ib('x',{a:'x',title:SV.L('إغلاق','Close')})}</div><div class="md-bd">${body}${m.err?`<div class="nt t-red">${ic('alert-circle')}<span>${m.err}</span></div>`:''}</div>${m.ok===null?'':`<div class="md-ft">${SV.btn(SV.L('إلغاء','Cancel'),{a:'x',k:'ter'})}${SV.btn(m.ok||SV.L('تأكيد','Confirm'),{a:'ok',k:m.kind||'pri'})}</div>`}</div>`};
SV.mv=id=>{const el=document.getElementById(id);return el?el.value:''};
})();
