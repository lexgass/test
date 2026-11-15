// Pont vers les fonctions natives Android (alertes, fichiers, partage), exposé à app.js.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

window.Native = {
  isNative: Capacitor.isNativePlatform(),
  LocalNotifications, Filesystem, Directory, Encoding, Share,
};
