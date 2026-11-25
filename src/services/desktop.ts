import type { Commands, CommandArgs, DesktopBridge } from "../../shared/desktop";
declare global {
  interface Window {
    amark: DesktopBridge;
  }
}

/** Unwrap errors in the renderer so structured filesystem errors retain their fields. */
export async function invoke<K extends keyof Commands>(
  name: K,
  ...args: CommandArgs<K>
): Promise<Commands[K]["returns"]> {
  const reply = await window.amark.invoke(name, ...args);
  if (!reply.ok) throw reply.error;
  return reply.value;
}
