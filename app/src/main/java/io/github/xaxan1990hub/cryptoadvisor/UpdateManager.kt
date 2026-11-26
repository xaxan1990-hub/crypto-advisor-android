package io.github.xaxan1990hub.cryptoadvisor

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.WebView
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

internal class UpdateManager(
    private val activity: Activity,
    private val web: WebView,
) {
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val api = "https://api.github.com/repos/xaxan1990-hub/crypto-advisor-android/releases?per_page=1"

    fun checkAndUpdate() {
        status("Проверяем обновления…")
        executor.execute {
            try {
                val release = latestRelease()
                val tag = release.optString("tag_name")
                if (tag.isBlank()) throw IOException("В релизе нет тега")
                if (!isNewer(tag, BuildConfig.VERSION_NAME)) {
                    status("Установлена последняя версия ${BuildConfig.VERSION_NAME}.", "ok")
                    return@execute
                }
                val assetUrl = apkUrl(release)
                status("Доступна $tag. Скачиваем APK…")
                val file = download(assetUrl)
                status("Проверяем подпись APK…")
                if (!sameSignature(file)) {
                    file.delete()
                    status("APK подписан другим ключом. Установка отменена.", "error")
                    return@execute
                }
                if (!activity.packageManager.canRequestPackageInstalls()) {
                    status("Разрешите установку из этого приложения и нажмите «Обновить» ещё раз.", "error")
                    main.post { openUnknownSources() }
                    return@execute
                }
                install(file)
            } catch (e: Exception) {
                status("Ошибка обновления: ${e.message ?: "нет соединения"}", "error")
            }
        }
    }

    private fun latestRelease(): JSONObject {
        val body = getText(api, "application/vnd.github+json")
        val releases = JSONArray(body)
        if (releases.length() == 0) throw IOException("Релизы не найдены")
        return releases.getJSONObject(0)
    }

    private fun apkUrl(release: JSONObject): String {
        val assets = release.optJSONArray("assets") ?: JSONArray()
        for (i in 0 until assets.length()) {
            val asset = assets.optJSONObject(i) ?: continue
            val name = asset.optString("name")
            val url = asset.optString("browser_download_url")
            if (name.endsWith(".apk", true) && url.startsWith("https://")) return url
        }
        throw IOException("В релизе нет APK")
    }

    private fun download(url: String): File {
        val dir = File(activity.cacheDir, "updates")
        if (!dir.exists()) dir.mkdirs()
        val file = File(dir, "update.apk")
        if (file.exists()) file.delete()
        var link = URL(url)
        var redirects = 0
        while (true) {
            val connection = link.openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 60_000
            connection.setRequestProperty("User-Agent", "CryptoAdvisorAndroid/${BuildConfig.VERSION_NAME}")
            connection.setRequestProperty("Accept", "application/octet-stream")
            val code = connection.responseCode
            if (code in 300..399) {
                val location = connection.getHeaderField("Location") ?: throw IOException("HTTP $code")
                connection.disconnect()
                link = URL(link, location)
                if (++redirects > 5) throw IOException("Слишком много редиректов")
                continue
            }
            if (code != 200) {
                connection.disconnect()
                throw IOException("HTTP $code")
            }
            connection.inputStream.use { input ->
                file.outputStream().use { output -> input.copyTo(output) }
            }
            connection.disconnect()
            break
        }
        if (file.length() < 1024) {
            file.delete()
            throw IOException("Скачанный APK пуст")
        }
        return file
    }

    private fun getText(url: String, accept: String): String {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 20_000
        connection.setRequestProperty("User-Agent", "CryptoAdvisorAndroid/${BuildConfig.VERSION_NAME}")
        connection.setRequestProperty("Accept", accept)
        return try {
            if (connection.responseCode != 200) throw IOException("GitHub HTTP ${connection.responseCode}")
            connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    @Suppress("DEPRECATION")
    private fun sameSignature(file: File): Boolean {
        val flags = if (Build.VERSION.SDK_INT >= 28) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }
        val installed = activity.packageManager.getPackageInfo(activity.packageName, flags)
        val archive = activity.packageManager.getPackageArchiveInfo(file.absolutePath, flags) ?: return false
        if (archive.packageName != activity.packageName) return false
        val current = signatures(installed)
        val candidate = signatures(archive)
        return current.isNotEmpty() && current == candidate
    }

    @Suppress("DEPRECATION")
    private fun signatures(info: PackageInfo): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= 28) {
            info.signingInfo?.apkContentsSigners
        } else {
            info.signatures
        }
        return signatures?.map { sha256(it.toByteArray()) }?.toSet() ?: emptySet()
    }

    private fun sha256(value: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(value).joinToString("") { "%02x".format(it) }

    private fun install(file: File) {
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        main.post {
            try {
                status("Открываем системный установщик…", "ok")
                activity.startActivity(intent)
            } catch (e: Exception) {
                status("Не удалось открыть установщик: ${e.message}", "error")
            }
        }
    }

    private fun openUnknownSources() {
        try {
            activity.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
            )
        } catch (_: Exception) {
            try {
                activity.startActivity(Intent(Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS))
            } catch (_: Exception) {
            }
        }
    }

    private fun isNewer(remote: String, local: String): Boolean {
        val r = parts(remote)
        val l = parts(local)
        for (i in 0..2) {
            if (r[i] != l[i]) return r[i] > l[i]
        }
        return false
    }

    private fun parts(value: String): List<Int> {
        val raw = value.trim().removePrefix("v").substringBefore("-").split(".")
        return (0..2).map { raw.getOrNull(it)?.toIntOrNull() ?: 0 }
    }

    private fun status(text: String, kind: String = "info") {
        main.post {
            val script = "window.updateStatus && window.updateStatus(${JSONObject.quote(text)}, ${JSONObject.quote(kind)})"
            web.evaluateJavascript(script, null)
        }
    }
}
