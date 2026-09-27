// Floor View — sample data: Dubai Marina Tower – Phase 2 · Zone A – North Wing · Tower 1. Exposes window.FD.
(function(){
const ST={
 done:{en:'Complete',ar:'مكتمل',ic:'ti-check',c:'var(--tone-green-solid)',t:'var(--tone-green-tint)',f:'var(--tone-green-fg)',den:'Every visible inspection at this space has passed.',dar:'اجتازت جميع الفحوصات المرئية في هذه المساحة.'},
 prog:{en:'In Progress',ar:'قيد التنفيذ',ic:'ti-refresh',c:'var(--tone-blue-solid)',t:'var(--tone-blue-tint)',f:'var(--tone-blue-fg)',den:'Open inspections or submittals, no open issues.',dar:'فحوصات أو تقديمات مفتوحة، دون مشكلات مفتوحة.'},
 iss:{en:'Issues',ar:'مشكلات',ic:'ti-alert-triangle',c:'var(--tone-red-solid)',t:'var(--tone-red-tint)',f:'var(--tone-red-fg)',den:'An open snag or a failed inspection.',dar:'ملاحظة مفتوحة أو فحص راسب.'},
 pend:{en:'Pending',ar:'لم يبدأ',ic:'ti-hourglass-high',c:'var(--tone-gray-solid)',t:'var(--tone-gray-tint)',f:'var(--tone-gray-fg)',den:'Nothing started that you can see.',dar:'لم يبدأ أي عمل مرئي لك.'}
};
const ORDER=['done','prog','iss','pend'];
const TR={EL:['Electrical','كهرباء','cyan'],CV:['Civil','مدني','amber'],ME:['Mechanical','ميكانيكا','green'],PL:['Plumbing','سباكة','blue'],AR:['Finishes','تشطيبات','violet'],FS:['Firestopping','عزل الحريق','orange']};
const CO={afc:['Al Futtaim Construction','الفطيم للمقاولات','#f8552f'],dry:['Gulf Dryliners','الخليج للألواح الجافة','#7a5af0'],mep:['ALEC MEP','ألك للأعمال الكهروميكانيكية','#1fae66'],fire:['FireSafe Systems','فاير سيف للأنظمة','#e98b45']};
const TY={insp:['Inspections','الفحوصات'],snag:['Snags','الملاحظات'],sub:['Submittals','التقديمات']};
const STAGE={str:['Structure','الهيكل'],mep:['MEP rough-in','التمديدات'],fin:['Finishes','التشطيبات']};
const STG={CV:'str',EL:'mep',ME:'mep',PL:'mep',FS:'mep',AR:'fin'};
const ROLES={admin:{en:'Project Admin',ar:'مسؤول المشروع',sub:['All companies','جميع الشركات']},dry:{en:'Contractor · Gulf Dryliners',ar:'مقاول · الخليج للألواح الجافة',sub:['Own work only','أعمال الشركة فقط'],co:'dry'},mep:{en:'Contractor · ALEC MEP',ar:'مقاول · ألك',sub:['Own work only','أعمال الشركة فقط'],co:'mep'}};
const SP={apt:['Apartments','الشقق'],cor:['Corridor','الممر'],r1:['Riser 01','الرايزر ٠١'],r2:['Riser 02','الرايزر ٠٢'],lob:['Lift lobby','بهو المصاعد'],bath:['Bathrooms','الحمامات'],stair:['Stair core','بيت الدرج'],plant:['Plant room','غرفة المعدات'],roofw:['Roof waterproofing','عزل السطح'],lmr:['Lift machine room','غرفة محركات المصاعد'],retail:['Retail units','المحلات'],glob:['Main lobby','البهو الرئيسي'],load:['Loading bay','منطقة التحميل'],sec:['Security room','غرفة الأمن'],subst:['Substation','المحطة الفرعية'],park:['Car park','المواقف'],pump:['Pump room','غرفة المضخات'],tank:['Tank room','غرفة الخزانات'],spr:['Sprinkler valve room','غرفة صمامات الرش']};
// issue texts
const IS={
 i07:{t:['Deficient and possibly inaccessible','معيب وقد يتعذر الوصول إليه'],d:['Cable tray in Riser 01 is under-supported and boxed in behind the shaft wall — access for testing is blocked.','حامل الكابلات في الرايزر ٠١ غير مدعوم بشكل كافٍ ومغلق خلف جدار المنور — الوصول للاختبار متعذر.'],p:'high'},
 i06:{t:['Leakage detected','تم رصد تسرب'],d:['Pressure test on the bathroom stack dropped 0.4 bar in 2 h. Joint at the Level 06 branch is weeping.','انخفض اختبار الضغط لخط الحمامات 0.4 بار خلال ساعتين. تسرب عند وصلة فرع الطابق ٠٦.'],p:'high'},
 i01:{t:['Ceiling Plasterboard – Rework Needed','ألواح الجبس في السقف – تتطلب إعادة عمل'],d:['Joints cracked along the corridor run; boards fixed at 600 mm centres instead of 400 mm.','تشققات في الوصلات على طول الممر؛ الألواح مثبتة على مسافة 600 مم بدلًا من 400 مم.'],p:'med'},
 i02:{t:['SVP Firestopping – Potential Rework','عزل حريق أنبوب الصرف الرأسي – قد يتطلب إعادة عمل'],d:['Intumescent collar at the SVP penetration looks undersized for a 110 mm pipe. Awaiting manufacturer data.','طوق العزل عند اختراق أنبوب الصرف يبدو أصغر من المطلوب لأنبوب 110 مم. بانتظار بيانات المصنّع.'],p:'med'},
 i03:{t:['Cable tray support spacing exceeds spec','تباعد دعامات حامل الكابلات يتجاوز المواصفة'],d:['Supports measured at 1.8 m; spec allows 1.2 m max. Inspection failed.','الدعامات على مسافة 1.8 م؛ الحد الأقصى في المواصفة 1.2 م. رسب الفحص.'],p:'med'},
 iG:{t:['Earthing test results missing','نتائج اختبار التأريض مفقودة'],d:['Substation earth pit readings not uploaded; energisation date at risk.','قراءات حفرة التأريض للمحطة الفرعية لم تُرفع؛ موعد التشغيل معرّض للتأخير.'],p:'low'},
 r04:{t:['Fire damper access panel missing','لوحة الوصول لمخمد الحريق مفقودة'],d:['Access panel installed and signed off.','تم تركيب لوحة الوصول واعتمادها.'],p:'med'},
 r06:{t:['Ceiling void not cleaned','فراغ السقف غير نظيف'],d:['Void cleaned and re-inspected.','تم تنظيف الفراغ وإعادة فحصه.'],p:'low'}
};
// item code: TRADE:type:result:company[:issueKey][:week]
const FL=[
 {id:'rf',en:'Roof',ar:'السطح',lv:'RF',sp:{plant:['ME:insp:open:mep'],roofw:['CV:insp:passed:afc'],lmr:[]}},
 {id:'08',en:'Floor 08',ar:'الطابق ٠٨',lv:'L08',sp:{apt:['AR:sub:open:dry'],cor:['EL:insp:passed:mep'],r1:['FS:insp:open:fire::33'],lob:[]}},
 {id:'07',en:'Floor 07',ar:'الطابق ٠٧',lv:'L07',sp:{apt:['AR:insp:passed:dry'],cor:['ME:sub:open:mep'],r1:['EL:snag:open:mep:i07']}},
 {id:'06',en:'Floor 06',ar:'الطابق ٠٦',lv:'L06',sp:{apt:['AR:insp:passed:dry','EL:insp:passed:mep'],cor:['CV:insp:passed:afc','AR:snag:closed:dry:r06'],r2:['PL:insp:open:mep'],bath:['PL:snag:open:mep:i06']}},
 {id:'05',en:'Floor 05',ar:'الطابق ٠٥',lv:'L05',sp:{apt:['AR:insp:passed:dry'],cor:['EL:insp:open:mep'],r1:[]}},
 {id:'04',en:'Floor 04',ar:'الطابق ٠٤',lv:'L04',sp:{apt:['AR:insp:passed:dry','EL:insp:passed:mep'],cor:['CV:insp:passed:afc'],r1:['FS:insp:passed:fire','FS:snag:closed:fire:r04'],lob:['AR:sub:open:dry']}},
 {id:'03',en:'Floor 03',ar:'الطابق ٠٣',lv:'L03',sp:{apt:['EL:insp:failed:mep:i03'],cor:['AR:insp:passed:dry'],r1:['ME:insp:open:mep']}},
 {id:'02',en:'Floor 02',ar:'الطابق ٠٢',lv:'L02',sp:{apt:['AR:insp:passed:dry'],cor:['EL:insp:passed:mep'],r1:['FS:snag:open:fire:i02'],stair:['CV:insp:passed:afc']}},
 {id:'01',en:'Floor 01',ar:'الطابق ٠١',lv:'L01',sp:{apt:['AR:insp:passed:dry'],cor:['AR:snag:open:dry:i01'],r1:['EL:insp:passed:mep'],retail:['ME:sub:open:mep']}},
 {id:'gf',en:'Ground Floor',ar:'الطابق الأرضي',lv:'GF',sp:{glob:['AR:insp:open:dry'],retail:['EL:insp:passed:mep'],load:['CV:insp:passed:afc'],sec:[],subst:['EL:snag:open:mep:iG']}},
 {id:'b1',en:'Basement 1',ar:'القبو ١',lv:'B1',below:1,sp:{park:['CV:insp:passed:afc'],pump:['PL:insp:open:mep'],tank:['PL:insp:passed:mep'],spr:['FS:insp:open:fire']}}
];
let n=0;
FL.forEach(f=>{f.spaces=Object.entries(f.sp).map(([k,arr])=>({k,items:arr.map(code=>{const [tr,type,res,co,ik,wk]=code.split(':');n++;return {tr,type,res,co,stage:STG[tr],wk:+wk||(28+n%5),is:ik||null,age:2+(n*5)%16}})}))});
const BLD=[{id:'t1',en:'Tower 1',ar:'البرج ١',z:'a'},{id:'t2',en:'Tower 2',ar:'البرج ٢',z:'a',empty:1},{id:'pd',en:'Podium',ar:'المنصة',z:'a',off:1},{id:'t3',en:'Tower 3',ar:'البرج ٣',z:'b',off:1}];
const ZN={a:['Zone A – North Wing','المنطقة أ – الجناح الشمالي'],b:['Zone B – South Wing','المنطقة ب – الجناح الجنوبي']};
window.FD={ST,ORDER,TR,CO,TY,STAGE,ROLES,SP,IS,FL,BLD,ZN};
})();
