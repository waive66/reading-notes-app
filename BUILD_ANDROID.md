# 读书阁 - 安卓 APK 构建指南

## 你需要安装

1. **Node.js** - https://nodejs.org (下载 LTS 版本)
2. **Java JDK 17** - https://adoptium.net (下载 Windows x64 安装包)
3. **Android Studio** - https://developer.android.com/studio (下载安装)

## 第一步：安装 Android SDK

打开 Android Studio：
1. 点 "More Actions" → "SDK Manager"
2. 在 "SDK Platforms" 选项卡，勾选 **Android 14.0 (API 34)**
3. 在 "SDK Tools" 选项卡，勾选 **Android SDK Build-Tools 34**
4. 点 "OK" 安装

记下 SDK 路径（默认: `C:\Users\[你用户名]\AppData\Local\Android\Sdk`）

## 第二步：构建 APK

打开 **CMD**（不要用 PowerShell），依次执行：

```bash
cd D:\Claude local session\reading-notes-app\client
npm install
npx vite build

cd ..\android
set ANDROID_HOME=C:\Users\hzf\AppData\Local\Android\Sdk
gradlew assembleDebug
```

## 第三步：找到 APK

构建成功后，APK 在：
```
android\app\build\outputs\apk\debug\app-debug.apk
```

把这个文件分享给朋友，在手机上安装即可使用！

---

## ⚠️ 重要：使用说明

**这个 APK 连接的是你家电脑上运行的后端服务（端口 3001）。**

要让朋友也能用，需要：
1. 你电脑上运行后端服务（`node server/index.js`）
2. 你电脑的 IP 地址在局域网内固定
3. 修改 `client/src/App.jsx` 中的 API 地址为你的局域网 IP

或者把后端部署到云端服务器上（如 Railway/Render）更省心。
