#!/usr/bin/env bash
# exit on error
set -o errexit

npm install
# Forzar la instalación de Chrome para Puppeteer en Render
npx puppeteer browsers install chrome