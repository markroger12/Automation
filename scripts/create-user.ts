/** npm run user:create -- --email you@example.com --name "Your Name" --password "..." [--role ADMIN|EDITOR] */
import readline from 'node:readline/promises';
import { prisma } from '../src/server/db';
import bcrypt from 'bcryptjs';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const email = (arg('email') ?? (await rl.question('Email: '))).trim().toLowerCase();
  const name = (arg('name') ?? (await rl.question('Name: '))).trim() || email;
  const password = arg('password') ?? (await rl.question('Password (10+ characters): '));
  const role = (arg('role') ?? ((await prisma.user.count()) === 0 ? 'ADMIN' : 'EDITOR')).toUpperCase() === 'ADMIN' ? 'ADMIN' : 'EDITOR';
  rl.close();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Invalid email.');
  if (password.length < 10) throw new Error('The password needs at least 10 characters.');
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, role },
    update: { name, passwordHash, role },
  });
  console.log(`User ${user.email} (${user.role}) saved.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
