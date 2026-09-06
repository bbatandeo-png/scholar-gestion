// Picks whichever of black/white actually reads on top of a given
// background color (relative luminance) - used wherever an ecole can pick
// its own accent color for a PDF (student ID card, bulletin), since a dark
// choice would otherwise make the default black header text disappear.
export function getReadableTextColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000000' : '#ffffff';
}
