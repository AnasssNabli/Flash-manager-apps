const basePath = process.env.BASE_PATH || '/whatsapp-ai-agents'

/** @type {import('next').NextConfig} */
module.exports = {
  basePath,
  transpilePackages: ['@flashmanager/app-bridge'],
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  async headers() {
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
