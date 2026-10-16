import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export async function createFixtureWorkspace(manifest: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "astrail-fixture-"))
  await writeFile(join(root, "astrail.yaml"), manifest, "utf8")
  return root
}
