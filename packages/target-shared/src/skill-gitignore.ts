const BEGIN = "# astrail:begin generated-skills"
const END = "# astrail:end generated-skills"

/** Keep user rules intact and ignore exact generated entries, including symlinks. */
export function renderSkillGitignore(before: string, names: string[]): string {
  const lines = before.split(/(?<=\n)/)
  const starts = lines.flatMap((line, index) => (line.trimEnd() === BEGIN ? [index] : []))
  const ends = lines.flatMap((line, index) => (line.trimEnd() === END ? [index] : []))
  if (starts.length !== ends.length || starts.length > 1 || (starts[0] ?? -1) > (ends[0] ?? -1))
    throw new Error("Repair the Astrail generated-skills .gitignore markers before syncing")
  const escaped = [...new Set(names)].sort().map((name) => {
    if (!name || /[/\r\n]/.test(name) || name === "." || name === "..")
      throw new Error(`Invalid generated Skill name: ${name}`)
    return `/${name.replace(/[\\*?[\] !#]/g, "\\$&")}`
  })
  if (!starts.length && !escaped.length) return before
  const newline = before.includes("\r\n") ? "\r\n" : "\n"
  const block = [BEGIN, ...escaped, END, ""].join(newline)
  if (starts[0] !== undefined && ends[0] !== undefined)
    return lines.slice(0, starts[0]).join("") + block + lines.slice(ends[0] + 1).join("")
  return before + (before && !before.endsWith("\n") ? newline : "") + block
}
