# Greenhouse Combobox Observations

## Top 3 Tasks

### 1. Fix `page.select_option` Scoping

Value: highest. This is the root cause.

Current code in `crates/extension-js/js/src/content-script/handlers.ts` builds scoped roots, then falls back to every document listbox option. That fallback lets `#iti-0__country-listbox` poison target selection.

Test in existing infra:

- Add unit test under `select_option handler` in `crates/extension-js/js/test/content-script.test.ts`.
- Fixture:
  - persistent visible `#iti-0__country-listbox` with `Afghanistan+93`, `Canada+1`
  - target `input role="combobox" aria-label="Degree"`
  - target opens `#react-select-degree--0-listbox` with `Bachelor's Degree`
- Assert `page_select_option(Degree, "Bachelor's Degree")` clicks degree option, not phone listbox.
- Assert missing value candidates come from target listbox, not phone listbox.

### 2. Add Greenhouse-Shaped E2E Fixture

Value: prevents toy-test pass.

Existing unit tests cover simplified listbox cases. Missing shape is persistent unrelated phone listbox plus portal-style react-select fields.

Mock page should be a local static testcase, not real Greenhouse. Put it at:

`testcases/greenhouse-combobox/index.html`

Required page shape:

- Single job-application form with visible label text similar to Greenhouse:
  - `Country`
  - `Degree`
  - `Veteran Status`
  - `Disability Status`
- `Country` field behaves like `intl-tel-input`:
  - visible combobox/search input
  - global listbox id `iti-0__country-listbox`
  - 200+ country options is not needed; 5 enough if first options match failure shape:
    - `Afghanistan+93`
    - `Aland Islands+358`
    - `Albania+355`
    - `Canada+1`
    - `United States+1`
  - listbox remains in DOM and visible/present after selecting `Canada+1`
- `Degree`, `Veteran Status`, `Disability Status` behave like react-select:
  - input has `role="combobox"`
  - clicking/focusing opens listbox in a portal under `document.body`, not inside field wrapper
  - popup id resembles `react-select-degree--0-listbox`
  - options have `role="option"`
  - selecting option updates visible selected value and hidden/input state
- At least one unrelated listbox exists before target combobox opens.
- Status element records exact selection events for assertions, e.g.:
  - `country:Canada+1`
  - `degree:Bachelor's Degree`
  - `veteran:I don't wish to answer`
  - `disability:No`

Minimal HTML behavior is enough. No real React needed. Plain JS can create portal listboxes and dispatch click handlers.

Test in existing infra:

- Add `testcases/greenhouse-combobox/index.html`.
- Add `web/tests/e2e/extension/greenhouse-combobox.spec.ts`.
- Use existing `activateTestcaseTab` / `runAgentCell`.
- Fixture fields:
  - `Country`
  - `Degree`
  - `Veteran Status`
  - `Disability Status`
- Fixture behavior:
  - phone widget creates persistent global `#iti-0__country-listbox`
  - react-select-like fields render portal listboxes outside control
  - one unrelated listbox is already present before target opens
- E2E cell: snapshot once, select country, then select degree/veteran/disability in same run.
- Verify DOM status contains:
  - `degree:Bachelor's Degree`
  - `veteran:I don't wish to answer`
  - `disability:No`

### 3. Improve `select_option` Failure Diagnostics

Value: stops model retry loops.

Current error shows candidates, but not which listbox was searched or ignored. The model had to infer phone-listbox poisoning from `Afghanistan+93`.

Test in existing infra:

- Add unit test in `crates/extension-js/js/test/content-script.test.ts`.
- Fixture:
  - target opens degree listbox
  - phone listbox also present
  - requested value missing
- Assert structured error includes:
  - `targetRefId`
  - target name/label
  - searched listbox ids
  - ignored listbox ids
  - candidates from searched target roots only

Skipped for now: `page.fill_form`. Useful later, but too broad. Fix primitive first; Greenhouse-shaped fixture proves behavior.

Source: Browsergent conversation export:

`/Users/oujunyi/Downloads/browsergent-conversation-1782173213075.json`

Export metadata:

- `exportedAt`: `2026-06-23T00:06:52.966Z`
- `messages`: 59
- `trace`: 51 entries
- `diagnostics`: 40,768 entries
- packages: `browsergent@0.1.0`, `pi-host-web@^0.9.3`, `extension-js@^0.10.2`

Also verified with direct `agent-browser` inspection of:

`https://job-boards.greenhouse.io/canonical/jobs/7982278`

## What Happened

This page is genuinely hard for generic browser agents.

The form exposes many fields through accessible roles, but dropdown behavior is split across multiple JS widgets:

- 18 Greenhouse `react-select` comboboxes in the application form.
- 1 extra `intl-tel-input` phone-country combobox/search input.
- The phone widget creates global listbox `#iti-0__country-listbox`.
- That listbox contains 244 country options.
- That listbox stays visible/present in DOM after interacting with the country field.
- Other comboboxes do not expose clean popup ownership until opened.

Observed with `agent-browser`:

- Initial snapshot showed all expected fields, including `Veteran Status` and `Disability Status`.
- Clicking `Country` opened `#iti-0__country-listbox`.
- DOM had one visible listbox with candidates starting `Afghanistan+93`, `Aland Islands+358`, `Albania+355`.
- Clicking/filling `Degree` while phone listbox was open did not reliably open the degree listbox.
- `Escape` and selecting `Canada+1` did not remove the phone listbox from DOM in the inspected session.

## Export Evidence

Key trace refs from `/Users/oujunyi/Downloads/browsergent-conversation-1782173213075.json`:

- `tx-75ce6ee3-17`: one snapshot found 26 textboxes and 15 comboboxes; country select worked, several other `select_option` calls failed with phone-country candidates.
- `tx-6b45fded-19`: probing difficult comboboxes showed repeated candidates from `Afghanistan+93`, `Aland Islands+358`, `Albania+355`, confirming searches hit the phone listbox.
- `tx-6b45fded-22`: fresh page run found 29 textboxes and 18 comboboxes; `School`, `Degree`, `Discipline`, privacy, veteran/disability-style fields failed because candidate list came from country/phone listbox.
- `tx-6d9db31e-35`: strongest evidence. Calling `page.select_option` on `Degree` with `"Bachelor's Degree"` failed while DOM then showed 2 listboxes:
  - `[0] id="iti-0__country-listbox" children=244`
  - `[1] id="react-select-degree--0-listbox" children=11`
  - degree listbox contained `"Bachelor's Degree"`, but error candidates came from phone listbox.
- `tx-6d9db31e-39`: workaround run filled 28 actions using `fill + Enter` for react-select-style fields.
- `tx-6d9db31e-44`, `tx-6d9db31e-47`, `tx-6d9db31e-48`: submit clicks with `page.dom()` refs failed as `E_STALE`, showing DOM refs/action refs had confusing lifecycle.

## Real Issue

`page.select_option(refId, value)` searched available listboxes too broadly.

When selecting `Degree = "Bachelor's Degree"`, correct page state could include:

- unrelated phone listbox: `#iti-0__country-listbox`
- target react-select listbox: `#react-select-degree--0-listbox`

The failing implementation saw the phone listbox first and searched country options for `"Bachelor's Degree"`.

That produced errors like:

```text
Element not found by label "Bachelor's Degree".
Candidates: Afghanistan+93, Aland Islands+358, Albania+355...
```

The option value was not the main bug. Popup ownership was.

## Why Agents Struggled

The model was asked to fill form fields, but runtime forced it to infer widget mechanics.

Hard parts:

- multiple open/present listboxes
- portal-style dropdown rendering
- persistent phone country listbox
- stale refs after DOM changes
- weak error context
- `select_option` behavior not scoped to target combobox

This is not just a model weakness. A stronger model with a better harness still had trouble because the primitive was ambiguous.

## Improvements

### 1. Scope `select_option` to target popup

After activating a combobox, choose only the popup owned by that combobox.

Priority:

1. `aria-controls`
2. `aria-owns`
3. newly opened listbox after activation
4. nearest visible portal tied to target input id/name

Ignore unrelated existing listboxes such as `iti-*`.

### 2. Add widget adapters

Runtime should handle common dropdown widgets:

- `react-select`: focus/fill input, wait menu, choose matching option
- `intl-tel-input`: use search input + country listbox
- native `select`: use normal select path

The model should not rediscover this per task.

### 3. Improve diagnostics

Current error:

```text
Candidates: Afghanistan+93...
```

Better error:

```text
target=degree--0
opened=react-select-degree--0-listbox
ignored=iti-0__country-listbox
searched=react-select-degree--0-listbox
```

If wrong listbox was searched, say so directly.

### 4. Add popup relationship data to snapshots

Snapshot nodes should include:

- `popupId`
- `expanded`
- `ownerRefId`
- `portal`
- `optionCount`

This lets the agent see structure instead of guessing from flat candidates.

### 5. Add form-level primitive

Add something like:

```ts
page.fill_form({
  fields: [
    { label: "Degree", value: "Bachelor's Degree" },
    { label: "Veteran Status", value: "I don't wish to answer" }
  ]
})
```

Runtime maps labels, chooses widget strategy, verifies state.

### 6. Add anti-loop guard

If same API + same target + same candidate prefix fails twice, stop retrying.

Force next step to inspect popup ownership or return limitation.

## Bottom Line

This page is hard because dropdown mechanics are ambiguous at browser-agent level.

Fix belongs in runtime primitives, not prompt wording.
