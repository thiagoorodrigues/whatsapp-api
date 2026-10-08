// Only "#rrggbb" is kept; anything else (or empty) means the default color.
export const connectionColor = (color?: string | null): string | null =>
  typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
