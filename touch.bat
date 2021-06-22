@echo off

:: Batch parameters: https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/call#batch-parameters
docker run --rm -v "%cd%":/mnt/workspace -w /mnt/workspace debian:buster touch %*
