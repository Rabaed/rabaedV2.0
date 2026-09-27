// Multiple View → Floor View. Exposes window.FV {V, view, bind, after}.
(function(){
const S=RS.S,{ST,ORDER,TR,CO,TY,STAGE,ROLES,SP,IS,FL,BLD,ZN}=FD;
const L=(e,a)=>S.lang==='ar'?a:e;const esc=RS.esc;
const V={bld:'t1',role:'admin',tr:new Set(),ty:new Set(),co:new Set(),stage:'',wk:32,mode:'status',layout:'stack',sel:null,z:1,legend:false,tab:'open',open:null,menu:null,drill:null,ff:false,tablet:false,toast:null};
const wkDate=w=>{const d=new Date(2025,11,29+(w-1)*7);return new Intl.DateTimeFormat(S.lang==='ar'?'ar':'en-GB',{weekday:'short',day:'numeric',month:'short',numberingSystem:'latn'}).format(d)};
const bld=()=>BLD.find(b=>b.id===V.bld);
function vis(it){const r=ROLES[V.role];if(r.co&&it.co!==r.co)return false;if(V.tr.size&&!V.tr.has(it.tr))return false;if(V.ty.size&&!V.ty.has(it.type))return false;if(V.co.size&&!V.co.has(it.co))return false;if(V.stage&&it.stage!==V.stage)return false;return it.wk<=V.wk}
function spSt(items){if(items.some(i=>(i.type==='snag'&&i.res==='open')||(i.type==='insp'&&i.res==='failed')))return 'iss';if(items.some(i=>i.res==='open'))return 'prog';if(items.some(i=>i.type==='insp'&&i.res==='passed'))return 'done';return 'pend'}
function model(){const empty=bld().empty;return FL.map(f=>{const spaces=f.spaces.map(s=>{const items=empty?[]:s.items.filter(vis);return {k:s.k,items,st:spSt(items)}});const c={done:0,prog:0,iss:0,pend:0};spaces.forEach(s=>c[s.st]++);return {f,spaces,c}})}
const fname=f=>L(f.en,f.ar);
const worst=c=>c.iss?'iss':c.prog?'prog':c.done?'done':'pend';
const chipS=s=>`<span class="zs" style="background:${ST[s].t};color:${ST[s].f}"><i class="ti ${ST[s].ic}"></i>${L(ST[s].en,ST[s].ar)}</span>`;
const tile=(s,mute)=>`<span class="tile ${s.st}${mute?' mute':''}" style="${s.st==='pend'?'':`background:${ST[s.st].c}`}"><i class="ti ${ST[s.st].ic}"></i><span class="tt">${L(SP[s.k][0],SP[s.k][1])} · ${L(ST[s.st].en,ST[s.st].ar)}</span></span>`;
const cnts=(c,lb)=>`<span class="cnts">${ORDER.map(k=>`<span class="cnt${c[k]?'':' z'}" style="background:${ST[k].t};color:${ST[k].f}" title="${L(ST[k].en,ST[k].ar)}"><i class="ti ${ST[k].ic}"></i>${c[k]}${lb?`<span class="lb" style="font-weight:600;font-family:var(--font-ui)"> ${L(ST[k].en,ST[k].ar)}</span>`:''}</span>`).join('')}</span>`;
/* ---- toolbar ---- */
function toolbar(){const b=bld(),r=ROLES[V.role];const segs=[['floor','ti-stairs',L('Floor','الطوابق')],['map','ti-map',L('Map','الخريطة')],['plan','ti-vector',L('Plan','المخطط')]];
 const nf=V.tr.size+V.ty.size+V.co.size+(V.stage?1:0);
 return `<div class="fv-bar"><span class="segv">${segs.map(s=>`<button class="${(V.drill?'plan':'floor')===s[0]?'on':''}" data-view="${s[0]}"><i class="ti ${s[1]}"></i>${s[2]}</button>`).join('')}</span>
 <nav class="bc"><span>${L('Dubai Marina Tower – Phase 2','برج دبي مارينا – المرحلة ٢')}</span><i class="ti ti-chevron-right"></i><span>${L(ZN[b.z][0],ZN[b.z][1])}</span><i class="ti ti-chevron-right"></i><span class="rel" style="padding:0"><button class="bsw" data-menu="bld"><i class="ti ti-building-skyscraper"></i>${L(b.en,b.ar)}<i class="ti ti-chevron-down"></i></button>${V.menu==='bld'?`<div class="pop" data-stop style="min-width:240px">${Object.keys(ZN).map(z=>`<h6>${L(ZN[z][0],ZN[z][1])}</h6>${BLD.filter(x=>x.z===z).map(x=>`<button class="mi${x.id===V.bld?' on':''}" ${x.off?'disabled style="opacity:.5;cursor:default"':`data-bld="${x.id}"`}><i class="ti ti-building-skyscraper"></i>${L(x.en,x.ar)}${x.off?`<small>${L('Not set up','غير مُعدّ')}</small>`:x.empty?`<small>${L('No work items','لا توجد عناصر')}</small>`:''}${x.id===V.bld?'<i class="ti ti-check ck"></i>':''}</button>`).join('')}`).join('')}</div>`:''}</span><i class="ti ti-chevron-right"></i>${V.drill?`<button class="cb ter sm" data-act="undrill">${L('All Floors','جميع الطوابق')}</button><i class="ti ti-chevron-right"></i><span class="cur">${fname(FL.find(f=>f.id===V.drill))}</span>`:`<span class="cur">${L('All Floors','جميع الطوابق')}</span>`}</nav>
 <span class="sp"></span>
 ${V.drill?'':`<button class="cb tbl-only${nf?' on':''}" data-act="ff"><i class="ti ti-filter"></i>${L('Filters','التصفية')}${nf?`<span class="cnt" style="height:18px;min-width:18px;padding:0 5px;background:var(--btn-pri);color:#fff;font-size:10.5px">${nf}</span>`:''}</button>
 <span class="segv" title="${L('View data','عرض البيانات')}"><button class="${V.mode==='status'?'on':''}" data-mode2="status">${L('Status','الحالة')}</button><button class="${V.mode==='issues'?'on':''}" data-mode2="issues"><i class="ti ti-alert-triangle"></i>${L('Issues only','المشكلات فقط')}</button></span>
 <span class="segv"><button class="${V.layout==='stack'?'on':''}" data-layout="stack" title="${L('Stack','مكدّس')}"><i class="ti ti-building-skyscraper"></i>${L('Stack','مكدّس')}</button><button class="${V.layout==='list'?'on':''}" data-layout="list" title="${L('List','قائمة')}"><i class="ti ti-layout-grid"></i>${L('List','قائمة')}</button></span>`}
 <span class="rel"><button class="vis" data-menu="role"><i class="ti ti-eye"></i>${L(r.en,r.ar)}<i class="ti ti-chevron-down"></i></button>${V.menu==='role'?`<div class="pop end" data-stop style="min-width:280px"><h6>${L('Demo · view as','عرض توضيحي · العرض بصفة')}</h6>${Object.entries(ROLES).map(([k,x])=>`<button class="mi${V.role===k?' on':''}" data-role="${k}" style="white-space:normal"><i class="ti ${k==='admin'?'ti-shield':'ti-user-circle'}"></i><span><b style="display:block;font-weight:600">${L(x.en,x.ar)}</b><span style="font-size:11.5px;color:var(--ui-muted)">${L(x.sub[0],x.sub[1])}</span></span></button>`).join('')}</div>`:''}</span>
 <span class="rel"><button class="cb ic" data-menu="demo"><i class="ti ti-dots"></i></button>${V.menu==='demo'?`<div class="pop end" data-stop><h6>${L('Demo states','حالات العرض')}</h6><button class="mi" data-act="elec"><i class="ti ti-filter"></i>${L('Filter: Electrical only','تصفية: الكهرباء فقط')}</button><button class="mi" data-bld="t2"><i class="ti ti-building-skyscraper"></i>${L('Empty building (Tower 2)','مبنى فارغ (البرج ٢)')}</button><button class="mi${V.tablet?' on':''}" data-act="tablet"><i class="ti ti-device-tablet"></i>${L('Tablet preview (1024px)','معاينة الجهاز اللوحي')}${V.tablet?'<i class="ti ti-check ck"></i>':''}</button></div>`:''}</span></div>`}
/* ---- filters ---- */
function filters(){const r=ROLES[V.role];const cos=Object.keys(CO).filter(k=>!r.co||k===r.co);
 const ck=(set,k,label,pre)=>`<button class="ck2${V[set].has(k)?' on':''}" data-ck="${set}:${k}"><span class="bx">${V[set].has(k)?'<i class="ti ti-check"></i>':''}</span>${pre||''}${label}</button>`;
 const nf=V.tr.size+V.ty.size+V.co.size+(V.stage?1:0);
 return `<aside class="fv-card fv-filters${V.ff?'':' shut'}"><div class="ff-hd"><i class="ti ti-filter"></i>${L('Filters','التصفية')}${nf?`<button class="cb ter sm" data-act="clearf">${L('Reset','إعادة ضبط')}</button>`:''}<button class="cb ter sm ic tbl-only" data-act="ff" style="${nf?'':'margin-inline-start:auto'}"><i class="ti ti-x"></i></button></div><div class="ff-bd">
 <div class="fg"><h6>${L('Week','الأسبوع')}</h6><div class="wk"><button class="cb ter ic" data-wk="-1"${V.wk<=26?' disabled':''}><i class="ti ti-chevron-left"></i></button><span>${L('Week','الأسبوع')} ${V.wk}<small>${wkDate(V.wk)}</small></span><button class="cb ter ic" data-wk="1"${V.wk>=39?' disabled':''}><i class="ti ti-chevron-right"></i></button></div></div>
 <div class="fg"><h6>${L('Trade','التخصص')}</h6>${Object.keys(TR).map(k=>ck('tr',k,L(TR[k][0],TR[k][1]),`<span class="d" style="background:var(--tone-${TR[k][2]}-solid)"></span>`)).join('')}</div>
 <div class="fg"><h6>${L('Work Item Type','نوع العنصر')}</h6>${Object.keys(TY).map(k=>ck('ty',k,L(TY[k][0],TY[k][1]))).join('')}</div>
 <div class="fg"><h6>${L('Company','الشركة')}${r.co?`<small>${L('Only your company','شركتك فقط')}</small>`:''}</h6>${cos.map(k=>ck('co',k,L(CO[k][0],CO[k][1]),`<span class="av" style="background:${CO[k][2]}">${RS.ini(CO[k][0])}</span>`)).join('')}</div>
 <div class="fg"><h6>${L('Stage','المرحلة')}</h6><div class="stg">${[['',L('All stages','جميع المراحل')],...Object.keys(STAGE).map(k=>[k,L(STAGE[k][0],STAGE[k][1])])].map(s=>`<button class="ck2${V.stage===s[0]?' on':''}" data-stage="${s[0]}"><span class="bx" style="border-radius:50%;${V.stage===s[0]?'background:var(--fld-bg);box-shadow:inset 0 0 0 5px var(--ctl-on)':''}"></span>${s[1]}</button>`).join('')}</div></div>
 </div></aside>${V.ff?'<div class="scrim2" data-act="ff"></div>':''}`}
/* ---- building ---- */
function stack(M){const hotMode=V.mode==='issues';
 const row=m=>{const f=m.f,hot=m.c.iss>0;const cls=[f.id==='rf'?'roof':'',f.id==='gf'?'gf':'',f.below?'below':'',V.sel===f.id?'sel':'',hotMode?(hot?'hot':'dim'):''].join(' ');
  return `<div class="fl ${cls}" data-fl="${f.id}"><span class="nm"><b>${fname(f)}</b><small>${f.lv}</small></span><span class="tiles2">${m.spaces.map(s=>tile(s,hotMode&&s.st!=='iss')).join('')}</span>${cnts(m.c,0)}<button class="go" data-drill="${f.id}" title="${L('Open Plan View','فتح عرض المخطط')}"><i class="ti ti-chevron-right"></i></button></div>${f.id==='gf'?`<div class="grd"><span>${L('Ground level','منسوب الأرض')}</span></div>`:''}`};
 return `<div class="bld" style="--z:${V.z}"><div class="bld-sky"></div>${M.map(row).join('')}<div class="fl-last"></div></div>`}
function list(M){const hotMode=V.mode==='issues';return `<div class="fl-grid" style="zoom:${V.z}">${M.map(m=>{const f=m.f,hot=m.c.iss>0;return `<div class="fcard${V.sel===f.id?' sel':''}${hotMode?(hot?' hot':' dim'):''}" data-fl="${f.id}"><div class="h"><span class="lv">${f.lv}</span><div><b>${fname(f)}</b><small>${m.spaces.length} ${L('spaces','مساحات')}</small></div>${chipS(worst(m.c))}</div><span class="tiles2" style="--z:.9">${m.spaces.map(s=>tile(s,hotMode&&s.st!=='iss')).join('')}</span>${cnts(m.c,0)}<div class="ft"><span>${L('Tap for trades','انقر لعرض التخصصات')}</span><span class="lnk" data-drill="${f.id}">${L('Plan View','عرض المخطط')}<i class="ti ti-chevron-right"></i></span></div></div>`}).join('')}</div>`}
function legend(){return `<div class="legend" data-stop><h6>${L('Location status','حالة الموقع')}</h6>${['done','prog','iss','pend'].map(k=>`<div class="lgr"><span class="tile ${k}" style="${k==='pend'?'':`background:${ST[k].c}`}"><i class="ti ${ST[k].ic}"></i></span><div><b>${L(ST[k].en,ST[k].ar)}</b><span>${L(ST[k].den,ST[k].dar)}</span></div></div>`).join('')}<div class="note"><i class="ti ti-eye"></i>${L('Counts include only work your company can see.','تشمل الأرقام فقط الأعمال المرئية لشركتك.')}</div></div>`}
function canvas(M){const empty=bld().empty;
 return `<section class="fv-card fv-canvas"><div class="fv-scroll" id="fvs">${V.layout==='stack'?stack(M):list(M)}</div>
 ${empty?`<div class="fv-empty"><div class="emp"><span class="ic"><i class="ti ti-building-skyscraper"></i></span><h2>${L('No Work Items on Tower 2 yet','لا توجد عناصر عمل في البرج ٢ بعد')}</h2><p>${L('Floors light up here as soon as inspections, snags or submittals are tagged with a Location in this building.','تظهر حالة الطوابق هنا فور وسم الفحوصات أو الملاحظات أو التقديمات بموقع في هذا المبنى.')}</p><div class="row"><a class="cb pri" href="submittals-list.html"><i class="ti ti-plus"></i>${L('Add Submittal','إضافة تقديم')}</a><button class="cb" data-bld="t1">${L('Back to Tower 1','العودة إلى البرج ١')}</button></div></div></div>`:''}
 ${V.legend?legend():''}
 <div class="fv-ctl"><div class="grp"><button class="${V.legend?'on':''}" data-act="legend"><i class="ti ti-info-circle"></i>${L('Legend','المفتاح')}</button></div><div class="grp"><button data-zoom="-1" title="${L('Zoom out','تصغير')}"><i class="ti ti-zoom-out"></i></button><button class="zl" data-zoom="0">${Math.round(V.z*100)}%</button><button data-zoom="1" title="${L('Zoom in','تكبير')}"><i class="ti ti-zoom-in"></i></button></div></div></section>`}
/* ---- spotlights ---- */
const PR={high:['High','عالية','red'],med:['Medium','متوسطة','orange'],low:['Low','منخفضة','gray']};
function issues(){const out={open:[],res:[]};if(bld().empty)return out;FL.forEach(f=>f.spaces.forEach(s=>s.items.forEach(it=>{if(!it.is||!vis(it))return;const x={it,f,s,d:IS[it.is],id:f.id+s.k+it.is};if(it.res==='closed')out.res.push(x);else out.open.push(x)})));
 const po={high:0,med:1,low:2};const srt=a=>a.sort((a,b)=>po[a.d.p]-po[b.d.p]||b.it.age-a.it.age);srt(out.open);srt(out.res);return out}
function spot(){const I=issues();let ls=I[V.tab];if(V.sel)ls=ls.filter(x=>x.f.id===V.sel);const b=bld();
 return `<aside class="fv-card fv-spot"><div class="ff-hd"><i class="ti ti-flag"></i>${L('Spotlights','أبرز المشكلات')}<span style="margin-inline-start:auto;font:500 12px var(--font-ui);color:var(--ui-muted)">${L(b.en,b.ar)}</span></div>
 <div class="sl-tabs"><button class="${V.tab==='open'?'on':''}" data-tab2="open">${L('Open','مفتوحة')}<span class="n">${I.open.length}</span></button><button class="${V.tab==='res'?'on':''}" data-tab2="res">${L('Resolved','محلولة')}<span class="n">${I.res.length}</span></button></div>
 ${V.sel?`<span class="fchip"><i class="ti ti-stairs"></i>${fname(FL.find(f=>f.id===V.sel))}<button data-act="desel"><i class="ti ti-x"></i></button></span>`:''}
 <div class="sl-ls">${ls.length?ls.map(x=>{const t=TR[x.it.tr],p=PR[x.d.p],o=V.open===x.id,fail=x.it.type==='insp';return `<div class="sl${o?' open':''}" data-sl="${x.id}"><div class="h"><span class="pr" style="background:var(--tone-${p[2]}-solid)"></span><b>${esc(L(x.d.t[0],x.d.t[1]))}</b><i class="ti ti-chevron-down"></i></div><p>${esc(L(x.d.d[0],x.d.d[1]))}</p>
  <div class="chips2"><span class="lc"><i class="ti ti-map-pin"></i>${L('Zone A','المنطقة أ')}</span><span class="lc"><i class="ti ti-building-skyscraper"></i>${L(b.en,b.ar)}</span><span class="lc"><i class="ti ti-stairs"></i>${fname(x.f)}</span><span class="lc">${L(SP[x.s.k][0],SP[x.s.k][1])}</span></div>
  <div class="mt"><span class="chip" style="height:20px;font-size:11px;background:var(--tone-${t[2]}-tint);color:var(--tone-${t[2]}-fg)">${L(t[0],t[1])}</span><span class="co"><span class="av" style="background:${CO[x.it.co][2]}">${RS.ini(CO[x.it.co][0])}</span>${L(CO[x.it.co][0],CO[x.it.co][1])}</span><span class="prl pl" style="background:var(--tone-${p[2]}-tint);color:var(--tone-${p[2]}-fg)">${L(p[0],p[1])}</span></div>
  <div class="more"><div class="kv"><span>${L('Type','النوع')}</span><b>${fail?L('Failed inspection','فحص راسب'):L('Snag','ملاحظة')}</b><span>${L('Assigned to','مسند إلى')}</span><b>${L(CO[x.it.co][0],CO[x.it.co][1])}</b><span>${x.it.res==='closed'?L('Resolved','حُلّت'):L('Open for','مفتوحة منذ')}</span><b>${x.it.res==='closed'?L('Week ','الأسبوع ')+x.it.wk:x.it.age+L(' days',' يومًا')}</b></div><div class="acts"><button class="cb sm" data-fl="${x.f.id}" data-focus="1"><i class="ti ti-stairs"></i>${L('Show floor','عرض الطابق')}</button><button class="cb sm pri" data-drill="${x.f.id}"><i class="ti ti-vector"></i>${L('Plan View','عرض المخطط')}</button></div></div></div>`}).join(''):`<div class="none">${V.tab==='open'?L('No open issues you can see on this building.','لا توجد مشكلات مفتوحة مرئية لك في هذا المبنى.'):L('Nothing resolved yet.','لا شيء محلول بعد.')}</div>`}</div>
 <div class="sl-ft"><span class="rel" style="flex:1;display:flex"><button class="cb" style="flex:1" data-menu="exp"><i class="ti ti-file-download"></i>${L('Export','تصدير')}<i class="ti ti-chevron-down"></i></button>${V.menu==='exp'?`<div class="pop" data-stop style="top:auto;bottom:calc(100% + 6px)"><button class="mi" data-exp="pdf"><i class="ti ti-file-text"></i>${L('Download PDF','تنزيل PDF')}</button><button class="mi" data-exp="mail"><i class="ti ti-send"></i>${L('Email to me','إرسال إلى بريدي')}</button></div>`:''}</span></div></aside>`}
/* ---- popover ---- */
function pop(m,pin){const byT={};m.spaces.forEach(s=>s.items.forEach(it=>{const r=byT[it.tr]=byT[it.tr]||{done:0,prog:0,iss:0};if(it.res==='closed')return;if((it.type==='snag'&&it.res==='open')||it.res==='failed')r.iss++;else if(it.res==='open')r.prog++;else if(it.res==='passed')r.done++}));
 const rows=Object.entries(byT);
 return `<div class="h"><b>${fname(m.f)}</b>${chipS(worst(m.c))}<small>${m.f.lv}</small></div>${rows.length?`<table><thead><tr><th>${L('Trade','التخصص')}</th>${['done','prog','iss'].map(k=>`<th style="color:${ST[k].f}"><i class="ti ${ST[k].ic}"></i></th>`).join('')}</tr></thead><tbody>${rows.map(([k,r])=>`<tr><td><span class="d" style="background:var(--tone-${TR[k][2]}-solid)"></span>${L(TR[k][0],TR[k][1])}</td>${['done','prog','iss'].map(s=>`<td class="${r[s]?'':'z'}">${r[s]}</td>`).join('')}</tr>`).join('')}</tbody></table>`:`<div class="none" style="padding:12px">${L('No work items you can see on this floor.','لا توجد عناصر عمل مرئية لك في هذا الطابق.')}</div>`}${pin?`<div class="ft"><button class="cb sm" data-act="desel">${L('Close','إغلاق')}</button><button class="cb sm pri" data-drill="${m.f.id}"><i class="ti ti-vector"></i>${L('Open Plan View','فتح عرض المخطط')}</button></div>`:''}`}
function drill(){const f=FL.find(x=>x.id===V.drill);return `<div class="drill"><div class="emp"><span class="ic"><i class="ti ti-vector"></i></span><h2>${L('Plan View','عرض المخطط')} · ${fname(f)}</h2><p>${L(`Clicking a floor drills into its plan drawing: spaces and components of ${f.en} with Work Items pinned where they are. Plan View is designed next.`,`النقر على الطابق ينقلك إلى مخططه: مساحات ومكونات ${f.ar} مع عناصر العمل مثبتة في أماكنها. عرض المخطط هو التالي في التصميم.`)}</p><div class="row"><button class="cb pri" data-act="undrill"><i class="ti ti-arrow-left"></i>${L('Back to Floor View','العودة إلى عرض الطوابق')}</button></div></div></div>`}
function view(){const M=model();const t=V.toast?`<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>`:'';
 if(V.drill)return toolbar()+drill()+t;
 const sm=V.sel&&M.find(m=>m.f.id===V.sel);
 return `${toolbar()}<div class="fv-body">${filters()}${canvas(M)}${spot()}</div>${sm?`<div class="fpop pin" id="fpin" data-stop>${pop(sm,1)}</div>`:''}<div class="fpop" id="fhov" style="display:none"></div>${t}`}
function place(el,row){if(!el||!row)return;const r=row.getBoundingClientRect(),w=300,rtl=document.documentElement.dir==='rtl';const h=el.offsetHeight;let top=Math.min(Math.max(8,r.top),innerHeight-h-8);
 const tiles=row.querySelector('.tiles2');const tr=(tiles||row).getBoundingClientRect();let x=rtl?tr.left-w-12:tr.right+12;if(!rtl&&x+w>innerWidth-8)x=Math.max(8,tr.left);if(rtl&&x<8)x=tr.right-w;
 if(V.layout==='list'){x=rtl?r.left-w-10:r.right+10;if(x+w>innerWidth-8||x<8)x=Math.min(innerWidth-w-8,Math.max(8,r.left));top=Math.min(r.bottom+6,innerHeight-h-8)}
 el.style.top=top+'px';el.style.left=x+'px'}
function after(){if(V.sel)place(document.getElementById('fpin'),document.querySelector(`[data-fl="${V.sel}"]`))}
function bind(root,R){let tt;const flash=m=>{V.toast=m;R.inner();clearTimeout(tt);tt=setTimeout(()=>{V.toast=null;R.inner()},2200)};
 root.addEventListener('click',e=>{const b=e.target.closest('[data-menu],[data-bld],[data-role],[data-act],[data-view],[data-mode2],[data-layout],[data-ck],[data-stage],[data-wk],[data-zoom],[data-tab2],[data-drill],[data-sl],[data-fl],[data-exp]');
  if(!b){if(V.menu||V.legend){V.menu=null;V.legend=false;R.inner()}return}
  if(b.closest('.hd,.tabs,.sb'))return;
  const d=b.dataset;
  if(d.menu){V.menu=V.menu===d.menu?null:d.menu;return R.inner()}
  if(d.drill){e.stopPropagation();location.href='plan-view.html?fl='+(['rf','gf','01','02','03'].includes(d.drill)?d.drill:'02');return}
  if(d.bld){V.bld=d.bld;V.menu=null;V.sel=null;return R.inner()}
  if(d.role){V.role=d.role;V.menu=null;V.co=new Set();V.sel=null;return R.inner()}
  if(d.view){if(d.view==='map'){location.href='map-view.html';return}if(d.view==='plan'){location.href='plan-view.html'+(V.sel&&['rf','gf','01','02','03'].includes(V.sel)?'?fl='+V.sel:'');return}V.drill=null;S.mv='floor';return R.full()}
  if(d.mode2){V.mode=d.mode2;return R.inner()}
  if(d.layout){V.layout=d.layout;return R.inner()}
  if(d.ck){const [s,k]=d.ck.split(':');V[s].has(k)?V[s].delete(k):V[s].add(k);return R.inner()}
  if(d.stage!==undefined){V.stage=d.stage;return R.inner()}
  if(d.wk){V.wk=Math.max(26,Math.min(39,V.wk+ +d.wk));return R.inner()}
  if(d.zoom!==undefined){const z=+d.zoom;V.z=z===0?1:Math.max(.75,Math.min(1.5,Math.round((V.z+z*.125)*1000)/1000));return R.inner()}
  if(d.tab2){V.tab=d.tab2;V.open=null;return R.inner()}
  if(d.exp){V.menu=null;return flash(d.exp==='pdf'?L('Spotlights exported to PDF','تم تصدير أبرز المشكلات إلى PDF'):L('Spotlights emailed to mohamed@alfuttaim.ae','تم إرسال أبرز المشكلات إلى بريدك'))}
  if(d.fl&&!b.closest('.sl')&&!b.classList.contains('sl')){V.sel=V.sel===d.fl?null:d.fl;V.open=null;return R.inner()}
  if(d.fl&&d.focus){V.sel=d.fl;R.inner();const row=document.querySelector(`[data-fl="${d.fl}"]`);const sc=document.getElementById('fvs');if(row&&sc)sc.scrollTop=row.offsetTop-80;after();return}
  if(d.sl){V.open=V.open===d.sl?null:d.sl;return R.inner()}
  const a=d.act;
  if(a==='undrill'){V.drill=null;S.mv='floor';return R.full()}
  if(a==='legend'){V.legend=!V.legend;return R.inner()}
  if(a==='desel'){V.sel=null;return R.inner()}
  if(a==='clearf'){V.tr=new Set();V.ty=new Set();V.co=new Set();V.stage='';return R.inner()}
  if(a==='ff'){V.ff=!V.ff;return R.inner()}
  if(a==='elec'){V.menu=null;V.tr=new Set(['EL']);return R.inner()}
  if(a==='tablet'){V.tablet=!V.tablet;V.menu=null;return R.full()}
 });
 root.addEventListener('mouseover',e=>{const row=e.target.closest('[data-fl]');const hv=document.getElementById('fhov');if(!hv)return;
  if(!row||row.closest('.sl')||row.dataset.fl===V.sel||e.target.closest('.fpop')){hv.style.display='none';return}
  const m=model().find(x=>x.f.id===row.dataset.fl);hv.innerHTML=pop(m,0);hv.style.display='block';place(hv,row)});
 root.addEventListener('mouseleave',()=>{const hv=document.getElementById('fhov');hv&&(hv.style.display='none')},true);
 root.addEventListener('scroll',()=>{const hv=document.getElementById('fhov');hv&&(hv.style.display='none');after()},true);
 addEventListener('resize',after);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){V.sel=null;V.menu=null;V.legend=false;V.ff=false;R.inner()}});
}
window.FV={V,view,bind,after};
})();
