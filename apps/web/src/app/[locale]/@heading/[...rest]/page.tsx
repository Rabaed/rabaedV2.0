import { PageHeading } from "@/components/page-heading";

/** The top bar's title on a page outside a Project. Project pages have their own (`projects/[projectId]`). */
export default async function Heading({ params }: { params: Promise<{ rest: string[] }> }) {
  const { rest } = await params;
  return <PageHeading segment={rest[0] ?? ""} />;
}
