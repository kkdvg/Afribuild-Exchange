import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';
export default function Root({ children }: PropsWithChildren) {
  return <html lang="fr"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" /><meta name="theme-color" content="#f7f9f6" /><ScrollViewStyleReset /><script src="https://telegram.org/js/telegram-web-app.js" /></head><body>{children}</body></html>;
}
