/** Focus stays intact; unknown input retains the browser's accessible defaults. */
export function installInputModality(document: Document) {
  const root = document.documentElement;
  const capture = { capture: true };
  const assistiveClick = (event: MouseEvent) => { if (event.isTrusted && event.detail === 0) root.dataset.inputModality = "keyboard"; };
  const pointer = () => { root.dataset.inputModality = "pointer"; };
  const keyboard = (event: KeyboardEvent) => {
    if (event.metaKey || event.altKey || event.ctrlKey || ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
    root.dataset.inputModality = "keyboard";
  };
  const reset = () => { delete root.dataset.inputModality; };
  const visibility = () => { if (document.hidden) reset(); };
  document.addEventListener("pointerdown", pointer, capture);
  document.addEventListener("keydown", keyboard, capture);
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("click", assistiveClick, capture);
  return () => {
    document.removeEventListener("pointerdown", pointer, capture);
    document.removeEventListener("keydown", keyboard, capture);
    document.removeEventListener("visibilitychange", visibility);
    document.removeEventListener("click", assistiveClick, capture);
    reset();
  };
}
