import type { Locale } from "@rabaed/domain";
import type { PackageCommentsLabels } from "../components/packages/package-comments.tsx";

// The Package page's Comments for stories (RP-662), as the web's messages (`packages.comments`) say them.

export const packageCommentsLabels: Record<Locale, PackageCommentsLabels> = {
  en: {
    title: "Comments",
    forInformation: "For information",
    notPartOf: "Comments are not part of the Package and count in none of its counts.",
    empty: "No Comments you can see were raised from these submittals.",
    raisedFrom: "Raised from",
    noNumber: "No number yet",
  },
  ar: {
    title: "الملاحظات",
    forInformation: "للعلم",
    notPartOf: "الملاحظات ليست جزءًا من الحزمة ولا تدخل في أي من أعدادها.",
    empty: "لا توجد ملاحظات يمكنك رؤيتها أُنشئت من هذه الاعتمادات.",
    raisedFrom: "المصدر",
    noNumber: "بلا رقم بعد",
  },
};
