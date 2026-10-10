import { PlagiarismView } from './plagiarism-view';

export default async function PlagiarismPage({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  const { task } = await searchParams;
  return <PlagiarismView initialTaskId={task ?? null} />;
}
