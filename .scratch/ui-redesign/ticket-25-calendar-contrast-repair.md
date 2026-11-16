# Ticket 25 calendar contrast repair

The shared `getContrastingTextColor()` helper now preserves its existing foreground when the
opaque hex foreground/background pair meets the 4.5:1 normal-text target. When its selected
foreground fails, it chooses the higher-contrast pure black or white foreground. Unsupported
color formats keep the existing white fallback.

Task colors, auto-palette selection, saved data, and caller contracts remain unchanged. The
Calendar and Dashboard event renderer plus task cards, task-filter buttons, and inspector chips
continue to use the shared helper. Regression coverage checks the measured `#0284c7` task color,
stable passing outputs, supported hex forms, unsupported-input fallback, and unchanged Calendar
event background.
