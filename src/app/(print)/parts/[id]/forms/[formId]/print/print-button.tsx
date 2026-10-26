"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="bg-ink h-9 rounded-lg border-0 px-3.5 text-[13px] font-semibold text-white print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
