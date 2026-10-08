/**
 * Outside a Project, no tabs band. This page (not only `default.tsx`) matters:
 * on a client-side navigation away from a Project, a slot with no match would
 * keep showing the Project's tabs.
 */
export default function NoTabs() {
  return null;
}
