// The hand-drawn font canvases paint their words in may still be loading the
// first time they're drawn: paint again once it's in.
export function whenFontReady(repaint: () => void) {
  void document.fonts.load("80px 'Caveat Brush'").then(repaint);
}
