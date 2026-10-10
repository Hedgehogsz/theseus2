package uk.theseus.survival

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Re-applies the saved phone mode once at boot (HOME preference, lock-task allow-list). It does no other work and
 * starts nothing: in survival mode the system then opens the guide as the home screen, which pins itself.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        runCatching { PhoneMode(context, Prefs(context)).applyPolicies() }
    }
}
