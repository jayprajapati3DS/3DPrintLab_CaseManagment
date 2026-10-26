/**
 * The handful of control styles every screen repeats, as the design draws them:
 * 9px-radius buttons and inputs, 14px-radius cards, the orange primary action.
 */

export const CARD = "border-line rounded-[14px] border bg-white";

export const CARD_HEADER =
  "border-line-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-b px-4 py-4 sm:px-5";

export const BTN_PRIMARY =
  "bg-brand h-10 rounded-[9px] border-0 px-4 text-[13.5px] font-semibold whitespace-nowrap text-white disabled:opacity-60";

export const BTN_SECONDARY =
  "border-field text-ink h-10 rounded-[9px] border bg-white px-4 text-[13.5px] font-semibold whitespace-nowrap disabled:opacity-60";

export const BTN_SMALL =
  "border-field text-ink h-[34px] rounded-lg border bg-white px-3 text-[12.5px] font-semibold whitespace-nowrap disabled:opacity-60";

export const INPUT =
  "border-field text-ink h-[42px] w-full rounded-[9px] border bg-white px-3 text-sm";

export const LABEL = "text-[13px] font-semibold";

export const TABLE_HEAD =
  "text-muted bg-subtle border-line-3 border-b px-5 py-2.5 text-[11px] font-semibold tracking-[0.6px] uppercase";

export const TABLE_ROW = "border-line-3 border-b px-5 py-3.5 text-[13.5px] last:border-b-0";
