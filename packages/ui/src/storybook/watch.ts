import type { Locale } from "@rabaed/domain";
import type { WatchButtonLabels } from "../components/watch/watch-button.tsx";

// Story copy for the Watch button: the labels the app passes from its messages
// (apps/web/messages), in English and Arabic.

export const watchButtonLabels: Record<Locale, WatchButtonLabels> = {
  en: {
    watch: "Watch",
    watching: "Watching",
    refusals: {
      not_found: "This item is no longer available to you.",
      unavailable: "That didn't work. Try again.",
    },
  },
  ar: {
    watch: "مراقبة",
    watching: "قيد المراقبة",
    refusals: {
      not_found: "لم يعد هذا البند متاحًا لك.",
      unavailable: "لم ينجح ذلك. حاول مرة أخرى.",
    },
  },
};
