@echo off
rem Double-click to build the debug APK. Output goes to build-apk.log next to this file.
cd /d "%~dp0"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "JAVA_HOME=%~dp0.jdk\jdk-21"
echo Building the APK, this takes a few minutes...
call npm run apk:debug > build-apk.log 2>&1
if errorlevel 1 (echo BUILD FAILED>> build-apk.log & echo Build failed, see build-apk.log) else (echo BUILD OK>> build-apk.log & echo Done: android\app\build\outputs\apk\debug\app-debug.apk)
pause
