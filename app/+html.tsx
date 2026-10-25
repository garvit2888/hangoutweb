import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Root HTML template for Expo Router Web.
 * Configures mobile-friendly viewport, responsive container styles,
 * touch optimizations, and mobile web styling.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#0B0E17" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <title>HangOutNow</title>

        <ScrollViewStyleReset />

        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body {
                height: 100%;
                margin: 0;
                padding: 0;
                background-color: #0B0E17;
                overflow: hidden;
                -webkit-font-smoothing: antialiased;
                -webkit-tap-highlight-color: transparent;
                user-select: none;
                touch-action: manipulation;
              }

              /* Ensure full view for React Native Web root */
              #root {
                display: flex;
                height: 100%;
                width: 100%;
                overflow: hidden;
              }

              /* Smooth input and button handling */
              input, textarea, button, select {
                font-family: inherit;
              }

              input:focus, textarea:focus {
                outline: none;
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
