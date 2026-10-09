package uk.theseus.survival

import android.app.admin.DeviceAdminReceiver

/**
 * Device admin component. Make the app device owner (only possible with no accounts on the phone):
 *   adb shell dpm set-device-owner uk.theseus.survival/.KioskAdminReceiver
 * Once device owner, MainActivity pins itself with startLockTask(). The hidden menu
 * (long-press the title for 5 seconds) can unpin it or remove device owner again.
 */
class KioskAdminReceiver : DeviceAdminReceiver()
