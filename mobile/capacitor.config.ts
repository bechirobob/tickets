import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.becoreops.tickets',
  appName: 'BeCore Tickets',
  webDir: 'dist',
  backgroundColor: '#25192f',
  plugins: { SystemBars: { style: 'DARK', insetsHandling: 'css' } },
  ios: { contentInset: 'never', preferredContentMode: 'mobile' },
  android: { allowMixedContent: false },
};

export default config;
