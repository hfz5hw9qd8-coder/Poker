@echo off
REM Convenience wrapper: runs the WSL bash restart script if available
where wsl >nul 2>&1
if %errorlevel%==0 (
  echo Running restart_all.sh in WSL...
  wsl bash /mnt/c/Users/mathieu/Desktop/poker/scripts/restart_all.sh
) else (
  echo WSL not found. Please run scripts\restart_all.sh from a bash/WSL shell.
)
