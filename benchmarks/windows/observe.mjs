import { setTimeout as delay } from "node:timers/promises";

const [port, operation, argument] = process.argv.slice(2);
let target;
for (let i = 0; i < 100 && !target; i++) {
  try {
    const list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
    target = list.find((entry) => entry.type === "page" && /^(amark:|https?:)/.test(entry.url));
  } catch {}
  if (!target) await delay(200);
}
if (!target) throw new Error("Application window did not start");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
const pending = new Map();
let id = 0;
socket.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  const task = pending.get(msg.id);
  if (!task) return;
  pending.delete(msg.id);
  if (msg.error) task.reject(Error(msg.error.message));
  else task.resolve(msg.result);
};
function send(method, params) {
  const seq = ++id;
  return new Promise((resolve, reject) => {
    pending.set(seq, { resolve, reject });
    socket.send(JSON.stringify({ id: seq, method, params }));
  });
}
async function evaluate(expression) {
  const reply = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (reply.exceptionDetails)
    throw Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
  return reply.result.value;
}
const read = () =>
  evaluate(`(() => {
  const mirror = document.querySelector(".amark-typeset-mirror");
  const text = mirror?.textContent ?? "";
  return {
    rows: document.querySelectorAll(".workspace-tree-file").length,
    tabs: document.querySelectorAll(".tabs-list .tab").length,
    mode: document.querySelector(".view-mode-btn.active")?.dataset.mode,
    agent: navigator.userAgent, visible: document.visibilityState, width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    length: text.length, revision: Number(/AMARK-SOAK-(\\d+)/.exec(text)?.[1] ?? -1)
  };
})()`);
async function until(check) {
  let state;
  for (let i = 0; i < 80; i++) {
    state = await read();
    if (check(state)) return state;
    await delay(200);
  }
  throw Error("Unexpected workspace state: " + JSON.stringify(state));
}
try {
  if (operation === "maximize") {
    await until((s) => s.tabs > 0);
    const maximized = () =>
      evaluate("Boolean(document.querySelector('.window-control-maximize .lucide-copy'))");
    if (!(await maximized()))
      await evaluate("document.querySelector('.window-control-maximize').click()");
    await delay(750);
    if (!(await maximized())) throw Error("Could not maximize application window");
    console.log(JSON.stringify(await read()));
  } else if (operation === "viewport") {
    console.log(JSON.stringify(await read()));
  } else if (operation === "init") {
    const expectedRows = Number(argument);
    await until((s) => s.rows === expectedRows && s.tabs > 0);
    const names = await evaluate(
      "Array.from(document.querySelectorAll('.workspace-tree-file-name')).map(el => el.textContent).filter(n => n !== 'soak-active.md').slice(0, 4)",
    );
    for (const name of [...names, "soak-active.md"]) {
      await evaluate(
        "Array.from(document.querySelectorAll('.workspace-tree-file-name')).find(el => el.textContent === " +
          JSON.stringify(name) +
          ").click()",
      );
      await delay(350);
    }
    await evaluate("document.querySelector('[data-mode=preview-only]').click()");
    console.log(
      JSON.stringify(
        await until(
          (s) =>
            s.tabs >= 5 && s.mode === "preview-only" && s.revision === 0 && s.visible === "visible",
        ),
      ),
    );
  } else if (operation === "release") {
    while (
      await evaluate("Boolean(document.querySelector('.tabs-list .tab:not(.active) .tab-close'))")
    ) {
      await evaluate("document.querySelector('.tabs-list .tab:not(.active) .tab-close').click()");
      await delay(100);
    }
    console.log(JSON.stringify(await until((s) => s.tabs === 1 && s.revision >= 0)));
  } else if (operation === "verify") {
    console.log(
      JSON.stringify(
        await until((s) => s.revision === Number(argument) && s.visible === "visible"),
      ),
    );
  } else {
    throw Error("Unknown operation");
  }
} finally {
  socket.close();
}
