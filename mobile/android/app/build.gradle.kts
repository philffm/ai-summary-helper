plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "eu.byphil.aishcompanion"
    compileSdk = 35

    defaultConfig {
        applicationId = "eu.byphil.aishcompanion"
        minSdk = 26
        targetSdk = 35
        // The release workflow passes the extension's version (-PversionName=2.2.19 -PversionCode=20219).
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("versionName") as String?) ?: "0.1.0"
    }
    // Release signing only when the workflow provides a keystore; local and CI builds without one stay debug-signed.
    val keystorePath = System.getenv("ANDROID_KEYSTORE_FILE")
    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            if (keystorePath != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false   // no shrinking until a release build has been tried on a device
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
    // The starter feeds live in the repo (shared/suggested-feeds.json); the app ships a copy and refreshes it from GitHub.
    sourceSets.getByName("main").assets.srcDir(rootProject.projectDir.resolve("../../shared"))
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.09.00"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    implementation("com.google.ai.edge.litertlm:litertlm-android:0.18.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
