const basePath = process.env.BASE_PATH || '/whatsapp-business'

/** @type {import('next').NextConfig} */
module.exports = {
  basePath,
  transpilePackages: ['@flashmanager/app-bridge'],
  reactStrictMode: true,
  async headers() {
    // Only FlashManager may frame this app (clickjacking / rogue-embed defense).
    // frame-ancestors supersedes X-Frame-Options and lets us allow-list origins.
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value:
              "frame-ancestors 'self' https://platform.flash-manager.com https://dev.flash-manager.com",
          },
        ],
      },
    ]
  },
}
