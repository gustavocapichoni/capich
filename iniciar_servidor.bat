@echo off
chcp 65001 >nul
title Servidor - Crypto Trading History
cd /d "%~dp0"

echo ========================================================
echo       INICIANDO SERVIDOR CRYPTO TRADING HISTORY         
echo ========================================================
echo.

:: Verifica se o Node.js esta instalado
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERRO] Node.js nao foi encontrado no sistema!
    echo Por favor, instale o Node.js em: https://nodejs.org/
    echo.
    pause
    exit /b
)

:: Abre o navegador automaticamente apos 2 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

echo [OK] Servidor iniciando na porta 3000...
echo [OK] Abrindo navegador em http://localhost:3000 ...
echo.
echo Para fechar o servidor, basta fechar esta janela.
echo ========================================================
echo.

node server.js

if %ERRORLEVEL% neq 0 (
    echo.
    echo [AVISO] O servidor foi encerrado com erro.
    pause
)
