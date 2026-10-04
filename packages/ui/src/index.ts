// @console/ui — компоненты дизайн-системы «Taimen Console» на React и TypeScript.
// Источник истины — design-system/components/bundle.js (window.TaimenConsole); имена экспорта те же.
// Стили: import "@console/ui/styles.css". Язык встроенных строк — LocaleProvider (без него — lang документа, иначе en).

export type { ExecutorKind, Status } from "./util";

export { STRINGS } from "./strings";
export type { Locale, StringKey, StringEntry, PluralForms } from "./strings";
export { LocaleProvider, useLocale, STATUS_WORD } from "./locale";
export type { LocaleProviderProps } from "./locale";

export { Icon } from "./icons";
export type { IconName, IconProps } from "./icons";

export {
  Button, ExecutorGlyph, IdentityBlock, StatusMark, SourceChip, ChannelChip, LiveChip, Seals,
} from "./primitives";
export type {
  ButtonProps, ButtonVariant, ExecutorGlyphProps, IdentityBlockProps, StatusMarkProps, Source, SourceChipProps,
  ChannelState, ChannelChipProps, LiveChipProps, SealOrigin, SealExecutor, EvidenceMethod, SealEvidence, SealSignature, SealsProps,
} from "./primitives";

export { Summary, DecisionCard, ProblemCard, WorkPath, ExecutorCard, JournalEntry } from "./pult";
export type {
  SummaryChange, SummaryProps, EvidenceItem, DecisionCardProps, ProblemAction, ProblemCardProps, ProblemCardCalmProps,
  ByKind, WorkPathStage, WorkPathGate, WorkPathProps, ExecutorCardProps, JournalEntryProps,
} from "./pult";

export { WorkRow, WorkGroup, Chronicle, PlanDiff, WorkPreview, DataTable } from "./work";
export type {
  WorkRowProps, WorkGroupProps, ChronicleView, ChronicleKind, ChronicleGroup, ChronicleSpan, ChronicleEvent, ChronicleProps,
  PlanOp, PlanDiffItem, PlanDiffProps, WorkPreviewProps, DataTableColumn, DataTableProps,
} from "./work";

export { AssistantPanel } from "./assistant";
export type { AssistantMessage, AssistantMessageAction, AssistantPanelProps } from "./assistant";

export {
  TopBar, NavDrawer, CommandPalette, DegradedBanner, EmptyState, Zone, PageHeader, AppShell,
} from "./shell";
export type {
  TopBarProps, NavItem, NavGroup, NavDrawerProps, CommandPaletteItem, CommandPaletteGroup, CommandPaletteProps,
  DegradedBannerProps, DegradedBannerSectionProps, EmptyStateProps, ZoneProps, PageHeaderProps, AppShellProps,
} from "./shell";

export {
  Dialog, Consequences, Criteria, Callout, DecisionStatus, Field, PersonPicker, Combobox, SearchField, FilterChip,
} from "./forms";
export type {
  DialogProps, ConsequenceItem, ConsequencesProps, CriterionItem, CriteriaProps, CalloutProps,
  DecisionStatusRow, DecisionStatusProps, FieldProps, PersonOption, PersonPickerProps, ComboOption, ComboboxProps, SearchFieldProps, FilterChipProps,
} from "./forms";
