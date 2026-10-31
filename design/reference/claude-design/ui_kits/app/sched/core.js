// Schedule module — helpers, render loop, events. Chrome (roles, nav, guide) lives in app.js. Exposes window.SC.
(function(){
const M=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const D=s=>{const a=s.split('-').map(Number);return new Date(Date.UTC(a[0],a[1]-1,a[2]))};
const iso=d=>d.toISOString().slice(0,10);
const fmt=(s,noY)=>{if(!s)return '—';const d=D(s);return d.getUTCDate()+' '+M[d.getUTCMonth()]+(noY?'':' '+d.getUTCFullYear())};
const mon=s=>{const d=D(s);return M[d.getUTCMonth()]+(d.getUTCMonth()===0?' '+d.getUTCFullYear():'')};
const days=(a,b)=>Math.round((D(b)-D(a))/864e5);
const HOL=SD.hol;
const isWork=d=>d.getUTCDay()!==5&&!HOL.includes(iso(d));
const isFri=s=>D(s).getUTCDay()===5;
const addD=(s,n)=>iso(new Date(D(s).getTime()+n*864e5));
const addWd=(s,n)=>{let d=D(s);const st=n>0?1:-1;let k=Math.abs(n);while(k>0){d=new Date(d.getTime()+st*864e5);if(isWork(d))k--}return iso(d)};
const unit=n=>{n=Math.abs(n);return n<=2?'يوم':n<=10?'أيام':'يوماً'};
const dys=n=>{n=Math.abs(n);return n===1?'يوم واحد':n===2?'يومان':n+' '+unit(n)};
const sd=n=>(n>0?'+':n<0?'−':'+')+Math.abs(n)+' '+unit(n);
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const TODAY=SD.project.today;
const nextWork=s=>{let d=D(s);while(!isWork(d))d=new Date(d.getTime()+864e5);return iso(d)};
const wdays=(a,b)=>{if(b<a)return 0;let n=0,d=D(a);const e=D(b);while(d<=e){if(isWork(d))n++;d=new Date(d.getTime()+864e5)}return n};
const RT={'مقاول':'orange','مالك':'violet','استشاري':'blue','طقس':'cyan','قوة قاهرة':'gray','تأخير عقد آخر':'amber','أمر تغيير':'green'};
const REASONS=Object.keys(RT);
const chip=(l,t,nodot)=>`<span class="sc-st t-${t}">${nodot?'':'<i></i>'}${l}</span>`;
const lz=l=>`<span class="sc-lz">${l}</span>`;
const rs=l=>`<span class="sc-rs t-${RT[l]||'gray'}">${l}</span>`;
const sw=(on,a,v,dis)=>`<button class="sc-sw${on?' on':''}" role="switch" aria-checked="${!!on}" data-a="${a}" data-v="${v||''}"${dis?' disabled':''}><i></i></button>`;
const seg=(opts,val,a)=>`<div class="sc-seg">${opts.map(([v,l])=>`<button class="${v===val?'on':''}" data-a="${a}" data-v="${v}">${l}</button>`).join('')}</div>`;
const UC={own:'tomato',oeng:'amber',cmgr:'violet',ceng:'blue',smgr:'green',seng:'cyan',mmgr:'orange',meng:'blue',kmgr:'orange',keng:'cyan'};
const U={};Object.keys(SD.users).forEach(k=>{const u=SD.users[k];U[k]={n:u[0],r:u[1],co:u[2],c:'var(--tone-'+UC[k]+'-solid)'}});
const av=(u,s)=>{s=s||36;return `<span class="av" style="width:${s}px;height:${s}px;font-size:${Math.round(s*.42)}px;background:${u.c}">${u.n.replace('م. ','').charAt(0)}</span>`};
function scale(a,b){const T=days(a,b);const months=[];let d=D(a);d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1));if(iso(d)<a)d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1));while(iso(d)<b){months.push(iso(d));d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1))}
 return {p:x=>Math.max(0,Math.min(100,days(a,x)/T*100)),w:(x,y)=>Math.max(.4,days(x,y)/T*100),months}}

const st={pg:'dash',role:'own',toast:null,modal:null,meDec:null,blDec:null,stDec:null,guide:false,menu:null,lang:'ar',mode:'light',sb:'dark',pal:'neutral'};
const after=[];
const screens={};
// page heading inside content (system header + tabs come from app.js chrome)
function hdr(o){return `<div class="sc-ph"><div class="sc-hd-t"><div class="sc-hd-r1"><h1>${o.title}</h1>${o.chips||''}</div>${o.sub?`<div class="sc-hd-sub">${o.sub}</div>`:''}</div><span class="sp"></span>${o.right?`<div class="sc-ph-r">${o.right}</div>`:''}</div>`}
function shell(ph,body){return SC.chrome(ph,body)}
function modal(){const m=st.modal;if(!m)return '';
 return `<div class="sc-scrim" data-a="mclose"></div><div class="sc-mod" role="dialog" dir="rtl" lang="ar"><div class="sc-mod-hd"><h3>${m.title}</h3><button class="sc-ib" data-a="mclose" aria-label="إغلاق"><i class="ti ti-x"></i></button></div><div class="sc-mod-bd">${m.body}</div><div class="sc-mod-ft">${m.noCancel?'':'<button class="sc-b ter" data-a="mclose">إلغاء</button>'}<button class="sc-b ${m.tone||'pri'}" data-a="mok">${m.ok||'تأكيد'}</button></div></div>`}
let tt;
function toast(msg){st.toast=msg;clearTimeout(tt);tt=setTimeout(()=>{st.toast=null;render()},3200)}
const cur=()=>screens[SC.PG[st.pg]];
function render(){const app=document.getElementById('app');const keep={};app.querySelectorAll('[data-keep]').forEach(e=>keep[e.dataset.keep]=[e.scrollLeft,e.scrollTop]);const y=scrollY;
 const S=cur();
 app.innerHTML=(SC.allowed(st.pg)?(S?S.view():''):SC.denied())+modal()+SC.guide()+(st.toast?`<div class="sc-toast" dir="rtl" lang="ar"><i class="ti ti-circle-check"></i>${st.toast}</div>`:'');
 const H=document.documentElement;H.lang=st.lang;H.dir=st.lang==='en'?'ltr':'rtl';H.classList.toggle('theme-dark',st.mode==='dark');[...H.classList].filter(c=>c.startsWith('pal-')).forEach(c=>H.classList.remove(c));if(st.pal&&st.pal!=='neutral')H.classList.add('pal-'+st.pal);document.body.style.background='var(--ui-canvas)';if(st.lang==='en'&&SC.I18N)SC.I18N.run(app);
 app.querySelectorAll('[data-keep]').forEach(e=>{const k=keep[e.dataset.keep];if(k){e.scrollLeft=k[0];e.scrollTop=k[1]}});
 scrollTo(0,y);SC.save&&SC.save();after.forEach(f=>{try{f()}catch(e){console.error(e)}});
}
function go(k,variant){if(!SC.PG[k]){const f=Object.keys(SC.PG).find(p=>SC.PG[p]===k);if(f)k=f}
 st.pg=k;st.modal=null;st.menu=null;if(k==='review'&&variant)screens.s4.open(variant);const S=cur();S&&S.enter&&S.enter();render();scrollTo(0,0)}
function as(role,pg,variant){st.role=role;st.menu=null;go(pg&&SC.allowed(pg,role)?pg:SC.home(role),variant);toast('تعرض الآن كـ '+U[role].n+' · '+U[role].r)}
const handoff=(role,pg,label,variant)=>`<button class="sc-b out" data-a="as" data-v="${role}|${pg||''}|${variant||''}">${av(U[role],22)}${label||'التبديل إلى '+U[role].n}<i class="ti ti-arrow-left"></i></button>`;
document.addEventListener('click',e=>{const el=e.target.closest('[data-a]');if(!el||el.disabled)return;const a=el.dataset.a;
 if(a==='go')return go(el.dataset.v);
 if(a==='as'){const [r,p,v]=el.dataset.v.split('|');return as(r,p,v)}
 if(a==='mclose'){st.modal=null;return render()}
 if(a==='mok'){const m=st.modal,f=m&&m.fn;st.modal=null;if(f&&f()===false)st.modal=m;return render()}
 if(SC.chromeAct&&SC.chromeAct(a,el)!==undefined)return render();
 const S=cur();if(S&&S.act&&S.act(a,el,e)!==false)render()});
document.addEventListener('input',e=>{const el=e.target.closest('[data-in]');if(!el)return;const S=cur();S&&S.inp&&S.inp(el.dataset.in,el)});
document.addEventListener('change',e=>{const el=e.target.closest('[data-ch]');if(!el)return;const S=cur();if(S&&S.ch&&S.ch(el.dataset.ch,el)!==false)render()});
window.SC={after,nextWork,wdays,M,D,iso,fmt,mon,days,addD,addWd,isFri,isWork,unit,dys,sd,esc,TODAY,RT,REASONS,chip,lz,rs,sw,seg,U,av,scale,st,screens,hdr,shell,render,go,as,handoff,toast};
})();
