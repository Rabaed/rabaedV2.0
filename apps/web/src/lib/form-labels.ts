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
    count: (n, count, more) => t("count", { n, count, more: String(more) }),
  };
}

/** The Form renderer's words, with each field type's. */
export function useFormRendererLabels(): FormRendererLabels {
  const t = useTranslations("workItems.form");
  const renderer = useTranslations("workItems.form.renderer");
  const { item, search } = useLinksSectionLabels();
  return {
    summary: (n, count) => renderer("summary", { n, count }),
    required: renderer("required"),
    wrongType: renderer("wrongType"),
    tooLong: (max) => renderer("tooLong", { max }),
    invalidFormat: {
      date: renderer("invalidFormat.date"),
      time: renderer("invalidFormat.time"),
      datetime: renderer("invalidFormat.datetime"),
      email: renderer("invalidFormat.email"),
      phone: renderer("invalidFormat.phone"),
    },
    notANumber: renderer("notANumber"),
    belowMin: (min) => renderer("belowMin", { min }),
    aboveMax: (max) => renderer("aboveMax", { max }),
    tooManyDecimals: (n, count) => renderer("tooManyDecimals", { n, count }),
    unknownOption: renderer("unknownOption"),
    notWorkedOut: renderer("notWorkedOut"),
    calculatedRequired: renderer("calculatedRequired"),
    tooShallow: renderer("tooShallow"),
    tooFewRows: (n, count) => renderer("tooFewRows", { n, count }),
    tooManyRows: (n, count) => renderer("tooManyRows", { n, count }),
    tooFewFiles: (n, count) => renderer("tooFewFiles", { n, count }),
    choose: renderer("choose"),
    none: renderer("none"),
    leftProject: (name) => renderer("leftProject", { name }),
    unanswered: renderer("unanswered"),
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
      raiseSnag: t("checklistField.raiseSnag"),
      snagRaised: t("checklistField.snagRaised"),
      noSnagRaised: t("checklistField.noSnagRaised"),
      raiseSnagTicked: t("checklistField.raiseSnagTicked"),
      raiseSnagUnticked: t("checklistField.raiseSnagUnticked"),
      addComment: t("checklistField.addComment"),
      addPhoto: t("checklistField.addPhoto"),
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
    linkQuestion: { remove: (number) => t("linkQuestion.remove", { number }), item, search },
    approvedSupplier: { none: t("approvedSupplierField.none"), withdrawn: (name) => t("approvedSupplierField.withdrawn", { name }) },
    checklistTemplate: checklistTemplateLabels(t),
  };
}

/** A `checklist_template` field's words (RP-651), also the template editor's preview. */
export function checklistTemplateLabels(t: Translate): FormRendererLabels["checklistTemplate"] {
  return {
    choose: t("checklistTemplateField.choose"),
    none: t("checklistTemplateField.none"),
    chooseTradeFirst: t("checklistTemplateField.chooseTradeFirst"),
    noneForTrade: t("checklistTemplateField.noneForTrade"),
    kept: (name) => t("checklistTemplateField.kept", { name }),
    checks: (n, count) => t("checklistTemplateField.checks", { n, count }),
    filledOnSite: t("checklistTemplateField.filledOnSite"),
    itemNumber: (n, of) => t("checklistTemplateField.itemNumber", { n, of }),
    commentRequired: (answer) => t("checklistTemplateField.commentRequired", { answer }),
    photoRequired: (answer) => t("checklistTemplateField.photoRequired", { answer }),
    commentOptional: t("checklistTemplateField.commentOptional"),
    photoOptional: t("checklistTemplateField.photoOptional"),
    raisesSnag: (answer) => t("checklistTemplateField.raisesSnag", { answer }),
    forTrade: (trade) => t("checklistTemplateField.forTrade", { trade }),
    otherTradesHidden: (n, count) => t("checklistTemplateField.otherTradesHidden", { n, count }),
    version: (n) => t("checklistTemplateField.version", { n }),
    locked: t("checklistTemplateField.locked"),
    hideItems: t("checklistTemplateField.hideItems"),
    showItems: t("checklistTemplateField.showItems"),
    negativeAsks: (answer, what, every) => t("checklistTemplateField.negativeAsks", { answer, what, every: every ? "yes" : "no" }),
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
    upload: t("photosField.upload"),
    open: (name) => t("photosField.open", { name }),
    remove: (name) => t("photosField.remove", { name }),
    frozen: t("photosField.frozen"),
    taken: (when) => t("photosField.taken", { when }),
    nothingRecorded: t("photosField.nothingRecorded"),
    noTime: t("photosField.noTime"),
    noPlace: t("photosField.noPlace"),
    atMost: (n, count) => t("photosField.atMost", { n, count }),
    full: (n, count) => t("photosField.full", { n, count }),
    // A photo full screen, and the annotate view (RP-656, RP-1056).
    annotatedMark: t("photosField.annotatedMark"),
    viewer: {
      close: t("photosField.viewer.close"),
      show: t("photosField.viewer.show"),
      annotated: t("photosField.viewer.annotated"),
      original: t("photosField.viewer.original"),
      annotate: t("photosField.viewer.annotate"),
      noImage: t("photosField.viewer.noImage"),
    },
    annotator: {
      title: (name) => t("photosField.annotator.title", { name }),
      cancel: t("photosField.annotator.cancel"),
      undo: t("photosField.annotator.undo"),
      save: t("photosField.annotator.save"),
      saving: t("photosField.annotator.saving"),
      failed: t("photosField.annotator.failed"),
      canvas: t("photosField.annotator.canvas"),
      tools: t("photosField.annotator.tools"),
      tool: {
        arrow: t("photosField.annotator.tool.arrow"),
        rectangle: t("photosField.annotator.tool.rectangle"),
        circle: t("photosField.annotator.tool.circle"),
        pen: t("photosField.annotator.tool.pen"),
        text: t("photosField.annotator.tool.text"),
      },
      colours: t("photosField.annotator.colours"),
      colour: {
        red: t("photosField.annotator.colour.red"),
        yellow: t("photosField.annotator.colour.yellow"),
        blue: t("photosField.annotator.colour.blue"),
        white: t("photosField.annotator.colour.white"),
        black: t("photosField.annotator.colour.black"),
      },
      labelText: t("photosField.annotator.labelText"),
      addLabel: t("photosField.annotator.addLabel"),
    },
  };
}

/** A transition pop-up's words: the Internal Note, and the Form engine's. */
export function useActionFormLabels(): ActionFormLabels {
  const t = useTranslations("workItems.actions");
  const form = useFormRendererLabels();
  return {
    internalNote: t("internalNote"),
    internalNoteHelp: t("internalNoteHelp"),
    form,
    page: {
      optional: t("popup.optional"),
      required: t("popup.required"),
      internalNoteShort: t("popup.internalNoteShort"),
      internalNotePlaceholder: (company) => t("popup.internalNotePlaceholder", { company }),
      remarksRequired: (code) => t("popup.remarksRequired", { code }),
      remarksHelp: (company) => t("popup.remarksHelp", { company }),
      remarksMissing: (code) => t("popup.remarksMissing", { code }),
    },
  };
}

/** The Links section's words. */
export function useLinksSectionLabels(): LinksSectionLabels {
  const search = useLinkSearchLabels();
  const t = useTranslations("workItems.links");
  return {
    title: t("title"),
    none: t("none"),
    remove: (number) => t("remove", { number }),
    item: { hidden: t("hidden"), noAccess: t("noAccess") },
    search,
  };
}

/** "Linked from"'s words. */
export function useLinkedFromLabels(): LinkedFromLabels {
  const t = useTranslations("workItems.links");
  return { title: t("linkedFrom.title"), none: t("linkedFrom.none"), item: { hidden: t("hidden"), noAccess: t("noAccess") } };
}
