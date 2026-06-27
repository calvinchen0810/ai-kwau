@echo off
setlocal EnableDelayedExpansion
pushd "%~dp0"

REM ── Config ────────────────────────────────────────────────────────────────
set VENV=%~dp0..\model_setup\.venv
set PYTHON=%VENV%\Scripts\python.exe
set PYINST=%VENV%\Scripts\pyinstaller.exe
set DIST_ROOT=%~dp0dist
set PKG=%DIST_ROOT%\aikwau-dist

REM ── Pre-flight checks ─────────────────────────────────────────────────────
echo [AI Kwau] Build^: native_host.exe + register.exe
echo.

if not exist "%PYTHON%" (
    echo ERROR: venv not found at %VENV%
    echo        Run poc\model_setup\install_deps.bat first.
    goto :fail
)

REM Install / upgrade PyInstaller inside the venv
echo Checking PyInstaller...
"%PYTHON%" -m pip show pyinstaller >nul 2>&1
if errorlevel 1 (
    echo Installing PyInstaller...
    "%PYTHON%" -m pip install pyinstaller
    if errorlevel 1 goto :fail
)

REM ── Clean previous dist artefacts (keep build/ for PyInstaller cache) ────────
echo Cleaning previous dist...
if exist "%DIST_ROOT%\native_host" rmdir /s /q "%DIST_ROOT%\native_host"
if exist "%DIST_ROOT%\benchmark"   rmdir /s /q "%DIST_ROOT%\benchmark"
if exist "%DIST_ROOT%\register.exe" del /q "%DIST_ROOT%\register.exe"
if exist "%DIST_ROOT%\aikwau-dist"  rmdir /s /q "%DIST_ROOT%\aikwau-dist"
REM NOTE: build\ is intentionally kept — PyInstaller reuses .toc / DLL cache.
REM       Only delete it manually when OpenVINO is upgraded: rmdir /s /q build

REM ── Build 1/3 : native_host (onedir, ~270 MB) ─────────────────────────────
echo.
echo [1/3] Building native_host.exe (onedir) ...
echo       This takes 3-5 minutes the first time.
echo.
"%PYINST%" native_host.spec --distpath "%DIST_ROOT%" --workpath build
if errorlevel 1 (
    echo ERROR: native_host build failed.
    goto :fail
)

REM ── Build 2/3 : benchmark (onedir, shares _internal\ with native_host) ──────
echo.
echo [2/3] Building benchmark.exe (onedir) ...
echo       Also takes 3-5 minutes (same OpenVINO stack).
echo.
"%PYINST%" benchmark.spec --distpath "%DIST_ROOT%" --workpath build
if errorlevel 1 (
    echo ERROR: benchmark build failed.
    goto :fail
)

REM ── Build 3/3 : register (onefile, ~8 MB) ─────────────────────────────────
echo.
echo [3/3] Building register.exe (onefile) ...
"%PYINST%" register.spec --distpath "%DIST_ROOT%" --workpath build
if errorlevel 1 (
    echo ERROR: register build failed.
    goto :fail
)

REM ── Assemble transfer package ─────────────────────────────────────────────
echo.
echo Assembling transfer package at:
echo   %PKG%
echo.

mkdir "%PKG%\host"
mkdir "%PKG%\models"
mkdir "%PKG%\extension"

REM native_host onedir output → host\
echo Copying host binaries...
xcopy /e /i /q /y "%DIST_ROOT%\native_host\*" "%PKG%\host\" >nul

REM register.exe → host\ (onefile); benchmark.exe → host\ (exe only; shares _internal\ with native_host)
echo Copying register.exe and benchmark.exe...
copy /y "%DIST_ROOT%\register.exe"             "%PKG%\host\" >nul
copy /y "%DIST_ROOT%\benchmark\benchmark.exe"  "%PKG%\host\" >nul

REM Model files (exclude ov_cache — hardware-specific, auto-regenerated on target)
echo Copying model files (excluding ov_cache)...
robocopy "%~dp0..\models\qwen2.5-1.5b-int4" ^
         "%PKG%\models\qwen2.5-1.5b-int4" ^
         /e /xd ov_cache /njh /njs /nc /ns

REM Extension source
echo Copying extension...
robocopy "%~dp0..\extension" "%PKG%\extension" ^
         /e /xd bak /njh /njs /nc /ns

REM Root installer (bat launcher + ps1 logic)
echo Copying install.bat and install.ps1...
copy /y "%~dp0..\..\install.bat" "%PKG%\" >nul
copy /y "%~dp0..\..\install.ps1" "%PKG%\" >nul

REM ── Done ──────────────────────────────────────────────────────────────────
echo.
echo ============================================================
echo  Build complete!
echo  Transfer package : %PKG%
echo.
echo  Contents:
echo    host\native_host.exe  ^<-- Edge calls this (onedir)
echo    host\benchmark.exe    ^<-- benchmark tool (onedir, shares _internal\)
echo    host\register.exe     ^<-- installer tool (onefile, ~8 MB)
echo    host\_internal\       ^<-- OpenVINO DLLs shared by native_host + benchmark (~270 MB)
echo    models\               ^<-- Qwen2.5-1.5B IR (~1.4 GB)
echo    extension\            ^<-- load in Edge
echo    install.bat           ^<-- one-click installer
echo.
echo  Copy the entire aikwau-dist\ folder to the target machine.
echo ============================================================
echo.
popd
pause
exit /b 0

:fail
popd
pause
exit /b 1
