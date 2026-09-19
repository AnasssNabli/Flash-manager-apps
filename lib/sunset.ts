/**
 * The day FlashManager's shared WhatsApp number stops sending.
 *
 * Sellers who were already on it keep their inbox until then; after that only
 * their own connected number works. Keep this in sync with
 * `app/whatsapp/_components/WhatsAppChooser.tsx` on the platform.
 */
export const SHARED_NUMBER_SUNSET = new Date('2026-10-08T00:00:00Z')

export function sunsetDateLabel(): string {
  return SHARED_NUMBER_SUNSET.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function daysUntilSunset(): number {
  return Math.max(0, Math.ceil((SHARED_NUMBER_SUNSET.getTime() - Date.now()) / 86_400_000))
}
