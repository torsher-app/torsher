import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.licensee)
}

// Версия APK — версия продукта: один тег выпускает образ, IPK и APK
val productVersion = (JsonSlurper().parse(rootDir.resolve("../server/package.json")) as Map<*, *>)["version"] as String

fun versionCodeOf(version: String): Int {
    val (major, minor, patch) = version.substringBefore('-').split('.').map(String::toInt)
    return major * 1_000_000 + minor * 1_000 + patch
}

// Подпись релиза — из окружения CI; без него релиз собирается неподписанным
val releaseKeystore = System.getenv("ANDROID_KEYSTORE_PATH")

android {
    namespace = "app.torsher.androidtv"
    compileSdk {
        version = release(37) { minorApiLevel = 2 }
    }

    defaultConfig {
        applicationId = "app.torsher.androidtv"
        // Ниже 24 нет androidx.webkit
        minSdk = 24
        // 37 требует запрашивать доступ к локальной сети (ACCESS_LOCAL_NETWORK)
        targetSdk = 36
        versionName = productVersion
        versionCode = versionCodeOf(productVersion)
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    lint {
        // targetSdk 36 осознанно (см. defaultConfig); баннер ТВ рисуется только в xhdpi
        disable += setOf("OldTargetApi", "IconMissingDensityFolder")
        // «Вышла новая версия» зависит от дня запуска, а не от кода: с
        // warningsAsErrors такие проверки роняют CI без единой правки
        disable += setOf("AndroidGradlePluginVersion", "GradleDependency", "NewerVersionAvailable")
        warningsAsErrors = true
    }
}

// Список библиотек APK с их лицензиями генерируется в assets/licenses/artifacts.json, а тексты
// лицензий и NOTICE лежат рядом в src/main/assets/licenses. Разрешена только Apache-2.0:
// зависимость под другой лицензией валит сборку, пока её текст не добавлен туда же
licensee {
    allow("Apache-2.0")
    bundleAndroidAsset = true
    androidAssetReportPath = "licenses/artifacts.json"
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.core)
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.exoplayer.hls)
    implementation(libs.androidx.webkit)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    // org.json в android.jar — заглушки; в JVM-тестах нужна настоящая реализация
    testImplementation(libs.json)
}
