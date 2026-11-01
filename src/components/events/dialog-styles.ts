// Event windows are full screen on phones and a dialog from the md breakpoint up. Chakra's
// "full" size sets a full-screen height, no margin and square corners, and a responsive
// size from md up only changes the width; this restores the rest from md up.
export const dialogFromMdUp = {
  md: { minH: "auto", borderRadius: "l3", "--dialog-margin": "var(--dialog-base-margin)" },
} as const;
