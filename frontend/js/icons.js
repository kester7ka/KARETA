/** Lucide UMD: https://lucide.dev/ — вызывать после смены innerHTML */
export function refreshIcons() {
  if (typeof window.lucide !== "undefined" && window.lucide.createIcons) {
    window.lucide.createIcons();
  }
}
