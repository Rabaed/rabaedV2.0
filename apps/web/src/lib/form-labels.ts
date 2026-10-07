import type { ActionFormLabels, FormRendererLabels, LinkedFromLabels, LinkSearchLabels, LinksSectionLabels } from "@rabaed/ui";
import { useTranslations } from "next-intl";

// The Form engine's and the Links' words for @rabaed/ui, from the app's messages
// (workItems.form, workItems.actions, workItems.links). A number reaches a label
// already formatted for the locale, with the count itself where a plural needs it.

/** Link search's words. */
export function useLinkSearchLabels(): LinkSearchLabels {
  const t = useTranslations("workItems.links.search");
  return {
    label: t("label"),
    hint: t("hint"),
    results: t("results"),
    searching: t("searching"),
    noMatch: t("noMatch"),
    offered: t("offered"),
    failed: t("failed"),
    more: t("more"),
    count: (n, count, more) => `${t("count", { n, count })}${more ? t("moreBelow") : ""}`,
  };
}

/** The Form renderer's words, with each field type's. */
export function useFormRendererLabels(): FormRendererLabels {
  const t = useTranslations("workItems.form");
  const r = (key: string) => t(`renderer.${key}`);
  const search = useLinkSearchLabels();
  const tLinks = useTranslations("workItems.links");
  return {
    summary: (n, count) => t("renderer.summary", { n, count }),
    required: r("required"),
    wrongType: r("wrongType"),
    tooLong: (max) => t("renderer.tooLong", { max }),
    invalidFormat: {
      date: r("invalidFormat.date"),
      time: r("invalidFormat.time"),
      datetime: r("invalidFormat.datetime"),
      email: r("invalidFormat.email"),
      phone: r("invalidFormat.phone"),
    },
    notANumber: r("notANumber"),
    belowMin: (min) => t("renderer.belowMin", { min }),
    aboveMax: (max) => t("renderer.aboveMax", { max }),
    tooManyDecimals: (n, count) => t("renderer.tooManyDecimals", { n, count }),
    unknownOption: r("unknownOption"),
    notWorkedOut: r("notWorkedOut"),
    calculatedRequired: r("calculatedRequired"),
    tooShallow: r("tooShallow"),
    tooFewRows: (n, count) => t("renderer.tooFewRows", { n, count }),
    tooManyRows: (n, count) => t("renderer.tooManyRows", { n, count }),
    tooFewFiles: (n, count) => t("renderer.tooFewFiles", { n, count }),
    choose: r("choose"),
    none: r("none"),
    leftProject: (name) => t("renderer.leftProject", { name }),
    unanswered: r("unanswered"),
    filledBy: (role) => t("renderer.filledBy", { role }),
    builtIn: { choose: t("builtIn.choose"), chooseTradeFirst: t("builtIn.chooseTradeFirst"), noScopes: t("builtIn.noScopes") },
    attachments: {
      none: t("attachmentsField.none"),
      notYet: t("attachmentsField.notYet"),
      uploading: t("attachmentsField.uploading"),
      open: (name) => t("attachmentsField.open", { name }),
      remove: (name) => t("attachmentsField.remove", { name }),
      frozen: t("attachmentsField.frozen"),
      kb: (size) => t("attachmentsField.kb", { size }),
      mb: (size) => t("attachmentsField.mb", { size }),
      accepts: (types) => t("attachmentsField.accepts", { types }),
      atMost: (n, count) => t("attachmentsField.atMost", { n, count }),
      full: (n, count) => t("attachmentsField.full", { n, count }),
    },
    photos: photosLabels(t),
    checklist: {
      comment: t("checklistField.comment"),
      photos: t("checklistField.photos"),
      required: t("checklistField.required"),
      notAnswered: t("checklistField.notAnswered"),
      answerThis: t("checklistField.answerThis"),
      commentNeeded: t("checklistField.commentNeeded"),
      photoNeeded: t("checklistField.photoNeeded"),
      wrongType: t("checklistField.wrongType"),
      unknownOption: t("checklistField.unknownOption"),
      tooLong: (max) => t("checklistField.tooLong", { max }),
      summary: t("checklistField.summary"),
      evidence: (item) => t("checklistField.evidence", { item }),
      itemNumber: (n, of) => t("checklistField.itemNumber", { n, of }),
      photosField: photosLabels(t),
    },
    table: {
      addRow: t("tableField.addRow"),
      row: (n) => t("tableField.row", { n }),
      removeRow: (n) => t("tableField.removeRow", { n }),
      noRows: t("tableField.noRows"),
      limitReached: (max) => t("tableField.limitReached", { max }),
      total: (column) => t("tableField.total", { column }),
      wrongType: t("tableField.wrongType"),
    },
    optionList: {
      level: (n) => t("optionListField.level", { n }),
      choose: t("optionListField.choose"),
      none: t("optionListField.none"),
      unavailable: t("optionListField.unavailable"),
    },
    linkQuestion: { remove: (number) => t("linkQuestion.remove", { number }), item: { hidden: tLinks("hidden") }, search },
  };
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** A photos field's words: the field's own, and a checklist item's evidence. */
function photosLabels(t: Translate): FormRendererLabels["photos"] {
  return {
    none: t("photosField.none"),
    notYet: t("photosField.notYet"),
    uploading: t("photosField.uploading"),
    takePhoto: t("photosField.takePhoto"),
    open: (name) => t("photosField.open", { name }),
    remove: (name) => t("photosField.remove", { name }),
    frozen: t("photosField.frozen"),
    taken: (when) => t("photosField.taken", { when }),
    nothingRecorded: t("photosField.nothingRecorded"),
    noTime: t("photosField.noTime"),
    noPlace: t("photosField.noPlace"),
    atMost: (n, count) => t("photosField.atMost", { n, count }),
    full: (n, count) => t("photosField.full", { n, count }),
  };
}

/** A transition pop-up's words: the Internal Note, and the Form engine's. */
export function useActionFormLabels(): ActionFormLabels {
  const t = useTranslations("workItems.actions");
  const form = useFormRendererLabels();
  return { internalNote: t("internalNote"), internalNoteHelp: t("internalNoteHelp"), form };
}

/** The Links section's words. */
export function useLinksSectionLabels(): LinksSectionLabels {
  const search = useLinkSearchLabels();
  const t = useTranslations("workItems.links");
  return {
    title: t("title"),
    none: t("none"),
    remove: (number) => t("remove", { number }),
    item: { hidden: t("hidden") },
    search,
  };
}

/** "Linked from"'s words. */
export function useLinkedFromLabels(): LinkedFromLabels {
  const t = useTranslations("workItems.links");
  return { title: t("linkedFrom.title"), none: t("linkedFrom.none"), item: { hidden: t("hidden") } };
}
