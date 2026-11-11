// AG Studio theme mapped onto SayItPayIt's design tokens (globals.css), so the dashboard reads as part
// of the app: ink canvas, panel widgets, teal "signal" accent, amber/coral for Guardian.
import { studioTheme } from "ag-studio";

const v = (name: string) => `var(--color-${name})`;
const line = (name: string) => ({ width: 1, color: v(name) });
const FONT = "var(--font-sans)";
const DISPLAY = "var(--font-display)";

// Chart series: signal teal first, then calm companions; amber/coral last (they mean caution).
const SERIES = ["#3fd0b6", "#7aa7ff", "#c7a6ff", "#8fd3ff", "#f2b544", "#ff6b5e", "#9be27a", "#eaf0f6", "#5fb3a6", "#b0bccb"];
const palette = Object.fromEntries(
  SERIES.flatMap((c, i) => [
    [`chartPaletteFills${i + 1}Color`, c],
    [`chartPaletteStrokes${i + 1}Color`, c],
  ]),
);

export const sayItPayItTheme = studioTheme.withParams({
  fontFamily: FONT,
  fontSize: 14,
  textColor: v("paper"),
  foregroundColor: v("paper"),
  subtleTextColor: v("mist"),
  backgroundColor: v("panel"),
  borderColor: v("line"),
  accentColor: v("signal"),
  iconColor: v("mist"),
  rowHoverColor: "rgba(63, 208, 182, 0.08)",

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: v("ink"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: v("ink"),
  studioCanvasPadding: 16,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: FONT,

  studioWidgetBackgroundColor: v("panel"),
  studioWidgetBorder: line("line"),
  studioWidgetBorderRadius: 16,
  studioWidgetPadding: 14,
  studioWidgetTitleFontFamily: DISPLAY,
  studioWidgetTitleFontSize: 17,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleTextColor: v("paper"),
  studioWidgetSubtitleFontFamily: FONT,
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: v("mist"),
  studioWidgetCaptionFontFamily: FONT,
  studioWidgetCaptionFontSize: 13,
  studioWidgetCaptionTextColor: v("mist"),
  studioWidgetResizeBorderColor: v("signal"),

  studioPanelContainerBackgroundColor: v("panel"),
  studioPanelContainerBorder: line("line"),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: v("line"),
  studioPanelDividerActiveColor: v("signal"),
  studioPanelSectionBorderColor: v("line"),
  studioPanelHeaderFontFamily: FONT,
  studioPanelHeaderFontWeight: 600,
  studioToggleButtonActiveBackgroundColor: "rgba(63, 208, 182, 0.12)",
  studioToggleButtonActiveBorderColor: v("signal"),
  studioToggleButtonActiveColor: v("signal"),

  gridFontFamily: FONT,
  gridFontSize: 14,
  gridCellTextColor: v("paper"),
  gridHeaderBackgroundColor: v("panel"),
  gridHeaderTextColor: v("mist"),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 13,
  gridRowHeight: 40,
  gridRowBorder: line("line"),
  gridHeaderRowBorder: line("line"),
  gridPinnedRowBorder: line("line"),
  gridRowHoverColor: "rgba(63, 208, 182, 0.08)",
  gridWrapperBorder: false,

  chartFontFamily: FONT,
  chartTextColor: v("paper"),
  chartSubtleTextColor: v("mist"),
  chartAxisLineColor: v("line"),
  chartGridLineColor: v("line"),
  ...palette,
});
