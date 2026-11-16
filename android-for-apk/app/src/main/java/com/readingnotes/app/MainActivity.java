package com.readingnotes.app;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;
import android.view.Window;
import android.view.WindowManager;
import android.view.View;
import androidx.appcompat.app.AppCompatActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private ValueCallback<Uri[]> uploadMessage;
    private static final int FILE_CHOOSER_REQUEST_CODE = 1;
    private static final String TAG = "XinJian";
    private static final String IMAGE_DIR = "diary_images";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window w = getWindow();
            w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            w.setStatusBarColor(0xFFFBF6EF);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                View decor = w.getDecorView();
                decor.setSystemUiVisibility(decor.getSystemUiVisibility() | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            }
        }
        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        // 图片存储桥：日记图片写入 App 内部存储，不占 localStorage
        webView.addJavascriptInterface(new ImageBridge(), "ImageStorage");
        // 密钥存储桥：AI 服务商 Key 用 Android Keystore 加密后落盘
        webView.addJavascriptInterface(new SecretStore(), "SecretStore");

        webView.setWebChromeClient(new WebChromeClient() {
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (uploadMessage != null) uploadMessage.onReceiveValue(null);
                uploadMessage = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST_CODE);
                } catch (Exception e) {
                    uploadMessage = null;
                    return false;
                }
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            public void onPageFinished(WebView view, String url) {
                Log.d(TAG, "Page loaded: " + url);
            }
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                Log.e(TAG, "Error: " + errorCode + " " + description + " url=" + failingUrl);
            }
        });
        Log.d(TAG, "Loading app from file:///android_asset/public/index.html");
        webView.loadUrl("file:///android_asset/public/index.html");
    }

    /** 供网页调用的图片存储接口（window.ImageStorage） */
    private class ImageBridge {

        private File imageDir() {
            File dir = new File(getFilesDir(), IMAGE_DIR);
            if (!dir.exists()) dir.mkdirs();
            return dir;
        }

        @JavascriptInterface
        public String saveImage(String name, String dataUrl) {
            if (name == null || name.length() == 0 || dataUrl == null) return "";
            try {
                int comma = dataUrl.indexOf(',');
                if (comma < 0) return "";
                byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
                File out = new File(imageDir(), name);
                FileOutputStream fos = new FileOutputStream(out);
                fos.write(bytes);
                fos.close();
                return "file://" + out.getAbsolutePath();
            } catch (Exception e) {
                Log.e(TAG, "saveImage failed: " + e.getMessage());
                return "";
            }
        }

        @JavascriptInterface
        public String getImagePath(String name) {
            if (name == null) return "";
            File f = new File(imageDir(), name);
            return f.exists() ? "file://" + f.getAbsolutePath() : "";
        }

        @JavascriptInterface
        public boolean exists(String name) {
            if (name == null) return false;
            return new File(imageDir(), name).exists();
        }

        @JavascriptInterface
        public boolean deleteImage(String name) {
            if (name == null) return false;
            try {
                File f = new File(imageDir(), name);
                return f.exists() && f.delete();
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public long usedBytes() {
            long total = 0;
            File[] files = imageDir().listFiles();
            if (files != null) for (File f : files) total += f.length();
            return total;
        }
    }

    /**
     * 密钥存储：Android Keystore 生成 AES-256 密钥（不可导出），
     * 用 AES/GCM 加密后把 IV + 密文存进 SharedPreferences。
     * 明文密钥只在这一刻存在于内存，不会写日志。
     */
    private class SecretStore {
        private static final String KEY_ALIAS = "xinjian_secret_v1";
        private static final String PREF = "xinjian_secrets";

        private SecretKey key() throws Exception {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (!ks.containsAlias(KEY_ALIAS)) {
                KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                kg.init(new KeyGenParameterSpec.Builder(
                        KEY_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build());
                kg.generateKey();
            }
            return (SecretKey) ks.getKey(KEY_ALIAS, null);
        }

        private SharedPreferences prefs() {
            return getSharedPreferences(PREF, MODE_PRIVATE);
        }

        @JavascriptInterface
        public boolean save(String alias, String value) {
            if (alias == null) return false;
            try {
                if (value == null || value.length() == 0) {
                    prefs().edit().remove(alias).apply();
                    return true;
                }
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key());
                byte[] iv = cipher.getIV();
                byte[] ct = cipher.doFinal(value.getBytes("UTF-8"));
                String packed = Base64.encodeToString(iv, Base64.NO_WRAP) + ":" +
                        Base64.encodeToString(ct, Base64.NO_WRAP);
                prefs().edit().putString(alias, packed).apply();
                return true;
            } catch (Exception e) {
                Log.e(TAG, "SecretStore.save failed: " + e.getClass().getSimpleName());
                return false;
            }
        }

        @JavascriptInterface
        public String load(String alias) {
            if (alias == null) return "";
            try {
                String packed = prefs().getString(alias, "");
                if (packed == null || packed.isEmpty()) return "";
                String[] parts = packed.split(":");
                if (parts.length != 2) return "";
                byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
                byte[] ct = Base64.decode(parts[1], Base64.NO_WRAP);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
                return new String(cipher.doFinal(ct), "UTF-8");
            } catch (Exception e) {
                Log.e(TAG, "SecretStore.load failed: " + e.getClass().getSimpleName());
                return "";
            }
        }

        @JavascriptInterface
        public boolean remove(String alias) {
            if (alias == null) return false;
            prefs().edit().remove(alias).apply();
            return true;
        }

        @JavascriptInterface
        public boolean available() {
            try {
                key();
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }

    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            if (uploadMessage == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                String dataString = data.getDataString();
                if (dataString != null) results = new Uri[]{Uri.parse(dataString)};
            }
            uploadMessage.onReceiveValue(results);
            uploadMessage = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
