import { WebsiteDetail } from './website-detail';

export default async function WebsitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WebsiteDetail id={id} />;
}
