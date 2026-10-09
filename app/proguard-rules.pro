# Methods exposed to the web UI via addJavascriptInterface must keep their names.
-keepclassmembers class uk.theseus.survival.WebBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
