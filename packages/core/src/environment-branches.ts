import { type Diagnostic, diagnostic, type ResolvedEnvironment } from "./types.js"

type Checkout = NonNullable<ResolvedEnvironment["checkout"]>

export function environmentRepositoryBranch(
  checkout: Checkout | undefined,
  repository: string,
): string | undefined {
  const branch =
    checkout?.branches && Object.hasOwn(checkout.branches, repository)
      ? checkout.branches[repository]
      : checkout?.branch
  return typeof branch === "string" ? branch : undefined
}

export function validateEnvironmentBranches(
  id: string,
  repositories: readonly string[],
  checkout: Checkout,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const repository of Object.keys(checkout.branches ?? {}).sort()) {
    if (!repositories.includes(repository)) {
      diagnostics.push(
        diagnostic(
          "ASTR2022",
          "error",
          `Environment ${id} branch override references non-member repository ${repository}`,
        ),
      )
    }
  }
  for (const repository of repositories) {
    if (!environmentRepositoryBranch(checkout, repository)?.trim()) {
      diagnostics.push(
        diagnostic(
          "ASTR2023",
          "error",
          `Environment ${id} has no target branch for repository ${repository}`,
          {
            remediation:
              "Set checkout.branch as a default or provide checkout.branches for every member.",
          },
        ),
      )
    }
  }
  return diagnostics
}
