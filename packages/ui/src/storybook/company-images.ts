import type { Locale } from "@rabaed/domain";
import type { CompanyImagesLabels } from "../components/signature/company-images.tsx";
import type { StampRequiredLabels } from "../components/signature/stamp-required-dialog.tsx";

// Story copy for the Company profile's logo and Stamp and the no-Stamp message (RP-617): the
// labels the app passes from its messages (apps/web/messages, `company`), in English and
// Arabic, for a made-up Company.

export const storyCompanyName: Record<Locale, string> = { en: "Al Noor Contracting", ar: "النور للمقاولات" };

/** The message a Member of the Company gets, and the one its Authorized Person gets. */
export const stampRequiredLabels: Record<"member" | "authorizedPerson", Record<Locale, StampRequiredLabels>> = {
  member: {
    en: {
      title: "Al Noor Contracting has no Stamp yet",
      body: "Its Members can't take any Transition until it is added. Ask Al Noor Contracting's owner or Authorized Person to add it in the Company profile.",
      dismiss: "OK",
      close: "Close",
    },
    ar: {
      title: "لا يوجد ختم لشركة النور للمقاولات بعد",
      body: "لا يستطيع أعضاؤها اتخاذ أي انتقال حتى يُضاف. اطلب من مالك النور للمقاولات أو المفوض إضافته في ملف الشركة.",
      dismiss: "حسنًا",
      close: "إغلاق",
    },
  },
  authorizedPerson: {
    en: {
      title: "Add Al Noor Contracting's Stamp to act",
      body: "None of Al Noor Contracting's Members can take a Transition until its Stamp is in the Company profile.",
      dismiss: "Not now",
      close: "Close",
    },
    ar: {
      title: "أضف ختم النور للمقاولات لتتمكن من الإجراء",
      body: "لا يستطيع أي من أعضاء النور للمقاولات اتخاذ انتقال حتى يُضاف ختمها في ملف الشركة.",
      dismiss: "ليس الآن",
      close: "إغلاق",
    },
  },
};

/** The message's link to the Company profile, as the app words it. */
export const addStampLabel: Record<Locale, string> = { en: "Add Stamp", ar: "إضافة الختم" };

export const companyImagesLabels: Record<Locale, CompanyImagesLabels> = {
  en: {
    logo: {
      title: "Logo",
      badge: "Optional",
      none: "No logo. It's optional: records print the Company without one.",
      upload: "Upload logo",
      replace: "Replace logo",
      fileHelp: "A PNG or JPEG image, up to 1 MB.",
      imageAlt: "The Company's logo",
    },
    stamp: {
      title: "Stamp",
      badge: "Required to act",
      none: "No Stamp yet.",
      upload: "Upload Stamp",
      replace: "Replace Stamp",
      fileHelp: "A PNG or JPEG image, up to 1 MB. A transparent background prints best.",
      imageAlt: "The Company's Stamp",
    },
    noStamp: "Your Members can't take any Transition until the Stamp is added.",
    kept: "Records already made keep the logo and Stamp that were in force then.",
    saving: "Saving…",
    refusals: {
      file_type: "Choose a PNG or JPEG image.",
      file_too_large: "That image is larger than 1 MB. Choose a smaller one.",
      invalid_company_image: "That image isn't a PNG or JPEG. Choose another.",
      forbidden: "Only the Company's Authorized Person can change this.",
      unavailable: "That didn't work. Try again.",
    },
  },
  ar: {
    logo: {
      title: "الشعار",
      badge: "اختياري",
      none: "لا يوجد شعار. هو اختياري: تطبع السجلات الشركة من دونه.",
      upload: "رفع الشعار",
      replace: "استبدال الشعار",
      fileHelp: "صورة PNG أو JPEG، حتى 1 ميغابايت.",
      imageAlt: "شعار الشركة",
    },
    stamp: {
      title: "الختم",
      badge: "مطلوب للإجراء",
      none: "لا يوجد ختم بعد.",
      upload: "رفع الختم",
      replace: "استبدال الختم",
      fileHelp: "صورة PNG أو JPEG، حتى 1 ميغابايت. الخلفية الشفافة أفضل عند الطباعة.",
      imageAlt: "ختم الشركة",
    },
    noStamp: "لا يستطيع أعضاؤك اتخاذ أي انتقال حتى يُضاف الختم.",
    kept: "تحتفظ السجلات المنجزة بالشعار والختم الساريين وقتها.",
    saving: "جارٍ الحفظ…",
    refusals: {
      file_type: "اختر صورة PNG أو JPEG.",
      file_too_large: "هذه الصورة أكبر من 1 ميغابايت. اختر صورة أصغر.",
      invalid_company_image: "هذه الصورة ليست PNG أو JPEG. اختر صورة أخرى.",
      forbidden: "لا يغيّر هذا إلا المفوض عن الشركة.",
      unavailable: "لم ينجح ذلك. حاول مرة أخرى.",
    },
  },
};

/* eslint-disable rabaed/no-hardcoded-colour -- the inks of an image printed on the white record, not the page */
/** A made-up Stamp and logo for stories: plain shapes, as data URLs. */
export const storyStampUrl =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><g fill='none' stroke='#1f3a93'><circle cx='100' cy='100' r='90' stroke-width='7'/><circle cx='100' cy='100' r='62' stroke-width='3'/></g><path d='M100 62l11 26 28 2-21 18 7 27-25-15-25 15 7-27-21-18 28-2z' fill='#1f3a93'/></svg>",
  );
export const storyLogoUrl =
  "data:image/svg+xml;utf8," +
  encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'><rect x='8' y='8' width='104' height='104' rx='12' fill='#146c43'/><path d='M20 100L100 20' stroke='#fff' stroke-width='16'/></svg>");
