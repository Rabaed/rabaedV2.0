// Responsive anatomy — device frames, shell renderer, primitives. Exposes window.RA.
(function(){
const DEV={L:{w:1376,h:1032,s:.4,n:'iPad Pro 13″',o:'Landscape',vp:'1376 × 1032 pt'},P:{w:1032,h:1376,s:.4,n:'iPad Pro 13″',o:'Portrait',vp:'1032 × 1376 pt'},M:{w:402,h:874,s:.66,n:'iPhone 18 Pro',o:'Portrait',vp:'402 × 874 pt'}};
const ic=n=>`<i class="ti ti-${n}"></i>`;
const pin=(n,pos)=>`<b class="pin" style="${pos}">${n}</b>`;
const pl=(t,tone,nd)=>`<span class="pl t-${tone}${nd?' nd':''}">${t}</span>`;
const AVC={MA:'#6b5ad8',SK:'#1aa3b8',RH:'#e9a23b',AN:'#27b86e',LT:'#3b6fd8',OF:'#f95738'};
const av=(i,s)=>`<span class="av" style="background:${AVC[i]||'#6a6e7a'}${s?`;width:${s}px;height:${s}px;line-height:${s}px;font-size:${Math.round(s*.4)}px`:''}">${i}</span>`;
const MARK=(window.__resources&&window.__resources.raMark)||'../../assets/brand/rabaed-mark.svg';
function chrome(dev,html){
 if(dev==='M')return `<div class="v-sbar"><span>9:41</span><span class="v-isl"></span><span>100%</span></div><div class="v-app">${html}</div><div class="v-saf"><span class="v-url">${ic('lock')}app.rabaed.com</span></div>`;
 return `<div class="v-sbar"><span>9:41&nbsp;&nbsp;Wed 7 Oct</span><span>100%</span></div><div class="v-saf">${ic('chevron-left')}${ic('chevron-right')}<span class="v-url">${ic('lock')}app.rabaed.com</span>${ic('plus')}</div><div class="v-app">${html}</div>`}
const LZ=[];
function frame(dev,html,o){o=o||{};const d=DEV[dev];LZ.push(`<div class="vp v ${dev}" style="width:${d.w}px;height:${d.h}px;transform:scale(${d.s});${o.style||''}">${chrome(dev,html)}</div>`);
 return `<div class="fr"><div class="fr-l">${o.label||d.n+' · '+d.o}<small>${o.sub||d.vp}</small></div><div class="dev ${dev}"><div class="scr" data-lz="${LZ.length-1}" style="width:${d.w*d.s}px;height:${d.h*d.s}px"></div></div></div>`}
function lazy(root,eager){let els=[...root.querySelectorAll('[data-lz]')];if(eager){els.forEach(el=>el.innerHTML=LZ[+el.dataset.lz]);return}const chk=()=>{const H=innerHeight;els=els.filter(el=>{const r=el.getBoundingClientRect();if(r.top<H+900&&r.bottom>-900){el.innerHTML=LZ[+el.dataset.lz];return false}return true})};addEventListener('scroll',chk,{passive:true});addEventListener('resize',chk);chk();setInterval(()=>{if(els.length)chk()},350)}
// ---------- shell ----------
const NAV=[['home','Home'],['buildings','Projects'],['clipboard-list','Payment Requests']];
const CO=[['building','Company Profile'],['shield','Roles'],['user-plus','Request To Join',5],['users','Users'],['settings','Subscription']];
function side(kind,o){o=o||{};const on=o.nav||'Projects';
 const it=([i,l,b])=>`<div class="v-it${l===on?' on':''}">${ic(i)}<span>${l}</span>${b&&kind!=='rail'?`<span class="bd">${b}</span>`:''}</div>`;
 return `<aside class="v-sb ${kind}">${o.sp?pin(1,kind==='rail'?'top:90px;right:-18px':'top:90px;right:-20px'):''}<div class="v-ws"><span class="v-mk"><img src="${MARK}" alt=""></span><div><b>Rabaed</b><small>Al Futtaim Construction</small></div></div><nav class="v-nav"><div class="v-lbl">Modules</div>${NAV.map(it).join('')}${kind==='rail'?'<div class="v-sep"></div>':'<div class="v-lbl">My Company</div>'}${CO.map(it).join('')}</nav><div class="v-uc">${av('MA',38)}<div><b>Mohamed</b><small>Contractor Engineer</small></div></div></aside>`}
const PRJ=`<span class="v-pav">D</span><div class="v-tt"><b>Dubai Marina Tower</b><small>Emaar Properties</small></div>`;
function hdr(dev,o){const L=dev==='L',sp=o.sp;
 const title=o.company?`<div class="v-tt"><b>${o.title}</b><small>${o.sub||''}</small></div>`:`<span class="v-ib">${ic('arrow-left')}</span>${PRJ}`;
 return `<header class="v-hd">${sp?pin(2,'left:30%;top:10px'):''}${title}<span class="v-sp"></span>${L?`<span class="v-srch">${ic('search')}<span style="flex:1">Search</span><kbd>⌘K</kbd></span>`:`<span class="v-ib">${ic('search')}</span>`}${o.company?'':`<span class="v-role">${ic('user')}${L?'Contractor Engineer':'Contractor'}</span>`}${L?`<span class="v-seg"><span class="on">Light</span><span>Dark</span></span>`:''}<span class="v-ib dot">${ic('bell')}</span><span class="v-me">${av('MA',36)}${L?'<b>Mohamed</b>'+ic('chevron-down'):''}</span></header>`}
function topM(o){return `<header class="v-hd">${o.sp?pin(2,'left:40%;top:14px'):''}<span class="v-ib">${ic('menu-2')}</span>${o.company?`<div class="v-tt" style="padding-inline-start:4px"><b>${o.title}</b></div>`:`<span class="v-pav">D</span><div class="v-tt"><b>Dubai Marina Tower</b><small>Contractor Engineer ${ic('chevron-down')}</small></div>`}<span class="v-sp"></span><span class="v-ib">${ic('search')}</span><span class="v-ib dot">${ic('bell')}</span></header>`}
const TABS=['Overview','Schedule','Multiple View','Drawings & Design','Submittals','Packages','Reports','Snag List','Files','Settings'];
function tabs(dev,act,o){let list=TABS.map((t,i)=>({t,i}));const ai=TABS.indexOf(act);
 if(dev==='M'&&ai>1)list=list.slice(ai-1);if(dev==='P'&&ai>6)list=list.slice(ai-5);
 return `<nav class="v-tabs${dev==='L'?'':' fade'}">${o.sp?pin(3,dev==='M'?'right:12px;top:9px':'right:24px;top:6px'):''}${list.map(({t})=>`<span class="v-tab${t===act?' on':''}">${t==='Schedule'?ic('calendar-time'):''}${t==='Multiple View'&&o.mv?t+' · '+o.mv:t}${t==='Multiple View'?ic('chevron-down'):''}</span>`).join('')}</nav>`}
function sh(dev,o){o=o||{};
 const tb=o.company||o.noTabs?'':tabs(dev,o.tab||'Overview',o);
 const body=`<main class="v-ct${o.flush?' flush':''}">${o.body||''}</main>${o.bottom?`<div class="bar-b">${o.bottom}</div>`:''}`;
 if(dev==='M')return `<div class="v-mn">${topM(o)}${tb}${body}${o.over||''}</div>`;
 return `${side(dev==='L'?'':'rail',o)}<div class="v-mn">${hdr(dev,o)}${tb}${body}${o.over||''}</div>${o.overApp||''}`}
function ph(dev,title,sub,acts,o){o=o||{};return `<div class="v-ph">${o.pin||''}<div style="min-width:0;flex:1"><h3 class="el">${title}</h3>${sub?`<small>${sub}</small>`:''}</div>${acts||''}</div>`}
const btn=(t,i,cls)=>`<span class="vb ${cls||''}">${i?ic(i):''}${t||''}</span>`;
const ibtn=(i,cnt,cls)=>`<span class="vb ic ${cls||''}">${ic(i)}${cnt?`<span class="cnt">${cnt}</span>`:''}</span>`;
const chip=(t,on,i,n)=>`<span class="chip${on?' on':''}">${i?ic(i):''}${t}${n!=null?` <i class="n">${n}</i>`:''}${!on&&!n&&n!==0&&!i?ic('chevron-down'):''}</span>`;
const seg=(items,on,cls)=>`<span class="v-seg ${cls||''}">${items.map((x,i)=>{const [t,ico]=Array.isArray(x)?x:[x];return `<span class="${i===on?'on':''}">${ico?ic(ico):''}${t||''}</span>`}).join('')}</span>`;
const srch=(ph,flex)=>`<span class="v-in" style="${flex?'flex:1':'width:280px'}">${ic('search')}${ph||'Search'}</span>`;
const sheet=(html,h)=>`<div class="scrim"></div><div class="sheet" style="${h?'height:'+h:''}">${html}</div>`;
// ---------- page ----------
const SECS=[];
function noteCol(dev,items){const d=DEV[dev];const h={L:'device-tablet',P:'device-tablet',M:'device-mobile'}[dev];
 return `<div class="note"><h4>${ic(h)}${d.n} · ${d.o}</h4><ol>${items.map(s=>{const m=s.match(/^(\d+)\s(.*)$/);return `<li>${m?`<b>${m[1]}</b>${m[2]}`:`<b class="d">·</b>${s}`}</li>`}).join('')}</ol></div>`}
function render(el){let g='',nav='';const q=new URLSearchParams(location.search).get('only');
 el.innerHTML=SECS.filter(s=>!q||q.split(',').includes(s.id)).map(s=>{const head=s.group!==g?`<div class="ra-grp" id="g-${s.id}">${s.group}</div>`:'';if(s.group!==g)nav+=`<a href="#g-${s.id}">${s.group}</a>`;g=s.group;
  const fr=s.frames?`<div class="row">${s.frames.map(f=>frame(f.dev,f.html,f)).join('')}</div>`:'';
  const nt=s.notes?`<div class="notes">${['L','P','M'].filter(k=>s.notes[k]).map(k=>noteCol(k,s.notes[k])).join('')}</div>`:'';
  return `${head}<section class="sec" id="${s.id}"><h2>${s.title}</h2>${s.lead?`<p class="lead">${s.lead}</p>`:''}${s.pre||''}${fr}${s.post||''}${nt}</section>`}).join('');
 document.getElementById('ra-nav').innerHTML=nav;lazy(el,q)}
window.RA={DEV,ic,pin,pl,av,frame,side,sh,ph,btn,ibtn,chip,seg,srch,sheet,tabs,SECS,render,add:s=>SECS.push(s)};
})();
