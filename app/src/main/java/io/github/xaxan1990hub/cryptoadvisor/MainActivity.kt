package io.github.xaxan1990hub.cryptoadvisor

import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private val appHost = "appassets.androidplatform.net"

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
                    try { WebResourceResponse(mime, "utf-8", assets.open(path)) }
                    catch (_: java.io.IOException) { response("text/plain", "Not found", 404) }
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

    override fun onDestroy() {
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }
}
