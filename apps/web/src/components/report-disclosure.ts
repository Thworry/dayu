/** Keep native disclosures independently operable while making direct links visible. */
export function revealReportTarget(target: HTMLElement): void {
  let ancestor: HTMLElement | null = target;
  while (ancestor !== null) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start", behavior: "instant" });
}
