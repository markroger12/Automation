import { prisma } from '@/server/db';
import { ConfigError } from '@/server/errors';
import { writeLog } from '@/server/log';
import { registerControlHandler } from '../control';
import { clearProfileCookies, deleteProfileFolder, withProfile, withVisibleWindow } from '../browser/profiles';
import { checkSession, detectTimezone, installPublishGuard, syncCategories } from './session';

async function websiteForProfile(data: Record<string, unknown>) {
  const websiteId = String(data.websiteId ?? '');
  const website = await prisma.website.findUnique({ where: { id: websiteId }, include: { profile: true } });
  if (!website) throw new ConfigError('Website not found.');
  if (!website.profile) throw new ConfigError('This website has no browser profile. Save the website again to create one.');
  return { website, profile: website.profile };
}

async function testAndStore(websiteId: string, sync: boolean) {
  const { website, profile } = await websiteForProfile({ websiteId });
  return withProfile(profile.id, async (context) => {
    await installPublishGuard(context);
    const page = await context.newPage();
    try {
      const result = await checkSession(page, website);
      await prisma.browserProfile.update({
        where: { id: profile.id },
        data: { sessionStatus: result.ok ? 'ACTIVE' : 'LOGIN_REQUIRED', sessionDetail: result.detail, lastCheckedAt: new Date() },
      });
      await writeLog({
        level: result.ok ? 'INFO' : 'WARN',
        category: 'SESSION',
        message: `${website.name}: ${result.detail}`,
        screenshotPath: result.screenshot ?? null,
      });
      let categories: Awaited<ReturnType<typeof syncCategories>> | null = null;
      if (result.ok && sync) {
        categories = await syncCategories(page, website);
        if (!website.siteTimezone) await detectTimezone(page, website).catch(() => null);
      }
      return { ...result, categories };
    } finally {
      await page.close().catch(() => undefined);
    }
  });
}

registerControlHandler('profile-login', async (data) => {
  const { website, profile } = await websiteForProfile(data);
  await writeLog({ category: 'SESSION', message: `Login window opened for ${website.name}. Log in, then close the window.` });
  const outcome = await withVisibleWindow(profile.id, website.adminUrl, 15 * 60_000);
  await prisma.browserProfile.update({ where: { id: profile.id }, data: { lastLoginAt: new Date() } });
  const result = await testAndStore(website.id, true);
  return { outcome, ...result };
});

registerControlHandler('profile-test', async (data) => testAndStore(String(data.websiteId), false));

registerControlHandler('profile-refresh', async (data) => testAndStore(String(data.websiteId), true));

registerControlHandler('sync-categories', async (data) => {
  const result = await testAndStore(String(data.websiteId), true);
  if (!result.ok) throw new Error(result.detail);
  return result;
});

registerControlHandler('profile-open', async (data) => {
  const { website, profile } = await websiteForProfile(data);
  const outcome = await withVisibleWindow(profile.id, String(data.url ?? website.adminUrl), 60 * 60_000);
  return { outcome };
});

registerControlHandler('profile-reset', async (data) => {
  const { website, profile } = await websiteForProfile(data);
  await clearProfileCookies(profile.id);
  await prisma.browserProfile.update({ where: { id: profile.id }, data: { sessionStatus: 'LOGIN_REQUIRED', sessionDetail: 'Session reset — log in again.', lastCheckedAt: new Date() } });
  await writeLog({ category: 'SESSION', message: `Session of ${website.name} was reset (cookies cleared).` });
  return { ok: true };
});

registerControlHandler('profile-delete', async (data) => {
  if (data.profileId && !data.websiteId) {
    // The website itself is being deleted: remove the folder and the profile row.
    await deleteProfileFolder(String(data.profileId));
    await prisma.browserProfile.delete({ where: { id: String(data.profileId) } }).catch(() => undefined);
    return { ok: true };
  }
  const { website, profile } = await websiteForProfile(data);
  await deleteProfileFolder(profile.id);
  await prisma.browserProfile.update({
    where: { id: profile.id },
    data: { sessionStatus: 'LOGIN_REQUIRED', sessionDetail: 'Profile folder deleted — log in again to create it.', lastCheckedAt: new Date() },
  });
  await writeLog({ category: 'SESSION', message: `Browser profile of ${website.name} was deleted.` });
  return { ok: true };
});

registerControlHandler('detect-timezone', async (data) => {
  const { website, profile } = await websiteForProfile(data);
  return withProfile(profile.id, async (context) => {
    await installPublishGuard(context);
    const page = await context.newPage();
    try {
      const { openAdmin } = await import('./session');
      await openAdmin(page, website);
      return { timezone: await detectTimezone(page, website) };
    } finally {
      await page.close().catch(() => undefined);
    }
  });
});
