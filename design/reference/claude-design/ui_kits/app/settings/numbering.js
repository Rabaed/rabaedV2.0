// Project Settings → Document Numbering. Exposes window.DN {view, bind}.
(function(){
const S=RS.S;const L=(e,a)=>S.lang==='ar'?a:e;const esc=RS.esc;
const MAX=6;
const SEG={
 project:{en:'Project code',ar:'رمز المشروع',ex:()=> 'TWR',tone:'project',scope:0},
 type:{en:'Work item type',ar:'نوع العنصر',ex:c=>c.type,tone:'type',scope:1},
 trade:{en:'Trade',ar:'التخصص',ex:c=>c.trade,tone:'trade',scope:1},
 company:{en:'Company',ar:'الشركة',ex:c=>c.company,tone:'company',scope:1},
 loc:{en:'Location',ar:'الموقع',ex:(c,s)=>({zone:'ZA',bldg:'T1',floor:'F01'})[s.level||'bldg'],tone:'loc',scope:1},
 text:{en:'Fixed text',ar:'نص ثابت',ex:(c,s)=>(s.v||'TXT').toUpperCase(),tone:'text',scope:0}
};
const LEVEL={zone:['Zone','المنطقة'],bldg:['Building','المبنى'],floor:['Floor','الطابق']};
const TYPES=[['MAR','Material Approval Request','طلب اعتماد مواد'],['SAR','Shop Drawing','مخطط تنفيذي'],['DAR','Document','مستند'],['IR','Inspection Request','طلب فحص'],['SNG','Snag','ملاحظة'],['DSR','Daily Site Report','تقرير الموقع اليومي']];
// existing register (counts) to compute "next"
const REG=[{company:'TMC',trade:'EL',type:'MAR',n:41},{company:'TMC',trade:'CV',type:'MAR',n:18},{company:'GLF',trade:'EL',type:'MAR',n:7},{company:'TMC',trade:'EL',type:'SAR',n:12},{company:'GLF',trade:'CV',type:'MAR',n:5},{company:'TMC',trade:'ME',type:'MAR',n:9}];
const SAMPLES=[{company:'TMC',trade:'EL',type:'MAR',en:'TMC · Electrical',ar:'TMC · كهربائية'},{company:'TMC',trade:'CV',type:'MAR',en:'TMC · Civil',ar:'TMC · مدنية'},{company:'GLF',trade:'EL',type:'MAR',en:'Gulf Builders · Electrical',ar:'الخليج · كهربائية'}];
const mk=()=>({segs:[{k:'project'},{k:'company'},{k:'trade'},{k:'type'}],sep:'-',digits:3,scope:{company:1,trade:1,type:1}});
const clone=o=>JSON.parse(JSON.stringify(o));
const D={saved:mk(),draft:mk(),over:{SAR:{segs:[{k:'project'},{k:'type'},{k:'loc',level:'bldg'}],sep:'-',digits:4,scope:{type:1,loc:1}}},overDraft:null,drawer:null,modal:false,ro:false,nav:'numbering',toast:null};
D.savedOver=clone(D.over);
function next(p,ctx){const sc=Object.keys(p.scope).filter(k=>p.scope[k]&&p.segs.some(s=>s.k===k)&&['company','trade','type'].includes(k));
 const n=REG.filter(r=>sc.every(k=>r[k]===ctx[k])).reduce((a,r)=>a+r.n,0);return n+1}
function parts(p,ctx){const out=p.segs.map(s=>({k:s.k,t:SEG[s.k].ex(ctx,s)}));out.push({k:'seq',t:String(next(p,ctx)).padStart(p.digits,'0')});return out}
const str=(p,ctx)=>parts(p,ctx).map(x=>x.t).join(p.sep);
const numHtml=(p,ctx,big)=>`<span class="pv-num"${big?'':' style="font-size:inherit"'}>${parts(p,ctx).map((x,i)=>`${i?`<span class="sep">${p.sep}</span>`:''}<span class="sg tone-${x.k==='seq'?'seq':SEG[x.k].tone}">${esc(x.t)}</span>`).join('')}</span>`;
const dirty=()=>JSON.stringify(D.draft)!==JSON.stringify(D.saved)||JSON.stringify(D.over)!==JSON.stringify(D.savedOver);
const CTX0=SAMPLES[0];
function warns(p,pid){const w=[];
 if(!p.segs.some(s=>s.k==='company'))w.push(`<div class="wn amber"><i class="ti ti-alert-triangle"></i><div>${L('<b>No Company segment.</b> Contractors sharing this pattern share one counter, so each can infer how many submittals the others raised.','<b>لا يوجد مقطع الشركة.</b> المقاولون الذين يستخدمون هذا النمط يتشاركون عدّادًا واحدًا، فيمكن لكل منهم معرفة عدد تقديمات الآخرين.')}</div>${D.ro?'':`<button class="cb sm ac" data-add="company" data-p="${pid}"${p.segs.length>=MAX?' disabled':''}><i class="ti ti-plus"></i>${L('Add Company','إضافة الشركة')}</button>`}</div>`);
 if(p.segs.length>=MAX)w.push(`<div class="wn blue"><i class="ti ti-info-circle"></i><div>${L(`Maximum of ${MAX} segments reached (plus the sequence). Remove one to add another.`,`تم بلوغ الحد الأقصى وهو ${MAX} مقاطع (إضافة إلى التسلسل). احذف مقطعًا لإضافة آخر.`)}</div></div>`);
 const len=str(p,CTX0).length;if(len>30)w.push(`<div class="wn amber"><i class="ti ti-ruler-2"></i><div>${L(`Numbers will be about <b>${len} characters</b> — long numbers get cut off in tables and exports. Aim for 30 or fewer.`,`سيكون طول الرقم حوالي <b>${len} حرفًا</b> — الأرقام الطويلة تُقتطع في الجداول والتصدير. يُفضّل ألا تتجاوز 30.`)}</div></div>`);
 return w.length?`<div class="warns">${w.join('')}</div>`:''}
function builder(p,pid){const used=new Set(p.segs.map(s=>s.k));
 const chips=p.segs.map((s,i)=>{const d=SEG[s.k];return `${i?`<span class="chip-arrow">${esc(p.sep)}</span>`:''}<div class="chip-s tone-${d.tone}" draggable="${!D.ro}" data-chip="${i}" data-p="${pid}"><i class="ti ti-grid-dots grip"></i><span class="bar"></span><span class="tx"><b>${L(d.en,d.ar)}</b>${s.k==='text'&&!D.ro?`<input class="mini" data-text="${i}" data-p="${pid}" value="${esc(s.v||'SUB')}" maxlength="6">`:s.k==='loc'&&!D.ro?`<select class="mini" data-level="${i}" data-p="${pid}">${Object.entries(LEVEL).map(([k,v])=>`<option value="${k}"${(s.level||'bldg')===k?' selected':''}>${L(v[0],v[1])} · ${SEG.loc.ex({}, {level:k})}</option>`).join('')}</select>`:`<code>${esc(d.ex(CTX0,s))}</code>`}</span><button class="x" data-rm="${i}" data-p="${pid}" title="${L('Remove','حذف')}"><i class="ti ti-x"></i></button></div>`}).join('');
 const seq=`<span class="chip-arrow">${esc(p.sep)}</span><div class="chip-s lock tone-seq"><span class="bar"></span><span class="tx"><b>${L('Sequence','التسلسل')}</b><code>${'0'.repeat(p.digits-1)}1</code></span><i class="ti ti-lock"></i></div>`;
 const avail=D.ro?'':`<div class="avail"><small>${L('Add segment','إضافة مقطع')}</small>${Object.entries(SEG).filter(([k])=>k==='text'||!used.has(k)).map(([k,d])=>`<button class="add-s tone-${d.tone}" data-add="${k}" data-p="${pid}"${p.segs.length>=MAX?' disabled':''}><i class="d"></i>${L(d.en,d.ar)}<code>${esc(d.ex(CTX0,{level:'bldg',v:'SUB'}))}</code></button>`).join('')}</div>`;
 return `<div class="chips${D.ro?' ro':''}">${chips}${seq}</div>${avail}${warns(p,pid)}`}
function options(p,pid){const sc=p.segs.filter(s=>SEG[s.k].scope);
 return `<div class="opts">
  <div class="opt"><b>${L('Separator','الفاصل')}</b><span class="segx">${['-','/'].map(x=>`<button class="${p.sep===x?'on':''}" data-sep="${x}" data-p="${pid}"${D.ro?' disabled':''}>${x}</button>`).join('')}</span></div>
  <div class="opt"><b>${L('Sequence digits','عدد خانات التسلسل')}</b><span class="segx">${[3,4,5,6,7].map(n=>`<button class="${p.digits===n?'on':''}" data-dig="${n}" data-p="${pid}"${D.ro?' disabled':''}>${n}</button>`).join('')}</span><small>${L('Zero-padded','مملوء بالأصفار')} · <span style="direction:ltr;unicode-bidi:isolate;font-family:var(--font-ui)">${'0'.repeat(p.digits-1)}1 … ${'9'.repeat(p.digits)}</span></small></div>
  <div class="opt" style="grid-column:1/-1"><b>${L('Sequence scope — separate counters','نطاق التسلسل — عدّادات منفصلة')}</b><small>${L('Tick a segment to give each of its values its own counter.','حدّد مقطعًا ليحصل كل قيمة منه على عدّاد خاص بها.')}</small>
   <div class="scope">${sc.length?sc.map(s=>{const d=SEG[s.k],on=!!p.scope[s.k];return `<span class="sc tone-${d.tone}${on?' on':''}" data-scope="${s.k}" data-p="${pid}"><span class="bx">${on?'<i class="ti ti-check"></i>':''}</span>${L('Per ','لكل ')}${L(d.en,d.ar).toLowerCase()}</span>`}).join(''):`<span class="explain">${L('Add a Company, Trade, Type or Location segment to split counters.','أضف مقطع الشركة أو التخصص أو النوع أو الموقع لتقسيم العدّادات.')}</span>`}</div>
   <div class="explain">${p.scope.trade&&p.segs.some(s=>s.k==='trade')?L('Count separately for each Trade → <code>…EL…-001</code> and <code>…CV…-001</code> both exist.','عدّ منفصل لكل تخصص ← يوجد <code>…EL…-001</code> و <code>…CV…-001</code> معًا.'):L('One shared counter across trades → Electrical and Civil continue the same sequence.','عدّاد واحد مشترك لكل التخصصات ← تستمر الكهربائية والمدنية في نفس التسلسل.')}</div>
   <div class="cnt-ex">${SAMPLES.map(c=>`<div>${L(c.en,c.ar)}<b>→ ${String(next(p,c)).padStart(p.digits,'0')}</b></div>`).join('')}</div>
  </div></div>`}
function preview(){const p=D.draft;const len=str(p,CTX0).length;
 return `<section class="card pv"><div class="card-hd"><div><h3>${L('Live preview','معاينة مباشرة')}</h3><p>${L('The next number for TMC Constructions · Electrical · Material Approval Request.','الرقم التالي لـ TMC · كهربائية · طلب اعتماد مواد.')}</p></div></div>
 <div class="card-bd"><div>${numHtml(p,CTX0,1)}<div class="pv-leg">${[...new Set(p.segs.map(s=>s.k))].map(k=>`<span class="tone-${SEG[k].tone}"><i></i>${L(SEG[k].en,SEG[k].ar)}</span>`).join('')}<span class="tone-seq"><i></i>${L('Sequence','التسلسل')}</span></div><div class="pv-len${len>30?' warn':''}">${L('Length','الطول')}: <b>${len}</b> / 30</div></div>
 <div class="samples"><h6>${L('Next numbers','الأرقام التالية')}</h6>${SAMPLES.map(c=>`<div class="smp"><span>${L(c.en,c.ar)}</span><code>${esc(str(p,c))}</code></div>`).join('')}</div></div></section>`}
function overrides(){return `<section class="card"><div class="card-hd"><div><h3>${L('Per work item type','حسب نوع العنصر')}</h3><p>${L('Each type uses the Project default unless you override it.','كل نوع يستخدم الإعداد الافتراضي للمشروع ما لم تتجاوزه.')}</p></div></div><div class="card-bd" style="padding:14px 0 0"><div style="overflow-x:auto"><table class="ot"><thead><tr><th>${L('Type','النوع')}</th><th>${L('Pattern','النمط')}</th><th>${L('Next number','الرقم التالي')}</th><th></th></tr></thead><tbody>
 ${TYPES.map(([k,e,a])=>{const o=D.over[k],p=o||D.draft,ctx={...CTX0,type:k};return `<tr><td><span class="ty"><span class="doc">${k}</span><b>${L(e,a)}</b></span></td><td>${o?`<span class="badge cus"><i class="ti ti-edit"></i>${L('Custom','مخصص')}</span>`:`<span class="badge def">${L('Uses Project default','يستخدم الافتراضي')}</span>`}</td><td><code>${esc(str(p,ctx))}</code></td><td><span class="acts">${D.ro?'':o?`<button class="cb sm" data-ovr="${k}"><i class="ti ti-edit"></i>${L('Edit','تعديل')}</button><button class="cb ter sm" data-reset="${k}">${L('Reset','إعادة ضبط')}</button>`:`<button class="cb sm" data-ovr="${k}">${L('Override','تخصيص')}</button>`}</span></td></tr>`}).join('')}
 </tbody></table></div></div></section>`}
function revision(){return `<section class="card"><div class="card-hd"><div><h3>${L('Revision suffix','لاحقة المراجعة')}</h3><p>${L('Revisions keep the same number and add Rev 1, Rev 2… This can’t be changed, so the register stays traceable.','تحتفظ المراجعات بنفس الرقم مع إضافة Rev 1 و Rev 2… ولا يمكن تغيير ذلك للحفاظ على تتبّع السجل.')}</p></div><span class="r"><span class="ro-note"><i class="ti ti-lock"></i>${L('Fixed','ثابت')}</span></span></div><div class="card-bd"><div class="revrow">${[0,1,2].map(n=>`<code>${esc(str(D.draft,CTX0))}${n?`<em> Rev ${n}</em>`:''}</code>`).join('<i class="ti ti-arrow-right" style="color:var(--ui-faint)"></i>')}</div></div></section>`}
function drawer(){if(!D.drawer)return '';const k=D.drawer,t=TYPES.find(x=>x[0]===k),p=D.overDraft,ctx={...CTX0,type:k};
 return `<div class="scrim" data-close="drawer"><div class="drawer" data-stop><div class="dr-hd"><span class="doc" style="display:inline-flex;height:22px;padding:0 7px;border-radius:4px;box-shadow:inset 0 0 0 1px var(--doctype-ring);color:var(--doctype-fg);font:700 11px var(--font-ui);align-items:center">${k}</span><div><h3>${L('Override pattern','تخصيص النمط')} · ${L(t[1],t[2])}</h3><small>${L('Only this type changes. Others keep the Project default.','يتغير هذا النوع فقط، وتبقى الأنواع الأخرى على الإعداد الافتراضي.')}</small></div><button class="cb ter ic x" data-close="drawer"><i class="ti ti-x"></i></button></div>
 <div class="dr-bd"><section class="card"><div class="card-bd">${numHtml(p,ctx,1)}</div></section><section class="card"><div class="card-hd"><div><h3>${L('Segments','المقاطع')}</h3></div></div><div class="card-bd">${builder(p,'ovr')}</div></section><section class="card"><div class="card-bd">${options(p,'ovr')}</div></section></div>
 <div class="dr-ft"><button class="cb ter" data-copydef>${L('Start from Project default','البدء من الافتراضي')}</button><span class="sp"></span><button class="cb" data-close="drawer">${L('Cancel','إلغاء')}</button><button class="cb pri" data-applyovr><i class="ti ti-check"></i>${L('Apply override','تطبيق التخصيص')}</button></div></div></div>`}
function modal(){if(!D.modal)return '';
 return `<div class="scrim" data-close="modal"><div class="modal" data-stop><div class="md-bd"><span class="md-ic"><i class="ti ti-alert-triangle"></i></span><h3>${L('Save numbering changes?','حفظ تغييرات الترقيم؟')}</h3><p>${L('Changes apply <b>only to new items</b>. Existing document numbers never change.','تنطبق التغييرات <b>على العناصر الجديدة فقط</b>. أرقام المستندات الحالية لن تتغير أبدًا.')}</p>
 <div class="ba"><small>${L('Before','قبل')}</small><code>${esc(str(D.saved,CTX0))}</code><i class="ti ti-arrow-down arrow"></i><small>${L('After','بعد')}</small><code class="new">${esc(str(D.draft,CTX0))}</code></div>
 <div class="md-li"><span><i class="ti ti-circle-check"></i>${L('The official register keeps every issued number.','يحتفظ السجل الرسمي بكل رقم صادر.')}</span><span><i class="ti ti-circle-check"></i>${L('Revisions of existing items keep their original number.','مراجعات العناصر الحالية تحتفظ برقمها الأصلي.')}</span>${Object.keys(D.over).length?`<span><i class="ti ti-circle-check"></i>${L(`${Object.keys(D.over).length} type override(s) are saved with it.`,`يتم حفظ ${Object.keys(D.over).length} تخصيص معه.`)}</span>`:''}</div></div>
 <div class="md-ft"><button class="cb" data-close="modal">${L('Cancel','إلغاء')}</button><button class="cb pri" data-confirm><i class="ti ti-check"></i>${L('Save for new items','حفظ للعناصر الجديدة')}</button></div></div></div>`}
function nav(){const items=[['general','ti-settings','General','عام'],['participants','ti-users','Participants','المشاركون'],['visibility','ti-eye','Visibility','الظهور'],['positions','ti-user-circle','Positions','المناصب'],['trades','ti-map-pin','Trades & Locations','التخصصات والمواقع'],['stages','ti-list-check','Stages','المراحل'],['numbering','ti-list','Document Numbering','ترقيم المستندات'],['workflows','ti-refresh','Workflows','سير العمل'],['forms','ti-clipboard-text','Forms','النماذج'],['suppliers','ti-building','Approved Suppliers','الموردون المعتمدون'],['activity','ti-clock','Activity','النشاط']];
 return `<nav class="st-nav"><h6>${L('Project settings','إعدادات المشروع')}</h6>${items.map(i=>`<button class="${i[0]===D.nav?'on':''}" data-snav="${i[0]}"><i class="ti ${i[1]}"></i>${L(i[2],i[3])}</button>`).join('')}</nav>`}
function view(){const ro=D.ro;
 return `<div class="st-wrap">${nav()}<div class="st-main">
 <div class="st-hd"><div><h1>${L('Document Numbering','ترقيم المستندات')}</h1><p>${L('Build how Document Numbers are generated the first time a work item leaves Draft. Applies to new items only.','حدّد طريقة إنشاء أرقام المستندات عند خروج العنصر من المسودة لأول مرة. ينطبق على العناصر الجديدة فقط.')}</p></div>
  <div class="act">${ro?`<span class="ro-note"><i class="ti ti-lock"></i>${L('Only Project Admins can change this','يمكن لمسؤولي المشروع فقط تغيير ذلك')}</span>`:''}<span class="segx" title="${L('Demo: view as','عرض توضيحي: العرض بصفة')}"><button class="${ro?'':'on'}" data-ro="0" style="font-family:inherit">${L('Admin','مسؤول')}</button><button class="${ro?'on':''}" data-ro="1" style="font-family:inherit">${L('Member','عضو')}</button></span></div></div>
 ${preview()}
 <section class="card"><div class="card-hd"><div><h3>${L('Pattern — Project default','النمط — الافتراضي للمشروع')}</h3><p>${ro?L('Current segments, in order.','المقاطع الحالية بالترتيب.'):L('Drag to reorder. Up to 6 segments; the sequence is always last.','اسحب لإعادة الترتيب. حتى 6 مقاطع، والتسلسل دائمًا في النهاية.')}</p></div><span class="r" style="font:600 12px var(--font-ui);color:var(--ui-muted)">${D.draft.segs.length} / ${MAX}</span></div><div class="card-bd">${builder(D.draft,'def')}</div></section>
 <section class="card"><div class="card-hd"><div><h3>${L('Sequence','التسلسل')}</h3></div></div><div class="card-bd">${options(D.draft,'def')}</div></section>
 ${overrides()}${revision()}
 </div></div>
 ${dirty()&&!ro?`<div class="savebar"><i class="ti ti-alert-circle"></i>${L('Unsaved changes','تغييرات غير محفوظة')}<button class="cb ter sm" data-discard>${L('Discard','تجاهل')}</button><button class="cb pri sm" data-save>${L('Review & save','مراجعة وحفظ')}</button></div>`:''}
 ${drawer()}${modal()}${D.toast?`<div class="toast"><i class="ti ti-circle-check"></i>${D.toast}</div>`:''}`}
function P(pid){return pid==='ovr'?D.overDraft:D.draft}
function bind(root,render){let tt;const flash=m=>{D.toast=m;render();clearTimeout(tt);tt=setTimeout(()=>{D.toast=null;render()},2200)};
 root.addEventListener('click',e=>{const b=e.target.closest('[data-add],[data-rm],[data-sep],[data-dig],[data-scope],[data-ovr],[data-reset],[data-close],[data-save],[data-confirm],[data-discard],[data-applyovr],[data-copydef],[data-ro],[data-snav]');if(!b)return;const d=b.dataset;
  if(d.close){if(e.target.closest('[data-stop]')&&!e.target.closest('button[data-close]'))return;D.drawer=null;D.modal=false;return render()}
  if(d.ro!==undefined){D.ro=d.ro==='1';return render()}
  if(d.snav){if(d.snav==='workflows'||d.snav==='types'){location.href='settings-workflows.html';return}if(d.snav!=='numbering')return flash(L('This settings page is not designed yet.','لم تُصمَّم صفحة الإعدادات هذه بعد.'));return}
  if(D.ro)return;
  const p=d.p?P(d.p):null;
  if(d.add){if(p.segs.length>=MAX||b.disabled)return;const s={k:d.add};if(d.add==='loc')s.level='bldg';if(d.add==='text')s.v='SUB';p.segs.push(s);if(SEG[d.add].scope&&d.add==='company')p.scope.company=1;return render()}
  if(d.rm!==undefined){const s=p.segs.splice(+d.rm,1)[0];if(!p.segs.some(x=>x.k===s.k))delete p.scope[s.k];return render()}
  if(d.sep){p.sep=d.sep;return render()}
  if(d.dig){p.digits=+d.dig;return render()}
  if(d.scope){p.scope[d.scope]=p.scope[d.scope]?0:1;return render()}
  if(d.ovr){D.drawer=d.ovr;D.overDraft=clone(D.over[d.ovr]||D.draft);return render()}
  if(d.reset!==undefined&&d.reset){delete D.over[d.reset];return render()}
  if(d.copydef!==undefined){D.overDraft=clone(D.draft);return render()}
  if(d.applyovr!==undefined){D.over[D.drawer]=clone(D.overDraft);D.drawer=null;return render()}
  if(d.save!==undefined){D.modal=true;return render()}
  if(d.discard!==undefined){D.draft=clone(D.saved);D.over=clone(D.savedOver);return render()}
  if(d.confirm!==undefined){D.saved=clone(D.draft);D.savedOver=clone(D.over);D.modal=false;return flash(L('Numbering saved — applies to new items','تم حفظ الترقيم — ينطبق على العناصر الجديدة'))}
 });
 root.addEventListener('input',e=>{const i=e.target;if(i.dataset.text!==undefined){P(i.dataset.p).segs[+i.dataset.text].v=i.value.replace(/[^A-Za-z0-9]/g,'').toUpperCase();const pos=i.selectionStart;render();const n=root.querySelector(`[data-text="${i.dataset.text}"][data-p="${i.dataset.p}"]`);if(n){n.focus();n.setSelectionRange(pos,pos)}}});
 root.addEventListener('change',e=>{const i=e.target;if(i.dataset.level!==undefined){P(i.dataset.p).segs[+i.dataset.level].level=i.value;render()}});
 let drag=null;
 root.addEventListener('dragstart',e=>{const c=e.target.closest('[data-chip]');if(!c||D.ro)return;if(e.target.closest('input,select'))return e.preventDefault();drag={i:+c.dataset.chip,p:c.dataset.p};c.classList.add('drag');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain','x')});
 root.addEventListener('dragover',e=>{if(!drag)return;const c=e.target.closest('[data-chip]');if(!c||c.dataset.p!==drag.p)return;e.preventDefault();root.querySelectorAll('.chip-s.over').forEach(x=>x.classList.remove('over'));c.classList.add('over');
  const to=+c.dataset.chip;if(to!==drag.i){const p=P(drag.p);const [m]=p.segs.splice(drag.i,1);p.segs.splice(to,0,m);drag.i=to;render();const n=root.querySelector(`[data-chip="${to}"][data-p="${drag.p}"]`);n&&n.classList.add('drag')}});
 root.addEventListener('drop',e=>{if(drag){e.preventDefault();drag=null;render()}});
 root.addEventListener('dragend',()=>{drag=null;root.querySelectorAll('.drag,.over').forEach(x=>x.classList.remove('drag','over'))});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(D.drawer||D.modal)){D.drawer=null;D.modal=false;render()}});
}
window.DN={D,view,bind};
})();
