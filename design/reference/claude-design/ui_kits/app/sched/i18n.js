// Schedule module — English layer. Translates rendered text (exact phrase first, then word-bounded fragments, longest first).
(function(){
const RAW=`مجمع الريحان السكني|Al Rayhan Residential Compound
شركة الريحان للتطوير العقاري|Al Rayhan Real Estate Development Co.
مكتب المعيار للاستشارات الهندسية|Al Meyar Engineering Consultants
شركة البناء المتين للمقاولات|Al Mateen Building Contracting Co.
شركة الطاقة الحديثة|Modern Energy Co.
مؤسسة اللمسة للتشطيب|Al Lamsa Finishing Est.
مؤسسة الواحة للتنسيق الخارجي|Al Waha Landscaping Est.
م. محمد السالم|Eng. Mohammed Al-Salem
م. ريم الزهراني|Eng. Reem Al-Zahrani
م. خالد الحربي|Eng. Khalid Al-Harbi
م. سارة العتيبي|Eng. Sara Al-Otaibi
م. عبدالله الشهري|Eng. Abdullah Al-Shehri
م. ياسر القحطاني|Eng. Yasser Al-Qahtani
م. طارق العنزي|Eng. Tariq Al-Anazi
م. نادر حداد|Eng. Nader Haddad
م. فهد الدوسري|Eng. Fahad Al-Dosari
م. أحمد يوسف|Eng. Ahmed Youssef
م. محمد|Eng. Mohammed
م. خالد|Eng. Khalid
م. سارة|Eng. Sara
م. عبدالله|Eng. Abdullah
م. ياسر|Eng. Yasser
م. طارق|Eng. Tariq
م. نادر|Eng. Nader
م. فهد|Eng. Fahad
م. أحمد|Eng. Ahmed
مدير مشروع المالك|Owner Project Manager
مهندسة مشروع المالك|Owner Project Engineer
مدير مشروع الاستشاري|Consultant Project Manager
مهندسة مشروع الاستشاري|Consultant Project Engineer
مدير مشروع المقاول|Contractor Project Manager
مهندس مشروع المقاول|Contractor Project Engineer
مقاول الهيكل|Structure contractor
مقاول الكهروميكانيكية|MEP contractor
مقاول التشطيبات|Finishing contractor
الهيكل الإنشائي|Structural Works
الأعمال الكهروميكانيكية|MEP Works
التشطيبات الداخلية|Interior Finishing
الأعمال الخارجية والتنسيق|External Works & Landscaping
الأعمال الخارجية|External works
الكهروميكانيكية|MEP
التشطيبات|Finishing
الهيكل|Structure
اليوم الوطني|National Day
يوم التأسيس|Founding Day
أعمال مدنية|Civil
أعمال معمارية|Architectural
أعمال كهربائية|Electrical
أعمال ميكانيكية|Mechanical
أعمال المساحة|Survey
نصف شهرية|Bi-weekly
أسبوعية|Weekly
لياسة جدران|Wall plastering
عزل الحمامات|Bathroom waterproofing
بلاط أرضيات|Floor tiling
معجون ودهان أساس|Putty & primer
أسقف مستعارة|False ceilings
تركيب الأبواب الداخلية|Interior doors
تكسية الواجهات بالحجر|Stone façade cladding
الدهان النهائي — كل الأدوار|Final painting — all floors
النظافة ومعالجة الملاحظات|Cleaning & snag closure
التسليم الابتدائي للتشطيبات|Finishing provisional handover
تقديم واعتماد مخططات الورشة|Shop drawing submittal & approval
توريد مواسير التغذية والصرف|Supply & drainage pipe delivery
تمديدات الصرف تحت البلاط|Under-slab drainage
مواسير الكهرباء في السقف|Ceiling electrical conduits
تمديدات التغذية الداخلية|Internal water supply
سحب الكابلات|Cable pulling
مجاري هواء التكييف|HVAC ductwork
اختبار ضغط شبكة المياه|Water network pressure test
تمديدات الأدوار العليا|Upper floors installations
تركيب اللوحات والأجهزة|Panels & devices installation
الاختبار والتشغيل|Testing & commissioning
تسليم الأعمال الكهروميكانيكية|MEP handover
صب سقف الدور الثاني|Second floor slab pour
فك شدات الدور الثاني|Second floor formwork stripping
مباني البلوك — الدور الثاني|Blockwork — second floor
حفر أساسات الملحق|Annex foundation excavation
تركيب الدعامات الحديدية|Steel shoring installation
عزل الأساسات|Foundation waterproofing
الأدوار العليا|Upper floors
الأرضي|Ground
الأول|First
الثاني|Second
جدران|Walls
عزل|Waterproofing
أرضيات|Flooring
دهانات|Painting
أسقف|Ceilings
نجارة|Joinery
واجهات|Façades
إنهاء|Close-out
عام|General
تصميم|Design
توريد|Supply
صرف|Drainage
كهرباء|Electrical
تغذية|Water supply
تكييف|HVAC
تأخر المورّد|supplier delay
تأخر توريد الحديد|rebar delivery delay
تعارض مع خدمات قائمة|clash with existing utilities
نقص عمالة|labour shortage
رد متأخر|late response
عاصفة غبارية|dust storm
مدة تكسية الواجهات 110 أيام، أرجو تأكيد عدد الفرق.|Façade cladding is 110 days — please confirm the number of crews.
بدأ تمديد مواسير سقف الأول قبل انتهاء سقف الأرضي، ولا يوجد طلب فحص. أرجو التوضيح.|First-floor ceiling conduits started before the ground floor finished, with no inspection request. Please clarify.
المورّد نفسه متأخر في مشروع آخر لدينا. نتابع قبل الرد.|The same supplier is late on another of our projects. Following up before we reply.
أسند الأعمال الخارجية لمؤسسة الواحة للتنسيق الخارجي: تعاقدي 15 أكتوبر 2026 – 30 أبريل 2027، تحديث أسبوعي|Assign External Works to Al Waha Landscaping: contractual 15 Oct 2026 – 30 Apr 2027, weekly updates
ابنِ جدول التشطيبات من القالب، وعدّل مدة F-110 إلى 24 يوماً، ثم أرسله لمدير المشروع|Build the finishing schedule from the template, change F-110 to 24 days, then send it to the PM
أطلق BL-0 للاستشاري — أو جرّب «إرجاع للمهندس» بملاحظة|Launch BL-0 to the consultant — or try "Return to engineer" with a note
راجع BL-0 وعلّق على F-700، ثم مرّر لمدير المشروع|Review BL-0, comment on F-700, then pass to the PM
اقبل BL-0|Accept BL-0
راجع U-5 للكهروميكانيكية بفلتر «ما تغيّر فقط»، أضف التعليقين، ثم مرّر|Review MEP U-5 with "Changed only", add the two comments, then pass
أبقِ التعليق الثاني مخفياً، واختر «قبول بملاحظات»|Keep the second comment hidden and choose "Accept with notes"
ارفع Structure_U15.xer، وأعد إسناد A1040 وA2210، ثم أرسل لمدير المشروع|Upload Structure_U15.xer, reassign A1040 and A2210, then send to the PM
أطلق U-15|Launch U-15
ابدأ مسودة U-6 من الجوال: M-020 انتهى 26 سبتمبر · M-070 بدأ 22 سبتمبر 40% · M-050 60%|Start the U-6 draft on mobile: M-020 finished 26 Sep · M-070 started 22 Sep 40% · M-050 60%
اقرأ اللوحة وشغّل «إظهار الخط الافتراضي»|Read the dashboard and turn on "Show planned line"
الإعداد|Setup
خط الأساس|Baseline
المراجعة والقرار|Review & decision
التحديث الدوري|Periodic update
المتابعة|Monitoring
يناير|Jan
فبراير|Feb
مارس|Mar
أبريل|Apr
مايو|May
يونيو|Jun
يوليو|Jul
أغسطس|Aug
سبتمبر|Sep
أكتوبر|Oct
نوفمبر|Nov
ديسمبر|Dec
ينا|Jan
فبر|Feb
مار|Mar
أبر|Apr
ماي|May
يون|Jun
يول|Jul
أغس|Aug
سبت|Sep
أكت|Oct
نوف|Nov
ديس|Dec
الأحد|Sunday
الخميس|Thursday
الجمعة عطلة|Friday off
الجمعة|Friday
السبت إلى الخميس|Saturday to Thursday
يوم واحد|1 day
يومان|2 days
يوم عمل|working days
يوماً|days
أيام|days
يوم|day
نشاطاً|activities
أنشطة|activities
نشاط|activity
إلغاء|Cancel
تأكيد|Confirm
تعرض الآن كـ|Now viewing as
التبديل إلى|Switch to
الأيام|Days
الأسابيع|Weeks
الأشهر|Months
الأرباع|Quarters
أسابيع|Weeks
أشهر|Months
أرباع|Quarters
التخصص|Discipline
المنطقة|Zone
المبنى|Building
الطابق|Floor
لا شيء للتراجع|Nothing to undo
التجميع حسب|Group by
توسيع الكل|Expand all
طيّ الكل|Collapse all
الروابط|Links
لوحة النشاط|Activity panel
استعادة ترتيب الأعمدة الافتراضي|Restore default column order
استُعيد ترتيب الأعمدة الافتراضي|Default column order restored
حُفظ ترتيب الأعمدة لك فقط — لا يتغيّر ما يراه غيرك|Column order saved for you only — others are unaffected
اسحب لإعادة ترتيب الأعمدة|Drag to reorder columns
اسحب لتغيير العرض|Drag to resize
اسحب لإعادة الترتيب|Drag to reorder
اسحب إلى نشاط آخر لإنشاء علاقة FS|Drag to another activity to create an FS link
اختر نشاطاً من الجدول أو الغانت.|Pick an activity in the table or Gantt.
تنقّل|Navigate
تحرير|Edit
العمود التالي|Next column
تراجع|Undo
إعادة|Redo
نشاط جديد|New activity
حذف|Delete
الجدول في وضع القراءة|The schedule is read-only
المدة والتواريخ المخططة مقفلة في وضع التحديث|Planned duration and dates are locked in update mode
هذه الخلية لا تُحرَّر|This cell is not editable
أُعيد ترتيب الصف — المنطق والتواريخ لم تتغيّر|Row moved — logic and dates unchanged
أُنشئت علاقة|Created link
FS بلا lag|FS, no lag
إسناد العقد|Assign contract
عرض على اللوحة|View on dashboard
لم يُسند|Unassigned
من P6|From P6
داخل ربائد|In Rabaed
العقود على الزمن|Contracts over time
الافتراضي|Planned
التعاقدي|Contractual
غير موقّع|Unsigned
تاريخ البيانات|Data date
المخطط الافتراضي|Planning baseline
إضافة عقد|Add contract
اسم العقد|Contract name
البداية الافتراضية|Planned start
النهاية الافتراضية|Planned finish
يُحفظ المخطط نسخةً مؤرَّخة تُقارَن بها التواريخ التعاقدية لاحقاً. لا يراه المقاولون.|The plan is saved as a dated version to compare contractual dates against. Contractors don't see it.
إضافة العقد|Add contract
شركة المقاول|Contractor
اختر من شركات المشروع|Choose from project companies
البداية التعاقدية|Contractual start
النهاية التعاقدية|Contractual finish
الفارق عن النهاية الافتراضية:|Gap to planned finish:
دورة التحديث|Update cycle
مدة ردّ الاستشاري لكل نوع تقديم|Consultant response time per submission type
تحديث تقدّم|Progress update
تحديث التقدّم|Progress update
إقرار المالك على قرارات الاستشاري|Owner endorsement of consultant decisions
حين يُفعَّل لا يصير قرار الاستشاري نافذاً حتى يُقرّه مدير مشروع المالك.|When on, a consultant decision takes effect only after the Owner PM endorses it.
الصمت قبول|Silence means acceptance
إن مرّت مدة الرد بلا قرار يُعدّ التقديم مقبولاً. مطفأ افتراضياً.|If the response time passes without a decision, the submission is accepted. Off by default.
عقود|contracts
المالك:|Owner:
المالك|Owner
الاستشاري|Consultant
تقويم المشروع: أيام العمل والعطل|Project calendar: working days & holidays
قراءة فقط|Read only
عقود المشروع|Project contracts
الفارق = النهاية التعاقدية مقابل الافتراضية|Gap = contractual finish vs planned
العقد|Contract
الفارق|Gap
النمط|Mode
الحالة|Status
أدخل اسم العقد|Enter the contract name
أُضيف العقد إلى المخطط الافتراضي|Contract added to the planning baseline
أُسند العقد — مساحة الجدول فُتحت للمقاول|Contract assigned — schedule workspace opened for the contractor
تعديل التاريخ الافتراضي|Edit planned dates
حفظ التعديل|Save
سيُحفظ التاريخ السابق في السجل.|The previous date is kept in the log.
حُدّث التاريخ الافتراضي وحُفظ السابق في السجل|Planned date updated; previous kept in the log
تقويم المشروع|Project calendar
إغلاق|Close
أيام العمل|Working days
6 أيام — السبت إلى الخميس|6 days — Saturday to Thursday
العطلة الأسبوعية|Weekly day off
العطل|Holidays
العقود «داخل ربائد» ترث هذا التقويم، ويضيف المقاول عطله الخاصة داخل BL-0 فيراجعها الاستشاري.|"In Rabaed" contracts inherit this calendar; contractors add their own holidays inside BL-0 for the consultant to review.
تاريخ غير مفهوم — اكتب مثل 7/12|Unrecognised date — type e.g. 7/12
تاريخ غير مفهوم — اكتب مثل 26/9|Unrecognised date — type e.g. 26/9
تاريخ غير مفهوم|Unrecognised date
الرقم|ID
جديد|New
النشاط|Activity
الاسم مطلوب|Name is required
المدة|Duration
معلم|Milestone
البداية|Start
النهاية|Finish
السابق|Predecessor
اكتب أرقام أنشطة موجودة مثل F-110, F-130+2|Type existing IDs, e.g. F-110, F-130+2
العلاقة تُنشئ حلقة|This link creates a loop
نشاط مفتوح|Open end
WBS مطلوب|WBS is required
حرج|Critical
الاسم|Name
معرّفات المشروع (من الـDMS)|Project identifiers (from DMS)
القيم من إعدادات المشروع في الـDMS. المعرّفات تُعدَّل في أي مسودة.|Values come from project settings in the DMS. Identifiers can be edited in any draft.
المدة (أيام عمل)|Duration (working days)
البداية → النهاية|Start → Finish
قيد «لا يبدأ قبل»|"Start no earlier than"
لا يبدأ قبل|Start no earlier than
إزالة القيد|Remove constraint
السوابق|Predecessors
نشاط مفتوح — بلا سابق|Open start — no predecessor
+ إضافة سابق|+ Add predecessor
اللواحق|Successors
ملاحظة|Note
المدة رقم موجب|Duration must be positive
المدة رقم من 1 إلى 999|Duration must be 1–999
العلاقة موجودة|Link already exists
استبدال الجدول|Replace schedule
متاح في مسودة BL-0 فقط|BL-0 draft only
حذف النشاط|Delete activity
سيُحذف|Will delete
من مسودة BL-0.|from the BL-0 draft.
سيُربط|will link to
بالسابق التالي|the next predecessor
ويصبح نشاطاً مفتوحاً|and becomes open-ended
حُذف|Deleted
— Ctrl+Z للتراجع|— Ctrl+Z to undo
ابدأ من قالب|Start from template
تشطيبات مبنى سكني · مكتبة النظام|Residential finishing · system library
استيراد إكسل|Import Excel
قالب ربائد|Rabaed template
نسخ من مشروع سابق|Copy from past project
جدول سابق لنفس الشركة|A previous schedule of your company
إدخال يدوي|Manual entry
ابدأ بجدول فارغ|Start with a blank schedule
ابدأ جدول عقد التشطيبات|Start the finishing contract schedule
اختر مصدراً. تُحسب التواريخ من بداية العقد|Pick a source. Dates are computed from contract start
بتقويم المشروع. مصادر البداية تظهر هنا فقط، ما دام الجدول فارغاً.|on the project calendar. Start sources appear only while the schedule is empty.
خط أساس معتمد · BL-0|Approved baseline · BL-0
خط أساس|Baseline
مُرجَع|Returned
تم التقديم — قيد المراجعة|Submitted — under review
أُعيد للتعديل — عند م. أحمد يوسف|Returned for edits — with Eng. Ahmed Youssef
أُعيد للتعديل — عند م. نادر حداد|Returned for edits — with Eng. Nader Haddad
أُعيد للتعديل — عند م. أحمد|Returned for edits — with Eng. Ahmed
مسودة داخلية — عند م. فهد|Internal draft — with Eng. Fahad
مسودة داخلية — عند م. أحمد|Internal draft — with Eng. Ahmed
مسودة داخلية — عند م. طارق|Internal draft — with Eng. Tariq
مسودة داخلية — عند م. نادر|Internal draft — with Eng. Nader
مسودة داخلية — محفوظة|Internal draft — saved
مسودة داخلية · مطلوب قبل|Internal draft · due before
مسودة داخلية|Internal draft
وضع التخطيط|Planning mode
وضع القراءة|Read mode
وضع التحديث|Update mode
التعاقدي:|Contractual:
BL-0 مطلوب قبل|BL-0 due before
تقويم المشروع · الجمعة عطلة|Project calendar · Friday off
أعاده م. فهد الدوسري للتعديل ·|Returned for edits by Eng. Fahad Al-Dosari ·
أعاده م. طارق العنزي للتعديل|Returned for edits by Eng. Tariq Al-Anazi
المسودة|The draft is
عند م. فهد الدوسري لمراجعتها|with Eng. Fahad Al-Dosari for review
— تعرضها للقراءة فقط.|— you're viewing it read-only.
نهاية الجدول تتجاوز النهاية التعاقدية بـ|Schedule finish exceeds the contractual finish by
. تحذير ولا يمنع الإطلاق.|. A warning — it doesn't block launch.
أطلقه م. فهد الدوسري ·|Launched by Eng. Fahad Al-Dosari ·
أطلقه م. طارق العنزي ·|Launched by Eng. Tariq Al-Anazi ·
بدء تحديث|Start update
طلب تعديل خط الأساس|Baseline revision request
عرض من جهة الاستشاري — م. سارة|View as consultant — Eng. Sara
أرسله م. أحمد يوسف|Sent by Eng. Ahmed Youssef
إرجاع للمهندس|Return to engineer
إطلاق كخط أساس BL-0|Launch as baseline BL-0
لم يُرسل إليك بعد|Not sent to you yet
أُرسل لمدير المشروع|Sent to the PM
إرسال لمدير المشروع|Send to PM
نهاية الجدول:|Schedule finish:
مطابقة للتعاقدي|matches contractual
مطابق للتعاقدي|Matches contractual
بعد التعاقدي بـ|after contractual by
قبل التعاقدي بـ|before contractual by
نشاطاً · المسار الحرج|activities · critical path
المسار الحرج|Critical path
استُورد ملف الإكسل — 22 نشاطاً|Excel imported — 22 activities
نُسخ الجدول — 22 نشاطاً|Schedule copied — 22 activities
امتلأ الجدول من القالب — 22 نشاطاً، التواريخ محسوبة بمحرّك ربائد|Filled from template — 22 activities, dates computed by the Rabaed engine
أُزيل القيد — عاد|Constraint removed —
لتاريخه المحسوب|is back to its computed date
استبدال|Replace
ستُحذف كل أنشطة المسودة ويعود الجدول فارغاً لتختار مصدراً جديداً. لا يمكن التراجع.|All draft activities will be deleted and the schedule emptied so you can pick a new source. This can't be undone.
الجدول فارغ — اختر مصدراً|Schedule is empty — pick a source
أُرسل الجدول لمدير المشروع م. فهد الدوسري|Schedule sent to PM Eng. Fahad Al-Dosari
إرجاع|Return
تعود المسودة قابلة للتحرير عند م. أحمد يوسف. الاستشاري لا يرى أي تغيير.|The draft becomes editable again for Eng. Ahmed Youssef. The consultant sees no change.
تعود المسودة قابلة للتحرير عند م. نادر حداد. الاستشاري لا يرى أي تغيير.|The draft becomes editable again for Eng. Nader Haddad. The consultant sees no change.
إلزامية|required
الملاحظة إلزامية|A note is required
ما المطلوب تعديله؟|What needs changing?
إطلاق|Launch
سيصل الاستشاري تقديم خط أساس BL-0 بنهاية|The consultant receives baseline BL-0 finishing on
. بعد الإطلاق يتحوّل الجدول إلى وضع القراءة، ولا يُعدَّل إلا بطلب تعديل خط الأساس.|. After launch the schedule turns read-only and changes only via a baseline revision request.
تُؤخذ لقطة ثابتة من الجدول ويُسجَّل مَن أطلق ومتى.|A fixed snapshot is taken and who launched it, and when, is logged.
تبدأ مسودة تحديث تقدّم — الأعمدة المخططة تُقفل|Starts a progress update draft — planned columns lock
تبدأ مسودة طلب تعديل خط الأساس — التغييرات تُميَّز|Starts a baseline revision draft — changes are highlighted
منتهٍ|Done
جارٍ|In progress
لم يبدأ|Not started
متوقع|expected
سيُحفظ عند الاتصال|Saves when online
حُدّث|Updated
· ويب|· web
بانتظار التحديث|Awaiting update
انزاحت النهاية بلا سبب تأخير|Finish slipped with no delay reason
تاريخ آخر|Other date
اختر تاريخاً|Pick a date
المخطط:|Planned:
بدأ اليوم|Started today
انتهى اليوم|Finished today
بدأ|Started
انتهى|Finished
البداية الفعلية|Actual start
النهاية الفعلية|Actual finish
يقترح اليوم|Suggests today
. أي تاريخ آخر بين|. Any other date between
— لا مستقبل.|— no future dates.
نسبة الإنجاز|Progress
المدة المتبقية (أيام)|Remaining (days)
النهاية المتوقعة للعقد|Contract forecast finish
النهاية المتوقعة:|Forecast finish:
النهاية المتوقعة|Forecast finish
سبب التأخير|Delay reason
إلزامي — النهاية انزاحت|required — finish slipped
إلزامي|required
النهاية انزاحت عن|Finish slipped from
— اختر السبب|— pick a reason
ربط طلب فحص|Link inspection request
(اختياري)|(optional)
بلا ربط|No link
طلب فحص […]|Inspection request […]
اختر سبب التأخير للحفظ|Pick a delay reason to save
حفظ|Save
التحديث من الجوال|Mobile update
مسودة U-6|U-6 draft
دورة التحديث:|Update cycle:
لا توجد مسودة تحديث مفتوحة|No open update draft
لا توجد مسودة تحديث|No update draft
ابدأ مسودة U-6 بتاريخ بيانات|Start U-6 with data date
بدء مسودة U-6|Start U-6 draft
أنشطة الفترة ·|period activities ·
حُدّثت ·|updated ·
متبقية|remaining
أنشطة الفترة|Period activities
كل الأنشطة|All activities
أُرسل|Sent
جوال مهندس الموقع|Site engineer's phone
ما تحفظه هنا يظهر فوراً في شاشة التحديث على الويب بمصدره «حُدّث من الجوال».|What you save here shows instantly on the web update screen as "Updated from mobile".
فتح المسودة على الويب|Open draft on web
أُرسل لمدير المشروع م. طارق العنزي|Sent to PM Eng. Tariq Al-Anazi
معاينة 390 × 844|Preview 390 × 844
تحديث U-6|U-6 update
· تاريخ البيانات|· data date
شبكة ضعيفة — التعديلات تُحفظ عند الاتصال|Weak network — edits save when online
الرئيسية|Home
الجدول|Schedule
التقديمات|Submissions
التنبيهات|Alerts
بدأت مسودة U-6 — مسودة داخلية لا يراها الاستشاري|U-6 draft started — internal, the consultant can't see it
حُفظت التعديلات المعلّقة|Pending edits saved
المسودة عند مدير المشروع — للقراءة فقط|Draft is with the PM — read only
حُفظ — يظهر على الويب «حُدّث من الجوال»|Saved — shows on web as "Updated from mobile"
لا يُقبل تاريخ فعلي بعد تاريخ البيانات أو في المستقبل (حتى|Actual dates can't be after the data date or in the future (up to
التاريخ الفعلي يقع بعد تاريخ البيانات السابق (|Actual dates must be after the previous data date (
فأحدث)|or later)
بداية مخططة|Planned start
نهاية مخططة|Planned finish
بداية فعلية|Actual start
نهاية فعلية|Actual finish
النسبة %|Progress %
النسبة|Progress
أدخل البداية الفعلية أولاً|Enter the actual start first
المتبقية (أيام)|Remaining (days)
المتبقية|Remaining
رقم صفر أو أكبر|Zero or more
نهاية متوقعة|Forecast finish
مطلوب|Required
المصدر|Source
حُدّث من|Updated from
الجوال|mobile
الويب|web
المخطط (BL-0) — مقفل في وضع التحديث|Planned (BL-0) — locked in update mode
الفعلي · تاريخ البيانات|Actual · data date
التواريخ الفعلية بين|Actual dates between
— لا مستقبل. النهاية الفعلية تجعل النسبة 100% والمتبقية صفراً.|— no future dates. An actual finish sets 100% and zero remaining.
U-6 تم التقديم — قيد المراجعة|U-6 submitted — under review
· تحديث التقدّم|· Progress update
تاريخ البيانات:|Data date:
آخر تقديم:|Last submission:
مقبول بملاحظات|Accepted with notes
قيد المراجعة|Under review
الجدول معتمد وفي وضع القراءة. ابدأ مسودة U-6 بتاريخ بيانات|The schedule is approved and read-only. Start U-6 with data date
— من هنا أو من الجوال، فكلاهما يكتب في المسودة نفسها.|— here or on mobile; both write to the same draft.
فتح على الجوال|Open on mobile
عند م. طارق العنزي|with Eng. Tariq Al-Anazi
عند م. نادر حداد|with Eng. Nader Haddad
عند م. أحمد يوسف|with Eng. Ahmed Youssef
إطلاق U-6|Launch U-6
بلا سبب تأخير|without a delay reason
الأعمدة المخططة مقفلة|Planned columns locked
بدأت مسودة U-6 · تاريخ البيانات|U-6 draft started · data date
طلب تعديل خط الأساس يفتح الجدول في وضع التخطيط|A baseline revision opens the schedule in planning mode
سيصل الاستشاري تحديث التقدّم U-6 بتاريخ بيانات|The consultant receives progress update U-6 with data date
طلب واحد معلّق من كل نوع — بانتظار قرار الاستشاري على U-5|One pending request per type — awaiting the consultant's decision on U-5
سبب التأخير إلزامي عند انزياح النهاية:|Delay reason is required when the finish slips:
الرفع|Upload
ملخص الاستيراد|Import summary
المراجعة الداخلية والإطلاق|Internal review & launch
تعذّر قراءة الملف|Couldn't read the file
ترميز الملف غير مقروء. صدّر XER من P6 مرة أخرى بترميز UTF-8 ثم أعد المحاولة.|File encoding is unreadable. Re-export the XER from P6 as UTF-8 and try again.
إعادة المحاولة|Try again
· جاهز للتحليل|· ready to analyse
اسحب ملف XER أو إكسل هنا|Drop an XER or Excel file here
أو اضغط للاختيار من جهازك|or click to choose from your device
تنزيل قالب الإكسل|Download Excel template
(نموذج) ملف بترميز غير مقروء|(sample) unreadable file
نوع التقديم|Submission type
يُقارَن بآخر تحديث مقبول وبخط الأساس النشط|Compared with the last accepted update and the active baseline
يحتاج سبباً إلزامياً ويعتمده الاستشاري|Needs a reason; approved by the consultant
سبب التعديل|Revision reason
سطر يشرح السبب […]|A line explaining the reason […]
فُكّ الرابط|Unlinked
أُعيد الإسناد إلى […]|Reassigned to […]
اختر النشاط البديل|Choose replacement activity
إعادة الإسناد|Reassign
فكّ الرابط|Unlink
علاقة|links
تاريخ البيانات في الملف|Data date in file
نهاية الجدول — بعد التعاقدي بـ|Schedule finish — after contractual by
عن U-14|vs U-14
المطابقة برقم النشاط|Matching by activity ID
مُطابَق|matched
جديدة|new
اختفت|missing
رقمان اختفيا من الملف:|Two IDs disappeared from the file:
مرتبطان بتعليقات أو أدلة؛ أعد الإسناد أو فكّ الرابط قبل الإطلاق.|Linked to comments or evidence; reassign or unlink before launch.
فحص جودة الشبكة|Network quality check
بلا سابق|No predecessor
بلا لاحق|No successor
لاقات سالبة|Negative lags
قيود|Constraints
علاقات SS/FF|SS/FF links
علاقات SS/FF والقيود تُعرض كما في الملف ولا تُحسب. التواريخ والعائم والمسار الحرج من الملف كما هي.|SS/FF links and constraints are shown as in the file, not recalculated. Dates, float and critical path come from the file.
الأنشطة التي انزاحت عن التحديث السابق|Activities that shifted since the last update
النهاية السابقة|Previous finish
الجديدة|New
الفرق|Diff
رابط دليل|Evidence link
تبعاً — بلا سبب مستقل|Knock-on — no own reason
اختر السبب|Choose reason
ربط|Link
أسباب التأخير وروابط الأدلة طبقة داخل ربائد لا يحملها الملف، وتبقى مربوطة برقم النشاط عبر الرفعات.|Delay reasons and evidence links are a Rabaed layer the file doesn't carry; they stay tied to activity IDs across uploads.
الإطلاق معطّل:|Launch disabled:
بلا إسناد.|not reassigned.
التحديث U-15|Update U-15
في وارد الاستشاري|in the consultant's inbox
أطلقه|Launched by
· قُدّم متأخراً|· submitted late by
· مدة الرد|· response time
تبدأ من الإطلاق.|starts at launch.
آخر تحديث مقبول:|Last accepted update:
U-15 مستحق|U-15 due
— متأخر|— late by
النهاية التعاقدية:|Contractual finish:
النهاية التعاقدية|Contractual finish
تحليل الملف|Analyse file
متابعة|Continue
رجوع|Back
حفظ كمسودة داخلية|Save as internal draft
التبديل إلى مدير المشروع|Switch to the PM
الإطلاق لمدير مشروع المقاول|Launch is for the contractor PM
أعد إسناد|Reassign
أولاً|first
سبب التأخير إلزامي على كل نشاط منزاح|A delay reason is required on every shifted activity
إطلاق طلب التعديل|Launch revision request
إطلاق التحديث U-15|Launch update U-15
أُرسل لمدير المشروع — المسودة داخلية|Sent to the PM — the draft stays internal
نُزّل قالب الإكسل|Excel template downloaded
حُفظ كمسودة داخلية — لا يراه أحد خارج الشركة|Saved as internal draft — no one outside the company sees it
إطلاق طلب تعديل خط الأساس|Launch baseline revision request
سيصل الاستشاري|The consultant receives
تحديث التقدّم U-15|progress update U-15
بتاريخ بيانات|with data date
، ويُبلَّغ المالك بحالة «قيد المراجعة».|, and the owner is notified it's "Under review".
تُؤخذ لقطة ثابتة من الملف ولا تُعدَّل بعد الإطلاق.|A fixed snapshot of the file is taken and can't change after launch.
أعد الإسناد أو فكّ الرابط|Reassign or unlink
أعد إسناد الرقمين أولاً|Reassign both IDs first
مخفي عن المقاول|Hidden from contractor
منشور عند الإطلاق|Published on launch
إخفاء عن المقاول|Hide from contractor
لا تعليقات على هذا النشاط.|No comments on this activity.
إضافة تعليق|Add comment
اكتب تعليقاً على|Write a comment on
النهاية في U-14|Finish in U-14
في U-15|In U-15
السبب|Reason
مخطط BL-0|Planned BL-0
في U-4|In U-4
في U-5|In U-5
سبب المقاول|Contractor reason
دليل|Evidence
خارج التسلسل|Out of sequence
أنشطة بلا تغيير — أطفئ «ما تغيّر فقط» لعرضها|unchanged activities — turn off "Changed only" to show them
نشاطاً آخر في الملف — […]|more activities in the file — […]
تعليقات|Comments
التقديم|Submission
المتغيّر|Variance
بداية العقد|contract start
نهاية الملف|File finish
عن التعاقدي ·|vs contractual ·
عن التعاقدي|vs contractual
عن التعاقدية|vs contractual
الإنجاز|Progress
فعلي / مخطط|actual / planned
نهاية الجدول في الملف|Schedule finish in file
المطابقة|Matching
اختفت (|missing (
) · أُعيد إسنادها|) · reassigned
جودة الشبكة|Network quality
الملف|File
الشبكة|Network
النهاية المقدَّمة|Submitted finish
تغيّرت منذ U-4|Changed since U-4
تغيّرت|changed
فعلي|Actual
مخطط|Planned
بلا دليل معتمد|No approved evidence
أسباب التأخير المعلنة (تراكمي)|Declared delay reasons (cumulative)
فحص مقدّم لم يُعتمد ·|inspection submitted, not approved ·
فحص مقدّم لم يُعتمد|Inspection submitted, not approved
بلا طلب فحص — إرشادية لا تمنع القرار|no inspection request — guidance only, doesn't block the decision
بلا طلب فحص|No inspection request
فحص معتمد|Inspection approved
تقرير المراجعة الآلي|Automated review report
مقبول|Accepted
ما يراه المقاول — م. أحمد|What the contractor sees — Eng. Ahmed
ما يراه المقاول — م. ياسر|What the contractor sees — Eng. Yasser
ما يراه المقاول — م. نادر|What the contractor sees — Eng. Nader
أُطلق القرار:|Decision launched:
· وصل المقاول|· contractor received
تعليق منشور|published comment
تعليقان منشوران|2 published comments
تعليقات منشورة|published comments
لوحة المالك — م. محمد|Owner dashboard — Eng. Mohammed
مُرِّر إلى م. خالد الحربي — الحالة الخارجية ما زالت «قيد المراجعة».|Passed to Eng. Khalid Al-Harbi — external status is still "Under review".
مراجعة داخلية — المقاول لا يرى التعليقات حتى يُطلق مدير المشروع القرار.|Internal review — the contractor sees no comments until the PM launches the decision.
تمرير لمدير المشروع|Pass to PM
المراجعة الداخلية|The internal review is
أُعيدت إلى|returned to
م. سارة العتيبي — لم تُمرَّر إليك بعد.|Eng. Sara Al-Otaibi — not passed to you yet.
سيصل المقاول|The contractor will receive
تعليق واحد مخفي|1 hidden comment
مخفية|hidden
إرجاع لـ م. سارة العتيبي|Return to Eng. Sara Al-Otaibi
إرجاع لـ م. سارة|Return to Eng. Sara
إرجاع للمقاول|Return to contractor
قبول بملاحظات|Accept with notes
قبول|Accept
لم يصل هذا التقديم بعد —|This submission hasn't arrived yet —
م. فهد الدوسري لم يُطلق BL-0.|Eng. Fahad Al-Dosari hasn't launched BL-0.
م. عبدالله الشهري لم يُطلق U-15.|Eng. Abdullah Al-Shehri hasn't launched U-15.
أُعيد — عند م. سارة|Returned — with Eng. Sara
أُعيد — عند م. نادر|Returned — with Eng. Nader
مراجعة داخلية — عند|Internal review — with
مراجعة داخلية —|Internal review —
مدة الرد:|Response time:
مدة الرد|Response time
أيام متبقية من|days left of
يوماً متبقية من|days left of
مقارنةً بـ:|Compared with:
· أول تقديم لخط الأساس|· first baseline submission
التحديث المقبول|Accepted update
خط الأساس النشط|Active baseline
(بيانات|(data
(اعتُمد|(approved
أعادها م. خالد الحربي لك|Returned to you by Eng. Khalid Al-Harbi
— التعليقات ما زالت مسودات لم تُنشر.|— comments are still unpublished drafts.
أنشطة انزاحت|activities shifted
أنشطة تغيّرت|activities changed
أنشطة خط الأساس|Baseline activities
الأنشطة|Activities
ما تغيّر فقط|Changed only
جدول + زمني|Table + timeline
جدول|Table
عقد «من P6»: لا تعديل داخل المنصة — التعديل بإعادة رفع الملف فقط.|"From P6" contract: no edits in the platform — change it by re-uploading the file.
مُرِّر لمدير المشروع م. خالد الحربي — الحالة الخارجية لم تتغيّر|Passed to PM Eng. Khalid Al-Harbi — external status unchanged
تعود المراجعة إلى م. سارة. التعليقات تبقى مسودات، والمقاول لا يرى أي تغيير، وعدّاد مدة الرد مستمر.|The review goes back to Eng. Sara. Comments stay drafts, the contractor sees no change, and the response clock keeps running.
أُعيدت المراجعة إلى م. سارة|Review returned to Eng. Sara
إطلاق القرار|Launch decision
سيُطلق القرار للمقاول والمالك، وتُنشر التعليقات غير المخفية. القرار نهائي على هذا التقديم.|The decision goes to the contractor and owner, and unhidden comments are published. It's final for this submission.
أُطلق القرار|Decision launched
بلا خط أساس بعد|without a baseline yet
بلا خط أساس|No baseline
الفعلي / المخطط|Actual / planned
الفعلي|Actual
المتوقع|Forecast
الفارق · المتوقعة|Gap · forecast
متأخر عن موعده|Overdue
غير مكتمل:|Incomplete:
عقدان|2 contracts
بلا جدول معتمد (|without an approved schedule (
أكبر تأخير قائم: الهيكل|Largest current delay: Structure
متى ننتهي؟|When do we finish?
هل نحن متأخرون؟|Are we behind?
موزونة بالمدة التعاقدية · العقود التي لها خط أساس معتمد فقط|Weighted by contractual duration · baselined contracts only
· التشطيبات لم تبدأ (0%)|· Finishing not started (0%)
أين التأخير؟|Where is the delay?
عقود مُجدولة متأخرة|scheduled contracts late
من|of
الأعمال الخارجية أُسندت — بانتظار خط الأساس|External works assigned — awaiting baseline
الأعمال الخارجية غير موقّعة · تأخر تعاقد|External works unsigned · contracting delay
ما حالة التقديمات؟|Submission status?
أكبر أسباب التأخير القائمة|Top current delay drivers
اتجاه النهاية المتوقعة — الهيكل|Forecast finish trend — Structure
التعاقدية|Contractual
· بيانات|· data
أسباب التأخير مجمّعة|Delay reasons combined
على المسارات الحرجة ·|on critical paths ·
الكهروميكانيكية: تأخر المقاول يومان، ويوم منهما وقع على عطلة الجمعة.|MEP: contractor delay was 2 days, one of them on a Friday.
ملخص العقد|Contract summary
إسناد العقد من شاشة العقود|Assign from the contracts screen
المتوقعة|Forecast
لوحة المشروع|Project dashboard
معاينة الجوال|Mobile preview
لوحة المالك — الجوال|Owner dashboard — mobile
الأجوبة الأربعة وقائمة العقود.|The four answers and the contract list.
عقود · تاريخ البيانات|contracts · data date
حالة التقديمات|Submission status
العقود|Contracts
اللوحة|Dashboard
المزيد|More
سطح المكتب|Desktop
لوحة العقد ·|Contract dashboard ·
لوحة العقد|Contract dashboard
آخر تقديم|Last submission
لا خط أساس معتمد بعد —|No approved baseline yet —
عرض المقاول: عقدك فقط بالتعاقدي والمتوقع — بلا الخط الافتراضي وبلا العقود الأخرى.|Contractor view: your contract only, contractual and forecast — no planned line, no other contracts.
بعد الجولة|After the tour
الحالة الافتتاحية|Opening state
اليوم:|Today:
اليوم|Today
إظهار الخط الافتراضي|Show planned line
تصدير التقرير الأسبوعي|Export weekly report
تأخّر الهيكل لا ينتقل آلياً إلى التشطيبات. إن أثّر على بدايتها، يقدّم مقاولها طلب تعديل خط أساس بعد اعتماد BL-0.|Structure delay doesn't flow automatically into Finishing. If it affects its start, the contractor files a baseline revision after BL-0 is approved.
جارٍ تجهيز التقرير الأسبوعي —|Preparing the weekly report —
جدول العقد · التحديث|Contract schedule · update
جدول العقد|Contract schedule
رفع ملف الجدول|Upload schedule file
لا تملك صلاحية لهذه الصفحة|You don't have access to this page
هذه الصفحة ليست ضمن صلاحيات|This page isn't part of the permissions of
العودة إلى صفحتك|Back to your page
مقبول 17 سبتمبر|accepted 17 Sep
مقبول ·|Accepted ·
· منذ 3 أيام · 4 أيام متبقية من 7|· 3 days ago · 4 of 7 days left
بانتظار خط الأساس|Awaiting baseline
تأخر تعاقد ·|Contracting delay ·
قُدّم متأخراً|submitted late by
عند|with
عرض القرار|View decision
مراجعة|Review
فتح المسودة|Open draft
تعرض الحالة الخارجية فقط — المراجعة الداخلية للاستشاري لا تظهر لك.|Shows external status only — the consultant's internal review isn't visible to you.
الوارد إليك من المقاولين. مدة الرد تُحسب من الإطلاق، وتستمر أثناء التبادل الداخلي.|Incoming from contractors. Response time counts from launch and keeps running during internal hand-offs.
تقديمات عقدك. المسودة الداخلية لا يراها أحد خارج شركتك.|Your contract's submissions. Internal drafts aren't visible outside your company.
النوع|Type
الأعمال الخارجية غير موقّعة — تأخر تعاقد 26 يوماً|External works unsigned — contracting delay 26 days
م. فهد أعاد الجدول للتعديل|Eng. Fahad returned the schedule for edits
جدول التشطيبات: BL-0 مطلوب قبل 8 أكتوبر|Finishing schedule: BL-0 due before 8 Oct
م. أحمد أرسل BL-0 — أطلقه أو أرجعه|Eng. Ahmed sent BL-0 — launch or return it
U-15 متأخر 3 أيام — ارفع ملف XER|U-15 is 3 days late — upload the XER
م. ياسر أرسل U-15 — أطلقه|Eng. Yasser sent U-15 — launch it
ابدأ مسودة U-6 من الموقع|Start the U-6 draft from site
م. نادر أرسل U-6|Eng. Nader sent U-6
U-5 الكهروميكانيكية بانتظار مراجعتك|MEP U-5 awaits your review
BL-0 التشطيبات وصل|Finishing BL-0 arrived
U-15 الهيكل وصل|Structure U-15 arrived
م. سارة مرّرت U-5 — القرار لك|Eng. Sara passed U-5 — your decision
م. سارة مرّرت BL-0 — القرار لك|Eng. Sara passed BL-0 — your decision
م. سارة مرّرت U-15 — القرار لك|Eng. Sara passed U-15 — your decision
مهامي في الجدول الزمني|My schedule tasks
لا مهام الآن.|No tasks right now.
بحث|Search
تعرض كـ ·|Viewing as ·
تعرض كـ|Viewing as
الجدول الزمني|Schedule
الجولة|Tour
· اكتملت|· complete
جولة الموديول|Module tour
كل الخطوات يوم|All steps on
ابدأ هذه الخطوة|Start this step
انتقل — تُطبَّق الخطوات السابقة|Jump — earlier steps are applied
إعادة ضبط العرض|Reset demo
لا تعليقات|No comments
طيّ/توسيع|Collapse/expand
حذف العلاقة|Remove link
إزالة الملف|Remove file
المهام|Tasks
المشاريع|Projects
إنقاص|Decrease
زيادة|Increase
حالة الشبكة|Network status
متصل|Online
شبكة ضعيفة|Weak network
على المسار الحرج|On the critical path
نشاط بلا سابق|Activity without predecessor
إعدادات العرض|Display settings
اللغة|Language
المظهر|Appearance
فاتح|Light
الألوان|Colours
محايد|Neutral
دافئ|Warm
أردوازي|Slate
مريمية|Sage
محيطي|Ocean
برقوقي|Plum
داكن|Dark
الشريط الجانبي|Sidebar
أُسند العقد|Contract assigned
مقاول|Contractor
مالك|Owner
استشاري|Consultant
طقس|Weather
قوة قاهرة|Force majeure
تأخير عقد آخر|Other contract delay
أمر تغيير|Change order
تبعاً لـ|knock-on from
لم يتغيّر|unchanged
بدأ مبكراً|started early
بدأ قبل انتهاء|started before finish of
من U-3|from U-3
تأخر الرد يومان|Response 2 days late
أيام العمل والعطل|working days & holidays`;
const D=new Map();RAW.split('\n').forEach(l=>{const i=l.indexOf('|');if(i>0)D.set(l.slice(0,i),l.slice(i+1))});
const FR=[...D.keys()].sort((a,b)=>b.length-a.length);
const AR=/[\u0600-\u06FF]/;const isL=c=>c&&/[\u0621-\u064A\u0660-\u06FF]/.test(c);
const cache=new Map();
function tr(s){if(!s||!AR.test(s))return s;{const q=s.match(/^ر([1-4]) (\d{4})$/);if(q)return 'Q'+q[1]+' '+q[2]}if(cache.has(s))return cache.get(s);const lead=s.match(/^\s*/)[0],trail=s.match(/\s*$/)[0];const core=s.trim();let out=D.get(core);
 if(out==null){out=core;for(const k of FR){if(out.indexOf(k)<0)continue;let i=0,r='';while(true){const j=out.indexOf(k,i);if(j<0){r+=out.slice(i);break}const b=out[j-1],a=out[j+k.length];if((isL(b)&&!/[لـ]$/.test(k.slice(0,0)))||isL(a)){r+=out.slice(i,j+k.length);i=j+k.length;continue}r+=out.slice(i,j)+D.get(k);i=j+k.length}out=r;if(!AR.test(out))break}
  out=out.replace(/،/g,',').replace(/«/g,'"').replace(/»/g,'"').replace(/؟/g,'?').replace(/؛/g,';').replace(/(^|\s)و(?=[A-Z0-9])/g,'$1& ').replace(/(^|\s)بـ\s?/g,'$1by ').replace(/لـ\s?/g,'to ')}
 out=lead+out+trail;cache.set(s,out);return out}
function run(root){const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const L=[];while(w.nextNode())L.push(w.currentNode);L.forEach(n=>{if(n.parentNode&&/^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName))return;const t=tr(n.nodeValue);if(t!==n.nodeValue)n.nodeValue=t});
 root.querySelectorAll('[title],[placeholder],[aria-label],[data-l]').forEach(el=>{['title','placeholder','aria-label','data-l'].forEach(a=>{const v=el.getAttribute(a);if(v&&AR.test(v))el.setAttribute(a,tr(v))})});
 root.querySelectorAll('input[readonly],input[value]').forEach(el=>{if(el.type!=='date'&&el.value&&AR.test(el.value)&&(el.readOnly||el.id!=='e-in'))el.value=tr(el.value)});
 root.querySelectorAll('option').forEach(o=>{if(AR.test(o.textContent))o.textContent=tr(o.textContent)});
 root.querySelectorAll('[dir="rtl"]').forEach(el=>el.setAttribute('dir','ltr'));root.querySelectorAll('[lang="ar"]').forEach(el=>el.setAttribute('lang','en'))}
SC.I18N={tr,run,D};
})();
