const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Guarda Chrome dentro de la carpeta del proyecto, no en el HOME del sistema
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};