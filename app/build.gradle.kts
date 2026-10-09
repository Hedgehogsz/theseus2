import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val keystoreProps = Properties().apply {
    rootProject.file("keystore/keystore.properties").inputStream().use { load(it) }
}

android {
    namespace = "uk.theseus.survival"
    compileSdk = 34

    defaultConfig {
        applicationId = "uk.theseus.survival"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            storeFile = rootProject.file("keystore/" + keystoreProps.getProperty("storeFile"))
            storePassword = keystoreProps.getProperty("storePassword")
            keyAlias = keystoreProps.getProperty("keyAlias")
            keyPassword = keystoreProps.getProperty("keyPassword")
            enableV1Signing = true
            enableV2Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            // Same key as release so a debug build can be installed over a release build and vice versa.
            signingConfig = signingConfigs.getByName("release")
        }
    }

    androidResources {
        // WebP and JSON-in-JS payloads: store images uncompressed so WebView can stream them directly.
        noCompress += listOf("webp")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }

    packaging {
        resources.excludes += listOf("META-INF/*.version", "kotlin/**", "DebugProbesKt.bin")
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}
