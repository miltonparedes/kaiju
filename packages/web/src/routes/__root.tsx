import { Outlet, HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';

import appCssUrl from '@/styles/app.css?url';

export const Route = createRootRoute({
  component: RootLayout,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Kaiju' },
    ],
    links: [{ rel: 'stylesheet', href: appCssUrl }],
  }),
});

function RootLayout() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
