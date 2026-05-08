# opencode-figma Plugin

Control Figma Desktop directly from OpenCode. Full read/write access via Yolo Mode (CDP). No API key required.

## Quick Reference

**Plugin location:** `E:\work\opencode-figma` — always run commands via `node bin/opencode-figma <command>` using the **bash tool**.

| User says | CLI command |
|-----------|-------------|
| "connect to figma" | `node bin/opencode-figma connect` |
| "add shadcn colors" | `node bin/opencode-figma tokens shadcn` |
| "add tailwind colors" | `node bin/opencode-figma tokens tailwind` |
| "show colors on canvas" | `node bin/opencode-figma tokens --action visualize` |
| **"create a button / input / text field"** (reusable UI) | **OpenCode:** `figma_build` `kind=button` \| `kind=input` (best for agents), or `figma_recipe` `recipe=button` \| `recipe=input`. **Never** answer with Figma UI tutorials — always call a tool. **CLI:** `node bin/opencode-figma component create-set`. |
| **"create a card / badge"** etc. | **`figma_component` create-set** or single `create` with JSX |
| **"use the Button inside a Card"** | **`<Instance component="Button"/>` inside `node bin/opencode-figma render`** |
| "create a one-off layout / hero / page" | `node bin/opencode-figma render '<JSX>'` |
| "create a rectangle/frame" | `node bin/opencode-figma create frame "Name"` |
| "convert to component" | `node bin/opencode-figma node to-component` |
| "list variables" | `node bin/opencode-figma var list` |
| "find nodes named X" | `node bin/opencode-figma find "X"` |
| "what's on canvas" | `node bin/opencode-figma analyze canvas` |
| "export as PNG/SVG" | `node bin/opencode-figma export png [nodeId]` |
| "take screenshot" | `node bin/opencode-figma screenshot [nodeId]` |

**Full command reference:** Run `node bin/opencode-figma --help` or see README.md

---

## Design Tokens

### Add shadcn Colors
```bash
node bin/opencode-figma tokens shadcn
# Creates 244 primitives + 32 semantic variables (Light/Dark modes)
```

### Add Tailwind Colors
```bash
node bin/opencode-figma tokens tailwind
# Creates 242 primitive colors only
```

### Create Design System
```bash
node bin/opencode-figma tokens ds
# IDS Base colors
```

### Delete All Variables
```bash
node bin/opencode-figma var delete-all
node bin/opencode-figma var delete-all --collection primitives
```

---

## Fast Variable Binding (var: syntax)

Use `var:name` syntax to bind variables directly at creation:

### Create with var:
```bash
node bin/opencode-figma create rect "Card" --fill "var:card" --stroke "var:border"

node bin/opencode-figma create text "Hello" --fill "var:foreground"

node bin/opencode-figma create icon "star" --icon "lucide:star" --fill "var:primary"
```

### JSX Render with var:
```bash
node bin/opencode-figma render '<Frame bg="var:card" stroke="var:border" rounded={12} p={24}>
    <Text color="var:foreground" size={18}>Title</Text>
  </Frame>'
```

### FLOAT variables (spacing, radius, opacity, stroke weight)

- **`var:` on colors** resolves **COLOR** tokens (`fill`, `stroke`, `bg`, `color` in JSX).
- **`var:` on numbers** resolves **FLOAT** tokens: use **`node bin/opencode-figma set`** (`gap`, `paddingLeft`, `radius`, `strokeWidth`, `opacity`, `fontSize`, `width`, `height`, …) or JSX props **`gap`**, **`p`** / **`px`** / **`py`**, **`rounded`**, **`strokeWidth`**, **`opacity`**, **`size`** (text). First `/` separates collection from variable name (same as colors).

```bash
node bin/opencode-figma set gap "var:semantic/spacing/md" --node "123:456"
node bin/opencode-figma set paddingLeft "var:spacing/4"
```

---

## Connection (CDP only)

Patches Figma once, then connects via **Chrome DevTools Protocol (CDP)**. There is **no plugin-based “safe connect”** in this build — use CDP only. If Figma wasn't running, `connect` launches it and waits for a **canvas tab** — open any file from Recents if you only see home (~90s window).

```bash
node bin/opencode-figma connect
```

Optional: **`figma_settings`** — default **`strict: false`** so mutating tools can target the **current selection** when `nodeId` is omitted. Set **`strict: true`** only if you want to force explicit ids on every mutation.

---

## Creating Components (THE RIGHT WAY)

**CRITICAL**: When the user asks to "create a Button", "design Cards", "build a
component library", or anything that implies a *reusable* UI element — use
`figma_component`, **NOT** `figma_render` or `figma_create`. Never produce
"Button 1", "Button 2", "Button 3" as separate frames. Make ONE Button
component-set with State variants, then use **instances**.

### Pattern 1 — A component with multiple states (Button, Input, Badge…)

```javascript
figma_component({
  action: "create-set",
  name: "Button",
  variants: [
    {
      properties: { State: "Default" },
      jsx: '<Frame name="Button" flex="row" gap={8} px={16} py={10} bg="var:primary" rounded={8} justify="center" items="center"><Text name="Label" size={14} weight="medium" color="var:primary-foreground">Click me</Text></Frame>'
    },
    {
      properties: { State: "Hover" },
      jsx: '<Frame name="Button" flex="row" gap={8} px={16} py={10} bg="var:primary" rounded={8} justify="center" items="center" opacity={0.9}><Text name="Label" size={14} weight="medium" color="var:primary-foreground">Click me</Text></Frame>'
    },
    {
      properties: { State: "Disabled" },
      jsx: '<Frame name="Button" flex="row" gap={8} px={16} py={10} bg="var:muted" rounded={8} justify="center" items="center" opacity={0.5}><Text name="Label" size={14} weight="medium" color="var:muted-foreground">Click me</Text></Frame>'
    }
  ]
})
```

The variant property key/value pairs (`State=Default`, `State=Hover`) become
real Figma variant properties on the component set, so the user can switch
states from the right-rail.

### Pattern 2 — A simple, single-variant component (Card, Header, Footer…)

```javascript
figma_component({
  action: "create",
  name: "Card",
  jsx: `<Frame flex="col" gap={12} p={20} bg="var:card" rounded={12} stroke="var:border" w={320}>
    <Text name="Title" size={18} weight="semibold" color="var:card-foreground">Card title</Text>
    <Text name="Description" size={14} color="var:muted-foreground">Description here.</Text>
    <Instance name="Action" component="Button" variant="State=Default" Label="View details"/>
  </Frame>`
})
```

> Inside a component, name the text nodes (`name="Title"`, `name="Description"`)
> so they can be overridden per-instance later.

### Pattern 3 — Use the components inside layouts via `<Instance>`

```javascript
figma_render({
  jsx: `<VStack gap={32} p={48} bg="var:background">
    <Text size={32} weight="bold" color="var:foreground">Buttons</Text>
    <HStack gap={16}>
      <Instance component="Button" variant="State=Default" Label="Primary"/>
      <Instance component="Button" variant="State=Hover" Label="Hover"/>
      <Instance component="Button" variant="State=Disabled" Label="Disabled"/>
    </HStack>

    <Text size={32} weight="bold" color="var:foreground">Cards</Text>
    <HStack gap={24}>
      <Instance component="Card" Title="Welcome" Description="Get started in seconds." Action="Get started"/>
      <Instance component="Card" Title="Pricing" Description="Pay only for what you use." Action="See pricing"/>
    </HStack>
  </VStack>`
})
```

**How `<Instance>` overrides work:**
- `component="Card"` — looks up the component by name (or id, or `Set/Variant`).
- `variant="State=Hover, Size=Lg"` — sets variant properties on the instance.
- Any other prop (`Title="Welcome"`, `Action="Get started"`) is matched against
  a child node by name. If the child is a TEXT node, its characters are set.
  If the child is itself an INSTANCE (nested component), the override is set
  on its inner `Label` / first text node — so `Action="Get started"` on a
  Card propagates into the Card's Button instance automatically.

---

## Complex Components

For complex multi-element components, use `node bin/opencode-figma eval` with native Figma API:

```bash
node bin/opencode-figma eval "
  const colors = {
    bg: { r: 0.09, g: 0.09, b: 0.11 },
    card: { r: 0.11, g: 0.11, b: 0.13 },
    primary: { r: 0.23, g: 0.51, b: 0.97 }
  };
  // Create components...
"
```

---

## JSX Syntax (`figma_render` and `figma_component`)

### Tags

```jsx
<Frame ...>...</Frame>      // explicit frame
<VStack ...>...</VStack>    // frame with flex="col" by default
<HStack ...>...</HStack>    // frame with flex="row" by default
<Stack ...>...</Stack>      // alias for VStack
<Row .../> <Column .../>    // alias for HStack / VStack

<Text ...>Hello</Text>
<H1 .../> <H2 .../> <H3 .../> <H4 .../> <Label .../>  // text with default sizes

<Rect .../> <Ellipse .../>  // shapes

<Instance component="Button" variant="State=Hover" Label="Click me"/>  // reuse a component
```

### Props

```jsx
// Layout
flex="row" | "col"      // (or use HStack / VStack)
gap={16}
p={24}
px={16} py={8}
pl/pr/pt/pb={...}

// Alignment
justify="center"        // main axis: start | center | end | between
items="center"          // cross axis: start | center | end
wrap                    // boolean or wrap / nowrap — row wraps to next line
rowGap={8}              // gap between wrapped rows (counterAxisSpacing); alias crossGap
alignSelf="stretch"    // on child: start | center | end | stretch | baseline
grow={1}               // layoutGrow inside auto-layout (true = 1)
minW maxW minH maxH     // min/max constraints (numbers)

// Size
w={320} h={200}         // fixed
w="fill" h="fill"       // stretch (inside auto-layout)
w="hug" h="hug"         // shrink to content

// Appearance
bg="#fff"               // background fill
bg="var:card"           // variable
stroke="#000" strokeWidth={2}
rounded={16}
opacity={0.9}

// Text
<Text size={18} weight="bold" color="var:foreground" font="Inter">Hello</Text>
// weight: regular | medium | semibold | bold | light
```

### Reuse via `<Instance>`

```jsx
<Instance component="Button"/>
<Instance component="Button" variant="State=Hover"/>
<Instance component="Card" Title="Welcome" Description="..." Action="Open"/>

// Nested overrides reach inner instances automatically:
//   Card has <Instance name="Action" component="Button" .../>
//   Action="Open" → updates the inner Button's Label text node
```

---

## Key Rules

1. **Reusable UI = `figma_component` (+ `figma_recipe` for Button/Input).** Buttons/Inputs with states → prefer `figma_recipe recipe=button|input`, otherwise `create-set`. Anything used more than once goes through components — never duplicate masters ("Button 1", "Card 2", etc.).
2. **Layouts that consume components use `<Instance>`** in `figma_render` — not raw frames that look like the component.
3. **One-off compositions** (a hero, a screen, a marketing section) → `figma_render`.
4. **A single primitive** (just a frame, just a circle) → `figma_create`.
5. **Name your text nodes** inside components (`name="Title"`, `name="Label"`, `name="Action"`) so consumers can override them via `<Instance Title="..."/>`.
6. **Check connection first** — run `node bin/opencode-figma connect` if any command fails with "Cannot connect to Figma".
7. **Don't use `figma_eval` to create nodes** — it has no smart positioning, things stack at (0,0).
8. **No Shell pipelines for components.** Never chain Terminal create/find/convert/render to fake a Button/Input set — use recipes or `create-set`.
9. **Never teach manual Figma UI for what tools can do.** If the user wants an input or button *in their file*, call `figma_build` or `figma_recipe` — do not write "Step 1: create three frames…".

---

## Onboarding ("Initiate Project")

**Never show terminal commands or tool names (figma_recipe, connect, etc.) to users.** They work in natural language; you run the tools for them.

1. On first Figma action in OpenCode, **`getClient` auto-runs local connect** if needed — users do not pick a “connect command”.
2. Only if auto-setup fails: tell them to **open Figma Desktop** and **open a design file tab**, then retry the same natural-language request.

If permission error (macOS): System Settings → Privacy → Full Disk Access → Add Terminal or the app running OpenCode’s agent

---

## Variable Visualization

"Show colors on canvas" / "display variables":

```bash
node bin/opencode-figma tokens --action visualize              # All collections
node bin/opencode-figma tokens --action visualize --filter "primitives" # Filter
```

Creates shadcn-style color swatches bound to variables.

---

## Website Recreation

```javascript
// Not yet implemented - coming soon
// figma_recreate({ url: "https://example.com" })
```

---

## Speed Daemon

Connection auto-starts daemon for 10x faster commands.

```bash
node bin/opencode-figma daemon status
node bin/opencode-figma daemon restart
```

---

## Troubleshooting

### Not Connected
```bash
node bin/opencode-figma connect
```

### macOS Permission Error
Grant Full Disk Access to Terminal:
1. System Settings → Privacy & Security → Full Disk Access
2. Click + and add Terminal
3. Quit Terminal completely (Cmd+Q) and reopen

