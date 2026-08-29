/**
 * A yes/no dialog that works on both targets.
 *
 * `Alert` is a no-op on react-native-web, so the PWA gets the browser's own
 * modal and native gets the action sheet. Resolves true only if the user
 * actually confirmed.
 */

import { Alert, Platform } from 'react-native';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label on the confirming button. Defaults to "OK". */
  confirmLabel?: string;
  /** Styles the confirming button as destructive on native. */
  destructive?: boolean;
}

export function confirmAction({
  title,
  message,
  confirmLabel = 'OK',
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return Promise.resolve(false);
    return Promise.resolve(window.confirm(message));
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
