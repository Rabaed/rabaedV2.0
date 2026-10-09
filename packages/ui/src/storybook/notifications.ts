import type { Locale } from "@rabaed/domain";
import type { NotificationSettingsLabels } from "../components/notifications/notification-settings.tsx";

// Story copy for the notification settings: the labels the app passes from its
// messages (apps/web/messages), in English and Arabic.

export const notificationSettingsLabels: Record<Locale, NotificationSettingsLabels> = {
  en: {
    email: "Email",
    pauseAll: "Pause all email",
    pauseHelp: "Stops every email until you turn it back on. Notifications still reach your bell.",
    language: "Language of emails",
    projects: "Projects",
    projectsHelp: "A muted Project sends you no notifications or emails. Items waiting on you still show as yours.",
    mute: "Mute",
    noProjects: "You are not on any Project yet.",
    groups: "Notifications",
    emailChoice: { off: "Off", immediate: "Immediately", digest: "Daily digest" },
    group: {
      step_reached: "Step reached me or my pool",
      watched: "Items I watch",
      sent_back: "Sent Back to my Participant",
      vacancy: "Vacancy in my Company",
      weekly_report: "Weekly Step Age report",
    },
    weeklyHelp: "Emailed on Sunday mornings.",
    outcomes: "Outcomes that notify me",
    outcomeGroups: { review_code: "Review Codes", inspection_result: "Inspection Results", other: "Other outcomes" },
    refusals: { not_found: "That Project is no longer available to you.", unavailable: "That didn't save. Try again." },
  },
  ar: {
    email: "البريد الإلكتروني",
    pauseAll: "إيقاف كل الرسائل مؤقتًا",
    pauseHelp: "يوقف كل الرسائل حتى تعيد تشغيلها. تبقى الإشعارات تصلك في الجرس.",
    language: "لغة الرسائل",
    projects: "المشاريع",
    projectsHelp: "المشروع المكتوم لا يرسل إليك إشعارات ولا رسائل. وتبقى البنود التي تنتظرك ظاهرة لك.",
    mute: "كتم",
    noProjects: "لست في أي مشروع بعد.",
    groups: "الإشعارات",
    emailChoice: { off: "إيقاف", immediate: "فورًا", digest: "ملخص يومي" },
    group: {
      step_reached: "وصلتني خطوة أو وصلت مجموعتي",
      watched: "البنود التي أراقبها",
      sent_back: "أُرجع إلى المشارك الذي أنتمي إليه",
      vacancy: "شاغر في شركتي",
      weekly_report: "تقرير عمر الخطوة الأسبوعي",
    },
    weeklyHelp: "يُرسل بالبريد صباح كل أحد.",
    outcomes: "النتائج التي تُشعرني",
    outcomeGroups: { review_code: "رموز المراجعة", inspection_result: "نتائج الفحص", other: "نتائج أخرى" },
    refusals: { not_found: "لم يعد هذا المشروع متاحًا لك.", unavailable: "لم يُحفظ ذلك. حاول مرة أخرى." },
  },
};
