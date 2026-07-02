// TabsBar.tsx - Tabs bar container; subscribes only to the tabs store's
// open-tabs slice instead of re-rendering with the whole app shell.
import { type ReactElement, useSyncExternalStore } from "react";
import { tabsStore } from "../../features/tabs/tabs-store";
import { TabsBarView } from "./TabsBarView";

const subscribeTabs = (onChange: () => void) => tabsStore.subscribe(onChange);

export function TabsBar({
  onTabClick,
  onTabClose,
  onTabsClose,
  onNewFile,
}: {
  onTabClick: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
  onTabsClose: (filePaths: string[]) => void;
  onNewFile: () => void;
}): ReactElement {
  const tabs = useSyncExternalStore(subscribeTabs, () => tabsStore.getOpenTabs());

  return (
    <TabsBarView
      tabs={tabs}
      onTabClick={onTabClick}
      onTabClose={onTabClose}
      onTabsClose={onTabsClose}
      onTabReorder={(from, to) => tabsStore.reorderTab(from, to)}
      onNewFile={onNewFile}
    />
  );
}
