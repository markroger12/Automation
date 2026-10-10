import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { agentSchema, handleAgent } from '@/server/extension-agent';
import { verifyConnectionKey } from '@/server/extension-key';
import { formatZodError } from '@/server/api';
import { errorMessage, writeLog } from '@/server/log';

export const dynamic = 'force-dynamic';

/** The ChatGPT Worker extension's only endpoint. Authenticated with the Bearer connection key (no cookie, no CSRF). */
export async function POST(req: NextRequest) {
  if (!(await verifyConnectionKey(req.headers.get('authorization')))) {
    return NextResponse.json({ error: 'Invalid connection key. Create a new one in Settings and paste it into the extension.' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });
  }
  try {
    const parsed = agentSchema.parse(body);
    return NextResponse.json(await handleAgent(parsed));
  } catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: formatZodError(err) }, { status: 400 });
    await writeLog({ level: 'ERROR', category: 'CHATGPT', message: `Extension API error: ${errorMessage(err)}` });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
