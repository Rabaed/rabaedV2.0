// Submittals — List view. Uses RS (shell.js) for sidebar/header/tabs.
(function(){
const S=RS.S;const L=(e,a)=>S.lang==='ar'?a:e;const esc=RS.esc;
const KEY='rb-list-v1',DEF='rb-list-default-v1';
const COLS=[
 {id:'no',en:'Submittal No.',ar:'رقم التقديم',lock:1,w:130},
 {id:'title',en:'Title',ar:'العنوان',lock:1,w:260},
 {id:'rev',en:'Rev',ar:'المراجعة',w:70},
 {id:'disc',en:'Discipline',ar:'التخصص',w:190},
 {id:'type',en:'Type',ar:'النوع',w:80},
 {id:'status',en:'Status',ar:'الحالة',w:190},
 {id:'code',en:'Code',ar:'الرمز',w:100},
 {id:'zone',en:'Zone',ar:'المنطقة',w:90},
 {id:'bldg',en:'Building',ar:'المبنى',w:100},
 {id:'floor',en:'Floor',ar:'الطابق',w:80},
 {id:'owner',en:'Current owner',ar:'المسؤول الحالي',w:200},
 {id:'contractor',en:'Contractor',ar:'المقاول',w:220,off:1},
 {id:'created',en:'Created',ar:'تاريخ الإنشاء',w:120},
 {id:'due',en:'Due date',ar:'تاريخ الاستحقاق',w:120},
 {id:'days',en:'Days in column',ar:'الأيام في العمود',w:130,off:1}
];
const GROUPS=['status','disc','type','owner','zone','code'];
const ST={draft:['Draft','مسودة','draft'],internal:['Internal Review','مراجعة داخلية','internal'],resub:['Revised & Resubmitted','معاد تقديمها','resubmitted'],pending:['Pending Approval','بانتظار الاعتماد','pending'],approved:['Approved','معتمدة','approved'],rejected:['Rejected','مرفوضة','rejected']};
const DISC={CV:['Civil Works','أعمال مدنية','amber'],AR:['Architecture','أعمال معمارية','violet'],EL:['Electrical Works','أعمال كهربائية','cyan'],ME:['Mechanical Works','أعمال ميكانيكية','green'],SU:['Surveying','أعمال المساحة','orange']};
const CODE={A:['green',1,'ti-circle-check'],B:['green',0,'ti-circle-check'],C:['amber',0,'ti-refresh'],D:['red',1,'ti-circle-x']};
const PEOPLE=[['Ahmed bin Said','أحمد بن سعيد','#3d6db5'],['Nasser Al Kaabi','ناصر الكعبي','#e98b45'],['Abdullah Al Saadi','عبدالله السعدي','#7a5c3a'],['Mohammed Al Shamsi','محمد الشامسي','#1fae66'],['Sarah Al Mansoori','سارة المنصوري','#b5455a'],['Khalid Al Dhaheri','خالد الظاهري','#6b5ad8']];
const CONTR=[['Al Futtaim Construction Co.','شركة الفطيم للمقاولات'],['Arabtec','أرابتك'],['ALEC Engineering','ألك للهندسة']];
const TITLES=[['Fire Suppression System','نظام إطفاء الحريق','EL'],['HVAC Ducting — Level 3','مجاري التكييف — الطابق ٣','ME'],['Drainage System','نظام الصرف','CV'],['Basement Waterproofing','العزل المائي للقبو','CV'],['Concrete Mix Design C40','تصميم خلطة الخرسانة C40','CV'],['Public Lighting Fixtures','وحدات الإنارة العامة','EL'],['Curtain Wall System','نظام الواجهات الزجاجية','AR'],['Chilled Water Pipes','أنابيب المياه المبردة','ME'],['Façade Cladding Panels','ألواح تكسية الواجهة','AR'],['Setting-out Survey — Tower','مسح التوقيع — البرج','SU'],['Low Current Systems','أنظمة التيار المنخفض','EL'],['Structural Steel Beams','الكمرات الفولاذية','CV'],['Lift Installation','تركيب المصاعد','ME'],['Ceramic Floor Tiles','بلاط الأرضيات السيراميك','AR']];
const STK=Object.keys(ST);
const rows=[];
for(let i=0;i<42;i++){const t=TITLES[i%TITLES.length];const st=STK[(i*7+3)%6];const rev=st==='resub'?'R'+(1+i%3):(i%5===0?'R1':'R0');
 const code=st==='approved'?(i%2?'A':'B'):st==='rejected'?(i%3?'D':'C'):'';
 const d=new Date(2026,7,1+((i*5)%55));const due=new Date(d.getTime()+(10+i%12)*864e5);
 rows.push({id:'SUB-'+String(1280+i).padStart(4,'0'),t,disc:t[2],type:['MAR','SAR','DAR','DAS'][i%4],st,rev,code,zone:'ABC'[i%3],bldg:String(1+i%3),floor:['B2','B1','G','1','2','3','4','5','R'][i%9],owner:i%6,ctr:i%3,created:d,due,days:[1,2,3,5,8,12,20,4,6][i%9]});}
function initCols(){try{return JSON.parse(localStorage.getItem(KEY))||JSON.parse(localStorage.getItem(DEF))}catch(e){}return null}
const V={fsel:{},kgroup:null,cols:initCols()||COLS.map(c=>({id:c.id,on:!c.off})),sort:{id:'no',dir:1},group:null,open:{},q:'',mine:false,page:1,per:25,sel:new Set(),menu:null,settings:false,toast:null};
const colDef=id=>COLS.find(c=>c.id===id);
const fmtD=d=>new Intl.DateTimeFormat(S.lang==='ar'?'ar':'en-GB',{day:'2-digit',month:'short',year:'numeric',numberingSystem:'latn'}).format(d);
const dots=n=>n>=20?'rrrr':n>=12?'rrr_':n>=8?'rr__':n>=5?'r___':n>=3?'y___':n>=2?'g___':'____';
function val(r,id){switch(id){case 'no':return r.id;case 'title':return L(r.t[0],r.t[1]);case 'rev':return r.rev;case 'disc':return L(DISC[r.disc][0],DISC[r.disc][1]);case 'type':return r.type;case 'status':return L(ST[r.st][0],ST[r.st][1]);case 'code':return r.code?'Code '+r.code:'—';case 'zone':return L('Zone ','المنطقة ')+r.zone;case 'bldg':return L('Building ','المبنى ')+r.bldg;case 'floor':return r.floor;case 'owner':return L(PEOPLE[r.owner][0],PEOPLE[r.owner][1]);case 'contractor':return L(CONTR[r.ctr][0],CONTR[r.ctr][1]);case 'created':return fmtD(r.created);case 'due':return fmtD(r.due);case 'days':return r.days}}
function sortKey(r,id){return id==='created'?r.created:id==='due'?r.due:id==='days'?r.days:String(val(r,id))}
function cell(r,id){switch(id){
 case 'no':return `<span class="num mut">${r.id}</span>`;
 case 'title':return `<span class="ttl" title="${esc(val(r,'title'))}">${esc(val(r,'title'))}</span>`;
 case 'rev':return r.rev==='R0'?'<span class="mut num">R0</span>':`<span class="chip" style="background:var(--rev-pill-bg);color:var(--rev-pill-fg);font-weight:700">${r.rev}</span>`;
 case 'disc':{const d=DISC[r.disc];return `<span class="chip" style="background:var(--tone-${d[2]}-tint);color:var(--tone-${d[2]}-fg)">${L(d[0],d[1])} (${r.disc})</span>`}
 case 'type':return `<span class="doc">${r.type}</span>`;
 case 'status':{const s=ST[r.st];return `<span class="chip" style="background:var(--status-${s[2]}-bg);color:var(--status-${s[2]}-fg)"><i style="background:var(--status-${s[2]}-dot)"></i>${L(s[0],s[1])}</span>`}
 case 'code':{if(!r.code)return '<span class="mut">—</span>';const c=CODE[r.code];return `<span class="chip" style="background:var(--tone-${c[0]}-${c[1]?'solid':'tint'});color:${c[1]?'#fff':`var(--tone-${c[0]}-fg)`}"><span class="ti ${c[2]}"></span>Code ${r.code}</span>`}
 case 'owner':{const p=PEOPLE[r.owner];return `<span class="who"><span class="av" style="width:24px;height:24px;font-size:10px;background:${p[2]}">${RS.ini(p[0])}</span>${L(p[0],p[1])}</span>`}
 case 'created':case 'due':{const late=id==='due'&&r.due<new Date(2026,8,26)&&!['approved','rejected'].includes(r.st);return `<span class="num${late?'':' mut'}" style="${late?'color:var(--tone-red-fg);font-weight:600':''}">${fmtD(id==='due'?r.due:r.created)}</span>`}
 case 'days':return `<span class="dots" title="${r.days}">${dots(r.days).split('').map(c=>`<i class="${c==='_'?'':c}"></i>`).join('')}</span> <span class="num mut" style="margin-inline-start:6px">${r.days}${L('d','ي')}</span>`;
 default:return esc(val(r,id))}}
function fmatch(r){const F=V.fsel,has=(k,v)=>!F[k]||!F[k].length||F[k].includes(String(v));if(!has('status',r.st)||!has('trade',r.disc)||!has('type',r.type)||!has('owner',r.owner)||!has('zone',r.zone)||!has('bldg',r.bldg)||!has('floor',r.floor)||!has('code',r.code||'none')||!has('rev',r.rev))return false;if(F.days&&F.days.length&&r.days<+F.days[0])return false;if(F.created&&F.created.length){const ago=(new Date(2026,8,26)-r.created)/864e5;if(ago>+F.created[0])return false}return true}
function fieldsDef(){const Lx=(e,a)=>S.lang==='ar'?a:e;return [{k:'status',n:Lx('Status','الحالة'),a:Lx('الحالة','Status'),mark:'dot',opts:Object.keys(ST).map(k=>[k,`var(--status-${ST[k][2]}-dot)`,0,Lx(ST[k][0],ST[k][1])])},{k:'trade',n:Lx('Trade','التخصص'),a:Lx('التخصص','Trade'),mark:'chip',opts:Object.keys(DISC).map(k=>[k,DISC[k][2],k,Lx(DISC[k][0],DISC[k][1])])},{k:'type',n:Lx('Document type','نوع المستند'),a:Lx('نوع المستند','Type'),opts:['MAR','SAR','DAR','DAS'].map(k=>[k])},{k:'owner',n:Lx('Owner','المسؤول'),a:Lx('المسؤول','Owner'),mark:'av',opts:PEOPLE.map((p,i)=>[String(i),p[2],0,Lx(p[0],p[1])]).map(o=>{o[0]=o[0];return o}).map((o,i)=>{const r=[String(i),PEOPLE[i][2],0,Lx(PEOPLE[i][0],PEOPLE[i][1])];r.av=PEOPLE[i][0];return r})},{sep:1},{k:'zone',n:Lx('Zone','المنطقة'),a:Lx('المنطقة','Zone'),mark:'ic',opts:['A','B','C'].map(z=>[z,'ti-map',0,Lx('Zone ','المنطقة ')+z])},{k:'bldg',n:Lx('Building','المبنى'),a:Lx('المبنى','Building'),mark:'ic',opts:['1','2','3'].map(b=>[b,'ti-building',0,Lx('Building ','المبنى ')+b])},{k:'floor',n:Lx('Floor','الطابق'),a:Lx('الطابق','Floor'),mark:'ic',opts:['B2','B1','G','1','2','3','4','5','R'].map(f=>[f,'ti-stairs'])},{sep:1},{k:'created',n:Lx('Created date','تاريخ الإنشاء'),a:Lx('تاريخ الإنشاء','Created'),single:1,mark:'ic',opts:[['7','ti-calendar-event',0,Lx('Last 7 days','آخر 7 أيام')],['30','ti-calendar-event',0,Lx('Last 30 days','آخر 30 يومًا')],['60','ti-calendar-event',0,Lx('Last 60 days','آخر 60 يومًا')]]},{k:'days',n:Lx('Days in column','الأيام في العمود'),a:Lx('الأيام في العمود','Days'),single:1,mark:'days',opts:[['2','g___',0,Lx('2+ days','2+ أيام')],['3','y___',0,Lx('3+ days','3+ أيام')],['5','r___',0,Lx('5+ days','5+ أيام')],['8','rr__',0,Lx('8+ days','8+ أيام')],['12','rrr_',0,Lx('12+ days','12+ يومًا')],['20','rrrr',0,Lx('20+ days','20+ يومًا')]]}]}
const FEXTRA=()=>{const Lx=(e,a)=>S.lang==='ar'?a:e;return [{k:'code',n:Lx('Approval code','رمز الاعتماد'),a:Lx('رمز الاعتماد','Code'),opts:[['A',0,0,'Code A'],['B',0,0,'Code B'],['C',0,0,'Code C'],['D',0,0,'Code D'],['none',0,0,Lx('No code yet','بدون رمز')]]},{k:'rev',n:Lx('Revision','رقم المراجعة'),a:Lx('رقم المراجعة','Rev'),opts:['R0','R1','R2','R3'].map(r=>[r])}]};
const FSAVED={starred:['All Electrical MAR','Stuck 8+ days'],mine:['Rejected — this month','Zone A · Building 1','Pending approval · Civil']};
const FPRESET={'All Electrical MAR':{trade:['EL'],type:['MAR']},'Stuck 8+ days':{days:['8']},'Rejected — this month':{status:['rejected'],created:['30']},'Zone A · Building 1':{zone:['A'],bldg:['1']},'Pending approval · Civil':{status:['pending'],trade:['CV']}};
const fcount=()=>Object.values(V.fsel).filter(v=>v&&v.length).length;
function filtered(){const q=V.q.trim().toLowerCase();let list=rows.filter(r=>fmatch(r)&&(!V.mine||r.owner===2)&&(!q||[r.id,r.t[0],r.t[1],PEOPLE[r.owner][0],r.type,r.disc].join(' ').toLowerCase().includes(q)));
 const {id,dir}=V.sort;list.sort((a,b)=>{const x=sortKey(a,id),y=sortKey(b,id);return (x>y?1:x<y?-1:0)*dir});return list}
const vis=()=>V.cols.filter(c=>c.on).map(c=>c.id);
function head(){const cs=vis();return `<tr><th class="c-chk"><span class="ck${V.sel.size&&V.sel.size===filtered().length?' on':''}" data-act="selall">${V.sel.size?'<i class="ti ti-'+(V.sel.size===filtered().length?'check':'minus')+'"></i>':''}</span></th>${cs.map(id=>{const c=colDef(id);const on=V.sort.id===id;return `<th draggable="true" data-col="${id}" style="min-width:${c.w}px"><span class="hc"><i class="ti ti-grid-dots grip"></i>${L(c.en,c.ar)}<button class="srt${on?' on':''}" data-sort="${id}" title="${L('Sort','ترتيب')}"><i class="ti ${on?(V.sort.dir>0?'ti-sort-ascending':'ti-sort-descending'):'ti-arrows-sort'}"></i></button></span></th>`}).join('')}<th class="c-act"><button class="cb ter sm ic${V.settings?' on':''}" data-act="settings" title="${L('Table settings','إعدادات الجدول')}"><i class="ti ti-settings"></i></button></th></tr>`}
function rowHtml(r){const on=V.sel.has(r.id);return `<tr class="${on?'sel':''}"><td class="c-chk"><span class="ck${on?' on':''}" data-sel="${r.id}">${on?'<i class="ti ti-check"></i>':''}</span></td>${vis().map(id=>`<td>${cell(r,id)}</td>`).join('')}<td class="c-act"><button class="cb ter sm ic${V.menu==='row:'+r.id?' on':''}" data-rowmenu="${r.id}"><i class="ti ti-dots"></i></button></td></tr>`}
function rowMenu(){return `<div class="pop fixpop" id="rowpop" data-stop>${[['ti-eye','Open','فتح'],['ti-edit','Edit','تعديل'],['ti-copy','Duplicate','تكرار'],['ti-refresh','Resubmit','إعادة تقديم'],['ti-download','Download','تنزيل']].map(m=>`<button class="mi" data-act="noop"><i class="ti ${m[0]}"></i>${L(m[1],m[2])}</button>`).join('')}<div class="sep"></div><button class="mi" data-act="noop" style="color:var(--tone-red-fg)"><i class="ti ti-trash" style="color:inherit"></i>${L('Delete','حذف')}</button></div>`}
function body(){const list=filtered();const n=vis().length+2;
 if(!list.length)return `<tr class="empty-row"><td colspan="${n}">${L('No submittals match your search.','لا توجد تقديمات مطابقة.')}</td></tr>`;
 if(V.group){const g={};list.forEach(r=>{const k=V.group==='code'?(r.code?'Code '+r.code:L('No code','بدون رمز')):val(r,V.group);(g[k]=g[k]||[]).push(r)});
  return Object.entries(g).map(([k,rs])=>{const open=V.open[k]!==false;return `<tr class="grp${open?' open':''}" data-grp="${esc(k)}"><td colspan="${n}"><span class="gh"><i class="ti ti-chevron-right"></i><span class="doc" style="height:22px;font-size:11.5px">${esc(k)}</span><span class="gcnt">${rs.length} ${L('items','عنصر')}</span></span></td></tr>${open?rs.map(rowHtml).join(''):''}`}).join('')}
 const pages=Math.max(1,Math.ceil(list.length/V.per));V.page=Math.min(V.page,pages);return list.slice((V.page-1)*V.per,V.page*V.per).map(rowHtml).join('')}
function settings(){if(!V.settings)return '';return `<div class="colset" id="colset" data-stop><div class="hd"><i class="ti ti-settings"></i>${L('Columns','الأعمدة')}<small>${vis().length} / ${COLS.length} ${L('shown','معروض')}</small></div><div class="ls">${V.cols.map((c,i)=>{const d=colDef(c.id);return `<div class="it${d.lock?' lock':''}" draggable="true" data-ci="${i}"><i class="ti ti-grid-dots grip"></i>${L(d.en,d.ar)}${d.lock?'<i class="ti ti-lock"></i>':`<span class="swc${c.on?' on':''}" data-toggle="${c.id}"></span>`}</div>`}).join('')}</div><div class="ft"><button class="cb sm" data-act="reset">${L('Reset','إعادة ضبط')}</button><button class="cb pri sm" data-act="savedef"><i class="ti ti-check"></i>${L('Save as my default','حفظ كافتراضي')}</button></div></div>`}
function pager(){if(V.group)return `<div class="pg"><span>${filtered().length} ${L('submittals','تقديم')} · ${L('grouped by','مجمعة حسب')} <b>${L(colDef(V.group).en,colDef(V.group).ar)}</b></span></div>`;
 const total=filtered().length,pages=Math.max(1,Math.ceil(total/V.per));const nums=[];for(let p=1;p<=pages;p++)nums.push(p);
 const ch=S.lang==='ar'?['ti-chevrons-right','ti-chevron-right','ti-chevron-left','ti-chevrons-right flipx']:['ti-chevrons-right flipx','ti-chevron-left','ti-chevron-right','ti-chevrons-right'];
 return `<div class="pg"><span>${L('Rows per page','صفوف في الصفحة')}</span><select data-per>${[10,25,50].map(n=>`<option${n===V.per?' selected':''}>${n}</option>`).join('')}</select><span class="mid">${L(`Page ${V.page} of ${pages}`,`صفحة ${V.page} من ${pages}`)} · <span class="mut">${total} ${L('submittals','تقديم')}</span></span><span class="nav"><button class="cb sm" data-page="1"${V.page===1?' disabled':''}><i class="ti ${ch[0]}"></i></button><button class="cb sm" data-page="${V.page-1}"${V.page===1?' disabled':''}><i class="ti ${ch[1]}"></i></button>${nums.map(p=>`<button class="cb sm${p===V.page?' cur':''}" data-page="${p}">${p}</button>`).join('')}<button class="cb sm" data-page="${V.page+1}"${V.page===pages?' disabled':''}><i class="ti ${ch[2]}"></i></button><button class="cb sm" data-page="${pages}"${V.page===pages?' disabled':''}><i class="ti ${ch[3]}"></i></button></span></div>`}
function toolbar(mode){mode=mode||'list';const g=mode==='kanban'?V.kgroup:V.group;const GL=mode==='kanban'?['disc','owner','zone','type']:GROUPS;return `<div class="lv-bar">
 <button class="cb pri"><i class="ti ti-plus"></i>${L('Add Submittal','إضافة تقديم')}</button>
 <label class="fsrch"><i class="ti ti-search"></i><input id="lvq" placeholder="${L('Search this list','ابحث في القائمة')}" value="${esc(V.q)}"><kbd>/</kbd></label>
 <button class="cb${fcount()?' on':''}" data-fpop="lv"><i class="ti ti-filter"></i>${L('Filter','تصفية')}${fcount()?`<span class="fcnt">${fcount()}</span>`:''}<i class="ti ti-chevron-down"></i></button>
 <span class="tgl" data-act="mine"><span class="swc${V.mine?' on':''}"></span>${L('Need my action','بحاجة لإجرائي')}</span>
 <span class="sp"></span>
 <span class="rel"><button class="cb${g?' on':''}" data-menu="group"><i class="ti ti-category"></i>${g?L('Group: ','تجميع: ')+L(colDef(g).en,colDef(g).ar):L('Group','تجميع')}<i class="ti ti-chevron-down"></i></button>${V.menu==='group'?`<div class="pop end" data-stop><h6>${L('Group by','تجميع حسب')}</h6>${GL.map(id=>`<button class="mi${g===id?' on':''}" data-group="${id}">${L(colDef(id).en,colDef(id).ar)}${g===id?'<i class="ti ti-check ck"></i>':''}</button>`).join('')}${g?`<div class="sep"></div><button class="mi" data-group="">${L('Clear selection','مسح التحديد')}</button>`:''}</div>`:''}</span>
 <span class="split rel"><button class="cb" data-export="csv"><i class="ti ti-file-download"></i>${L('Export','تصدير')}</button><button class="cb" data-menu="export" aria-label="Export options"><i class="ti ti-chevron-down"></i></button>${V.menu==='export'?`<div class="pop end" data-stop><button class="mi" data-export="csv"><i class="ti ti-file-text"></i>CSV<small>.csv</small></button><button class="mi" data-export="xlsx"><i class="ti ti-table"></i>XLSX<small>Excel</small></button></div>`:''}</span>
 <span class="segv"><a href="submittals-kanban.html"><button class="${mode==='kanban'?'on':''}"><i class="ti ti-layout-grid"></i>${L('Kanban','كانبان')}</button></a><a href="submittals-list.html"><button class="${mode==='list'?'on':''}"><i class="ti ti-list"></i>${L('List','قائمة')}</button></a></span>
 </div>`}
function view(){return `${toolbar()}<div class="tw rel">${V.sel.size?`<div class="bulk">${V.sel.size} ${L('selected','محدد')}<span class="sp"></span><button class="cb sm" data-export="csv"><i class="ti ti-file-download"></i>${L('Export selected','تصدير المحدد')}</button><button class="cb sm ter" data-act="clearsel">${L('Clear','مسح')}</button></div>`:''}<div class="ts"><table class="lv"><thead>${head()}</thead><tbody>${body()}</tbody></table></div>${pager()}</div>${settings()}${V.menu&&V.menu.startsWith('row:')?rowMenu():''}${V.toast?`<div class="toast"><i class="ti ti-circle-check"></i>${V.toast}</div>`:''}`}
function exportData(kind){const cs=vis();const list=(V.sel.size?filtered().filter(r=>V.sel.has(r.id)):filtered());
 const hdr=cs.map(id=>L(colDef(id).en,colDef(id).ar));const data=list.map(r=>cs.map(id=>String(val(r,id))));
 let blob,name;
 if(kind==='csv'){const q=s=>'"'+s.replace(/"/g,'""')+'"';blob=new Blob(['\ufeff'+[hdr,...data].map(r=>r.map(q).join(',')).join('\n')],{type:'text/csv'});name='rabaed-submittals.csv'}
 else{const x=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Submittals"><Table>${[hdr,...data].map(r=>`<Row>${r.map(c=>`<Cell><Data ss:Type="String">${x(c)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`;blob=new Blob([xml],{type:'application/vnd.ms-excel'});name='rabaed-submittals.xls'}
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();
 flash(L(`Exported ${list.length} submittals (${kind.toUpperCase()})`,`تم تصدير ${list.length} تقديم (${kind.toUpperCase()})`))}
let tt;function flash(m){V.toast=m;window.LV.render();clearTimeout(tt);tt=setTimeout(()=>{V.toast=null;window.LV.render()},2200)}
const saveCols=()=>localStorage.setItem(KEY,JSON.stringify(V.cols));
function bind(root,render){
 window.LV.render=render;
 root.addEventListener('click',e=>{const b=e.target.closest('[data-sort],[data-act],[data-menu],[data-group],[data-export],[data-toggle],[data-sel],[data-grp],[data-page],[data-rowmenu]');
  if(!b){if((V.menu||V.settings)&&!e.target.closest('[data-stop]')){V.menu=null;V.settings=false;render()}return}
  const d=b.dataset;e.stopPropagation();
  if(d.sort){V.sort=V.sort.id===d.sort?{id:d.sort,dir:-V.sort.dir}:{id:d.sort,dir:1};return render()}
  if(d.menu){V.menu=V.menu===d.menu?null:d.menu;V.settings=false;return render()}
  if(d.rowmenu){V.menu=V.menu==='row:'+d.rowmenu?null:'row:'+d.rowmenu;V.settings=false;return render()}
  if(d.group!==undefined){if(window.LV.mode==='kanban')V.kgroup=d.group||null;else V.group=d.group||null;V.menu=null;V.open={};return render()}
  if(d.export){V.menu=null;return exportData(d.export)}
  if(d.toggle){const c=V.cols.find(c=>c.id===d.toggle);c.on=!c.on;saveCols();return render()}
  if(d.sel){V.sel.has(d.sel)?V.sel.delete(d.sel):V.sel.add(d.sel);return render()}
  if(d.grp!==undefined){V.open[d.grp]=V.open[d.grp]===false;return render()}
  if(d.page){V.page=+d.page;return render()}
  const a=d.act;
  if(a==='settings'){V.settings=!V.settings;V.menu=null;return render()}
  if(a==='mine'){V.mine=!V.mine;V.page=1;return render()}
  if(a==='selall'){const l=filtered();if(V.sel.size===l.length)V.sel.clear();else l.forEach(r=>V.sel.add(r.id));return render()}
  if(a==='clearsel'){V.sel.clear();return render()}
  if(a==='savedef'){localStorage.setItem(DEF,JSON.stringify(V.cols));V.settings=false;return flash(L('Saved as your default columns','تم الحفظ كأعمدة افتراضية'))}
  if(a==='reset'){V.cols=COLS.map(c=>({id:c.id,on:!c.off}));saveCols();return render()}
  if(a==='noop'){V.menu=null;return render()}
 });
 root.addEventListener('input',e=>{if(e.target.id==='lvq'){V.q=e.target.value;V.page=1;const p=e.target.selectionStart;render();const i=document.getElementById('lvq');i.focus();i.setSelectionRange(p,p)}});
 root.addEventListener('change',e=>{if(e.target.matches('[data-per]')){V.per=+e.target.value;V.page=1;render()}});
 // drag & drop — table headers and settings list
 let drag=null;
 root.addEventListener('dragstart',e=>{const th=e.target.closest('th[data-col]'),it=e.target.closest('.colset .it');if(th){drag={k:'col',id:th.dataset.col};th.classList.add('drag')}else if(it){drag={k:'set',i:+it.dataset.ci};it.classList.add('drag')}else return;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain','x')});
 root.addEventListener('dragover',e=>{if(!drag)return;const t=drag.k==='col'?e.target.closest('th[data-col]'):e.target.closest('.colset .it');if(!t)return;e.preventDefault();root.querySelectorAll('.over').forEach(x=>x.classList.remove('over'));t.classList.add('over')});
 root.addEventListener('drop',e=>{if(!drag)return;e.preventDefault();let from,to;
  if(drag.k==='col'){const t=e.target.closest('th[data-col]');if(!t)return;from=V.cols.findIndex(c=>c.id===drag.id);to=V.cols.findIndex(c=>c.id===t.dataset.col)}
  else{const t=e.target.closest('.colset .it');if(!t)return;from=drag.i;to=+t.dataset.ci}
  if(from!==to&&from>=0&&to>=0){const [m]=V.cols.splice(from,1);V.cols.splice(to,0,m);saveCols()}drag=null;render()});
 root.addEventListener('dragend',()=>{drag=null;root.querySelectorAll('.drag,.over').forEach(x=>x.classList.remove('drag','over'))});
 document.addEventListener('click',e=>{if((V.menu||V.settings)&&!root.contains(e.target)){V.menu=null;V.settings=false;render()}});
 document.addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement.tagName!=='INPUT'){e.preventDefault();const i=document.getElementById('lvq');i&&i.focus()}if(e.key==='Escape'&&(V.menu||V.settings)){V.menu=null;V.settings=false;render()}});
}
function place(){const W=innerWidth,H=innerHeight,rtl=document.documentElement.dir==='rtl';
 const cs=document.getElementById('colset'),g=document.querySelector('[data-act=settings]');
 if(cs&&g){const r=g.getBoundingClientRect();const top=Math.min(r.bottom+6,H-200);cs.style.top=top+'px';cs.style.maxHeight=(H-top-8)+'px';
  if(rtl){cs.style.left=Math.max(8,r.left)+'px';cs.style.right='auto'}else{cs.style.right=Math.max(8,W-r.right)+'px';cs.style.left='auto'}}
 const rp=document.getElementById('rowpop');if(rp&&V.menu){const b=document.querySelector('[data-rowmenu="'+V.menu.slice(4)+'"]');if(b){const r=b.getBoundingClientRect(),h=rp.offsetHeight;let top=r.bottom+4;if(top+h>H-8)top=Math.max(8,r.top-h-4);rp.style.top=top+'px';
  if(rtl){rp.style.left=r.left+'px';rp.style.right='auto'}else{rp.style.right=(W-r.right)+'px';rp.style.left='auto'}}}}
addEventListener('resize',place);addEventListener('scroll',()=>{if(V.menu&&V.menu.startsWith('row:')){V.menu=null;window.LV.rerender&&window.LV.rerender()}else place()},true);
document.addEventListener('click',e=>{const b=e.target.closest('[data-fpop="lv"]');if(!b)return;e.stopPropagation();if(FPop.isOpen()){FPop.close();return}const Lx=(en,ar)=>S.lang==='ar'?ar:en;FPop.open(b,{L:Lx,fields:fieldsDef(),extra:FEXTRA(),saved:FSAVED,preset:FPRESET,sel:JSON.parse(JSON.stringify(V.fsel)),onChange:(sel)=>{V.fsel=JSON.parse(JSON.stringify(sel));V.page=1;window.LV.render&&window.LV.render();const nb=document.querySelector('[data-fpop="lv"]');if(nb){FPop.btn=nb;FPop.place()}}})},true);
window.LV={V,view,bind,place,toolbar,rows,filtered,cell,val,ST,DISC,PEOPLE,CODE,dots,fmtD,exportData,flash,colDef,mode:'list'};
})();
