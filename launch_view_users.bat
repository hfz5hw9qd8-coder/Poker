@echo off
REM Lance l'exe view_users et ouvre le résultat dans Notepad
SETLOCAL
set BACKEND_URL=http://localhost:5000/api/dev/users
"%~dp0dist\view_users.exe" > "%~dp0users.json"
if exist "%~dp0users.json" (
  start notepad "%~dp0users.json"
) else (
  echo Erreur : users.json non créé.
)
pause
ENDLOCAL
