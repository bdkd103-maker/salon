// Project-local Node 24 fallback when tsx cannot query Windows user information.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    const target = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    if (existsSync(target)) return next(target.href, context);
  }
  return next(specifier, context);
} });
// Unit route suites replace Prisma delegates. Supply an explicit persisted-policy
// fixture for unrelated routes; real verification scripts never use this mock.
if (process.argv.slice(2).length && process.argv.slice(2).every(file => file.endsWith('.test.ts'))) {
  const { prisma } = await import('../src/lib/prisma.ts');
  prisma.platformSettings = { findUnique: async () => ({
    id: 'platform', siteName: 'SALO', supportEmail: '', defaultLocale: 'ar',
    customerRegistrationEnabled: true, salonApplicationsEnabled: true,
    bookingGloballyEnabled: true, saloTicketGloballyEnabled: true,
    walkInGloballyEnabled: true, staffStatusLiveEnabled: true,
    createdAt: new Date(0), updatedAt: new Date(0)
  }) };
}
for (const file of process.argv.slice(2)) await import(pathToFileURL(resolve(file)).href);
