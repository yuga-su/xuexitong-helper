@echo off
chcp 65001 >nul
title 学习通助手 · 本地 AI 桥
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [失败] 没检测到 Node.js，先装一个 https://nodejs.org 再双击我
  pause
  exit /b 1
)
node fj-bridge.js
echo.
echo 桥已退出，按任意键关闭窗口
pause >nul