import { describe, expect, it } from "vitest"
import { collectRepositoryRequest } from "./repository-prompt.js"

describe("repository prompt", () => {
  it("requires and preserves a concise repository description", async () => {
    const answers = [
      "local",
      " references/protocol ",
      "",
      " ",
      " Contract ownership ",
      "",
      "",
      "",
      "",
    ]
    const prompts: string[] = []
    const messages: string[] = []

    const request = await collectRepositoryRequest({
      async question(prompt) {
        prompts.push(prompt)
        return answers.shift() ?? ""
      },
      write(message) {
        messages.push(message)
      },
    })

    expect(request).toEqual({
      source: { type: "local", path: "references/protocol" },
      description: "Contract ownership",
      required: true,
      writeTarget: "auto",
    })
    expect(
      prompts.filter((prompt) =>
        prompt.startsWith("Repository description (what this repository owns)"),
      ),
    ).toHaveLength(2)
    expect(messages).toContain("Repository description (what this repository owns) is required.\n")
  })
})
