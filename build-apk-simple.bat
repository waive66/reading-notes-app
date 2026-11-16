@echo off
chcp 65001 >nul
echo ========================================
echo    读书阁 - APK 一键生成工具
echo ========================================
echo.
echo 您只需要安装一个东西:
echo 1. 下载安装 Android Studio
echo    下载地址: https://developer.android.com/studio
echo.
echo 2. 打开 Android Studio - 点 More Actions - SDK Manager
echo    - SDK Platforms: 勾选 Android 14 (API 34)
echo    - SDK Tools: 勾选 Android SDK Build-Tools 34
echo    点 OK 安装
echo.
echo 3. 设置系统环境变量 ANDROID_HOME
echo    路径通常是: C:\Users\hzf\AppData\Local\Android\Sdk
echo.
echo 4. 按任意键开始生成 APK...
pause >nul

cd /d "%~dp0android-for-apk"
echo.
echo ⏳ 正在下载 Gradle 并构建 APK (第一次会比较慢)...

call gradlew assembleRelease

if exist app\build\outputs\apk\release\app-release.apk (
    echo.
    echo ========================================
    echo   ✅  成功生成 APK!
    echo ========================================
    echo   文件位置: android-for-apk\app\build\outputs\apk\release\app-release.apk
    echo.
    echo   把这个 apk 发给朋友，安装即可使用!
    echo ========================================
) else (
    echo.
    echo ❌ 构建失败，请检查错误信息
)

pause
