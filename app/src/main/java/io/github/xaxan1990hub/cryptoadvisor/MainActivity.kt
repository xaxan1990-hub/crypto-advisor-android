package io.github.xaxan1990hub.cryptoadvisor

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private val appHost = "appassets.androidplatform.net"
    private val exportFile by lazy { File(cacheDir, "portfolio-export.json") }

    private val exportDocument = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri == null) return@registerForActivityResult
        try {
            val json = if (exportFile.exists()) exportFile.readText() else throw IOException("Нет данных для экспорта")
            contentResolver.openOutputStream(uri, "wt")?.use { it.write(json.toByteArray(Charsets.UTF_8)) }
                ?: throw IOException("Не удалось открыть файл")
            exportFile.delete()
            portfolioStatus("Портфель сохранён.", "ok")
        } catch (e: Exception) {
            portfolioStatus("Не удалось сохранить: ${e.message ?: "ошибка"}", "error")
        }
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        portfolioStatus(
            if (granted) "Уведомления разрешены." else "Уведомления не разрешены. Их можно включить в настройках Android.",
            if (granted) "ok" else "error",
        )
        web.evaluateJavascript("window.alertPermission && window.alertPermission($granted)", null)
    }

    private val importDocument = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@registerForActivityResult
        try {
            val bytes = readLimited(uri, 2_000_000)
            val text = bytes.toString(Charsets.UTF_8)
            web.evaluateJavascript(
                "window.receivePortfolioImport && window.receivePortfolioImport(${JSONObject.quote(text)})",
                null
            )
        } catch (e: Exception) {
            portfolioStatus("Не удалось прочитать файл: ${e.message ?: "ошибка"}", "error")
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val gateway = MarketGateway(this)
        val frame = FrameLayout(this)
        frame.setBackgroundColor(Color.rgb(16, 24, 21))
        WebView.setWebContentsDebuggingEnabled(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
        web = WebView(this)
        frame.addView(web)
        frame.setOnApplyWindowInsetsListener { view, insets ->
            @Suppress("DEPRECATION")
            view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets
        }
        setContentView(frame)
        web.setBackgroundColor(Color.rgb(16, 24, 21))
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
        }
        val updater = UpdateManager(this, web)
        web.addJavascriptInterface(object {
            @JavascriptInterface
            fun checkAndUpdate() {
                updater.checkAndUpdate()
            }
        }, "androidUpdater")
        web.addJavascriptInterface(object {
            @JavascriptInterface
            fun exportPortfolio(json: String, fileName: String) {
                runOnUiThread {
                    try {
                        if (json.length > 5_000_000) throw IOException("Слишком большой объём данных")
                        exportFile.writeText(json)
                        val safe = fileName
                            .replace(Regex("[^A-Za-z0-9._-]"), "_")
                            .take(80)
                            .ifBlank { "portfolio.json" }
                            .let { if (it.endsWith(".json", true)) it else "$it.json" }
                        exportDocument.launch(safe)
                    } catch (e: Exception) {
                        portfolioStatus("Не удалось подготовить экспорт: ${e.message ?: "ошибка"}", "error")
                    }
                }
            }

            @JavascriptInterface
            fun importPortfolio() {
                runOnUiThread {
                    try {
                        importDocument.launch(arrayOf("application/json", "text/plain", "application/octet-stream"))
                    } catch (e: Exception) {
                        portfolioStatus("Не удалось открыть выбор файла: ${e.message ?: "ошибка"}", "error")
                    }
                }
            }
        }, "androidPortfolio")
        web.addJavascriptInterface(object {
            @JavascriptInterface
            fun load(): String = AlertStore.read(this@MainActivity)

            @JavascriptInterface
            fun save(json: String) {
                runOnUiThread {
                    try {
                        AlertStore.write(this@MainActivity, json)
                        AlertStore.schedule(this@MainActivity)
                    } catch (e: Exception) {
                        portfolioStatus("Не удалось сохранить уведомления: ${e.message ?: "ошибка"}", "error")
                    }
                }
            }

            @JavascriptInterface
            fun enabled(): Boolean =
                NotificationManagerCompat.from(this@MainActivity).areNotificationsEnabled()

            @JavascriptInterface
            fun requestPermission() {
                runOnUiThread { requestNotificationPermission() }
            }

            @JavascriptInterface
            fun settings() {
                runOnUiThread { openNotificationSettings() }
            }

            @JavascriptInterface
            fun checkNow() {
                runOnUiThread { AlertStore.checkNow(this@MainActivity) }
            }
        }, "androidAlerts")
        runCatching { AlertStore.schedule(this) }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "https" && uri.host == appHost && uri.path == "/index.html") return false
                if (request.isForMainFrame && request.hasGesture() && uri.scheme == "https" && uri.host != appHost) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: ActivityNotFoundException) { }
                }
                return true
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val uri = request.url
                val path = uri.path.orEmpty().removePrefix("/")
                if (request.method != "GET" || uri.scheme != "https" || uri.host != appHost)
                    return response("text/plain", "Forbidden", 403)
                return if (path.startsWith("data/")) {
                    try { response("application/json", gateway.read(uri)) }
                    catch (e: Exception) {
                        response("application/json", JSONObject().put("error", e.message ?: "Источник недоступен").toString(), 503)
                    }
                } else {
                    val mime = when (path.substringAfterLast(".")) {
                        "html" -> "text/html"
                        "css" -> "text/css"
                        "js" -> "application/javascript"
                        "json" -> "application/json"
                        else -> return response("text/plain", "Not found", 404)
                    }
                    if (!path.matches(Regex("(models/)?[a-z0-9_-]+\\.[a-z]+"))) return response("text/plain", "Not found", 404)
                    try {
                        WebResourceResponse(mime, "utf-8", assets.open(path)).apply {
                            responseHeaders = mapOf(
                                "Cache-Control" to "no-store",
                                "X-Content-Type-Options" to "nosniff",
                            )
                        }
                    } catch (_: java.io.IOException) { response("text/plain", "Not found", 404) }
                }
            }
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.advisorBack ? window.advisorBack() : false") {
                    if (it != "true") finish()
                }
            }
        })
        web.loadUrl("https://$appHost/index.html?v=${Uri.encode(BuildConfig.VERSION_NAME)}")
    }

    private fun response(type: String, body: String, status: Int = 200) =
        WebResourceResponse(type, "utf-8", status, if (status == 200) "OK" else "Unavailable",
            mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"), body.byteInputStream())

    private fun readLimited(uri: Uri, limit: Int): ByteArray {
        val input = contentResolver.openInputStream(uri) ?: throw IOException("Файл недоступен")
        input.use {
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            var total = 0
            while (true) {
                val read = it.read(buffer)
                if (read < 0) break
                total += read
                if (total > limit) throw IOException("Файл больше ${limit / 1_000_000} МБ")
                out.write(buffer, 0, read)
            }
            return out.toByteArray()
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            portfolioStatus("Уведомления уже разрешены.", "ok")
            web.evaluateJavascript("window.alertPermission && window.alertPermission(true)", null)
        }
    }

    private fun openNotificationSettings() {
        try {
            startActivity(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            )
        } catch (_: Exception) {
            try {
                startActivity(
                    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
                )
            } catch (_: Exception) {
            }
        }
    }

    private fun portfolioStatus(text: String, kind: String = "info") {
        web.post {
            web.evaluateJavascript(
                "window.portfolioStatus && window.portfolioStatus(${JSONObject.quote(text)}, ${JSONObject.quote(kind)})",
                null
            )
        }
    }

    override fun onDestroy() {
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }
}
