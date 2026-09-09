import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { Share } from '@capacitor/share';
import { customerUrl } from './routes';

export async function openCustomerPage(path: string) {
  const url = customerUrl(path);
  if (Capacitor.isNativePlatform()) await Browser.open({ url, toolbarColor: '#25192f' });
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export async function shareEvent(slug: string, title: string) {
  const url = customerUrl(`/event/${slug}`);
  if (Capacitor.isNativePlatform()) await Share.share({ title, url, dialogTitle: 'Bring your people' });
  else if (navigator.share) await navigator.share({ title, url });
  else { await navigator.clipboard.writeText(url); return 'Link copied. Send it to your people.'; }
  return '';
}
