@echo off
chcp 65001 >nul
echo ========================================
echo    读书阁 - 安卓 APK 一键构建
echo ========================================
echo.

echo [1/5] 检查 Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 未找到 Node.js
    echo 请先安装: https://nodejs.org
    pause
    exit /b
)
echo ✅ Node.js 已安装

echo [2/5] 检查 Java...
java -version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 未找到 Java
    echo 请先安装 JDK 17: https://adoptium.net
    pause
    exit /b
)
echo ✅ Java 已安装

echo [3/5] 安装前端依赖...
cd /d "%~dp0client"
call npm install
if %errorlevel% neq 0 (
    echo ❌ 依赖安装失败
    pause
    exit /b
)

echo [4/5] 构建前端...
call npx vite build
if %errorlevel% neq 0 (
    echo ❌ 前端构建失败
    pause
    exit /b
)

echo [5/5] 构建安卓 APK...
cd /d "%~dp0android"

echo ⏳ 首次运行会下载 Gradle 和 SDK，需要几分钟...
echo 请保持网络畅通...

call gradlew assembleDebug
if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo   ✅  APK 构建成功!
    echo ========================================
    echo   APK 位置:
    echo   app\build\outputs\apk\debug\app-debug.apk
    echo.
    echo   把这个 .apk 文件发给你朋友就能安装了!
    echo ========================================
) else (
    echo ❌ 构建失败，请检查错误信息
)

pause
