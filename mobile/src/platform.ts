import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { Share } from '@capacitor/share';
import { browserUrl, customerUrl } from './routes';
export async function openCustomerPage(path: string) {
  const url = browserUrl(path);
  if (Capacitor.isNativePlatform()) await Browser.open({ url, toolbarColor: '#281b2b' });
  else {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    // noopener deliberately removes the returned Window; it is not failure proof.
    void opened;
  }
}
export async function shareCustomerEvent(data: {title: string; text: string; url: string}) {
  const url = customerUrl(data.url);
  if (Capacitor.isNativePlatform()) await Share.share({ ...data, url, dialogTitle: 'Bring your people' });
  else if (navigator.share) await navigator.share({ ...data, url });
  else throw new Error('Native sharing unavailable'); // Shared UI offers copy/manual fallback.
}
