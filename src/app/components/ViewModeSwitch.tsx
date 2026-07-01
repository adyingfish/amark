import { CodeXml, Columns2, FilePen, Image as ImageIcon } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "../../features/i18n/i18n-context";
import type { TranslationKey } from "../../features/i18n/translations";
import type { EditorViewMode } from "../../ui/view-mode-switch";

const VIEW_MODES: Array<{ mode: EditorViewMode; titleKey: TranslationKey; Icon: typeof CodeXml }> =
  [
    { mode: "source", titleKey: "viewMode.source", Icon: CodeXml },
    { mode: "split", titleKey: "viewMode.split", Icon: Columns2 },
    { mode: "preview-only", titleKey: "viewMode.previewOnly", Icon: ImageIcon },
    { mode: "wysiwyg", titleKey: "viewMode.wysiwyg", Icon: FilePen },
  ];

export function ViewModeSwitch({
  mode,
  onChange,
}: {
  mode: EditorViewMode;
  onChange: (mode: EditorViewMode) => void;
}): ReactElement {
  const { t } = useI18n();
  return (
    <div className="view-mode-switch" role="group" aria-label={t("viewMode.group")}>
      {VIEW_MODES.map(({ mode: itemMode, titleKey, Icon }) => {
        const title = t(titleKey);
        return (
          <button
            key={itemMode}
            type="button"
            className={cn("view-mode-btn", mode === itemMode && "active")}
            title={title}
            aria-label={title}
            aria-pressed={mode === itemMode}
            data-mode={itemMode}
            onClick={() => onChange(itemMode)}
          >
            <Icon className="lucide-icon" size={16} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
