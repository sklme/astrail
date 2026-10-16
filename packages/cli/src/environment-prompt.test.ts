import { beforeEach, describe, expect, it, vi } from "vitest"
import { createTerminalEnvironmentPrompter } from "./environment-prompt.js"

const terminal = vi.hoisted(() => ({ question: vi.fn(), close: vi.fn() }))
vi.mock("node:readline/promises", () => ({ createInterface: () => terminal }))

describe("environment branch prompts", () => {
  beforeEach(() => vi.resetAllMocks())

  it.each([
    [["main", "n"], { branch: "main" }],
    [["main", "y", "", "feature/api"], { branch: "main", branches: { backend: "feature/api" } }],
    [["", "main", "feature/api"], { branches: { frontend: "main", backend: "feature/api" } }],
  ])("collects default and per-member branches: %j", async (answers, checkout) => {
    for (const answer of ["default", "frontend, backend", ...answers, "", "", ""]) {
      terminal.question.mockResolvedValueOnce(answer)
    }
    expect(await createTerminalEnvironmentPrompter().collect()).toEqual({
      id: "default",
      repositories: ["frontend", "backend"],
      ...checkout,
    })
    expect(terminal.close).toHaveBeenCalledOnce()
  })
})
