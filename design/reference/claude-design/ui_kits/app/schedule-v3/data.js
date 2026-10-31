// Schedule module v3 — seeded data (brief v2 · 05-sample-data). SVD.seed() / SVD.empty() return a fresh project state.
(function(){
const U={opm:['م. محمد السالم','Eng. Mohammed Al-Salem','own','pm'],ope:['م. ريم الزهراني','Eng. Reem Al-Zahrani','own','pe'],
 cpm:['م. خالد الحربي','Eng. Khalid Al-Harbi','cons','pm'],cpe:['م. سارة العتيبي','Eng. Sara Al-Otaibi','cons','pe'],
 spm:['م. عبدالله الشهري','Eng. Abdullah Al-Shehri','bin','pm'],spe:['م. ياسر القحطاني','Eng. Yasser Al-Qahtani','bin','pe'],
 mpm:['م. طارق العنزي','Eng. Tariq Al-Anazi','taq','pm'],mpe:['م. نادر حداد','Eng. Nader Haddad','taq','pe'],
 fpm:['م. فهد الدوسري','Eng. Fahad Al-Dosari','lam','pm'],fpe:['م. أحمد يوسف','Eng. Ahmed Youssef','lam','pe']};
const CO={own:[['شركة الريحان للتطوير العقاري','Al Rayhan Real Estate Development'],'owner'],cons:[['مكتب المعيار للاستشارات الهندسية','Al Meyar Engineering Consultants'],'cons'],
 bin:[['شركة البناء المتين للمقاولات','Al Mateen Building Contracting'],'ctr'],taq:[['شركة الطاقة الحديثة','Modern Energy Co.'],'ctr'],lam:[['مؤسسة اللمسة للتشطيب','Al Lamsa Finishing'],'ctr'],wah:[['مؤسسة الواحة للتنسيق الخارجي','Al Waha Landscaping'],'ctr']};
const DMS={disc:[['CV','أعمال مدنية','Civil'],['AR','أعمال معمارية','Architecture'],['EL','أعمال كهربائية','Electrical'],['ME','أعمال ميكانيكية','Mechanical'],['SU','أعمال المساحة','Surveying']],
 loc:{'Zone A':{'Building 1':['G','1','2','R'],'Building 2':['G']},'Zone B':{'Building 3':['G']},'Zone C':{}},floors:['B2','B1','G','1','2','3','4','5','R']};
const REASONS=[['ctr','مقاول','Contractor'],['own','مالك','Owner'],['cons','استشاري','Consultant'],['wx','طقس','Weather'],['fm','قوة قاهرة','Force majeure'],['oth','تأخر جدول آخر',"Other schedule's delay"],['co','أمر تغيير','Change order']];
// Residential finishes template: id, name, group, sub, disc, floor, dur, preds
const FL=[['G','الأرضي','Ground floor'],['F1','الأول','First floor'],['F2','الثاني','Second floor']];
const W=[['جدران','Walls','لياسة جدران','Wall plastering',20],['عزل','Waterproofing','عزل الحمامات','Bathroom waterproofing',8],['أرضيات','Flooring','بلاط أرضيات','Floor tiling',20],['دهانات','Painting','معجون ودهان أساس','Putty & primer',15],['أسقف','Ceilings','أسقف مستعارة','False ceilings',12],['نجارة','Joinery','تركيب الأبواب الداخلية','Interior doors',8]];
const PRED={'F-110':[],'F-120':['F-110'],'F-130':['F-120'],'F-140':['F-130'],'F-150':['F-140'],'F-160':['F-150'],'F-210':['F-110'],'F-220':['F-210'],'F-230':['F-220','F-130'],'F-240':['F-230','F-140'],'F-250':['F-240'],'F-260':['F-250'],'F-310':['F-210'],'F-320':['F-310'],'F-330':['F-320','F-230'],'F-340':['F-330','F-240'],'F-350':['F-340'],'F-360':['F-350']};
function tplFinishes(){const A=[];FL.forEach((f,i)=>W.forEach((w,j)=>{const id='F-'+(i+1)+(j+1)+'0';A.push({id,n:[w[2]+' — '+f[1],w[3]+' — '+f[2]],g:f[0],ws:[w[0],w[1]],disc:'AR',zone:'Zone A',bld:'Building 1',fl:['G','1','2'][i],dur:w[4],pred:PRED[id].map(p=>[p,0])})}));
 A.push({id:'F-700',n:['تكسية الواجهات بالحجر','Stone façade cladding'],g:'FAC',ws:null,disc:'AR',zone:'Zone A',bld:'Building 1',fl:null,dur:110,pred:[]},
 {id:'F-800',n:['الدهان النهائي — كل الأدوار','Final painting — all floors'],g:'CL',ws:null,disc:'AR',zone:'Zone A',bld:'Building 1',fl:null,dur:15,pred:[['F-160',0],['F-260',0],['F-360',0]]},
 {id:'F-850',n:['النظافة ومعالجة الملاحظات','Cleaning & snag closure'],g:'CL',ws:null,disc:'AR',zone:'Zone A',bld:'Building 1',fl:null,dur:8,pred:[['F-800',0],['F-700',0]]},
 {id:'F-900',n:['التسليم الابتدائي للتشطيبات','Finishes provisional handover'],g:'CL',ws:null,disc:null,zone:'Zone A',bld:'Building 1',fl:null,dur:0,ms:1,pred:[['F-850',0]]});
 return {groups:[{id:'G',n:['الأرضي','Ground floor']},{id:'F1',n:['الأول','First floor']},{id:'F2',n:['الثاني','Second floor']},{id:'FAC',n:['واجهات','Façades']},{id:'CL',n:['إنهاء','Close-out']}],acts:A}}
// MEP BL-0 (planned) + U-4 / U-5 progress
const MEPG=[{id:'GEN',n:['عام','General']},{id:'G',n:['الأرضي','Ground floor']},{id:'F1',n:['الأول','First floor']},{id:'UP',n:['الأدوار العليا','Upper floors']},{id:'CL',n:['إنهاء','Close-out']}];
const MEP=[
 ['M-010','تقديم واعتماد مخططات الورشة','Shop drawings submittal & approval','GEN',['تصميم','Design'],'EL',null,[],'2026-08-15','2026-09-03'],
 ['M-020','توريد مواسير التغذية والصرف','Supply & drainage pipe delivery','GEN',['توريد','Supply'],'ME',null,['M-010'],'2026-09-05','2026-09-21'],
 ['M-030','تمديدات الصرف تحت البلاط — الأرضي','Under-slab drainage — Ground','G',['صرف','Drainage'],'ME','G',['M-020'],'2026-09-22','2026-10-03'],
 ['M-040','مواسير الكهرباء في السقف — الأرضي','Ceiling conduits — Ground','G',['كهرباء','Electrical'],'EL','G',['M-010'],'2026-09-05','2026-09-17'],
 ['M-050','مواسير الكهرباء في السقف — الأول','Ceiling conduits — First','F1',['كهرباء','Electrical'],'EL','1',['M-040'],'2026-09-19','2026-10-01'],
 ['M-060','تمديدات التغذية الداخلية — الأرضي','Internal water supply — Ground','G',['تغذية','Water supply'],'ME','G',['M-030'],'2026-10-04','2026-10-17'],
 ['M-070','سحب الكابلات — الأرضي','Cable pulling — Ground','G',['كهرباء','Electrical'],'EL','G',['M-040'],'2026-09-19','2026-09-29'],
 ['M-080','مجاري هواء التكييف — الأرضي','HVAC ductwork — Ground','G',['تكييف','HVAC'],'ME','G',['M-010'],'2026-09-05','2026-09-21'],
 ['M-090','اختبار ضغط شبكة المياه — الأرضي','Water pressure test — Ground','G',['تغذية','Water supply'],'ME','G',['M-060'],'2026-10-18','2026-10-20'],
 ['M-500','تمديدات الأدوار العليا','Upper floors installations','UP',null,'ME',null,['M-050','M-090'],'2026-10-21','2027-01-24'],
 ['M-600','تركيب اللوحات والأجهزة','Panels & devices installation','CL',null,'EL',null,['M-500'],'2027-01-25','2027-03-01'],
 ['M-800','الاختبار والتشغيل','Testing & commissioning','CL',null,'ME',null,['M-600'],'2027-03-02','2027-03-18'],
 ['M-900','تسليم الأعمال الكهروميكانيكية','MEP handover','CL',null,null,null,['M-800'],'2027-03-20','2027-03-20']];
const U4={'M-010':{a:'2026-08-15',f:'2026-09-06'},'M-020':{a:'2026-09-05',p:50,xf:'2026-09-24'},'M-030':{xs:'2026-09-27',xf:'2026-10-06'},'M-040':{a:'2026-09-05',p:70,xf:'2026-09-20'},'M-080':{a:'2026-09-05',p:80,xf:'2026-09-23'},'M-900':{xs:'2027-03-23',xf:'2027-03-23'}};
const U5={'M-010':{a:'2026-08-15',f:'2026-09-06',r:'cons',rn:['من U-3','from U-3'],ev:'g'},'M-020':{a:'2026-09-05',p:85,xf:'2026-09-26',r:'ctr',rn:['تأخر المورّد','Supplier delay']},'M-030':{xs:'2026-09-28',xf:'2026-10-07',kn:'M-020'},'M-040':{a:'2026-09-05',f:'2026-09-20',ev:'g'},'M-050':{a:'2026-09-17',p:30,oos:1,ev:'r'},'M-080':{a:'2026-09-05',f:'2026-09-23',ev:'y'},'M-900':{xs:'2027-03-24',xf:'2027-03-24'}};
// Structure (From P6) — extract of the file (486 activities) that the platform shows
const ST_ACTS=[['A1310','صب سقف الدور الثاني','Second floor slab pour','2026-09-20','2026-10-04','2026-10-07',1],['A1320','فك شدات الدور الثاني','Second floor formwork stripping','2026-10-05','2026-10-18','2026-10-21',1],['A1400','مباني البلوك — الدور الثاني','Blockwork — second floor','2026-10-19','2026-11-05','2026-11-08',1],['A1040','عزل الأساسات','Foundation waterproofing','2026-05-02','2026-05-20',null,0],['A2210','حفر أساسات الملحق','Annex foundation excavation','2026-06-10','2026-07-08',null,0]];
const XER={file:'Structure_U15.xer',size:'412 KB',acts:486,rels:612,dd:'2026-09-24',end:'2027-02-09',matched:481,added:3,missing:['A1040','A2210'],q:[['np',4],['ns',2],['neg',1],['con',7],['ssff',38]],
 shifted:[['A1310',3,'ctr',['تأخر توريد الحديد','Rebar delivery delay']],['A1320',3,null,'A1310'],['A1400',3,null,'A1320']]};
const tm=(d,t)=>d+'T'+t;
function log(ev,by,d,t,note){return {ev,by,at:tm(d,t),note:note||null}}
function mepAct(r){return {id:r[0],n:[r[1],r[2]],g:r[3],ws:r[4],disc:r[5],zone:'Zone A',bld:'Building 1',fl:r[6],pred:r[7].map(p=>[p,0]),ps:r[8],pe:r[9],ms:r[0]==='M-900'?1:0}}
function seed(){
 const P={id:'rhn',n:['مجمع الريحان السكني','Al Rayhan Residential Compound'],today:'2026-09-27',dd:'2026-09-24',cal:{off:[5],hol:[['2026-09-23','اليوم الوطني','National Day'],['2027-02-22','يوم التأسيس','Founding Day']]},seq:{},
  schedules:[
  {id:'st',n:['الهيكل الإنشائي','Structural works'],planned:{s:'2026-03-01',e:'2026-12-31',ok:true,hist:[]},ctr:'bin',contract:{s:'2026-03-01',e:'2027-01-15'},assigned:'2026-02-20',cycle:'f',resp:{bl:14,up:7},ack:false,sil:false,mode:'p6',due:null,
   cur:{act:55,pl:62,fe:'2027-02-06'},nextDue:'2026-09-24',trend:[['U-9','2026-07-02','2027-01-18'],['U-10','2026-07-16','2027-01-22'],['U-11','2026-07-30','2027-01-25'],['U-12','2026-08-13','2027-01-29'],['U-13','2026-08-27','2027-02-02'],['U-14','2026-09-10','2027-02-06']],
   versions:[{id:'BL-0',type:'bl',ext:'acc',rel:'2026-03-01',dec:'2026-03-10',log:[log('rel','spm','2026-03-01','10:05'),log('dec','cpm','2026-03-10','13:40','acc')],cm:[]},
    ...Array.from({length:14},(_,i)=>{const dd=new Date(Date.UTC(2026,2,12+14*i)).toISOString().slice(0,10);const dec=i===13?'2026-09-17':null;return {id:'U-'+(i+1),type:'up',ext:'acc',dd,rel:dd,dec:dec||dd,fe:i>=8?[,'2027-01-18','2027-01-22','2027-01-25','2027-01-29','2027-02-02','2027-02-06'][i-7]:null,log:i===13?[log('rel','spm','2026-09-10','16:30'),log('dec','cpm','2026-09-17','11:10','acc')]:[],cm:[]}})],acts:ST_ACTS.map(r=>({id:r[0],n:[r[1],r[2]],g:'P6',ws:null,disc:'CV',zone:'Zone A',bld:r[0]==='A2210'?'Building 2':'Building 1',fl:r[0]==='A1040'||r[0]==='A2210'?'G':'2',ps:r[3],pe:r[4],crit:r[6],pred:[]})),groups:[{id:'P6',n:['من ملف P6','From the P6 file']}]},
  {id:'me',n:['الأعمال الكهروميكانيكية','MEP works'],planned:{s:'2026-08-01',e:'2027-02-28',ok:true,hist:[]},ctr:'taq',contract:{s:'2026-08-15',e:'2027-03-20'},assigned:'2026-08-01',cycle:'w',resp:{bl:14,up:7},ack:false,sil:false,mode:'rab',due:null,
   cur:{act:12,pl:16,fe:'2027-03-24'},trend:[['U-1','2026-08-27','2027-03-20'],['U-2','2026-09-03','2027-03-20'],['U-3','2026-09-10','2027-03-23'],['U-4','2026-09-17','2027-03-23'],['U-5','2026-09-24','2027-03-24']],
   groups:MEPG,base:MEP.map(mepAct),
   versions:[{id:'BL-0',type:'bl',ext:'acc',rel:'2026-08-10',dec:'2026-08-20',log:[log('rel','mpm','2026-08-10','09:30'),log('dec','cpm','2026-08-20','14:15','acc')],cm:[]},
    {id:'U-1',type:'up',ext:'acc',dd:'2026-08-27',rel:'2026-08-27',dec:'2026-08-30',log:[],cm:[],fe:'2027-03-20'},{id:'U-2',type:'up',ext:'acc',dd:'2026-09-03',rel:'2026-09-03',dec:'2026-09-06',log:[],cm:[],fe:'2027-03-20'},{id:'U-3',type:'up',ext:'acc',dd:'2026-09-10',rel:'2026-09-10',dec:'2026-09-13',log:[],cm:[],fe:'2027-03-23'},
    {id:'U-4',type:'up',ext:'acc',dd:'2026-09-17',rel:'2026-09-17',dec:'2026-09-20',prog:U4,fe:'2027-03-23',act:10,pl:13,log:[log('rel','mpm','2026-09-17','15:20'),log('dec','cpm','2026-09-20','10:45','acc')],cm:[]},
    {id:'U-5',type:'up',ext:'review',dd:'2026-09-24',rel:'2026-09-24',prog:U5,fe:'2027-03-24',act:12,pl:16,rs:[['cons',3],['ctr',1]],int:{h:'cpe'},log:[log('rel','mpm','2026-09-24','16:05')],cm:[]}]},
  {id:'fi',n:['التشطيبات الداخلية','Interior finishes'],planned:{s:'2026-10-01',e:'2027-03-31',ok:true,hist:[]},ctr:'lam',contract:{s:'2026-11-01',e:'2027-04-30'},assigned:'2026-09-10',cycle:'w',resp:{bl:14,up:7},ack:false,sil:false,mode:null,due:'2026-10-08',versions:[],groups:[],acts:[]},
  {id:'ex',n:['الأعمال الخارجية والتنسيق','External works & landscaping'],planned:{s:'2026-09-01',e:'2027-04-30',ok:true,hist:[]},ctr:null,contract:null,cycle:null,resp:{bl:14,up:7},ack:false,sil:false,mode:null,versions:[],groups:[],acts:[]}]};
 P.schedules.forEach(s=>s.planned.hist=[{s:s.planned.s,e:s.planned.e,by:'ope',at:'2026-02-15T11:00',ok:'opm'}]);
 return P}
function empty(){const P=seed();P.id='new';P.n=['مشروع جديد','New project'];P.schedules=[];return P}
window.SVD={U,CO,DMS,REASONS,tplFinishes,XER,MEP,U4,U5,seed,empty,
 top5:[[['صب سقف الدور الثاني','Second floor slab pour'],'st',9,'ctr',['تأخر توريد الحديد','Rebar delivery delay']],[['حفر أساسات الملحق','Annex foundation excavation'],'st',6,'own',['تعارض مع خدمات قائمة','Clash with existing utilities']],[['تركيب الدعامات الحديدية','Steel shoring installation'],'st',4,'ctr',['نقص عمالة','Labour shortage']],[['تقديم واعتماد مخططات الورشة','Shop drawings submittal & approval'],'me',3,'cons',['رد متأخر','Late response']],[['عزل الأساسات','Foundation waterproofing'],'st',2,'wx',['عاصفة غبارية','Dust storm']]],
 reasons:[['ctr',14],['own',6],['cons',4],['wx',2]],
 seedCm:{fi:{'F-700':['مدة تكسية الواجهات 110 أيام، أرجو تأكيد عدد الفرق.','Façade cladding is 110 days — please confirm the number of crews.',false]},me:{'M-050':['بدأ تمديد مواسير سقف الأول قبل انتهاء سقف الأرضي، ولا يوجد طلب فحص. أرجو التوضيح.','First-floor ceiling conduits started before the ground floor finished, with no inspection request. Please clarify.',false],'M-020':['المورّد نفسه متأخر في مشروع آخر لدينا. نتابع قبل الرد.','The same supplier is late on another of our projects. Following up before we reply.',true]}},
 tour:[['own','opm','أسند «الأعمال الخارجية» لمؤسسة الواحة: 15 أكتوبر 2026 – 30 أبريل 2027، تحديث أسبوعي','Assign External works to Al Waha: 15 Oct 2026 – 30 Apr 2027, weekly'],
  ['bl','fpe','ابنِ جدول التشطيبات من القالب، وغيّر مدة F-110 إلى 24 يوماً، ثم أرسله لمدير المشروع','Build Finishes from the template, set F-110 to 24 days, send to your PM'],
  ['bl','fpm','أطلق BL-0 للاستشاري — أو جرّب «إرجاع للمهندس» بملاحظة','Release BL-0 — or try Return to engineer with a note'],
  ['bl','cpe','راجع BL-0 وعلّق على F-700، ثم مرّر لمدير المشروع','Review BL-0, comment on F-700, pass to your PM'],
  ['bl','cpm','اقبل BL-0','Accept BL-0'],
  ['up','cpe','راجع U-5 بـ«ما تغيّر فقط»، أضف التعليقين على M-050 وM-020، ثم مرّر','Review U-5 with Changed only, comment on M-050 and M-020, pass'],
  ['up','cpm','أبقِ تعليق M-020 مخفياً، واختر «قبول بملاحظات»','Keep the M-020 comment hidden, Accept with comments'],
  ['p6','spe','ارفع Structure_U15.xer، أعد إسناد A1040 وA2210، ثم أرسل لمدير المشروع','Upload Structure_U15.xer, reassign A1040 and A2210, send to your PM'],
  ['p6','spm','أطلق U-15','Release U-15'],
  ['up','mpe','من الجوال ابدأ U-6: M-020 انتهى 26 سبتمبر · M-070 بدأ اليوم 40% · M-050 60% (مع السبب)','On mobile start U-6: M-020 finished 26 Sep · M-070 started today 40% · M-050 60% (with reason)'],
  ['own','opm','اقرأ اللوحة، وشغّل «الخط الافتراضي» ومنحنى S','Read the dashboard, turn on Planned line and the S-curve']]};
})();
