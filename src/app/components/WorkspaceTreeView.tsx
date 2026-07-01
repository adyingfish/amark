import { ChevronDown, ChevronRight, File as FileIcon, Folder } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useI18n } from "../../features/i18n/i18n-context";
import type { WorkspaceFileNode } from "../../features/workspace/workspace-types";
import { clampMenuPosition, parentDir } from "../app-utils";

export interface WorkspaceTreeViewProps {
  files: WorkspaceFileNode[];
  activeFilePath: string | null;
  rootPath: string | null;
  expandedFolders: Set<string>;
  onFileClick: (path: string, name: string) => void;
  onToggleFolder: (path: string) => void;
  onNewFile: (parentDirPath: string) => void;
  onNewFolder: (parentDirPath: string) => void;
  onRenameFile: (path: string, name: string) => void;
  onRenameFolder: (path: string, name: string) => void;
  onDeleteFile: (path: string, name: string) => void;
}

export function WorkspaceTreeView(props: WorkspaceTreeViewProps): ReactElement {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{ x: number; y: number; node: WorkspaceFileNode } | null>(null);

  // Stable identity so it doesn't invalidate the FileRow/FolderRow memoization
  // below on every menu-state change.
  const handleOpenMenu = useCallback((event: ReactMouseEvent, node: WorkspaceFileNode) => {
    setMenu({ x: event.clientX, y: event.clientY, node });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest(".tree-context-menu")) return;
      setMenu(null);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", close);
      document.addEventListener("contextmenu", close);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("contextmenu", close);
    };
  }, [menu]);

  if (props.files.length === 0) {
    return (
      <div className="workspace-tree">
        <div className="workspace-tree-empty">{t("tree.noMarkdownFiles")}</div>
      </div>
    );
  }

  return (
    <div className="workspace-tree">
      <WorkspaceTreeNodes {...props} onOpenMenu={handleOpenMenu} />
      {menu
        ? createPortal(
            <TreeContextMenu
              x={menu.x}
              y={menu.y}
              node={menu.node}
              rootPath={props.rootPath}
              onClose={() => setMenu(null)}
              onNewFile={props.onNewFile}
              onNewFolder={props.onNewFolder}
              onRenameFile={props.onRenameFile}
              onRenameFolder={props.onRenameFolder}
              onDeleteFile={props.onDeleteFile}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function WorkspaceTreeNodes(
  props: WorkspaceTreeViewProps & {
    onOpenMenu: (event: ReactMouseEvent, node: WorkspaceFileNode) => void;
  },
): ReactElement {
  const { files, activeFilePath, expandedFolders, onFileClick, onToggleFolder, onOpenMenu } = props;

  return (
    <ul className="workspace-tree-list">
      {files.map((node) => {
        if (node.kind === "directory") {
          const isExpanded = expandedFolders.has(node.path);
          return (
            <li key={node.path} className="workspace-tree-item">
              <FolderRow
                node={node}
                isExpanded={isExpanded}
                onToggle={onToggleFolder}
                onOpenMenu={onOpenMenu}
              />
              {isExpanded && node.children && node.children.length > 0 ? (
                <ul className="workspace-tree-children">
                  <WorkspaceTreeNodes {...props} files={node.children} />
                </ul>
              ) : null}
            </li>
          );
        }

        return (
          <li key={node.path} className="workspace-tree-item">
            <FileRow
              node={node}
              isActive={node.path === activeFilePath}
              onFileClick={onFileClick}
              onOpenMenu={onOpenMenu}
            />
          </li>
        );
      })}
    </ul>
  );
}

// Memoized so that a change elsewhere in the tree (e.g. switching the active
// file, which only flips `isActive` on two rows) doesn't force React to
// re-render and diff every other row in a large workspace. Props passed in
// must stay referentially stable (see the useCallback-wrapped handlers this
// receives) for the memoization to actually bail out renders.
const FolderRow = memo(function FolderRow({
  node,
  isExpanded,
  onToggle,
  onOpenMenu,
}: {
  node: WorkspaceFileNode;
  isExpanded: boolean;
  onToggle: (path: string) => void;
  onOpenMenu: (event: ReactMouseEvent, node: WorkspaceFileNode) => void;
}): ReactElement {
  const hasChildren = Boolean(node.children && node.children.length > 0);

  return (
    <div
      className="workspace-tree-folder"
      onClick={() => onToggle(node.path)}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(event, node);
      }}
    >
      <span
        className={cn("workspace-tree-toggle", isExpanded && "expanded")}
        onClick={
          hasChildren
            ? (event) => {
                event.stopPropagation();
                onToggle(node.path);
              }
            : undefined
        }
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="lucide-icon" size={14} aria-hidden="true" />
          ) : (
            <ChevronRight className="lucide-icon" size={14} aria-hidden="true" />
          )
        ) : null}
      </span>
      <span className="workspace-tree-folder-icon">
        <Folder className="lucide-icon" size={14} aria-hidden="true" />
      </span>
      <span className="workspace-tree-folder-name">{node.name}</span>
    </div>
  );
});

const FileRow = memo(function FileRow({
  node,
  isActive,
  onFileClick,
  onOpenMenu,
}: {
  node: WorkspaceFileNode;
  isActive: boolean;
  onFileClick: (path: string, name: string) => void;
  onOpenMenu: (event: ReactMouseEvent, node: WorkspaceFileNode) => void;
}): ReactElement {
  return (
    <div
      className={cn("workspace-tree-file", isActive && "active")}
      onClick={() => onFileClick(node.path, node.name)}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(event, node);
      }}
    >
      <span className="workspace-tree-file-icon">
        <FileIcon className="lucide-icon" size={14} aria-hidden="true" />
      </span>
      <span className="workspace-tree-file-name">{node.name}</span>
    </div>
  );
});

function TreeContextMenu({
  x,
  y,
  node,
  rootPath,
  onClose,
  onNewFile,
  onNewFolder,
  onRenameFile,
  onRenameFolder,
  onDeleteFile,
}: {
  x: number;
  y: number;
  node: WorkspaceFileNode;
  rootPath: string | null;
  onClose: () => void;
  onNewFile: (parentDirPath: string) => void;
  onNewFolder: (parentDirPath: string) => void;
  onRenameFile: (path: string, name: string) => void;
  onRenameFolder: (path: string, name: string) => void;
  onDeleteFile: (path: string, name: string) => void;
}): ReactElement {
  const { t } = useI18n();
  const items: Array<{ label: string; danger?: boolean; run: () => void }> = [];
  if (node.kind === "directory") {
    items.push({ label: t("tree.newFile"), run: () => onNewFile(node.path) });
    items.push({ label: t("tree.newFolder"), run: () => onNewFolder(node.path) });
    if (node.path !== rootPath) {
      items.push({ label: t("tree.rename"), run: () => onRenameFolder(node.path, node.name) });
    }
  } else {
    items.push({ label: t("tree.newFile"), run: () => onNewFile(parentDir(node.path)) });
    items.push({ label: t("tree.newFolder"), run: () => onNewFolder(parentDir(node.path)) });
    items.push({ label: t("tree.rename"), run: () => onRenameFile(node.path, node.name) });
    items.push({
      label: t("tree.delete"),
      danger: true,
      run: () => onDeleteFile(node.path, node.name),
    });
  }

  return (
    <div className="tree-context-menu" style={clampMenuPosition(x, y)}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={cn("tree-context-item", item.danger && "danger")}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
            item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
