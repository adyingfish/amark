// tabs-types.ts - Tabs domain types

export interface TabState {
  openTabs: TabInfo[];
  activeTabPath: string | null;
}

export interface TabInfo {
  filePath: string;
  fileName: string;
  isDirty: boolean;
  isActive: boolean;
}

export interface TabCloseRequest {
  filePath: string;
}

export interface TabSwitchRequest {
  filePath: string;
}
