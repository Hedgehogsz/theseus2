package uk.theseus.survival

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager

/** Camera flash as a torch. setTorchMode needs no CAMERA permission. */
object Torch {
    @Volatile
    var isOn = false
        private set

    fun set(context: Context, enable: Boolean): Boolean = runCatching {
        val cm = context.getSystemService(CameraManager::class.java)
        val id = cm.cameraIdList.firstOrNull {
            cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
        } ?: return false
        cm.setTorchMode(id, enable)
        isOn = enable
        true
    }.getOrDefault(false)

    fun off(context: Context) {
        if (isOn) set(context, false)
    }
}
