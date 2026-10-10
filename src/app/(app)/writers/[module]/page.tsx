import { notFound } from 'next/navigation';
import { getModule } from '@/modules/registry';
import { WriterForm } from './writer-form';

export default async function WriterPage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const mod = getModule(module);
  if (!mod || mod.group !== 'Writers' || mod.status !== 'active') notFound();
  return <WriterForm moduleKey={mod.key} />;
}
