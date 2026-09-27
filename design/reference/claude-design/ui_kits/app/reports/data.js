// Reports — data. Exposes window.RD.
(function(){
const TPL={
 daily:{g:'daily',ic:'ti-calendar',tone:'tomato',en:'Daily Site Report',ar:'تقرير الموقع اليومي',d:['Manpower, equipment, work done and site issues — every working day.','العمالة والمعدات والأعمال المنجزة ومشكلات الموقع — كل يوم عمل.'],code:'DSR'},
 hseD:{g:'daily',ic:'ti-alert-triangle',tone:'amber',en:'Daily Safety Walk',ar:'جولة السلامة اليومية',d:['Quick PPE and housekeeping check.','فحص سريع لمعدات الوقاية والنظافة.'],code:'DSW'},
 weekly:{g:'weekly',ic:'ti-chart-bar',tone:'blue',en:'Weekly Progress Report',ar:'تقرير التقدم الأسبوعي',d:['Built from the week’s daily reports, with charts for management.','يُبنى من التقارير اليومية للأسبوع مع رسوم بيانية للإدارة.'],code:'WPR'},
 hse:{g:'weekly',ic:'ti-shield',tone:'green',en:'Weekly Safety (HSE)',ar:'السلامة الأسبوعية',d:['Checklist inspection with photos; failed items raise snags.','فحص بقائمة تحقق مع صور؛ البنود الراسبة تنشئ ملاحظات.'],code:'HSE'},
 qa:{g:'weekly',ic:'ti-clipboard-check',tone:'violet',en:'Quality Control',ar:'ضبط الجودة',d:['Quality checks, tests and non-conformances.','فحوصات الجودة والاختبارات وحالات عدم المطابقة.'],code:'QCR'},
 monthly:{g:'monthly',ic:'ti-report',tone:'cyan',en:'Monthly Report',ar:'التقرير الشهري',d:['Month summary for the client.','ملخص الشهر للعميل.'],code:'MR'},
 env:{g:'monthly',ic:'ti-world',tone:'green',en:'Environmental',ar:'البيئة',d:['Waste, dust and noise monitoring.','مراقبة النفايات والغبار والضوضاء.'],code:'ENV'}};
const GROUPS=[['daily','Daily','يومي'],['weekly','Weekly','أسبوعي'],['monthly','Monthly','شهري']];
const ST={draft:['Draft','مسودة','gray'],review:['Manager review','مراجعة المدير','blue'],submitted:['Submitted','مُقدَّم','violet'],returned:['Returned','مُعاد','orange'],affirmed:['Affirmed','مُعتمد','green'],missing:['Missing','مفقود','red'],off:['Not a working day','ليس يوم عمل','gray']};
const SORD=['draft','review','returned','submitted','affirmed'];
// Aug 2025 (1 Aug = Friday). Working days Sun–Thu.
const days=[];const stFor={6:'missing',12:'returned',27:'submitted',28:'review',31:'draft'};
for(let d=1;d<=31;d++){const dow=new Date(2025,7,d).getDay();const off=dow===5||dow===6;days.push({d,dow,st:off?'off':d>28&&d!==31?'none':stFor[d]||'affirmed'})}
days[30].st='off';
const MP=[['Masons','بنّاؤون'],['Electricians','كهربائيون'],['Helpers','مساعدون'],['Steel fixers','حدّادون']];
let n=190;const reps=[];days.forEach(x=>{if(['off','missing','none'].includes(x.st))return;n++;const k=x.d;reps.push({id:'r'+k,tpl:'daily',no:'TWR-TMC-DSR-'+String(n).padStart(4,'0'),d:k,st:x.st,by:'Hafiz Hamdan',wk:x.st==='affirmed'?0:x.st==='returned'?2:1,mp:[10+k%4,14+k%6,22+k%5,3+k%3],eq:[[['Tower crane','رافعة برجية'],1,8+k%3],[['Concrete pump','مضخة خرسانة'],k%3?1:0,k%3?4:0],[['Excavator','حفارة'],1,6]],temp:42+k%4,w:k%5===0?'dust':'sun',lost:k%5===0?1.5:0,inc:0,iss:k===7?[['Concrete truck delayed 2 h','تأخر شاحنة الخرسانة ساعتين']]:[]})});
const r7=reps.find(r=>r.d===7);Object.assign(r7,{no:'TWR-TMC-DSR-0217',mp:[12,18,25,4],temp:44,w:'dust',lost:1.5,work:[['Floor 07 slab pour — 40 m³','صب بلاطة الطابق ٠٧ — 40 م³'],['Floor 05 first-fix electrical','التمديدات الكهربائية الأولى — الطابق ٠٥']]});
const W1={id:'w1',tpl:'weekly',no:'TWR-TMC-WPR-0031',wk:1,st:'draft',range:[3,7],by:'Ali Sonour'};
const HSE1={id:'h1',tpl:'hse',no:'TWR-TMC-HSE-0012',st:'submitted',d:7,by:'Khalid Al Dhaheri',wk:1,pass:42,fail:3};
const PPL={hafiz:['Hafiz Hamdan','حافظ حمدان','Site Engineer · TMC','#e98b45'],ali:['Ali Sonour','علي سنور','Contractor PM · TMC','#3d6db5'],shamsi:['Mohammed Al Shamsi','محمد الشامسي','Consultant Manager · DCL','#b5455a'],ahmed:['Ahmed bin Said','أحمد بن سعيد','Consultant Engineer · DCL','#1fae66']};
window.RD={TPL,GROUPS,ST,SORD,days,reps,W1,HSE1,MP,PPL};
})();
