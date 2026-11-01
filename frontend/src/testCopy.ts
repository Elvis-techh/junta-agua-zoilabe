/**
 * Which version the test copy is running (docs/test-copy.md), for the strip
 * on top of every screen there. The Test copy workflow sets the branch and
 * the commit when it builds; a real build has neither, so it gets no strip.
 */
export function testCopyLabel(branch: string | undefined, commit: string | undefined): string | null {
  const name = branch?.trim();
  if (!name) {
    return null;
  }
  const short = commit?.trim().slice(0, 7);
  return short ? `${name} · ${short}` : name;
}
