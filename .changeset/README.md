# Changesets

Every user-visible change should include a Changeset created with `pnpm changeset`.

All six `astrail*` workspace packages are one fixed release group. A bump requested
for any package applies the highest requested bump to every package, including the private
testing package, so their versions remain identical. The private workspace root is not a
release artifact.
