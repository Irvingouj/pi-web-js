# Browsergent 效率问题修复 TDD 计划

> 诊断报告见上一轮分析。本文件是落地到 `~/code/web-js` 与 `~/code/Browsergent` 的 TDD 行动方案。参考 `~/code/agent-browser` 的实现范式。

## 参照对象：agent-browser 如何处理 ref 失效

读完 `cli/src/native/element.rs` 与 `cli/src/native/actions.rs`，要点：

1. **ref_map 仅在导航/重启浏览器时被 `.clear()`**（`handle_click` / `handle_fill` / `handle_select` 内部都**不**清空 ref_map）。点击之后 ref 仍然有效，能连续发下一个 action。
2. **ref 的失效是惰性的**：`resolve_element_object_id` 先尝试缓存的 `backend_node_id`，CDP 失败时**自动回退**用 `(role, name, nth, frame_id)` 在可访问性树里重新查询一个新鲜节点，而不是抛 observation-required。
3. **combobox 处理**：`cli/src/native/interaction.rs:424` 的 `select_option` 只对 `<select>` 有效。react-select 没有 native `<select>`，agent-browser 文档 `skill-data/core/references/snapshot-refs.md` 的"Re-Snapshot After Dynamic Changes"明确说点击后**显式**让 agent 重新 snapshot 才能用新 ref 点选项 —— 也就是 react-select 由 agent 编排，不靠 runtime 自动处理。
4. **"blocker 拦截"自检**：`check_node_interception` 在点击点做 hit-test，命中其它元素就报 `intercepted_error`，这说明 action 后真正页面状态变更才触发重新观察，而不是 mutation 事件本身。

对照 Browsergent 的 `observation-lease.ts`：用 `MutationObserver({childList,subtree:true})` 监听整棵 body，**任何 mutation（包括自己发起的）** 就 `invalidateLease()` 把所有 ref 一次性作废 → 下一个 click/fill 必报 `E_OBSERVATION_REQUIRED`。这就是 87 步里 21 次 `E_OBSERVATION_REQUIRED` 的根因。

---

## 修复目标（验收基准）

- 同一份对话重跑，`run_js` 调用数从 207 降到 ≤ 100；
- `E_OBSERVATION_REQUIRED` 从 21 次降到 0（除非 ref 真的 disconnect/fingerprint 改变）；
- 把 react-select combobox 的选中抽成第一步就能通过的"click 展开 → 点 option"流程；
- 首启动 `page.goto` 命中 `chrome://` 的失败在 prompt 层面根治。

---

## 阶段一：观察租约从激进失效改为惰性失效（根因 1，最高 ROI）

### 设计决策

仿照 agent-browser：
- **移除 body 级 `MutationObserver`**。
- 移除 `throwObservedRequired(action)` 这条路径，除非真的找不到映射。
- `requireTarget(refId)` 保留"disconnect / fingerprint_changed"两条 stale 判定，但不再因"页面别处发生 mutation"作废映射。
- action 自身发起 mutation 不失效这一点由**不挂全局 observer**天然保证。
- 顺手把 `hasActiveObservation` 这条"有无观察"门限改成"映射是否存在"，因 `page.press` 等无 refId 的 action 也只依赖 `hasActiveObservation()`，需给出"需要 snapshot"的精确信号。

### TDD 红灯 #1.1 — click 之后页面 mutation 不再导致下个 click 失效

文件：`crates/extension-js/js/src/content-script/__tests__/observation-lease.spec.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
// ponyfill the globals the module imports
beforeEach(async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><button id="a">A</button><button id="b">B</button></body></html>');
  (globalThis as any).document = dom.window.document;
  (globalThis as any).MutationObserver = dom.window.MutationObserver;
  (globalThis as any).window = dom.window;
  const mod = await import('../observation-lease');
  mod.resetLease();
});
```

测试目标：
1. `grantObservation([{refId:'e1', element: btnA}])` 之后，`document.body.insertBefore(newDiv, null)`（任意无关 DOM 变动）→ `requireTarget('e1', 'click')` **仍返回同一个 button**，不抛。
2. 点击 btnA（触发自身 mutation）→ `requireTarget('e1','click')` 返回 btnA。
3. btnA 被从 DOM 移除（`btnA.remove()`）→ `requireTarget('e1','click')` 抛 `E_STALE`，reason `disconnected`。
4. btnA 被 clone 替换（fingerprint 变化）→ 抛 `E_STALE`，reason `fingerprint_changed`。
5. `requireTarget('e2','click')`（不存在映射）→ 抛 `E_STALE` reason `not_in_latest_observation`。

预期：旧实现 1、2 失败（因为 Observer 立即 fire `invalidateLease`）；新实现全过。

### TDD 红灯 #1.2 — `page.press` 在无观察时应给出"需要 snapshot"的错误，而不是每次 mutation 后报错

文件：同上

```typescript
it('press after no snapshot → E_OBSERVATION_REQUIRED with hint to snapshot', () => {
  expect(() => /* call handlers.press */).toThrow(/requires a fresh observation|snapshot/);
});
```

修正：`hasActiveObservation()` 改为 `targets.size > 0`，`invalidateLease` 不再 exists when no targets exist (no-op). press 的"无观察"判定**只在首次 action** 路径生效；现有 snapshot 之后 mutation 不再撤销 `hasObservation`。

### 绿灯 #1.3 — 删改 `observation-lease.ts`

具体动作（待 PR 落地）：
- 删 `armObserver` / `disarmObserver` 内的 MutationObserver，或把 observer 降级为"对 targets 内 element 的 `childList` 观测，且不 invalidateLease，只在外部 API 调用时 lazy revalidate"（更接近 agent-browser 的 lazy 回退）。
- `invalidateLease` 改为只在 `back` / `forward` / `scroll` / page navigation 由 `handlers.ts` 主动调用，**别的 action 不调**。
- `grantObservation` 内不再 arm observer。

### 红灯 #1.4 — 集成回归：snapshot+click+fill 三连击不应报错

文件：`tests/observation-action-safety.spec.ts` 已存在，加新用例：
- mock 一个真实 content script + fake DOM
- 跑：snapshot → click e1 → fill e2 即可，不中间 snapshot
- 期望：全成功；旧实现会在 click 后 `E_OBSERVATION_REQUIRED` 失败。

### 绿灯 #1.5 — 对照对话回放

`scripts/replay-trace.ts`（新建，选做）：导入 `/Users/oujunyi/Downloads/browsergent-conversation-1782088451625.json` 的 trace，把 run_js 代码里的 `await page.snapshot_data()` 后跟 `page.click` 的连续步骤直接重放，断言：
- 平均每步少 1 次 snapshot；
- 总 run_js 数 ≤ 100。

---

## 阶段二：react-select combobox 专用 handler（根因 2，ROI 高）

Agent-browser 的 `select_option` 只支持原生 `<select>`，对 react-select 同样靠 agent 编排（snapshot→click option）。Browsergent 应在 runtime 把这段编排内化，否则每个 combobox 要 3 步（click 展开方 snapshot → 找 option refId → click option），18 个 combobox 就 54 步，是 turn4 灾难的本体。

### TDD 红灯 #2.1 — `page.select_option` 能选中 react-select 选项

文件：`crates/extension-js/js/src/content-script/__tests__/combobox.spec.ts`（新建）

准备一个 JSDOM + 假 react-select 结构：
```html
<div class="react-select__control" role="combobox" aria-expanded="false" aria-haspopup="listbox">
  <div class="react-select__value-container"><input role="textbox" .../></div>
</div>
```
点击 control 后由测试代码合成 `aria-expanded="true"` + 注入 `<div role="listbox"><div role="option" id="opt-yes">Yes</div><div role="option" id="opt-no">No</div></div>`。

```typescript
it('select_option on react-select combobox picks the matching option', async () => {
  const d = await simulateSnapshot();
  const controlRef = d.nodes.find(n => n.role==='combobox').refId;
  await handlers.select_option({ refId: controlRef, value: 'Yes' });
  // 断言：
  // 1. control.getAttribute('aria-expanded') 在调用后恢复 'false'
  // 2. value-container 文本 === 'Yes'
  // 3. 被点击的 option dispatched 了 click + mouseup（react-select 监听 mouseup）
});
```

### 绿灯 #2.2 — 新增 `page.select_option` handler

文件：`crates/extension-js/js/src/content-script/handlers.ts`

实现（仿 react-select 真实事件序列）：
1. `requireTarget(refId)` → combobox control。
2. 若 node 是 `HTMLSelectElement` → 复用现有 `select` handler。
3. 若 `role==='combobox'` →
   - `el.click()`；
   - `await microtask`；在 `document` 里查 `[role="listbox"] [role="option"]`，文本拿 `.trim() === value`（忽略大小写，未匹配则抓 candidates 报 `E_NOT_FOUND`）；
   - `option.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`；
   - `option.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`；
   - `option.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))`；
   - `option.click()`；
   - `await raf`，重抓 control 断言 `aria-expanded==='false'` 与 value-container 文本 === value；失败报 `E_NOT_SELECT` 带 candidates。
4. 返回 `makeActionResult('select_option', el, { value })`。

事件列表核对：react-select `SelectOption.js` 真实只要 `mousedown` + `mouseup` 后 `click`，以上顺序确保事件触发。

### 红灯 #2.3 — 不匹配时报结构化错误 + candidates

```typescript
it('select_option with unknown value lists available options', async () => {
  await expect(handlers.select_option({ refId, value: 'Maybe' }))
    .rejects.toMatchObject({ code: 'E_NOT_FOUND', details: { candidates: ['Yes','No'] }});
});
```

### 绿灯 #2.4 — schema 暴露给 agent

文件：`crates/extension-js/js/src/shared/schemas.ts`

新增 `PageSelectOptionParams` 与 `"select_option"` handler 名。`Browsergent/src/worker/agent-tools.ts` 错误 hint 表加一行 `E_NOT_SELECT` 的恢复提示。

### 红灯 #2.5 — prompt 文档新增 `page.select_option`

文件：`Browsergent/src/worker/js-tool-prompt.ts`

在 agent 可见 API 列表里加：
```
page.select_option({refId, value}) — opens a combobox (react-select/listbox)
  and clicks the option whose text matches value. Use for Greenhouse/Workday/Lever
  dropdowns where page.select fails.
```

并加一条示例对照 react-select 用法，避免 agent 再走 `page.fill(combobox)+press(Enter)` 弯路。

### 绿灯 #2.6 — 对照回放

把对话中 18 个 combobox 步骤替换为单步 `page.select_option`，断言整个 turn4 ≤ 30 步（原来 53 步）。

---

## 阶段三：首启动不再 `E_PERMISSION`（根因 3，小而必做）

### 红灯 #3.1

文件：`Browsergent/tests/unit/agent-prompt-policy.spec.ts`

```typescript
it('prompt teaches agent to use tab.list/activate before page.goto on cold start', () => {
  const prompt = buildJsToolPrompt();
  expect(prompt).toMatch(/cold start|first action/i);
  expect(prompt).toMatch(/web\.tab\.list\(\)/);
});
```

### 绿灯 #3.2

`js-tool-prompt.ts` 追加：
```
COLD START:
- The active tab after extension launch is chrome://newtab. page.goto will
  refuse it (E_PERMISSION). First call await web.tab.list(); if none are
  http(s), call await web.tab.newhttps("https://example.com/"); then
  await web.tab.activate(tabId). Only then use page.* operations.
```

---

## 阶段四：activity-tab 漂移的确定性失效（根因 4，防止跨 tab 错误）

目标：`tab.activate` / `page.goto` 之后，老观察租约应**只**因 tab 切换失效，不应因"页面 random mutation"失效；同时下一次 `page.*` 能自动重定位到前面激活的 tab，避免 stale ref 对准旧 tab。

### 红灯 #4.1

文件：`crates/extension-js/js/src/main/runner/__tests__/activate-tracks-active-tab.spec.ts`

```typescript
it('tab.activate invalidates observation lease and re-points page.* at the new tab', async () => {
  const a = await runner.openTab('https://example.com/a');
  const b = await runner.openTab('https://example.com/b');
  await runner.snapshot(a);              // observe tab A
  await runner.activateTab(b);
  // 旧 refId 不应在新 tab 上 Gecko；任何使用应报 E_STALE / E_OBSERVATION_REQUIRED
  await expect(runner.click(a, 'e1')).resolves.toMatchObject({ ok:false, error:'E_STALE' });
  // 新 snapshot on b 后能 click 新 refId
  const d = await runner.snapshot(b);
  await expect(runner.click(b, d.nodes[0].refId)).resolves.toMatchObject({ ok:true });
});
```

### 绿灯 #4.2

`main/runner/runtime.ts` 追踪 `lastActivatedTabId`；每次 `tab.activate` / `page.goto` 后调 `invalidateLease()` 只能在 handler 入口处，不在 MutationObserver 回调里；写入 `lastActivatedTabId` 并在 `page.*` 入口校对目标 tab。

---

## 阶段五：ref 缓存与 lazy 回退（向 agent-browser 对齐）

### 红灯 #5.1 — 点击之后页面把元素替换为同 role+name 的新节点应可继续 action

文件：`crates/extension-js/js/src/content-script/__tests__/stale-ref-recovery.spec.ts`

```typescript
it('click on ref whose element was re-rendered but same role+name resolves via fallback', async () => {
  grantObservation([{ refId:'e1', element: oldButton }]);
  document.body.replaceChild(newButtonSameRoleName, oldButton);
  // requireTarget('e1') 旧实现 fingerprint_changed 抛错；新实现回退查询后返回新 button
  const el = requireTarget('e1', 'click');
  expect(el).toBe(newButtonSameRoleName);
});
```

### 绿灯 #5.2 — 给 `requireTarget` 加 fallback

仿 agent-browser `element.rs:513` 的 `find_node_id_by_role_name`：当 fingerprint mismatch，按 (role, accessibleName, nth) 在当前 document 重新查找元素；找到则透明替换 targets 里的 entry、返回新元素；找不到才抛 `E_STALE`。

注意：这会让"被广告覆盖原按钮"误填风险。加 `check_node_interception` 同款 hit-test（命中别的元素就抛 `intercepted_error`），与 agent-browser 对齐。

---

## 阶段六：清理（完成上 5 阶段后做）

- 把 `observation-lease.ts` 注释重写：把"Invalidation strategy: childList+subtree MutationObserver armed on grant"改成"策略：lazy 再校验 + navigation 主动失效"，删去 MutationObserver 相关代码。
- `Browsergent/src/worker/agent-tools.ts` 错误 hint 表：把 `E_OBSERVATION_REQUIRED` 的 hint 从"snapshot again"改成"normal in SPA after click; try again — lazy ref refresh will re-resolve"，消除"snapshot 前先 always snapshot"的条件反射。
- `AGENTS.md` 里 "Testing Invariant" 章节补一句：observation lease 失效**只**发生在 navigation 与 `requireTarget` 失败时，不在 mutation 事件上。

---

## 执行顺序与预估

| 阶段 | 红灯测试数 | 预估步数降幅（重放对话） | 风险 |
|---|---|---|---|
| 1. 租约惰性化 | 4 | 87→60 | 低：删 observer 反而减少状态复杂度 |
| 2. select_option | 5 | 60→40 | 中：需真机 react-select 回归 |
| 3. cold-start prompt | 1 | -1 步 | 零 |
| 4. activate 追踪 | 2 | -5 错步 | 中：涉及 runner 主线程路径 |
| 5. lazy ref 回退 | 2 | 60→35 | 中：要加 hit-test |
| 6. 清理 | 0 | — | 零 |

四个阶段完成后重放导出的对话，期望：
- `run_js` 调用：207 → **≤ 60**
- 错误：34 → **≤ 3**
- 壁钟：17.5 min → **≤ 8 min**

---

## 不会做的事

- 不碰 `page_goto` 对 `chrome-extension://`/`chrome://` 的拒绝逻辑（AGENTS.md 明文的安全不变量，必须保留）。
- 不给 `page.select` 加 react-select 兼容（新加 `page.select_option` 而不污染原语义；原 select 对 `<select>` 仍正确）。
- 不改 pi-host WASM 核心（lease 是 content-script 层逻辑，与核心无关）。
- 不加文件读取缓存（`file_read` 重复拉 175KB JSON 是问题 #6，但不占前五大成本；留作后续观察）。