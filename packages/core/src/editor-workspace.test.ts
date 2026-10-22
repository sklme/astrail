import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "jsonc-parser"
import { describe, expect, it } from "vitest"
import { stringify } from "yaml"
import {
  applyEditorWorkspace,
  planEditorWorkspace,
  syncEditorWorkspace,
} from "./editor-workspace.js"
import { pathExists } from "./fs.js"
import { loadWorkspace } from "./manifest.js"
import { resolveWorkspace } from "./resolver.js"

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "astrail-editor-"))
  await mkdir(join(root, "code", "api"), { recursive: true })
  const config = {
    apiVersion: "astrail.dev/v1alpha1",
    kind: "Workspace",
    metadata: { name: "editor" },
    repositories: {
      platform: { access: "read-write", source: { type: "local", path: "code" } },
    },
  }
  await writeFile(join(root, "astrail.yaml"), stringify(config))
  return { root, config }
}

describe("editor workspace", () => {
  it.each([
    { name: "hypha", directory: "folder", expected: "hypha" },
    { name: "", directory: "Team Project", expected: "Team Project" },
    { name: "../unsafe", directory: "folder", expected: "folder" },
    { name: "", directory: "unsupported:name", expected: "astrail" },
  ])(
    "derives the filename as $expected from available names",
    async ({ name, directory, expected }) => {
      const parent = await mkdtemp(join(tmpdir(), "astrail-editor-name-"))
      const root = join(parent, directory)
      await mkdir(root)
      const plan = await planEditorWorkspace({
        root,
        config: {
          apiVersion: "astrail.dev/v1alpha1",
          kind: "Workspace",
          metadata: { name, displayName: "Display label" },
        },
        topology: { repositories: [], environments: [] },
        diagnostics: [],
      })
      expect(plan.workspacePath).toBe(join(root, `${expected}.code-workspace`))
      expect(plan.diagnostics).toEqual([])
      expect(await pathExists(plan.workspacePath)).toBe(false)
    },
  )

  it("keeps an explicit workspace filename ahead of metadata and directory names", async () => {
    const { root, config } = await fixture()
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({ ...config, editor: { workspaceFile: "custom.code-workspace" } }),
    )
    const plan = await planEditorWorkspace(await resolveWorkspace({ cwd: root }))
    expect(plan.workspacePath).toBe(join(root, "custom.code-workspace"))
  })

  it("composes shared/local editor preferences with provenance and rejects unsafe filenames", async () => {
    const { root, config } = await fixture()
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({ ...config, editor: { workspaceFile: "team.code-workspace", default: "vscode" } }),
    )
    await writeFile(
      join(root, "astrail.local.yaml"),
      stringify({
        apiVersion: config.apiVersion,
        kind: "WorkspaceLocal",
        editor: { default: "codebuddy", executables: { codebuddy: "/Apps/My Editor" } },
      }),
    )
    const loaded = await loadWorkspace({ cwd: root })
    expect(loaded.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    expect(loaded.effective.editor).toEqual({
      workspaceFile: "team.code-workspace",
      default: "codebuddy",
      executables: { codebuddy: "/Apps/My Editor" },
    })
    expect(loaded.provenance["/editor/default"]?.at(-1)?.kind).toBe("local")
    for (const workspaceFile of [
      "../outside.code-workspace",
      "nested/a.code-workspace",
      "a\\b.code-workspace",
      "file.json",
    ]) {
      await writeFile(
        join(root, "astrail.local.yaml"),
        stringify({
          apiVersion: config.apiVersion,
          kind: "WorkspaceLocal",
          editor: { workspaceFile },
        }),
      )
      expect(
        (await loadWorkspace({ cwd: root })).diagnostics.some((d) => d.severity === "error"),
      ).toBe(true)
      const synced = await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))
      expect(synced.success).toBe(false)
      expect(synced.data.changed).toBe(false)
    }
  })

  it("deduplicates Git/local/subpath and physical aliases, uses local overrides, skips missing/disabled roots", async () => {
    const { root, config } = await fixture()
    await mkdir(join(root, "repos", "git"), { recursive: true })
    await symlink(join(root, "code"), join(root, "alias"), "dir")
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({
        ...config,
        repositories: {
          ...config.repositories,
          api: {
            access: "read-only",
            source: { type: "subpath", repository: "platform", path: "api" },
          },
          alias: { access: "read-write", source: { type: "local", path: "alias" } },
          git: {
            access: "read-write",
            source: { type: "git", url: "https://example.invalid/a.git" },
          },
          missing: { access: "read-write", source: { type: "local", path: "missing" } },
          disabled: {
            disabled: true,
            access: "read-write",
            source: { type: "local", path: "code/api" },
          },
        },
      }),
    )
    await writeFile(
      join(root, "astrail.local.yaml"),
      stringify({
        apiVersion: config.apiVersion,
        kind: "WorkspaceLocal",
        repositories: { alias: { source: { path: "code" } } },
      }),
    )
    const plan = await planEditorWorkspace(await resolveWorkspace({ cwd: root }))
    expect(plan.folders).toEqual([
      { name: "editor (Workspace)", path: "." },
      { name: "alias", path: "code" },
      { name: "git", path: "repos/git" },
    ])
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        { repository: "api", reason: "covered", path: join(root, "code/api") },
        { repository: "missing", reason: "missing", path: join(root, "missing") },
      ]),
    )
    expect(plan.diagnostics.some((d) => d.code === "ASTR7402")).toBe(true)
    await applyEditorWorkspace(plan, { dryRun: true })
    expect(await pathExists(plan.workspacePath)).toBe(false)
    expect(await pathExists(join(root, ".astrail"))).toBe(false)
    const applied = await applyEditorWorkspace(plan)
    expect(applied.success).toBe(true)
    const repeat = await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))
    expect(repeat.data.changed).toBe(false)
    expect(repeat.data.plan.actions).toEqual([])
    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(
      "/editor.code-workspace\n/.astrail/editor-workspace.json\n",
    )
  })

  it("preserves settings, tasks, launch, comments and manual folders while removing obsolete owned entries", async () => {
    const { root, config } = await fixture()
    const path = join(root, "editor.code-workspace")
    await writeFile(
      path,
      '{\n // user comment\n "folders": [{"name":"Notes", "path":"notes"}],\n "settings": {"editor.fontSize": 16},\n "tasks": {"version":"2.0.0", "tasks":[]},\n "launch": {"configurations":[]},\n}\n',
    )
    expect((await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))).success).toBe(true)
    await writeFile(join(root, "astrail.yaml"), stringify({ ...config, repositories: {} }))
    expect((await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))).success).toBe(true)
    const text = await readFile(path, "utf8")
    expect(text).toContain("// user comment")
    expect(parse(text)).toEqual({
      folders: [
        { name: "editor (Workspace)", path: "." },
        { name: "Notes", path: "notes" },
      ],
      settings: { "editor.fontSize": 16 },
      tasks: { version: "2.0.0", tasks: [] },
      launch: { configurations: [] },
    })
  })

  it("does not adopt existing matching folders or delete renamed owned folders, and retains old output on rename", async () => {
    const { root, config } = await fixture()
    const path = join(root, "editor.code-workspace")
    await writeFile(path, JSON.stringify({ folders: [{ name: "Personal", path: "code" }] }))
    await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))
    await writeFile(join(root, "astrail.yaml"), stringify({ ...config, repositories: {} }))
    await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))
    expect(parse(await readFile(path, "utf8")).folders).toEqual([
      { name: "editor (Workspace)", path: "." },
      { name: "Personal", path: "code" },
    ])
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({ ...config, editor: { workspaceFile: "team workspace.code-workspace" } }),
    )
    await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))
    const newPath = join(root, "team workspace.code-workspace")
    await writeFile(newPath, (await readFile(newPath, "utf8")).replace('"platform"', '"Renamed"'))
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({
        ...config,
        repositories: {},
        editor: { workspaceFile: "team workspace.code-workspace" },
      }),
    )
    await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))
    expect(parse(await readFile(newPath, "utf8")).folders).toEqual([
      { name: "editor (Workspace)", path: "." },
      { name: "Renamed", path: "code" },
    ])
    expect(await pathExists(path)).toBe(true)
    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(
      "/team workspace.code-workspace",
    )
  })

  it("adds the root first, preserves root settings JSONC and is idempotent", async () => {
    const { root } = await fixture()
    await mkdir(join(root, ".vscode"))
    const settingsPath = join(root, ".vscode/settings.json")
    await writeFile(
      settingsPath,
      '{\n // personal settings\n "editor.fontSize": 18,\n "files.exclude": {"build": true},\n}\n',
    )
    const workspace = await resolveWorkspace({ cwd: root })
    const preview = await planEditorWorkspace(workspace)
    expect(preview.actions.some((action) => action.target === settingsPath)).toBe(true)
    expect((await applyEditorWorkspace(preview)).success).toBe(true)
    expect(parse(await readFile(preview.workspacePath, "utf8")).folders).toEqual([
      { name: "editor (Workspace)", path: "." },
      { name: "platform", path: "code" },
    ])
    const settings = await readFile(settingsPath, "utf8")
    expect(settings).toContain("// personal settings")
    expect(parse(settings)).toEqual({
      "editor.fontSize": 18,
      "files.exclude": { build: true, repos: true },
    })
    expect(parse(await readFile(preview.workspacePath, "utf8")).settings).toBeUndefined()
    expect((await syncEditorWorkspace(workspace)).data.changed).toBe(false)
  })

  it("reuses an existing root with its name and position without adopting it", async () => {
    const { root } = await fixture()
    const path = join(root, "editor.code-workspace")
    await writeFile(
      path,
      JSON.stringify({ folders: [{ path: "notes" }, { name: "Mine", path: root }] }),
    )
    expect((await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))).success).toBe(true)
    const folders = parse(await readFile(path, "utf8")).folders
    expect(folders.slice(0, 2)).toEqual([{ path: "notes" }, { name: "Mine", path: root }])
    expect(folders).toHaveLength(3)
    expect(
      parse(await readFile(join(root, ".astrail/editor-workspace.json"), "utf8")).files[
        "editor.code-workspace"
      ],
    ).toEqual([{ name: "platform", path: "code" }])
  })

  it("preserves explicit exclude overrides and detects stale settings before any writes", async () => {
    const { root } = await fixture()
    await mkdir(join(root, ".vscode"))
    const path = join(root, ".vscode/settings.json")
    const before = '{"files.exclude":{"repos":false}}'
    await writeFile(path, before)
    const workspace = await resolveWorkspace({ cwd: root })
    const plan = await planEditorWorkspace(workspace)
    expect(plan.diagnostics.some((d) => d.code === "ASTR7406")).toBe(true)
    await writeFile(path, '{"editor.fontSize":20}')
    expect((await applyEditorWorkspace(plan)).diagnostics.some((d) => d.code === "ASTR7404")).toBe(
      true,
    )
    expect(await pathExists(plan.workspacePath)).toBe(false)
    expect(await pathExists(join(root, ".gitignore"))).toBe(false)
    await writeFile(path, before)
    expect((await syncEditorWorkspace(workspace)).success).toBe(true)
    expect(await readFile(path, "utf8")).toBe(before)
  })

  it.each(["{ broken", '{"files.exclude":false}'])(
    "refuses invalid root settings %s without writing",
    async (content) => {
      const { root } = await fixture()
      await mkdir(join(root, ".vscode"))
      await writeFile(join(root, ".vscode/settings.json"), content)
      const result = await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))
      expect(result.success).toBe(false)
      expect(result.data.changed).toBe(false)
      expect(await pathExists(result.data.workspacePath)).toBe(false)
      expect(await pathExists(join(root, ".astrail"))).toBe(false)
    },
  )

  it("refuses stale plans and malformed JSONC without changing files", async () => {
    const { root } = await fixture()
    const plan = await planEditorWorkspace(await resolveWorkspace({ cwd: root }))
    await writeFile(plan.workspacePath, "{ broken")
    const stale = await applyEditorWorkspace(plan)
    expect(stale.diagnostics.some((d) => d.code === "ASTR7404")).toBe(true)
    const invalid = await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))
    expect(invalid.diagnostics.some((d) => d.code === "ASTR7403")).toBe(true)
    expect(await readFile(plan.workspacePath, "utf8")).toBe("{ broken")
    expect(await pathExists(join(root, ".gitignore"))).toBe(false)
  })

  it("copies managed legacy content and ownership to the new default while retaining the old file", async () => {
    const { root, config } = await fixture()
    const legacyPath = join(root, "astrail.code-workspace")
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({ ...config, editor: { workspaceFile: "astrail.code-workspace" } }),
    )
    await writeFile(
      legacyPath,
      '{\n // personal settings\n "folders": [{"path":"notes"}],\n "settings": {"editor.fontSize": 18},\n "tasks": {"tasks":[]},\n "launch": {"configurations":[]}\n}\n',
    )
    expect((await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))).success).toBe(true)
    const original = await readFile(legacyPath, "utf8")
    await writeFile(join(root, "astrail.yaml"), stringify({ ...config, repositories: {} }))
    const workspace = await resolveWorkspace({ cwd: root })
    const plan = await planEditorWorkspace(workspace)
    await applyEditorWorkspace(plan, { dryRun: true })
    expect(await pathExists(plan.workspacePath)).toBe(false)
    expect((await applyEditorWorkspace(plan)).success).toBe(true)
    const content = await readFile(plan.workspacePath, "utf8")
    expect(content).toContain("// personal settings")
    expect(parse(content)).toEqual({
      folders: [{ name: "editor (Workspace)", path: "." }, { path: "notes" }],
      settings: { "editor.fontSize": 18 },
      tasks: { tasks: [] },
      launch: { configurations: [] },
    })
    expect(await readFile(legacyPath, "utf8")).toBe(original)
    expect((await syncEditorWorkspace(workspace)).data.changed).toBe(false)
    await writeFile(legacyPath, "broken legacy file")
    expect((await syncEditorWorkspace(workspace)).success).toBe(true)
    expect(await readFile(plan.workspacePath, "utf8")).toBe(content)
  })

  it("refuses migration if the legacy source changes after preview", async () => {
    const { root, config } = await fixture()
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({ ...config, editor: { workspaceFile: "astrail.code-workspace" } }),
    )
    await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))
    await writeFile(join(root, "astrail.yaml"), stringify(config))
    const workspace = await resolveWorkspace({ cwd: root })
    const plan = await planEditorWorkspace(workspace)
    await writeFile(join(root, "astrail.code-workspace"), "{ broken")
    const stale = await applyEditorWorkspace(plan)
    expect(stale.diagnostics.some((d) => d.code === "ASTR7404")).toBe(true)
    const invalid = await syncEditorWorkspace(workspace)
    expect(invalid.diagnostics.some((d) => d.code === "ASTR7403")).toBe(true)
    expect(await pathExists(plan.workspacePath)).toBe(false)
  })

  it.each(["editor.code-workspace", ".gitignore", ".astrail", ".vscode", ".vscode/settings.json"])(
    "refuses symlink destination %s",
    async (name) => {
      const { root } = await fixture()
      const outside = await mkdtemp(join(tmpdir(), "astrail-editor-outside-"))
      const directory = [".astrail", ".vscode"].includes(name)
      const target = directory ? outside : join(outside, "file")
      if (name === ".vscode/settings.json") await mkdir(join(root, ".vscode"))
      if (!directory) await writeFile(target, "{}")
      await symlink(target, join(root, name))
      const synced = await syncEditorWorkspace(await resolveWorkspace({ cwd: root }))
      expect(synced.success).toBe(false)
      expect(synced.data.changed).toBe(false)
      if (!directory) expect(await readFile(target, "utf8")).toBe("{}")
    },
  )
})
