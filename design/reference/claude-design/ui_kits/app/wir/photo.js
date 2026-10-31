// Rabaed photo tool — one component for every photo field (WIR, inspection items, Snags, Site Reports, attachments).
// Add (Take photo on phones · Upload everywhere · drop on desktop) → thumbnails (×) → full-screen viewer → annotate.
// The original is never changed: markup is stored as an annotated copy beside it (p.ann). Exposes window.RPH.
(function(){
const L=(e,a)=>document.documentElement.lang==='ar'?a:e;
const W=400,H=300,COL=['#ef3b2d','#ffd23f','#ffffff','#2f7cf6'];
const REG={};let V=null,onCh=()=>{},seq=0;
const PH={joint:['Mortar joints · stair core','فواصل المونة · بيت الدرج'],lintel:['Lintel D-03','عتب D-03'],tie:['Wall ties · C/3','روابط الجدار · C/3'],box:['Back boxes · C/4','العلب · C/4'],box2:['Back boxes · C/4 (2)','العلب · C/4 (2)'],fire:['Riser wall penetrations','اختراقات جدار الرايزر'],wall:['Wall A–B · Floor 3','الجدار A–B · الطابق 3'],slab:['Slab edge','حافة السقف'],site:['Floor 3 · general view','الطابق 3 · منظر عام']};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const txt=s=>Array.isArray(s)?L(s[0],s[1]):s;
function shapes(ann,sc){if(!ann||!ann.length)return '';sc=sc||1;return ann.map(s=>{const c=s.c,sw=5;
 if(s.t==='arr'){const x1=s.x1*W,y1=s.y1*H,x2=s.x2*W,y2=s.y2*H,a=Math.atan2(y2-y1,x2-x1),h=18;const p=[[x2,y2],[x2-h*Math.cos(a-.45),y2-h*Math.sin(a-.45)],[x2-h*Math.cos(a+.45),y2-h*Math.sin(a+.45)]];return `<line x1="${x1}" y1="${y1}" x2="${x2-10*Math.cos(a)}" y2="${y2-10*Math.sin(a)}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/><polygon points="${p.map(q=>q.join(',')).join(' ')}" fill="${c}" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`}
 if(s.t==='rect')return `<rect x="${Math.min(s.x,s.x+s.w)*W}" y="${Math.min(s.y,s.y+s.h)*H}" width="${Math.abs(s.w)*W}" height="${Math.abs(s.h)*H}" rx="4" fill="none" stroke="${c}" stroke-width="${sw}"/>`;
 if(s.t==='ell')return `<ellipse cx="${s.x*W}" cy="${s.y*H}" rx="${Math.abs(s.rx)*W}" ry="${Math.abs(s.ry)*H}" fill="none" stroke="${c}" stroke-width="${sw}"/>`;
 if(s.t==='pen')return `<polyline points="${s.p.map(q=>(q[0]*W).toFixed(1)+','+(q[1]*H).toFixed(1)).join(' ')}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
 if(s.t==='txt'){const t=txt(s.s);const w=t.length*10.5+18;const dark=c==='#ffffff'||c==='#ffd23f';return `<g><rect x="${s.x*W}" y="${s.y*H-22}" width="${w}" height="30" rx="6" fill="${c}"/><text x="${s.x*W+9}" y="${s.y*H-1}" font-size="18" font-weight="700" font-family="var(--font-ui),sans-serif" fill="${dark?'#111':'#fff'}">${esc(t)}</text></g>`}
 return ''}).join('')}
function img(p,o){o=o||{};const ann=o.orig?null:p.ann;const base=p.src?`<img src="${p.src}" alt="">`:`<div class="ph-pl"><i class="ti ti-photo"></i><span>${esc(txt(PH[p.k]||PH.site))}</span></div>`;
 return `<div class="ph-img">${base}${ann&&ann.length?`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${shapes(ann)}</svg>`:''}</div>`}
function thumb(key,p,i,o){return `<div class="ph-th"><button class="ph-tb" data-ph-open="${key}|${i}" aria-label="${L('Open photo','فتح الصورة')}">${img(p)}${p.ann&&p.ann.length?`<span class="ph-am" title="${L('Annotated — original kept','مُعلَّم — الأصل محفوظ')}"><i class="ti ti-pencil"></i>${o.compact?'':L('Annotated','مُعلَّم')}</span>`:''}${p.err?`<span class="ph-er"><i class="ti ti-alert-triangle"></i></span>`:''}</button>${o.ro?'':`<button class="ph-rm" data-ph-rm="${key}|${i}" aria-label="${L('Remove','إزالة')}"><i class="ti ti-x"></i></button>`}</div>`}
// field(key, photos[], {label, req, ro, compact, hint})
function field(key,arr,o){o=o||{};REG[key]=arr;
 const thumbs=arr.length?`<div class="ph-ths">${arr.map((p,i)=>thumb(key,p,i,o)).join('')}</div>`:'';
 const add=o.ro?'':`<div class="ph-add"><button class="ph-b ph-take" data-ph-take="${key}"><i class="ti ti-camera"></i>${L('Take photo','التقاط صورة')}</button><button class="ph-b" data-ph-up="${key}"><i class="ti ti-upload"></i><span class="ph-up-m">${L('Upload','رفع')}</span><span class="ph-up-d">${L('Upload or drop photos','ارفع الصور أو أفلتها هنا')}</span></button></div>`;
 return `<div class="ph-f${o.ro?' ro':''}" data-ph-drop="${o.ro?'':key}">${o.label!==false?`<div class="ph-lb">${o.label||L('Photos','الصور')}${o.req?` <em>${L('(required)','(إلزامي)')}</em>`:''}${arr.length?`<small class="num">${arr.length}</small>`:''}</div>`:''}${add}${thumbs}${o.ro&&!arr.length?`<div class="ph-none">${L('No photos','لا توجد صور')}</div>`:''}</div>`}
/* ---------- viewer + annotate overlay ---------- */
const TOOLS=[['arr','<i class="ti ti-arrow-up-right"></i>',['Arrow','سهم']],['rect','<svg viewBox="0 0 24 24" width="22" height="22"><rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',['Box','مستطيل']],['ell','<svg viewBox="0 0 24 24" width="22" height="22"><ellipse cx="12" cy="12" rx="8.5" ry="6.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',['Circle','دائرة']],['pen','<i class="ti ti-pencil"></i>',['Pen','قلم']],['txt','<b class="ph-T">T</b>',['Text','نص']]];
function ov(){const p=REG[V.key][V.i];const n=REG[V.key].length;const has=p.ann&&p.ann.length;
 if(V.mode==='edit'){const d=V.d;return `<div class="ph-ov ed" role="dialog"><div class="ph-top"><button class="ph-x" data-ph="cancel">${L('Cancel','إلغاء')}</button><b>${L('Annotate','تعليم الصورة')}</b><button class="ph-sv" data-ph="save">${L('Save','حفظ')}</button></div>
  <div class="ph-stage"><div class="ph-cv">${img(p,{orig:1})}<svg class="ph-draw tool-${V.tool}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" data-ph-draw="1">${shapes(d)}${V.tx?'':''}</svg>${V.tx?`<input class="ph-ti" id="phti" style="left:${V.tx.x*100}%;top:${V.tx.y*100}%;color:${V.color}" placeholder="${L('Type a label','اكتب تسمية')}" maxlength="40" enterkeyhint="done">`:''}</div></div>
  <div class="ph-hint"><i class="ti ti-lock"></i>${L('The original stays as taken. Your markup is saved as a copy beside it.','يبقى الأصل كما التُقط. تُحفظ علاماتك كنسخة بجانبه.')}</div>
  <div class="ph-bar"><div class="ph-tools">${TOOLS.map(t=>`<button class="${V.tool===t[0]?'on':''}" data-ph-tool="${t[0]}" aria-label="${L(t[2][0],t[2][1])}">${t[1]}<small>${L(t[2][0],t[2][1])}</small></button>`).join('')}</div>
  <div class="ph-cols">${COL.map(c=>`<button class="${V.color===c?'on':''}" data-ph-col="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}<span class="sp"></span><button class="ph-un" data-ph="undo"${d.length?'':' disabled'}><i class="ti ti-arrow-back-up"></i>${L('Undo','تراجع')}</button></div></div></div>`}
 const orig=V.show==='orig'||!has;
 return `<div class="ph-ov" role="dialog"><div class="ph-top"><button class="ph-x ic" data-ph="close" aria-label="${L('Close','إغلاق')}"><i class="ti ti-x"></i></button><b class="num">${L('Photo','صورة')} ${V.i+1} / ${n}</b>${has?`<span class="ph-sw"><button class="${orig?'':'on'}" data-ph-show="ann"><i class="ti ti-pencil"></i>${L('Annotated','مُعلَّمة')}</button><button class="${orig?'on':''}" data-ph-show="orig">${L('Original','الأصلية')}</button></span>`:'<span></span>'}</div>
 <div class="ph-stage">${n>1?`<button class="ph-nav prev" data-ph-nav="-1"${V.i?'':' disabled'}><i class="ti ti-chevron-left"></i></button>`:''}<div class="ph-cv">${img(p,{orig})}</div>${n>1?`<button class="ph-nav next" data-ph-nav="1"${V.i<n-1?'':' disabled'}><i class="ti ti-chevron-right"></i></button>`:''}</div>
 <div class="ph-meta">${orig?`<span><i class="ti ti-shield-check"></i>${L('Original — as taken','الأصلية — كما التُقطت')}${p.at?` · <span class="num">${p.at}</span>`:''}${has?' · '+L('kept as evidence','محفوظة كدليل'):''}</span>`:`<span><i class="ti ti-pencil"></i>${L('Annotated copy','نسخة مُعلَّمة')} · ${L('the original is kept unchanged','الأصل محفوظ دون تغيير')}</span>`}</div>
 ${V.ro?'':`<div class="ph-bar v"><button class="ph-ab" data-ph="edit"><i class="ti ti-pencil"></i>${has?L('Edit annotation','تعديل العلامات'):L('Annotate','تعليم الصورة')}</button></div>`}</div>`}
function paint(){let el=document.getElementById('ph-root');if(!el){el=document.createElement('div');el.id='ph-root';document.body.appendChild(el)}el.innerHTML=V?ov():'';document.documentElement.classList.toggle('ph-lock',!!V);if(V&&V.tx){const t=document.getElementById('phti');t&&t.focus()}}
function open(key,i,o){o=o||{};V={key,i,mode:o.edit?'edit':'view',show:'ann',ro:!!o.ro,tool:'arr',color:COL[0],d:[]};if(o.edit)V.d=JSON.parse(JSON.stringify(REG[key][i].ann||[]));paint()}
function close(){V=null;paint()}
function pick(key,cam){const inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.multiple=!cam;if(cam)inp.setAttribute('capture','environment');inp.onchange=()=>addFiles(key,inp.files);inp.click()}
function addFiles(key,files){const arr=REG[key];if(!arr)return;const now=new Date();const at=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
 [...files].filter(f=>/^image\//.test(f.type)).forEach(f=>{const p={id:'u'+(++seq),src:'',ann:null,at};arr.push(p);const r=new FileReader();r.onload=()=>{p.src=r.result;onCh(key)};r.readAsDataURL(f)});onCh(key)}
function pt(e){const sv=document.querySelector('[data-ph-draw]');const r=sv.getBoundingClientRect();const s=Math.min(r.width/W,r.height/H);const ox=(r.width-W*s)/2,oy=(r.height-H*s)/2;return [Math.max(0,Math.min(1,(e.clientX-r.left-ox)/(W*s))),Math.max(0,Math.min(1,(e.clientY-r.top-oy)/(H*s)))]}
let drag=null;
function commitTx(){if(!V||!V.tx)return;const t=document.getElementById('phti');const v=t&&t.value.trim();if(v)V.d.push({t:'txt',x:V.tx.x,y:V.tx.y,s:v,c:V.color});V.tx=null}
function bind(cb){onCh=cb||onCh;if(bind.done)return;bind.done=1;
 document.addEventListener('click',e=>{const b=e.target.closest('[data-ph-take],[data-ph-up],[data-ph-rm],[data-ph-open],[data-ph],[data-ph-tool],[data-ph-col],[data-ph-show],[data-ph-nav]');if(!b)return;const d=b.dataset;e.preventDefault();e.stopPropagation();
  if(d.phTake)return pick(d.phTake,1);if(d.phUp)return pick(d.phUp,0);
  if(d.phRm){const [k,i]=d.phRm.split('|');REG[k].splice(+i,1);return onCh(k)}
  if(d.phOpen){const [k,i]=d.phOpen.split('|');const ro=!!b.closest('.ph-f.ro');return open(k,+i,{ro})}
  if(d.phTool){commitTx();V.tool=d.phTool;return paint()}if(d.phCol){V.color=d.phCol;return paint()}
  if(d.phShow){V.show=d.phShow;return paint()}if(d.phNav){V.i+=+d.phNav;V.show='ann';return paint()}
  const a=d.ph;if(a==='close')return close();
  if(a==='edit'){V.mode='edit';V.d=JSON.parse(JSON.stringify(REG[V.key][V.i].ann||[]));return paint()}
  if(a==='cancel'){V.tx=null;V.mode='view';return paint()}
  if(a==='undo'){V.tx=null;V.d.pop();return paint()}
  if(a==='save'){commitTx();const p=REG[V.key][V.i];p.ann=V.d.length?V.d:null;V.mode='view';V.show='ann';paint();return onCh(V.key)}
 },true);
 document.addEventListener('pointerdown',e=>{if(!V||V.mode!=='edit'||!e.target.closest('[data-ph-draw]'))return;e.preventDefault();const [x,y]=pt(e);
  if(V.tool==='txt'){commitTx();V.tx={x,y};return paint()}commitTx();
  const c=V.color;const s=V.tool==='arr'?{t:'arr',x1:x,y1:y,x2:x,y2:y,c}:V.tool==='rect'?{t:'rect',x,y,w:0,h:0,c}:V.tool==='ell'?{t:'ell',x,y,rx:0,ry:0,c,ox:x,oy:y}:{t:'pen',p:[[x,y]],c};V.d.push(s);drag=s;paint()});
 document.addEventListener('pointermove',e=>{if(!drag)return;const [x,y]=pt(e);const s=drag;
  if(s.t==='arr'){s.x2=x;s.y2=y}else if(s.t==='rect'){s.w=x-s.x;s.h=y-s.y}else if(s.t==='ell'){s.x=(s.ox+x)/2;s.y=(s.oy+y)/2;s.rx=(x-s.ox)/2;s.ry=(y-s.oy)/2}else s.p.push([x,y]);
  const sv=document.querySelector('[data-ph-draw]');if(sv)sv.innerHTML=shapes(V.d)});
 document.addEventListener('pointerup',()=>{if(!drag)return;const s=drag;drag=null;const tiny=(s.t==='arr'&&Math.hypot(s.x2-s.x1,s.y2-s.y1)<.02)||(s.t==='rect'&&Math.abs(s.w)+Math.abs(s.h)<.02)||(s.t==='ell'&&Math.abs(s.rx)+Math.abs(s.ry)<.01)||(s.t==='pen'&&s.p.length<2);if(tiny)V.d.pop();delete s.ox;delete s.oy;paint()});
 document.addEventListener('keydown',e=>{if(!V)return;if(e.target.id==='phti'&&e.key==='Enter'){commitTx();paint()}else if(e.key==='Escape'){if(V.tx){V.tx=null;paint()}else if(V.mode==='edit'){V.mode='view';paint()}else close()}});
 document.addEventListener('dragover',e=>{const z=e.target.closest('[data-ph-drop]');if(z&&z.dataset.phDrop){e.preventDefault();z.classList.add('ov')}});
 document.addEventListener('dragleave',e=>{const z=e.target.closest('[data-ph-drop]');if(z)z.classList.remove('ov')});
 document.addEventListener('drop',e=>{const z=e.target.closest('[data-ph-drop]');if(!z||!z.dataset.phDrop)return;e.preventDefault();z.classList.remove('ov');addFiles(z.dataset.phDrop,e.dataTransfer.files)});
}
window.RPH={field,thumb,img,shapes,open,close,bind,paint,REG,get V(){return V},set V(v){V=v;paint()}};
})();
